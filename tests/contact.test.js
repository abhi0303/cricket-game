import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReach, REACH, SHOTS, contactZ, shotFromInput, resolveShot } from '../src/game/ShotModel.js';
import { CONTACT, SWING_LEAD } from '../src/game/DeliverySim.js';
import { aimPreview, shotAxis } from '../src/game/BattingInput.js';
import { projectShot } from '../src/game/NetsSim.js';
import { launchVelocity } from '../src/game/BallPhysics.js';
import { normalizePlayer } from '../src/game/PlayerAttributes.js';
import { MatchEngine } from '../src/game/MatchEngine.js';
import { generateCpuTeam, createDefaultUserTeam } from '../src/game/TeamManager.js';
import { ensureBowler, buildDeliverySim } from '../src/game/MatchSim.js';
import { RNG } from '../src/utils/Random.js';

globalThis.performance ??= { now: () => Date.now() };

const batter = normalizePlayer({ id: 'x', name: 'X', number: 2, role: 'batsman', battingStyle: 'balanced', batting: 80, timing: 80, aggression: 50 });
const bowler = normalizePlayer({ id: 'b', name: 'B', number: 1, role: 'bowler', bowlingType: 'medium', bowlAccuracy: 80, bowlSpeed: 70, bowlMovement: 60, bowlStamina: 70 });

test('each shot only reaches where its bat can get to', () => {
  assert.ok(canReach('coverDrive', 'front', 0.4, 0.3), 'a cover drive to a half-volley outside off');
  assert.ok(canReach('straightDrive', 'front', 0.05, 0.12), 'a full ball on the stumps');
  assert.ok(!canReach('hook', 'back', 0, 0.3), 'no hooking a ball at shin height');
  assert.ok(canReach('hook', 'back', -0.1, 1.6), 'hooking a bouncer');
  assert.ok(!canReach('sweep', 'front', 0, 1.5), 'no sweeping a chest-high ball');
  assert.ok(!canReach('cut', 'back', -0.6, 0.9), 'no cutting a ball down the leg side');
  assert.ok(canReach('cut', 'back', 0.7, 0.9), 'cutting a short, wide one');
  assert.ok(!canReach('defend', 'front', 0.2, 2.0), 'a forward block cannot get up to a head-high ball');
  // every shot reaches the ball it is meant for
  const mid = ([a, b]) => (a + b) / 2;
  for (const [id, s] of Object.entries(SHOTS)) {
    if (!s.ideal || !REACH[id]) continue;
    assert.ok(canReach(id, s.foot === 'back' ? 'back' : 'front', mid(s.ideal.x), Math.max(0.15, mid(s.ideal.y))), `${id} reaches its own ball`);
  }
});

test('a shot played to a ball out of its reach is a miss', () => {
  const res = resolveShot({ shotId: 'hook', dirDeg: -118, foot: 'back', timingError: 0, batter, bowler, plan: { kind: 'pace', bounceLen: 8, deviation: 0 },
    ball: { p: { x: 0, y: 0.3, z: 9.2 }, v: { x: 0, y: 0, z: 30 }, bouncedBefore: true }, rng: new RNG(1) });
  assert.equal(res.result, 'miss');
  assert.equal(res.reason, 'Out of reach');
});

function userBattingSim(seed) {
  const rng = new RNG(seed);
  const a = createDefaultUserTeam(rng), b = generateCpuTeam(rng, { difficulty: 'normal' });
  const m = new MatchEngine({ teams: [a, b], config: { overs: 5, difficulty: 'normal' }, toss: { winner: a.id, decision: 'bat' } });
  ensureBowler(m, rng);
  return buildDeliverySim(m, { rng, userTeamId: a.id });
}

