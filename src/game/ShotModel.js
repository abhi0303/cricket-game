// Batting shots: which shot the input maps to, how well it suits the delivery, and the
// outcome of contact (clean / edge / miss) plus launch speed, direction and elevation.
// Used identically for the human player and the computer batter.

import { battingStyleMods } from './PlayerAttributes.js';
import { clamp } from '../utils/Random.js';

// Batter body position (right-hander) in the delivery frame.
export const BATTER_X = -0.32;
export const STANCE_Z = 9.1;

// ideal: ranges of pitch length L (m from striker's stumps, <0 = full toss), line x and height y at contact
export const SHOTS = {
  defend:        { label: 'Defensive block', foot: 'auto',  dir: 0,    arc: [-45, 60],   power: 0.16, elev: -6, risk: 0.05, bat: 'vertical',   tol: [2.2, 0.26, 0.32], ideal: { L: [2.5, 10.5], x: [-0.3, 0.45], y: [0.05, 1.25] } },
  straightDrive: { label: 'Straight drive',  foot: 'front', dir: 0,    arc: [-22, 22],   power: 0.92, elev: -1, risk: 0.11, bat: 'vertical',   tol: [1.2, 0.2, 0.24],  ideal: { L: [0.6, 5.0],  x: [-0.15, 0.28], y: [0.03, 0.85] } },
  coverDrive:    { label: 'Cover drive',     foot: 'front', dir: 52,   arc: [30, 80],    power: 0.92, elev: -1, risk: 0.15, bat: 'vertical',   tol: [1.2, 0.2, 0.24],  ideal: { L: [0.6, 5.0],  x: [0.15, 0.75], y: [0.03, 0.85] } },
  flick:         { label: 'Flick',           foot: 'front', dir: -38,  arc: [-75, -12],  power: 0.84, elev: 0,  risk: 0.12, bat: 'vertical',   tol: [1.3, 0.2, 0.24],  ideal: { L: [0.8, 6.0],  x: [-0.5, 0.06], y: [0.03, 0.85] } },
  punch:         { label: 'Back-foot punch', foot: 'back',  dir: 25,   arc: [-15, 65],   power: 0.8,  elev: -2, risk: 0.11, bat: 'vertical',   tol: [1.3, 0.2, 0.24],  ideal: { L: [5.5, 9.5],  x: [-0.1, 0.6],  y: [0.45, 1.15] } },
  cut:           { label: 'Cut shot',        foot: 'back',  dir: 95,   arc: [72, 128],   power: 0.88, elev: 0,  risk: 0.14, bat: 'horizontal', tol: [1.3, 0.2, 0.24],  ideal: { L: [7.0, 13],   x: [0.32, 1.05], y: [0.4, 1.3] } },
  pull:          { label: 'Pull shot',       foot: 'back',  dir: -78,  arc: [-115, -40], power: 0.96, elev: 5,  risk: 0.15, bat: 'horizontal', tol: [1.2, 0.2, 0.24],  ideal: { L: [8.0, 13],   x: [-0.45, 0.35], y: [0.75, 1.45] } },
  hook:          { label: 'Hook shot',       foot: 'back',  dir: -118, arc: [-158, -85], power: 0.98, elev: 27, risk: 0.24, bat: 'horizontal', tol: [1.0, 0.2, 0.22],  ideal: { L: [9.5, 14],   x: [-0.5, 0.3],  y: [1.25, 2.1] } },
  lofted:        { label: 'Lofted drive',    foot: 'front', dir: 0,    arc: [-75, 75],   power: 1.14, elev: 33, risk: 0.2, bat: 'vertical',   tol: [0.9, 0.22, 0.22], ideal: { L: [-1, 4.2],   x: [-0.35, 0.6], y: [0.0, 0.95] } },
  sweep:         { label: 'Sweep',           foot: 'front', dir: -95,  arc: [-160, -55], power: 0.74, elev: 3,  risk: 0.17, bat: 'horizontal', tol: [1.2, 0.22, 0.2],  ideal: { L: [1.5, 6.5],  x: [-0.35, 0.45], y: [0.0, 0.62] }, spinOnly: true },
  leave:         { label: 'Leave',           foot: 'back',  dir: 0,    arc: [0, 0],      power: 0,    elev: 0,  risk: 0,    bat: 'none',       tol: [1, 1, 1],         ideal: null },
};

