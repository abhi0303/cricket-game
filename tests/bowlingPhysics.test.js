import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDelivery, PITCH, BALL_R } from '../src/game/BallPhysics.js';
import { PHYSICS, defaultLengthTarget, allowedSpeeds, baselineTravelTime } from '../src/game/PhysicsConfig.js';
import { DeliverySim } from '../src/game/DeliverySim.js';
import { normalizePlayer } from '../src/game/PlayerAttributes.js';
import { assignFielders } from '../src/game/FieldPlacements.js';
import { RNG } from '../src/utils/Random.js';

const SPEEDS = [150, 145, 140, 130, 125, 115, 100, 95, 85, 70];
const LENGTHS = ['yorker', 'fullToss', 'full', 'good', 'backOfLength', 'shortOfLength', 'short', 'bouncer'];
const bowler = (o = {}) => normalizePlayer({ id: 'bw', name: 'Bowler', number: 1, role: 'bowler', bowlingType: 'medium', bowlAccuracy: 99, bowlSpeed: 50, bowlMovement: 1, bowlStamina: 60, ...o });
const exact = (kph, length, target = {}) => planDelivery(bowler(), { speedKph: kph, length, type: 'stock', quality: 1, spreadMult: 0, target: { x: 0.1, ...defaultLengthTarget(length), ...target } }, new RNG(3));

test('the ten required speeds are configured', () => {
  assert.deepEqual(PHYSICS.speeds, SPEEDS);
  assert.deepEqual(PHYSICS.lengthOrder, LENGTHS);
  assert.equal(PHYSICS.pitch.length, 20.12);
});

test('all 10 speeds x 8 lengths: release speed, reaches the batsman, never sinks into the pitch', () => {
  for (const kph of SPEEDS) for (const id of LENGTHS) {
    const p = exact(kph, id);
    const tag = `${kph} ${id}`;
    assert.ok(Math.abs(p.timing.releaseSpeed - kph / 3.6) < 1e-6, `${tag}: release speed ${p.timing.releaseSpeed}`);
    assert.ok(p.timing.tTotal > 0, `${tag}: reaches the striker's stumps`);
    for (const pt of p.path.p) assert.ok(pt.y >= BALL_R - 1e-9, `${tag}: ball below the pitch surface (${pt.y})`);
    // continuous trajectory: no jumps between samples (no teleport / snap)
    for (let i = 1; i < p.path.p.length; i++) {
      const a = p.path.p[i - 1], b = p.path.p[i];
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 0.1, `${tag}: discontinuity`);
    }
  }
});

test('pitching position matches the selected length (centre and both ends of each range)', () => {
  for (const kph of SPEEDS) for (const id of LENGTHS) {
    const L = PHYSICS.lengths[id];
    if (!L.range) {
      const p = exact(kph, id);
      assert.equal(p.bounceLen, null, `${kph} full toss must not bounce before the stumps`);
      assert.ok(p.heightAtCrease >= L.heightRange[0] - 0.05 && p.heightAtCrease <= L.heightRange[1] + 0.05, `${kph} full toss height ${p.heightAtCrease}`);
      continue;
    }
    for (const len of [Math.max(0.05, L.range[0]), (L.range[0] + L.range[1]) / 2, L.range[1]]) {
      const p = exact(kph, id, { len });
      assert.ok(Math.abs(p.bounceLen - len) < 0.08, `${kph} ${id}: aimed ${len}, pitched ${p.bounceLen}`);
    }
  }
});

test('the bounce reverses vertical velocity and reduces horizontal velocity', () => {
  for (const kph of SPEEDS) for (const id of LENGTHS.filter(l => l !== 'fullToss')) {
    const ev = exact(kph, id).path.events.find(e => e.type === 'bounce');
    assert.ok(ev.vIn.y < 0 && ev.vOut.y > 0, `${kph} ${id}: bounces upward`);
    assert.ok(ev.vOut.z < ev.vIn.z, `${kph} ${id}: horizontal speed reduced`);
    assert.ok(Math.abs(ev.p.y - BALL_R) < 1e-9, 'contact exactly at the surface');
  }
});

test('higher speeds always give shorter travel times', () => {
  for (const id of LENGTHS) {
    const times = SPEEDS.map(k => exact(k, id).timing.tTotal);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `${id}: ${SPEEDS[i]} km/h should be slower than ${SPEEDS[i - 1]}`);
  }
});

