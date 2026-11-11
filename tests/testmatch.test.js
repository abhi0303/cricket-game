import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchEngine, TEST, followOnMargin } from '../src/game/MatchEngine.js';
import { generateCpuTeam, createDefaultUserTeam } from '../src/game/TeamManager.js';
import { ensureBowler, simulateMatchHeadless } from '../src/game/MatchSim.js';
import { simulateAcross, untilStumps } from '../src/game/SkipSim.js';
import { aiShouldDeclare, aiEnforceFollowOn } from '../src/ai/CaptainAI.js';
import { auditInnings } from '../src/game/CricketRules.js';
import { isWideLine } from '../src/game/DeliverySim.js';
import { projectShot } from '../src/game/NetsSim.js';
import { launchVelocity } from '../src/game/BallPhysics.js';
import { RNG } from '../src/utils/Random.js';

globalThis.performance ??= { now: () => Date.now() };

function newTest(seed = 1, config = {}) {
  const rng = new RNG(seed);
  const a = createDefaultUserTeam(rng), b = generateCpuTeam(rng, { difficulty: 'normal' });
  const e = new MatchEngine({ teams: [a, b], config: { format: 'test', difficulty: 'normal', ...config }, toss: { winner: a.id, decision: 'bat' } });
  return { e, rng, a, b };
}

/** Record scripted balls: 'four', 'dot', 'out', 'nb'. */
function play(e, rng, kind, n = 1) {
  let last;
  for (let i = 0; i < n && e.phase === 'innings'; i++) {
    ensureBowler(e, rng);
    const ball = kind === 'four' ? { runs: 4, boundary: 4, runType: 'bat' }
      : kind === 'out' ? { dismissal: { type: 'bowled', batter: e.innings.striker } }
      : kind === 'nb' ? { extra: 'noball' } : { runs: 0 };
    last = e.recordBall(ball);
  }
  return last;
}
const score = (e, rng, fours) => { play(e, rng, 'four', fours); play(e, rng, 'out', 10); };

test('a Test match: no over limit, no free hits, no bowler quota, four innings', () => {
  const { e, rng } = newTest(1);
  assert.equal(e.isTest, true);
  assert.equal(e.innings.maxOvers, null);
  assert.equal(e.innings.freeHits, false);
  assert.equal(e.maxOversPerBowler(), Infinity);
  assert.equal(e.config.days, 5);
  assert.equal(e.config.oversPerDay, 90);
  play(e, rng, 'nb');
  assert.equal(e.innings.freeHit, false, 'no free hit after a no-ball in a Test');
  play(e, rng, 'dot', 300);
  assert.equal(e.phase, 'innings', '50 overs and the first innings goes on');
  assert.equal(e.maxInnings, 4);
});

test('stumps after 90 overs a day; the next day starts fresh and an innings change costs two overs', () => {
  const { e, rng } = newTest(2);
  const r = play(e, rng, 'dot', 539);
  assert.equal(r.stumps, null);
  const end = play(e, rng, 'dot', 1);
  assert.deepEqual(end.stumps, { type: 'stumps', day: 1 });
  assert.equal(e.state.test.day, 2);
  assert.equal(e.state.test.dayBalls, 0);
  assert.deepEqual(e.state.fatigue, {}, 'bowlers rested overnight');
  play(e, rng, 'out', 10);                                  // all out on day 2
  assert.equal(e.phase, 'break');
  assert.equal(e.state.test.dayBalls, 10 + TEST.changeoverBalls, 'the ten balls bowled today plus the ten-minute changeover');
});

