// Ball physics in the "delivery frame": the striker's stumps are at z = +10.06,
// the bowler's stumps at z = -10.06, x > 0 is the off side of a right-handed batter,
// y is up. The scene rotates this frame by 180° when the ends change, so physics
// never needs to know which end of the ground is in use. All tunables: PhysicsConfig.js.

import { BOWLING_TYPES, bowlerKph } from './PlayerAttributes.js';
import { clamp } from '../utils/Random.js';
import {
  PHYSICS, PITCH as CFG_PITCH, lengthDef, classifyPitch, baselineTravelTime, kphToMs,
} from './PhysicsConfig.js';

export const G = PHYSICS.gravity;
export const BALL_R = PHYSICS.ballRadius;
export const PITCH = CFG_PITCH;
export const BOUNDARY_RADIUS = 63;
export const DRAG_K = PHYSICS.dragK;
export const RELEASE_Z = PHYSICS.release.z;

// Variations (how the ball moves). Speed and length are chosen separately.
export const DELIVERY_TYPES = {
  pace: [
    { id: 'stock', label: 'Seam up', swing: 0, accuracy: 1.0 },
    { id: 'outswing', label: 'Outswinger', swing: 1, accuracy: 0.94 },
    { id: 'inswing', label: 'Inswinger', swing: -1, accuracy: 0.94 },
  ],
  spin: [
    { id: 'stock', label: 'Stock ball', turn: 1.0, flight: 1.0, accuracy: 1.0 },
    { id: 'variation', label: 'Variation', turn: -0.85, flight: 0.9, accuracy: 0.9 },
    { id: 'flighted', label: 'Flighted', turn: 1.25, flight: 1.6, accuracy: 0.92 },
    { id: 'quicker', label: 'Flatter one', turn: 0.55, flight: 0.55, accuracy: 0.95 },
  ],
};

export function deliveryTypesFor(bowler) {
  const bt = BOWLING_TYPES[bowler.bowlingType];
  if (!bt) return [];
  return DELIVERY_TYPES[bt.kind].map(d => {
    if (bt.kind !== 'spin') return d;
    if (d.id === 'stock') return { ...d, label: bowler.bowlingType === 'off-spin' ? 'Off break' : 'Leg break' };
    if (d.id === 'variation') return bowler.bowlingType === 'off-spin'
      ? { ...d, label: 'Arm ball', turn: 0.12 }   // goes straight on, drifts away
      : { ...d, label: 'Googly' };               // turns the other way
    return d;
  });
}

/** Human label for where a ball actually pitched (distance from the striker's stumps). */
export function lengthClass(len) {
  return lengthDef(classifyPitch(len)).label.toLowerCase();
}

export function lineClass(x) {
  if (x > 0.75) return 'wide outside off';
  if (x > 0.2) return 'outside off';
  if (x > -0.16) return 'on the stumps';
  if (x > -0.45) return 'on the pads';
  return 'down leg';
}

