// One ball in the nets. It is the match delivery (same run-up, ball physics, shot model, pads, LBW and
// stumps) with nobody fielding and nobody running: the ball ends up in the netting. Each shot is also
// played out on an open field against a standard field, to say what it would have been worth in a match.

import { DeliverySim, timeToReach } from './DeliverySim.js';
import { simulateBattedBall, Path, PITCH, BALL_R, G, DRAG_K } from './BallPhysics.js';
import { FIELD_PRESETS, keeperPosition } from './FieldPlacements.js';
import { netExtra } from './NetsConfig.js';
import { clamp } from '../utils/Random.js';

// The net lane in the delivery frame (m): side nets at ±halfW from the open front end to the back net
// behind the striker, a roof over the batting half. The default batting cameras sit inside the back net.
export const NET = { halfW: 1.8, backZ: 16.2, frontZ: -6, height: 3.4, roofFrom: 2 };
const GIVE = { normal: 0.1, tangent: 0.32 };   // netting soaks up the ball: little bounce back, most speed lost

/**
 * A ball hit (or let through) inside the nets: drag, gravity, ground bounces and rolling as on the field,
 * stopped by the side, back and roof nets. Returns { path, hits: [{t, p, which, speed}], stopT }.
 */
export function simulateNetBall(p0, v0, { dt = 1 / 120, startT = 0, maxT = 4, alreadyBounced = false, net = NET } = {}) {
  const path = new Path(dt);
  const p = { ...p0 }, v = { ...v0 };
  const R = BALL_R, N = net;
  let t = startT, rolling = alreadyBounced && p.y <= R + 1e-3 && Math.abs(v.y) < 1;
  const hits = [];
  path.push(t, { ...p }, { ...v });
  while (t < startT + maxT) {
    const prev = { x: p.x, y: p.y, z: p.z };
    if (!rolling) {
      const k = DRAG_K * Math.hypot(v.x, v.y, v.z);
      v.x -= v.x * k * dt; v.z -= v.z * k * dt;
      v.y -= (G + v.y * k) * dt;
    } else {
      const h = Math.hypot(v.x, v.z), dec = Math.min(h, 2.9 * dt);
      if (h > 0) { v.x -= v.x / h * dec; v.z -= v.z / h * dec; }
    }
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    t += dt;
    const hit = (which, speed) => { if (speed > 1) hits.push({ t, p: { ...p }, which, speed }); };
    // side nets (only from inside the lane, below the top of the net)
    if (p.y < N.height && p.z > N.frontZ && p.z < N.backZ && Math.abs(prev.x) <= N.halfW - R + 1e-6 && Math.abs(p.x) > N.halfW - R) {
      const s = Math.sign(p.x), sp = Math.abs(v.x);
      p.x = s * (N.halfW - R);
      v.x = -v.x * GIVE.normal; v.y *= GIVE.tangent; v.z *= GIVE.tangent;
      rolling = false;
      hit('side', sp);
    }
    // back net
    if (p.y < N.height && Math.abs(p.x) < N.halfW && prev.z <= N.backZ - R + 1e-6 && p.z > N.backZ - R) {
      const sp = Math.abs(v.z);
      p.z = N.backZ - R;
      v.z = -v.z * GIVE.normal; v.x *= GIVE.tangent; v.y *= GIVE.tangent;
      rolling = false;
      hit('back', sp);
    }
    // roof over the batting half
    if (p.z > N.roofFrom && p.z < N.backZ && Math.abs(p.x) < N.halfW && prev.y <= N.height - R + 1e-6 && p.y > N.height - R) {
      const sp = Math.abs(v.y);
      p.y = N.height - R;
      v.y = -v.y * GIVE.normal; v.x *= GIVE.tangent; v.z *= GIVE.tangent;
      hit('roof', sp);
    }
    // ground
    if (!rolling && p.y <= R && v.y < 0) {
      p.y = R;
      v.y = -v.y * 0.36; v.x *= 0.8; v.z *= 0.8;
      if (v.y < 1.0) { v.y = 0; rolling = true; }
    }
    if (rolling && Math.hypot(v.x, v.z) < 0.15) { path.push(t, { ...p }, { x: 0, y: 0, z: 0 }); break; }
    path.push(t, { ...p }, { ...v });
  }
  return { path, hits, stopT: path.duration };
}

// ------------------------------------------------------------------ "what would it have been?"
const ZONES = [
  [-150, 'fine leg', 'fine leg'], [-110, 'fine leg', 'fine leg'], [-70, 'square leg', 'deep square leg'], [-35, 'midwicket', 'deep midwicket'],
  [-10, 'mid-on', 'long-on'], [10, 'straight', 'straight'], [35, 'mid-off', 'long-off'], [70, 'cover', 'deep cover'],
  [110, 'point', 'deep point'], [150, 'third man', 'third man'], [181, 'the keeper', 'the keeper'],
];
/** Part of the ground a shot goes to: dir in degrees (0 = straight back past the bowler, + = off side). */
export function zoneOf(dirDeg, deep = false) {
  const a = ((dirDeg + 540) % 360) - 180;
  for (const [hi, near, far] of ZONES) if (a < hi) return deep ? far : near;
  return 'the keeper';
}

