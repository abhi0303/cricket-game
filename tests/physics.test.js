import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDelivery, PITCH, simulateBattedBall, launchVelocity } from '../src/game/BallPhysics.js';
import { resolveShot, suitability, timingWindows, classifyTiming, shotFromInput, contactZ } from '../src/game/ShotModel.js';
import { normalizePlayer } from '../src/game/PlayerAttributes.js';
import { RNG } from '../src/utils/Random.js';

const bowler = (bowlingType, extra = {}) => normalizePlayer({ id: 'b', name: 'B', number: 1, role: 'bowler', bowlingType, bowlAccuracy: 85, bowlSpeed: 70, bowlMovement: 80, bowlStamina: 70, ...extra });
const batter = (battingStyle, extra = {}) => normalizePlayer({ id: 'x', name: 'X', number: 2, role: 'batsman', battingStyle, batting: 75, timing: 75, aggression: battingStyle === 'attacker' ? 85 : 30, ...extra });
const spec = (o = {}) => ({ type: 'stock', target: { x: 0.1, len: 6 }, power: 0, quality: 1, ...o });

const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

test('an accurate bowler pitches close to the target', () => {
  const rng = new RNG(1);
  const lens = [], xs = [];
  for (let i = 0; i < 200; i++) {
    const p = planDelivery(bowler('fast'), spec(), rng);
    lens.push(p.bounceLen); xs.push(p.bounce.x);
  }
  assert.ok(Math.abs(avg(lens) - 6) < 0.25, `mean length ${avg(lens)}`);
  assert.ok(Math.abs(avg(xs) - 0.1) < 0.05, `mean line ${avg(xs)}`);
});

test('faster bowling types are quicker', () => {
  const rng = new RNG(2);
  const kph = t => avg(Array.from({ length: 40 }, () => planDelivery(bowler(t), spec(), rng).speedKph));
  assert.ok(kph('fast') > kph('fast-medium'));
  assert.ok(kph('fast-medium') > kph('medium'));
  assert.ok(kph('medium') > kph('off-spin'));
});

test('off-spin turns into the right-hander, leg-spin away', () => {
  const rng = new RNG(3);
  const turn = t => avg(Array.from({ length: 60 }, () => {
    const p = planDelivery(bowler(t), spec({ target: { x: 0.1, len: 4.5 } }), rng);
    const after = p.path.at(p.path.timeAtZ(PITCH.half)).p;
    return after.x - p.bounce.x;
  }));
  assert.ok(turn('off-spin') < -0.05, 'off-break moves to the leg side (-x)');
  assert.ok(turn('leg-spin') > 0.05, 'leg-break moves to the off side (+x)');
});

test('outswinger curves away, inswinger curves in', () => {
  const rng = new RNG(4);
  // Swing bends the flight: compare the mid-flight position with a straight line from release to pitch.
  const curve = type => avg(Array.from({ length: 60 }, () => {
    const p = planDelivery(bowler('medium'), spec({ type }), rng);
    const mid = p.path.at(p.bounce.t / 2).p;
    const lin = (p.release.x + p.bounce.x) / 2;
    return lin - mid.x; // > 0: ball moves towards +x (off side) late
  }));
  assert.ok(curve('outswing') > 0.02, `outswing ${curve('outswing')}`);
  assert.ok(curve('inswing') < -0.02, `inswing ${curve('inswing')}`);
});

test('a bouncer arrives higher than a yorker', () => {
  const rng = new RNG(5);
  const b = planDelivery(bowler('fast'), spec({ length: 'bouncer', speedKph: 140, target: { x: 0.2, len: 12.5 } }), rng);
  const y = planDelivery(bowler('fast'), spec({ length: 'yorker', speedKph: 140, target: { x: 0, len: 0.6 } }), rng);
  assert.ok(b.heightAtCrease > 1.2, `bouncer ${b.heightAtCrease}`);
  assert.ok(y.heightAtCrease < 0.5, `yorker ${y.heightAtCrease}`);
});

test('a ball pitched on off stump at a good length would hit the stumps (angle from over the wicket)', () => {
  const rng = new RNG(6);
  let hits = 0;
  for (let i = 0; i < 50; i++) hits += planDelivery(bowler('medium', { bowlAccuracy: 99 }), spec({ target: { x: 0.12, len: 5.5 } }), rng).hitsStumps ? 1 : 0;
  assert.ok(hits > 25, `hits ${hits}`);
});