/** Trajectory samples (time-sorted, possibly non-uniform) with interpolation helpers. */
export class Path {
  constructor(dt) { this.dt = dt; this.t = []; this.p = []; this.v = []; this.events = []; }
  push(t, p, v) { this.t.push(t); this.p.push(p); this.v.push(v); }
  get duration() { return this.t[this.t.length - 1] || 0; }
  at(time) {
    const T = this.t, n = T.length;
    if (!n) return { p: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 } };
    if (time <= T[0]) return { p: { ...this.p[0] }, v: { ...this.v[0] } };
    if (time >= T[n - 1]) return { p: { ...this.p[n - 1] }, v: { ...this.v[n - 1] } };
    // Uniform-step guess, then correct (bounce contacts add extra samples).
    let i = Math.min(n - 2, Math.max(0, Math.floor((time - T[0]) / this.dt)));
    while (i > 0 && T[i] > time) i--;
    while (i < n - 2 && T[i + 1] < time) i++;
    const span = T[i + 1] - T[i];
    const f = span > 0 ? clamp((time - T[i]) / span, 0, 1) : 0;
    const a = this.p[i], b = this.p[i + 1], va = this.v[i], vb = this.v[i + 1];
    return {
      p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f },
      v: { x: va.x + (vb.x - va.x) * f, y: va.y + (vb.y - va.y) * f, z: va.z + (vb.z - va.z) * f },
    };
  }
  /** First time the path crosses z (continuous: interpolates between samples, so nothing is skipped). */
  timeAtZ(z) {
    const P = this.p;
    if (!P.length || P[P.length - 1].z < z) return null;
    let lo = 0, hi = P.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].z < z) lo = m + 1; else hi = m; }
    if (lo === 0) return this.t[0];
    const a = P[lo - 1], b = P[lo];
    const f = b.z === a.z ? 0 : (z - a.z) / (b.z - a.z);
    return this.t[lo - 1] + f * (this.t[lo] - this.t[lo - 1]);
  }
  /** Highest point between two times. */
  maxHeight(t0, t1) {
    let m = -Infinity;
    for (let i = 0; i < this.t.length; i++) if (this.t[i] >= t0 && this.t[i] <= t1) m = Math.max(m, this.p[i].y);
    return m;
  }
}

/** Stage A, no drag: initial velocity of magnitude `speed` that reaches `aim` under constant accel (ax, ay). */
function analyticLaunch(rel, aim, speed, ax, ay) {
  const dx = aim.x - rel.x, dy = aim.y - rel.y, dz = aim.z - rel.z;
  const vel = tb => ({ x: (dx - 0.5 * ax * tb * tb) / tb, y: (dy - 0.5 * ay * tb * tb) / tb, z: dz / tb });
  const mag = tb => { const v = vel(tb); return Math.hypot(v.x, v.y, v.z); };
  // |v(tb)| falls from ≥ speed at tb = dz/speed to a minimum, then rises again (the lob solution).
  let lo = dz / speed, hi = lo, best = lo, bestM = mag(lo);
  for (let k = 1; k <= 120; k++) {
    const tb = lo * (1 + k * 0.025);
    const m = mag(tb);
    if (m < bestM) { bestM = m; best = tb; }
    if (m <= speed) { hi = tb; break; }
  }
  if (hi === lo) return { v: vel(best), tb: best }; // can't reach at this speed: flattest possible lob
  let a = hi / (1 + 0.025), b = hi;
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (mag(m) > speed) a = m; else b = m; }
  return { v: vel(b), tb: b };
}

/** Integrate Stage A only (release to the aim plane) with gravity, swing/dip and drag. Returns {x, y} at aim.z. */
function flyToPlane(rel, v0, ax, ay, zPlane) {
  const dt = PHYSICS.integrationDt, k = PHYSICS.dragK;
  const p = { ...rel }, v = { ...v0 };
  for (let i = 0; i < 20000; i++) {
    const sp = Math.hypot(v.x, v.y, v.z);
    const nx = p.x + v.x * dt, ny = p.y + v.y * dt, nz = p.z + v.z * dt;
    if (nz >= zPlane) {
      const f = (zPlane - p.z) / (nz - p.z);
      return { x: p.x + (nx - p.x) * f, y: p.y + (ny - p.y) * f };
    }
    p.x = nx; p.y = ny; p.z = nz;
    v.x += (ax - k * sp * v.x) * dt;
    v.y += (ay - k * sp * v.y) * dt;
    v.z += (-k * sp * v.z) * dt;
  }
  return { x: p.x, y: p.y };
}

/**
 * Solve the release velocity: magnitude fixed to the selected speed, direction aimed so the
 * drag-affected trajectory arrives at `target` (the pitching point, or the full-toss point).
 * Shooting method: correct the aim point by the miss until within tolerance.
 */