/** The standard field a nets shot is played out against (also drawn on the nets field chart). */
export function projectionField(kind) {
  const preset = FIELD_PRESETS[kind === 'spin' ? 'spin' : 'balanced'];
  const kp = keeperPosition(kind);
  return [
    ...preset.positions.map(s => ({ name: s.name, x: s.x, z: s.z, reaction: 0.36, speed: 6.6 })),
    { name: 'the keeper', keeper: true, x: kp.x, z: kp.z, reaction: 0.18, speed: 6.0 },
    { name: 'the bowler', bowler: true, x: 1.3, z: -4.8, reaction: 0.45, speed: 6.4 },
  ];
}

/**
 * Play a shot out on an open field with average fielders (the match's interception rules): boundary,
 * catch, a diving chance, or runs while the ball comes back. p0/v0 = contact point and launch velocity.
 * Returns { kind: 'six'|'four'|'caught'|'chance'|'runs'|'dot', runs, where, to } (where: words for the HUD,
 * to: where the ball got to on the field — over the rope, into the fielder's hands, or where it was stopped).
 */
export function projectShot(p0, v0, kind = 'pace') {
  const bat = simulateBattedBall(p0, v0, { startT: 0 });
  const path = bat.path, fb = bat.firstBounceT;
  const field = projectionField(kind);
  // For each fielder: the first point they can get to (maybe with a dive) and the first catch they can
  // take cleanly by waiting for it. (Same reach and running rules as the match fielding.)
  let best = null, clean = null;
  for (const f of field) {
    let first = null;
    for (let i = 0; i < path.t.length; i++) {
      const ti = path.t[i];
      if (ti < f.reaction * 0.6) continue;
      const p = path.p[i];
      const air = fb == null || ti < fb;
      if (p.y > (air ? 2.6 : 1.3) || (air && p.y < 0.12)) continue;
      if (air && f.keeper && p.z < PITCH.half - 0.4) continue;   // as in the match: no forward catches by the keeper
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      const hard = clamp(1.45 - Math.hypot(path.v[i].x, path.v[i].z) / 32, 0.45, 1);
      const reach = (air ? 1.0 : 0.75) * (0.8 + 0.2 * hard);
      const avail = ti - f.reaction;
      if (avail < 0) continue;
      const dive = timeToReach(Math.max(0, d - reach), f.speed) > avail;
      if (dive && timeToReach(Math.max(0, d - reach - 1.3 * hard), f.speed) > avail) continue;
      const pt = { f, t: ti, p: { ...p }, air, dive };
      if (!first) first = pt;
      if (!dive) { if (air && (!clean || ti < clean.t)) clean = pt; break; }
      if (!air) break;
    }
    if (first && (!best || first.t < best.t - 1e-6)) best = first;
  }
  const dir = Math.atan2(v0.x, -v0.z) * 180 / Math.PI;
  const bnd = bat.boundary;
  if (clean && !(bnd && clean.t >= bnd.t)) {
    return { kind: 'caught', runs: 0, where: clean.f.keeper ? 'behind' : clean.f.bowler ? 'and bowled' : `at ${clean.f.name}`, to: clean.p };
  }
  if (bnd && (!best || best.t >= bnd.t)) {
    const z = zoneOf(dir, true);
    const where = bnd.runs === 6
      ? (z === 'straight' ? "straight back over the bowler's head" : `over ${z}`)
      : (z === 'straight' ? 'straight past the bowler' : z === 'the keeper' ? 'past the keeper' : `through ${z}`);
    return { kind: bnd.runs === 6 ? 'six' : 'four', runs: bnd.runs, where, to: bnd.p };
  }
  if (best?.air) {
    return { kind: 'chance', runs: 0, where: best.f.keeper ? 'behind the stumps' : best.f.bowler ? 'to the bowler' : `at ${best.f.name}`, to: best.p };
  }
  // Fielded on the ground (or picked up where it stops): the batters run until the ball is back at the stumps.
  let who = best?.f || null, at = best?.p, tField = best?.t;
  if (!best) {
    const sp = path.p[path.p.length - 1];
    for (const f of field) {
      const tt = Math.max(bat.stopT, f.reaction + timeToReach(Math.hypot(sp.x - f.x, sp.z - f.z), f.speed));
      if (tField == null || tt < tField) { tField = tt; who = f; at = sp; }
    }
  }
  const throwDist = Math.min(Math.hypot(at.x, at.z - PITCH.half), Math.hypot(at.x, at.z + PITCH.half));
  const tBack = tField + 0.45 + throwDist / 26;
  // Fitted to the match: the same shots played out with real fielders and running give the same runs.
  const runs = tBack < 2.9 ? 0 : Math.min(3, 1 + Math.floor((tBack - 2.9) / 2.7));
  const dist = Math.hypot(at.x, at.z - 9.2);
  const z = zoneOf(dir, dist > 38);
  // A ball that dies near the pitch is a push-and-run single (the match AI takes these too).
  if (runs) return { kind: 'runs', runs, where: dist < 12 ? 'a quick single' : z === 'straight' ? 'straight down the ground' : z === 'the keeper' ? 'behind the stumps' : `to ${z}`, tBack, to: at };
  const where = !who ? '' : who.bowler ? 'back to the bowler' : who.keeper ? 'to the keeper' : `straight to ${who.name}`;
  return { kind: 'dot', runs: 0, where, tBack, to: at };
}

