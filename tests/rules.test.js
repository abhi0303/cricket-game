import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInnings, applyBall, setBowler, eligibleBowlers, oversString, auditInnings,
  dismissalAllowed, maxOversPerBowler, requiredRunRate,
} from '../src/game/CricketRules.js';

const order = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11'];
const fresh = (o = {}) => {
  const inn = createInnings({ battingTeam: 'A', bowlingTeam: 'B', battingOrder: order, maxOvers: 2, ...o });
  setBowler(inn, 'x1');
  return inn;
};
const dot = { runs: 0 };

test('six legal balls make an over, change ends and need a new bowler', () => {
  const inn = fresh();
  for (let i = 0; i < 5; i++) applyBall(inn, dot);
  assert.equal(oversString(inn.legalBalls), '0.5');
  assert.equal(inn.striker, 'b1');
  const ev = applyBall(inn, dot);
  assert.ok(ev.some(e => e.type === 'overComplete'));
  assert.equal(oversString(inn.legalBalls), '1.0');
  assert.equal(inn.striker, 'b2', 'strike changes at the end of the over');
  assert.equal(inn.currentBowler, null);
  assert.equal(inn.bowlers.x1.maidens, 1);
  assert.throws(() => applyBall(inn, dot), /No bowler/);
});

test('the same bowler cannot bowl consecutive overs', () => {
  const inn = fresh();
  for (let i = 0; i < 6; i++) applyBall(inn, dot);
  const el = eligibleBowlers(inn, ['x1', 'x2', 'x3'], 20);
  assert.ok(!el.includes('x1'));
  assert.throws(() => setBowler(inn, 'x1', el));
  setBowler(inn, 'x2', el);
  assert.equal(inn.currentBowler, 'x2');
});

test('bowler over limits: 20 overs -> 4 each, 10 -> 2, 5 -> 1', () => {
  assert.equal(maxOversPerBowler(20), 4);
  assert.equal(maxOversPerBowler(10), 2);
  assert.equal(maxOversPerBowler(5), 1);
  const inn = createInnings({ battingTeam: 'A', bowlingTeam: 'B', battingOrder: order, maxOvers: 5 });
  setBowler(inn, 'x1');
  for (let i = 0; i < 6; i++) applyBall(inn, dot);
  setBowler(inn, 'x2');
  for (let i = 0; i < 6; i++) applyBall(inn, dot);
  const el = eligibleBowlers(inn, ['x1', 'x2', 'x3'], 5);
  assert.deepEqual(el, ['x3']);
});

test('odd runs rotate strike, even runs and boundaries do not', () => {
  const inn = fresh();
  applyBall(inn, { runs: 1 });
  assert.equal(inn.striker, 'b2');
  applyBall(inn, { runs: 2 });
  assert.equal(inn.striker, 'b2');
  applyBall(inn, { runs: 4, boundary: 4 });
  assert.equal(inn.striker, 'b2');
  applyBall(inn, { runs: 3 });
  assert.equal(inn.striker, 'b1');
  assert.equal(inn.batters.b2.fours, 1);
  assert.equal(inn.runs, 10);
});

test('a single off the last ball keeps the batter on strike for the next over', () => {
  const inn = fresh();
  for (let i = 0; i < 5; i++) applyBall(inn, dot);
  applyBall(inn, { runs: 1 });
  assert.equal(inn.striker, 'b1');
});

test('wides and no-balls are not legal balls and add a penalty run', () => {
  const inn = fresh();
  applyBall(inn, { extra: 'wide' });
  applyBall(inn, { extra: 'noball', runs: 4, boundary: 4 });
  assert.equal(inn.legalBalls, 0);
  assert.equal(inn.runs, 6);
  assert.equal(inn.extras.wides, 1);
  assert.equal(inn.extras.noballs, 1);
  assert.equal(inn.batters.b1.runs, 4, 'runs off the bat on a no-ball go to the batter');
  assert.equal(inn.batters.b1.balls, 1, 'a no-ball counts as a ball faced, a wide does not');
  assert.equal(inn.bowlers.x1.runs, 6);
  assert.equal(inn.bowlers.x1.balls, 0);
  assert.ok(inn.freeHit, 'a free hit follows a no-ball');
});

test('wide with runs: all runs are wides and strike rotates on odd runs', () => {
  const inn = fresh();
  applyBall(inn, { extra: 'wide', runs: 1 });
  assert.equal(inn.extras.wides, 2);
  assert.equal(inn.striker, 'b2');
  assert.equal(inn.batters.b1.runs, 0);
});

test('byes and leg byes count as extras, not against the bowler', () => {
  const inn = fresh();
  applyBall(inn, { runs: 2, runType: 'bye' });
  applyBall(inn, { runs: 1, runType: 'legbye' });
  assert.equal(inn.extras.byes, 2);
  assert.equal(inn.extras.legbyes, 1);
  assert.equal(inn.bowlers.x1.runs, 0);
  assert.equal(inn.batters.b1.runs, 0);
  assert.equal(inn.runs, 3);
  assert.equal(inn.legalBalls, 2);
});

test('free hit: only a run out can dismiss the batter', () => {
  const inn = fresh();
  applyBall(inn, { extra: 'noball' });
  assert.ok(inn.freeHit);
  const ev = applyBall(inn, { dismissal: { type: 'bowled', batter: 'b1' } });
  assert.ok(ev.some(e => e.type === 'dismissalVoided'));
  assert.equal(inn.wickets, 0);
  assert.ok(!inn.freeHit);
  assert.equal(dismissalAllowed('runout', { freeHit: true }), true);
  assert.equal(dismissalAllowed('caught', { extra: 'noball' }), false);
  assert.equal(dismissalAllowed('stumped', { extra: 'wide' }), true);
  assert.equal(dismissalAllowed('lbw', { extra: 'wide' }), false);
});

