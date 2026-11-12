// Low-poly cricketer: one skinned mesh on a shared 17-bone skeleton (geometry is cached per kit
// and shared between players), plus bone-attached headgear, bat, ball and shirt prints.
// Procedural clips drive the bones; two-bone IK keeps both hands on the bat and plants the feet
// where a clip puts them (strides, pivots, heel lifts), and the swing is steered onto the ball.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getClip, emptyPose, copyPose, blendPose, JOINTS, CONTACT_T, SWEET, BAT_LEN } from './Animations.js';
import { jerseyBackTexture, emblemTexture } from './Textures.js';
import { BONES, PARENT, OFFSET, LIMB, HIP_HEIGHT, buildBody, buildHelmet, buildCap, buildUmpireHat, buildBatHandle, buildBatBlade, shade } from './CharacterGeometry.js';
import { ballMaterial, setBallEnvironment, registerBall } from './BallLook.js';
import { loadBody, RiggedBody } from './RiggedBody.js';
import { loadGear } from './GearModels.js';
import { bladeMaterial, batBrandFor, setBatEnvironment } from './BatLook.js';

const DEG = Math.PI / 180;
// Side-steps when the striker shuffles across the crease: step time (s), foot lift (m), how far a foot may trail
// the moving body before it steps, the gap left when settling (behind / past the body), the longest step, how
// far ahead a step lands (m), and how far through its step one foot is before the other may lift.
const STEP = { dur: 0.16, lift: 0.07, trail: 0.08, settle: 0.02, over: 0.16, maxLen: 0.42, ahead: 0.16, gate: 0.65 };
const smooth = u => u * u * (3 - 2 * u);
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a8714a', '#d9a066', '#6b4127'];
const HAIR = ['#17110d', '#2b1d14', '#3d2a1a', '#5a3b22', '#8a6238', '#121212', '#6e6e6e'];
const STYLES = ['short', 'short', 'buzz', 'curly', 'long', 'short', 'bald', 'buzz'];
const BEARDS = ['none', 'none', 'stubble', 'none', 'beard', 'stubble'];
const UMPIRE_SHIRT = '#4f97c9';
const HEAD_SCALE = 1.02;

// One physically based material for every body, headgear and bat. Colour comes from vertex colours (with baked
// AO) and each vertex carries its own roughness/metalness (aRM): matte cloth, satin skin, glossy helmets, metal grilles.
function characterMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.22 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 aRM;\nvarying vec2 vRM;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRM = aRM;');
    sh.fragmentShader = 'varying vec2 vRM;\n' + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
  };
  m.customProgramCacheKey = () => 'cricketer-rm';
  return m;
}
const sharedMat = characterMaterial();
const lowMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

/** Soft studio-style reflections for the characters (helmet shells, grilles, satin shirts). Call once with the renderer. */
export function setCharacterEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  sharedMat.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  sharedMat.needsUpdate = true;
  setBallEnvironment(sharedMat.envMap);
  setBatEnvironment(sharedMat.envMap);
  pm.dispose();
}

// Soft contact shadow under every player (grounds them even where the shadow map is coarse).
let shadowBlob = null;
function contactShadow() {
  if (!shadowBlob) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    shadowBlob = { geo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }) };
  }
  return new THREE.Mesh(shadowBlob.geo, shadowBlob.mat);
}
const cache = new Map();
const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

export function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

