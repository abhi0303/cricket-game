// Computer batting: read the delivery (imperfectly), pick a shot that suits it and the
// match situation, pick a gap, and decide when to run. Simple, readable rules.

import { SHOTS, suitability, contactZ, BATTER_X } from '../game/ShotModel.js';
import { battingStyleMods } from '../game/PlayerAttributes.js';
import { PITCH, fieldAngle } from '../game/BallPhysics.js';
import { clamp } from '../utils/Random.js';
import { diff } from '../game/Difficulty.js';

// Rough expected runs and dismissal chance for each shot against an ideal ball.
const EXP_RUNS = { defend: 0.12, straightDrive: 1.6, coverDrive: 1.7, flick: 1.35, punch: 1.15, cut: 1.5, pull: 1.85, hook: 2.3, lofted: 3.0, sweep: 1.25 };
const P_OUT = { defend: 0.008, straightDrive: 0.03, coverDrive: 0.04, flick: 0.03, punch: 0.025, cut: 0.04, pull: 0.05, hook: 0.1, lofted: 0.16, sweep: 0.06 };
const CANDIDATES = ['defend', 'straightDrive', 'coverDrive', 'flick', 'punch', 'cut', 'pull', 'hook', 'lofted', 'sweep'];

// Test cricket: batters are far more patient, and a wicket is worth much more than a few runs.
// (Computer batters only: they also judge timing a little better and are beaten / edge a little less.)
export const TEST_BATTING = { intentScale: 0.5, intentShift: -0.04, wicketValue: 2.2, timing: 0.9, edgeMult: 0.85 };

/** Test-match intent: patient, picking up only when chasing quickly or pushing for a declaration. */
function testIntent(batter, s, ballsFaced) {
  let a = battingStyleMods(batter).aiAggression * TEST_BATTING.intentScale + TEST_BATTING.intentShift;
  if (s.target != null) {
    const rrr = s.rrr ?? 0;
    if (rrr > 5) a += 0.3; else if (rrr > 4) a += 0.15; else if (rrr > 3.2) a += 0.05;
  } else if (s.innings === 3 && s.lead > 200) a += 0.15;    // quick runs before a declaration
  if (s.wicketsLeft != null && s.wicketsLeft <= 2) a -= 0.08;
  if (ballsFaced < 12) a -= 0.06;                           // playing themselves in
  if (s.phaseOfInnings === 'early') a -= 0.03;              // the new ball
  return clamp(a, 0, 1);
}

/** How aggressive the batter should be right now (0..1). */
export function batterIntent(batter, situation = {}, ballsFaced = 0) {
  if (situation?.format === 'test') return testIntent(batter, situation, ballsFaced);
  let a = battingStyleMods(batter).aiAggression;
  const s = situation;
  if (s.phaseOfInnings === 'death') a += 0.22;
  if (s.phaseOfInnings === 'early') a -= 0.04;
  if (s.target != null && s.ballsLeft > 0) {
    const rrr = s.rrr ?? 0;
    if (rrr > 12) a += 0.35; else if (rrr > 9) a += 0.2; else if (rrr < 5) a -= 0.15;
  } else if (s.crr != null && s.legalBalls > 12 && s.crr < 6) a += 0.06;
  if (s.wicketsLeft != null && s.wicketsLeft <= 2) a -= 0.18;
  if (ballsFaced < 4) a -= 0.12;
  if (s.freeHit) a += 0.5;
  return clamp(a, 0, 1);
}

/**
 * Pick a shot for the delivery.
 * @returns {{shotId, foot, dirDeg, stepOut, power, precision}}
 */