export function solveLaunch(rel, target, speed, ax, ay) {
  let aim = { ...target };
  let sol = analyticLaunch(rel, aim, speed, ax, ay);
  for (let it = 0; it < PHYSICS.solver.iterations; it++) {
    const hit = flyToPlane(rel, sol.v, ax, ay, target.z);
    const ex = target.x - hit.x, ey = target.y - hit.y;
    if (Math.abs(ex) < PHYSICS.solver.tolerance && Math.abs(ey) < PHYSICS.solver.tolerance) break;
    aim = { x: aim.x + ex, y: aim.y + ey, z: aim.z };
    sol = analyticLaunch(rel, aim, speed, ax, ay);
  }
  return sol.v;
}

/** Infer a length id from a legacy numeric target length. */
function lengthFromLen(len) { return len == null ? 'good' : len < 0 ? 'fullToss' : classifyPitch(len); }

/**
 * Plan a delivery (Stages A, B and C are precomputed as one continuous trajectory).
 * spec = {
 *   speedKph:   selected bowling speed (km/h). Release velocity magnitude = speedKph / 3.6.
 *   length:     'yorker' | 'fullToss' | 'full' | 'good' | 'backOfLength' | 'shortOfLength' | 'short' | 'bouncer'
 *   target:     { x: line at pitching, len: pitching distance from the batsman's stumps (within the length range),
 *                 height: full-toss target height at the popping crease }
 *   type:       variation (seam/swing/spin type), power 0..1, quality 0..1, fatigue 0..1, spreadMult (0 = perfect accuracy)
 * }
 */
