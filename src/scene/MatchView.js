// Draws a DeliverySim: maps simulation actors to animated PlayerModels in the delivery frame,
// shows the ball, its shadow and trail, the pitch marker and the bowling aim marker,
// and records frames for instant replays. It never changes the simulation.
import * as THREE from 'three';
import { PlayerModel } from './PlayerModel.js';
import { CONTACT_T, RELEASE_T, TAKE_CT, TRIGGER_LEAD, copyPose, emptyPose } from './Animations.js';
import { PITCH } from '../game/BallPhysics.js';
import { lengthDef } from '../game/PhysicsConfig.js';
import { BATTER_X, STANCE_Z } from '../game/ShotModel.js';
import { takeYaw } from '../game/DeliverySim.js';

// How each kind of take is animated (see Animations.js TAKE_CT for when the hands meet the ball).
const TAKE_CLIP = { catchHigh: 'takeHigh', catchChest: 'takeChest', catchLow: 'takeLow', pickup: 'takePickup', barrier: 'takeBarrier' };
import { ballMaterial, setBallLook } from './BallLook.js';

const _spinAxis = new THREE.Vector3(), _q = new THREE.Quaternion();
const SEAM_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);   // seam upright, along the pitch

const SHOT_CLIP = {
  defend: 'shot_defend', straightDrive: 'shot_straightDrive', coverDrive: 'shot_coverDrive', flick: 'shot_flick',
  punch: 'shot_punch', cut: 'shot_cut', pull: 'shot_pull', hook: 'shot_hook', lofted: 'shot_lofted', sweep: 'shot_sweep', leave: 'shot_leave',
};

/**
 * Where the bat goes relative to the ball for a shot's outcome (batter's local space: +x towards the bowler, y up,
 * +z off side). Edges put the ball on the inside (leg-side) or outside edge, a top edge has the bat just under it,
 * and a miss takes the bat well clear: inside the line and over the top.
 */
export function batOffset(outcome) {
  if (!outcome) return null;
  if (outcome.result === 'miss') return [0, 0.13, -0.12];
  if (outcome.result !== 'edge') return null;
  switch (outcome.edgeType) {
    case 'inside': return [0, 0, 0.05];
    case 'outside-thin': return [0, 0.01, -0.058];
    case 'top': return [0, -0.05, 0];
    default: return [0, 0.01, -0.045];   // thick outside edge, leading edge
  }
}

