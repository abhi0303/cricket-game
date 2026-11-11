import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchEngine } from '../src/game/MatchEngine.js';
import { generateCpuTeam, createDefaultUserTeam } from '../src/game/TeamManager.js';
import { simulateMatchHeadless, simulateBallHeadless, ensureBowler, buildDeliverySim } from '../src/game/MatchSim.js';
import { auditInnings, maxOversPerBowler, BALLS_PER_OVER } from '../src/game/CricketRules.js';
import { RNG } from '../src/utils/Random.js';

function newMatch(seed, overs = 5, difficulty = 'normal', decision = 'bat') {
  const rng = new RNG(seed);
  const a = createDefaultUserTeam(rng);
  const b = generateCpuTeam(rng, { difficulty });
  const m = new MatchEngine({ teams: [a, b], config: { overs, difficulty }, toss: { winner: a.id, decision } });
  return { m, rng, a, b };
}

test('complete AI-vs-AI matches in every format end with a consistent result', () => {
  for (const overs of [5, 10, 20]) {
    for (let seed = 1; seed <= (overs === 20 ? 4 : 8); seed++) {
      const { m, rng } = newMatch(seed * 31 + overs, overs);
      simulateMatchHeadless(m, rng);
      assert.equal(m.phase, 'complete');
      const [i1, i2] = m.state.innings;
      assert.equal(i2.target, i1.runs + 1, 'target is first-innings total + 1');
      for (const inn of [i1, i2]) {
        const a = auditInnings(inn);
        assert.ok(a.runsMatch && a.ballsMatch && a.wicketsMatch, JSON.stringify(a));
        assert.ok(inn.legalBalls <= overs * BALLS_PER_OVER);
        assert.ok(inn.wickets <= 10);
        assert.ok(inn.complete);
        // Bowler limits and no consecutive overs
        const cap = maxOversPerBowler(overs);
        for (const b of Object.values(inn.bowlers)) assert.ok(b.balls <= cap * 6, 'bowler over cap');
        for (let k = 1; k < inn.overs.length; k++) assert.notEqual(inn.overs[k].bowler, inn.overs[k - 1].bowler, 'consecutive overs');
      }
      const r = m.state.result;
      if (i2.runs >= i2.target) assert.equal(r.winner, i2.battingTeam);
      else if (i2.runs === i2.target - 1) assert.equal(r.type, 'tie');
      else assert.equal(r.winner, i1.battingTeam);
      const s = m.summary();
      assert.ok(s.topScorer && s.bestBowler && s.playerOfMatch);
    }
  }
});

test('first innings ends early when chasing side reaches the target', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { m, rng } = newMatch(seed, 5);
    simulateMatchHeadless(m, rng);
    const i2 = m.state.innings[1];
    if (i2.endReason === 'target') assert.ok(i2.runs >= i2.target && i2.runs - i2.target < 7);
  }
});

test('save and resume mid-match continues to the same kind of result', () => {
  const { m, rng } = newMatch(77, 5);
  for (let i = 0; i < 20; i++) simulateBallHeadless(m, rng);
  const json = JSON.stringify(m.toJSON());
  const m2 = MatchEngine.fromJSON(json);
  assert.equal(m2.innings.runs, m.innings.runs);
  assert.equal(m2.innings.legalBalls, m.innings.legalBalls);
  assert.equal(m2.striker.id, m.striker.id);
  simulateMatchHeadless(m2, new RNG(5));
  assert.equal(m2.phase, 'complete');
});

test('the same seed replays the same match', () => {
  const run = () => { const { m, rng } = newMatch(1234, 5); simulateMatchHeadless(m, rng); return m.state.innings.map(i => `${i.runs}/${i.wickets} ${i.legalBalls}`).join(' | '); };
  assert.equal(run(), run());
});

test('every delivery produces a valid ball record with finite positions', () => {
  const { m, rng } = newMatch(9, 10);
  let n = 0;
  while (m.phase !== 'complete' && n++ < 600) {
    if (m.phase === 'break') { m.beginSecondInnings(); continue; }
    ensureBowler(m, rng);
    const sim = buildDeliverySim(m, { rng });
    const r = sim.fastForward();
    assert.ok([null, 'wide', 'noball'].includes(r.extra));
    assert.ok(Number.isInteger(r.runs) && r.runs >= 0 && r.runs <= 7, `runs ${r.runs}`);
    assert.ok([0, 4, 6].includes(r.boundary));
    if (r.boundary) assert.equal(r.runs, r.boundary);
    if (r.dismissal) assert.ok(['bowled', 'caught', 'lbw', 'runout', 'stumped', 'hitwicket'].includes(r.dismissal.type));
    for (const a of [...sim.allFielders, ...sim.runners]) assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z));
    assert.ok(Number.isFinite(sim.ball.p.x) && Number.isFinite(sim.ball.p.y) && Number.isFinite(sim.ball.p.z));
    m.recordBall(r);
  }
  assert.equal(m.phase, 'complete');
});

test('a no-ball gives the next delivery a free hit in the simulation', () => {
  const { m, rng } = newMatch(3, 5);
  ensureBowler(m, rng);
  const sim = buildDeliverySim(m, { rng });
  sim.setSpec({ overstep: true });
  const r = sim.fastForward();
  assert.equal(r.extra, 'noball');
  m.recordBall(r);
  assert.ok(m.innings.freeHit);
  const sim2 = buildDeliverySim(m, { rng });
  assert.equal(sim2.freeHit, true);
});

test('a user-controlled batter who never plays a shot still gets a dead ball', () => {
  const { m, rng, a } = newMatch(4, 5, 'normal', 'bat');
  ensureBowler(m, rng);
  const sim = buildDeliverySim(m, { rng, userTeamId: a.id });
  assert.equal(sim.control.bat, 'user');
  for (let i = 0; i < 2000 && sim.phase !== 'dead'; i++) sim.update(1 / 60);
  assert.equal(sim.phase, 'dead');
  const r = sim.result();
  assert.equal(r.runType === 'bat' && r.runs > 0, false, 'no runs off the bat without a shot');
});

test('user bowling: meter release locks quality, holding too long is a no-ball', () => {
  const { m, rng, a } = newMatch(6, 5, 'normal', 'bowl');
  ensureBowler(m, rng);
  const sim = buildDeliverySim(m, { rng, userTeamId: a.id });
  assert.equal(sim.control.bowl, 'user');
  sim.startRunup();
  while (sim.meter.value < 0.84) sim.update(1 / 120);
  sim.releaseMeter();
  assert.ok(sim.meter.quality > 0.9, `quality ${sim.meter.quality}`);
  assert.equal(sim.spec.overstep, false);

  const sim2 = buildDeliverySim(m, { rng, userTeamId: a.id });
  sim2.startRunup();
  for (let i = 0; i < 2000 && sim2.phase === 'runup'; i++) sim2.update(1 / 120);
  assert.equal(sim2.noBall, true, 'never releasing the button oversteps');
});
