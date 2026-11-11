import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lbwTrack, reviewVerdict, umpireSaysOut, aiWantsReview, applyVerdict, ZONE } from '../src/game/DRS.js';
import { takeKind, takeYaw, STUMP_REACH } from '../src/game/DeliverySim.js';
import { BALL_R } from '../src/game/BallPhysics.js';
import { MatchEngine } from '../src/game/MatchEngine.js';
import { generateCpuTeam, createDefaultUserTeam } from '../src/game/TeamManager.js';
import { ensureBowler, buildDeliverySim } from '../src/game/MatchSim.js';
import { RNG } from '../src/utils/Random.js';

globalThis.performance ??= { now: () => Date.now() };
const Z = ZONE.half, R = BALL_R;

/** A tracked appeal: pitched at bx, hit the pad at ix, would have reached the stumps at (ax, ay). */
const track = ({ bx = 0, ix = 0, ax = 0, ay = 0.4, shot = true, fullToss = false }) => lbwTrack({
  plan: { bounce: fullToss ? null : { x: bx, z: 4, t: 0.4 }, atStumps: { x: ax, y: ay, z: 10.06 } },
  impact: { x: ix, y: 0.35, z: 9.2 }, shotOffered: shot,
});

test('ball tracking: pitching, impact and wickets with the umpire\'s-call margins', () => {
  assert.deepEqual([track({}).pitching, track({}).impact, track({}).wickets], ['inLine', 'inLine', 'hitting']);
  assert.equal(track({ bx: -(Z + R + 0.01) }).pitching, 'outsideLeg');
  assert.equal(track({ bx: Z + R + 0.01 }).pitching, 'outsideOff');
  assert.equal(track({ fullToss: true }).pitching, 'fullToss');
  assert.equal(track({ ix: Z + R / 2 }).impact, 'umpiresCall', 'less than half the ball in line');
  assert.equal(track({ ix: Z + R + 0.01 }).impact, 'outside');
  assert.equal(track({ ax: Z + R / 2 }).wickets, 'umpiresCall', 'clipping the stumps');
  assert.equal(track({ ax: Z + R + 0.01 }).wickets, 'missing');
  assert.equal(track({ ay: ZONE.height + R / 2 }).wickets, 'umpiresCall', 'clipping the bails');
  assert.equal(track({ ay: ZONE.height + R + 0.02 }).wickets, 'missing', 'going over');
});

test('the third umpire: clear evidence overturns, umpire\'s call stays with the on-field decision', () => {
  const v = (t, onField) => { const r = reviewVerdict(t, onField); return [r.out, r.overturned, r.umpiresCall, r.retained]; };
  assert.deepEqual(v(track({}), 'notout'), [true, true, false, true], 'plumb: overturned to out');
  assert.deepEqual(v(track({}), 'out'), [true, false, false, false], 'out stands, review lost');
  assert.deepEqual(v(track({ bx: -0.3 }), 'out'), [false, true, false, true], 'pitched outside leg: never out');
  assert.deepEqual(v(track({ ax: 0.3 }), 'out'), [false, true, false, true], 'missing: overturned');
  assert.deepEqual(v(track({ ax: Z + R / 2 }), 'out'), [true, false, true, true], "clipping: umpire's call, out stays, review kept");
  assert.deepEqual(v(track({ ax: Z + R / 2 }), 'notout'), [false, false, true, true], "clipping: umpire's call, not out stays, review kept");
  assert.deepEqual(v(track({ ix: 0.3, shot: false }), 'notout'), [true, true, false, true], 'no shot offered: impact outside off is no defence');
  assert.deepEqual(v(track({ ix: 0.3, shot: true }), 'out'), [false, true, false, true], 'played a shot, hit outside off: not out');
});

test('the on-field umpire gets most LBWs right and the odd close one wrong; ball tracking is never wrong', () => {
  const rng = new RNG(4);
  let clear = 0, clearRight = 0, close = 0, closeWrong = 0;
  for (let i = 0; i < 4000; i++) {
    const t = track({ bx: rng.range(-0.4, 0.4), ix: rng.range(-0.35, 0.35), ax: rng.range(-0.35, 0.35), ay: rng.range(0.1, 1.0), shot: rng.chance(0.7) });
    const truth = reviewVerdict(t, 'notout');
    const given = umpireSaysOut(t, rng);
    assert.equal(umpireSaysOut(t, rng, { perfect: true }), truth.out);
    const tight = Math.abs(Math.abs(t.at.x) - Z) < 0.06 || Math.abs(Math.abs(t.impactPoint.x) - Z) < 0.05;
    if (truth.umpiresCall) continue;
    if (tight) { close++; if (given !== truth.out) closeWrong++; } else { clear++; if (given === truth.out) clearRight++; }
  }
  assert.ok(clearRight / clear > 0.95, `clear decisions right ${(clearRight / clear * 100).toFixed(1)}%`);
  assert.ok(closeWrong / close > 0.02 && closeWrong / close < 0.4, `close calls wrong ${(closeWrong / close * 100).toFixed(1)}%`);
});