export function chooseShot({ batter, plan, situation, fielders = [], ballsFaced = 0, rng, difficulty = 'normal', isCpuVsUser = true }) {
  const D = diff(difficulty);
  const noise = (isCpuVsUser ? D.cpuReadNoise : 1) * (1.25 - batter.timing / 100);
  const intent = batterIntent(batter, situation, ballsFaced);

  // What the batter thinks the ball will do.
  const readL = plan.bounceLen == null ? -0.5 : plan.bounceLen + rng.gauss(0, 0.9 * noise);
  const zFront = contactZ('straightDrive', 'front');
  const zBack = contactZ('pull', 'back');
  const atF = plan.path.at(plan.path.timeAtZ(zFront) ?? 0).p;
  const atB = plan.path.at(plan.path.timeAtZ(zBack) ?? 0).p;
  const rx = (x) => x + rng.gauss(0, 0.09 * noise);
  const ry = (y) => y + rng.gauss(0, 0.1 * noise);
  const front = { x: rx(atF.x), y: ry(atF.y) };
  const back = { x: rx(atB.x), y: ry(atB.y) };
  const thinksHitting = Math.abs(rx(plan.atStumps?.x ?? 1)) < 0.2 && (plan.atStumps?.y ?? 1) < 0.85;

  // Value of a wicket in runs: high for cautious batters, low when slogging.
  const W = (26 * Math.pow(1 - intent, 1.5) + 3) * (situation?.format === 'test' ? TEST_BATTING.wicketValue : 1);
  let best = null;
  for (const id of CANDIDATES) {
    const sh = SHOTS[id];
    if (id === 'sweep' && plan.kind !== 'spin' && intent < 0.85) continue;
    if (id === 'hook' && intent < 0.35) continue;
    const at = sh.foot === 'back' ? back : front;
    const s = suitability(id, readL, at.x, at.y, batter, plan.kind);
    let ev = s * EXP_RUNS[id] * (0.7 + intent * 0.6) - W * P_OUT[id] * (1 + 3 * (1 - s));
    if (id === 'defend') ev += thinksHitting ? 0.25 : 0;
    ev += rng.gauss(0, 0.18);
    if (!best || ev > best.score) best = { id, score: ev, s };
  }
  // Against spin, consider dancing down the track to make the ball a half-volley.
  if (plan.kind === 'spin' && intent > 0.35) {
    const s = suitability('lofted', readL - 2.2, front.x, front.y, batter, plan.kind);
    const ev = s * EXP_RUNS.lofted * (0.7 + intent * 0.6) - W * 0.19 * (1 + 3 * (1 - s)) + rng.gauss(0, 0.18);
    if (ev > best.score) best = { id: 'lofted', score: ev, s, stepOut: true };
  }

  // Leave balls outside off that aren't hitting (defensive batters more often).
  const leaveScore = !thinksHitting && front.x > 0.32 ? 0.05 + (front.x - 0.32) * 1.5 - intent * 0.6 : -99;
  if (leaveScore > best.score) return { shotId: 'leave', foot: 'back', dirDeg: 0, stepOut: false, power: false, precision: false };

  const shotId = best.id;
  const sh = SHOTS[shotId];
  let foot = sh.foot === 'auto' ? (readL > 6.5 ? 'back' : 'front') : sh.foot;
  const stepOut = !!best.stepOut;
  return {
    shotId,
    foot,
    dirDeg: pickGap(shotId, fielders, rng),
    stepOut,
    power: intent > 0.7 && (shotId === 'lofted' || shotId === 'pull' || shotId === 'hook') && rng.chance(0.5),
    precision: intent < 0.3 && rng.chance(0.6),
  };
}