export const SHOT_IDS = Object.keys(SHOTS);

/** Contact z for a shot (front-foot shots meet the ball further down the pitch). */
export function contactZ(shotId, foot, stepOut = false) {
  if (stepOut) return 7.15;
  if (shotId === 'sweep') return 8.2;
  if (shotId === 'leave') return 9.25;
  return foot === 'front' ? 8.3 : 9.2;
}

/**
 * Map a button + stick to a shot. Stick x: + off side / - leg side, stick y: + front foot / - back foot.
 * button: 'defend' | 'ground' | 'lofted' | 'advanced' | 'leave'
 */
export function shotFromInput(button, sx = 0, sy = 0, { bowlerKind = 'pace', lengthHint = null } = {}) {
  const back = sy < -0.35;
  const front = sy > 0.35;
  let id;
  if (button === 'leave') id = 'leave';
  else if (button === 'defend') id = 'defend';
  else if (button === 'ground') {
    if (back) id = sx > 0.3 ? 'cut' : sx < -0.3 ? 'pull' : 'punch';
    else if (front) id = sx > 0.3 ? 'coverDrive' : sx < -0.3 ? 'flick' : 'straightDrive';
    else {
      // Neutral stick: pick the foot from the length the batter reads.
      const shortBall = lengthHint != null && lengthHint > 7.5;
      if (shortBall) id = sx > 0.3 ? 'cut' : sx < -0.3 ? 'pull' : 'punch';
      else id = sx > 0.3 ? 'coverDrive' : sx < -0.3 ? 'flick' : 'straightDrive';
    }
  } else if (button === 'lofted') {
    id = (back || (lengthHint != null && lengthHint > 9 && !front)) && sx < 0.2 ? 'hook' : 'lofted';
  } else if (button === 'advanced') {
    id = 'sweep';
  } else id = 'defend';
  const shot = SHOTS[id];
  let foot = shot.foot;
  if (foot === 'auto') foot = back ? 'back' : front ? 'front' : (lengthHint != null && lengthHint > 6.5 ? 'back' : 'front');
  const stepOut = id === 'lofted' && front && sy > 0.75 && bowlerKind === 'spin';
  return { shotId: id, foot, dirDeg: shotDirection(id, sx, sy), stepOut };
}

/** Aim within the shot's arc using the stick. */
export function shotDirection(shotId, sx = 0, sy = 0) {
  const s = SHOTS[shotId];
  if (!s || shotId === 'leave') return 0;
  if (Math.abs(sx) < 0.2) return s.dir;
  const [a, b] = s.arc;
  if (shotId === 'lofted' || shotId === 'defend') return clamp(sx * 70, a, b);
  // Within the arc, push further with the stick.
  const t = clamp((sx + 1) / 2, 0, 1);
  const lean = a + (b - a) * t;
  return clamp(s.dir * 0.4 + lean * 0.6, a, b);
}

export function timingWindows(batter, ctx = {}) {
  const t = batter.timing / 100;
  const style = battingStyleMods(batter).windowMult;
  const m = (0.78 + 0.45 * t) * style * (ctx.windowMult ?? 1) * (ctx.precision ? 1.18 : 1) * (ctx.power ? 0.86 : 1);
  return { perfect: 0.031 * m, good: 0.07 * m, ok: 0.128 * m };
}

export function classifyTiming(err, w) {
  const a = Math.abs(err);
  if (a <= w.perfect) return 'perfect';
  if (a <= w.good) return 'good';
  if (a <= w.ok) return err < 0 ? 'early' : 'late';
  return err < 0 ? 'missed-early' : 'missed-late';
}

const outside = (v, [lo, hi]) => (v < lo ? lo - v : v > hi ? v - hi : 0);

