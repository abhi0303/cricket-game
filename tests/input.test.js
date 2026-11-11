import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputManager } from '../src/controls/InputManager.js';
import { KeyboardControls } from '../src/controls/KeyboardControls.js';
import { GamepadControls, applyDeadzone, padStyle } from '../src/controls/GamepadControls.js';
import { mergeBindings, PAD, BINDINGS_VERSION } from '../src/controls/Bindings.js';

globalThis.performance ??= { now: () => Date.now() };

function fakePad(id = 'Xbox Wireless Controller') {
  return { id, index: 0, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
}
function setup(pads = []) {
  const kb = new KeyboardControls(null);
  const gp = new GamepadControls(() => pads, null);
  const input = new InputManager({ keyboard: kb, gamepad: gp });
  return { kb, gp, input, pads };
}

test('a held key fires "pressed" once, not every frame', () => {
  const { kb, input } = setup();
  input.setProfile('batting');
  kb.press('KeyJ');
  input.update();
  assert.equal(input.pressed('defend'), true);
  for (let i = 0; i < 5; i++) { input.update(); assert.equal(input.pressed('defend'), false); assert.equal(input.down('defend'), true); }
  kb.release('KeyJ'); input.update();
  assert.equal(input.released('defend'), true);
  kb.press('KeyJ'); input.update();
  assert.equal(input.pressed('defend'), true);
});

test('switching profiles does not turn a held button into a new press', () => {
  const { kb, input } = setup();
  input.setProfile('between');
  kb.press('KeyJ'); input.update();
  assert.equal(input.pressed('continue'), true);
  input.setProfile('bowling');
  input.update();
  assert.equal(input.pressed('bowl'), false, 'still the same press');
  kb.release('KeyJ'); input.update();
  assert.equal(input.released('bowl'), true);
});

test('profiles map the same button to different actions', () => {
  const pad = fakePad();
  const { input } = setup([pad]);
  pad.buttons[PAD.A] = { pressed: true, value: 1 };
  input.setProfile('batting'); input.update();
  assert.equal(input.down('ground'), true);
  input.setProfile('bowling'); input.update();
  assert.equal(input.down('bowl'), true);
  input.setProfile('fielding'); input.update();
  assert.equal(input.down('throwKeeper'), true);
});

test('analog triggers give a value, keyboard modifier gives 1', () => {
  const pad = fakePad();
  const { kb, input } = setup([pad]);
  input.setProfile('bowling');
  pad.buttons[PAD.RT] = { pressed: false, value: 0.4 };
  input.update();
  assert.ok(Math.abs(input.value('power') - 0.4) < 1e-9);
  kb.press('ShiftLeft');
  assert.equal(input.value('power'), 1);
});

test('stick dead zone and rescaling', () => {
  assert.deepEqual(applyDeadzone(0.1, 0.1), { x: 0, y: 0 });
  const full = applyDeadzone(1, 0);
  assert.ok(Math.abs(full.x - 1) < 1e-9);
  const mid = applyDeadzone(0.6, 0);
  assert.ok(mid.x > 0 && mid.x < 0.6);
});

test('axis combines keyboard and stick, y up is positive', () => {
  const pad = fakePad();
  const { kb, input } = setup([pad]);
  kb.press('KeyD');
  input.update();
  assert.deepEqual(input.axis(), { x: 1, y: 0 });
  kb.release('KeyD');
  pad.axes = [0, -1, 0, 0]; // stick pushed up
  input.update();
  assert.ok(input.axis().y > 0.99);
});

test('controller connect and disconnect are detected and keyboard still works', () => {
  const pads = [];
  const { kb, gp, input } = setup(pads);
  const seen = [];
  gp.onChange(s => seen.push(s.connected));
  input.update();
  assert.equal(gp.connected, false);
  pads.push(fakePad('054c-0ce6-DualSense Wireless Controller'));
  input.update();
  assert.equal(gp.connected, true);
  assert.equal(gp.style, 'ps');
  pads.length = 0;
  input.update();
  assert.equal(gp.connected, false);
  assert.deepEqual(seen, [true, false]);
  input.setProfile('batting');
  kb.press('KeyK'); input.update();
  assert.equal(input.pressed('ground'), true, 'keyboard keeps working without a controller');
});

test('controller style detection', () => {
  assert.equal(padStyle('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'xbox');
  assert.equal(padStyle('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'), 'ps');
  assert.equal(padStyle('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'xbox', 'Xbox Series pad');
  assert.equal(padStyle('Xbox Wireless Controller'), 'xbox');
  assert.equal(padStyle('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'ps');
});

test('saved bindings override defaults and bad data is ignored', () => {
  const b = mergeBindings({ _v: BINDINGS_VERSION, batting: { defend: { keys: ['KeyF'], pad: [3] }, bogus: { keys: ['X'], pad: [] } }, nope: 1 });
  assert.deepEqual(b.batting.defend, { keys: ['KeyF'], pad: [3] });
  assert.equal(b.batting.bogus, undefined);
  assert.deepEqual(b.batting.lofted.keys, ['KeyL']);
  const { kb, input } = setup();
  input.setBindings({ batting: { defend: { keys: ['KeyF'], pad: [0] } } });
  input.setProfile('batting');
  kb.press('KeyF'); input.update();
  assert.equal(input.pressed('defend'), true);
});
