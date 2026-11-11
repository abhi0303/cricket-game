// Test-match captaincy for the computer: when to declare, and whether to enforce the follow-on.
// Plain rules on the score and the time left, so they can be tested and reasoned about.

import { BALLS_PER_OVER } from '../game/CricketRules.js';
import { TEST } from '../game/MatchEngine.js';

/** Overs left in the match once the current innings closes (the changeover takes two). */
export function oversLeftAfterInnings(engine) {
  const b = engine.matchBallsLeft();
  return b == null ? Infinity : Math.max(0, (b - TEST.changeoverBalls) / BALLS_PER_OVER);
}

/**
 * Should the batting side declare now? Checked at the end of an over.
 *  1st innings: a huge total with time to bowl twice.
 *  2nd innings: well ahead and short of time.
 *  3rd innings: the lead is out of reach in the overs left, with enough of them to bowl the other side out.
 */
export function aiShouldDeclare(engine) {
  if (!engine.isTest || engine.phase !== 'innings') return false;
  const inn = engine.innings, idx = engine.inningsIndex;
  if (idx > 2 || inn.legalBalls === 0 || inn.legalBalls % BALLS_PER_OVER !== 0 || inn.wickets >= 9) return false;
  const lead = engine.teamTotal(inn.battingTeam) - engine.teamTotal(inn.bowlingTeam);
  const R = oversLeftAfterInnings(engine);
  if (idx === 0) return inn.runs >= 600 && R >= 220;
  if (idx === 1) return lead >= 250 && R <= 200;
  if (lead < 180) return false;
  if (R > 140) return lead >= 470;
  return lead / Math.max(1, R) >= 3.6;
}

/** Enforce the follow-on? A big lead, or short of time to bat again. */
export function aiEnforceFollowOn(engine) {
  const opt = engine.state.test?.followOnOption;
  if (!opt) return false;
  return opt.lead >= 260 || oversLeftAfterInnings(engine) < 170;
}