const ballGeo = new THREE.SphereGeometry(0.05, 20, 14);
// Test whites: cream shirt and trousers, with the team colour kept for the trim, cap and helmet.
const WHITES = { shirt: '#f3f1e9', trousers: '#ebe7da' };
const luminance = hex => { const n = parseInt(hex.slice(1, 7), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
const emblemCache = new Map();
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

export class PlayerModel {
  /**
   * @param {object} o  { player, team: {primary, secondary, short, emblem}, role: 'batter'|'fielder'|'keeper'|'umpire', withBat, shadows, quality,
   *                      whites (Test kit) }
   */
  constructor(o) {
    const team = o.team || { primary: '#888888', secondary: '#ffffff' };
    this.player = o.player || null;
    const quality = o.quality || 'medium';
    const seed = hashStr(o.player?.id || o.name || String(Math.random()));
    const pick = (arr, k) => arr[Math.floor(seed / k) % arr.length];
    const umpire = o.role === 'umpire';
    const gear = o.role === 'batter' ? 'batter' : o.role === 'keeper' ? 'keeper' : umpire ? 'umpire' : 'fielder';
    const whites = !!o.whites && !umpire;
    // a trim that shows on cream: the team colour, or a dark navy if the team colour is too pale
    const whiteTrim = luminance(team.primary) > 0.72 ? '#1d2a4d' : team.primary;
    this.kit = {
      shirt: umpire ? UMPIRE_SHIRT : whites ? WHITES.shirt : team.primary,
      trousers: umpire ? '#1d1f25' : whites ? WHITES.trousers : shade(team.primary, -0.12),
      trim: umpire ? '#1d2433' : whites ? whiteTrim : team.secondary,
      skin: pick(SKINS, 1),
      hair: pick(HAIR, 7),
      hairStyle: umpire ? 'short' : pick(STYLES, 13),
      beard: pick(BEARDS, 29),
      gear,
      quality: quality === 'low' ? 'low' : 'high',
    };
    const bodyGeo = cached('body:' + JSON.stringify(this.kit), () => buildBody(this.kit));

    // --- skeleton
    this.b = {};
    for (const name of BONES) {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.set(...OFFSET[name]);
      this.b[name] = bone;
      if (PARENT[name]) this.b[PARENT[name]].add(bone);
    }
    const mat = quality === 'low' ? lowMat : sharedMat;
    this.mesh = new THREE.SkinnedMesh(bodyGeo, mat);
    this.mesh.add(this.b.hips);
    this.mesh.bind(new THREE.Skeleton(BONES.map(n => this.b[n])));
    // Slightly stylised proportions: a touch larger head (scales the headgear with it).
    this.b.head.scale.setScalar(HEAD_SCALE);
    this.mesh.castShadow = o.shadows !== false;
    this.mesh.frustumCulled = false;
    this.root = new THREE.Group();
    this.root.name = o.player?.name || o.role;
    this.root.add(this.mesh);
    this.blob = contactShadow();
    this.blob.scale.set(0.95, 1, 0.95);
    this.blob.position.y = 0.012;
    this.root.add(this.blob);
    // individual build: a little variation in height
    this.heightScale = umpire ? 1 : 0.95 + ((seed >> 5) % 100) / 100 * 0.1;
    this.root.scale.setScalar(this.heightScale);

    // --- headgear
    const q = this.kit.quality;
    const attach = (geo, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = o.shadows !== false; parent.add(m); return m; };
    const helmetGeo = () => cached(`helmet:${team.primary}:${team.secondary}:${q}`, () => buildHelmet(shade(team.primary, -0.28), team.secondary, q));
    const capGeo = () => cached(`cap:${team.primary}:${team.secondary}:${q}`, () => buildCap(team.primary, team.secondary, q));
    if (gear === 'batter') this.helmet = attach(helmetGeo(), this.b.head);
    else if (gear === 'keeper') { this.cap = attach(capGeo(), this.b.head); this.helmet = attach(helmetGeo(), this.b.head); this.helmet.visible = false; }
    else if (gear === 'umpire') this.hat = attach(cached(`umphat:${q}`, () => buildUmpireHat(q)), this.b.head);
    else this.cap = attach(capGeo(), this.b.head);

    // --- bat (held via IK, positioned in root space)
    if (o.withBat) {
      // handle (grip in the team colour) + willow blade with the maker's stickers
      this.bat = new THREE.Group();
      this.bat.matrixAutoUpdate = false;
      this.batBrand = batBrandFor(o.player?.id, hashStr);
      const handle = new THREE.Mesh(cached(`bathandle:${team.primary}:${q}`, () => buildBatHandle(shade(team.primary, -0.2), q)), mat);
      const blade = new THREE.Mesh(cached(`batblade:${q}`, () => buildBatBlade(q)), bladeMaterial(this.batBrand, quality === 'low' ? 'low' : 'high'));
      for (const m of [handle, blade]) { m.castShadow = o.shadows !== false; this.bat.add(m); }
      this.root.add(this.bat);
      // the 3D bat model takes over from the built-in one once it has loaded (same frame: handle top at the origin)
      loadGear('bat').then(scene => {
        handle.visible = blade.visible = false;
        const model = scene.clone();
        model.traverse(m => { if (m.isMesh) m.castShadow = o.shadows !== false; });
        this.bat.add(model);
      }).catch(err => console.warn('Bat model not loaded; keeping the built-in bat.', err));
    }
    // --- ball in the bowling hand
    this.ball = new THREE.Mesh(ballGeo, ballMaterial());
    registerBall(this.ball, 0.05);
    this.ball.visible = false;
    this.b.handR.add(this.ball);
    this.ball.position.set(0.024, -0.085, 0.004);

    // --- shirt prints: name + number on the back, team emblem on the chest
    if (o.player && !umpire && o.showNumber !== false) {
      const t = jerseyBackTexture(o.player.name, o.player.number, whites ? whiteTrim : team.secondary);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.27), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false }));
      plane.position.set(0, 0.06, -0.119);
      plane.rotation.y = Math.PI;
      this.b.chest.add(plane);
      this.backPlate = plane;
      if (team.emblem) {
        const key = `${team.primary}|${team.secondary}|${team.short}|${team.emblem.shape}|${team.emblem.icon}`;
        if (!emblemCache.has(key)) emblemCache.set(key, new THREE.MeshLambertMaterial({ map: emblemTexture(team, 128), transparent: true, depthWrite: false }));
        const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), emblemCache.get(key));
        badge.position.set(0.078, 0.135, 0.131);
        badge.rotation.y = 0.32;
        this.b.chest.add(badge);
        this.badge = badge;
      }
    }

    this.pose = emptyPose();
    this.prevPose = emptyPose();
    this.tmpPose = emptyPose();
    this.clip = null;
    this.blend = 1;
    this.blendDur = 0.18;
  }

  /**
   * Wear a rigged character model (RiggedBody) instead of the built-in body: the built-in one (and its helmet,
   * prints and hand ball) is hidden but still animated, and the model copies its pose; the bat stays. It shows
   * once the model has loaded.
   */
  wearBody(name) {
    if (this.bodyName === name) return;
    this.bodyName = name;
    loadBody(name).then(t => {
      if (this.bodyName !== name || this.body) return;
      this.body = new RiggedBody(t, this, { pads: !!this.bat });   // batters wear pads
      // the built-in body stops drawing (its skeleton still animates, and the ball in the hand still shows)
      this.mesh.material = HIDDEN;
      for (const o of [this.helmet, this.cap, this.hat, this.backPlate, this.badge]) if (o) o.visible = false;
      this.body.update();
    }).catch(err => console.warn(`Body "${name}" not loaded; keeping the built-in one.`, err));
  }

  setKeeperHelmet(on) {
    if (!this.helmet || !this.cap || this.bodyName) return;   // a worn model has its own head
    this.helmet.visible = on;
    this.cap.visible = !on;
  }

  /** Show a clip at a given time. Changing clip cross-fades from the last pose. */
  play(name, t, dt = 0.016, blendDur = this.blendDur) {
    const clip = getClip(name);
    if (name !== this.clip) {
      copyPose(this.prevPose, this.pose);
      this.unshuffle(this.prevPose);
      this.clip = name;
      this.blend = 0;
      this.blendDur = blendDur;
    }
    clip.sample(t, this.tmpPose);
    if (this.batAim && this.batAim.clip === name) this.aimBat(this.tmpPose, t);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / Math.max(0.01, this.blendDur));
      blendPose(this.pose, this.prevPose, this.tmpPose, this.blend * this.blend * (3 - 2 * this.blend));
    } else copyPose(this.pose, this.tmpPose);
    this.shuffleFeet(this.pose);
    this.apply(this.pose);
  }

  /**
   * Shuffle across the crease (the striker). `g` is how far the body has moved sideways (world metres
   * along the root's +z, the off side) and `time` a clock in seconds. Each foot stays planted until it
   * trails the body, then steps after it with a small lift, so the batter steps across instead of
   * sliding. g = null stops it. Call before play(); the steps go into the pose's foot targets, so
   * replays keep them.
   */
  setShuffle(g, time = 0) {
    if (g == null) { this.shuf = null; return; }
    g /= this.heightScale;
    const s = this.shuf;
    if (!s || time < s.time || Math.abs(g - s.g) > 0.3) {   // first frame, new ball or a jump: plant both feet
      this.shuf = { g, time, v: 0, L: { z: g, step: null }, R: { z: g, step: null }, applied: null };
      return;
    }
    const dt = Math.min(0.1, time - s.time);
    s.time = time;
    if (dt > 0) s.v += ((g - s.g) / dt - s.v) * Math.min(1, dt * 30);
    s.g = g;
    for (const side of ['L', 'R']) {
      const f = s[side];
      if (f.step && (f.step.u += dt / STEP.dur) >= 1) { f.z = f.step.to; f.step = null; }
    }
    // Next step: the foot trailing furthest, once the other foot is nearly down. On a tie the back foot
    // leads going across to off and the front foot leads backing away to leg. When the body stops, a foot
    // that landed a little past it stays (a wider stance) rather than stepping back.
    const moving = Math.abs(s.v) > 0.05;
    let pick = null, best = 0;
    for (const side of ['L', 'R']) {
      const f = s[side], o = s[side === 'L' ? 'R' : 'L'];
      if (f.step || (o.step && o.step.u < STEP.gate)) continue;
      const e = g - f.z;
      const lagging = moving ? e * Math.sign(s.v) > STEP.trail : Math.abs(e) > (e * (f.dir || 0) < 0 ? STEP.over : STEP.settle);
      const k = Math.abs(e) + ((side === 'R') === (e > 0) ? 0.002 : 0);
      if (lagging && k > best) { best = k; pick = side; }
    }
    if (pick) {
      const f = s[pick];
      const to = g + Math.max(-STEP.ahead, Math.min(STEP.ahead, s.v * STEP.dur));   // land where the body will be
      const d = Math.max(-STEP.maxLen, Math.min(STEP.maxLen, to - f.z));
      f.step = { from: f.z, to: f.z + d, u: 0 };
      f.dir = Math.sign(d);
    }
  }

  /** Write the shuffle into the foot targets: planted feet stay where they landed, a stepping foot lifts. */
  shuffleFeet(p) {
    const s = this.shuf;
    if (!s || !(p.legIK > 0.001 && p.ftL && p.ftR)) { if (s) s.applied = null; return; }
    s.applied = {};
    for (const side of ['L', 'R']) {
      const f = s[side], ft = p['ft' + side];
      let z = f.z, lift = 0;
      if (f.step) {
        z = f.step.from + (f.step.to - f.step.from) * smooth(f.step.u);
        lift = STEP.lift * Math.sin(Math.PI * f.step.u) * Math.min(1, Math.abs(f.step.to - f.step.from) / 0.1);
      }
      ft[1] += z - s.g;
      ft[4] = lift;
      s.applied[side] = z - s.g;
    }
  }

  /** Take last frame's shuffle back out of a pose (so a cross-fade from it doesn't count the step twice). */
  unshuffle(p) {
    const a = this.shuf?.applied;
    for (const side of ['L', 'R']) {
      const ft = p['ft' + side];
      if (!ft) continue;
      if (a && a[side] != null) ft[1] -= a[side];
      ft.length = 4;
    }
  }

  /**
   * Steer a shot so the middle of the bat meets the ball. `d` is the offset (root space) from where the
   * clip puts the sweet spot at contact to where the ball will be; it is faded in and out around contact
   * (Gaussian in clip time) and the body leans with it. `miss` pulls the bat off the line once the
   * sim has decided the ball beat the bat.
   */
  setBatAim(clip, d, { t = CONTACT_T, sigma = 0.085 } = {}) {
    this.batAim = clip ? { clip, d, t, sigma, miss: null, missT: 0 } : null;
  }

  /**
   * Aim a shot clip at a ball position (root space) at contact. Iterates because the body lean and the
   * reach fit move the bat too. Returns the offset applied.
   */
  aimShot(clip, ball, maxShift = 0.95) {
    this.batAim = null;
    const c = getClip(clip), p = emptyPose();
    c.sample(CONTACT_T, p);
    if (!p.bat) return null;
    const d = [0, 0, 0];
    for (let it = 0; it < 3; it++) {
      this.setBatAim(clip, d.slice());
      c.sample(CONTACT_T, p);
      this.aimBat(p, CONTACT_T);
      this.apply(p);
      const { h, y, face } = this.batAxisLocal;
      // the ball sits against the face, a ball radius out from the middle of the blade
      for (let i = 0; i < 3; i++) d[i] += ball.getComponent(i) - face.getComponent(i) * 0.05 - (h.getComponent(i) - y.getComponent(i) * SWEET);
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len > maxShift) for (let i = 0; i < 3; i++) d[i] *= maxShift / len;
    }
    this.setBatAim(clip, d);
    this.apply(this.pose);
    return d;
  }

  /** The blade (shoulder to toe) in root space at clip time t, with the current aim. */
  bladeAt(clip, t = CONTACT_T) {
    const c = getClip(clip), p = emptyPose();
    c.sample(t, p);
    if (!p.bat) return null;
    if (this.batAim && this.batAim.clip === clip) this.aimBat(p, t);
    this.apply(p);
    const { h, y } = this.batAxisLocal;
    const out = { top: h.clone().addScaledVector(y, -0.3), toe: h.clone().addScaledVector(y, -BAT_LEN) };
    this.apply(this.pose);
    return out;
  }

  /** Where a shot clip puts the middle of the bat at contact with no steering (root space). */
  naturalSweet(clip) {
    const c = getClip(clip), p = emptyPose();
    const keep = this.batAim;
    this.batAim = null;
    c.sample(CONTACT_T, p);
    if (!p.bat) { this.batAim = keep; return null; }
    this.apply(p);
    const { h, y } = this.batAxisLocal;
    const out = h.clone().addScaledVector(y, -SWEET);
    this.batAim = keep;
    this.apply(this.pose);
    return out;
  }

  aimBat(p, t) {
    const a = this.batAim;
    if (!p.bat) return;
    const g = Math.exp(-0.5 * ((t - a.t) / a.sigma) ** 2);
    let dx = a.d[0] * g, dy = a.d[1] * g, dz = a.d[2] * g;
    if (a.miss && t > a.missT) {
      const k = Math.min(1, (t - a.missT) / 0.05) * Math.exp(-0.5 * ((t - a.t) / (a.sigma * 1.6)) ** 2);
      dx += a.miss[0] * k; dy += a.miss[1] * k; dz += a.miss[2] * k;
    }
    for (const k of ['H', 'T']) { p.bat[k][0] += dx; p.bat[k][1] += dy; p.bat[k][2] += dz; }
    // the body goes with the hands: weight forward/back, bend over a low ball, stand taller for a high one,
    // and stretch further towards a ball well wide of the shot's line
    const wide = Math.max(0, Math.abs(dz) - 0.35) * Math.sign(dz);
    p.root[0] += dx * 0.35; p.root[1] += Math.min(0.03, dy * 0.45); p.root[2] += dz * 0.3 + wide * 0.5;
    p.torso[0] -= dy * 28;
  }

  /** Snap directly to a pose (used by replays). */
  applyPose(p) { copyPose(this.pose, p); this.apply(p); }

  apply(p) {
    const b = this.b;
    const rot = (bone, r, k = 1) => bone.rotation.set(r[0] * DEG * k, r[1] * DEG * k, r[2] * DEG * k);
    // Hips carry the whole body (root rotation is used for dives).
    b.hips.position.set(p.root[0], HIP_HEIGHT + p.root[1], p.root[2]);
    b.hips.rotation.set((p.hips[0] + p.rootRot[0]) * DEG, (p.hips[1] + p.rootRot[1]) * DEG, (p.hips[2] + p.rootRot[2]) * DEG);
    // The torso bend/twist is shared between the lower spine and the chest, the head turn between neck and head.
    rot(b.spine, p.torso, 0.45); rot(b.chest, p.torso, 0.55);
    rot(b.neck, p.head, 0.35); rot(b.head, p.head, 0.65);
    rot(b.armL, p.armL); rot(b.foreL, p.foreL); rot(b.handL, p.handL);
    rot(b.armR, p.armR); rot(b.foreR, p.foreR); rot(b.handR, p.handR);
    rot(b.thighL, p.thighL); rot(b.shinL, p.shinL);
    rot(b.thighR, p.thighR); rot(b.shinR, p.shinR);
    // Keep the feet flat: the ankle cancels the leg's pitch and roll (not while diving / airborne rotations).
    const flat = Math.abs(p.rootRot[0]) + Math.abs(p.rootRot[2]) < 25 ? 0.9 : 0;
    for (const s of ['L', 'R']) {
      const th = p['thigh' + s], sh = p['shin' + s], f = p['foot' + s];
      b['foot' + s].rotation.set((f[0] - (p.hips[0] + th[0] + sh[0]) * flat) * DEG, f[1] * DEG, (f[2] - (p.hips[2] + th[2] + sh[2]) * flat) * DEG);
    }
    if (p.legIK > 0.001 && p.ftL && p.ftR) {
      this.root.updateMatrixWorld(true);
      const w = Math.min(1, p.legIK);
      this.solveLeg('L', p.ftL, w);
      this.solveLeg('R', p.ftR, w);
    }
    this.groundFeet(p);
    // the ball sits in the right hand: when the pose says so, or whenever this player is holding it
    this.ball.visible = (p.ballHand === 'R' || this.holdingBall) && this.showBall !== false;
    if (this.bat) {
      if (p.bat) {
        this.bat.visible = true;
        this.placeBat(this.fitBat(p.bat));
        this.root.updateMatrixWorld(true);
        this.solveHandsOnBat(p.poleL, p.poleR);
      } else this.bat.visible = false;
    }
    if (p.ikR || p.ikL) {
      this.root.updateMatrixWorld(true);
      if (p.ikL) this.solveArm('L', this.root.localToWorld(new THREE.Vector3(...p.ikL)));
      if (p.ikR) this.solveArm('R', this.root.localToWorld(new THREE.Vector3(...p.ikR)));
    }
    if (this.body) this.body.update();   // a worn model copies the finished pose
  }

  /** Small proportion errors in the authored poses are corrected so the soles stay on the grass. */
  groundFeet(p) {
    this.root.updateMatrixWorld(true);
    let minY = Infinity;
    for (const s of ['L', 'R']) {
      this.b['foot' + s].getWorldPosition(_v1);
      this.root.worldToLocal(_v1);
      const lift = p?.legIK > 0.001 ? (p['ft' + s]?.[4] || 0) * Math.min(1, p.legIK) : 0;   // a foot meant to be off the ground
      minY = Math.min(minY, _v1.y - LIMB.ankle - lift);
    }
    if (minY < 0.12) this.b.hips.position.y -= minY;   // lift out of the ground / settle small floats; real jumps (> 12 cm) are kept
  }

  /**
   * Keep the bat within arm's reach: if a grip is further from its shoulder than the arm can stretch,
   * slide the whole bat towards that shoulder (hands never float off the handle).
   */
  fitBat(bat) {
    this.root.updateMatrixWorld(true);
    const reach = LIMB.upper + LIMB.fore + 0.075 - 0.012;
    const H = _f1.set(...bat.H), T = _f2.set(...bat.T);
    const a = _f3.copy(H).sub(T).normalize();
    for (let it = 0; it < 3; it++) {
      let worst = 0;
      for (const [side, off] of [['L', 0.05], ['R', 0.15]]) {
        const sh = this.root.worldToLocal(this.b['arm' + side].getWorldPosition(_f4));
        const grip = _f5.copy(H).addScaledVector(a, -off);
        const d = grip.distanceTo(sh) - reach;
        if (d > worst) { worst = d; _f6.copy(sh).sub(grip).normalize(); }
      }
      if (worst <= 1e-4) break;
      H.addScaledVector(_f6, worst); T.addScaledVector(_f6, worst);
    }
    // the toe never digs into the turf
    const toeY = H.y - a.y * BAT_LEN;
    if (toeY < 0.012) { H.y += 0.012 - toeY; T.y += 0.012 - toeY; }
    this._fit = this._fit || { H: [0, 0, 0], T: [0, 0, 0], F: [0, 0, 1] };
    H.toArray(this._fit.H); T.toArray(this._fit.T); this._fit.F = bat.F;
    return this._fit;
  }

  placeBat({ H, T, F }) {
    const h = _v1.set(...H), t = _v2.set(...T);
    const y = _v3.copy(h).sub(t).normalize();
    const f = _v4.set(...F);
    const z = f.sub(_v5.copy(y).multiplyScalar(f.dot(y)));
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
    z.normalize();
    const x = _v5.crossVectors(y, z).normalize();
    this.bat.matrix.makeBasis(x, y, z);
    this.bat.matrix.setPosition(h);
    this.bat.matrixWorldNeedsUpdate = true;
    this.batAxisLocal = { h: h.clone(), y: y.clone(), face: z.clone() };
  }

  solveHandsOnBat(poleL, poleR) {
    const { h, y } = this.batAxisLocal;
    const top = h.clone().addScaledVector(y, -0.05);
    const bottom = h.clone().addScaledVector(y, -0.15);
    this.root.localToWorld(top);
    this.root.localToWorld(bottom);
    this.solveArm('L', top, poleL);
    this.solveArm('R', bottom, poleR);
  }

  /**
   * Two-bone leg IK. ft = [x, z, yaw°, heel] in root space: the ankle goes over (x, z), the foot points
   * along yaw (0 = the way the body faces) and `heel` lifts the heel with the toes kept on the ground.
   * The knee points where the foot does. w blends from the FK pose (0) to the IK solution (1).
   */
  solveLeg(side, ft, w) {
    const thigh = this.b['thigh' + side], shin = this.b['shin' + side], foot = this.b['foot' + side];
    const M = _m2.copy(this.b.hips.matrixWorld).invert().multiply(this.root.matrixWorld);   // root -> hips space
    _qM.setFromRotationMatrix(M);
    const heel = Math.max(0, ft[3] || 0);
    const pitch = Math.asin(Math.min(heel, 0.11) / 0.13);
    const yaw = ft[2] * DEG;
    const T = _l1.set(ft[0], LIMB.ankle + heel + (ft[4] || 0), ft[1]).applyMatrix4(M);   // ft[4]: whole-foot lift (side-steps)
    const kneeYaw = yaw + (side === 'L' ? 0.14 : -0.14);
    const pole = _l2.set(Math.sin(kneeYaw), 0, Math.cos(kneeYaw)).applyQuaternion(_qM);
    const S = thigh.position;
    const a = LIMB.thigh, b = LIMB.shin;
    const dir = _l3.copy(T).sub(S);
    const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-3, dir.length()));
    dir.normalize();
    const perp = _l4.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const alpha = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
    const u = _l5.copy(dir).multiplyScalar(Math.cos(alpha)).addScaledVector(perp, Math.sin(alpha));   // hip -> knee
    const f = _l6.copy(S).addScaledVector(u, a).negate().add(T).normalize();                          // knee -> ankle
    // Thigh frame: +y up the bone, +z the kneecap. Shin shares the knee hinge axis (x).
    const yT = u.negate();
    const zT = _l7.copy(pole).addScaledVector(yT, -pole.dot(yT)).normalize();
    const xT = _l8.crossVectors(yT, zT).normalize();
    _qT.setFromRotationMatrix(_m3.makeBasis(xT, yT, zT));
    const yS = f.negate();
    const zS = _l9.crossVectors(xT, yS).normalize();
    _qS.setFromRotationMatrix(_m3.makeBasis(xT, yS, zS));            // shin in hips space
    _qF.setFromEuler(_e1.set(pitch, yaw, 0, 'YXZ')).premultiply(_qM); // foot in hips space
    _qF.premultiply(_q2.copy(_qS).invert());                          // foot relative to the shin
    _qS.premultiply(_q2.copy(_qT).invert());                          // shin relative to the thigh
    thigh.quaternion.slerp(_qT, w);
    shin.quaternion.slerp(_qS, w);
    foot.quaternion.slerp(_qF, w);
    thigh.updateMatrixWorld(true);
  }

  /** Analytic two-bone IK: rotate upper arm and forearm so the palm reaches `target` (world). */
  solveArm(side, target, poleRoot = null) {
    const upper = this.b['arm' + side], fore = this.b['fore' + side];
    const parent = upper.parent;
    parent.updateMatrixWorld(true);
    const inv = _m1.copy(parent.matrixWorld).invert();
    // elbow direction: authored in root space by the clip, else down and slightly out
    if (poleRoot) _pole.set(poleRoot[0], poleRoot[1], poleRoot[2]).transformDirection(_m2.copy(inv).multiply(this.root.matrixWorld));
    else _pole.set(side === 'L' ? 0.55 : -0.55, -1, -0.3).normalize();
    const T = _v1.copy(target).applyMatrix4(inv);
    const Sp = _v2.copy(upper.position);
    const a = LIMB.upper, bLen = LIMB.fore + 0.075;
    const dir = _v3.copy(T).sub(Sp);
    let d = dir.length();
    d = Math.min(a + bLen - 1e-3, Math.max(Math.abs(a - bLen) + 1e-3, d));
    dir.normalize();
    const n = _v5.crossVectors(dir, _pole).normalize();
    const perp = _v6.crossVectors(n, dir).normalize();
    const cosA = (a * a + d * d - bLen * bLen) / (2 * a * d);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const u = _v7.copy(dir).multiplyScalar(Math.cos(alpha)).addScaledVector(perp, Math.sin(alpha));
    upper.quaternion.setFromUnitVectors(DOWN, u);
    const E = _v8.copy(Sp).addScaledVector(u, a);
    const f = _v9.copy(T).sub(E).normalize();
    f.applyQuaternion(_q1.copy(upper.quaternion).invert());
    fore.quaternion.setFromUnitVectors(DOWN, f);
    upper.updateMatrixWorld(true);
  }

  setPosition(x, z, yaw) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
  }

  dispose() {
    if (this.backPlate) { this.backPlate.material.map.dispose(); this.backPlate.material.dispose(); this.backPlate.geometry.dispose(); }
    this.mesh.skeleton.dispose();
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3(), _v9 = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qM = new THREE.Quaternion(), _qT = new THREE.Quaternion(), _qS = new THREE.Quaternion(), _qF = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _pole = new THREE.Vector3();
const [_f1, _f2, _f3, _f4, _f5, _f6] = Array.from({ length: 6 }, () => new THREE.Vector3());
const [_l1, _l2, _l3, _l4, _l5, _l6, _l7, _l8, _l9] = Array.from({ length: 9 }, () => new THREE.Vector3());

export { sharedMat, JOINTS };