export class MatchView {
  constructor(stadium, { shadows = true, quality = 'medium' } = {}) {
    this.stadium = stadium;
    this.quality = quality;
    this.frame = stadium.frame;
    this.shadows = shadows;
    this.models = new Map();
    this.active = new Set();
    this.view = new Map(); // per-actor view state
    this.recording = null;
    this.replay = null;

    // Ball, shadow, trail
    // Leather ball with a stitched seam (red for Tests, white otherwise), spinning in flight.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 28, 18), ballMaterial());
    this.ball.castShadow = false;
    this.ballSpin = 0;
    this.look = { whites: false, ball: 'white', wear: 0 };
    this.frame.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.frame.add(this.ballShadow);
    this.trailN = 18;
    this.trailPts = new Float32Array(this.trailN * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPts, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 }));
    this.trail.frustumCulled = false;
    this.frame.add(this.trail);
    this.trailHist = [];

    // Pitch marker (where the ball bounced)
    this.pitchMark = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.11, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false }));
    this.pitchMark.position.y = 0.02;
    this.frame.add(this.pitchMark);

    // Bowling aim marker
    const aim = new THREE.Group();
    aim.add(new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, depthWrite: false })));
    aim.add(new THREE.Mesh(new THREE.CircleGeometry(0.05, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, depthWrite: false })));
    aim.position.y = 0.025;
    aim.visible = false;
    this.aim = aim;
    this.frame.add(aim);
    // Band showing the selected length's pitching range
    this.band = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.16, depthWrite: false }));
    this.band.position.y = 0.02;
    this.band.visible = false;
    this.frame.add(this.band);

  }

  // ------------------------------------------------------------------ models
  /** Kit and ball for what's being played: { whites, ball: 'red' | 'white', wear 0..1 }. */
  setLook({ whites = false, ball = 'white', wear = 0 } = {}) {
    this.look = { whites: !!whites, ball, wear };
    setBallLook(ball, wear);
  }

  modelFor(player, team, role) {
    const whites = this.look.whites && role !== 'umpire';
    const key = `${player?.id || role}:${role}${whites ? ':whites' : ''}`;
    let m = this.models.get(key);
    if (!m) {
      m = new PlayerModel({ player, team, role, withBat: role === 'batter', shadows: this.shadows, quality: this.quality, whites });
      m.showBall = false;
      this.models.set(key, m);
      this.frame.add(m.root);
    }
    return m;
  }

  hideAll() { for (const m of this.models.values()) m.root.visible = false; this.active.clear(); }

  /** Attach to a new delivery: decide which models are on the field. */
  bind(sim, { battingTeam, bowlingTeam }) {
    this.sim = sim;
    this.hideAll();
    this.view.clear();
    const add = (actor, model, kind) => { model.root.visible = true; this.active.add(model); this.view.set(actor, { model, kind, clip: null, t0: 0 }); };
    for (const r of sim.runners) add(r, this.modelFor(r.player, battingTeam, 'batter'), r.id === sim.strikerP.id ? 'striker' : 'nonStriker');
    add(sim.bowler, this.modelFor(sim.bowler.player, bowlingTeam, 'fielder'), 'bowler');
    // In the nets it's just batter and bowler: no keeper, fielders or umpires.
    if (!sim.nets) {
      const keeper = this.modelFor(sim.keeper.player, bowlingTeam, 'keeper');
      keeper.setKeeperHelmet(sim.kind === 'spin');
      add(sim.keeper, keeper, 'keeper');
      for (const f of sim.fielders) add(f, this.modelFor(f.player, bowlingTeam, 'fielder'), 'fielder');
      add(sim.umpire, this.modelFor({ id: 'ump1', name: 'Umpire' }, null, 'umpire'), 'umpire');
      add(sim.legUmpire, this.modelFor({ id: 'ump2', name: 'Umpire' }, null, 'umpire'), 'legUmpire');
    }
    const bowlerModel = this.view.get(sim.bowler).model;
    bowlerModel.showBall = true;
    for (const m of this.active) if (m !== bowlerModel) m.showBall = false;
    this.stadium.resetStumps();
    this.trailHist = [];
    this.pitchMark.material.opacity = 0;
    this.bounceShown = false;
    this.shotView = null;
    this.deliverStart = null;
    this.releaseSeen = false;
    this.recording = { frames: [], start: null, done: false, stumps: [], marks: {} };
    this.stumpBy = null;      // { id, t, end }: who is breaking the wicket with the ball, from when
    for (const m of this.active) { m.setBatAim(null); m.setShuffle(null); }
    this.update(0);
  }

  // ------------------------------------------------------------------ events from the sim
  onEvent(ev) {
    const sim = this.sim;
    if (!sim) return;
    switch (ev.type) {
      case 'shotStart': {
        // The swing is timed so the bat reaches the ball exactly when the sim has it meet the ball (tContact),
        // and aimed at where the ball is then: a hit ball leaves from the face of the bat.
        const lead = Math.max(0.05, ev.lead || 0.14);
        const tContact = ev.tContact ?? ev.t + lead;
        let clip = SHOT_CLIP[ev.shotId] || 'shot_defend';
        if (ev.shotId === 'defend' && ev.foot === 'back') clip = 'shot_defendBack';
        const rate = ev.shotId === 'leave' ? 1.6 : CONTACT_T / Math.max(0.03, tContact - ev.t);
        // the blend in from the backlift finishes well before contact, however late the shot was played
        const blend = Math.min(0.18, 0.4 * (tContact - ev.t) / (sim.deliveryScale || 1));
        this.shotView = { clip, t0: ev.t, rate, blend, foot: ev.shotId === 'sweep' ? 'front' : ev.foot, stepOut: !!ev.stepOut, planned: !!ev.outcome };
        this.aimStrikerShot(clip, tContact, !!ev.stepOut, ev.outcome, rate);
        break;
      }
      case 'timing': {
        // The sim has decided the contact: pull the bat off the line for a miss, onto an edge for an edge.
        const res = sim.shotResult, m = this.strikerModel();
        if (!res || !m?.batAim || this.shotView?.planned) break;   // a planned shot was aimed for its outcome from the start
        const miss = res.result === 'miss' ? [0, 0.13, -0.1]
          : res.result === 'edge' ? (res.edgeType === 'inside' ? [0, 0, 0.045] : [0, 0.01, -0.045]) : null;
        if (miss) { m.batAim.miss = miss; m.batAim.missT = CONTACT_T - 0.02; }
        break;
      }
      case 'stumpsHit': {
        const strength = ev.runout ? 0.8 : 1.2;
        this.stadium.breakStumps(ev.end, strength);
        this.recording?.stumps.push({ t: ev.t, end: ev.end, strength });   // replays break them at the same moment
        break;
      }
      case 'breakStumps': this.stumpBy = { id: ev.by, t: ev.t, end: ev.end }; break;
      default: break;
    }
    // key moments for the replay director
    if (this.recording && ['release', 'contact', 'padHit', 'bodyHit', 'catch', 'boundary', 'wicket', 'stumpsHit', 'keeperCollect'].includes(ev.type)) {
      const m = this.recording.marks;
      if (m[ev.type] == null) m[ev.type] = ev.t ?? sim.t;
    }
  }

  strikerModel() {
    for (const v of this.view.values()) if (v.kind === 'striker') return v.model;
    return null;
  }

  /** Where the striker stands during a shot (fixed, so the body doesn't jump when the sim moves the runner). */
  shotAnchorZ(ct) {
    if (!this.shotView?.stepOut) return STANCE_Z;
    const u = Math.min(1, ct / CONTACT_T);
    return STANCE_Z + (7.95 - STANCE_Z) * u * u * (3 - 2 * u);
  }

  /**
   * Steer the striker's swing to where the ball will be at contact, for the outcome the sim has settled: the middle
   * of the bat on the ball, the ball on an edge, or the bat going past it (beaten, or out of reach).
   */
  aimStrikerShot(clip, tContact, stepOut, outcome = null, rate = 1) {
    const m = this.strikerModel(), sim = this.sim;
    if (!m || clip === 'shot_leave' || sim.tRelease == null) { m?.setBatAim(null); return; }
    const z = stepOut ? 7.95 : STANCE_Z;
    m.setPosition(BATTER_X + (sim.guard || 0), z, Math.PI / 2);
    m.root.updateMatrixWorld(true);
    const ballAt = t => { const p = sim.plan.path.at(Math.max(0, t - sim.tRelease)).p; return m.root.worldToLocal(this.frame.localToWorld(new THREE.Vector3(p.x, p.y, p.z))); };
    const ball = ballAt(tContact);
    const k = 1 / (m.root.scale.x || 1);
    if (outcome?.result !== 'miss') {
      const off = batOffset(outcome);
      if (off) ball.add(new THREE.Vector3(...off).multiplyScalar(k));
      m.aimShot(clip, ball);
      return;
    }
    // A miss: the bat goes past the ball and no part of the blade may touch it on the way. Beaten, the swing is aimed
    // just inside and over the line of the ball; out of reach, it goes through on its own line. Either way the swing
    // is checked either side of contact and pushed away from the ball until the whole blade is clear.
    const nat = m.naturalSweet(clip);
    const target = outcome.reason === 'Out of reach' && nat ? nat.clone() : ball.clone().add(new THREE.Vector3(...batOffset(outcome)).multiplyScalar(k));
    let d = m.aimShot(clip, target);
    const clear = 0.18 * k, seg = new THREE.Vector3(), q = new THREE.Vector3();
    const closest = () => {
      let worst = null;
      for (let dc = -0.09; dc <= 0.0901; dc += 0.015) {
        const b = m.bladeAt(clip, CONTACT_T + dc);
        if (!b) break;
        const p = ballAt(tContact + dc / rate);
        seg.subVectors(b.toe, b.top);
        const u = Math.max(0, Math.min(1, q.subVectors(p, b.top).dot(seg) / seg.lengthSq()));
        const near = b.top.clone().addScaledVector(seg, u), dist = near.distanceTo(p);
        if (dist < clear && (!worst || dist < worst.d)) worst = { d: dist, dir: dist > 1e-4 ? near.sub(p).normalize() : new THREE.Vector3(0, 1, 0) };
      }
      return worst;
    };
    let restarted = false;
    for (let it = 0; it < 8; it++) {
      const w = closest();
      if (!w) break;
      if (d && Math.hypot(d[0], d[1], d[2]) > 0.94 && nat && !restarted) {
        // stretched as far as the swing goes: start again from its natural line
        restarted = true;
        target.copy(nat);
      } else target.addScaledVector(w.dir, clear - w.d + 0.01 * k);
      d = m.aimShot(clip, target);
    }
  }

  // ------------------------------------------------------------------ per-frame sync
  update(dt) {
    if (this.replay) { this.updateReplay(dt); return; }
    const sim = this.sim;
    if (!sim) return;
    const t = sim.t;
    this.updateHolder();
    for (const [actor, v] of this.view) this.syncActor(actor, v, t, dt);
    this.syncBall(dt);
    // Aim marker for the human bowler
    const showAim = sim.control.bowl === 'user' && (sim.phase === 'ready' || sim.phase === 'runup') && !this.aim.userHidden;
    this.aim.visible = showAim;
    this.band.visible = showAim;
    if (showAim) {
      const L = lengthDef(sim.spec.length);
      const z = L.range ? PITCH.half - sim.spec.target.len : PITCH.popping;   // full toss: aimed at the batter
      this.aim.position.set(sim.spec.target.x, 0.025, z);
      const s = 1 + Math.sin(t * 6) * 0.08;
      this.aim.scale.set(s, 1, s);
      const [a, b] = L.range || [-0.25, 0.25].map(v => PITCH.half - PITCH.popping + v);
      this.band.scale.set(2.2, 1, Math.max(0.3, b - a));
      this.band.position.set(0, 0.02, PITCH.half - (a + b) / 2);
    }
    this.record(t);
  }

  /** Show or hide the players and the ball (ball tracking shows only the pitch, stumps and the graphic). */
  setActorsVisible(on) {
    for (const m of this.active) m.root.visible = on && !(this.hideUmpire && m.player?.id === 'ump1');
    this.ball.visible = on && this.ball.visible;
    this.ballShadow.visible = on && this.ballShadow.visible;
    this.trail.visible = on && this.trail.visible;
    this.pitchMark.material.opacity = on ? this.pitchMark.material.opacity : 0;
  }

  /** A fielder with the ball has it in the hand (not floating beside them) until it's thrown. */
  updateHolder() {
    const sim = this.sim, b = sim.ball;
    const held = b.holder && (b.state === 'held' || b.state === 'pickup' || (b.state === 'thrown' && b.throw && sim.t < b.throw.start));
    const holder = held ? this.view.get(sim.fielderById(b.holder))?.model : null;
    for (const m of this.active) { m.holdingBall = m === holder; if (m === holder) m.showBall = true; }
    this.holderModel = holder;
  }

  syncActor(actor, v, t, dt) {
    const sim = this.sim;
    const m = v.model;
    let clip = 'idle', ct = actor.actionT || 0, x = actor.x, z = actor.z, yaw = actor.yaw ?? 0, blend;
    switch (v.kind) {
      case 'striker':
      case 'nonStriker': {
        const isStriker = v.kind === 'striker';
        const running = actor.action === 'run';
        const gx = BATTER_X + (sim.guard || 0);   // the striker's guard: where they have shuffled to across the crease
        let shuffle = false;
        // Out: a striker who played a shot holds it for a moment (played on, edged behind) before walking off.
        const hold = isStriker && this.shotView && this.shotView.clip !== 'shot_leave' && t - this.shotView.t0 < 2.4 ? 0.9 : 0;
        if (actor.action === 'out' && actor.actionT >= hold) { clip = 'walkOff'; ct = actor.actionT - hold; yaw = Math.PI / 2 + 0.6; x = actor.x - (actor.actionT - hold) * 0.6; }
        else if (actor.action === 'celebrate') { clip = 'celebrateBat'; yaw = 0; }
        else if (actor.action === 'dive') { clip = 'diveBat'; ct = actor.actionT; yaw = actor.yaw ?? 0; }
        else if (running) { clip = 'runBat'; yaw = actor.yaw ?? 0; ct = t; }
        else if (isStriker && this.shotView && (sim.phase === 'flight' || t - this.shotView.t0 < 2.4) && Math.abs(actor.z - 9) < 2.2) {
          clip = this.shotView.clip; ct = (t - this.shotView.t0) * this.shotView.rate; yaw = Math.PI / 2; blend = this.shotView.blend;
          if (clip === 'shot_leave') ct = Math.min(ct, 1);
          // the clip moves the body itself (stride, weight transfer): keep the root where the shot started
          x = gx; z = this.shotAnchorZ(ct); shuffle = true;
          // played and missed: react once the swing has gone through
          if (sim.shotResult?.result === 'miss' && clip !== 'shot_leave' && ct > 0.45) { clip = this.shotView.foot === 'front' ? 'beatenFront' : 'beatenBack'; ct = ct - 0.45; }
        } else if (isStriker && actor.end === 'striker' && Math.abs(actor.z - 9) < 1.5) {
          // tapping the bat while the bowler runs in, the pick-up as he reaches the crease, the backlift at release
          const toRelease = sim.phase === 'runup' ? sim.releaseDelay - (t - sim.tRunStart) : Infinity;
          if (sim.phase === 'flight') { clip = 'backlift'; ct = t - (sim.tRelease ?? t); }
          else if (toRelease <= TRIGGER_LEAD) { clip = 'trigger'; ct = TRIGGER_LEAD - toRelease; }
          else { clip = 'stance'; ct = t; }
          yaw = Math.PI / 2;
          x = gx; z = STANCE_Z; shuffle = true;
        } else {
          clip = sim.phase === 'runup' && !isStriker ? 'backUp' : 'waitBat';
          ct = t;
          yaw = actor.end === 'striker' ? Math.PI : 0;
          if (actor.end === 'striker' && !isStriker) { yaw = Math.PI / 2; clip = 'stance'; }
        }
        m.setShuffle(shuffle ? x - BATTER_X : null, t);
        break;
      }
      case 'bowler': {
        if (actor.action === 'runup') { clip = 'runBall'; ct = t * (sim.kind === 'spin' ? 0.8 : 1.1); }
        else if (actor.action === 'deliver' || actor.action === 'follow') {
          if (this.deliverStart == null) this.deliverStart = t;
          const stride = 0.42;
          clip = { fast: 'deliverFast', 'fast-medium': 'deliverMedium', medium: 'deliverMedium', 'off-spin': 'deliverOffSpin', 'leg-spin': 'deliverLegSpin' }[sim.bowlerP.bowlingType] || 'deliverMedium';
          ct = (t - this.deliverStart) * (RELEASE_T / stride);
        } else if (sim.phase === 'ready') { clip = 'standField'; ct = t; yaw = 0; }
        else if (this.stumpBy?.id === actor.id && t - this.stumpBy.t < 1.4) { clip = 'stump'; ct = t - this.stumpBy.t; yaw = this.stumpBy.end === 'striker' ? Math.PI : 0; }
        else { const fc = this.fieldClip(actor, t, v); clip = fc.clip; ct = fc.ct; if (fc.yaw != null) yaw = fc.yaw; }
        if (clip === 'celebrate') clip = 'celebrateBowler';
        break;
      }
      case 'keeper': {
        if (this.stumpBy?.id === actor.id && t - this.stumpBy.t < 1.4) { clip = 'stump'; ct = t - this.stumpBy.t; yaw = this.stumpBy.end === 'striker' ? Math.PI : 0; break; }
        if (actor.action === 'crouch') {
          // standing up to a spinner the keeper stays down until the ball is past the bat (and out of the camera's way)
          const rise = sim.kind === 'spin' ? 0.02 : 0.25;
          const arriving = sim.phase === 'flight' && sim.tBallAtBatter != null && t > sim.tBallAtBatter - rise;
          clip = arriving ? 'collect' : 'crouch';
          ct = arriving ? t - (sim.tBallAtBatter - rise) : t;
        } else { const fc = this.fieldClip(actor, t, v); clip = fc.clip; ct = fc.ct; if (fc.yaw != null) yaw = fc.yaw; }
        if (sim.phase !== 'inplay' && sim.phase !== 'dead') yaw = Math.PI;
        if (actor.target && sim.phase === 'flight') { x = actor.x + (actor.target.x - actor.x) * Math.min(1, (t - (sim.tBallAtBatter ?? t) + 0.4) * 2); }
        break;
      }
      case 'fielder': { const fc = this.fieldClip(actor, t, v); clip = fc.clip; ct = fc.ct; if (fc.yaw != null) yaw = fc.yaw; break; }
      case 'umpire': {
        if (actor.action === 'signal' && actor.signal) { clip = 'sig_' + actor.signal; ct = actor.actionT; }
        else { clip = 'umpire'; ct = t; }
        yaw = 0;
        if (actor.signal === 'four' || actor.signal === 'six') yaw = Math.PI * 0.5;
        break;
      }
      case 'legUmpire': clip = 'umpire'; ct = t; yaw = Math.PI / 2; break;
    }
    if (v.kind === 'umpire') m.root.visible = !this.hideUmpire;
    m.setPosition(x, z, yaw);
    m.play(clip, ct, Math.max(dt, 0.001), blend);
  }

  /** Which way a fielder faces for a take and (for a dive) which side he goes, worked out once per take. */
  takeLook(actor, g, v) {
    if (!v.takeLook || v.takeLook.t !== g.t) {
      const yaw = takeYaw(actor, g.p, g.v);
      const ox = g.p.x - actor.x, oz = g.p.z - actor.z;
      const side = ox * Math.cos(yaw) - oz * Math.sin(yaw) >= 0 ? 1 : -1;   // + = the fielder's left
      v.takeLook = { t: g.t, yaw, clip: g.kind === 'dive' ? (side > 0 ? 'takeDiveL' : 'takeDiveR') : TAKE_CLIP[g.kind] };
    }
    return v.takeLook;
  }

  fieldClip(actor, t, v = null) {
    const a = actor.action, sim = this.sim;
    if (v) {
      // Taking the ball now (or just taken it): the take clip from the moment the hands met it. The catcher
      // finishes taking the catch before joining the celebrations.
      const done = actor.takeDone;
      const celebrating = a === 'celebrate' && actor.actionT < 0.75 && sim.ball.holder === actor.id;
      if (done && (['catch', 'dive', 'pickup'].includes(a) || celebrating)) {
        const look = this.takeLook(actor, done, v);
        return { clip: look.clip, ct: TAKE_CT[look.clip] + actor.actionT, yaw: look.yaw };
      }
      // About to take it: start the move so the hands meet the ball as it arrives, facing it.
      const g = actor.take;
      if (g && actor.chasing && sim.ball.state === 'batted') {
        const lead = g.t - t;
        const ct = TAKE_CT[g.kind === 'dive' ? 'takeDiveL' : TAKE_CLIP[g.kind]];
        if (lead >= 0 && lead <= ct) {
          const look = this.takeLook(actor, g, v);
          return { clip: look.clip, ct: ct - lead, yaw: look.yaw };
        }
      }
    }
    if (a === 'run') return { clip: this.sim.ball.holder === actor.id ? 'runBall' : 'run', ct: t };
    if (a === 'ready') return { clip: this.sim.phase === 'inplay' || this.sim.phase === 'dead' ? 'standField' : 'ready', ct: t };
    if (a === 'crouch') return { clip: 'crouch', ct: t };
    if (['dive', 'catch', 'pickup', 'throw', 'collect', 'celebrate'].includes(a)) return { clip: a, ct: actor.actionT };
    return { clip: 'standField', ct: t };
  }

  syncBall(dt) {
    const sim = this.sim;
    const b = sim.ball;
    // In the bowler's hand before release, or in a fielder's hand once gathered: drawn in that hand.
    const inHand = b.state === 'hand' || !!this.holderModel;
    this.ball.visible = !inHand;
    const bowlerModel = this.view.get(sim.bowler)?.model;
    if (bowlerModel) bowlerModel.showBall = b.state === 'hand' || this.holderModel === bowlerModel;
    if (!inHand && b.p) {
      this.ball.position.set(b.p.x, Math.max(0.05, b.p.y), b.p.z);
      this.spinBall(b, dt);
      this.ballShadow.visible = true;
      this.ballShadow.position.set(b.p.x, 0.018, b.p.z);
      const h = Math.max(0, b.p.y);
      const s = 1 + h * 0.15;
      this.ballShadow.scale.set(s, 1, s);
      this.ballShadow.material.opacity = Math.max(0.08, 0.38 - h * 0.03);
    } else this.ballShadow.visible = false;

    // Trail while the ball is flying
    const flying = b.state === 'delivery' || b.state === 'batted' || b.state === 'thrown';
    if (flying && b.p) this.trailHist.push([b.p.x, b.p.y, b.p.z]);
    if (this.trailHist.length > this.trailN) this.trailHist.shift();
    if (!flying && this.trailHist.length) this.trailHist.shift();
    const n = this.trailHist.length;
    for (let i = 0; i < this.trailN; i++) {
      const p = this.trailHist[Math.max(0, Math.min(n - 1, i - (this.trailN - n)))] || [0, -10, 0];
      this.trailPts.set(p, i * 3);
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.visible = n > 1;

    // Pitch marker
    if (sim.plan?.bounce && !this.bounceShown && sim.tRelease != null && sim.t - sim.tRelease >= sim.plan.bounce.t) {
      this.bounceShown = true;
      this.pitchMark.position.set(sim.plan.bounce.x, 0.02, sim.plan.bounce.z);
      this.pitchMark.material.opacity = 0.9;
    } else this.pitchMark.material.opacity = Math.max(0, this.pitchMark.material.opacity - dt * 0.25);
  }

  /**
   * Turn the ball as it travels: a seamer's backspin with the seam upright, a spinner's ball rotating about
   * the line of flight, a hit ball tumbling, and a ball on the grass rolling.
   */
  spinBall(b, dt) {
    const sim = this.sim, v = b.v || { x: 0, y: 0, z: 0 };
    const speed = Math.hypot(v.x, v.y, v.z);
    let rate, axis;
    if (b.state === 'delivery') {
      if (sim.kind === 'spin') { rate = 9; axis = _spinAxis.set(0.25, 0.35, 1).normalize(); }
      else { rate = 7; axis = _spinAxis.set(1, 0, 0); }
    } else if (b.p.y <= 0.06 && speed > 0.05) {
      rate = Math.min(14, speed / 0.36); axis = _spinAxis.set(v.z, 0, -v.x).normalize();   // rolling
    } else {
      rate = Math.min(10, speed * 0.35); axis = _spinAxis.set(0.6, 0.3, 0.75).normalize();
    }
    this.ballSpin += rate * Math.PI * 2 * dt;
    this.ball.quaternion.copy(_q.setFromAxisAngle(axis, this.ballSpin)).multiply(SEAM_UP);
  }

  // ------------------------------------------------------------------ replay
  /** Record a frame (from just before the delivery stride until shortly after the ball is dead). */
  record(t) {
    const rec = this.recording, sim = this.sim;
    if (!rec || rec.done) return;
    if (rec.start == null) {
      const stride = sim.phase === 'runup' && sim.releaseDelay - (t - sim.tRunStart) < 0.9;
      if (!stride && sim.phase !== 'flight') return;
      rec.start = t;
    }
    if (rec.frames.length && t - rec.frames[rec.frames.length - 1].t < 1 / 40) return;
    if (sim.phase === 'dead' && t - (sim.deadAt ?? t) > 1.2) { rec.done = true; return; }
    if (rec.frames.length > 1100) { rec.done = true; return; }
    const actors = [];
    for (const m of this.active) actors.push({ m, x: m.root.position.x, z: m.root.position.z, yaw: m.root.rotation.y, pose: copyPose(emptyPose(), m.pose), ball: m.ball.visible });
    rec.frames.push({ t, ball: this.ball.visible ? [this.ball.position.x, this.ball.position.y, this.ball.position.z] : null, q: this.ball.quaternion.toArray(), actors });
  }

  hasReplay() { return !!(this.recording && this.recording.frames.length > 10); }

  /** Key moments of the recorded ball (sim time): release, contact, padHit, catch, boundary, wicket, stumps. */
  get replayMarks() { return this.recording?.marks || {}; }
  get replayRange() { const f = this.recording?.frames; return f?.length ? [f[0].t, f[f.length - 1].t] : null; }

  /**
   * Play back the last delivery. segments: [{ from, to, speed, kind, label }] in sim time, played in order
   * (e.g. the broadcast angle, then a slow-motion close-up). Without segments: the last few seconds.
   * Returns the playback length in seconds.
   */
  startReplay({ speed = 0.55, fromEnd = 3.5, segments = null } = {}) {
    if (!this.hasReplay()) return 0;
    const [first, last] = this.replayRange;
    let segs = segments?.length ? segments : [{ from: Math.max(first, last - fromEnd - 1.2), to: last, speed }];
    segs = segs.map(s => ({ ...s, from: Math.max(first, Math.min(last, s.from)), to: Math.max(first, Math.min(last, s.to)) })).filter(s => s.to > s.from + 0.05);
    if (!segs.length) return 0;
    this.replay = { frames: this.recording.frames, segs, i: 0, t: segs[0].from, events: this.recording.stumps || [] };
    this.enterSegment();
    return segs.reduce((d, s) => d + (s.to - s.from) / s.speed, 0);
  }

  /** The stumps as they stood at the start of the segment (whole, unless they were already broken). */
  enterSegment() {
    const r = this.replay, seg = r.segs[r.i];
    this.stadium.resetStumps();
    r.applied = new Set();
    r.events.forEach((e, k) => { if (e.t <= seg.from) { this.stadium.breakStumps(e.end, e.strength); r.applied.add(k); } });
    if (r.applied.size) this.stadium.settleStumps();
    this.stadium.stumpTimeScale = seg.speed;   // bails fly in slow motion too
    this.trailHist = [];
  }

  /** Leave the stumps as the ball left them. */
  stopReplay() {
    const r = this.replay;
    if (r) {
      this.stadium.resetStumps();
      for (const e of r.events) this.stadium.breakStumps(e.end, e.strength);
      if (r.events.length) this.stadium.settleStumps();
      this.stadium.stumpTimeScale = 1;
    }
    this.replay = null;
  }

  get replaySegment() { return this.replay ? this.replay.segs[this.replay.i] : null; }

  updateReplay(dt) {
    const r = this.replay;
    let seg = r.segs[r.i];
    r.t += dt * seg.speed;
    if (r.t >= seg.to) {
      if (r.i < r.segs.length - 1) { r.i++; seg = r.segs[r.i]; r.t = seg.from; this.enterSegment(); }
      else r.t = seg.to;
    }
    r.events.forEach((e, k) => { if (!r.applied.has(k) && e.t <= r.t) { this.stadium.breakStumps(e.end, e.strength); r.applied.add(k); } });
    const f = r.frames;
    let i = 0;
    while (i < f.length - 1 && f[i + 1].t <= r.t) i++;
    const fr = f[i];
    for (const a of fr.actors) {
      a.m.root.visible = true;
      a.m.setPosition(a.x, a.z, a.yaw);
      a.m.applyPose(a.pose);
      a.m.ball.visible = a.ball;
    }
    if (fr.ball) {
      this.ball.visible = true;
      this.ball.position.set(...fr.ball);
      if (fr.q) this.ball.quaternion.fromArray(fr.q);
      this.ballShadow.visible = true;
      this.ballShadow.position.set(fr.ball[0], 0.018, fr.ball[2]);
      this.trailHist.push(fr.ball.slice());
      if (this.trailHist.length > this.trailN) this.trailHist.shift();
    } else { this.ball.visible = false; this.ballShadow.visible = false; }
    this.replayBall = fr.ball ? { x: fr.ball[0], y: fr.ball[1], z: fr.ball[2] } : null;
  }

  get replayDone() { const r = this.replay; return !r || (r.i === r.segs.length - 1 && r.t >= r.segs[r.i].to); }
}