/** How well a shot suits the ball (0..1) given pitch length L, line x and height y at contact. */
export function suitability(shotId, L, x, y, batter, bowlerKind) {
  const s = SHOTS[shotId];
  if (!s || !s.ideal) return 0;
  // Spinners' good length is fuller than a seamer's: read spin lengths about a metre shorter.
  const len = (L == null ? -0.5 : L) + (bowlerKind === 'spin' ? 1.0 : 0);
  const [tL, tX, tY] = s.tol;
  const dL = outside(len, s.ideal.L) / tL;
  const dX = outside(x, s.ideal.x) / tX;
  const dY = outside(y, s.ideal.y) / tY;
  let v = Math.exp(-0.5 * (dL * dL + dX * dX + dY * dY));
  const tech = batter.technique;
  const frontShots = ['straightDrive', 'coverDrive', 'flick', 'lofted'];
  const backShots = ['punch', 'cut', 'pull', 'hook'];
  if (tech === 'front-foot') v += frontShots.includes(shotId) ? 0.1 : backShots.includes(shotId) ? -0.04 : 0;
  if (tech === 'back-foot') v += backShots.includes(shotId) ? 0.1 : frontShots.includes(shotId) ? -0.04 : 0;
  if (tech === 'sweeper') v += shotId === 'sweep' ? 0.2 : bowlerKind === 'spin' ? 0.05 : 0;
  if (tech === 'balanced') v += 0.03;
  const style = battingStyleMods(batter);
  if (['lofted', 'pull', 'hook'].includes(shotId)) v += style.loftBonus;
  if (shotId === 'defend' && batter.battingStyle === 'defensive') v += 0.1;
  if (s.spinOnly && bowlerKind !== 'spin') v *= 0.55;
  return clamp(v, 0, 1);
}

/**
 * Resolve bat on ball.
 * @param o.shotId, o.dirDeg, o.foot, o.stepOut
 * @param o.timingError  seconds (real time), negative = early
 * @param o.batter, o.bowler, o.plan (delivery plan), o.ball {p, v} at contact
 * @param o.ctx { windowMult, edgeMult, power, precision }
 */
export function resolveShot(o) {
  const { shotId, batter, bowler, plan, ball, rng } = o;
  const ctx = o.ctx || {};
  const shot = SHOTS[shotId];
  const out = { shotId, timing: 'none', quality: 0, suitability: 0, result: 'miss', edgeType: null, launch: null, reason: '' };
  if (shotId === 'leave') { out.result = 'leave'; return out; }

  const w = timingWindows(batter, ctx);
  out.windows = w;
  out.timing = classifyTiming(o.timingError, w);
  out.timingError = o.timingError;
  if (out.timing.startsWith('missed')) { out.reason = out.timing === 'missed-early' ? 'Too early' : 'Too late'; return out; }

  const L = o.stepOut ? (plan.bounceLen == null ? -0.5 : plan.bounceLen - 2.2) : (ball.bouncedBefore ? plan.bounceLen : -0.5);
  const x = ball.p.x;
  const y = ball.p.y;
  const legReach = ['flick', 'pull', 'hook', 'sweep'].includes(shotId) ? 0.7 : 0.5;
  const reachHi = shotId === 'cut' ? 1.4 : shotId === 'defend' ? 0.9 : 1.2;
  if (x < BATTER_X - legReach || x > reachHi || y > 2.3) {
    out.reason = 'Out of reach';
    return out;
  }
  const kind = plan.kind;
  const s = suitability(shotId, L, x, y, batter, kind);
  out.suitability = s;
  const k = (batter.batting * 0.55 + batter.timing * 0.45) / 100;
  const q = { perfect: 1, good: 0.8, early: 0.46, late: 0.46 }[out.timing];
  const c = q * (0.5 + 0.5 * s) * (0.72 + 0.28 * k);
  out.quality = c;

  const style = battingStyleMods(batter);
  const movement = 1 + Math.min(1.6, (plan.deviation || 0) * 3) + ((bowler.bowlMovement + bowler.bowlAccuracy) / 2 - 60) / 110;
  const timingRisk = { perfect: 0.3, good: 0.75, early: 1.6, late: 1.6 }[out.timing];
  const styleRisk = shotId === 'defend' ? style.defendRisk : shotId === 'lofted' && batter.battingStyle === 'defensive' ? 1.3 : style.risk;
  const pBeaten = (0.015 + Math.pow(1 - s, 2) * 0.42) * movement * (ctx.edgeMult ?? 1) * (out.timing === 'perfect' ? 0.6 : 1);
  let pEdge = shot.risk * (0.4 + 1.6 * (1 - s)) * (1.35 - k * 0.7) * timingRisk * styleRisk * movement * (ctx.edgeMult ?? 1);
  if (ctx.power) pEdge *= 1.25;
  if (ctx.precision) pEdge *= 0.85;
  pEdge = clamp(pEdge, 0, 0.85);

  const r = rng.next();
  if (r < pBeaten) { out.reason = 'Beaten'; return out; }

  const ballSpeed = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
  if (r < pBeaten + pEdge) {
    out.result = 'edge';
    out.edgeType = edgeType(shotId, x, plan, rng);
    out.launch = edgeLaunch(out.edgeType, shotId, ballSpeed, rng);
    return out;
  }

  // Clean contact
  out.result = 'clean';
  let speed;
  if (shotId === 'defend') speed = 1.6 + 3.2 * c + ballSpeed * 0.035 + (ctx.power ? 3 : 0); // soft hands; power = push for a single
  else {
    speed = (6 + 29 * shot.power * c) * (0.9 + 0.1 * Math.min(1.3, ballSpeed / 36)) * style.power * (ctx.power ? 1.1 : 1);
    // Even a well-timed shot isn't always out of the middle of the bat.
    // A middled ground shot races away; aerial shots keep their spread so a perfect loft isn't an automatic six.
    const middled = out.timing === 'perfect' && shot.elev < 15;
    speed *= middled ? 1.06 * (0.95 + 0.05 * rng.next()) : shot.elev >= 15 ? 0.84 + 0.16 * rng.next() : 0.87 + 0.13 * Math.pow(rng.next(), 0.6);
  }
  const span = Math.max(1e-3, w.ok);
  const offset = (o.timingError / span) * 24 * (shot.bat === 'horizontal' ? Math.sign(o.dirDeg || shot.dir || 1) : 1);
  let dir = (o.dirDeg ?? shot.dir) + offset + rng.gauss(0, 6 * (1 - c * 0.7));
  let elev = shot.elev + rng.gauss(0, shot.elev > 15 ? 4 : 2.5);
  if (out.timing === 'early') elev += 5;
  if (c < 0.55 && shotId !== 'defend') elev += (0.55 - c) * 22; // mistimed = uppish
  if (ctx.power && shotId !== 'defend') elev += 3;
  if (shotId === 'defend') elev = -6 + rng.gauss(0, 2);
  if (o.stepOut) elev += 3;
  out.launch = { speed, dir, elev };
  return out;
}