// ------------------------------------------------------------------ the delivery
export class NetsDeliverySim extends DeliverySim {
  /** o: { striker, bowler, rng, difficulty, realTime } (plus anything DeliverySim takes). */
  constructor(o) {
    const extra = netExtra('extra');
    super({
      ...o, keeper: o.keeper || extra, nonStriker: o.nonStriker || extra, field: [],
      userBatting: true, userBowling: false, assistRunning: true, situation: {}, freeHit: false, ballsFaced: o.ballsFaced ?? 10,
    });
    this.nets = true;
    this.D = { ...this.D, aimAssist: 0 };          // no fielders to aim between
    if (o.realTime) { this.deliveryScale = 1; this.scale = 1; }
    this.control.running = 'none';
    this.projection = null;
    this.perfectUmpire = true;                     // practice feedback: LBW is given exactly as ball tracking has it
  }

  setupActors() {
    super.setupActors([]);
    this.runners = this.runners.filter(r => r.end === 'striker');
    // Nobody keeps wicket: the "keeper's line" is the back net, where unplayed balls finish.
    const k = this.keeper;
    // (Handed over just in front of the net, so the netting catches it.)
    k.x = 0; k.z = NET.backZ - 0.3 + 0.25; k.home = { x: 0, z: k.z };
  }

  emit(type, data = {}) {
    if (type === 'bodyHit') this.bodyHit = true;
    if (type === 'appeal' && data.denied) this.appealDenied = true;
    super.emit(type, data);
  }

  /** A ball the batter didn't hit carries on into the back net. */
  keeperCollect(atK, why) {
    const tRel = clamp(this.t - this.tRelease, 0, this.plan.path.duration);
    const v = this.plan.path.at(tRel).v;
    if (!this.desc) this.desc = why === 'miss' ? 'Beaten' : why === 'leave' ? 'Left alone' : 'No shot';
    this.startBatted({ ...atK, y: Math.max(BALL_R, atK.y) }, v, { alreadyBounced: true });
  }

  startBatted(p, v, { alreadyBounced = false, startT = this.t } = {}) {
    this.phase = 'inplay';
    if (this.inplayStart == null) this.inplayStart = this.t;
    this.ball.state = 'batted';
    this.ball.holder = null;
    this.ball.heldAtEnd = null;
    if (this.contactMade && !this.projection) this.projection = projectShot(p, v, this.kind);
    this.bat = simulateNetBall(p, v, { startT: Math.min(startT, this.t), alreadyBounced });
    for (const h of this.bat.hits) this.schedule(h.t, () => this.emit('netHit', { which: h.which, speed: h.speed, p: h.p }));
    this.schedule(Math.min(this.bat.stopT, this.t + 3) + 0.35, () => this.finish());
  }

  updateInplay() {
    if (this.ball.state === 'batted' && this.bat) {
      const s = this.bat.path.at(this.t);
      this.ball.p = s.p; this.ball.v = s.v;
    }
    this.followThrough();
  }

  finish() {
    if (this.phase === 'dead') return;
    super.finish();
    // Out in the nets: the batter takes guard again rather than walking off.
    const s = this.strikerRunner;
    if (s.action === 'out' || s.action === 'celebrate') this.setAction(s, 'idle');
  }

  result() {
    const r = super.result();
    const res = this.shotResult;
    return {
      ...r,
      nets: true,
      contact: this.contactMade,
      edge: res?.result === 'edge',
      beaten: res?.result === 'miss',
      left: !this.contactMade && this.shot?.shotId === 'leave',
      padHit: this.padHit && !this.bodyHit,
      bodyHit: !!this.bodyHit,
      appealDenied: !!this.appealDenied,
      projection: this.projection,
    };
  }
}
