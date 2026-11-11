// The low-poly stadium: ground, pitch, stumps, boundary, stands with an instanced crowd,
// floodlights, scoreboards and surroundings. Static parts are merged to keep draw calls low.
import * as THREE from 'three';
import { GeoBuilder, lambert } from './GeoBuilder.js';
import { outfieldTexture, pitchTexture, pitchBumpTexture, adBoardTexture, ScoreboardTexture, glowTexture } from './Textures.js';
import { buildScenery } from './Environment.js';
import { PITCH, BOUNDARY_RADIUS } from '../game/BallPhysics.js';
import { NetArea } from './NetArea.js';

export const STADIUMS = {
  harbour: { label: 'Harbour Oval', grass: ['#4c9a3b', '#58a845'], concrete: '#cfd5df', seat: ['#2f6fd6', '#e7edf6', '#f2c94c'], roof: '#f4f6fa', rope: '#ffffff', scenery: 'city', upper: true },
  highland: { label: 'Highland Park', grass: ['#4a8c35', '#56a041'], concrete: '#cbbd9f', seat: ['#b3352e', '#efe7d2', '#3f6b45'], roof: '#7a5638', rope: '#f2c94c', scenery: 'hills', upper: false },
};

export const TIMES = {
  day: { label: 'Day', sky: ['#2f7fd8', '#cde9f8'], sun: { elev: 52, azim: 35, color: '#fff4e0', intensity: 2.6 }, hemi: ['#d6ecff', '#56743e', 1.05], fog: '#cde9f8', lights: 0, exposure: 1.0 },
  evening: { label: 'Evening', sky: ['#24427f', '#f4a261'], sun: { elev: 13, azim: 72, color: '#ffbc7a', intensity: 2.2 }, hemi: ['#9db6e6', '#3d4a2c', 0.75], fog: '#e9a46e', lights: 0.6, exposure: 1.0 },
  night: { label: 'Night', sky: ['#040814', '#16213d'], sun: { elev: 66, azim: 15, color: '#f2f6ff', intensity: 2.4 }, hemi: ['#6d7fa8', '#1e2c20', 0.55], fog: '#121a2f', lights: 1, exposure: 1.05 },
};