export function planDelivery(bowler, spec, rng) {
  const bt = BOWLING_TYPES[bowler.bowlingType] || BOWLING_TYPES.medium;
  const kind = bt.kind;
  const types = deliveryTypesFor({ ...bowler, bowlingType: bowler.bowlingType || 'medium' });
  const dtype = types.find(d => d.id === spec.type) || types[0];
  const quality = clamp(spec.quality ?? 0.8, 0, 1);
  const power = clamp(spec.power ?? 0, 0, 1);
  const fatigue = clamp(spec.fatigue ?? 0, 0, 1);
  const move = bowler.bowlMovement / 100;
  const lengthId = PHYSICS.lengths[spec.length] ? spec.length : lengthFromLen(spec.target?.len);
  const L = lengthDef(lengthId);

  // ---- speed: the selected speed sets the release velocity
  const stock = bowlerKph({ ...bowler, bowlingType: bowler.bowlingType || 'medium' });
  const selectedKph = spec.speedKph ?? Math.round(stock);
  const kph = selectedKph + (PHYSICS.speedJitterKph ? rng.gauss(0, PHYSICS.speedJitterKph) : 0);
  const speed = kphToMs(kph);

  // ---- accuracy: better bowlers and well-timed releases land closer to the target
  const acc = clamp(bowler.bowlAccuracy + bt.accuracyMod, 1, 99) / 100;
  const sigma = (1.28 - acc) * (1 + (1 - quality) * 1.7) * (1 + power * 0.55) * (1 + fatigue * 0.7)
    / (dtype.accuracy || 1) * (spec.spreadMult ?? 1);
  const tx = spec.target?.x ?? 0.1;
  const rel = { x: PHYSICS.release.x + (sigma ? rng.gauss(0, PHYSICS.release.xJitter) : 0), y: kind === 'pace' ? PHYSICS.release.heightPace : PHYSICS.release.heightSpin, z: PHYSICS.release.z };
  let aimPoint, targetLen = null, targetHeight = null;
  if (L.range) {
    targetLen = spec.target?.len != null && spec.length ? clamp(spec.target.len, L.range[0], L.range[1])
      : spec.target?.len != null ? spec.target.len : rng.range(L.range[0], L.range[1]);
    const len = clamp(targetLen + (sigma ? rng.gauss(0, sigma * (kind === 'spin' ? 0.75 : 1.05)) : 0), 0.02, 15);
    aimPoint = { x: tx + (sigma ? rng.gauss(0, sigma * 0.17) : 0), y: BALL_R, z: PITCH.half - len };
  } else {
    const [h0, h1] = L.heightRange;
    targetHeight = spec.target?.height ?? rng.range(h0, h1);
    const h = clamp(targetHeight + (sigma ? rng.gauss(0, sigma * 0.22) : 0), 0.15, 2.4);
    aimPoint = { x: tx + (sigma ? rng.gauss(0, sigma * 0.17) : 0), y: h, z: PITCH.popping };
  }

  // ---- movement: swing / drift in the air, seam / turn off the pitch
  let swingAx = 0, dip = 0, turnVx = 0, seamVx = 0;
  if (kind === 'pace') {
    swingAx = (dtype.swing || 0) * bt.swing * (0.45 + move) * 2.3 + rng.gauss(0, 0.35 * bt.swing * (0.3 + move));
    seamVx = rng.gauss(0, 0.32 * bt.seam * (0.4 + move) * (1 + power * 0.3));
  } else {
    swingAx = -bt.turnSign * bt.drift * (0.3 + 0.7 * move) * 0.9 * Math.sign(dtype.turn || 1);
    dip = 2.2 * bt.flight * (dtype.flight || 1);
    turnVx = bt.turnSign * bt.turn * (dtype.turn ?? 1) * (0.35 + 0.85 * move) * 1.05 * (0.8 + rng.next() * 0.4);
  }
  const ay = -(G + dip);

  // ---- Stage B parameters: bounce restitution and horizontal retention for this length
  const spinMul = kind === 'spin' ? PHYSICS.spinBounce : { restitution: 1, retention: 1 };
  const eVert = L.restitution * spinMul.restitution * bt.bounce * (1 + power * PHYSICS.effortBounce)
    * (1 + rng.gauss(0, PHYSICS.bounceVariation));
  const keepH = L.retention * spinMul.retention;

  // ---- Stage A: solve the release velocity for the selected speed, then integrate everything
  const v0 = solveLaunch(rel, aimPoint, speed, swingAx, ay);
  const path = simulateDelivery({ release: rel, v: v0, swingAx, ay, eVert, keepH, kick: turnVx + seamVx });
  const allBounces = path.events.filter(e => e.type === 'bounce');
  const first = allBounces[0] && allBounces[0].p.z <= PHYSICS.travelEndZ ? allBounces[0] : null;
  const bounceLen = first ? PITCH.half - first.p.z : null;

  const tStumps = path.timeAtZ(PITCH.half);
  const atStumps = tStumps != null ? path.at(tStumps).p : null;
  const hitsStumps = !!atStumps && Math.abs(atStumps.x) <= PITCH.stumpHalfWidth + BALL_R && atStumps.y <= PITCH.stumpHeight + BALL_R && atStumps.y > 0;
  const tCrease = path.timeAtZ(PITCH.popping);
  const atCrease = tCrease != null ? path.at(tCrease).p : null;

  // ---- Stage C timings: travel time vs reaction time after the bounce
  const tTotal = path.timeAtZ(PHYSICS.travelEndZ);
  const tZone = path.timeAtZ(PHYSICS.hittingZone.zStart);
  const tPitch = first ? first.t : null;
  const atZone = tZone != null ? path.at(tZone) : null;
  const timing = {
    selectedKph,
    releaseSpeed: Math.hypot(v0.x, v0.y, v0.z),
    tPitch,
    tTotal,
    tPostPitch: tPitch != null && tTotal != null ? tTotal - tPitch : null,
    tZoneEntry: tZone,
    reaction: tPitch != null && tZone != null ? Math.max(0, tZone - tPitch) : null,   // post-bounce reaction window
    pitchedInZone: tPitch != null && tZone != null && tPitch > tZone,
    baseline: baselineTravelTime(selectedKph),
    impactSpeed: first ? Math.hypot(first.vIn.x, first.vIn.y, first.vIn.z) : null,
    exitSpeed: first ? Math.hypot(first.vOut.x, first.vOut.y, first.vOut.z) : null,
    stumpsSpeed: tStumps != null ? (() => { const v = path.at(tStumps).v; return Math.hypot(v.x, v.y, v.z); })() : null,
    bouncePeak: first && tTotal != null ? path.maxHeight(first.t, tTotal) : null,
    heightAtZone: atZone ? atZone.p.y : null,
    heightAtStumps: atStumps ? atStumps.y : null,
  };

  return {
    bowlerId: bowler.id,
    kind,
    bowlingType: bowler.bowlingType,
    typeId: dtype.id,
    typeLabel: dtype.label,
    lengthId,
    lengthLabel: L.label,
    stockKph: stock,
    speedKph: Math.round(kph),
    speed,
    release: rel,
    v0,
    target: { x: tx, len: targetLen, height: targetHeight },
    aimPoint,
    path,
    bounce: first ? { x: first.p.x, z: first.p.z, t: first.t } : null,
    bounceLen,
    lengthClass: first ? lengthClass(bounceLen) : 'full toss',
    lineAtCrease: atCrease ? atCrease.x : 0,
    heightAtCrease: atCrease ? atCrease.y : 0,
    lineClass: lineClass(atCrease ? atCrease.x : 0),
    atStumps,
    hitsStumps,
    timing,
    deviation: Math.abs(turnVx + seamVx) * 0.18 + Math.abs(swingAx) * 0.12,
    noBall: !!spec.overstep,
    power,
    quality,
  };
}