test('each length gives a different post-bounce reaction window', () => {
  for (const kph of SPEEDS) {
    const r = Object.fromEntries(LENGTHS.map(id => [id, exact(kph, id).timing]));
    assert.ok(r.yorker.pitchedInZone || r.yorker.reaction < 0.02, `${kph}: yorker leaves almost no time after pitching`);
    const order = ['full', 'good', 'backOfLength', 'shortOfLength', 'short'];
    for (let i = 1; i < order.length; i++) assert.ok(r[order[i]].reaction > r[order[i - 1]].reaction + 0.02, `${kph}: ${order[i]} reaction > ${order[i - 1]}`);
    assert.ok(r.short.tPostPitch > r.good.tPostPitch, `${kph}: short ball has more time after pitching`);
  }
});

test('bounce heights at the batter rise with shorter lengths; bouncers are head-high at pace', () => {
  const hAt = p => p.path.at(p.path.timeAtZ(PHYSICS.batterZ)).p.y;
  for (const kph of [150, 145, 140, 130]) {
    const h = Object.fromEntries(LENGTHS.filter(l => l !== 'fullToss').map(id => [id, hAt(exact(kph, id))]));
    assert.ok(h.yorker < 0.3, `${kph} yorker at the feet (${h.yorker})`);
    assert.ok(h.full < h.good && h.good < h.backOfLength && h.backOfLength < h.shortOfLength && h.shortOfLength < h.short, `${kph} heights ${JSON.stringify(h)}`);
    assert.ok(h.bouncer > h.short + 0.15, `${kph} bouncer climbs above a short ball`);
    assert.ok(h.bouncer > 1.4 && h.bouncer < PITCH.headHeight, `${kph} bouncer at upper body/head (${h.bouncer})`);
  }
});

test('simulated travel times stay close to the constant-speed baseline', () => {
  for (const kph of SPEEDS) for (const id of LENGTHS) {
    const t = exact(kph, id).timing;
    assert.ok(Math.abs(baselineTravelTime(kph) - t.baseline) < 1e-12);
    const rel = (t.tTotal - t.baseline) / t.baseline;
    // Slow, short balls lose most speed (drag + friction at the bounce): up to ~+25% over the baseline.
    assert.ok(rel > -0.05 && rel < 0.3, `${kph} ${id}: ${t.tTotal.toFixed(3)} vs ${t.baseline.toFixed(3)}`);
  }
  assert.ok(Math.abs(baselineTravelTime(150) - 0.483) < 0.001 && Math.abs(baselineTravelTime(70) - 1.035) < 0.001);
});

test('a 70 km/h full toss gives far more time than a 150 km/h yorker', () => {
  const y = exact(150, 'yorker').timing, f = exact(70, 'fullToss').timing;
  assert.ok(f.tZoneEntry > 2 * y.tZoneEntry);
});

test('speed options depend on bowling type, fatigue and debug unlock', () => {
  assert.ok(allowedSpeeds('fast', 141).includes(150) === false, 'needs real pace to reach 150');
  assert.ok(allowedSpeeds('fast', 141).includes(145));
  assert.ok(allowedSpeeds('fast', 147).includes(150));
  assert.ok(allowedSpeeds('off-spin', 86).every(s => s <= 100));
  assert.ok(allowedSpeeds('fast', 147, { fatigue: 1 })[0] < allowedSpeeds('fast', 147)[0]);
  assert.deepEqual(allowedSpeeds('off-spin', 86, { unlockAll: true }), SPEEDS);
});