test('the result after a review: out on review costs the runs; a reprieve wipes the dismissal', () => {
  const ball = { runs: 1, runType: 'legbye', dismissal: null, desc: 'Off the pads' };
  const out = applyVerdict(ball, { overturned: true, out: true }, 'p1');
  assert.deepEqual([out.dismissal.type, out.dismissal.batter, out.runs], ['lbw', 'p1', 0]);
  const given = { runs: 0, dismissal: { type: 'lbw', batter: 'p1' }, desc: 'LBW!' };
  const saved = applyVerdict(given, { overturned: true, out: false }, 'p1');
  assert.equal(saved.dismissal, null);
  assert.equal(applyVerdict(given, { overturned: false, out: true }, 'p1'), given, 'unchanged when the decision stands');
});

test('three reviews a side per innings: lost on a clear decision, kept on umpire\'s call or an overturn', () => {
  const rng = new RNG(5);
  const a = createDefaultUserTeam(rng), b = generateCpuTeam(rng, { difficulty: 'normal' });
  const e = new MatchEngine({ teams: [a, b], config: { overs: 5 }, toss: { winner: a.id, decision: 'bat' } });
  assert.deepEqual([e.reviewsLeft('bat'), e.reviewsLeft('bowl')], [3, 3]);
  e.useReview('bat', { retained: true });
  e.useReview('bowl', { retained: false });
  e.useReview('bowl', { retained: false });
  assert.deepEqual([e.reviewsLeft('bat'), e.reviewsLeft('bowl')], [3, 1]);
  for (let i = 0; i < 4; i++) e.useReview('bowl');
  assert.equal(e.reviewsLeft('bowl'), 0, 'never below zero');
  ensureBowler(e, rng);
  for (let i = 0; i < 10; i++) { ensureBowler(e, rng); e.recordBall({ dismissal: { type: 'bowled', batter: e.innings.striker } }); }
  e.beginNextInnings();
  assert.deepEqual([e.reviewsLeft('bat'), e.reviewsLeft('bowl')], [3, 3], 'a fresh set each innings');
});

test('the computer reviews wrong decisions far more often than right ones, and saves its last review', () => {
  const rng = new RNG(6);
  const wrong = { track: track({ ax: 0.35 }), onField: 'out' }, right = { track: track({}), onField: 'out' };
  let w = 0, r = 0, last = 0;
  for (let i = 0; i < 2000; i++) { if (aiWantsReview(wrong, 3, rng)) w++; if (aiWantsReview(right, 3, rng)) r++; if (aiWantsReview(wrong, 1, rng)) last++; }
  assert.ok(w > 1200 && r < 250, `wrong ${w}, right ${r}`);
  assert.ok(last < w, 'more careful with the last one');
  assert.equal(aiWantsReview(wrong, 0, rng), false);
});

test('LBW appeals in play keep their ball tracking for a review', () => {
  let appeals = 0, given = 0;
  for (let seed = 1; seed <= 60 && appeals < 6; seed++) {
    const rng = new RNG(seed);
    const a = generateCpuTeam(rng, { difficulty: 'normal' }), b = generateCpuTeam(rng, { difficulty: 'normal', avoidName: a.name });
    const e = new MatchEngine({ teams: [a, b], config: { overs: 20 }, toss: { winner: a.id, decision: 'bat' } });
    for (let i = 0; i < 120 && e.phase === 'innings'; i++) {
      ensureBowler(e, rng);
      const sim = buildDeliverySim(e, { rng });
      const r = sim.fastForward();
      e.recordBall(r);
      if (!sim.lbw) continue;
      appeals++;
      assert.ok(['out', 'notout'].includes(sim.lbw.onField));
      assert.ok(sim.lbw.track.impactPoint && sim.lbw.track.wickets);
      if (sim.lbw.onField === 'out') { given++; assert.equal(r.dismissal?.type, 'lbw'); } else assert.notEqual(r.dismissal?.type, 'lbw');
    }
  }
  assert.ok(appeals >= 6);
});

