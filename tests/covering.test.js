import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeliverySim, DIVE_MIN_SPEED, STUMPS_SPOT, COVER_FROM } from '../src/game/DeliverySim.js';
import { launchVelocity } from '../src/game/BallPhysics.js';
import { MatchEngine } from '../src/game/MatchEngine.js';
import { generateCpuTeam } from '../src/game/TeamManager.js';
import { ensureBowler, buildDeliverySim } from '../src/game/MatchSim.js';
import { RNG } from '../src/utils/Random.js';

globalThis.performance ??= { now: () => Date.now() };

function aiSim(seed) {
  const rng = new RNG(seed);
  const a = generateCpuTeam(rng, { difficulty: 'normal' }), b = generateCpuTeam(rng, { difficulty: 'normal', avoidName: a.name });
  const e = new MatchEngine({ teams: [a, b], config: { overs: 20 }, toss: { winner: a.id, decision: 'bat' } });
  ensureBowler(e, rng);
  return { sim: buildDeliverySim(e, { rng }), rng };
}

/** A ball put in play by hand, a moment after release (the bowler is out of his follow-through). */
function inPlay(seed, p, v) {
  const { sim, rng } = aiSim(seed);
  for (let i = 0; i < 3000 && sim.phase !== 'flight'; i++) sim.update(1 / 60);
  for (let i = 0; i < 60 && sim.t - sim.tRelease < 0.55; i++) sim.update(1 / 60);
  sim.resolved = true; sim.contactMade = true;
  sim.startBatted(p, v(rng), { alreadyBounced: true });
  return sim;
}

// Watch every take of a throw: the receiver has to be where the ball is taken.
function watchTakes() {
  const takes = [];
  const orig = DeliverySim.prototype.takeThrow;
  DeliverySim.prototype.takeThrow = function (r, end, to) {
    takes.push({ r, end, gap: Math.hypot(r.x - to.x, r.z - (to.z + (end === 'striker' ? 0.2 : -0.2))) });
    return orig.call(this, r, end, to);
  };
  return { takes, done: () => { DeliverySim.prototype.takeThrow = orig; } };
}

test('nobody dives for a slow ball: a defensive push or a dribble is run down and picked up', () => {
  const orig = DeliverySim.prototype.onIntercept;
  let slowDives = 0, stops = 0, keeperDives = 0, pushes = 0;
  DeliverySim.prototype.onIntercept = function (ic) {
    if (this.ball.state === 'batted' && ic.type === 'stop') {
      stops++;
      if (ic.dive && Math.hypot(ic.v.x, ic.v.z) < DIVE_MIN_SPEED) slowDives++;
    }
    return orig.call(this, ic);
  };
  try {
    // defensive pushes in front of the batter, and a few full matches
    for (let seed = 1; seed <= 30; seed++) {
      const sim = inPlay(seed, { x: 0, y: 0.15, z: 8.4 }, rng => launchVelocity(rng.range(2.5, 5), rng.range(-40, 40), -4));
      sim.fastForward();
      pushes++;
      if (sim.events.some(e => e.type === 'pickup' && sim.fielderById(e.fielder)?.isKeeper) && sim.keeper.action === 'dive') keeperDives++;
    }
    for (let seed = 1; seed <= 4; seed++) {
      const rng = new RNG(300 + seed);
      const a = generateCpuTeam(rng, { difficulty: 'normal' }), b = generateCpuTeam(rng, { difficulty: 'normal', avoidName: a.name });
      const e = new MatchEngine({ teams: [a, b], config: { overs: 20 }, toss: { winner: a.id, decision: 'bat' } });
      while (e.phase !== 'complete') {
        if (e.phase === 'break') { e.beginNextInnings(); continue; }
        ensureBowler(e, rng);
        e.recordBall(buildDeliverySim(e, { rng }).fastForward());
      }
    }
  } finally { DeliverySim.prototype.onIntercept = orig; }
  assert.ok(stops > 200, `plenty of ground fielding (${stops})`);
  assert.equal(slowDives, 0, 'no dives at slow balls');
  assert.equal(keeperDives, 0, `the keeper doesn't dive for a defensive push (${pushes} pushes)`);
});

