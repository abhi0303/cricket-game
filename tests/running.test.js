import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputManager } from '../src/controls/InputManager.js';
import { KeyboardControls } from '../src/controls/KeyboardControls.js';
import { GamepadControls } from '../src/controls/GamepadControls.js';
import { PAD, mergeBindings, bindingsForSave, BINDINGS_VERSION } from '../src/controls/Bindings.js';
import { shotAxis } from '../src/game/BattingInput.js';
import { shotFromInput } from '../src/game/ShotModel.js';
import { DIVE } from '../src/game/DeliverySim.js';
import { isSafe, CREASE_Z, BAT_REACH } from '../src/ai/FieldingAI.js';
import { MatchEngine } from '../src/game/MatchEngine.js';
import { generateCpuTeam, createDefaultUserTeam } from '../src/game/TeamManager.js';
import { ensureBowler, buildDeliverySim } from '../src/game/MatchSim.js';
import { RNG } from '../src/utils/Random.js';

globalThis.performance ??= { now: () => Date.now() };

function padInput() {
  const pad = { id: 'Xbox Wireless Controller', index: 0, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  const input = new InputManager({ keyboard: new KeyboardControls(null), gamepad: new GamepadControls(() => [pad], null) });
  input.setProfile('batting');
  const hold = (btn, on = true) => { pad.buttons[btn] = { pressed: on, value: on ? 1 : 0 }; input.update(); };
  return { pad, input, hold };
}

/** A ball in play with the human batting: both batters at home, ready to run. */
function runningSim(seed = 3, { userBats = true } = {}) {
  const rng = new RNG(seed);
  const a = createDefaultUserTeam(rng), b = generateCpuTeam(rng, { difficulty: 'normal' });
  const m = new MatchEngine({ teams: [a, b], config: { overs: 5, difficulty: 'normal' }, toss: { winner: a.id, decision: userBats ? 'bat' : 'bowl' } });
  ensureBowler(m, rng);
  const sim = buildDeliverySim(m, { rng, userTeamId: a.id });
  sim.phase = 'inplay';
  return sim;
}

/** Run until `done(sim)` or the time limit; returns the time taken (s). */
function runUntil(sim, done, { dt = 1 / 240, limit = 8, each = null } = {}) {
  let t = 0;
  while (t < limit && !done(sim)) { if (each) each(sim, t); sim.updateRunners(dt); t += dt; }
  return t;
}

const striker = sim => sim.runners.find(r => r.id === sim.strikerP.id);
const distToGround = (r, end) => (end === 'nonStriker' ? r.z - (CREASE_Z.nonStriker + BAT_REACH) : (CREASE_Z.striker - BAT_REACH) - r.z);

test('controller layout: A ground, B lofted, X precision, Y defend, R3 leave; X run, B back, Y dive; RT/LT sprint', () => {
  const { input, hold } = padInput();
  const check = (btn, actions) => {
    hold(btn);
    for (const a of actions) assert.equal(input.down(a), true, `${a} on button ${btn}`);
    hold(btn, false);
  };
  check(PAD.A, ['ground']);
  check(PAD.B, ['lofted', 'cancelRun']);
  check(PAD.X, ['precision', 'run']);
  check(PAD.Y, ['defend', 'dive']);
  check(PAD.RS, ['leave']);
  check(PAD.RT, ['power', 'sprint']);
  check(PAD.LT, ['sprint']);
  check(PAD.LB, ['advanced']);
  hold(PAD.Y);
  assert.equal(input.down('leave'), false, 'Y is not leave any more');
  hold(PAD.Y, false);
  hold(PAD.A);
  for (const a of ['defend', 'run', 'cancelRun', 'dive', 'leave']) assert.equal(input.down(a), false, `A is not ${a}`);
});

test('an older saved controller layout moves to the new batting buttons once; keys and other profiles are kept', () => {
  const old = mergeBindings(null);
  old.batting.defend = { keys: ['KeyF'], pad: [PAD.A] };
  old.batting.run = { keys: ['Space'], pad: [PAD.LB] };
  old.bowling.bowl = { keys: ['KeyJ'], pad: [PAD.X] };
  const merged = mergeBindings(JSON.parse(JSON.stringify(old)));          // saved before layout versions existed
  assert.deepEqual(merged.batting.defend, { keys: ['KeyF'], pad: [PAD.Y] }, 'custom key kept, pad moved');
  assert.deepEqual(merged.batting.run.pad, [PAD.X]);
  assert.deepEqual(merged.bowling.bowl.pad, [PAD.X], 'bowling buttons untouched');
  // once saved with the new version, the player's own controller choices stick
  const mine = mergeBindings(null);
  mine.batting.leave.pad = [PAD.LB];
  const saved = JSON.parse(JSON.stringify(bindingsForSave(mine)));
  assert.equal(saved._v, BINDINGS_VERSION);
  assert.deepEqual(mergeBindings(saved).batting.leave.pad, [PAD.LB]);
  // a layout saved under version 2 (Y leave, RB defend) moves to Y defend and R3 leave
  const v2 = { ...JSON.parse(JSON.stringify(mergeBindings(null))), _v: 2 };
  v2.batting.leave = { keys: ['KeyU'], pad: [PAD.Y] };
  v2.batting.defend = { keys: ['KeyJ'], pad: [PAD.RB] };
  const up = mergeBindings(v2);
  assert.deepEqual(up.batting.defend.pad, [PAD.Y]);
  assert.deepEqual(up.batting.leave.pad, [PAD.RS]);
});

test('shot direction follows the picture: in the TV view down is forward, behind the batter up is', () => {
  // Stick down in the TV (bowler's end) view: towards the bowler on screen = front foot, straight.
  let ax = shotAxis({ x: 0, y: -1 }, 'bowlerEnd');
  assert.equal(ax.y, 1);
  assert.equal(shotFromInput('ground', ax.x, ax.y).foot, 'front');
  ax = shotAxis({ x: 0, y: 1 }, 'bowlerEnd');
  assert.equal(shotFromInput('ground', ax.x, ax.y).foot, 'back', 'stick up (towards the keeper on screen): back foot');
  // left/right stays mirrored as before: screen-right is the leg side from the bowler's end
  assert.equal(shotAxis({ x: 1, y: 0 }, 'bowlerEnd').x, -1);
  // behind the batter nothing changes
  assert.deepEqual(shotAxis({ x: 0.5, y: 1 }, 'behind'), { x: 0.5, y: 1 });
  assert.equal(shotFromInput('ground', 0, 1).foot, 'front');
});

test('sprinting gets both batters through a run a little quicker', () => {
  const time = sprint => {
    const sim = runningSim(5);
    sim.applyRunCommand('run');
    return runUntil(sim, s => s.runsCompleted >= 1, { each: s => s.setSprint(sprint) });
  };
  const normal = time(false), fast = time(true);
  assert.ok(fast < normal * 0.94 && fast > normal * 0.82, `run in ${fast.toFixed(2)} s sprinting vs ${normal.toFixed(2)} s`);
  // only for the human batting side
  const ai = runningSim(5, { userBats: false });
  ai.setSprint(true);
  assert.equal(ai.sprint, false);
});

test('a dive near the crease gets the bat in sooner than running; called early, the batter dives when he gets there', () => {
  // striker running to the bowler's end
  const toSafety = callAt => {
    const sim = runningSim(7);
    sim.applyRunCommand('run');
    let called = false, firstDiveAt = null;
    const t = runUntil(sim, s => isSafe(striker(s), 'nonStriker'), {
      each: s => {
        const r = striker(s);
        if (callAt && !called && r.target && distToGround(r, 'nonStriker') <= callAt) { called = true; s.inputDive(); }
        if (r.dive && firstDiveAt == null) firstDiveAt = distToGround(r, 'nonStriker');
      },
    });
    return { t, firstDiveAt, sim };
  };
  const run = toSafety(0), dive = toSafety(2.3), early = toSafety(7);
  assert.ok(dive.t < run.t - 0.05, `diving: bat in after ${dive.t.toFixed(2)} s, running ${run.t.toFixed(2)} s`);
  assert.ok(early.firstDiveAt != null && early.firstDiveAt <= DIVE.range + 0.05, `called 7 m out, dived ${early.firstDiveAt?.toFixed(2)} m from the crease`);
  assert.ok(early.t < run.t - 0.05, 'and still gets home sooner than running it in');
  assert.ok(DIVE.range <= 2.5, 'never a dive from mid-pitch');
});

test('a dive calls off the next run: the batters stay in until the player calls again', () => {
  const sim = runningSim(8);
  sim.applyRunCommand('run');
  sim.applyRunCommand('run');                       // a second run already called...
  assert.equal(sim.queuedRun, true);
  runUntil(sim, s => distToGround(striker(s), 'nonStriker') < 5);
  sim.inputDive();                                  // ...then a dive for the crease
  assert.equal(sim.queuedRun, false, 'the dive cancels it');
  runUntil(sim, s => s.runsCompleted >= 1 && s.runState === 'idle', { limit: 6 });
  runUntil(sim, () => false, { limit: 1.5 });       // time passes: nobody sets off again
  assert.equal(sim.runsCompleted, 1);
  assert.equal(sim.runState, 'idle');
  // the computer calling the runs (assisted running) doesn't set off either...
  sim.control.running = 'ai';
  sim.applyRunCommand('run');
  assert.equal(sim.runState, 'idle', 'no automatic run after a dive');
  // ...until the player calls it
  sim.inputRun('run');
  assert.equal(sim.runState, 'running', 'X / Space starts the next run');
  assert.equal(sim.holdRuns, false);
});

test('a batter who dives home completes the run and is safe while getting up', () => {
  const sim = runningSim(9);
  sim.applyRunCommand('run');
  let dived = false;
  runUntil(sim, s => s.runsCompleted >= 1, { each: s => { if (!dived && distToGround(striker(s), 'nonStriker') <= 2) dived = s.inputDive() > 0; } });
  assert.equal(sim.runsCompleted, 1);
  const r = striker(sim);
  assert.equal(r.end, 'nonStriker');
  assert.ok(isSafe(r, 'nonStriker'), 'grounded by the dive');
  runUntil(sim, s => !striker(s).dive, { limit: 2 });
  assert.ok(isSafe({ z: r.z, end: r.end }, 'nonStriker'), 'and back on their feet inside the crease');
  // the next run starts afresh from there, when the player calls it
  sim.inputRun('run');
  assert.equal(r.madeGround, null);
  assert.ok(DIVE.total > 1);
});

test('dive and sprint do nothing before the ball is in play or for the computer batting side', () => {
  const sim = runningSim(11);
  sim.phase = 'flight';
  assert.equal(sim.inputDive(), 0);
  const ai = runningSim(11, { userBats: false });
  ai.applyRunCommand('run');
  runUntil(ai, s => distToGround(striker(s), 'nonStriker') < 2);
  assert.equal(ai.inputDive(), 0);
});
