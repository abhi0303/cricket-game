import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNetsConfig, withNetType, netSpeed, netSpec, netBowler, netOutcome, emptyNetStats, addNetBall, middledPct, NET_SPEEDS, NET_LINES,
} from '../src/game/NetsConfig.js';
import { NetsDeliverySim, simulateNetBall, projectShot, NET } from '../src/game/NetsSim.js';
import { launchVelocity, BALL_R } from '../src/game/BallPhysics.js';
import { contactZ } from '../src/game/ShotModel.js';
import { createDefaultUserTeam } from '../src/game/TeamManager.js';
import { RNG } from '../src/utils/Random.js';

globalThis.performance ??= { now: () => Date.now() };

const team = createDefaultUserTeam(new RNG(8));

function bowlBall(cfg, rng, { button = null, sx = 0, sy = 0.6 } = {}) {
  const bowler = netBowler(cfg), batter = team.players.find(p => p.id === cfg.batterId);
  const sim = new NetsDeliverySim({ striker: batter, bowler, rng, difficulty: 'normal' });
  sim.setSpec(netSpec(cfg, bowler, batter, rng));
  let pressed = false;
  for (let i = 0; i < 5000 && sim.phase !== 'dead'; i++) {
    if (button && !pressed && sim.phase === 'flight') {
      const tc = sim.tRelease + (sim.plan.path.timeAtZ(contactZ('coverDrive', 'front')) ?? 0.5);
      if (sim.t >= tc - 0.2 * sim.deliveryScale) { sim.inputShot({ button, sx, sy }); pressed = true; }
    }
    sim.update(1 / 60);
  }
  return sim;
}

test('nets settings: a fast bowler defaults to 145 km/h fixed, or 120-150 km/h at random', () => {
  const c = normalizeNetsConfig({}, team);
  assert.equal(c.type, 'fast');
  assert.equal(c.speedMode, 'fixed');
  assert.equal(c.speed, 145);
  assert.deepEqual([c.speedMin, c.speedMax], [120, 150]);
  assert.equal(c.batterId, team.battingOrder[0], 'the top of the batting order faces');
  // out-of-range and nonsense values are cleaned up
  const bad = normalizeNetsConfig({ type: 'off-spin', speed: 150, speedMin: 99, speedMax: 70, length: 'beamer', line: 'x', accuracy: 'no' }, team);
  assert.equal(bad.speed, NET_SPEEDS['off-spin'].max, 'a spinner cannot bowl 150');
  assert.deepEqual([bad.speedMin, bad.speedMax], [70, 99], 'from/to are put in order');
  assert.equal(bad.length, 'mixed'); assert.equal(bad.line, 'mixed'); assert.equal(bad.accuracy, 'steady');
  // switching type brings that type's speeds
  const spin = withNetType(c, 'leg-spin', team);
  assert.equal(spin.speed, NET_SPEEDS['leg-spin'].fixed);
  assert.deepEqual([spin.speedMin, spin.speedMax], NET_SPEEDS['leg-spin'].random);
});

