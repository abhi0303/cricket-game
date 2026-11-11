import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputManager } from '../src/controls/InputManager.js';
import { KeyboardControls } from '../src/controls/KeyboardControls.js';
import { GamepadControls } from '../src/controls/GamepadControls.js';
import { PAD } from '../src/controls/Bindings.js';
import { planDelivery } from '../src/game/BallPhysics.js';
import { resolveShot, contactZ, GUARD, BATTER_X } from '../src/game/ShotModel.js';
import { isWideLine } from '../src/game/DeliverySim.js';
import { reviewVerdict } from '../src/game/DRS.js';
import { normalizePlayer } from '../src/game/PlayerAttributes.js';
import { MatchEngine } from '../src/game/MatchEngine.js';
import { generateCpuTeam, createDefaultUserTeam } from '../src/game/TeamManager.js';
import { ensureBowler, buildDeliverySim } from '../src/game/MatchSim.js';
import { RNG } from '../src/utils/Random.js';

globalThis.performance ??= { now: () => Date.now() };

const bowler = normalizePlayer({ id: 'b', name: 'B', number: 1, role: 'bowler', bowlingType: 'medium', bowlAccuracy: 85, bowlSpeed: 70, bowlMovement: 80, bowlStamina: 70 });
const batter = normalizePlayer({ id: 'x', name: 'X', number: 2, role: 'batsman', battingStyle: 'balanced', batting: 75, timing: 75, aggression: 50 });

function userBattingSim(seed) {
  const rng = new RNG(seed);
  const a = createDefaultUserTeam(rng), b = generateCpuTeam(rng, { difficulty: 'normal' });
  const m = new MatchEngine({ teams: [a, b], config: { overs: 5, difficulty: 'normal' }, toss: { winner: a.id, decision: 'bat' } });
  ensureBowler(m, rng);
  return { sim: buildDeliverySim(m, { rng, userTeamId: a.id }), m, rng, a };
}

test('batting: ← → move the batter and no longer swing the shot direction; WASD still aims', () => {
  const kb = new KeyboardControls(null);
  const input = new InputManager({ keyboard: kb, gamepad: new GamepadControls(() => [], null) });
  input.setProfile('batting');
  kb.press('ArrowLeft'); input.update();
  assert.equal(input.value('moveLeft'), 1);
  assert.equal(input.axis(['moveLeft', 'moveRight'], 'batting').x, 0, 'arrow does not aim while batting');
  kb.release('ArrowLeft'); kb.press('KeyD'); input.update();
  assert.equal(input.axis(['moveLeft', 'moveRight'], 'batting').x, 1, 'D still aims to the right');
  assert.equal(input.value('moveRight'), 0);
  kb.release('KeyD');
  // bowling keeps the arrows for the line
  input.setProfile('bowling'); kb.press('ArrowRight'); input.update();
  assert.equal(input.axis().x, 1);
});

