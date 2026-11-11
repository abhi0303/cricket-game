// One delivery, from run-up to dead ball, as a deterministic simulation (seeded RNG).
// It owns the gameplay truth for the ball: the scene only draws what this reports,
// and the rules engine only sees the final ball record from result().
//
// Delivery frame: striker's stumps at z = +10.06, bowler's at z = -10.06, x > 0 = off side.

import { planDelivery, simulateBattedBall, launchVelocity, PITCH, BALL_R } from './BallPhysics.js';
import { resolveShot, contactZ, BATTER_X, STANCE_Z, SHOTS, GUARD, shotFromInput, describeShot } from './ShotModel.js';
import { keeperPosition } from './FieldPlacements.js';
import { chooseShot, sampleTimingError, runDecision, batterIntent, pickGap, assistAim, TEST_BATTING } from '../ai/BattingAI.js';
import { chooseThrowEnd, isSafe, END_Z, CREASE_Z, BAT_REACH } from '../ai/FieldingAI.js';
import { dismissalAllowed } from './CricketRules.js';
import { diff } from './Difficulty.js';
import { BOWLING_TYPES, bowlerKph } from './PlayerAttributes.js';
import { PHYSICS, allowedSpeeds, stockSpeed, defaultLengthTarget } from './PhysicsConfig.js';
import { clamp } from '../utils/Random.js';
import { lbwTrack, umpireSaysOut, worthAnAppeal } from './DRS.js';

export const SWING_LEAD = 0.2;          // real seconds from pressing a shot to bat meeting ball
const RUNUP = {
  pace: { dist: 16, speed: 7.2, stride: 0.42, startX: 1.6 },
  spin: { dist: 6, speed: 4.4, stride: 0.42, startX: 1.1 },
};
const RUN_TO = { striker: 9.35, nonStriker: -9.35 };
const MAX_INPLAY = 16;
// Sprinting (the human batting side holds a trigger): a little more top speed and a quicker pick-up.
export const SPRINT = { speed: 1.12, accel: 1.3 };
// Diving for the crease: the batter lunges full length with the bat out in front, so the bat crosses the line
// sooner than running would get it there. A dive only happens in the last couple of metres (called earlier, the
// batter runs on and dives when he gets there), and it ends the running: no further run until the next call.
export const DIVE = { range: 2.4, stretch: 0.25, slide: 0.55, reach: 1.9, total: 1.35, lunge: 1.08 };

const runnerSpeed = p => 5.9 + 1.6 * (p.fielding / 100);
const FIELDER_ACCEL = 6;
const CLEAN_WAIT = 0.9;   // how much later a fielder will take the ball cleanly rather than dive for it (s)
// From the keeper (or bowler) going for the stumps with the ball to the gloves knocking the bails off; matches
// the 'stump' animation, so the bails fly when the gloves get there.
export const STUMP_REACH = 0.16;
/** Time to cover d metres from standing with constant acceleration up to top speed v. */
export function timeToReach(d, v, a = FIELDER_ACCEL) {
  if (d <= 0) return 0;
  const dAcc = (v * v) / (2 * a);
  return d < dAcc ? Math.sqrt((2 * d) / a) : v / a + (d - dAcc) / v;
}

/**
 * Which way a fielder faces to take the ball: towards it as it comes to them, or along its line when
 * they're running after it.
 */
export function takeYaw(f, p, v) {
  const coming = v.x * (f.x - p.x) + v.z * (f.z - p.z) > 0;
  return coming ? Math.atan2(-v.x, -v.z) : Math.atan2(v.x, v.z);
}

/** How a fielder takes the ball: a catch at the right height, a pickup, a long barrier, or a dive. */
export function takeKind(ic, f) {
  if (ic.dive) return 'dive';
  if (ic.type === 'catch') return ic.p.y > 1.7 ? 'catchHigh' : ic.p.y > 0.95 ? 'catchChest' : 'catchLow';
  const hs = Math.hypot(ic.v.x, ic.v.z);
  const coming = ic.v.x * (f.x - ic.p.x) + ic.v.z * (f.z - ic.p.z) > 0;
  return coming && hs > 13 ? 'barrier' : 'pickup';
}

/**
 * Wide call (limited overs). A batter who moves across the crease can't make a ball wide by walking away
 * from it, and a ball they move across to reach isn't a wide: it has to be wide of where they stand and of
 * their normal guard.
 */
export function isWideLine(p, guard = 0, test = false) {
  // Test umpires give the batter more room: only balls clearly out of reach are wides.
  const off = test ? TEST_WIDE.off : PITCH.wideOff, leg = test ? TEST_WIDE.leg : PITCH.wideLeg;
  return p.x > off + Math.max(0, guard) || p.x < leg + Math.min(0, guard) || p.y > PITCH.headHeight;
}
export const TEST_WIDE = { off: 1.15, leg: -0.95 };

export class DeliverySim {
  /**
   * @param {object} o
   * striker, nonStriker, bowler, keeper (player objects), field: [{player, spot}],
   * userBatting, userBowling, assistRunning, difficulty, situation, freeHit, ballsFaced, rng
   */
  constructor(o) {
    this.rng = o.rng;
    this.difficulty = o.difficulty || 'normal';
    this.D = diff(this.difficulty);
    this.userBatting = !!o.userBatting;
    this.userBowling = !!o.userBowling;
    this.vsUser = this.userBatting || this.userBowling;
    this.control = {
      bat: this.userBatting ? 'user' : 'ai',
      bowl: this.userBowling ? 'user' : 'ai',
      running: this.userBatting && !o.assistRunning ? 'user' : 'ai',
      field: this.userBowling ? 'user' : 'ai',
    };
    this.situation = o.situation || {};
    this.freeHit = !!o.freeHit;
    this.testMatch = !!o.testMatch;
    this.ballsFaced = o.ballsFaced || 0;
    this.strikerP = o.striker;
    this.nonStrikerP = o.nonStriker;
    this.bowlerP = o.bowler;
    this.keeperP = o.keeper;
    this.kind = BOWLING_TYPES[this.bowlerP.bowlingType]?.kind || 'pace';
    this.fatigue = o.fatigue || 0;
    this.deliveryScale = this.vsUser ? this.D.timeScale : 0.72;
    this.scale = this.deliveryScale;

    this.t = 0;
    this.phase = 'ready';      // ready | runup | flight | inplay | dead
    this.events = [];
    this.timeline = [];
    // Bowling speed options for this bowler (debug mode unlocks all ten speeds).
    this.speedOptions = allowedSpeeds(this.bowlerP.bowlingType, bowlerKph(this.bowlerP), { fatigue: this.fatigue, unlockAll: !!o.unlockSpeeds });
    const length = this.kind === 'spin' ? 'full' : 'good';
    this.spec = {
      type: 'stock', length, target: { x: 0.12, ...defaultLengthTarget(length) },
      speedKph: stockSpeed(this.bowlerP.bowlingType, bowlerKph(this.bowlerP), { fatigue: this.fatigue, unlockAll: !!o.unlockSpeeds }),
      power: 0, quality: 0.8, overstep: false,
    };
    this.meter = { active: false, value: 0, released: false, releaseValue: null, quality: null };
    this.power = 0;

    this.plan = null;
    this.tRelease = null;
    this.shot = null;           // {shotId, foot, dirDeg, stepOut, power, precision, pressT}
    this.guard = 0;             // how far the striker has shuffled across the crease (m, + towards off)
    this.shotResult = null;
    this.resolved = false;
    this.contactMade = false;
    this.padHit = false;
    this.isWide = false;
    this.noBall = false;
    this.dismissal = null;
    this.lbw = null;            // an LBW appeal: { track, onField } (for reviews)
    this.boundary = 0;
    this.runsCompleted = 0;
    this.runState = 'idle';     // idle | running | returning
    this.sprint = false;        // human batting side holding the sprint trigger
    this.queuedRun = false;
    this.runTurnWait = 0;
    this.lastRunDecisionT = -1;
    this.ball = { state: 'hand', p: { x: 0, y: 1, z: -20 }, holder: null };
    this.bat = null;            // batted path
    this.intercept = null;
    this.awaitThrow = null;
    this.deadAt = null;
    this.inplayStart = null;
    this.timing = null;         // HUD feedback
    this.desc = '';
    this.fieldedBy = null;

    this.setupActors(o.field || []);
  }