test('follow-on: 200 behind in a five-day Test; then an innings defeat', () => {
  const { e, rng, a, b } = newTest(3);
  assert.equal(followOnMargin(5), 200);
  score(e, rng, 100);                                       // A 400
  e.beginNextInnings();
  score(e, rng, 37);                                        // B 148: 252 behind
  assert.equal(e.phase, 'break');
  assert.deepEqual(e.state.test.followOnOption, { team: a.id, lead: 252 });
  e.beginNextInnings({ followOn: true });
  assert.equal(e.innings.battingTeam, b.id, 'B bat again straight away');
  score(e, rng, 50);                                        // B 200: still 52 behind after two innings
  assert.equal(e.phase, 'complete');
  assert.deepEqual([e.state.result.winner, e.state.result.type, e.state.result.margin], [a.id, 'innings', 52]);
  assert.match(e.state.result.text, /won by an innings and 52 runs/);
  for (const inn of e.state.innings) assert.ok(auditInnings(inn).runsMatch);
});

test('no follow-on: the side ahead bats again and sets a target; a chase can be won, lost or tied', () => {
  const chase = (fours, outs) => {
    const { e, rng, a, b } = newTest(4);
    score(e, rng, 75);                                      // A 300
    e.beginNextInnings();
    score(e, rng, 50);                                      // B 200: 100 behind (no follow-on)
    assert.equal(e.state.test.followOnOption, null);
    e.beginNextInnings();
    assert.equal(e.innings.battingTeam, a.id);
    score(e, rng, 50);                                      // A 200: lead 300
    e.beginNextInnings();
    assert.equal(e.innings.battingTeam, b.id);
    assert.equal(e.innings.target, 301);
    play(e, rng, 'four', fours);
    play(e, rng, 'out', outs);
    return { e, a, b };
  };
  const win = chase(76, 3);
  assert.deepEqual([win.e.state.result.winner, win.e.state.result.type, win.e.state.result.margin], [win.b.id, 'wickets', 10]);
  const loss = chase(50, 10);
  assert.deepEqual([loss.e.state.result.winner, loss.e.state.result.type, loss.e.state.result.margin], [loss.a.id, 'runs', 100]);
  const { e, rng, a } = newTest(5);
  score(e, rng, 75); e.beginNextInnings(); score(e, rng, 50); e.beginNextInnings(); score(e, rng, 50); e.beginNextInnings();
  ensureBowler(e, rng);
  for (let i = 0; i < 300; i++) { ensureBowler(e, rng); e.recordBall({ runs: 1, runType: 'bat' }); }
  play(e, rng, 'out', 10);
  assert.equal(e.state.result.type, 'tie', 'all out with the scores level');
  assert.notEqual(a, null);
});

test('declarations: any of the first three innings, never the fourth', () => {
  const { e, rng } = newTest(6);
  play(e, rng, 'four', 30);
  const r = e.declare();
  assert.equal(r.inningsComplete, true);
  assert.equal(e.state.innings[0].endReason, 'declared');
  assert.equal(e.phase, 'break');
  e.beginNextInnings(); score(e, rng, 10); e.beginNextInnings(); score(e, rng, 10); e.beginNextInnings();
  assert.throws(() => e.declare(), /fourth innings/);
});

test('time runs out after five days: a draw', () => {
  const { e, rng } = newTest(7);
  let stumps = 0;
  for (let i = 0; i < 5 * 540 + 10 && e.phase === 'innings'; i++) { const r = play(e, rng, 'dot'); if (r.stumps) stumps++; }
  assert.equal(stumps, 5);
  assert.equal(e.phase, 'complete');
  assert.equal(e.state.result.type, 'draw');
  assert.equal(e.state.result.text, 'Match drawn');
});

test('the new ball after 80 overs', () => {
  const { e, rng } = newTest(8);
  let taken = null;
  for (let i = 0; i < 481 && !taken; i++) { const r = play(e, rng, 'dot'); taken = r.events.find(x => x.type === 'newBall'); }
  assert.ok(taken, 'taken as soon as it is due');
  assert.equal(taken.over, 80);
  assert.equal(e.innings.ballStart, 480);
  assert.ok(e.situation().ballAge < 0.5);
});