function edgeType(shotId, x, plan, rng) {
  if (['pull', 'hook', 'sweep'].includes(shotId)) return rng.chance(0.65) ? 'top' : 'inside';
  if (shotId === 'lofted') return rng.chance(0.55) ? 'top' : rng.chance(0.5) ? 'outside-thick' : 'leading';
  if (shotId === 'flick') return rng.chance(0.5) ? 'leading' : 'inside';
  if (x < -0.05) return rng.chance(0.7) ? 'inside' : 'outside-thick';
  const movingAway = plan.kind === 'pace' ? plan.lineAtCrease > (plan.bounce?.x ?? 0) : plan.bowlingType === 'leg-spin';
  return rng.chance(movingAway ? 0.62 : 0.45) ? 'outside-thin' : rng.chance(0.75) ? 'outside-thick' : 'inside';
}

function edgeLaunch(type, shotId, ballSpeed, rng) {
  switch (type) {
    case 'outside-thin': return { speed: ballSpeed * rng.range(0.5, 0.72), dir: rng.range(150, 172), elev: rng.range(1, 9) };
    case 'outside-thick': return { speed: rng.range(11, 22), dir: rng.range(108, 145), elev: rng.range(-3, 16) };
    case 'inside': return { speed: rng.range(5, 12), dir: rng.range(-178, -145), elev: rng.range(-12, 4) };
    case 'top': return { speed: rng.range(13, 23), dir: (SHOTS[shotId]?.dir || 0) + rng.range(-60, 60), elev: rng.range(52, 74) };
    case 'leading': return { speed: rng.range(9, 17), dir: rng.range(10, 60), elev: rng.range(18, 40) };
    default: return { speed: 8, dir: 0, elev: 0 };
  }
}

export function describeShot(res) {
  if (!res) return '';
  if (res.result === 'leave') return 'Left alone';
  if (res.result === 'miss') return res.reason || 'Played and missed';
  if (res.result === 'edge') {
    return { 'outside-thin': 'Thin outside edge', 'outside-thick': 'Thick outside edge', inside: 'Inside edge', top: 'Top edge', leading: 'Leading edge' }[res.edgeType] || 'Edged';
  }
  return SHOTS[res.shotId].label;
}
