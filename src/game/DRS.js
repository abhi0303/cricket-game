// LBW decisions and the Decision Review System: ball tracking (pitching, impact, wickets with the
// umpire's-call margins), the on-field umpire's judgement (good, but not perfect), the third umpire's
// verdict on a review, and when the computer reviews. Pure functions, unit tested.

import { PITCH, BALL_R } from './BallPhysics.js';

// The wicket zone: the outside edges of the stumps, up to the top of the bails.
export const ZONE = { half: PITCH.stumpHalfWidth, height: PITCH.stumpHeight + 0.012 };
export const REVIEWS_PER_INNINGS = 3;
// How well the on-field umpire judges an LBW by eye (m, 1 sd) and how much of the ball must look to be
// hitting (fraction of a ball's radius beyond the zone edge he still gives).
export const UMPIRE_EYE = { pitch: 0.025, impact: 0.03, line: 0.045, height: 0.06, margin: 0.6 };

/**
 * Ball tracking for an LBW appeal.
 * @param plan       the delivery plan (its unobstructed path is the projection past the pad)
 * @param impact     {x, y, z} where the ball hit the pad
 * @param shotOffered whether the batter played a shot
 * Returns { pitching, impact, wickets, waived, ... } with:
 *   pitching: 'inLine' | 'outsideOff' | 'outsideLeg' | 'fullToss'
 *   impact:   'inLine' | 'umpiresCall' | 'outside'   (waived: outside off with no shot offered, which doesn't save the batter)
 *   wickets:  'hitting' | 'umpiresCall' | 'missing'  (hitting: at least half the ball inside the zone)
 */
export function lbwTrack({ plan, impact, shotOffered }) {
  const Z = ZONE.half, H = ZONE.height, R = BALL_R;
  const bounce = plan.bounce ? { x: plan.bounce.x, z: plan.bounce.z, t: plan.bounce.t } : null;
  let pitching = 'fullToss';
  if (bounce) pitching = bounce.x + R < -Z ? 'outsideLeg' : bounce.x - R > Z ? 'outsideOff' : 'inLine';
  const ax = Math.abs(impact.x);
  const imp = ax <= Z ? 'inLine' : ax <= Z + R ? 'umpiresCall' : 'outside';
  const impactSide = impact.x > 0 ? 'off' : 'leg';
  const waived = imp !== 'inLine' && impactSide === 'off' && !shotOffered;
  const at = plan.atStumps ? { ...plan.atStumps } : null;
  let wickets = 'missing';
  if (at && at.y > 0) {
    if (Math.abs(at.x) <= Z && at.y <= H) wickets = 'hitting';
    else if (Math.abs(at.x) <= Z + R && at.y <= H + R) wickets = 'umpiresCall';
  }
  return { pitching, impact: imp, impactSide, waived, wickets, bounce, impactPoint: { ...impact }, at, shotOffered: !!shotOffered };
}

/**
 * The third umpire's verdict. Clear evidence overturns the on-field call; anything within the
 * umpire's-call margins stays with it (and the reviewing side keeps its review).
 * Returns { out, umpiresCall, overturned, retained, reason }.
 */
export function reviewVerdict(track, onField) {
  const onOut = onField === 'out';
  const done = (out, umpiresCall, reason) => ({ out, umpiresCall, overturned: out !== onOut, retained: umpiresCall || out !== onOut, reason });
  if (track.pitching === 'outsideLeg') return done(false, false, 'Pitched outside leg');
  if (track.impact === 'outside' && !track.waived) return done(false, false, 'Impact outside the line');
  if (track.wickets === 'missing') return done(false, false, 'Missing the stumps');
  if ((track.impact === 'inLine' || track.waived) && track.wickets === 'hitting') return done(true, false, 'Hitting the stumps');
  return done(onOut, true, "Umpire's call");
}

/**
 * The on-field umpire: judges where the ball pitched, hit the pad and was going with a little error, and
 * gives the batter the benefit of the doubt. Most calls are right; close ones sometimes aren't.
 */
export function umpireSaysOut(track, rng, { perfect = false } = {}) {
  if (perfect) return reviewVerdict(track, 'notout').out;
  const Z = ZONE.half, H = ZONE.height, R = BALL_R;
  const E = UMPIRE_EYE;
  if (track.bounce && track.bounce.x + rng.gauss(0, E.pitch) + R < -Z) return false;
  const ix = track.impactPoint.x + rng.gauss(0, E.impact);
  const impactOk = Math.abs(ix) <= Z + R * E.margin || (ix > 0 && !track.shotOffered);
  if (!impactOk || !track.at) return false;
  const ax = track.at.x + rng.gauss(0, E.line), ay = track.at.y + rng.gauss(0, E.height);
  return Math.abs(ax) <= Z + R * E.margin && ay <= H + R * E.margin;
}

/** Close enough that the fielding side goes up for it. */
export function worthAnAppeal(track) {
  const at = track.at;
  return Math.abs(track.impactPoint.x) < 0.32 && !!at && Math.abs(at.x) < 0.38 && at.y < 1.0;
}

/**
 * Does the computer review? It has a fair idea when a decision was wrong, sometimes gambles on a close
 * one, and is more careful with its last review.
 */
export function aiWantsReview(lbw, reviewsLeft, rng) {
  if (reviewsLeft <= 0) return false;
  const v = reviewVerdict(lbw.track, lbw.onField);
  let p = v.overturned ? 0.72 : v.umpiresCall ? 0.28 : 0.06;
  if (reviewsLeft === 1) p *= 0.6;
  return rng.chance(p);
}

/** The ball record after a review: out on review (no runs: the ball was dead) or reprieved. */
export function applyVerdict(result, verdict, strikerId) {
  if (!verdict.overturned) return result;
  if (verdict.out) {
    return { ...result, runs: 0, boundary: 0, runType: 'bat', dismissal: { type: 'lbw', batter: strikerId, fielder: null, end: 'striker' }, desc: 'LBW! Given out on review', highlight: 'wicket' };
  }
  return { ...result, runs: 0, boundary: 0, runType: 'bat', dismissal: null, desc: 'Not out on review', highlight: null };
}

export const VERDICT_TEXT = {
  pitching: { inLine: 'IN LINE', outsideOff: 'OUTSIDE OFF', outsideLeg: 'OUTSIDE LEG', fullToss: 'FULL TOSS' },
  impact: { inLine: 'IN LINE', umpiresCall: "UMPIRE'S CALL", outside: 'OUTSIDE' },
  wickets: { hitting: 'HITTING', umpiresCall: "UMPIRE'S CALL", missing: 'MISSING' },
};

/** Colour class for a tracking verdict: good for the bowler (red for the batter), umpire's call, or not out. */
export function verdictTone(kind, value, track) {
  if (value === 'umpiresCall') return 'call';
  if (kind === 'pitching') return value === 'outsideLeg' ? 'safe' : 'out';
  if (kind === 'impact') return value === 'inLine' || track?.waived ? 'out' : 'safe';
  return value === 'hitting' ? 'out' : 'safe';
}
