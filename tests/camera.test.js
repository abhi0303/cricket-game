import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battingCam, bowlingCam, toWorld, STRIKER_Z, BOWLER_END_Z, BATTING_VIEWS, viewMirrored, normalizeBattingView, followCam } from '../src/scene/CameraPoses.js';

test('batting camera sits behind the striker and looks toward the bowler', () => {
  for (const v of ['behind', 'behindLow', 'behindHigh']) {
    const c = battingCam(v);
    assert.ok(c.pos[2] > STRIKER_Z, 'camera is behind the striker\'s stumps');
    assert.ok(c.target[2] < c.pos[2] - 10, 'looking down the pitch');
    assert.ok(Math.abs(c.pos[0]) < 1.5, 'not a side-on spectator angle');
    assert.ok(c.pos[1] > 1.2 && c.pos[1] < 6);
  }
});

test('bowling camera stays behind the bowler and looks at the striker', () => {
  for (const z of [-26, -18, -10, -8.95]) {
    const c = bowlingCam({ x: 1, z }, 'runup');
    assert.ok(c.pos[2] < Math.min(z, -9.2), 'camera is behind the bowler');
    assert.ok(c.target[2] > 5, 'looking at the batter end');
  }
  const aim = bowlingCam({ x: 1, z: -26 }, 'aim');
  assert.ok(aim.pos[2] < BOWLER_END_Z && aim.target[2] > 0);
});

test('switching ends rotates cameras consistently', () => {
  const c = battingCam();
  const a = toWorld(c.pos, 0);
  const b = toWorld(c.pos, Math.PI);
  assert.ok(Math.abs(a[2] + b[2]) < 1e-9, 'mirrors across the pitch centre');
  assert.ok(Math.abs(a[0] + b[0]) < 1e-9);
  assert.equal(a[1], b[1]);
  // Batter and bowler always at opposite ends in either orientation
  for (const yaw of [0, Math.PI]) {
    const striker = toWorld([0, 0, STRIKER_Z], yaw), bowler = toWorld([0, 0, BOWLER_END_Z], yaw);
    assert.ok(Math.sign(striker[2]) !== Math.sign(bowler[2]));
    const cam = toWorld(battingCam().pos, yaw);
    assert.ok(Math.sign(cam[2]) === Math.sign(striker[2]), 'batting camera is at the striker\'s end');
  }
});

test("bowler's-end and umpire views look from behind the bowler's stumps at the striker", () => {
  for (const v of ['bowlerEnd', 'umpire']) {
    const c = battingCam(v);
    assert.ok(c.pos[2] < BOWLER_END_Z, `${v} is behind the bowler's stumps`);
    assert.ok(c.target[2] > 5, `${v} looks at the striker`);
    assert.ok(viewMirrored(v), `${v} mirrors the stick`);
  }
  assert.equal(viewMirrored('behind'), false);
  const u = battingCam('umpire');
  assert.ok(u.pos[1] > 1.4 && u.pos[1] < 1.9, 'umpire eye height');
});

test('every batting view is selectable, old setting names still work', () => {
  for (const v of BATTING_VIEWS) assert.ok(battingCam(v.id).pos.length === 3);
  assert.equal(normalizeBattingView('standard'), 'behind');
  assert.equal(normalizeBattingView('high'), 'behindHigh');
  assert.equal(normalizeBattingView('nonsense'), 'behind');
});

test('follow camera stays at the end the player watches from', () => {
  const ball = { x: 5, y: 2, z: -20 };
  assert.ok(followCam(ball, 'striker').pos[2] > STRIKER_Z);
  assert.ok(followCam(ball, 'bowler').pos[2] < BOWLER_END_Z);
});
