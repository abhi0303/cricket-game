import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIPS, getClip, emptyPose, blendPose, copyPose, sweetSpot, CONTACT_T, JOINTS } from '../src/scene/Animations.js';

const sample = (name, t) => getClip(name).sample(t, emptyPose());
const FRONT = ['defend', 'straightDrive', 'coverDrive', 'flick', 'lofted', 'sweep'];
const BACK = ['defendBack', 'punch', 'cut', 'pull', 'hook'];

test('every clip samples finite values over its whole length', () => {
  for (const [name, clip] of Object.entries(CLIPS)) {
    for (let t = 0; t <= clip.dur + 0.2; t += 0.05) {
      const p = clip.sample(t, emptyPose());
      for (const j of JOINTS) assert.ok(p[j].every(Number.isFinite), `${name} ${j} @${t.toFixed(2)}`);
      if (p.bat) assert.ok([...p.bat.H, ...p.bat.T, ...p.bat.F].every(Number.isFinite), `${name} bat`);
    }
  }
});

test('front-foot shots stride towards the bowler and meet the ball beside the front pad', () => {
  const stance = sample('stance', 0);
  for (const s of FRONT) {
    const p = sample('shot_' + s, CONTACT_T);
    assert.ok(p.legIK === 1 && p.ftL && p.ftR, `${s} plants its feet`);
    assert.ok(p.ftL[0] > stance.ftL[0] + 0.3, `${s} front foot goes forward`);
    const sw = sweetSpot(p.bat);
    assert.ok(sw[0] > 0.5 && sw[0] < 1.1, `${s} contact in front of the body (x=${sw[0].toFixed(2)})`);
    assert.ok(Math.abs(sw[0] - p.ftL[0]) < 0.4, `${s} bat close to the front foot`);
  }
});

test('back-foot shots go back and across and meet the ball level with the body', () => {
  const stance = sample('stance', 0);
  for (const s of BACK) {
    const p = sample('shot_' + s, CONTACT_T);
    assert.ok(p.ftR[0] < stance.ftR[0] - 0.04, `${s} back foot goes back`);
    assert.ok(p.ftR[1] > stance.ftR[1] + 0.1, `${s} back foot goes across`);
    const sw = sweetSpot(p.bat);
    assert.ok(sw[0] > -0.4 && sw[0] < 0.35, `${s} contact level with the body (x=${sw[0].toFixed(2)})`);
  }
});

test('the bat keeps moving through contact (no stop at the ball)', () => {
  for (const s of ['straightDrive', 'coverDrive', 'flick', 'lofted', 'pull', 'hook', 'cut', 'sweep']) {
    const at = t => sweetSpot(sample('shot_' + s, t).bat);
    const dt = 0.01;
    const v = (a, b) => Math.hypot(...a.map((c, i) => (b[i] - c) / dt));
    const before = v(at(CONTACT_T - dt), at(CONTACT_T)), after = v(at(CONTACT_T), at(CONTACT_T + dt));
    assert.ok(before > 2 && after > 2, `${s} bat speed at contact ${before.toFixed(1)} / ${after.toFixed(1)} m/s (clip time)`);
    assert.ok(Math.abs(before - after) / Math.max(before, after) < 0.5, `${s} smooth through contact`);
  }
});

test('drives finish high; defensive shots stay down', () => {
  for (const s of ['straightDrive', 'coverDrive', 'lofted']) assert.ok(sample('shot_' + s, 0.6).bat.H[1] > 1.45, `${s} high finish`);
  for (const s of ['defend', 'defendBack']) assert.ok(sample('shot_' + s, 0.6).bat.H[1] < 1.4, `${s} dead bat`);
});

test('blending fades leg IK out and keeps the foot targets until it is off', () => {
  const a = sample('stance', 0), b = sample('runBat', 0);
  assert.equal(b.legIK, 0);
  const mid = blendPose(emptyPose(), a, b, 0.5);
  assert.ok(Math.abs(mid.legIK - 0.5) < 1e-9);
  assert.deepEqual(mid.ftL, a.ftL);
  const c = copyPose(emptyPose(), a);
  assert.deepEqual(c.ftR, a.ftR);
  assert.notEqual(c.ftR, a.ftR, 'copy, not a shared array');
});

test('feet never sink into the ground and heels lift on the back foot in drives', () => {
  for (const s of [...FRONT, ...BACK]) {
    for (let t = 0; t <= 1.6; t += 0.1) {
      const p = sample('shot_' + s, t);
      for (const f of [p.ftL, p.ftR]) assert.ok(f[3] >= 0, `${s} heel lift >= 0`);
    }
  }
  assert.ok(sample('shot_straightDrive', 0.48).ftR[3] > 0.04, 'back heel up in the follow-through');
});