test('batting with a controller: the D-pad moves the batter, the stick aims', () => {
  const pad = { id: 'Xbox Wireless Controller', index: 0, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  const input = new InputManager({ keyboard: new KeyboardControls(null), gamepad: new GamepadControls(() => [pad], null) });
  input.setProfile('batting');
  pad.buttons[PAD.RIGHT] = { pressed: true, value: 1 };
  input.update();
  assert.equal(input.value('moveRight'), 1);
  assert.equal(input.axis(['moveLeft', 'moveRight'], 'batting').x, 0);
  pad.buttons[PAD.RIGHT] = { pressed: false, value: 0 };
  pad.axes[0] = -0.9;
  input.update();
  assert.ok(input.axis(['moveLeft', 'moveRight'], 'batting').x < -0.5);
});

test('moving across brings a wide ball into reach and gets in line for the drive', () => {
  const rng = new RNG(4);
  let reached = { stay: 0, across: 0 }, suit = { stay: [], across: [] };
  for (let i = 0; i < 60; i++) {
    const plan = planDelivery(bowler, { type: 'stock', target: { x: 1.25, len: 3 }, power: 0, quality: 1 }, rng);
    const s = plan.path.at(plan.path.timeAtZ(contactZ('coverDrive', 'front')));
    for (const [k, guard] of [['stay', 0], ['across', 0.5]]) {
      const res = resolveShot({ shotId: 'coverDrive', dirDeg: 50, foot: 'front', guard, timingError: 0, batter, bowler, plan, ball: { ...s, bouncedBefore: true }, rng });
      if (res.reason !== 'Out of reach') { reached[k]++; suit[k].push(res.suitability); }
    }
  }
  assert.ok(reached.across > reached.stay + 20, `wide balls reached: ${JSON.stringify(reached)}`);
  const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  assert.ok(avg(suit.across) > avg(suit.stay), 'the drive suits the ball better from the new guard');
});

test('wide calls follow the law when the batter moves', () => {
  const y = 0.5;
  assert.equal(isWideLine({ x: 1.1, y }), true, 'wide of a batter who stays put');
  assert.equal(isWideLine({ x: 1.1, y }, 0.4), false, 'moved across and brought it within reach: not a wide');
  assert.equal(isWideLine({ x: 0.8, y }, -0.6), false, 'backing away to leg cannot make a ball wide');
  assert.equal(isWideLine({ x: -0.75, y }), true, 'wide down the leg side');
  assert.equal(isWideLine({ x: -0.75, y }, -0.4), false, 'moved to leg to meet it');
  assert.equal(isWideLine({ x: -0.75, y }, 0.5), true, 'moving across to off cannot save a leg-side wide');
});

test('the striker shuffles within the crease, only before playing a shot, and only when the player bats', () => {
  const { sim } = userBattingSim(11);
  assert.equal(sim.guard, 0);
  sim.moveGuard(1, 0.05);
  assert.ok(Math.abs(sim.guard - GUARD.speed * 0.05 * sim.scale) < 1e-9, 'moves on the delivery clock');
  assert.ok(Math.abs(sim.strikerRunner.x - (BATTER_X + sim.guard)) < 1e-9, 'the striker (and the field chart) moves too');
  for (let i = 0; i < 100; i++) sim.moveGuard(1, 0.05);
  assert.equal(sim.guard, GUARD.max);
  for (let i = 0; i < 100; i++) sim.moveGuard(-1, 0.05);
  assert.equal(sim.guard, GUARD.min);
  // once the ball is on its way the footwork runs on the slowed delivery clock
  while (sim.phase !== 'flight') sim.update(1 / 60);
  const g0 = sim.guard;
  sim.moveGuard(1, 0.05);
  assert.ok(Math.abs(sim.guard - g0 - GUARD.speed * 0.05 * sim.scale) < 1e-9);
  sim.inputShot({ button: 'defend' });
  const g1 = sim.guard;
  assert.equal(sim.moveGuard(1, 0.05), false, 'feet are set once the shot is played');
  assert.equal(sim.guard, g1);

  const ai = userBattingSim(12);
  ai.sim.control.bat = 'ai';
  assert.equal(ai.sim.moveGuard(1, 0.05), false);
  assert.equal(ai.sim.guard, 0);
});

test('backing away to leg exposes the stumps; moving across covers them with the pads', () => {
  const tally = g => {
    const n = { bowled: 0, lbw: 0 };
    for (let seed = 1; seed <= 120; seed++) {
      const { sim } = userBattingSim(seed);
      sim.setSpec({ type: 'stock', length: 'good', target: { x: 0 }, quality: 1 });
      for (let i = 0; i < 40; i++) sim.moveGuard(Math.sign(g), 0.05);
      sim.guard = g;                                         // exact position for the comparison
      for (let i = 0; i < 3000 && sim.phase !== 'dead'; i++) sim.update(1 / 60);   // no shot offered
      const d = sim.result().dismissal?.type;
      if (d === 'bowled') n.bowled++;
      // LBW as ball tracking has it (the on-field umpire can miss a close one; see DRS.js)
      if (sim.lbw && reviewVerdict(sim.lbw.track, 'notout').out) n.lbw++;
    }
    return n;
  };
  const leg = tally(-0.6), across = tally(0.25);
  assert.ok(leg.bowled > across.bowled + 8, `bowled: ${leg.bowled} backing away vs ${across.bowled} across`);
  assert.equal(leg.lbw, 0, 'no LBW with the pads outside leg stump');
  assert.ok(across.lbw > 8, `LBW risk when the pads are in front (${across.lbw})`);
});