/** Nudge a chosen direction toward the nearest gap, at most `maxDeg` degrees. */
export function assistAim(shotId, dirDeg, fielders, maxDeg) {
  const sh = SHOTS[shotId];
  if (!sh || !maxDeg || shotId === 'leave' || shotId === 'defend') return dirDeg;
  const lofted = shotId === 'lofted' || shotId === 'hook';
  const angles = fielders.filter(f => { const d = Math.hypot(f.x, f.z - 9.2); return lofted ? d > 35 : d < 45; }).map(f => fieldAngle(f.x, f.z));
  let best = dirDeg, bestScore = -Infinity;
  for (let a = dirDeg - maxDeg; a <= dirDeg + maxDeg; a += 2) {
    let gap = 60;
    for (const fa of angles) gap = Math.min(gap, Math.abs(((a - fa + 540) % 360) - 180));
    const score = gap - Math.abs(a - dirDeg) * 0.3;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

/** Aim into the biggest gap within the shot's arc. */
export function pickGap(shotId, fielders, rng) {
  const sh = SHOTS[shotId];
  if (!sh || shotId === 'leave') return 0;
  if (shotId === 'defend') return rng.range(-35, 55);
  const [a, b] = sh.arc;
  const lofted = shotId === 'lofted' || shotId === 'hook';
  const relevant = fielders.filter(f => {
    const d = Math.hypot(f.x, f.z - 9.2);
    return lofted ? d > 35 : d < 45;
  }).map(f => fieldAngle(f.x, f.z));
  let best = sh.dir, bestScore = -Infinity;
  for (let ang = a; ang <= b; ang += 4) {
    let gap = 60;
    for (const fa of relevant) gap = Math.min(gap, Math.abs(((ang - fa + 540) % 360) - 180));
    const score = gap - Math.abs(ang - sh.dir) * 0.25 + rng.gauss(0, 4);
    if (score > bestScore) { bestScore = score; best = ang; }
  }
  return best;
}

/** Timing error (real seconds) for the computer batter. Negative = early. */
export function sampleTimingError({ batter, plan, rng, difficulty = 'normal', isCpuVsUser = true }) {
  const D = diff(difficulty);
  const sigma = 0.088 * (1.3 - batter.timing / 100) * (isCpuVsUser ? D.cpuBatSigma : 1) * (1.12 - batter.batting / 400);
  let bias = 0;
  // A slower ball disguised in the same action gets the batter early.
  const drop = (plan.stockKph ?? plan.speedKph) - plan.speedKph;
  if (drop > 10) bias -= 0.05 * (1.15 - batter.timing / 100) * Math.min(1, drop / 25);
  if (plan.lengthId === 'yorker') bias += 0.02;
  if (plan.typeId === 'variation') bias += 0.01;
  // Less time between pitching and the bat, and more pace, make timing harder.
  const r = plan.timing?.reaction;
  let s = sigma;
  if (r != null) s *= 1 + clamp((0.16 - r) / 0.16, 0, 1) * 0.3;
  s *= 0.93 + 0.12 * clamp((plan.speedKph - 110) / 40, 0, 1);
  return rng.gauss(bias, s);
}

/**
 * Running decision for both batters.
 * snap = { now, runState, runners:[{z,end,target,speed}], ball:{state, interceptT, interceptPos, catchable, boundaryT, holderPos, heldAtEnd},
 *          throwSpeed, aggression }
 * Returns 'run' | 'stay' | 'back'.
 */
export function runDecision(snap) {
  const { runners, ball } = snap;
  // judgement: per-ball misjudgement of the run (seconds), so batters occasionally get it wrong
  const margin = 0.22 - 0.2 * snap.aggression - (snap.judgement || 0);
  if (ball.heldAtEnd) return snap.runState === 'running' ? 'stay' : 'stay';
  const endZ = { striker: PITCH.half, nonStriker: -PITCH.half };

  const ballArrival = (end) => {
    let from, t0;
    if (ball.state === 'batted') {
      if (ball.boundaryT != null && (ball.interceptT == null || ball.boundaryT < ball.interceptT)) return Infinity;
      if (ball.interceptT == null) return Infinity;
      if (ball.catchable) return -1; // wait for the catch
      from = ball.interceptPos; t0 = ball.interceptT - snap.now + 0.3;
    } else if (ball.state === 'held' || ball.state === 'pickup') {
      from = ball.holderPos; t0 = 0.3;
    } else if (ball.state === 'thrown') {
      return ball.throwEnd === end ? Math.max(0, ball.throwArrive - snap.now) : Math.max(0, ball.throwArrive - snap.now) + 1.2;
    } else return -1;
    const d = Math.hypot(from.x, from.z - endZ[end]);
    return t0 + 0.28 + d / snap.throwSpeed + 0.2;
  };
  const arrive = (r, end) => {
    const safeZ = end === 'striker' ? 8.84 - 0.85 : -8.84 + 0.85;
    const v = r.target ? (r.v || 0) : 0;
    const accel = (r.speed - v) * (r.speed - v) / (2 * 7 * r.speed); // time lost getting up to speed
    return Math.abs(safeZ - r.z) / r.speed + accel + (r.target ? 0 : 0.32);
  };

  if (snap.runState === 'idle') {
    // Would a new run be safe at both ends?
    let worst = Infinity;
    for (const r of runners) {
      const to = r.end === 'striker' ? 'nonStriker' : 'striker';
      const tb = ballArrival(to);
      if (tb < 0) return 'stay';
      worst = Math.min(worst, tb - arrive({ ...r, target: null }, to));
    }
    return worst > margin ? 'run' : 'stay';
  }
  if (snap.runState === 'running') {
    let worst = Infinity;
    let canTurn = true;
    for (const r of runners) {
      const tb = ballArrival(r.target);
      if (tb < 0) continue;
      worst = Math.min(worst, tb - arrive(r, r.target));
      const prog = r.target === 'nonStriker' ? (8.84 - r.z) / 17.68 : (r.z + 8.84) / 17.68;
      if (prog > 0.5) canTurn = false;
    }
    if (worst < -0.15 && canTurn) return 'back';
    // Commit to another run after this one?
    if (snap.queueAllowed) {
      let next = Infinity;
      for (const r of runners) {
        const back = r.target === 'striker' ? 'nonStriker' : 'striker';
        const tb = ballArrival(back);
        if (tb < 0) return 'stay';
        next = Math.min(next, tb - (arrive(r, r.target) + 0.35 + 16.8 / r.speed));
      }
      if (next > margin + 0.65) return 'run';
    }
  }
  return 'stay';
}

export { BATTER_X };