/**
 * Integrate a delivery with a fixed step: gravity, drag, swing/dip before pitching (Stage A);
 * exact ground contact and bounce impulse (Stage B); then on past the batsman (Stage C).
 * Contacts are found inside the step (sub-step), so the ball never sinks into the pitch.
 */
export function simulateDelivery({ release, v, swingAx, ay, eVert, keepH, kick, dt = PHYSICS.integrationDt, maxT = PHYSICS.maxFlightTime }) {
  const path = new Path(dt);
  const k = PHYSICS.dragK, R = BALL_R, LB = PHYSICS.laterBounce;
  const p = { ...release };
  const vel = { ...v };
  let t = 0, bounces = 0, rolling = false;
  path.push(0, { ...p }, { ...vel });
  const accel = () => {
    const sp = Math.hypot(vel.x, vel.y, vel.z);
    return {
      x: (bounces === 0 ? swingAx : 0) - k * sp * vel.x,
      y: (bounces === 0 ? ay : -G) - k * sp * vel.y,
      z: -k * sp * vel.z,
    };
  };
  while (t < maxT && p.z < PITCH.half + 28) {
    let h = dt;
    if (rolling) {
      const sp = Math.hypot(vel.x, vel.z);
      const dec = Math.min(sp, LB.rollDecel * h);
      if (sp > 0) { vel.x -= vel.x / sp * dec; vel.z -= vel.z / sp * dec; }
      p.x += vel.x * h; p.z += vel.z * h; t += h;
      if (sp < 0.2) { path.push(t, { ...p }, { x: 0, y: 0, z: 0 }); break; }
      path.push(t, { ...p }, { ...vel });
      continue;
    }
    // semi-implicit Euler for this step
    const a = accel();
    const nv = { x: vel.x + a.x * h, y: vel.y + a.y * h, z: vel.z + a.z * h };
    const np = { x: p.x + nv.x * h, y: p.y + nv.y * h, z: p.z + nv.z * h };
    if (np.y < R && nv.y < 0) {
      // Exact contact inside the step
      const f = clamp((p.y - R) / (p.y - np.y), 0, 1);
      const tc = t + f * h;
      const cp = { x: p.x + (np.x - p.x) * f, y: R, z: p.z + (np.z - p.z) * f };
      const vin = { x: vel.x + (nv.x - vel.x) * f, y: vel.y + (nv.y - vel.y) * f, z: vel.z + (nv.z - vel.z) * f };
      let vout;
      if (bounces === 0) vout = { x: vin.x * 0.9 + kick, y: -vin.y * eVert, z: vin.z * keepH };
      else vout = { x: vin.x * LB.retention, y: -vin.y * LB.restitution, z: vin.z * LB.retention };
      bounces++;
      path.push(tc, { ...cp }, { ...vout });
      path.events.push({ type: 'bounce', t: tc, p: { ...cp }, vIn: vin, vOut: { ...vout } });
      // finish the step from the contact point with the new velocity
      const rest = (1 - f) * h;
      Object.assign(vel, vout);
      p.x = cp.x + vel.x * rest; p.y = R + Math.max(0, vel.y * rest); p.z = cp.z + vel.z * rest;
      t = tc + rest;
      if (bounces > 1 && Math.abs(vel.y) < LB.rollBelow) { vel.y = 0; p.y = R; rolling = true; }
      if (rest > 1e-9) path.push(t, { ...p }, { ...vel });
      continue;
    }
    Object.assign(vel, nv); Object.assign(p, np);
    t += h;
    path.push(t, { ...p }, { ...vel });
  }
  return path;
}