test('free hits can be switched off in limited-overs matches', () => {
  const make = freeHit => {
    const rng = new RNG(9);
    const a = createDefaultUserTeam(rng), b = generateCpuTeam(rng, { difficulty: 'normal' });
    const e = new MatchEngine({ teams: [a, b], config: { overs: 5, freeHit }, toss: { winner: a.id, decision: 'bat' } });
    ensureBowler(e, rng);
    e.recordBall({ extra: 'noball' });
    return e;
  };
  assert.equal(make(true).innings.freeHit, true);
  assert.equal(make(false).innings.freeHit, false);
  assert.equal(make(undefined).innings.freeHit, true, 'on by default');
});

test('Test umpires give the batter more room before calling a wide', () => {
  assert.equal(isWideLine({ x: 1.0, y: 0.5 }), true, 'wide in a one-day game');
  assert.equal(isWideLine({ x: 1.0, y: 0.5 }, 0, true), false, 'not in a Test');
  assert.equal(isWideLine({ x: -0.7, y: 0.5 }), true);
  assert.equal(isWideLine({ x: -0.7, y: 0.5 }, 0, true), false);
  assert.equal(isWideLine({ x: 1.3, y: 0.5 }, 0, true), true, 'clearly out of reach is still wide');
});

test('the computer captain declares when the lead is out of reach, and enforces a big follow-on', () => {
  const { e, rng } = newTest(10);
  score(e, rng, 125);                                       // A 500
  e.beginNextInnings();
  score(e, rng, 50);                                        // B 200: 300 behind
  assert.equal(aiEnforceFollowOn(e), true);
  e.beginNextInnings();                                     // A bat again anyway
  play(e, rng, 'four', 30);                                 // lead 420 at the end of an over
  while (e.innings.legalBalls % 6) play(e, rng, 'dot');
  assert.equal(aiShouldDeclare(e), false, 'plenty of time left: bat on');
  e.state.test.day = 5; e.state.test.dayBalls = 0;          // last day: 90 overs left
  assert.equal(aiShouldDeclare(e), true, 'a lead of 420 with 88 overs left: declare');
});

test('a Test played out by the computer looks like Test cricket', () => {
  let runs = 0, balls = 0, wkts = 0, days = 0;
  for (const seed of [21, 22]) {
    const { e, rng } = newTest(seed);
    e.state.teams.forEach(t => { t.isUser = false; });
    simulateMatchHeadless(e, rng, { maxBalls: 6000 });
    assert.equal(e.phase, 'complete');
    for (const inn of e.state.innings) { runs += inn.runs; balls += inn.legalBalls; wkts += inn.wickets; assert.ok(auditInnings(inn).runsMatch); }
    days += e.state.test.day;
  }
  const rpo = runs / balls * 6, perWkt = balls / Math.max(1, wkts);
  assert.ok(rpo > 2.4 && rpo < 4.3, `run rate ${rpo.toFixed(2)}`);
  assert.ok(perWkt > 40 && perWkt < 110, `a wicket every ${perWkt.toFixed(0)} balls`);
  assert.ok(days / 2 >= 3, 'into the third day or later');
});

test('skipping ahead in a Test: to stumps, and across innings to the result', () => {
  const { e, rng } = newTest(23);
  e.state.teams.forEach(t => { t.isUser = false; });
  const r = simulateAcross(e, rng, { stop: untilStumps(e) });
  assert.ok(r.balls >= 520, `a full day (${r.balls} balls)`);
  assert.equal(e.state.test.day, 2);
  simulateAcross(e, rng);
  assert.equal(e.phase, 'complete');
});

test('a keeper standing up cannot catch a ball pushed forward past the batter', () => {
  const push = projectShot({ x: 0, y: 0.45, z: 9.5 }, launchVelocity(4.6, 5, -6), 'spin');
  assert.notEqual(push.kind === 'caught' && push.where === 'behind', true, JSON.stringify(push));
});