test('the ball comes off the bat where the ball is when the bat gets there: never from behind the batter', () => {
  const rng = new RNG(5);
  let hits = 0, early = 0, late = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const sim = userBattingSim(100 + seed);
    for (let i = 0; i < 3000 && sim.phase !== 'flight'; i++) sim.update(1 / 60);
    const button = ['ground', 'ground', 'lofted', 'defend'][seed % 4];
    const sx = rng.range(-1, 1), sy = rng.range(-1, 1);
    const sh = shotFromInput(button, sx, sy, { bowlerKind: sim.kind, lengthHint: sim.plan.bounceLen });
    const tc = sim.tRelease + sim.plan.path.timeAtZ(contactZ(sh.shotId, sh.foot, sh.stepOut));
    const err = rng.gauss(0, 0.06);
    const pressT = tc - SWING_LEAD * sim.deliveryScale + err * sim.deliveryScale;
    for (let i = 0; i < 3000 && sim.phase === 'flight' && sim.t < pressT - 1e-4; i++) sim.update(Math.min(1 / 60, Math.max(1e-4, (pressT - sim.t) / sim.scale)));
    if (sim.phase !== 'flight' || !sim.inputShot({ button, sx, sy })) continue;
    const planned = sim.shot.outcome;
    for (let i = 0; i < 3000 && !sim.resolved; i++) sim.update(1 / 120);
    assert.equal(sim.shotResult, planned, 'the outcome settled as the shot was played is what happens');
    const hit = sim.events.find(e => e.type === 'contact');
    if (!hit) continue;
    hits++;
    const { t, tc: tcs } = sim.shot.contact;
    const at = sim.plan.path.at(t - sim.tRelease).p;
    assert.ok(Math.hypot(hit.p.x - at.x, hit.p.y - at.y, hit.p.z - at.z) < 1e-9, 'it leaves from the ball\'s position at contact');
    assert.ok(hit.p.z <= CONTACT.deepest + 1e-6, `not from behind the batter (z ${hit.p.z.toFixed(2)})`);
    const zc = contactZ(sim.shot.shotId, sim.shot.foot, sim.shot.stepOut);
    assert.ok(hit.p.z >= zc - CONTACT.front - 1e-6 && hit.p.z <= zc + CONTACT.back + 1e-6, 'within reach of the shot\'s contact point');
    if (sim.bat) assert.ok(Math.abs(sim.bat.path.t0 - t) < 1e-9, 'the hit ball starts its flight at the moment of contact');
    if (t < tcs - 1e-6) early++; else if (t > tcs + 1e-6) late++;
  }
  assert.ok(hits >= 25, `enough shots hit (${hits})`);
  assert.ok(early > 0 && late > 0, `early shots meet the ball further out, late ones deeper (${early} / ${late})`);
});

test('the field chart aim: the stick shows where a ground shot will go; centred, the assist picks', () => {
  const sim = { kind: 'pace', phase: 'ready', plan: null, D: { aimAssist: 0 }, fielders: [], guard: 0 };
  assert.equal(aimPreview(sim, { x: 0, y: 0 }), null);
  const off = aimPreview(sim, { x: 1, y: 0.5 }), leg = aimPreview(sim, { x: -1, y: 0.5 });
  assert.ok(off.deg > 30 && off.deg < 90, `off side (${off.deg.toFixed(0)}°)`);
  assert.ok(leg.deg < -30 && leg.deg > -90, `leg side (${leg.deg.toFixed(0)}°)`);
  assert.ok(Math.abs(aimPreview(sim, { x: 0, y: 1 }).deg) < 1, 'pushed straight: back past the bowler');
  // from the bowler's end the picture is mirrored: screen-left is the off side
  assert.ok(aimPreview(sim, shotAxis({ x: -1, y: -0.5 }, 'bowlerEnd')).deg > 30);
  // the striker's guard moves where the aim starts
  assert.equal(aimPreview({ ...sim, guard: 0.4 }, { x: 1, y: 0 }).x, aimPreview(sim, { x: 1, y: 0 }).x + 0.4);
});

test('a nets shot says where it would have gone on the field', () => {
  for (const [dir, elev, speed] of [[45, 2, 30], [-80, 30, 34], [0, -5, 6]]) {
    const p = projectShot({ x: 0, y: 0.5, z: 8.4 }, launchVelocity(speed, dir, elev), 'pace');
    assert.ok(p.to && Number.isFinite(p.to.x) && Number.isFinite(p.to.z), `${p.kind} has an end point`);
  }
});
