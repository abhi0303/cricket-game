// Skipping ahead: instant AI-vs-AI simulation of part of a match (skip bowling, jump to the final overs
// of a chase, simulate to the result). Plain logic with no DOM, shared by the match controller and the tests.

import { simulateBallHeadless } from './MatchSim.js';
import { aiShouldDeclare, aiEnforceFollowOn } from '../ai/CaptainAI.js';

/** How many overs count as "the final overs" of a chase. */
export function finalOversFor(matchOvers) {
  return matchOvers <= 5 ? 1 : matchOvers <= 10 ? 2 : 3;
}

/**
 * Has a chase reached its finish? That's the last few overs, a target within reach of those overs,
 * or the last two wickets. False outside a chase.
 */
export function chaseFinishReached(engine) {
  if (engine.phase !== 'innings' || engine.isTest) return false;
  const s = engine.situation();
  if (s.target == null) return false;
  const n = finalOversFor(engine.config.overs) * 6;
  return s.ballsLeft <= n || s.need <= n || s.wicketsLeft <= 2;
}

/**
 * Simulate balls (AI on both sides) in the current innings until `stop(engine)` is true, the innings
 * ends, or `maxBalls` have been bowled. Never crosses into the next innings.
 * Returns { balls, inningsOver } where inningsOver means the innings (or match) has finished.
 */
export function simulateBalls(engine, rng, { stop = () => false, maxBalls = Infinity } = {}) {
  const startInnings = engine.state.current;
  let balls = 0;
  const over = () => engine.phase !== 'innings' || engine.state.current !== startInnings;
  while (!over() && balls < maxBalls && !stop(engine)) {
    simulateBallHeadless(engine, rng);
    balls++;
    if (aiShouldDeclare(engine)) engine.declare();   // Tests: the computer captains while simulating
  }
  return { balls, inningsOver: over() };
}

/**
 * Tests: simulate on through innings breaks (the computer decides declarations and the follow-on) until
 * `stop(engine)`, the end of the match, or `maxBalls`. Returns { balls, matchOver }.
 */
export function simulateAcross(engine, rng, { stop = () => false, maxBalls = Infinity } = {}) {
  let balls = 0;
  while (engine.phase !== 'complete' && balls < maxBalls && !stop(engine)) {
    if (engine.phase === 'break') { engine.beginNextInnings({ followOn: aiEnforceFollowOn(engine) }); continue; }
    simulateBallHeadless(engine, rng);
    balls++;
    if (aiShouldDeclare(engine)) engine.declare();
  }
  return { balls, matchOver: engine.phase === 'complete' };
}

/** Tests: a stop condition for "simulate to stumps" (the end of today's play, or of the match). */
export function untilStumps(engine) {
  const day = engine.state.test?.day ?? 0;
  return e => e.phase === 'complete' || (e.state.test?.day ?? 0) > day;
}
