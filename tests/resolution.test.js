import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratioRange, ResolutionGovernor, QUALITY } from '../src/scene/Resolution.js';

test('a phone renders sharp: up to twice its CSS pixels, not stretched up from less than one', () => {
  for (const q of ['low', 'medium']) {
    const r = ratioRange(q, { dpr: 3, touch: true });
    assert.equal(r.max, 2, `${q} on a 3x phone`);
    assert.ok(r.min >= 0.75);
  }
  assert.equal(ratioRange('high', { dpr: 3, touch: true }).max, 3);
  assert.equal(ratioRange('low', { dpr: 2, touch: false }).max, 1, 'a desktop on Low stays at 1');
  assert.equal(ratioRange('medium', { dpr: 1, touch: true }).max, 1, 'never above the screen');
  for (const q of Object.values(QUALITY)) assert.equal(q.fps, 60, 'every preset aims at 60 fps');
});

function run(gov, ms, seconds) { for (let t = 0; t < seconds * 1000; t += ms) gov.frame(ms); }

test('the governor keeps a fast device at full resolution', () => {
  const applied = [];
  const g = new ResolutionGovernor({ min: 0.75, max: 2, fps: 60, apply: r => applied.push(r) });
  run(g, 16.6, 20);
  assert.equal(g.ratio, 2);
  assert.equal(g.fps, 60);
  assert.deepEqual(applied, [2]);
});

test('slow frames bring the resolution down; at the floor and still slow it settles at 30 fps', () => {
  const g = new ResolutionGovernor({ min: 0.75, max: 2, fps: 60 });
  run(g, 28, 5);   // 2 s warm-up, then two slow seconds
  assert.ok(g.ratio < 2, `stepped down (${g.ratio.toFixed(2)})`);
  run(g, 28, 30);
  assert.equal(g.ratio, 0.75, 'at the floor');
  assert.equal(g.fps, 30, 'then 30 fps');
  // at 30 fps it keeps up; it tries 60 once, finds it slow, and stays at 30
  run(g, 33.4, 6);
  run(g, 28, 4);
  run(g, 33.4, 20);
  assert.equal(g.fps, 30);
});

test('a device that keeps up at a lower resolution climbs back, and stops below the level that was too much', () => {
  // frame time grows with the pixels drawn: this device manages 60 fps up to about 1.4
  const g = new ResolutionGovernor({ min: 0.75, max: 2, fps: 60 });
  const ms = () => 16.6 * Math.max(1, (g.ratio / 1.4) ** 2);
  for (let t = 0; t < 120000;) { const m = ms(); g.frame(m); t += m; }
  const settled = ms() / 16.6;
  assert.ok(g.ratio > 1.1 && settled < 1.15, `settled near what it can do (${g.ratio.toFixed(2)}, frames ${((settled - 1) * 100).toFixed(0)}% over)`);
  const r = g.ratio;
  for (let t = 0; t < 60000;) { const m = ms(); g.frame(m); t += m; }
  assert.equal(g.ratio, r, 'and stays there');
});

test('stalls (a hidden tab, loading) are not counted as slow frames', () => {
  const g = new ResolutionGovernor({ min: 0.75, max: 2, fps: 60 });
  run(g, 16.6, 3);
  for (let i = 0; i < 20; i++) { g.frame(900); g.frame(16.6); }
  run(g, 16.6, 3);
  assert.equal(g.ratio, 2);
});