  // ------------------------------------------------------------------ actors
  setupActors(field) {
    const ru = RUNUP[this.kind];
    this.bowler = {
      id: this.bowlerP.id, player: this.bowlerP, role: 'bowler',
      x: ru.startX, z: -PITCH.half - ru.dist, yaw: 0, action: 'ready', actionT: 0,
      speed: 5.6 + 1.8 * this.bowlerP.fielding / 100, reaction: 0.55, home: null,
    };
    const kp = keeperPosition(this.kind);
    this.keeper = {
      id: this.keeperP.id, player: this.keeperP, role: 'keeper', isKeeper: true,
      x: kp.x, z: kp.z, home: { ...kp }, yaw: Math.PI, action: 'crouch', actionT: 0,
      speed: 5.2 + 1.4 * this.keeperP.fielding / 100, reaction: 0.18,
    };
    this.fielders = field.map(({ player, spot }) => ({
      id: player.id, player, role: 'fielder', spot: spot.name,
      x: spot.x, z: spot.z, home: { x: spot.x, z: spot.z }, yaw: 0, action: 'ready', actionT: 0,
      speed: 5.6 + 2.0 * player.fielding / 100, reaction: 0.42 - 0.17 * player.fielding / 100,
      close: spot.close,
    }));
    for (const f of this.fielders) f.yaw = Math.atan2(0 - f.x, 9 - f.z);
    this.runners = [
      { id: this.strikerP.id, player: this.strikerP, x: BATTER_X, z: STANCE_Z, end: 'striker', target: null, v: 0, speed: runnerSpeed(this.strikerP), action: 'stance', actionT: 0 },
      { id: this.nonStrikerP.id, player: this.nonStrikerP, x: -1.05, z: -9.4, end: 'nonStriker', target: null, v: 0, speed: runnerSpeed(this.nonStrikerP), action: 'idle', actionT: 0 },
    ];
    this.umpire = { x: -0.25, z: -PITCH.half - 1.9, action: 'idle', actionT: 0, signal: null };
    this.legUmpire = { x: -24, z: STANCE_Z, action: 'idle', actionT: 0 };
  }

  get strikerRunner() { return this.runners.find(r => r.id === this.strikerP.id); }
  get allFielders() { return [...this.fielders, this.keeper, this.bowler]; }
  fielderById(id) { return this.allFielders.find(f => f.id === id); }

  setAction(a, action) { if (a.action !== action) { a.action = action; a.actionT = 0; } }