test('free hit carries over a wide', () => {
  const inn = fresh();
  applyBall(inn, { extra: 'noball' });
  applyBall(inn, { extra: 'wide' });
  assert.ok(inn.freeHit);
  applyBall(inn, dot);
  assert.ok(!inn.freeHit);
});

test('bowled: next batter comes in on strike, bowler credited', () => {
  const inn = fresh();
  applyBall(inn, { dismissal: { type: 'bowled', batter: 'b1' } });
  assert.equal(inn.wickets, 1);
  assert.equal(inn.striker, 'b3');
  assert.equal(inn.nonStriker, 'b2');
  assert.equal(inn.batters.b1.status, 'out');
  assert.equal(inn.batters.b3.status, 'batting');
  assert.equal(inn.bowlers.x1.wickets, 1);
  assert.equal(inn.fallOfWickets[0].runs, 0);
});

test('caught: no runs count and the new batter takes strike', () => {
  const inn = fresh();
  applyBall(inn, { runs: 1, dismissal: { type: 'caught', batter: 'b1', fielder: 'f1' } });
  assert.equal(inn.runs, 0);
  assert.equal(inn.striker, 'b3');
  assert.equal(inn.batters.b1.out.fielder, 'f1');
});

test('caught off the last ball of the over: new batter at the non-striker end', () => {
  const inn = fresh();
  for (let i = 0; i < 5; i++) applyBall(inn, dot);
  applyBall(inn, { dismissal: { type: 'caught', batter: 'b1' } });
  assert.equal(inn.striker, 'b2');
  assert.equal(inn.nonStriker, 'b3');
});

test('run out at the non-striker end after one completed run', () => {
  const inn = fresh();
  // They complete one run then the striker (b1, now at the non-striker end... ) is run out going for the second.
  // After 1 run b1 is at the far end; going back for 2, b1 runs to the striker's end, b2 to the far end.
  // The wicket is broken at the non-striker's end -> b2 (heading there) is out.
  applyBall(inn, { runs: 1, dismissal: { type: 'runout', batter: 'b2', end: 'nonStriker' } });
  assert.equal(inn.runs, 1);
  assert.equal(inn.batters.b1.runs, 1);
  assert.equal(inn.bowlers.x1.wickets, 0, 'run outs are not credited to the bowler');
  assert.equal(inn.striker, 'b1');
  assert.equal(inn.nonStriker, 'b3');
});

test('run out at the striker end: incoming batter faces', () => {
  const inn = fresh();
  applyBall(inn, { runs: 0, dismissal: { type: 'runout', batter: 'b1', end: 'striker' } });
  assert.equal(inn.striker, 'b3');
  assert.equal(inn.nonStriker, 'b2');
});

test('the non-striker can be run out but not bowled', () => {
  const inn = fresh();
  assert.throws(() => applyBall(inn, { dismissal: { type: 'bowled', batter: 'b2' } }));
});

test('all out after 10 wickets ends the innings', () => {
  const inn = createInnings({ battingTeam: 'A', bowlingTeam: 'B', battingOrder: order, maxOvers: 20 });
  setBowler(inn, 'x1');
  let ev = [];
  for (let w = 0; w < 10; w++) {
    if (!inn.currentBowler) setBowler(inn, w % 2 ? 'x1' : 'x2');
    ev = applyBall(inn, { dismissal: { type: 'bowled', batter: inn.striker } });
  }
  assert.equal(inn.wickets, 10);
  assert.ok(inn.complete);
  assert.equal(inn.endReason, 'allout');
  assert.ok(ev.some(e => e.type === 'inningsComplete'));
  assert.throws(() => applyBall(inn, dot));
});

test('innings ends when overs run out', () => {
  const inn = fresh();
  for (let i = 0; i < 6; i++) applyBall(inn, { runs: 1 });
  setBowler(inn, 'x2');
  for (let i = 0; i < 5; i++) applyBall(inn, dot);
  assert.ok(!inn.complete);
  applyBall(inn, dot);
  assert.ok(inn.complete);
  assert.equal(inn.endReason, 'overs');
  assert.equal(inn.overs.length, 2);
});

test('chasing: innings ends as soon as the target is reached', () => {
  const inn = fresh({ target: 7 });
  applyBall(inn, { runs: 6, boundary: 6 });
  assert.ok(!inn.complete);
  assert.equal(requiredRunRate(inn), 1 * 6 / 11);
  applyBall(inn, { extra: 'wide' });
  assert.ok(inn.complete);
  assert.equal(inn.endReason, 'target');
});

test('audit: batter runs + extras always equals the total', () => {
  const inn = fresh();
  const balls = [{ runs: 1 }, { extra: 'wide', runs: 2 }, { extra: 'noball', runs: 1 }, { runs: 2, runType: 'bye' }, { runs: 4, boundary: 4 },
    { runs: 1, runType: 'legbye' }, { dismissal: { type: 'lbw', batter: 'b2' } }];
  for (const b of balls) { if (!inn.currentBowler) setBowler(inn, 'x2'); applyBall(inn, b); }
  const a = auditInnings(inn);
  assert.ok(a.runsMatch && a.ballsMatch && a.wicketsMatch, JSON.stringify(a));
});
