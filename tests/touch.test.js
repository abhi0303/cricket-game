import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchControls, SLOT_OF_PAD } from '../src/controls/TouchControls.js';
import { InputManager } from '../src/controls/InputManager.js';
import { KeyboardControls } from '../src/controls/KeyboardControls.js';
import { GamepadControls } from '../src/controls/GamepadControls.js';
import { PAD } from '../src/controls/Bindings.js';
import { SHOT_HINTS } from '../src/game/BattingInput.js';

globalThis.performance ??= { now: () => Date.now() };

function setup() {
  const touch = new TouchControls();
  const input = new InputManager({ keyboard: new KeyboardControls(null), gamepad: new GamepadControls(() => [], null), touch });
  return { touch, input };
}

test('a touch button is a press like a key: once on the frame it goes down, and a quick tap between frames still counts', () => {
  const { touch, input } = setup();
  input.setProfile('batting');
  touch.press('ground');
  input.update(1 / 60);
  assert.equal(input.pressed('ground'), true);
  input.update(1 / 60);
  assert.equal(input.pressed('ground'), false, 'held: no second press');
  assert.equal(input.down('ground'), true);
  touch.release('ground');
  input.update(1 / 60);
  assert.equal(input.down('ground'), false);
  // tapped and lifted before the next frame
  touch.press('lofted'); touch.release('lofted');
  input.update(1 / 60);
  assert.equal(input.pressed('lofted'), true);
  assert.equal(input.lastDevice, 'touch');
});

test('the thumb-stick aims like the controller stick (up is forward), with a small dead zone', () => {
  const { touch, input } = setup();
  input.setProfile('batting');
  touch.setStick(0.05, 0.05);
  assert.deepEqual(input.axis(), { x: 0, y: 0 });
  touch.setStick(1, 0);
  assert.ok(Math.abs(input.axis().x - 1) < 1e-9);
  touch.setStick(0, 1);
  assert.ok(input.axis().y > 0.99, 'pushed up: forward (front foot)');
  touch.setStick(2, 2);
  const a = input.axis();
  assert.ok(Math.hypot(a.x, a.y) <= 1 + 1e-9, 'never more than full');
});

test('Power and Precision are toggles on touch, cleared once they are no longer offered (the shot is played)', () => {
  const { touch, input } = setup();
  input.setProfile('batting');
  touch.offer('batting', SHOT_HINTS);
  touch.press('power'); touch.release('power');
  input.update(1 / 60);
  assert.equal(input.value('power'), 1, 'armed after a tap');
  touch.press('power'); touch.release('power');
  assert.equal(input.value('power'), 0, 'a second tap clears it');
  touch.press('precision');
  touch.offer('batting', [['run', 'Run']]);
  assert.equal(input.value('precision'), 0, 'cleared when the ball is in play');
});

test('the buttons are the choices on offer, each where its controller button is', () => {
  const { touch, input } = setup();
  touch.offer('batting', SHOT_HINTS);
  const lay = touch.layout(input.bindings);
  const at = a => lay.find(b => b.action === a)?.slot;
  assert.equal(at('ground'), SLOT_OF_PAD[PAD.A]);
  assert.equal(at('lofted'), SLOT_OF_PAD[PAD.B]);
  assert.equal(at('precision'), SLOT_OF_PAD[PAD.X]);
  assert.equal(at('defend'), SLOT_OF_PAD[PAD.Y]);
  assert.equal(at('leave'), SLOT_OF_PAD[PAD.RS]);
  assert.equal(at('moveLeft'), 'dl');
  assert.equal(at('moveRight'), 'dr');
  assert.ok(touch.aims(), 'the thumb-stick shows while a shot is on offer');
  touch.offer('batting', [['run', 'Run'], ['cancelRun', 'Stay in']]);
  assert.deepEqual(touch.layout(input.bindings).map(b => b.action), ['run', 'cancelRun']);
  assert.ok(!touch.aims(), 'no stick while running');
  // every slot used by a default batting, bowling, fielding or between-balls button is a place on screen
  for (const prof of ['batting', 'bowling', 'fielding', 'between']) {
    for (const [a, b] of Object.entries(input.bindings[prof])) if (!['pause', 'camera'].includes(a)) assert.ok(SLOT_OF_PAD[b.pad[0]], `${prof}.${a} has a place`);
  }
});

test('a touch press is back-dated by when the finger went down', () => {
  const { touch, input } = setup();
  input.setProfile('batting');
  touch.press('ground', performance.now() - 30);
  input.update(1 / 60);
  const age = input.pressAge('ground');
  assert.ok(age >= 0.025 && age < 0.2, `age ${age}`);
});