  emit(type, data = {}) { this.events.push({ type, t: this.t, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  schedule(t, fn) { this.timeline.push({ t, fn }); this.timeline.sort((a, b) => a.t - b.t); }

  // ------------------------------------------------------------------ bowling input
  setSpec(spec) { this.spec = { ...this.spec, ...spec, target: { ...this.spec.target, ...(spec.target || {}) } }; }

  get runupDuration() { const ru = RUNUP[this.kind]; return (ru.dist / ru.speed) * 1.35; }
  get releaseDelay() { return this.runupDuration + RUNUP[this.kind].stride; }

  /** Start the run-up (user pressed bowl, or the AI is ready). */
  startRunup() {
    if (this.phase !== 'ready') return;
    this.phase = 'runup';
    this.tRunStart = this.t;
    if (this.control.bowl === 'user') this.meter = { active: true, value: 0, released: false, releaseValue: null, quality: null };
    this.emit('runup');
  }

  /** User let go of the bowl button: lock delivery quality from the meter position. */
  releaseMeter() {
    if (!this.meter.active || this.meter.released) return;
    const m = this.meter.value;
    this.meter.released = true;
    this.meter.releaseValue = m;
    let q;
    if (m < 0.84) q = 1 - (0.84 - m) * 1.45;
    else q = 1 - (m - 0.84) * 2.4;
    if (Math.abs(m - 0.84) <= 0.035) q = 1;
    this.meter.quality = clamp(q, 0.15, 1);
    this.spec.quality = this.meter.quality;
    this.spec.overstep = m > 0.95 && this.rng.chance(Math.min(1, (m - 0.95) * 14));
    this.meter.rating = q >= 0.97 ? 'Perfect' : q >= 0.85 ? 'Good' : q >= 0.65 ? 'Fair' : 'Poor';
    this.emit('meterRelease', { quality: this.meter.quality, rating: this.meter.rating });
  }

  setPower(p) { this.power = Math.max(this.power, clamp(p, 0, 1)); }

  // ------------------------------------------------------------------ batting input
  /** Human batter pressed a shot. Ignored outside the flight window. */
  inputShot({ button, sx = 0, sy = 0, power = false, precision = false, age = 0 }) {
    if (this.control.bat !== 'user' || this.phase !== 'flight' || this.shot || this.resolved) return false;
    const s = shotFromInput(button, sx, sy, { bowlerKind: this.kind, lengthHint: this.plan.bounceLen });
    // Aim assist: a neutral stick picks a gap; a held stick is nudged toward one (none on Hard).
    const field = this.fielders.map(f => ({ x: f.x, z: f.z }));
    if (this.D.aimAssist) {
      s.dirDeg = Math.abs(sx) < 0.2 ? pickGap(s.shotId, field, this.rng) : assistAim(s.shotId, s.dirDeg, field, this.D.aimAssist);
    }
    // Back-date the press to when the key actually went down (age, real seconds), so timing
    // doesn't depend on the frame rate the input happened to be polled at.
    const pressT = Math.max(this.tRelease, this.t - clamp(age, 0, 0.05) * this.scale);
    this.shot = { ...s, power, precision, pressT };
    this.emit('shotStart', { shotId: s.shotId, foot: s.foot, lead: SWING_LEAD * this.deliveryScale, t: pressT });
    return true;
  }

  /**
   * Human batter shuffles across the crease to cover the line: dir -1..1 (+ towards the off side).
   * Allowed until a shot is played. It runs on the delivery clock (like the bowler and the ball), so the
   * slowed-down delivery doesn't buy extra footwork.
   */
  moveGuard(dir, dtReal) {
    if (this.control.bat !== 'user' || this.shot || this.resolved || !dir) return false;
    if (this.phase !== 'ready' && this.phase !== 'runup' && this.phase !== 'flight') return false;
    const dt = Math.min(0.05, Math.max(0, dtReal)) * this.scale;
    const g = clamp(this.guard + clamp(dir, -1, 1) * GUARD.speed * dt, GUARD.min, GUARD.max);
    if (g === this.guard) return false;
    this.guard = g;
    this.strikerRunner.x = BATTER_X + g;
    return true;
  }

  /** Running calls: 'run' | 'back'. After a dive, the player's run call also restarts assisted running. */
  inputRun(cmd) {
    if (this.control.running !== 'user' && !(cmd === 'run' && this.holdRuns && this.control.bat === 'user')) return;
    this.applyRunCommand(cmd, { byUser: true });
  }

  /** Human batting side: hold to sprint (both batters). */
  setSprint(on) { this.sprint = this.control.bat === 'user' && !!on; }

  /**
   * Human batting side: dive for the crease. A batter within diving range of his crease dives now; one further
   * out runs on and dives as he gets there, so a dive is always at the crease, never mid-pitch. A dive also
   * calls off any further run: the batters stay in after it until the player calls the next run.
   * Returns how many dived straight away.
   */
  inputDive() {
    if (this.control.bat !== 'user' || this.phase !== 'inplay') return 0;
    if (!this.runners.some(r => r.target && !r.arrived && !r.divedThisRun)) return 0;
    this.diveCall = true;
    this.queuedRun = false;
    this.holdRuns = true;
    const n = this.diveInRange();
    this.emit('diveCall', { now: n });
    return n;
  }

  /** Batters close enough to their crease dive (each once a run). */
  diveInRange() {
    let n = 0;
    for (const r of this.runners) {
      if (!r.target || r.dive || r.arrived || r.divedThisRun || r.madeGround === r.target || (r.v || 0) < 1.5) continue;
      const safeZ = r.target === 'striker' ? CREASE_Z.striker - BAT_REACH : CREASE_Z.nonStriker + BAT_REACH;
      const dist = r.target === 'striker' ? safeZ - r.z : r.z - safeZ;
      if (dist <= 0 || dist > DIVE.range) continue;
      r.dive = { t: 0, end: r.target, dir: r.target === 'striker' ? 1 : -1, v0: r.v * DIVE.lunge };
      r.divedThisRun = true;
      this.setAction(r, 'dive');
      n++;
    }
    if (n) this.emit('dive', { count: n });
    return n;
  }

  /** A batter in a dive: lunge and slide (slowing to a stop), the reach stretching out, then back up. */
  updateDive(r, dt) {
    const d = r.dive;
    d.t += dt;
    r.z += d.dir * d.v0 * Math.max(0, 1 - d.t / DIVE.slide) * dt;
    r.reach = BAT_REACH + (DIVE.reach - BAT_REACH) * Math.min(1, d.t / DIVE.stretch);
    r.v = 0;
    if (r.madeGround !== d.end && isSafe(r, d.end)) {
      r.madeGround = d.end;
      if (r.target === d.end) r.arrived = true;
      this.emit('diveSafe', { runner: r.id, end: d.end });
    }
    if (d.t >= DIVE.total) {
      // On their feet again; a batter who made it gets up inside the crease.
      r.dive = null;
      r.reach = BAT_REACH;
      if (r.madeGround === d.end) {
        const safeZ = d.end === 'striker' ? CREASE_Z.striker - BAT_REACH + 0.05 : CREASE_Z.nonStriker + BAT_REACH - 0.05;
        r.z = d.dir > 0 ? Math.max(r.z, safeZ) : Math.min(r.z, safeZ);
      }
      this.setAction(r, r.target ? 'run' : 'idle');
    }
  }

  /** Human fielding side picks the throw end: 'striker' | 'nonStriker' | 'auto'. */
  inputThrow(end) {
    if (!this.awaitThrow) return;
    const f = this.awaitThrow.f;
    this.awaitThrow = null;
    this.doThrow(f, end === 'auto' ? chooseThrowEnd(f, this.runners, f.throwSpeed || 28, this.runState) : end);
  }

  // ------------------------------------------------------------------ main update
  update(dtReal) {
    if (this.phase === 'dead') { this.animateIdle(dtReal); return; }
    // time scale: slow during the delivery, real speed once the ball is hit
    let target = this.phase === 'inplay' ? 1 : this.deliveryScale;
    if (this.awaitThrow) target = 0.32;
    this.scale += (target - this.scale) * (1 - Math.exp(-6 * Math.max(0, dtReal)));   // frame-rate independent ramp
    const dt = Math.min(0.05, dtReal) * this.scale;
    this.t += dt;

    for (const a of [...this.allFielders, ...this.runners, this.umpire, this.legUmpire]) a.actionT += dt;

    while (this.timeline.length && this.timeline[0].t <= this.t) {
      const ev = this.timeline.shift();
      ev.fn();
      if (this.phase === 'dead') return;
    }

    switch (this.phase) {
      case 'ready': this.updateReady(dt); break;
      case 'runup': this.updateRunup(dt); break;
      case 'flight': this.updateFlight(dt); break;
      case 'inplay': this.updateInplay(dt); break;
    }
  }

  updateReady() {
    // The non-striker waits; the bowler stands at the top of the mark.
    if (this.control.bowl === 'ai' && this.t > 0.9) this.startRunup();
  }

  updateRunup(dt) {
    const ru = RUNUP[this.kind];
    const T = this.runupDuration;
    const tt = this.t - this.tRunStart;
    if (this.meter.active) {
      this.meter.value = tt / this.releaseDelay;
      if (this.meter.value >= 1 && !this.meter.released) {
        this.releaseMeter();
        this.spec.overstep = true;
        this.spec.quality = Math.min(this.spec.quality, 0.45);
      }
    }
    const start = { x: ru.startX, z: -PITCH.half - ru.dist };
    const end = { x: 0.6, z: -9.55 };
    if (tt < T) {
      const u = Math.pow(tt / T, 1.35);
      this.bowler.x = start.x + (end.x - start.x) * u;
      this.bowler.z = start.z + (end.z - start.z) * u;
      this.setAction(this.bowler, 'runup');
    } else {
      const u = clamp((tt - T) / ru.stride, 0, 1);
      this.bowler.x = end.x + (0.45 - end.x) * u;
      this.bowler.z = end.z + (-8.95 - end.z) * u;
      this.setAction(this.bowler, 'deliver');
    }
    this.bowler.yaw = 0;
    // Non-striker backs up as the bowler approaches.
    const ns = this.runners.find(r => r.end === 'nonStriker');
    if (ns && tt > T * 0.45) ns.z = Math.min(-7.45, ns.z + dt * 1.4);
    this.ball.state = 'hand';
    if (tt >= this.releaseDelay) this.release();
  }

  release() {
    const spec = { ...this.spec, power: Math.max(this.spec.power || 0, this.power), fatigue: this.fatigue };
    if (this.control.bowl === 'user') spec.spreadMult = this.D.userBowlSpread;
    this.plan = planDelivery(this.bowlerP, spec, this.rng);
    this.noBall = !!this.plan.noBall;
    const fullToss = !this.plan.bounce || this.plan.bounce.z > PITCH.popping - 0.2;
    if (fullToss && this.plan.heightAtCrease > 1.08) { this.noBall = true; this.noBallReason = 'Waist-high full toss'; }
    else if (this.noBall) this.noBallReason = 'Front-foot no ball';
    this.tRelease = this.t;
    this.phase = 'flight';
    this.ball.state = 'delivery';
    this.setAction(this.bowler, 'follow');
    this.emit('release', { plan: this.plan, noBall: this.noBall });
    if (this.noBall) this.emit('noBall', { reason: this.noBallReason });

    // The computer batter reads the ball part of the way down.
    if (this.control.bat === 'ai') {
      const tCrease = this.plan.path.timeAtZ(8.6) ?? 0.5;
      this.schedule(this.tRelease + tCrease * 0.42, () => this.cpuPlayShot());
    }
    const tStumps = this.plan.path.timeAtZ(PITCH.half);
    this.tBallAtBatter = this.tRelease + (this.plan.path.timeAtZ(9.0) ?? 0.6);
    this.tBallAtStumps = tStumps != null ? this.tRelease + tStumps : null;
  }

  cpuPlayShot() {
    if (this.shot || this.resolved) return;
    const field = this.fielders.map(f => ({ x: f.x, z: f.z }));
    const dec = chooseShot({ batter: this.strikerP, plan: this.plan, situation: this.situation, fielders: field, ballsFaced: this.ballsFaced, rng: this.rng, difficulty: this.difficulty, isCpuVsUser: this.vsUser });
    if (dec.shotId === 'leave') { this.shot = { ...dec, pressT: this.t, leave: true }; this.emit('shotStart', { shotId: 'leave', foot: 'back', lead: 0.1 }); return; }
    const z = contactZ(dec.shotId, dec.foot, dec.stepOut);
    const tc = this.tRelease + (this.plan.path.timeAtZ(z) ?? 0.5);
    const err = sampleTimingError({ batter: this.strikerP, plan: this.plan, rng: this.rng, difficulty: this.difficulty, isCpuVsUser: this.vsUser }) * (this.testMatch ? TEST_BATTING.timing : 1);
    const lead = SWING_LEAD * this.deliveryScale;
    const pressT = Math.max(this.t, tc - lead + err * this.deliveryScale);
    this.shot = { ...dec, pressT, cpuErr: err };
    const start = () => this.emit('shotStart', { shotId: dec.shotId, foot: dec.foot, lead, stepOut: dec.stepOut });
    if (pressT <= this.t) start(); else this.schedule(pressT, start);
  }

  updateFlight() {
    const tt = this.t - this.tRelease;
    const s = this.plan.path.at(tt);
    this.ball.p = s.p;
    this.ball.v = s.v;
    this.followThrough();
    if (this.resolved) return;
    const lead = SWING_LEAD * this.deliveryScale;
    if (this.shot && this.shot.pressT <= this.t + 1e-9 || this.shot && this.shot.leave) {
      if (this.shot.leave || this.shot.shotId === 'leave') {
        if (this.t >= this.tBallAtBatter) this.resolveNoContact('leave');
        return;
      }
      const z = contactZ(this.shot.shotId, this.shot.foot, this.shot.stepOut);
      const tcRel = this.plan.path.timeAtZ(z);
      const tc = this.tRelease + (tcRel ?? 0.6);
      const tHit = this.shot.pressT + lead;
      const okG = 0.14 * this.deliveryScale * 1.4;
      const errG = tHit - tc;
      if (this.t >= Math.max(tc, Math.min(tHit, tc + okG)) || (errG < -okG && this.t >= tc)) {
        this.resolveShot(errG / this.deliveryScale, Math.min(Math.max(tc, tHit), tc + okG));
      }
    } else if (!this.shot && this.t >= this.tBallAtBatter + 0.16 * this.deliveryScale) {
      this.resolveNoContact('noshot');
    }
  }

  followThrough() {
    const tt = this.t - this.tRelease;
    if (this.bowler.action === 'follow') {
      const u = clamp(tt / 1.2, 0, 1);
      const e = 1 - (1 - u) * (1 - u);
      this.bowler.x = 0.45 + (1.3 - 0.45) * e;
      this.bowler.z = -8.95 + (-4.8 + 8.95) * e;
      if (u >= 1) this.setAction(this.bowler, 'ready');
    }
  }

  // ------------------------------------------------------------------ shot resolution
  resolveShot(errReal, tRes) {
    this.resolved = true;
    const tRel = tRes - this.tRelease;
    const s = this.plan.path.at(tRel);
    const bouncedBefore = !!this.plan.bounce && this.plan.bounce.t <= tRel;
    const ctx = this.control.bat === 'user'
      ? { windowMult: this.D.userWindow, edgeMult: this.D.userEdge, power: this.shot.power, precision: this.shot.precision }
      : { windowMult: 1, edgeMult: (this.vsUser ? this.D.cpuBatEdge : 1) * (this.testMatch ? TEST_BATTING.edgeMult : 1), power: this.shot.power, precision: this.shot.precision };
    const res = resolveShot({
      shotId: this.shot.shotId, dirDeg: this.shot.dirDeg, foot: this.shot.foot, stepOut: this.shot.stepOut, guard: this.guard,
      timingError: errReal, batter: this.strikerP, bowler: this.bowlerP, plan: this.plan,
      ball: { p: s.p, v: s.v, bouncedBefore }, ctx, rng: this.rng,
    });
    this.shotResult = res;
    this.timing = { label: res.timing, error: errReal, windows: res.windows, quality: res.quality, shot: SHOTS[res.shotId]?.label };
    this.emit('timing', this.timing);
    const sr = this.strikerRunner;
    sr.z = this.shot.stepOut ? 7.2 : this.shot.foot === 'front' ? 8.55 : 9.3;
    sr.x = BATTER_X + this.guard;

    if (res.result === 'clean' || res.result === 'edge') {
      // Inside edge onto the stumps: played on.
      if (res.result === 'edge' && res.edgeType === 'inside' && this.plan.hitsStumps && this.rng.chance(0.45)
        && dismissalAllowed('bowled', { extra: this.noBall ? 'noball' : null, freeHit: this.freeHit })) {
        this.contactMade = true;
        this.emit('contact', { edge: true, edgeType: 'inside', p: s.p });
        this.emit('stumpsHit', { end: 'striker' });
        this.desc = 'Played on!';
        this.out('bowled', this.strikerP.id, null, 'Bowled (played on)');
        return;
      }
      this.contactMade = true;
      // Rare: treading on the stumps while rocking back for a pull, hook or cut.
      if (['pull', 'hook', 'cut'].includes(res.shotId) && this.rng.chance(0.002)
        && dismissalAllowed('hitwicket', { extra: this.noBall ? 'noball' : null, freeHit: this.freeHit })) {
        this.emit('contact', { edge: false, p: s.p, quality: res.quality });
        this.emit('stumpsHit', { end: 'striker' });
        this.out('hitwicket', this.strikerP.id, null, 'Hit wicket! Trod on the stumps');
        return;
      }
      const L = res.launch;
      const v = launchVelocity(L.speed, L.dir, L.elev);
      this.emit('contact', { edge: res.result === 'edge', edgeType: res.edgeType, p: s.p, speed: L.speed, quality: res.quality });
      this.startBatted({ ...s.p, y: Math.max(BALL_R, s.p.y) }, v, {});
      this.desc = describeShot(res);
      return;
    }
    this.resolveNoContact(res.result === 'miss' ? 'miss' : 'leave');
  }

  /** Ball not hit: pads, stumps, wide, keeper. Uses the unobstructed delivery path. */
  resolveNoContact(why) {
    this.resolved = true;
    const P = this.plan.path;
    const shotOffered = !!this.shot && this.shot.shotId !== 'leave' && why !== 'noshot';
    if (!this.shotResult) {
      this.shotResult = { result: why === 'miss' ? 'miss' : 'leave', shotId: this.shot?.shotId || 'leave', timing: why === 'noshot' ? 'none' : 'leave' };
      if (why !== 'miss') this.timing = { label: why === 'noshot' ? 'no shot' : 'left', shot: 'Leave' };
    }
    if (why === 'miss') this.emit('beaten');
    const foot = this.shot?.foot || 'back';
    const padZ = this.shot?.stepOut ? 7.35 : (!shotOffered ? 9.25 : foot === 'front' ? 8.5 : 9.3);
    const tPadRel = P.timeAtZ(padZ);
    const atPad = tPadRel != null ? P.at(tPadRel).p : null;
    // Front-foot: the pad sits inside the line of the bat, so balls on/outside off usually beat the bat
    // and go on (bowled) while balls nipping back hit the pad. A bit of randomness for misjudgement.
    // Pads and body move with the batter's guard: across to off they cover the stumps, away to leg they leave them.
    const judge = this.rng.gauss(0, 0.1), g = this.guard;
    const padX = g + (this.shot?.stepOut ? -0.1 + judge : !shotOffered ? -0.14 + judge * 0.5
      : foot === 'front' ? clamp((atPad?.x ?? 0) - g - 0.24 + judge, -0.45, 0.08) : -0.22 + judge * 0.5);
    // Pad zone: the front pad reaches 18 cm either side of padX, the back leg covers a little more on the leg side.
    const hitsPad = atPad && atPad.x > padX - 0.3 && atPad.x < padX + 0.18 && atPad.y < 0.6;
    const extra = this.noBall ? 'noball' : null;

    // Body / helmet: swept test where the path crosses the batter's body plane (no tunnelling at any speed).
    // A batter who leaves a short ball ducks or sways out of the way.
    const B = PHYSICS.body;
    const bodyZ = this.shot?.stepOut ? 7.4 : foot === 'front' && shotOffered ? 8.7 : 9.15;
    const tBodyRel = P.timeAtZ(bodyZ);
    const atBody = tBodyRel != null ? P.at(tBodyRel).p : null;
    const evaded = why === 'leave' && atBody && atBody.y > 1.25;
    if (atBody && !evaded && Math.abs(atBody.x - (BATTER_X + g)) < B.halfWidth && atBody.y >= B.yMin && atBody.y <= B.yMax) {
      const helmet = atBody.y >= B.helmetFrom;
      this.schedule(Math.max(this.t, this.tRelease + tBodyRel), () => {
        this.padHit = true; // runs off the body are leg byes
        this.ball.p = atBody;
        this.emit('bodyHit', { helmet, p: atBody });
        const v = launchVelocity(this.rng.range(2, 5), this.rng.range(-170, 170), this.rng.range(-10, 25));
        this.desc = helmet ? 'Hit on the helmet!' : 'Hit on the body';
        this.startBatted({ ...atBody }, v, { alreadyBounced: true });
      });
      return;
    }

    if (hitsPad) {
      const t = Math.max(this.t, this.tRelease + tPadRel);
      this.schedule(t, () => {
        this.padHit = true;
        this.ball.p = atPad;
        this.emit('padHit', { p: atPad });
        // LBW: ball tracking knows the truth (pitching, impact, going on to hit); the on-field umpire judges it
        // by eye, so the odd close call goes the wrong way. Both are kept for a review (DRS.js).
        const track = lbwTrack({ plan: this.plan, impact: atPad, shotOffered });
        const allowed = dismissalAllowed('lbw', { extra, freeHit: this.freeHit });
        const given = allowed && umpireSaysOut(track, this.rng, { perfect: !!this.perfectUmpire });
        if (allowed && (given || worthAnAppeal(track))) this.lbw = { track, onField: given ? 'out' : 'notout', t: this.t };
        if (given) {
          this.emit('appeal');
          this.out('lbw', this.strikerP.id, null, 'LBW!');
          return;
        }
        // Close call turned down: the umpire shakes his head.
        if (this.lbw) { this.emit('appeal', { denied: true }); this.umpire.signal = 'notout'; this.setAction(this.umpire, 'signal'); }
        // Deflects off the pad: leg byes are possible.
        const dir = this.rng.chance(0.6) ? this.rng.range(-150, -40) : this.rng.range(20, 120);
        const v = launchVelocity(this.rng.range(2.5, 6.5), dir, this.rng.range(-5, 12));
        this.desc = 'Off the pads';
        this.startBatted({ ...atPad }, v, { alreadyBounced: true });
      });
      return;
    }

    // Bowled?
    if (this.plan.hitsStumps && this.tBallAtStumps != null) {
      const t = Math.max(this.t, this.tBallAtStumps);
      if (dismissalAllowed('bowled', { extra, freeHit: this.freeHit })) {
        this.schedule(t, () => {
          this.ball.p = this.plan.atStumps;
          this.emit('stumpsHit', { end: 'striker' });
          this.out('bowled', this.strikerP.id, null, why === 'leave' ? 'Bowled! Shouldered arms' : 'Bowled!');
        });
        return;
      }
    }

    // Wide?
    const tCr = P.timeAtZ(PITCH.popping);
    if (tCr != null) {
      const c = P.at(tCr).p;
      if (isWideLine(c, g, this.testMatch)) {
        this.isWide = !this.noBall;
        if (this.isWide) this.schedule(Math.max(this.t, this.tRelease + tCr), () => this.emit('wide'));
      }
    }

    // Keeper takes it.
    const kz = this.keeper.z - 0.25;
    const tkRel = P.timeAtZ(kz);
    const atK = tkRel != null ? P.at(tkRel).p : P.at(P.duration).p;
    const tK = Math.max(this.t + 0.05, this.tRelease + (tkRel ?? P.duration));
    this.keeper.target = { x: clamp(atK.x, this.keeper.home.x - 2.2, this.keeper.home.x + 2.2), z: this.keeper.z };
    this.schedule(tK, () => this.keeperCollect(atK, why));
  }

  keeperCollect(atK, why) {
    const k = this.keeper;
    const reachable = Math.abs(atK.x - k.x) < 1.7 && atK.y < 2.4;
    const skill = k.player.catching / 100;
    const fumbleP = (reachable ? 0.012 + 0.05 * (1 - skill) : 1) + (Math.abs(atK.x - k.home.x) > 1 ? 0.04 : 0);
    if (!reachable || this.rng.chance(fumbleP)) {
      // Byes: ball gets past or spills off the gloves.
      this.emit('fumble');
      const dir = 180 + this.rng.range(-35, 35);
      const v = launchVelocity(reachable ? this.rng.range(2, 5) : 9, dir, 0);
      this.desc = 'Gets past the keeper';
      this.startBatted({ ...atK, y: Math.min(atK.y, 0.5) }, v, { alreadyBounced: true, excludeId: k.id, penalty: 0.6 });
      return;
    }
    this.ball.state = 'held';
    this.ball.holder = k.id;
    this.ball.p = { ...atK };
    this.setAction(k, 'collect');
    this.emit('keeperCollect');
    // Stumping: batter danced down the track to a spinner and missed.
    if (this.shot?.stepOut && this.kind === 'spin' && why === 'miss') {
      const ok = this.rng.chance(0.38 + 0.38 * skill);
      if (ok && dismissalAllowed('stumped', { extra: this.isWide ? 'wide' : this.noBall ? 'noball' : null, freeHit: this.freeHit })) {
        // ball in the gloves, then the gloves to the stumps
        k.yaw = Math.PI;
        this.emit('breakStumps', { end: 'striker', by: k.id, stumping: true });
        this.schedule(this.t + STUMP_REACH, () => {
          if (this.phase === 'dead') return;
          this.emit('stumpsHit', { end: 'striker', stumping: true });
          this.out('stumped', this.strikerP.id, k.id, 'Stumped!');
        });
        return;
      }
    }
    this.phase = 'inplay';
    this.inplayStart = this.t;
    this.ball.heldAtEnd = 'striker';
    if (!this.desc) this.desc = why === 'miss' ? 'Beaten' : why === 'leave' ? 'Left alone' : 'No shot';
    this.schedule(this.t + 0.7, () => this.checkDead(true));
  }

  // ------------------------------------------------------------------ ball in play
  startBatted(p, v, { alreadyBounced = false, excludeId = null, penalty = 0 } = {}) {
    this.phase = 'inplay';
    if (this.inplayStart == null) this.inplayStart = this.t;
    this.ball.state = 'batted';
    this.ball.holder = null;
    this.ball.heldAtEnd = null;
    this.bat = simulateBattedBall(p, v, { startT: this.t, alreadyBounced });
    // Bowler and keeper move to the stumps for a throw.
    this.keeper.target = { x: 0.35, z: PITCH.half + 0.7 };
    this.bowler.target = { x: 0.5, z: -PITCH.half - 0.6 };
    this.planIntercept(excludeId, penalty);
  }

  catchChance(f, ballSpeed, dive, height) {
    let p = 0.5 + 0.45 * f.player.catching / 100;
    if (f.isKeeper) p += 0.1;
    if (dive) p -= 0.28;
    if (ballSpeed > 24) p -= (ballSpeed - 24) * 0.012;
    if (!f.close && f.chasing && f.home && Math.hypot(f.x - f.home.x, f.z - f.home.z) > 6) p -= 0.08; // running catch
    if (height < 0.3 || height > 2.25) p -= 0.12;
    const userFielding = this.control.field === 'user';
    p *= this.vsUser ? (userFielding ? this.D.userCatch : this.D.cpuCatch) : 1;
    return clamp(p, 0.05, 0.97);
  }

  planIntercept(excludeId = null, penalty = 0) {
    const path = this.bat.path;
    const now = this.t;
    const token = (this.interceptToken = (this.interceptToken || 0) + 1);
    const fb = this.bat.firstBounceT;
    let best = null;
    // Each fielder: the first point they can get to (perhaps only with a dive) and the first they can take
    // cleanly on their feet. They dive only when it matters (to stop the ball before the rope or to reach a
    // catch before it lands); otherwise they run on and take it cleanly a moment later.
    const bndT = this.bat.boundary?.t ?? Infinity;
    for (const f of this.allFielders) {
      if (f.role === 'bowler' && this.bowler.action === 'follow' && now - this.tRelease < 0.5) continue;
      const react = f.reaction + (f.id === excludeId ? penalty : 0);
      const n = path.t.length;
      let first = null, clean = null;
      for (let i = 0; i < n; i++) {
        const ti = path.t[i];
        if (ti < now + react * 0.6) continue;
        if (first && ti - first.t > CLEAN_WAIT) break;
        const p = path.p[i];
        const air = (fb == null || ti < fb) && !this.bat.bouncedAtStart;
        if (p.y > (air ? 2.6 : 1.3)) continue;
        if (air && p.y < 0.12) continue;
        // The keeper catches what comes back to him: not a ball played forward past the batter.
        if (air && f.isKeeper && p.z < PITCH.half - 0.4) continue;
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        // Hard-hit balls are harder to reach: less dive, a little less reach.
        const hs = Math.hypot(path.v[i].x, path.v[i].z);
        const hard = clamp(1.45 - hs / 32, 0.45, 1);
        const reach = (air ? 1.0 : 0.75) * (0.8 + 0.2 * hard);
        const avail = ti - now - react;
        if (avail < 0) continue;
        const need = timeToReach(Math.max(0, d - reach), f.speed);
        const dive = need > avail;
        if (dive && timeToReach(Math.max(0, d - reach - 1.3 * hard), f.speed) > avail) continue;
        const pt = { f, t: ti, p: { ...p }, v: { ...path.v[i] }, type: air ? 'catch' : 'stop', dive };
        if (!first) first = pt;
        if (!dive) { clean = pt; break; }
      }
      if (!first) continue;
      const pick = first.dive && clean && clean.type === first.type && clean.t < bndT ? clean : first;
      if (!best || pick.t < best.t - 1e-6 || (Math.abs(pick.t - best.t) < 1e-6 && !pick.dive && best.dive)) best = pick;
    }
    // Nobody gets there before the ball stops: nearest fielder walks to it.
    const bnd = this.bat.boundary;
    if (!best && !bnd) {
      const stopP = path.p[path.p.length - 1];
      let nearest = null;
      for (const f of this.allFielders) {
        const tt = now + f.reaction + timeToReach(Math.hypot(stopP.x - f.x, stopP.z - f.z), f.speed);
        if (!nearest || tt < nearest.t) nearest = { f, t: Math.max(tt, path.duration), p: { ...stopP }, v: { x: 0, y: 0, z: 0 }, type: 'stop', dive: false };
      }
      best = nearest;
    }
    if (best && bnd && best.t >= bnd.t) best = null;
    this.intercept = best;
    // The chaser runs at the intercept point; everyone else watches.
    for (const f of this.allFielders) { f.chasing = false; f.take = null; }   // (a take in progress stays in f.takeDone)
    if (best) {
      best.f.chasing = true;
      best.f.take = { kind: takeKind(best, best.f), t: best.t, p: { ...best.p }, v: { ...best.v } };
      best.f.target = { x: best.p.x, z: best.p.z };
      best.f.arriveBy = best.t;
      this.schedule(best.t, () => { if (token === this.interceptToken) this.onIntercept(best); });
    }
    if (bnd && !best) {
      // A deep fielder chases it to the rope anyway.
      const chaser = this.fielders.slice().sort((a, b) => Math.hypot(a.x - bnd.p.x, a.z - bnd.p.z) - Math.hypot(b.x - bnd.p.x, b.z - bnd.p.z))[0];
      if (chaser) { chaser.chasing = true; chaser.target = { x: bnd.p.x * 0.97, z: bnd.p.z * 0.97 }; }
      this.schedule(bnd.t, () => { if (token === this.interceptToken && this.ball.state === 'batted') this.onBoundary(bnd); });
    }
    this.emit('interceptPlanned', { intercept: best, boundary: bnd });
  }

  onIntercept(ic) {
    if (this.ball.state !== 'batted') return;
    const f = ic.f;
    // The fielder is at the ball, facing it: just behind it for a catch or pickup; a dive covers the last metre or so.
    const yaw = takeYaw(f, ic.p, ic.v);
    if (ic.dive) {
      const sdx = ic.p.x - f.x, sdz = ic.p.z - f.z, sd = Math.hypot(sdx, sdz);
      if (sd > 1.5) { f.x += sdx / sd * (sd - 1.5); f.z += sdz / sd * (sd - 1.5); }
    } else {
      f.x = ic.p.x - Math.sin(yaw) * 0.45;
      f.z = ic.p.z - Math.cos(yaw) * 0.45;
    }
    f.yaw = yaw;
    // the take being made now (the view animates it); a re-chase after a fumble plans a new f.take
    f.takeDone = f.take && Math.abs(f.take.t - ic.t) < 1e-6 ? f.take : { kind: takeKind(ic, f), t: ic.t, p: { ...ic.p }, v: { ...ic.v } };
    f.take = null;
    this.ball.p = { ...ic.p };
    const ballSpeed = Math.hypot(ic.v.x, ic.v.y, ic.v.z);
    if (ic.type === 'catch') {
      const p = this.catchChance(f, ballSpeed, ic.dive, ic.p.y);
      const caught = this.rng.chance(p);
      this.setAction(f, ic.dive ? 'dive' : 'catch');
      if (caught) {
        const allowed = dismissalAllowed('caught', { extra: this.noBall ? 'noball' : null, freeHit: this.freeHit });
        this.ball.state = 'held'; this.ball.holder = f.id;
        if (allowed) {
          this.emit('catch', { fielder: f.id, dive: ic.dive });
          const where = f.isKeeper ? 'caught behind' : f.role === 'bowler' ? 'caught and bowled' : `caught at ${f.spot}`;
          this.fieldedBy = f;
          this.out('caught', this.strikerP.id, f.id, `Out! ${where[0].toUpperCase() + where.slice(1)}`);
          return;
        }
        this.emit('catch', { fielder: f.id, notOut: true });
        this.afterGather(f);
        return;
      }
      this.emit('drop', { fielder: f.id });
      this.desc = `Dropped by ${f.player.name}!`;
      const v = launchVelocity(this.rng.range(1.5, 4.5), this.rng.range(-180, 180), this.rng.range(10, 50));
      this.bat = simulateBattedBall({ ...ic.p }, v, { startT: this.t, alreadyBounced: true });
      this.planIntercept(f.id, 0.9);
      return;
    }
    // Ground fielding
    const pClean = 0.9 + 0.08 * f.player.fielding / 100 - (ballSpeed > 22 ? 0.08 : 0) - (ic.dive ? 0.12 : 0);
    this.setAction(f, ic.dive ? 'dive' : 'pickup');
    if (!this.rng.chance(pClean)) {
      this.emit('misfield', { fielder: f.id });
      const keep = this.rng.range(0.25, 0.55);
      const v = { x: ic.v.x * keep + this.rng.gauss(0, 1.2), y: 0, z: ic.v.z * keep + this.rng.gauss(0, 1.2) };
      this.bat = simulateBattedBall({ ...ic.p, y: BALL_R }, v, { startT: this.t, alreadyBounced: true });
      this.planIntercept(f.id, 0.6);
      return;
    }
    this.ball.state = 'pickup';
    this.ball.holder = f.id;
    this.emit('pickup', { fielder: f.id });
    this.fieldedBy = this.fieldedBy || f;
    this.afterGather(f, ic.dive ? 1.0 : 0.3 + Math.min(0.25, ballSpeed * 0.012));
  }

  afterGather(f, delay = 0.2) {
    f.throwSpeed = 21 + 13 * f.player.fielding / 100;
    f.chasing = false;
    f.target = null;
    this.schedule(this.t + delay, () => {
      if (this.phase === 'dead') return;
      this.ball.state = 'held';
      const nearEnd = this.endNear(f);
      if (nearEnd) { this.ball.heldAtEnd = nearEnd; this.checkHeldAtEnd(); if (this.phase !== 'dead') this.schedule(this.t + 0.4, () => this.checkDead()); return; }
      if (this.control.field === 'user' && this.runState !== 'idle') {
        this.awaitThrow = { f, until: this.t + 0.55 };
        this.emit('throwChoice', { fielder: f.id });
        this.schedule(this.t + 0.55, () => { if (this.awaitThrow && this.awaitThrow.f === f) this.inputThrow('auto'); });
      } else {
        this.doThrow(f, chooseThrowEnd(f, this.runners, f.throwSpeed, this.runState));
      }
    });
  }

  endNear(f) {
    if (Math.hypot(f.x - 0, f.z - PITCH.half) < 2.2) return 'striker';
    if (Math.hypot(f.x - 0, f.z + PITCH.half) < 2.2) return 'nonStriker';
    return null;
  }

  doThrow(f, end) {
    if (this.phase === 'dead') return;
    const receiver0 = end === 'striker' ? this.keeper : this.bowler;
    const stumpsZ = end === 'striker' ? PITCH.half : -PITCH.half, behind = end === 'striker' ? 1 : -1;
    if (receiver0 === f) {
      // Keeper (or bowler) picked it up themselves: run to the stumps with it.
      const to = { x: 0.2, z: stumpsZ + behind * 0.6 };
      const d = Math.hypot(to.x - f.x, to.z - f.z);
      f.target = to;
      this.ball.state = 'held';
      this.ball.holder = f.id;
      this.schedule(this.t + d / f.speed + 0.05, () => {
        if (this.phase === 'dead') return;
        f.x = to.x; f.z = to.z;
        this.setAction(f, 'collect');
        this.atTheStumps(f, end);
      });
      return;
    }
    const casual = this.runState === 'idle';
    const speed = (f.throwSpeed || 26) * (casual ? 0.65 : 1);
    const receiver = receiver0;
    const wild = !casual && this.rng.chance(0.07 * (1.2 - f.player.fielding / 100));
    // Where the throw is taken: chest-high just behind the stumps, or wide of them for a wild one.
    let to = { x: end === 'striker' ? 0.15 : 0.1, y: 0.85, z: stumpsZ + behind * 0.45 };
    if (wild) to = { x: to.x + this.rng.sign() * this.rng.range(1.2, 2.2), y: this.rng.range(0.4, 1.5), z: to.z + behind * this.rng.range(0, 0.9) };
    const aim = () => {
      // Turn to face the target; the ball leaves the throwing hand, up and a little in front of the head.
      f.yaw = Math.atan2(to.x - f.x, to.z - f.z);
      return { x: f.x + Math.sin(f.yaw) * 0.35 - Math.cos(f.yaw) * 0.18, y: 2.05, z: f.z + Math.cos(f.yaw) * 0.35 + Math.sin(f.yaw) * 0.18 };
    };
    let from = aim();
    let d = Math.hypot(to.x - from.x, to.z - from.z);
    // A direct hit flies into the stumps; otherwise the receiver takes it and breaks the wicket with it.
    const direct = !casual && !wild && d < 28 && this.rng.chance(0.18 + 0.25 * f.player.fielding / 100 - d * 0.004);
    if (direct) { to = { x: this.rng.range(-0.06, 0.06), y: this.rng.range(0.25, 0.55), z: stumpsZ }; from = aim(); d = Math.hypot(to.x - from.x, to.z - from.z); }
    const windup = casual ? 0.35 : 0.3;
    const flight = d / speed * (wild ? 1.15 : 1);
    const tTake = this.t + windup + flight;
    const gather = casual || direct ? 0 : (wild ? 0.6 : 0.2) + this.rng.range(0, 0.25);
    this.setAction(f, 'throw');
    this.ball.state = 'thrown';
    this.ball.throw = { from, to, start: this.t + windup, dur: flight, end, arc: Math.min(wild ? 7 : 6, d * (wild ? 0.09 : 0.06)) };
    this.ball.throwEnd = end;
    this.ball.throwArrive = tTake + gather;     // when the bails can come off (the running AI judges by this)
    this.ball.directHit = direct;
    this.ball.holder = f.id;
    this.emit('throw', { fielder: f.id, end, wild });
    receiver.target = direct ? { x: 0.35, z: stumpsZ + behind * 0.7 } : { x: to.x, z: to.z + behind * 0.2 };
    this.schedule(tTake, () => (direct ? this.directHit(f, receiver, end, to) : this.takeThrow(receiver, end, to)));
  }

  /** The receiver takes the throw in the gloves (the ball is in his hands from here), facing the stumps. */
  takeThrow(r, end, to) {
    if (this.phase === 'dead') return;
    const stumpsZ = end === 'striker' ? PITCH.half : -PITCH.half, behind = end === 'striker' ? 1 : -1;
    this.ball.state = 'held';
    this.ball.holder = r.id;
    this.ball.p = { ...to };
    const sx = to.x, sz = to.z + behind * 0.2;
    if (Math.hypot(r.x - sx, r.z - sz) < 2.5) { r.x = sx; r.z = sz; }
    r.target = { x: 0.2, z: stumpsZ + behind * 0.6 };     // and back over the stumps (a wild throw is taken wide)
    r.yaw = Math.atan2(0 - r.x, stumpsZ - r.z);
    this.setAction(r, 'collect');
    this.emit('throwTaken', { end, by: r.id });
    // going down to the stumps is part of the gather: the bails come off at throwArrive
    this.schedule(Math.max(this.t, this.ball.throwArrive - STUMP_REACH), () => this.atTheStumps(r, end));
  }

  /**
   * Ball in hand at the stumps: if a batter is short of their ground, go for the run-out and break the wicket
   * with the ball (the bails come off when the gloves reach the stumps); otherwise hold it there.
   */
  atTheStumps(r, end) {
    if (this.phase === 'dead') return;
    const stumpsZ = end === 'striker' ? PITCH.half : -PITCH.half;
    r.yaw = Math.atan2(0 - r.x, stumpsZ - r.z);
    const tBails = this.t + STUMP_REACH;
    const near = this.runners.slice().sort((a, b) => Math.abs(a.z - CREASE_Z[end]) - Math.abs(b.z - CREASE_Z[end]))[0];
    // Will that batter still be short when the gloves get there? (where they'll be at their current pace)
    const ahead = near?.target ? Math.sign(RUN_TO[near.target] - near.z) * (near.v || 0) * STUMP_REACH : 0;
    const going = !!near && !isSafe({ ...near, z: near.z + ahead }, end);
    const arrive = () => {
      if (this.phase === 'dead') return;
      this.ball.heldAtEnd = end;
      this.emit('throwArrive', { end });
      this.checkHeldAtEnd(true);
      if (this.phase !== 'dead') this.schedule(this.t + 0.45, () => this.checkDead());
    };
    if (going) {
      this.breaking = { end, t: this.t };
      this.emit('breakStumps', { end, by: r.id });
      this.schedule(tBails, arrive);
    } else this.schedule(Math.max(this.t, this.ball.throwArrive ?? this.t), arrive);
  }

  /** A direct hit: the ball knocks the stumps over. Short of the crease: out. In time: it rebounds into the field. */
  directHit(f, r, end, to) {
    if (this.phase === 'dead') return;
    this.ball.p = { ...to };
    const near = this.runners.slice().sort((a, b) => Math.abs(a.z - CREASE_Z[end]) - Math.abs(b.z - CREASE_Z[end]))[0];
    this.emit('stumpsHit', { end, runout: true, direct: true });
    if (near && !isSafe(near, end) && (near.target || this.runState !== 'idle')) {
      this.ball.state = 'held';
      this.ball.holder = null;
      this.out('runout', near.id, f.id, `Run out! Direct hit from ${f.player.name}`, end);
      return;
    }
    // Made it: the ball comes off the stumps back towards the field and is gathered (overthrows are possible).
    const back = Math.atan2(f.x - to.x, f.z - to.z) + this.rng.range(-0.7, 0.7), sp = this.rng.range(2, 5);
    this.ball.state = 'batted';
    this.ball.holder = null;
    this.bat = simulateBattedBall({ ...to }, { x: Math.sin(back) * sp, y: 0.6, z: Math.cos(back) * sp }, { startT: this.t, alreadyBounced: true });
    this.planIntercept();
  }

  /**
   * Ball is at the stumps at one end: anyone out of their ground there is run out. The one holding the ball
   * takes it to the stumps first (STUMP_REACH); the bails come off when the gloves get there, and a batter who
   * makes their ground in that moment survives.
   */
  checkHeldAtEnd(onArrival = false) {
    const end = this.ball.heldAtEnd;
    if (!end || this.phase === 'dead') return;
    const near = this.runners.slice().sort((a, b) => Math.abs(a.z - CREASE_Z[end]) - Math.abs(b.z - CREASE_Z[end]))[0];
    if (isSafe(near, end) || !(near.target || this.runState !== 'idle' || onArrival)) return;
    let b = this.breaking;
    if (b && (b.end !== end || this.t - b.t > 1.0)) b = this.breaking = null;   // an old attempt
    if (b && this.t - b.t >= STUMP_REACH - 1e-6) {
      this.emit('stumpsHit', { end, runout: true });
      this.out('runout', near.id, this.ball.holder, `Run out! ${near.player.name} is short`, end);
      return;
    }
    if (b) return;                       // the gloves are on their way
    this.breaking = { end, t: this.t };
    this.emit('breakStumps', { end, by: this.ball.holder });
    this.schedule(this.t + STUMP_REACH, () => { if (this.phase !== 'dead') this.checkHeldAtEnd(true); });
  }

  checkDead(force = false) {
    if (this.phase === 'dead') return;
    const bothSafe = this.runners.every(r => !r.target && isSafe(r, r.end));
    if (this.ball.state === 'held' && this.runState === 'idle' && bothSafe) {
      if (this.ball.heldAtEnd || force) { this.finish(); return; }
      // Held in the field: lob it back to the keeper.
      const f = this.fielderById(this.ball.holder);
      if (f) this.doThrow(f, 'striker');
      return;
    }
    this.schedule(this.t + 0.25, () => this.checkDead(force));
  }

  onBoundary(b) {
    this.boundary = b.runs;
    this.ball.p = { ...b.p };
    this.emit('boundary', { runs: b.runs });
    this.desc = b.runs === 6 ? `SIX! ${this.desc}` : `FOUR! ${this.desc}`;
    this.finish();
  }

  // ------------------------------------------------------------------ running
  applyRunCommand(cmd, { byUser = false } = {}) {
    if (this.phase === 'dead') return;
    if (cmd === 'run') {
      if (this.holdRuns && !byUser) return;          // after a dive only the player starts the next run
      if (byUser) this.holdRuns = false;
      if (this.runState === 'idle') {
        if (this.ball.heldAtEnd && this.ball.state === 'held' && this.control.running === 'ai' && !byUser) return;
        this.diveCall = false;
        for (const r of this.runners) { r.target = r.end === 'striker' ? 'nonStriker' : 'striker'; r.arrived = false; r.madeGround = null; r.divedThisRun = false; }
        this.runState = 'running';
        this.runTurnWait = this.runsCompleted > 0 || this.queuedTurn ? 0.3 : 0.12;
        this.emit('runCall', { call: 'yes' });
      } else if (this.runState === 'running') {
        this.queuedRun = true;
      }
    } else if (cmd === 'back') {
      this.queuedRun = false;
      if (this.runState === 'running') {
        const crossed = this.runners.some(r => (r.target === 'nonStriker' ? r.z < 0 : r.z > 0));
        if (!crossed) {
          for (const r of this.runners) { r.target = r.end; r.madeGround = null; }
          this.runState = 'returning';
          this.emit('runCall', { call: 'no' });
        }
      }
    }
  }

  updateRunners(dt) {
    if (this.runTurnWait > 0) { this.runTurnWait -= dt; }
    const boost = this.sprint ? SPRINT : { speed: 1, accel: 1 };
    if (this.diveCall) this.diveInRange();          // a dive called early happens as the batter reaches his crease
    for (const r of this.runners) {
      if (r.dive) { this.updateDive(r, dt); continue; }
      // Grounded at the far end by a dive: in, waiting for the partner.
      if (r.target && r.madeGround === r.target) { r.arrived = true; r.v = 0; if (r.action === 'run') this.setAction(r, 'idle'); continue; }
      if (r.target && this.runTurnWait <= 0) {
        const goal = RUN_TO[r.target];
        r.v = Math.min(r.speed * boost.speed, r.v + 7 * boost.accel * dt);
        const dz = goal - r.z;
        const step = Math.sign(dz) * Math.min(Math.abs(dz), r.v * dt);
        r.z += step;
        r.x += ((r.target === 'nonStriker' ? 0.9 : -0.9) - r.x) * Math.min(1, dt * 3);
        this.setAction(r, 'run');
        r.yaw = dz > 0 ? 0 : Math.PI;
        if (Math.abs(goal - r.z) < 0.02) { r.arrived = true; r.v = 0; }
        else r.arrived = false;
      } else if (!r.target) {
        r.v = 0;
        // Make your ground if you're out of it (stepped out / backing up).
        const safe = isSafe(r, r.end);
        if (!safe) {
          const goal = r.end === 'striker' ? CREASE_Z.striker - 0.5 : CREASE_Z.nonStriker + 0.5;
          r.z += Math.sign(goal - r.z) * Math.min(Math.abs(goal - r.z), 3.5 * dt);
          this.setAction(r, 'run');
        } else if (r.action === 'run') this.setAction(r, 'idle');
      }
    }
    if ((this.runState === 'running' || this.runState === 'returning') && this.runners.every(r => r.target && r.arrived)) {
      const ran = this.runState === 'running';
      for (const r of this.runners) { r.end = r.target; r.target = null; r.arrived = false; }
      this.runState = 'idle';
      this.diveCall = false;
      if (ran) {
        this.runsCompleted++;
        this.emit('runComplete', { runs: this.runsCompleted });
      }
      if (ran && this.queuedRun) {
        this.queuedRun = false;
        this.queuedTurn = true;
        this.applyRunCommand('run');
        this.queuedTurn = false;
      }
    }
  }

  runSnapshot() {
    const ic = this.intercept;
    const holder = this.ball.holder ? this.fielderById(this.ball.holder) : null;
    return {
      now: this.t,
      runState: this.runState,
      queueAllowed: this.runState === 'running' && !this.queuedRun,
      runners: this.runners.map(r => ({ z: r.z, end: r.end, target: r.target, speed: r.speed, v: r.v })),
      ball: {
        state: this.ball.state,
        interceptT: ic ? ic.t : null,
        interceptPos: ic ? ic.p : null,
        catchable: ic ? ic.type === 'catch' : false,
        boundaryT: this.bat?.boundary ? this.bat.boundary.t : null,
        holderPos: holder ? { x: holder.x, z: holder.z } : null,
        heldAtEnd: this.ball.state === 'held' ? this.ball.heldAtEnd : null,
        throwEnd: this.ball.throwEnd, throwArrive: this.ball.throwArrive,
      },
      throwSpeed: holder?.throwSpeed || ic?.f?.throwSpeed || 27,
      aggression: batterIntent(this.strikerP, this.situation, this.ballsFaced),
      judgement: this.runJudgement ?? (this.runJudgement = this.rng.gauss(0, 0.2)),
    };
  }

  updateInplay(dt) {
    // Ball position
    if (this.ball.state === 'batted' && this.bat) {
      const s = this.bat.path.at(this.t);
      this.ball.p = s.p; this.ball.v = s.v;
    } else if (this.ball.state === 'thrown' && this.ball.throw) {
      const th = this.ball.throw;
      const u = clamp((this.t - th.start) / th.dur, 0, 1);
      if (this.t < th.start) {
        const h = this.fielderById(this.ball.holder);
        if (h) this.ball.p = { x: h.x, y: 1.7, z: h.z };
      } else {
        this.ball.p = {
          x: th.from.x + (th.to.x - th.from.x) * u,
          y: th.from.y + (th.to.y - th.from.y) * u + Math.sin(Math.PI * u) * th.arc,
          z: th.from.z + (th.to.z - th.from.z) * u,
        };
      }
    } else if ((this.ball.state === 'held' || this.ball.state === 'pickup') && this.ball.holder) {
      const h = this.fielderById(this.ball.holder);
      if (h) this.ball.p = { x: h.x, y: 1.1, z: h.z };
    }

    this.followThrough();
    this.moveFielders(dt);

    // Running
    if (this.control.running === 'ai' && this.t - this.lastRunDecisionT > 0.1 && this.t - this.inplayStart > 0.18) {
      this.lastRunDecisionT = this.t;
      const d = runDecision(this.runSnapshot());
      if (d === 'run' && (this.runState === 'idle' || this.runState === 'running')) this.applyRunCommand('run');
      else if (d === 'back') this.applyRunCommand('back');
    }
    this.updateRunners(dt);
    if (this.ball.state === 'held' && this.ball.heldAtEnd) this.checkHeldAtEnd();

    if (this.t - this.inplayStart > MAX_INPLAY && this.phase !== 'dead') {
      this.runState = 'idle';
      for (const r of this.runners) { if (r.target) { r.end = Math.abs(r.z - RUN_TO.striker) < Math.abs(r.z - RUN_TO.nonStriker) ? 'striker' : 'nonStriker'; r.target = null; } }
      this.finish();
    }
  }

  moveFielders(dt) {
    const bp = this.ball.p;
    for (const f of this.allFielders) {
      if (f.target && (f.chasing || f.role !== 'fielder')) {
        if (f.chasing && this.t - (this.inplayStart ?? this.t) < f.reaction) continue;
        const dx = f.target.x - f.x, dz = f.target.z - f.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          f.v = Math.min(f.speed, (f.v || 0) + FIELDER_ACCEL * dt);
          const step = Math.min(d, f.v * dt);
          f.x += dx / d * step; f.z += dz / d * step;
          f.yaw = Math.atan2(dx, dz);
          if (!['dive', 'catch', 'throw', 'pickup', 'collect'].includes(f.action) || f.actionT > 0.7) this.setAction(f, 'run');
        } else { f.v = 0; if (f.action === 'run') this.setAction(f, f.isKeeper ? 'crouch' : 'ready'); }
      } else if (bp && f.action !== 'throw' && this.ball.holder !== f.id) {
        f.v = 0;
        f.yaw = Math.atan2(bp.x - f.x, bp.z - f.z);
        if (f.action === 'run' || (['dive', 'catch', 'pickup', 'collect'].includes(f.action) && f.actionT > 1.2)) this.setAction(f, f.isKeeper ? 'crouch' : 'ready');
      }
    }
  }

  animateIdle(dtReal) {
    const dt = dtReal;
    this.t += dt;
    for (const a of [...this.allFielders, ...this.runners, this.umpire, this.legUmpire]) a.actionT += dt;
  }

  // ------------------------------------------------------------------ endings
  out(type, batterId, fielderId, text, end = null) {
    this.dismissal = { type, batter: batterId, fielder: fielderId, end: end || 'striker' };
    this.desc = text;
    this.emit('wicket', { type, batter: batterId, fielder: fielderId });
    this.finish();
  }

  finish() {
    if (this.phase === 'dead') return;
    // Any run in progress that wasn't completed doesn't count.
    if (!this.dismissal || this.dismissal.type !== 'runout') {
      for (const r of this.runners) if (r.target) { r.target = null; }
      this.runState = 'idle';
    }
    this.phase = 'dead';
    this.deadAt = this.t;
    this.timeline = [];
    this.awaitThrow = null;
    if (!this.desc) this.desc = this.contactMade ? describeShot(this.shotResult) : 'Dot ball';
    const r = this.result();
    // Umpire signal
    const sig = r.dismissal ? 'out' : r.boundary === 6 ? 'six' : r.boundary === 4 ? (r.runType === 'bat' ? 'four' : 'bye') : r.extra === 'wide' ? 'wide' : r.extra === 'noball' ? 'noball' : null;
    if (sig) { this.umpire.signal = sig; this.setAction(this.umpire, 'signal'); }
    else if (this.umpire.signal !== 'notout') this.umpire.signal = null;   // keep a NOT OUT shake going
    // Reactions
    for (const f of this.allFielders) {
      if (r.dismissal) this.setAction(f, 'celebrate');
      else if (f.action === 'run') this.setAction(f, f.isKeeper ? 'crouch' : 'ready');
    }
    const sr = this.runners.find(x => x.id === r.dismissal?.batter);
    if (sr) this.setAction(sr, 'out');
    else if (r.boundary && this.contactMade) this.setAction(this.strikerRunner, 'celebrate');
    this.emit('dead', { result: r });
  }

  /** The ball record for the rules engine (CricketRules.applyBall). */
  result() {
    const extra = this.isWide ? 'wide' : this.noBall ? 'noball' : null;
    const runType = this.contactMade ? 'bat' : this.padHit ? 'legbye' : 'bye';
    const runs = this.boundary ? this.boundary : this.runsCompleted;
    const label = SHOTS[this.shot?.shotId]?.label || null;
    return {
      extra,
      runs,
      boundary: this.boundary || 0,
      runType,
      dismissal: this.dismissal,
      desc: this.desc,
      shot: label,
      timing: this.timing?.label || null,
      speedKph: this.plan?.speedKph || 0,
      deliveryType: this.plan?.typeLabel || '',
      lengthClass: this.plan?.lengthClass || '',
      lineClass: this.plan?.lineClass || '',
      noBallReason: this.noBall ? this.noBallReason : null,
      effort: 1 + (this.plan?.power || 0) * 0.5,
      fielderName: this.fieldedBy?.player?.name || null,
      highlight: this.dismissal ? 'wicket' : this.boundary === 6 ? 'six' : this.boundary === 4 ? 'four' : null,
    };
  }

  /** Skip to the end of the ball (animation interrupted): AI makes any pending choices. */
  fastForward(maxSteps = 6000) {
    if (this.control.running === 'user') this.control.running = 'skip';
    if (this.phase === 'ready') this.startRunup();
    let n = 0;
    while (this.phase !== 'dead' && n++ < maxSteps) {
      if (this.awaitThrow) this.inputThrow('auto');
      if (this.phase === 'flight' && this.control.bat === 'user' && !this.shot) { /* no shot offered */ }
      this.update(1 / 60);
    }
    if (this.phase !== 'dead') this.finish();
    return this.result();
  }
}
