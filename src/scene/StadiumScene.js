// The stadium: the game's own ground, pitch and stumps (where the play happens) inside the 3D stadium model
// (assets/models/stadium: "Cricket stadium" by Hassnain_ALy, CC BY 4.0, made to the game's scale by
// scripts/stadium-model.html): its bowl of stands, boundary boards and rope, floodlight towers and scoreboard. The
// stands are seated here with rows of seats and an instanced crowd in the model's colour sections, the scoreboard
// shows the match, and the floodlights glow at night. Sightscreens, sky, lights and the scenery beyond complete it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GeoBuilder, lambert } from './GeoBuilder.js';
import { outfieldTexture, pitchTexture, pitchBumpTexture, ScoreboardTexture, glowTexture } from './Textures.js';
import { buildScenery } from './Environment.js';
import { PITCH } from '../game/BallPhysics.js';
import { NetArea } from './NetArea.js';

// Two settings for the same stadium: the grass's mowing colours and what lies beyond the stands.
export const STADIUMS = {
  harbour: { label: 'Harbour Oval (city)', grass: ['#4c9a3b', '#58a845'], scenery: 'city' },
  highland: { label: 'Highland Park (hills)', grass: ['#4a8c35', '#56a041'], scenery: 'hills' },
};

export const TIMES = {
  day: { label: 'Day', sky: ['#2f7fd8', '#cde9f8'], sun: { elev: 52, azim: 35, color: '#fff4e0', intensity: 2.6 }, hemi: ['#d6ecff', '#56743e', 1.05], fog: '#cde9f8', lights: 0, exposure: 1.0 },
  evening: { label: 'Evening', sky: ['#24427f', '#f4a261'], sun: { elev: 13, azim: 72, color: '#ffbc7a', intensity: 2.2 }, hemi: ['#9db6e6', '#3d4a2c', 0.75], fog: '#e9a46e', lights: 0.6, exposure: 1.0 },
  night: { label: 'Night', sky: ['#040814', '#16213d'], sun: { elev: 66, azim: 15, color: '#f2f6ff', intensity: 2.4 }, hemi: ['#6d7fa8', '#1e2c20', 0.55], fog: '#121a2f', lights: 1, exposure: 1.05 },
};

const DEG = Math.PI / 180;
const MODEL = { glb: 'assets/models/stadium/stadium.glb', meta: 'assets/models/stadium/stadium.json' };
// Seating on the model's stands: rows from the front of the bowl, a seat every SEAT_GAP metres along each row.
// The first `seats` rows get modelled seats; the rows above, up to the top of the model's seating, are drawn as rows
// of seats in the section's colour (they're far from every camera). The crowd fills a share of all of them, thinner
// higher up.
const SEATING = {
  rowGap: 1.0, seatGap: 0.62,
  seats: { low: 12, medium: 24, high: 36 },
  crowd: { low: [0.3, 0.06], medium: [0.5, 0.16], high: [0.65, 0.26] },   // [near rows, upper rows]
};
const SIGHTSCREEN_Z = 71;    // between the boundary boards (68.7 m) and the front of the stands

let modelLoad = null;        // the stadium model, loaded once: Promise<{ scene, meta }>
function loadModel() {
  if (!modelLoad) {
    modelLoad = Promise.all([new GLTFLoader().loadAsync(MODEL.glb), fetch(MODEL.meta).then(r => r.json())])
      .then(([gltf, meta]) => ({ scene: gltf.scene, meta }));
  }
  return modelLoad;
}