test('timing windows: perfect < good < ok, wider for better timers and on easy', () => {
  const good = timingWindows(batter('defensive', { timing: 90 }));
  const poor = timingWindows(batter('attacker', { timing: 30 }));
  assert.ok(good.perfect < good.good && good.good < good.ok);
  assert.ok(good.perfect > poor.perfect);
  const easy = timingWindows(batter('attacker'), { windowMult: 1.35 });
  assert.ok(easy.ok > timingWindows(batter('attacker')).ok);
  assert.equal(classifyTiming(0, good), 'perfect');
  assert.equal(classifyTiming(-good.ok * 0.95, good), 'early');
  assert.equal(classifyTiming(good.ok * 1.1, good), 'missed-late');
});

test('shot suitability follows line and length', () => {
  const b = batter('attacker', { technique: 'balanced' });
  assert.ok(suitability('pull', 11, 0, 1.1, b, 'pace') > suitability('straightDrive', 11, 0, 1.1, b, 'pace'));
  assert.ok(suitability('coverDrive', 3, 0.5, 0.4, b, 'pace') > suitability('cut', 3, 0.5, 0.4, b, 'pace'));
  assert.ok(suitability('cut', 9, 0.7, 0.9, b, 'pace') > suitability('flick', 9, 0.7, 0.9, b, 'pace'));
  // Sweep is a spinner's shot
  assert.ok(suitability('sweep', 4, 0, 0.3, b, 'spin') > suitability('sweep', 4, 0, 0.3, b, 'pace'));
});

test('input mapping: stick + button pick the expected shots', () => {
  assert.equal(shotFromInput('ground', 0.8, 0.8).shotId, 'coverDrive');
  assert.equal(shotFromInput('ground', 0, 0.8).shotId, 'straightDrive');
  assert.equal(shotFromInput('ground', -0.8, -0.8).shotId, 'pull');
  assert.equal(shotFromInput('ground', 0.8, -0.8).shotId, 'cut');
  assert.equal(shotFromInput('lofted', -0.6, -0.8).shotId, 'hook');
  assert.equal(shotFromInput('lofted', 0.3, 0.5).shotId, 'lofted');
  assert.equal(shotFromInput('advanced', -0.5, 0).shotId, 'sweep');
  assert.equal(shotFromInput('defend', 0, -0.9).foot, 'back');
  assert.equal(shotFromInput('leave').shotId, 'leave');
  assert.ok(contactZ('straightDrive', 'front') < contactZ('pull', 'back'));
});

test('a perfectly timed lofted shot does not always go for six', () => {
  const rng = new RNG(8);
  const b = batter('attacker');
  const bw = bowler('medium');
  let sixes = 0, n = 0;
  for (let i = 0; i < 150; i++) {
    const plan = planDelivery(bw, spec({ target: { x: 0.1, len: 3 } }), rng);
    const t = plan.path.timeAtZ(contactZ('lofted', 'front'));
    const s = plan.path.at(t);
    const res = resolveShot({ shotId: 'lofted', dirDeg: rng.range(-60, 60), foot: 'front', timingError: 0, batter: b, bowler: bw, plan, ball: { ...s, bouncedBefore: true }, rng });
    if (res.result !== 'clean' && res.result !== 'edge') continue;
    n++;
    const flight = simulateBattedBall(s.p, launchVelocity(res.launch.speed, res.launch.dir, res.launch.elev));
    if (flight.boundary && flight.boundary.runs === 6) sixes++;
  }
  assert.ok(n > 100);
  assert.ok(sixes < n * 0.9, `sixes ${sixes}/${n}`);
  assert.ok(sixes > n * 0.15, `sixes ${sixes}/${n}`);
});

test('defensive batsmen edge fewer defensive shots than attackers', () => {
  const rng = new RNG(9);
  const bw = bowler('fast');
  const edgeRate = (style) => {
    let edges = 0;
    for (let i = 0; i < 600; i++) {
      const plan = planDelivery(bw, spec({ type: 'outswing', target: { x: 0.12, len: 6 } }), rng);
      const t = plan.path.timeAtZ(contactZ('defend', 'front'));
      const s = plan.path.at(t);
      const res = resolveShot({ shotId: 'defend', dirDeg: 0, foot: 'front', timingError: rng.gauss(0, 0.03), batter: batter(style), bowler: bw, plan, ball: { ...s, bouncedBefore: true }, rng });
      if (res.result === 'edge') edges++;
    }
    return edges;
  };
  assert.ok(edgeRate('defensive') < edgeRate('attacker'));
});