test('the keeper chasing away from his stumps: a fielder covers them and takes the throw there', () => {
  const w = watchTakes();
  let chased = 0, covered = 0, coverTook = 0;
  try {
    for (let seed = 1; seed <= 30; seed++) {
      // glanced fine, along the ground: the keeper goes after it
      const sim = inPlay(seed, { x: -0.3, y: 0.15, z: 9.2 }, rng => launchVelocity(rng.range(9, 12), rng.range(-152, -140), -8));
      const ic = sim.intercept;
      if (ic?.f !== sim.keeper || Math.hypot(ic.p.x - STUMPS_SPOT.striker.x, ic.p.z - STUMPS_SPOT.striker.z) <= COVER_FROM) continue;
      chased++;
      const cov = sim.fielderById(sim.cover.striker);
      assert.ok(cov && cov.role === 'fielder' && cov.covering === 'striker', 'someone comes over to cover the stumps');
      assert.deepEqual(cov.target, STUMPS_SPOT.striker, 'running to the stumps');
      covered++;
      sim.applyRunCommand('run');
      w.takes.length = 0;
      sim.fastForward();
      if (w.takes.some(t => t.end === 'striker' && t.r === cov)) coverTook++;
    }
  } finally { w.done(); }
  assert.ok(chased >= 10, `the keeper chases (${chased})`);
  assert.equal(covered, chased);
  assert.ok(coverTook >= chased / 2, `the cover takes the throw at the stumps (${coverTook} of ${chased})`);
});

test('the bowler chasing away from his stumps: a fielder covers the bowler\'s end', () => {
  let chased = 0, covered = 0;
  for (let seed = 1; seed <= 40; seed++) {
    // pushed back past the bowler on the off side, firmly: he turns and goes after it
    const sim = inPlay(seed, { x: 0.1, y: 0.15, z: 8.4 }, rng => launchVelocity(rng.range(10, 14), rng.range(8, 20), -6));
    const ic = sim.intercept;
    if (ic?.f !== sim.bowler || Math.hypot(ic.p.x - STUMPS_SPOT.nonStriker.x, ic.p.z - STUMPS_SPOT.nonStriker.z) <= COVER_FROM) continue;
    chased++;
    const cov = sim.fielderById(sim.cover.nonStriker);
    if (cov && cov.covering === 'nonStriker' && cov.target.z === STUMPS_SPOT.nonStriker.z) covered++;
  }
  assert.ok(chased >= 3, `the bowler chases (${chased})`);
  assert.equal(covered, chased, 'every time, someone covers his stumps');
});

test('every throw is taken by someone standing where the ball arrives (nobody takes it from metres away)', () => {
  const w = watchTakes();
  try {
    for (let seed = 1; seed <= 4; seed++) {
      const rng = new RNG(500 + seed);
      const a = generateCpuTeam(rng, { difficulty: 'normal' }), b = generateCpuTeam(rng, { difficulty: 'normal', avoidName: a.name });
      const e = new MatchEngine({ teams: [a, b], config: { overs: 20 }, toss: { winner: a.id, decision: 'bat' } });
      while (e.phase !== 'complete') {
        if (e.phase === 'break') { e.beginNextInnings(); continue; }
        ensureBowler(e, rng);
        e.recordBall(buildDeliverySim(e, { rng }).fastForward());
      }
    }
  } finally { w.done(); }
  assert.ok(w.takes.length > 200, `throws taken (${w.takes.length})`);
  const worst = Math.max(...w.takes.map(t => t.gap));
  assert.ok(worst < 1, `the receiver is at the ball when it arrives (worst ${worst.toFixed(2)} m)`);
});
