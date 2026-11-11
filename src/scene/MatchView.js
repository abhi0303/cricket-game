// Draws a DeliverySim: maps simulation actors to animated PlayerModels in the delivery frame,
// shows the ball, its shadow and trail, the pitch marker and the bowling aim marker,
// and records frames for instant replays. It never changes the simulation.
import * as THREE from 'three';
import { PlayerModel } from './PlayerModel.js';
import { CONTACT_T, RELEASE_T, copyPose, emptyPose } from './Animations.js';
import { PITCH } from '../game/BallPhysics.js';
import { lengthDef } from '../game/PhysicsConfig.js';
import { BATTER_X, STANCE_Z } from '../game/ShotModel.js';

const SHOT_CLIP = {
  defend: 'shot_defend', straightDrive: 'shot_straightDrive', coverDrive: 'shot_coverDrive', flick: 'shot_flick',
  punch: 'shot_punch', cut: 'shot_cut', pull: 'shot_pull', hook: 'shot_hook', lofted: 'shot_lofted', sweep: 'shot_sweep', leave: 'shot_leave',
};

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
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshLambertMaterial({ color: '#fbfaf3', emissive: '#262626' }));
    this.ball.castShadow = false;
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

    // Shot direction arrow for the human batter
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(-0.06, 0); arrowShape.lineTo(0.06, 0); arrowShape.lineTo(0.06, 0.9); arrowShape.lineTo(0.16, 0.9);
    arrowShape.lineTo(0, 1.15); arrowShape.lineTo(-0.16, 0.9); arrowShape.lineTo(-0.06, 0.9); arrowShape.closePath();
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7ee0a1', transparent: true, opacity: 0.0, depthWrite: false }));
    this.arrow.position.y = 0.03;
    this.frame.add(this.arrow);
  }

  // ------------------------------------------------------------------ models
  modelFor(player, team, role) {
    const key = `${player?.id || role}:${role}`;
    let m = this.models.get(key);
    if (!m) {
      m = new PlayerModel({ player, team, role, withBat: role === 'batter', shadows: this.shadows, quality: this.quality });
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
    this.recording = { frames: [], start: null, done: false };
    this.stumpAt = null;
    for (const m of this.active) { m.setBatAim(null); m.setShuffle(null); }
    this.update(0);
  }

  // ------------------------------------------------------------------ events from the sim
  onEvent(ev) {
    const sim = this.sim;
    if (!sim) return;
    switch (ev.type) {
      case 'shotStart': {
        const lead = Math.max(0.05, ev.lead || 0.14);
        let clip = SHOT_CLIP[ev.shotId] || 'shot_defend';
        if (ev.shotId === 'defend' && ev.foot === 'back') clip = 'shot_defendBack';
        this.shotView = { clip, t0: ev.t, rate: ev.shotId === 'leave' ? 1.6 : CONTACT_T / lead, foot: ev.shotId === 'sweep' ? 'front' : ev.foot, stepOut: !!ev.stepOut };
        this.aimStrikerShot(clip, ev.t + lead, !!ev.stepOut);
        break;
      }
      case 'timing': {
        // The sim has decided the contact: pull the bat off the line for a miss, onto an edge for an edge.
        const res = sim.shotResult, m = this.strikerModel();
        if (!res || !m?.batAim) break;
        const miss = res.result === 'miss' ? [0, 0.13, -0.1]
          : res.result === 'edge' ? (res.edgeType === 'inside' ? [0, 0, 0.045] : [0, 0.01, -0.045]) : null;
        if (miss) { m.batAim.miss = miss; m.batAim.missT = CONTACT_T - 0.02; }
        break;
      }
      case 'stumpsHit':
        this.stadium.breakStumps(ev.end, ev.runout ? 0.8 : 1.2);
        if (ev.end === 'striker' && (ev.stumping || (ev.runout && this.sim.ball.holder === this.sim.keeper.id))) this.stumpAt = ev.t;
        break;
      case 'release': if (this.recording) this.recording.start = this.recording.start ?? ev.t; break;
      default: break;
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

  /** Steer the striker's swing so the middle of the bat meets the ball where it will be at contact. */
  aimStrikerShot(clip, tContact, stepOut) {
    const m = this.strikerModel(), sim = this.sim;
    if (!m || clip === 'shot_leave' || sim.tRelease == null) { m?.setBatAim(null); return; }
    const s = sim.plan.path.at(Math.max(0, tContact - sim.tRelease));
    const z = stepOut ? 7.95 : STANCE_Z;
    m.setPosition(BATTER_X + (sim.guard || 0), z, Math.PI / 2);
    m.root.updateMatrixWorld(true);
    const ball = m.root.worldToLocal(this.frame.localToWorld(new THREE.Vector3(s.p.x, s.p.y, s.p.z)));
    m.aimShot(clip, ball);
  }

  // ------------------------------------------------------------------ per-frame sync
  update(dt) {
    if (this.replay) { this.updateReplay(dt); return; }
    const sim = this.sim;
    if (!sim) return;
    const t = sim.t;
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

  setShotArrow(sx, sy, visible) {
    const o = this.arrow.material;
    o.opacity += ((visible ? 0.75 : 0) - o.opacity) * 0.25;
    if (!visible && o.opacity < 0.02) { this.arrow.visible = false; return; }
    this.arrow.visible = true;
    // Stick x: + off side, y: + towards the bowler. Arrow points where the ball should go.
    const ang = Math.atan2(sx, sy || 0.0001);
    this.arrow.position.set(BATTER_X + (this.sim?.guard || 0) + 0.3, 0.03, PITCH.popping - 0.3);
    // The arrow geometry points down the pitch (-z); rotating by -ang turns it towards +x (off side) for ang > 0.
    this.arrow.rotation.y = -ang;
    const len = 0.8 + Math.min(1, Math.hypot(sx, sy)) * 1.2;
    this.arrow.scale.set(1, 1, len);
  }

  syncActor(actor, v, t, dt) {
    const sim = this.sim;
    const m = v.model;
    let clip = 'idle', ct = actor.actionT || 0, x = actor.x, z = actor.z, yaw = actor.yaw ?? 0;
    switch (v.kind) {
      case 'striker':
      case 'nonStriker': {
        const isStriker = v.kind === 'striker';
        const running = actor.action === 'run';
        const gx = BATTER_X + (sim.guard || 0);   // the striker's guard: where they have shuffled to across the crease
        let shuffle = false;
        if (actor.action === 'out') { clip = 'walkOff'; yaw = Math.PI / 2 + 0.6; x = actor.x - (actor.actionT * 0.6); }
        else if (actor.action === 'celebrate') { clip = 'celebrateBat'; yaw = 0; }
        else if (running) { clip = 'runBat'; yaw = actor.yaw ?? 0; ct = t; }
        else if (isStriker && this.shotView && (sim.phase === 'flight' || t - this.shotView.t0 < 2.4) && Math.abs(actor.z - 9) < 2.2) {
          clip = this.shotView.clip; ct = (t - this.shotView.t0) * this.shotView.rate; yaw = Math.PI / 2;
          if (clip === 'shot_leave') ct = Math.min(ct, 1);
          // the clip moves the body itself (stride, weight transfer): keep the root where the shot started
          x = gx; z = this.shotAnchorZ(ct); shuffle = true;
          // played and missed: react once the swing has gone through
          if (sim.shotResult?.result === 'miss' && clip !== 'shot_leave' && ct > 0.45) { clip = this.shotView.foot === 'front' ? 'beatenFront' : 'beatenBack'; ct = ct - 0.45; }
        } else if (isStriker && actor.end === 'striker' && Math.abs(actor.z - 9) < 1.5) {
          clip = sim.phase === 'flight' ? 'backlift' : 'stance';
          ct = sim.phase === 'flight' ? t - (sim.tRelease ?? t) : t;
          yaw = Math.PI / 2;
          if (clip === 'stance' || clip === 'backlift') { x = gx; z = STANCE_Z; shuffle = true; }
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
        else ({ clip, ct } = this.fieldClip(actor, t));
        if (clip === 'celebrate') clip = 'celebrateBowler';
        break;
      }
      case 'keeper': {
        if (this.stumpAt != null && t - this.stumpAt < 1.4) { clip = 'stump'; ct = t - this.stumpAt; yaw = Math.PI; break; }
        if (actor.action === 'crouch') {
          // standing up to a spinner the keeper stays down until the ball is past the bat (and out of the camera's way)
          const rise = sim.kind === 'spin' ? 0.02 : 0.25;
          const arriving = sim.phase === 'flight' && sim.tBallAtBatter != null && t > sim.tBallAtBatter - rise;
          clip = arriving ? 'collect' : 'crouch';
          ct = arriving ? t - (sim.tBallAtBatter - rise) : t;
        } else ({ clip, ct } = this.fieldClip(actor, t));
        if (sim.phase !== 'inplay' && sim.phase !== 'dead') yaw = Math.PI;
        if (actor.target && sim.phase === 'flight') { x = actor.x + (actor.target.x - actor.x) * Math.min(1, (t - (sim.tBallAtBatter ?? t) + 0.4) * 2); }
        break;
      }
      case 'fielder': ({ clip, ct } = this.fieldClip(actor, t)); break;
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
    m.play(clip, ct, Math.max(dt, 0.001));
  }

  fieldClip(actor, t) {
    const a = actor.action;
    if (a === 'run') return { clip: this.sim.ball.holder === actor.id ? 'runBall' : 'run', ct: t };
    if (a === 'ready') return { clip: this.sim.phase === 'inplay' || this.sim.phase === 'dead' ? 'standField' : 'ready', ct: t };
    if (a === 'crouch') return { clip: 'crouch', ct: t };
    if (['dive', 'catch', 'pickup', 'throw', 'collect', 'celebrate'].includes(a)) return { clip: a, ct: actor.actionT };
    return { clip: 'standField', ct: t };
  }

  syncBall(dt) {
    const sim = this.sim;
    const b = sim.ball;
    const inHand = b.state === 'hand';
    this.ball.visible = !inHand;
    const bowlerModel = this.view.get(sim.bowler)?.model;
    if (bowlerModel) bowlerModel.showBall = inHand;
    if (!inHand && b.p) {
      this.ball.position.set(b.p.x, Math.max(0.05, b.p.y), b.p.z);
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

  // ------------------------------------------------------------------ replay
  record(t) {
    const rec = this.recording;
    if (!rec || rec.start == null || rec.done) return;
    if (rec.frames.length && t - rec.frames[rec.frames.length - 1].t < 1 / 40) return;
    if (this.sim.phase === 'dead' && t - (this.sim.deadAt ?? t) > 1.2) { rec.done = true; return; }
    if (rec.frames.length > 900) { rec.done = true; return; }
    const actors = [];
    for (const m of this.active) actors.push({ m, x: m.root.position.x, z: m.root.position.z, yaw: m.root.rotation.y, pose: copyPose(emptyPose(), m.pose), ball: m.ball.visible });
    rec.frames.push({ t, ball: this.ball.visible ? [this.ball.position.x, this.ball.position.y, this.ball.position.z] : null, actors });
  }

  hasReplay() { return !!(this.recording && this.recording.frames.length > 10); }

  /** Start playing back the last delivery. Returns duration in seconds of playback. */
  startReplay({ speed = 0.55, fromEnd = 3.5 } = {}) {
    if (!this.hasReplay()) return 0;
    const f = this.recording.frames;
    const t1 = f[f.length - 1].t;
    const t0 = Math.max(f[0].t, t1 - fromEnd - 1.2);
    this.replay = { frames: f, t: t0, t0, t1, speed };
    this.trailHist = [];
    return (t1 - t0) / speed;
  }

  stopReplay() { this.replay = null; }

  updateReplay(dt) {
    const r = this.replay;
    r.t += dt * r.speed;
    if (r.t > r.t1) r.t = r.t1;
    const f = r.frames;
    let i = 0;
    while (i < f.length - 1 && f[i + 1].t <= r.t) i++;
    const fr = f[i];
    for (const a of fr.actors) {
      a.m.root.visible = true;
      a.m.setPosition(a.x, a.z, a.yaw);
      a.m.applyPose(a.pose);
    }
    if (fr.ball) {
      this.ball.visible = true;
      this.ball.position.set(...fr.ball);
      this.ballShadow.visible = true;
      this.ballShadow.position.set(fr.ball[0], 0.018, fr.ball[2]);
      this.trailHist.push(fr.ball.slice());
      if (this.trailHist.length > this.trailN) this.trailHist.shift();
    } else { this.ball.visible = false; this.ballShadow.visible = false; }
    this.replayBall = fr.ball ? { x: fr.ball[0], y: fr.ball[1], z: fr.ball[2] } : null;
  }

  get replayDone() { return !this.replay || this.replay.t >= this.replay.t1; }
}