test('fixed speed is the same every ball; random speed covers the whole range', () => {
  const rng = new RNG(1);
  const fixed = normalizeNetsConfig({ type: 'fast', speed: 145 }, team);
  for (let i = 0; i < 50; i++) assert.equal(netSpeed(fixed, rng), 145);
  const rand = normalizeNetsConfig({ type: 'fast', speedMode: 'random', speedMin: 120, speedMax: 150 }, team);
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    const v = netSpeed(rand, rng);
    assert.ok(Number.isInteger(v) && v >= 120 && v <= 150, `speed ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 31, 'every speed from 120 to 150 comes up');
});

test('the bowler really bowls at the chosen speed', () => {
  const rng = new RNG(2);
  const fixed = normalizeNetsConfig({ type: 'fast', speed: 145 }, team);
  for (let i = 0; i < 12; i++) {
    const sim = bowlBall(fixed, rng);
    assert.equal(sim.plan.speedKph, 145);
    assert.ok(Math.abs(sim.plan.timing.releaseSpeed - 145 / 3.6) < 1e-6, 'release velocity = 145 km/h');
  }
  const spin = normalizeNetsConfig({ type: 'off-spin', speedMode: 'random', speedMin: 78, speedMax: 92 }, team);
  for (let i = 0; i < 12; i++) {
    const sim = bowlBall(spin, rng);
    assert.ok(sim.plan.speedKph >= 78 && sim.plan.speedKph <= 92);
    assert.equal(sim.plan.kind, 'spin');
    assert.equal(sim.plan.bowlingType, 'off-spin');
  }
});

test('chosen length, line and delivery are always bowled; mixed gives variety', () => {
  const rng = new RNG(3);
  const bowler = netBowler(normalizeNetsConfig({}, team)), batter = team.players[0];
  const cfg = normalizeNetsConfig({ type: 'fast', length: 'yorker', line: 'offStump', variation: 'outswing' }, team);
  for (let i = 0; i < 40; i++) {
    const s = netSpec(cfg, bowler, batter, rng);
    assert.equal(s.length, 'yorker');
    assert.ok(s.target.len >= 0 && s.target.len <= 1);
    assert.ok(Math.abs(s.target.x - NET_LINES.offStump.x) < 0.2);
    assert.equal(s.type, 'outswing');
  }
  const googly = normalizeNetsConfig({ type: 'leg-spin', variation: 'variation' }, team);
  const gb = netBowler(googly);
  for (let i = 0; i < 10; i++) assert.equal(netSpec(googly, gb, batter, rng).type, 'variation');
  const mixed = normalizeNetsConfig({ type: 'fast' }, team);
  const lengths = new Set(), types = new Set();
  for (let i = 0; i < 200; i++) { const s = netSpec(mixed, bowler, batter, rng); lengths.add(s.length); types.add(s.type); }
  assert.ok(lengths.size >= 4 && types.size >= 2, `mixed: ${[...lengths]} / ${[...types]}`);
});

test('in the nets nobody fields or runs, and every ball finishes inside the netting', () => {
  const rng = new RNG(4);
  const cfg = normalizeNetsConfig({ type: 'fast', speedMode: 'random' }, team);
  let contacts = 0;
  for (let i = 0; i < 120; i++) {
    const sim = bowlBall(cfg, rng, i % 3 ? { button: ['ground', 'lofted', 'defend'][i % 3], sx: (i % 7) / 3 - 1 } : {});
    assert.equal(sim.phase, 'dead');
    assert.equal(sim.fielders.length, 0);
    assert.equal(sim.runners.length, 1, 'only the striker');
    const r = sim.result();
    assert.equal(r.nets, true);
    assert.equal(r.runs, 0, 'no runs are run in the nets');
    if (r.contact) { contacts++; assert.ok(r.projection, 'every shot gets a match value'); }
    const p = sim.ball.p;
    const inLane = Math.abs(p.x) <= NET.halfW - BALL_R + 1e-6 && p.z <= NET.backZ - BALL_R + 1e-6;
    const outFront = p.z < NET.frontZ, overTop = p.y >= NET.height - 0.5 || Math.abs(p.x) > NET.halfW;
    assert.ok(inLane || outFront || overTop || r.dismissal, `ball came to rest at ${JSON.stringify(p)}`);
  }
  assert.ok(contacts > 30);
});

test('the netting stops the ball: side, back and roof', () => {
  const side = simulateNetBall({ x: 0, y: 0.5, z: 8.3 }, launchVelocity(30, 70, 0));
  assert.equal(side.hits[0].which, 'side');
  for (const p of side.path.p) assert.ok(p.x <= NET.halfW - BALL_R + 1e-9, 'never through the side net');
  const end = side.path.v[side.path.v.length - 1];
  assert.ok(Math.hypot(end.x, end.y, end.z) < 1, 'and it drops');
  const back = simulateNetBall({ x: 0, y: 0.5, z: 9.6 }, { x: 0, y: 0, z: 35 });
  assert.equal(back.hits[0].which, 'back');
  assert.ok(Math.max(...back.path.p.map(p => p.z)) <= NET.backZ - BALL_R + 1e-9);
  const roof = simulateNetBall({ x: 0, y: 0.6, z: 8.3 }, launchVelocity(32, 0, 40));
  assert.equal(roof.hits[0].which, 'roof');
  assert.ok(Math.max(...roof.path.p.map(p => p.y)) <= NET.height - BALL_R + 1e-9);
  // a straight drive along the ground runs out of the open end of the net, towards the bowler
  const straight = simulateNetBall({ x: 0, y: 0.1, z: 8.3 }, launchVelocity(25, 0, -2));
  assert.equal(straight.hits.length, 0);
  assert.ok(straight.path.p.at(-1).z < NET.frontZ);
});

test('a shot is worth what it would be on the field', () => {
  const at = { x: 0, y: 0.6, z: 8.3 };
  assert.equal(projectShot(at, launchVelocity(38, 0, 32)).kind, 'six', 'a big straight hit clears the rope');
  const four = projectShot({ ...at, y: 0.2 }, launchVelocity(34, 75, -2));
  assert.equal(four.kind, 'four', `crunched along the ground square on the off side (${JSON.stringify(four)})`);
  const push = projectShot(at, launchVelocity(8, 5, -6));
  assert.deepEqual([push.kind, push.where], ['dot', 'back to the bowler'], 'a firm push straight back');
  const block = projectShot(at, launchVelocity(3, 30, -6));
  assert.deepEqual([block.kind, block.runs, block.where], ['runs', 1, 'a quick single'], 'a dead bat: push and run, as the match AI would');
  const skier = projectShot(at, launchVelocity(22, 16, 38));
  assert.equal(skier.kind, 'caught', `a mistimed loft to mid-off (${JSON.stringify(skier)})`);
  assert.match(skier.where, /mid-off/);
  const edge = projectShot({ x: 0.3, y: 0.9, z: 8.6 }, launchVelocity(22, 176, 4));
  assert.deepEqual([edge.kind, edge.where], ['caught', 'behind'], 'a thin edge carries to the keeper');
  const slip = projectShot({ x: 0.3, y: 0.9, z: 8.6 }, launchVelocity(24, 168, 4));
  assert.deepEqual([slip.kind, slip.where], ['caught', 'at first slip'], 'a little wider: to first slip');
  const uppish = projectShot(at, launchVelocity(26, 66, 10));
  assert.deepEqual([uppish.kind, uppish.where], ['chance', 'at cover'], 'uppish wide of cover: a diving chance, not a sure catch');
});

test('session stats: runs, boundaries, dismissals and shots middled', () => {
  const s = emptyNetStats();
  const add = (r) => addNetBall(s, r, netOutcome(r));
  add({ contact: true, timing: 'perfect', desc: 'Cover drive', shot: 'Cover drive', projection: { kind: 'four', runs: 4, where: 'through cover' } });
  add({ contact: true, timing: 'good', desc: 'Lofted drive', shot: 'Lofted drive', projection: { kind: 'six', runs: 6, where: 'over long-on' } });
  add({ contact: true, timing: 'late', edge: true, desc: 'Thick outside edge', shot: 'Cover drive', projection: { kind: 'caught', runs: 0, where: 'behind' } });
  add({ dismissal: { type: 'bowled' }, desc: 'Bowled!', shot: 'Leave', left: true });
  add({ contact: false, shot: null });
  assert.deepEqual([s.balls, s.runs, s.fours, s.sixes, s.outs, s.dots, s.shots, s.middled], [5, 10, 1, 1, 2, 1, 3, 2]);
  assert.deepEqual(s.history, ['4', '6', 'C', 'W', '•']);
  assert.equal(middledPct(s), 67);
  const o = netOutcome({ contact: true, timing: 'late', edge: true, desc: 'Thick outside edge', shot: 'Cover drive', projection: { kind: 'caught', runs: 0, where: 'behind' } });
  assert.equal(o.main, 'CAUGHT!');
  assert.match(o.sub, /would be caught behind/);
  for (let i = 0; i < 10; i++) add({ contact: false, shot: null });
  assert.equal(s.history.length, 8, 'the strip shows the last eight balls');
});
