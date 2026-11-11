import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartPoint, fieldCounts, chartColor } from '../src/ui/FieldMap.js';
import { battingCam } from '../src/scene/CameraPoses.js';

test('field chart turns with the camera: what is on the right of the screen is on the right of the chart', () => {
  const cx = 100, cy = 100, k = 1;
  // Behind the batsman (camera looks towards the bowler): off side on the right, bowler at the top.
  let [x, y] = chartPoint(20, 0, -1, cx, cy, k);
  assert.ok(x > cx, 'off side right');
  [x, y] = chartPoint(0, -10, -1, cx, cy, k);
  assert.ok(y < cy, "bowler's end at the top");
  // From the bowler's end (TV view): the striker at the top and the off side on the left.
  [x, y] = chartPoint(0, 10, 1, cx, cy, k);
  assert.ok(y < cy, 'striker at the top');
  [x] = chartPoint(20, 0, 1, cx, cy, k);
  assert.ok(x < cx, 'off side left');
});

test('field counts split off and leg side and count the inner circle', () => {
  const n = fieldCounts([{ x: 5, z: 18 }, { x: 20, z: 0 }, { x: -40, z: -20 }, { x: -3, z: 12 }, { x: 0.5, z: -45 }]);
  assert.deepEqual(n, { off: 3, leg: 2, inside: 3 });
});

test('chart dots stay visible on the grass', () => {
  assert.equal(chartColor('#b3121a'), '#b3121a');
  assert.equal(chartColor('#14806a', '#f4d35e'), '#f4d35e', 'green kit falls back to the second colour');
  assert.equal(chartColor('#2e7d32', '#145a20'), '#ffffff');
});

test('TV broadcast camera frames the shot like television', () => {
  const c = battingCam('bowlerEnd');
  const V = c.fov * Math.PI / 180;
  // vertical screen position (0 top .. 1 bottom) of a point in the camera's vertical plane
  const dirAngle = (p) => Math.atan2(p[1] - c.pos[1], Math.hypot(p[0] - c.pos[0], p[2] - c.pos[2]));
  const centre = dirAngle(c.target);
  const yOf = (p) => 0.5 - 0.5 * Math.tan(dirAngle(p) - centre) / Math.tan(V / 2);
  const striker = yOf([-0.32, 0, 9.1]), crease = yOf([0, 0, -10.06]), keeper = yOf([0.15, 0, 18.5]);
  assert.ok(striker > 0.22 && striker < 0.42, `batter about a third of the way down (${striker.toFixed(2)})`);
  assert.ok(keeper > 0 && keeper < striker, 'keeper in shot above the batter');
  assert.ok(crease > 0.75 && crease < 0.9, `bowler's crease just above the score strip (${crease.toFixed(2)})`);
  assert.ok(c.fov < 10 && c.pos[1] > 9, 'long lens from high up');
});