export class StadiumScene {
  constructor(renderer, { stadium = 'harbour', timeOfDay = 'day', quality = 'medium' } = {}) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.quality = quality;
    this.uniforms = { uTime: { value: 0 }, uCheer: { value: 0 } };
    this.cheerTarget = 0;
    this.frame = new THREE.Group();   // delivery frame (rotated 180° when the ends change)
    this.frame.name = 'deliveryFrame';
    this.scene.add(this.frame);
    this.mat = lambert();
    this.glowTex = glowTexture();
    this.scoreboard = new ScoreboardTexture();
    this.build(stadium, timeOfDay);
  }

  build(stadium, timeOfDay) {
    if (this.root) { this.scene.remove(this.root); this.disposeTree(this.root); }
    this.stadiumId = STADIUMS[stadium] ? stadium : 'harbour';
    this.S = STADIUMS[this.stadiumId];
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.crowd = null; this.glows = []; this.lampMat = null; this.boardMat = null;
    this.buildLights();
    this.buildGround();
    this.buildPitch();
    this.buildStumps();
    this.buildSightscreens();
    // the model's scoreboard screen has glTF texture coordinates (not flipped): its own texture of the same canvas
    if (!this.screenTex) {
      this.screenTex = new THREE.CanvasTexture(this.scoreboard.canvas);
      this.screenTex.flipY = false;
      this.screenTex.colorSpace = THREE.SRGBColorSpace;
      this.screenTex.anisotropy = 8;
    }
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, fog: false });
    this.scenery = buildScenery(this.S.scenery, this.mat, this.quality, { inner: 200 });   // all of it beyond the stands
    this.root.add(this.scenery.group);
    this.setTimeOfDay(timeOfDay);
    this.buildStadiumModel();
  }

  /** The stadium model (loaded once, shared by every build): added when it arrives, then seated and lit. */
  buildStadiumModel() {
    const build = this.buildNo = (this.buildNo || 0) + 1;
    loadModel().then(({ scene, meta }) => {
      if (build !== this.buildNo) return;          // rebuilt meanwhile (another stadium or time of day)
      const model = scene.clone();
      model.traverse(o => { o.userData.shared = true; if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      const screen = model.getObjectByName('Scoreboard_screen');
      if (screen) {
        // the screen's own coordinates cover only part of the model's picture: stretch the match display over all of it
        const g = screen.geometry.clone(), uv = g.attributes.uv;
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - u0) / (u1 - u0), (v1 - uv.getY(i)) / (v1 - v0));
        screen.geometry = g;
        screen.material = this.screenMat;
        screen.userData.shared = false;
      }
      this.lampMat = model.getObjectByName('Emissive')?.material || null;
      this.boardMat = model.getObjectByName('Boundary_texture')?.material || null;
      if (this.boardMat && this.boardMat.map) this.boardMat.emissiveMap = this.boardMat.map;
      this.model = model;
      this.root.add(model);
      this.buildSeating(meta);
      this.buildGlows(meta.lights);
      this.setTimeOfDay(this.timeId);
    }).catch(err => console.warn('Stadium model not loaded.', err));
  }

  /**
   * Rows of seats up the stands, following their rake, in the model's colour sections (the gaps between sections
   * are the aisles): modelled seats in the near rows, coloured rows above; and a crowd in a share of them.
   */
  buildSeating(meta) {
    const { a, b } = meta.rake, q = this.quality;
    const near = SEATING.seats[q] ?? SEATING.seats.medium;
    const [dNear, dFar] = SEATING.crowd[q] ?? SEATING.crowd.medium;
    const r0 = meta.seating.r0 + 3.5, r1 = meta.seating.r1;
    const seats = [], crowd = [];
    const strips = { P: [], C: [] };
    const col = new THREE.Color();
    for (let i = 0, r = r0; r <= r1; i++, r = r0 + i * SEATING.rowGap) {
      const y = a + b * r;
      for (const s of meta.sections) {
        const inset = 0.6 / r;                          // a little aisle at each end
        const a0 = s.a0 - 0.035 + inset, a1 = s.a1 + 0.035 - inset;
        const n = Math.floor((a1 - a0) * r / SEATING.seatGap);
        if (i < near) {
          for (let k = 0; k < n; k++) {
            const st = { a: a0 + (k + 0.5) * (a1 - a0) / n, r, y, color: s.color };
            seats.push(st);
            if (Math.random() < dNear) crowd.push(st);
          }
        } else {
          // a row of seats as one coloured strip: the seat backs (a low band) and the seat pads in front
          const segs = Math.max(2, Math.ceil((a1 - a0) / (2 * DEG)));
          col.set(s.color).multiplyScalar(i % 2 ? 0.86 : 0.94);
          for (let k = 0; k < segs; k++) {
            const u0 = a0 + (a1 - a0) * k / segs, u1 = a0 + (a1 - a0) * (k + 1) / segs;
            const p = (rr, uu, yy) => [Math.sin(uu) * rr, yy, Math.cos(uu) * rr];
            const quad = (A, B, C, D) => { strips.P.push(...A, ...B, ...C, ...A, ...C, ...D); for (let v = 0; v < 6; v++) strips.C.push(col.r, col.g, col.b); };
            quad(p(r + 0.2, u1, y + 0.42), p(r + 0.2, u0, y + 0.42), p(r + 0.22, u0, y + 0.85), p(r + 0.22, u1, y + 0.85));   // backs
            quad(p(r - 0.2, u1, y + 0.42), p(r - 0.2, u0, y + 0.42), p(r + 0.2, u0, y + 0.42), p(r + 0.2, u1, y + 0.42));     // pads
          }
          for (let k = 0; k < n; k++) if (Math.random() < dFar) crowd.push({ a: a0 + (k + 0.5) * (a1 - a0) / n, r, y });
        }
      }
    }
    // modelled seats: the pad and the back (two quads), facing the field
    const geo = new THREE.BufferGeometry();
    const P = [
      -0.22, 0.42, -0.2, 0.22, 0.42, -0.2, 0.22, 0.42, 0.2, -0.22, 0.42, -0.2, 0.22, 0.42, 0.2, -0.22, 0.42, 0.2,
      -0.22, 0.42, -0.2, 0.22, 0.85, -0.22, 0.22, 0.42, -0.2, -0.22, 0.42, -0.2, -0.22, 0.85, -0.22, 0.22, 0.85, -0.22,
    ];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), seats.length);
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
    seats.forEach((st, i) => {
      qt.setFromAxisAngle(up, st.a + Math.PI);
      m.compose(new THREE.Vector3(Math.sin(st.a) * st.r, st.y, Math.cos(st.a) * st.r), qt, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(st.color).multiplyScalar(0.88 + 0.12 * ((i * 7919) % 13) / 13));
    });
    mesh.name = 'seats';
    mesh.frustumCulled = false;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(strips.P, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(strips.C, 3));
    sg.computeVertexNormals();
    const upper = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    upper.name = 'upperSeats';
    this.root.add(mesh, upper);
    this.buildCrowd(crowd, 1);
  }

  /** A glow at each floodlight panel (shows in the evening and at night). */
  buildGlows(lights) {
    for (const [x, y, z] of lights) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#fff7dd', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      glow.scale.set(80, 52, 1);
      glow.position.set(x * 0.99, y, z * 0.99);
      this.glows.push(glow);
      this.root.add(glow);
    }
  }

  /** Sightscreens at both ends: dark behind a white ball, white behind a red one (Tests). */
  buildSightscreens() {
    const screens = new GeoBuilder(), legs = new GeoBuilder();
    for (const z of [SIGHTSCREEN_Z, -SIGHTSCREEN_Z]) {
      screens.box(15, 7.5, 0.4, '#ffffff', [0, 3.75 + 0.6, z]);
      for (const x of [-6.5, 0, 6.5]) legs.box(0.25, 0.6, 0.25, '#555c66', [x, 0.3, z]);
    }
    this.sightMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: '#1d222b' });
    this.root.add(screens.build(this.sightMat), legs.build(this.mat));
    this.setSightscreens(this.sightKind || 'black');
  }

  disposeTree(obj) {
    obj.traverse(o => {
      if (o.userData.shared) return;            // the stadium model's geometry and materials are kept for the next build
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== this.mat) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map && m.map !== this.scoreboard.texture && m.map !== this.screenTex) m.map.dispose(); m.dispose(); }
      }
    });
  }

  // ------------------------------------------------------------------ lights & sky
  buildLights() {
    this.hemi = new THREE.HemisphereLight('#ffffff', '#445533', 1);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    const sh = this.quality !== 'low';
    this.sun.castShadow = sh;
    if (sh) {
      const size = this.quality === 'high' ? 2048 : 1024;
      this.sun.shadow.mapSize.set(size, size);
      const c = this.sun.shadow.camera;
      c.left = -72; c.right = 72; c.top = 72; c.bottom = -72; c.near = 10; c.far = 400;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
    }
    this.root.add(this.hemi, this.sun, this.sun.target);

    // Sky dome with a vertex-colour gradient
    const g = new THREE.SphereGeometry(900, 24, 12);
    const col = new Float32Array(g.attributes.position.count * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.skyMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.skyMesh.renderOrder = -10;
    this.root.add(this.skyMesh);

    // Sun disc and stars
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#fff3d6', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.set(90, 90, 1);
    this.root.add(this.sunSprite);
    const starPos = [];
    for (let i = 0; i < 600; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.08;
      starPos.push(Math.cos(u) * Math.cos(v) * 850, Math.sin(v) * 850, Math.sin(u) * Math.cos(v) * 850);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
    this.root.add(this.stars);
  }

  setTimeOfDay(id) {
    const T = TIMES[id] || TIMES.day;
    this.timeId = TIMES[id] ? id : 'day';
    this.T = T;
    const top = new THREE.Color(T.sky[0]), hor = new THREE.Color(T.sky[1]);
    const g = this.skyMesh.geometry;
    const p = g.attributes.position, c = g.attributes.color;
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 900;
      const k = Math.pow(Math.max(0, y), 0.55);
      tmp.copy(hor).lerp(top, k);
      if (y < 0) tmp.copy(hor).multiplyScalar(0.85);
      c.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    c.needsUpdate = true;
    this.scene.fog = new THREE.Fog(T.fog, 260, 950);
    this.scene.background = new THREE.Color(T.sky[1]);
    this.hemi.color.set(T.hemi[0]); this.hemi.groundColor.set(T.hemi[1]); this.hemi.intensity = T.hemi[2];
    const el = T.sun.elev * DEG, az = T.sun.azim * DEG;
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this.sun.position.copy(dir).multiplyScalar(200);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.set(T.sun.color);
    this.sun.intensity = T.sun.intensity;
    this.sunSprite.visible = id !== 'night';
    this.sunSprite.position.copy(dir).multiplyScalar(800);
    this.sunSprite.material.color.set(id === 'evening' ? '#ffb070' : '#fff3d6');
    this.stars.visible = id === 'night';
    this.renderer.toneMappingExposure = T.exposure;
    const lightsOn = T.lights;
    if (this.lampMat) {
      this.lampMat.emissive.set('#fffbe8');
      this.lampMat.emissiveIntensity = lightsOn ? 1.5 + 1.5 * lightsOn : 0.15;
    }
    for (const s of this.glows) { s.visible = lightsOn > 0; s.material.opacity = 0.55 * lightsOn + 0.2; }
    if (this.boardMat) this.boardMat.emissive.set(lightsOn ? '#555555' : '#000000');
    if (this.screenMat) this.screenMat.color.set('#ffffff');
    if (this.scenery) this.scenery.setNight(id === 'night', id === 'evening');
  }

  // ------------------------------------------------------------------ ground
  buildGround() {
    const tex = outfieldTexture({ size: 150, palette: this.S.grass });
    const geo = new THREE.CircleGeometry(75, 96);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + 75) / 150, 1 - (pos.getZ(i) + 75) / 150);
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    ground.receiveShadow = true;
    ground.name = 'outfield';
    this.root.add(ground);
  }

  buildPitch() {
    const geo = new THREE.PlaneGeometry(3.66, 24);
    geo.rotateX(-Math.PI / 2);
    const pitch = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: pitchTexture(), bumpMap: pitchBumpTexture(), bumpScale: 1.2 }));
    pitch.position.y = 0.012;
    pitch.receiveShadow = true;
    pitch.name = 'pitch';
    this.root.add(pitch);
    // Mown square around the pitch
    const sq = new THREE.Mesh(new THREE.PlaneGeometry(10, 26).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: this.S.grass[1], transparent: true, opacity: 0.55 }));
    sq.position.y = 0.006;
    sq.receiveShadow = true;
    this.root.add(sq);
  }

  buildStumps() {
    this.stumpSets = {};
    const stumpMat = new THREE.MeshLambertMaterial({ color: '#f3ead2' });
    const bailMat = new THREE.MeshLambertMaterial({ color: '#e9d9a8' });
    const stumpGeo = new THREE.CylinderGeometry(0.019, 0.019, PITCH.stumpHeight, 7).translate(0, PITCH.stumpHeight / 2, 0);
    const bailGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.11, 5).rotateZ(Math.PI / 2);
    for (const [key, z] of [['plus', PITCH.half], ['minus', -PITCH.half]]) {
      const grp = new THREE.Group();
      grp.position.set(0, 0, z);
      const stumps = [], bails = [];
      for (let i = -1; i <= 1; i++) {
        const s = new THREE.Mesh(stumpGeo, stumpMat);
        s.position.set(i * 0.0953, 0, 0);
        s.castShadow = true;
        grp.add(s); stumps.push(s);
      }
      for (let i = 0; i < 2; i++) {
        const b = new THREE.Mesh(bailGeo, bailMat);
        b.position.set((i - 0.5) * 0.0953, PITCH.stumpHeight + 0.008, 0);
        grp.add(b); bails.push(b);
      }
      this.root.add(grp);
      this.stumpSets[key] = { group: grp, stumps, bails, broken: false, t: 0, vel: [] };
    }
  }

  /** Physical stumps at an end of the delivery frame ('striker' | 'nonStriker'). */
  stumpsAt(end) {
    const flipped = Math.abs(this.frame.rotation.y) > 1;
    const plus = end === 'striker' ? !flipped : flipped;
    return this.stumpSets[plus ? 'plus' : 'minus'];
  }

  breakStumps(end, strength = 1) {
    const s = this.stumpsAt(end);
    if (s.broken) return;
    s.broken = true; s.t = 0;
    const away = (s.group.position.z > 0 ? 1 : -1);
    s.vel = s.bails.map((_, i) => new THREE.Vector3((i - 0.5) * 1.8 * strength + (Math.random() - 0.5), 2.2 + Math.random() * 1.5, away * (1.2 + Math.random()) * strength));
    s.tilt = s.stumps.map(() => (Math.random() * 0.5 + 0.3) * strength);
  }

  resetStumps() {
    for (const s of Object.values(this.stumpSets)) {
      s.broken = false;
      s.stumps.forEach((m, i) => { m.rotation.set(0, 0, 0); m.position.set((i - 1) * 0.0953, 0, 0); });
      s.bails.forEach((b, i) => { b.position.set((i - 0.5) * 0.0953, PITCH.stumpHeight + 0.008, 0); b.rotation.set(0, 0, Math.PI / 2 * 0); });
    }
  }

  /** Let broken stumps fall to rest at once (a replay segment that starts after the wicket). */
  settleStumps() { for (let i = 0; i < 120; i++) this.updateStumps(1 / 60); }

  updateStumps(dt) {
    for (const s of Object.values(this.stumpSets)) {
      if (!s.broken) continue;
      s.t += dt;
      const away = s.group.position.z > 0 ? 1 : -1;
      s.bails.forEach((b, i) => {
        if (b.position.y <= 0.01 && s.t > 0.1) return;
        s.vel[i].y -= 9.8 * dt;
        b.position.addScaledVector(s.vel[i], dt);
        b.rotation.x += dt * 12; b.rotation.y += dt * 7;
        if (b.position.y < 0.01) { b.position.y = 0.01; s.vel[i].set(0, 0, 0); }
      });
      s.stumps.forEach((m, i) => {
        const target = s.tilt[i] * (i === 1 ? 1 : 0.7);
        m.rotation.x += (away * target - m.rotation.x) * Math.min(1, dt * 14);
      });
    }
  }

  buildCrowd(seats, density = 0.5) {
    const chosen = seats.filter(() => Math.random() < density);
    const n = chosen.length;
    // Body (torso + legs block) and head as two instanced meshes
    const body = new THREE.BoxGeometry(0.42, 0.55, 0.3).translate(0, 0.3, 0);
    const head = new THREE.BoxGeometry(0.21, 0.23, 0.21).translate(0, 0.72, 0.02);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uCheer = this.uniforms.uCheer;
      shader.vertexShader = 'uniform float uTime;\nuniform float uCheer;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float h = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
         float jump = max(0.0, sin(uTime * (7.0 + h * 5.0) + h * 6.283));
         transformed.y += jump * uCheer * (0.12 + 0.3 * h) + sin(uTime * 1.3 + h * 20.0) * 0.015;`);
    };
    const bodies = new THREE.InstancedMesh(body, mat, n);
    const heads = new THREE.InstancedMesh(head, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const shirt = new THREE.Color(), skin = new THREE.Color();
    const shirtPal = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#ffb703', '#fb8500', '#2a9d8f', '#8338ec', '#ff006e', '#06d6a0', '#ffffff', '#222222'];
    const skinPal = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a0673b'];
    this.crowdHome = [];
    chosen.forEach((st, i) => {
      p.set(Math.sin(st.a) * st.r, st.y, Math.cos(st.a) * st.r);
      q.setFromAxisAngle(up, st.a + Math.PI);
      const k = 0.9 + Math.random() * 0.2;
      s.set(k, k, k);
      m.compose(p, q, s);
      bodies.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      shirt.set(this.teamCrowdColor && Math.random() < 0.35 ? this.teamCrowdColor : shirtPal[(Math.random() * shirtPal.length) | 0]);
      skin.set(skinPal[(Math.random() * skinPal.length) | 0]);
      bodies.setColorAt(i, shirt); heads.setColorAt(i, skin);
    });
    bodies.frustumCulled = false; heads.frustumCulled = false;
    this.root.add(bodies, heads);
    this.crowd = { bodies, heads };
    if (this.netsOn) bodies.visible = heads.visible = false;
  }

  updateScoreboard(info) { this.scoreboard.draw(info); if (this.screenTex) this.screenTex.needsUpdate = true; }

  setCrowdTeamColor(color) { this.teamCrowdColor = color; }

  /** 'black' for the white ball, 'white' for the red ball. */
  setSightscreens(kind = 'black') {
    this.sightKind = kind === 'white' ? 'white' : 'black';
    if (this.sightMat) this.sightMat.color.set(this.sightKind === 'white' ? '#f2f2ec' : '#1d222b');
  }

  /** Net practice: show the green net lane around the pitch and empty the stands (no crowd at practice). */
  setNets(on) {
    this.netsOn = !!on;
    if (on && !this.nets) this.nets = new NetArea(this.renderer);
    if (this.nets) { this.nets.attach(this.frame); this.nets.setVisible(on); }
    if (this.crowd) this.crowd.bodies.visible = this.crowd.heads.visible = !on;
  }

  /** Delivery frame orientation: 0 = bowling from the -z end, 1 = from the scoreboard (+z) end. */
  setEnds(bowlingEnd) {
    this.frame.rotation.y = bowlingEnd ? Math.PI : 0;
    this.frame.updateMatrixWorld(true);
  }

  cheer(amount = 1) { this.cheerTarget = Math.max(this.cheerTarget, amount); }

  update(dt, t) {
    this.uniforms.uTime.value = t;
    const u = this.uniforms.uCheer;
    u.value += (this.cheerTarget - u.value) * Math.min(1, dt * 4);
    this.cheerTarget = Math.max(0, this.cheerTarget - dt * 0.35);
    this.updateStumps(dt * (this.stumpTimeScale ?? 1));
    if (this.scenery) this.scenery.update(dt, t);
  }
}