test('fielders take the ball the right way: catches by height, barrier, pickup, dive', () => {
  const f = { x: 0, z: 30 };
  const c = (y, dive = false) => takeKind({ type: 'catch', dive, p: { x: 0, y, z: 29 }, v: { x: 0, y: -3, z: 20 } }, f);
  assert.deepEqual([c(2.0), c(1.2), c(0.5), c(1.2, true)], ['catchHigh', 'catchChest', 'catchLow', 'dive']);
  const ground = (vz, x = 0) => takeKind({ type: 'stop', dive: false, p: { x, y: 0.04, z: 29 }, v: { x: 0, y: 0, z: vz } }, f);
  assert.equal(ground(20), 'barrier', 'hard and straight at him');
  assert.equal(ground(6), 'pickup');
  assert.equal(ground(-20), 'pickup', 'running after it');
  // facing: towards a ball coming at him, along its line when chasing it
  const same = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;
  assert.ok(same(takeYaw(f, { x: 0, z: 29 }, { x: 0, z: 20 }), Math.PI), 'faces back down the line of the ball');
  assert.ok(same(takeYaw(f, { x: 0, z: 31 }, { x: 0, z: 20 }), 0), 'chasing: faces the way it is going');
});

test('fielders mostly take the ball on their feet, dive only when they must, and turn to throw', () => {
  let stops = 0, dives = 0, throws = 0, facing = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const rng = new RNG(40 + seed);
    const a = generateCpuTeam(rng, { difficulty: 'normal' }), b = generateCpuTeam(rng, { difficulty: 'normal', avoidName: a.name });
    const e = new MatchEngine({ teams: [a, b], config: { overs: 20 }, toss: { winner: a.id, decision: 'bat' } });
    for (let i = 0; i < 120 && e.phase === 'innings'; i++) {
      ensureBowler(e, rng);
      const sim = buildDeliverySim(e, { rng });
      const on = sim.onIntercept.bind(sim);
      sim.onIntercept = ic => { if (sim.ball.state === 'batted' && ic.type === 'stop') { stops++; if (ic.dive) dives++; } return on(ic); };
      const th = sim.doThrow.bind(sim);
      sim.doThrow = (f, end) => {
        th(f, end);
        if (sim.ball.state === 'thrown') {
          throws++;
          const to = sim.ball.throw.to;
          const want = Math.atan2(to.x - f.x, to.z - f.z);
          if (Math.abs(Math.atan2(Math.sin(f.yaw - want), Math.cos(f.yaw - want))) < 1e-6) facing++;
        }
      };
      e.recordBall(sim.fastForward());
    }
  }
  assert.ok(dives / stops < 0.3, `ground fielding by diving: ${(dives / stops * 100).toFixed(0)}%`);
  assert.ok(throws > 50 && facing === throws, `${facing}/${throws} throws made facing the stumps`);
});

test('run-outs: the throw is taken in the gloves first, then the stumps are broken with the ball in hand', () => {
  let taken = 0, direct = 0, outs = 0;
  // About one run-out every three or four innings: play matches until a handful have happened.
  for (let seed = 1; seed <= 30 && outs < 5; seed++) {
    const rng = new RNG(70 + seed);
    const a = generateCpuTeam(rng, { difficulty: 'normal' }), b = generateCpuTeam(rng, { difficulty: 'normal', avoidName: a.name });
    const e = new MatchEngine({ teams: [a, b], config: { overs: 20 }, toss: { winner: a.id, decision: 'bat' } });
    while (e.phase !== 'complete') {
      if (e.phase === 'break') { e.beginNextInnings(); continue; }
      ensureBowler(e, rng);
      const sim = buildDeliverySim(e, { rng });
      const r = sim.fastForward();
      e.recordBall(r);
      if (r.dismissal?.type !== 'runout') continue;
      outs++;
      const ev = sim.events, hit = ev.find(x => x.type === 'stumpsHit' && x.runout);
      assert.ok(hit, 'the stumps were broken');
      if (hit.direct) { direct++; assert.ok(!ev.some(x => x.type === 'throwTaken' && x.t > hit.t - 2 && x.end === hit.end && x.t <= hit.t), 'a direct hit needs no one to take it'); continue; }
      const brk = ev.filter(x => x.type === 'breakStumps' && x.end === hit.end && x.t <= hit.t).at(-1);
      assert.ok(brk, 'someone went for the stumps');
      // (events land on 60 fps frames, so allow a frame either way)
      assert.ok(Math.abs(hit.t - brk.t - STUMP_REACH) < 0.03, `the bails come off when the gloves reach the stumps (${(hit.t - brk.t).toFixed(3)} s)`);
      const take = ev.filter(x => x.type === 'throwTaken' && x.end === hit.end && x.t <= brk.t).at(-1);
      if (take) { taken++; assert.equal(take.by, brk.by, 'the one who took the throw broke the wicket'); }
      assert.equal(sim.ball.holder, brk.by, 'with the ball in hand');
    }
  }
  assert.ok(outs >= 3, `run-outs happen (${outs})`);
  assert.ok(taken >= 1, `throws taken then the wicket broken (${taken}); direct hits ${direct}`);
});