// ------------------------------------------------------------------ in-game simulation
const bat = id => normalizePlayer({ id, name: id, number: 7, role: 'batsman', battingStyle: 'attacker', batting: 80, timing: 80, aggression: 60 });
function newSim({ seed = 9, kph = 145, length = 'good', target = {}, userBatting = false } = {}) {
  const fielders = Array.from({ length: 9 }, (_, i) => normalizePlayer({ id: 'f' + i, name: 'F' + i, number: 20 + i, role: 'batsman', battingStyle: 'defensive' }));
  const keeper = normalizePlayer({ id: 'wk', name: 'WK', number: 40, role: 'wicketkeeper', battingStyle: 'attacker' });
  const sim = new DeliverySim({
    striker: bat('s'), nonStriker: bat('n'), bowler: bowler({ bowlingType: 'fast' }), keeper,
    field: assignFielders('balanced', fielders), userBatting, difficulty: 'normal', rng: new RNG(seed), unlockSpeeds: true,
  });
  sim.setSpec({ speedKph: kph, length, type: 'stock', quality: 1, spreadMult: 0, target: { x: 0.1, ...defaultLengthTarget(length), ...target } });
  sim.spec.spreadMult = 0;
  return sim;
}
function runUntil(sim, fps, cond, max = 20000) { let n = 0; while (!cond(sim) && n++ < max) sim.update(1 / fps); return sim; }

test('delivery physics and shot timing are identical at 30, 60 and 120 FPS', () => {
  const out = [30, 60, 120].map(fps => {
    const sim = runUntil(newSim(), fps, s => s.resolved);
    return { bounce: sim.plan.bounce.z, travel: sim.plan.timing.tTotal, err: sim.shotResult?.timingError, timing: sim.shotResult?.timing, rel: sim.shotResult?.result };
  });
  for (const o of out.slice(1)) {
    assert.equal(o.bounce, out[0].bounce);
    assert.equal(o.travel, out[0].travel);
    assert.ok(Math.abs(o.err - out[0].err) < 1e-9, `timing error differs: ${o.err} vs ${out[0].err}`);
    assert.equal(o.timing, out[0].timing);
    assert.equal(o.rel, out[0].rel);
  }
});

test('a human press is back-dated, so 30 FPS polling gives the same timing as 120 FPS', () => {
  const errs = [30, 120].map(fps => {
    const sim = newSim({ userBatting: true, length: 'full' });
    runUntil(sim, fps, s => s.phase === 'flight');
    // the key physically goes down at a fixed game time; the frame notices it later
    const pressAt = sim.tRelease + sim.plan.path.timeAtZ(8.3) - 0.2 * sim.deliveryScale;
    runUntil(sim, fps, s => s.t >= pressAt);
    const ageReal = (sim.t - pressAt) / sim.scale;
    sim.inputShot({ button: 'ground', sx: 0, sy: 0.8, age: ageReal });
    runUntil(sim, fps, s => s.resolved);
    return sim.shotResult.timingError;
  });
  assert.ok(Math.abs(errs[0] - errs[1]) < 1e-6, `30 fps ${errs[0]} vs 120 fps ${errs[1]}`);
});

test('no tunnelling: a 150 km/h yorker on the stumps bowls the batter at any frame rate', () => {
  for (const fps of [30, 60, 120]) {
    const sim = newSim({ userBatting: true, kph: 150, length: 'yorker', target: { x: 0.12, len: 0.4 } });
    runUntil(sim, fps, s => s.phase === 'dead');
    assert.equal(sim.plan.hitsStumps, true, 'trajectory crosses the stumps');
    assert.equal(sim.result().dismissal?.type, 'bowled', `${fps} fps`);
  }
});

test('no tunnelling: a fast bouncer at the body hits the batter (helmet/body) when no shot is played', () => {
  for (const fps of [30, 120]) {
    const sim = newSim({ userBatting: true, kph: 145, length: 'bouncer', target: { x: 0.12, len: 12.4 } });   // off-stump line angles in at the body
    const hits = [];
    runUntil(sim, fps, s => { for (const e of s.drainEvents()) hits.push(e.type); return s.phase === 'dead' || s.phase === 'inplay'; });
    assert.ok(hits.includes('bodyHit'), `${fps} fps: ${hits.join(',')}`);
  }
});

test('no tunnelling: the bat meets a 150 km/h ball at the contact plane at 30 FPS', () => {
  let contacts = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const sim = newSim({ seed, kph: 150, length: 'full' });
    const evs = [];
    runUntil(sim, 30, s => { evs.push(...s.drainEvents()); return s.resolved; });
    const c = evs.find(e => e.type === 'contact');
    if (c) { contacts++; assert.ok(c.p.z > 7.0 && c.p.z < 9.6, `contact at z=${c.p.z}`); }
  }
  assert.ok(contacts >= 10, `only ${contacts}/20 balls hit`);
});
