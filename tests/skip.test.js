import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchEngine } from '../src/game/MatchEngine.js';
import { generateCpuTeam, createDefaultUserTeam } from '../src/game/TeamManager.js';
import { auditInnings } from '../src/game/CricketRules.js';
import { simulateBalls, chaseFinishReached, finalOversFor } from '../src/game/SkipSim.js';
import { RNG } from '../src/utils/Random.js';

// The user bowls first (CPU bats), like a player who wants to skip their bowling.
function newMatch(seed, overs = 5) {
  const rng = new RNG(seed);
  const a = createDefaultUserTeam(rng);
  const b = generateCpuTeam(rng, { difficulty: 'normal' });
  const m = new MatchEngine({ teams: [a, b], config: { overs, difficulty: 'normal' }, toss: { winner: a.id, decision: 'bowl' } });
  return { m, rng };
}

test('final overs: 1 in a 5-over game, 2 in 10 overs, 3 in 20 overs', () => {
  assert.equal(finalOversFor(5), 1);
  assert.equal(finalOversFor(10), 2);
  assert.equal(finalOversFor(20), 3);
});

test('skipping the bowling finishes the innings and stops at the break', () => {
  for (const overs of [5, 10, 20]) {
    const { m, rng } = newMatch(overs * 7, overs);
    assert.ok(!m.innings || m.phase !== 'break');
    const r = simulateBalls(m, rng);
    assert.ok(r.inningsOver && r.balls > 0);
    assert.equal(m.phase, 'break', 'waits at the innings break for the player to choose');
    const a = auditInnings(m.state.innings[0]);
    assert.ok(a.runsMatch && a.ballsMatch && a.wicketsMatch);
  }
});

test('a few balls can be skipped and the innings carries on from there', () => {
  const { m, rng } = newMatch(3);
  const r = simulateBalls(m, rng, { maxBalls: 4 });
  assert.equal(r.balls, 4);
  assert.equal(m.phase, 'innings');
  assert.ok(m.innings.legalBalls >= 2);
});

test('jumping to the final overs stops exactly when the finish is reached', () => {
  let stoppedEarly = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { m, rng } = newMatch(seed * 13, seed % 2 ? 5 : 10);
    simulateBalls(m, rng);
    m.beginSecondInnings();
    assert.equal(chaseFinishReached(m), m.situation().need <= finalOversFor(m.config.overs) * 6, 'only a tiny target is "the finish" at ball one');
    const r = simulateBalls(m, rng, { stop: chaseFinishReached });
    if (r.inningsOver) { assert.ok(['complete'].includes(m.phase)); continue; }
    stoppedEarly++;
    assert.ok(chaseFinishReached(m), 'stopped at the finish');
    const s = m.situation(), n = finalOversFor(m.config.overs) * 6;
    assert.ok(s.ballsLeft <= n || s.need <= n || s.wicketsLeft <= 2);
    assert.equal(simulateBalls(m, rng, { stop: chaseFinishReached }).balls, 0, 'nothing more to skip');
    // the rest of the chase can then be played (here: simulated) to a result
    simulateBalls(m, rng);
    assert.equal(m.phase, 'complete');
  }
  assert.ok(stoppedEarly >= 8, `most chases leave a finish to watch (${stoppedEarly}/12)`);
});

test('the finish is never "reached" outside a chase', () => {
  const { m } = newMatch(5);
  assert.equal(chaseFinishReached(m), false);
});