/**
 * Batted ball: drag, bounces on grass, rolling friction, boundary detection.
 * Returns a Path plus {boundary: {t, runs, p} | null, firstBounceT, stopT}.
 */
export function simulateBattedBall(p0, v0, { dt = 1 / 120, maxT = 14, startT = 0, radius = BOUNDARY_RADIUS, alreadyBounced = false } = {}) {
  const path = new Path(dt);
  const p = { ...p0 };
  const v = { ...v0 };
  let t = startT;
  let bounced = alreadyBounced;
  let firstBounceT = null;
  let boundary = null;
  let rolling = false;
  path.t0 = startT;
  path.push(t, { ...p }, { ...v });
  while (t < startT + maxT) {
    const sp = Math.hypot(v.x, v.y, v.z);
    if (!rolling) {
      const k = DRAG_K * sp;
      v.x -= v.x * k * dt; v.z -= v.z * k * dt;
      v.y -= (G + v.y * k) * dt;
    } else {
      const h = Math.hypot(v.x, v.z);
      const dec = Math.min(h, 2.9 * dt);
      if (h > 0) { v.x -= v.x / h * dec; v.z -= v.z / h * dec; }
    }
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    t += dt;
    if (!rolling && p.y <= BALL_R && v.y < 0) {
      p.y = BALL_R;
      if (!bounced) firstBounceT = t;
      bounced = true;
      v.y = -v.y * 0.36;
      v.x *= 0.8; v.z *= 0.8;
      if (v.y < 1.0) { v.y = 0; rolling = true; }
      path.events.push({ type: 'bounce', t, p: { ...p } });
    }
    const r = Math.hypot(p.x, p.z);
    if (r >= radius) {
      boundary = { t, runs: bounced ? 4 : 6, p: { ...p } };
      path.push(t, { ...p }, { ...v });
      break;
    }
    const h = Math.hypot(v.x, v.z);
    if (rolling && h < 0.15) {
      path.push(t, { ...p }, { x: 0, y: 0, z: 0 });
      break;
    }
    path.push(t, { ...p }, { ...v });
  }
  // Path.at() assumes samples start at t[0]; keep the offset consistent.
  path.dt = dt;
  return { path, boundary, firstBounceT, stopT: path.duration, bouncedAtStart: alreadyBounced };
}

/** Velocity vector from a launch angle in the delivery frame (0° = back past the bowler, + = off side). */
export function launchVelocity(speed, dirDeg, elevDeg) {
  const d = dirDeg * Math.PI / 180, e = elevDeg * Math.PI / 180;
  const h = speed * Math.cos(e);
  return { x: h * Math.sin(d), y: speed * Math.sin(e), z: -h * Math.cos(d) };
}

/** Field angle of a point as seen from the striker (same convention as launchVelocity). */
export function fieldAngle(x, z, fromZ = 9.2) {
  return Math.atan2(x, -(z - fromZ)) * 180 / Math.PI;
}