const SECTORS = [[12, 42], [48, 132], [138, 168], [192, 222], [228, 312], [318, 348]];
const FLOOD_ANGLES = [45, 135, 225, 315];
const DEG = Math.PI / 180;

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
    this.buildLights();
    this.buildGround();
    this.buildPitch();
    this.buildStumps();
    this.buildBoundary();
    this.buildStands();
    this.buildFloodlights();
    this.buildFeatures();
    this.scenery = buildScenery(this.S.scenery, this.mat, this.quality);
    this.root.add(this.scenery.group);
    this.setTimeOfDay(timeOfDay);
  }

  disposeTree(obj) {
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== this.mat) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map && m.map !== this.scoreboard.texture) m.map.dispose(); m.dispose(); }
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
      this.lampMat.color.set(lightsOn ? '#fffbe8' : '#c9ccd2');
      for (const s of this.glows) { s.visible = lightsOn > 0; s.material.opacity = 0.55 * lightsOn + 0.2; }
    }
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
    // Outer concourse ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(75, 140, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: this.S.scenery === 'city' ? '#8d949c' : '#6f8c4f' }));
    ring.position.y = -0.02;
    ring.receiveShadow = true;
    this.root.add(ring);
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

  buildBoundary() {
    const R = BOUNDARY_RADIUS;
    const pts = [];
    for (let i = 0; i <= 200; i++) { const a = (i / 200) * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * R, 0.07, Math.cos(a) * R)); }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 200, 0.075, 5, true), new THREE.MeshLambertMaterial({ color: this.S.rope }));
    rope.castShadow = false;
    this.root.add(rope);
    // Advertising boards
    const tex = adBoardTexture();
    this.boardMat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#000000', emissiveMap: tex, side: THREE.DoubleSide });
    const boards = new THREE.Mesh(new THREE.CylinderGeometry(66, 66, 0.95, 120, 1, true), this.boardMat);
    boards.position.y = 0.48;
    this.root.add(boards);
    const backing = new GeoBuilder();
    backing.add(new THREE.CylinderGeometry(66.25, 66.25, 0.95, 120, 1, true), '#2a2f3a', { pos: [0, 0.48, 0] });
    this.root.add(backing.build(this.mat));
  }

  // ------------------------------------------------------------------ stands & crowd
  buildStands() {
    const gb = new GeoBuilder();
    const seats = [];
    const S = this.S;
    const tiers = [{ r0: 70, rows: 24, depth: 0.88, rise: 0.44, base: 1.3 }];
    if (S.upper) tiers.push({ r0: 93.5, rows: 15, depth: 0.88, rise: 0.6, base: 14.2 });
    for (const [d0, d1] of SECTORS) {
      const a0 = d0 * DEG, a1 = d1 * DEG;
      for (const t of tiers) this.stepped(gb, a0, a1, t, seats);
      // Roof canopy over the top tier
      const t = tiers[tiers.length - 1];
      const rTop = t.r0 + t.rows * t.depth;
      const hTop = t.base + t.rows * t.rise;
      this.roof(gb, a0, a1, rTop - (S.upper ? 13 : 9), rTop + 1.2, hTop + 4.5, hTop + 6.5);
    }
    const mesh = gb.build(this.mat);
    mesh.castShadow = this.quality === 'high';
    mesh.receiveShadow = this.quality !== 'low';
    mesh.name = 'stands';
    this.root.add(mesh);
    this.buildCrowd(seats);
  }

  stepped(gb, a0, a1, { r0, rows, depth, rise, base }, seats) {
    const S = this.S;
    const segs = Math.max(4, Math.round((a1 - a0) / (2.2 * DEG)));
    const P = [], C = [];
    const pt = (r, a, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    const quad = (A, B, Cc, D, col) => { P.push(...A, ...B, ...Cc, ...A, ...Cc, ...D); C.push(col, col); };
    const concrete = S.concrete;
    for (let i = 0; i < rows; i++) {
      const r = r0 + i * depth, y0 = base + i * rise, y1 = y0 + rise;
      for (let s = 0; s < segs; s++) {
        const b0 = a0 + ((a1 - a0) * s) / segs, b1 = a0 + ((a1 - a0) * (s + 1)) / segs;
        const block = Math.floor(s / 3) + Math.floor(i / 6);
        const seat = S.seat[block % S.seat.length];
        // riser (front face of the step)
        quad(pt(r, b1, y0), pt(r, b0, y0), pt(r, b0, y1), pt(r, b1, y1), concrete);
        // tread (seats)
        quad(pt(r, b1, y1), pt(r, b0, y1), pt(r + depth, b0, y1), pt(r + depth, b1, y1), seat);
        if (Math.random() < 0.92) seats.push({ a: (b0 + b1) / 2 + (Math.random() - 0.5) * 0.004, r: r + depth * 0.45, y: y1, row: i });
      }
    }
    // back wall + sides
    const rEnd = r0 + rows * depth, yEnd = base + rows * rise;
    for (let s = 0; s < segs; s++) {
      const b0 = a0 + ((a1 - a0) * s) / segs, b1 = a0 + ((a1 - a0) * (s + 1)) / segs;
      quad(pt(rEnd, b0, 0), pt(rEnd, b1, 0), pt(rEnd, b1, yEnd + 1.2), pt(rEnd, b0, yEnd + 1.2), '#9aa1ab');
      quad(pt(rEnd - 0.3, b1, yEnd), pt(rEnd - 0.3, b0, yEnd), pt(rEnd - 0.3, b0, yEnd + 1.2), pt(rEnd - 0.3, b1, yEnd + 1.2), concrete);
      // front wall under the first row
      quad(pt(r0, b1, 0), pt(r0, b0, 0), pt(r0, b0, base), pt(r0, b1, base), '#7c8796');
    }
    for (const a of [a0, a1]) {
      const flip = a === a0 ? 1 : -1;
      const A = pt(r0, a, 0), B = pt(rEnd, a, 0), Cc = pt(rEnd, a, yEnd + 1.2), D = pt(r0, a, base);
      if (flip > 0) { P.push(...A, ...Cc, ...B, ...A, ...D, ...Cc); } else { P.push(...A, ...B, ...Cc, ...A, ...Cc, ...D); }
      C.push('#aeb5bf', '#aeb5bf');
    }
    gb.tris(P, C);
  }

  roof(gb, a0, a1, rIn, rOut, yIn, yOut) {
    const segs = Math.max(4, Math.round((a1 - a0) / (4 * DEG)));
    const P = [], C = [];
    const pt = (r, a, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    for (let s = 0; s < segs; s++) {
      const b0 = a0 + ((a1 - a0) * s) / segs, b1 = a0 + ((a1 - a0) * (s + 1)) / segs;
      const A = pt(rIn, b0, yIn), B = pt(rIn, b1, yIn), Cc = pt(rOut, b1, yOut), D = pt(rOut, b0, yOut);
      P.push(...A, ...Cc, ...B, ...A, ...D, ...Cc); C.push(this.S.roof, this.S.roof);
      P.push(...A, ...B, ...Cc, ...A, ...Cc, ...D); C.push('#7d8590', '#7d8590');
      if (s % 2 === 0) {
        const am = (b0 + b1) / 2;
        gb.box(0.35, yOut, 0.35, '#8e96a1', [Math.sin(am) * (rOut - 0.5), yOut / 2, Math.cos(am) * (rOut - 0.5)]);
      }
    }
    gb.tris(P, C);
  }

  buildCrowd(seats) {
    const density = { low: 0.32, medium: 0.6, high: 0.85 }[this.quality] ?? 0.6;
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

  // ------------------------------------------------------------------ floodlights / features
  buildFloodlights() {
    const gb = new GeoBuilder();
    const lamps = new GeoBuilder();
    this.glows = [];
    for (const deg of FLOOD_ANGLES) {
      const a = deg * DEG, r = 101;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const H = 52;
      gb.cyl(0.7, 1.4, H, 6, '#9aa3ad', [x, H / 2, z]);
      // lattice-ish cross bars
      for (let h = 6; h < H - 4; h += 6) gb.box(2.4, 0.18, 0.18, '#7f8893', [x, h, z], [0, -a, 0.6]);
      // head panel tilted to face the centre
      const head = new THREE.Object3D();
      head.position.set(x, H + 2.5, z);
      head.lookAt(0, 0, 0);
      head.updateMatrix();
      const panel = new THREE.BoxGeometry(11, 6, 0.6);
      gb.add(panel, '#59606a', { matrix: head.matrix });
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        const lm = new THREE.Matrix4().makeTranslation(-4.4 + i * 2.2, -1.8 + j * 1.8, 0.35);
        lamps.add(new THREE.BoxGeometry(1.7, 1.4, 0.15), '#ffffff', { matrix: head.matrix.clone().multiply(lm) });
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#fff7dd', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      glow.scale.set(34, 22, 1);
      glow.position.set(x * 0.985, H + 2.5, z * 0.985);
      this.glows.push(glow);
      this.root.add(glow);
    }
    const towers = gb.build(this.mat);
    towers.castShadow = this.quality !== 'low';
    this.root.add(towers);
    this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: '#ffffff', fog: false });
    this.root.add(lamps.build(this.lampMat));
  }

  buildFeatures() {
    const gb = new GeoBuilder();
    // Sightscreens at both ends: dark behind a white ball, white behind a red one (Tests)
    const screens = new GeoBuilder();
    for (const z of [68.5, -68.5]) {
      screens.box(15, 7.5, 0.4, '#ffffff', [0, 3.75 + 0.6, z]);
      for (const x of [-6.5, 0, 6.5]) gb.box(0.25, 0.6, 0.25, '#555c66', [x, 0.3, z]);
    }
    this.sightMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: '#1d222b' });
    this.root.add(screens.build(this.sightMat));
    this.setSightscreens(this.sightKind || 'black');
    // Scoreboard structure at the +z end
    const sbZ = 86, sbY = 15;
    gb.box(30, 2, 3, '#3a414c', [0, sbY - 8.6, sbZ + 1]);
    for (const x of [-12, 12]) gb.box(1.4, sbY, 1.4, '#59626e', [x, sbY / 2 - 2, sbZ + 1]);
    gb.box(30.5, 16, 1.2, '#20252e', [0, sbY, sbZ + 0.7]);
    // Pavilion at the -z end
    const pz = -84;
    gb.box(34, 10, 14, '#e8e0cf', [0, 5, pz]);
    gb.box(34.6, 0.6, 14.6, '#c7b99a', [0, 10.3, pz]);
    for (let i = -3; i <= 3; i++) gb.box(3.2, 3.2, 0.3, '#5a7fa8', [i * 4.6, 6.2, pz + 7.05]);
    for (let i = -3; i <= 3; i++) gb.box(3.2, 2.6, 0.3, '#3c5a7e', [i * 4.6, 2.2, pz + 7.05]);
    // Pitched roof
    const roof = new THREE.CylinderGeometry(0.1, 9.6, 5, 4, 1).rotateY(Math.PI / 4).scale(2.6, 1, 1.05);
    gb.add(roof, this.S.roof, { pos: [0, 13.2, pz] });
    gb.box(0.4, 4, 0.4, '#ffffff', [0, 17.5, pz]);
    // Dugouts on both sides
    for (const side of [1, -1]) {
      const x = side * 68.5;
      gb.box(1.2, 2.4, 9, '#2c3440', [x + side * 1.6, 1.2, 0]);
      gb.box(3.6, 0.25, 9.4, '#f4f4f4', [x, 2.5, 0]);
      gb.box(1.0, 0.5, 8, '#6b4f3a', [x + side * 0.9, 0.45, 0]);
    }
    this.root.add(gb.build(this.mat));
    // Pavilion flag
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3, 6, 1), new THREE.MeshLambertMaterial({ color: '#e63946', side: THREE.DoubleSide }));
    this.flag.position.set(1.15, 19, pz);
    this.root.add(this.flag);

    // Big screens
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.scoreboard.texture, fog: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(28, 14), this.screenMat);
    screen.position.set(0, sbY, sbZ);
    screen.rotation.y = Math.PI;
    this.root.add(screen);
    const screen2 = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), this.screenMat);
    screen2.position.set(-Math.sin(90 * DEG) * 92, 20, 0);
    screen2.rotation.y = Math.PI / 2;
    this.root.add(screen2);
    const s2frame = new GeoBuilder().box(17, 9, 0.6, '#20252e', [-92.4, 20, 0]).build(this.mat);
    this.root.add(s2frame);
  }

  updateScoreboard(info) { this.scoreboard.draw(info); }

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

  /** Delivery frame orientation: 0 = bowling from the pavilion (-z) end, 1 = from the scoreboard (+z) end. */
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
    if (this.flag) {
      const p = this.flag.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 1.1; p.setZ(i, Math.sin(t * 4 + x * 2.4) * 0.12 * x); }
      p.needsUpdate = true;
    }
    if (this.scenery) this.scenery.update(dt, t);
  }
}
