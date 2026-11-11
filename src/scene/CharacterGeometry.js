// Procedural cricketer geometry (stylised-realistic), skinned to a shared 17-bone rig.
// Shapes are lofted cross-sections (superellipses) for believable anatomy and clothing;
// every vertex is weighted to one or two bones so joints bend smoothly.
// All parts are built in the rig's rest pose (standing, arms and legs straight down, facing +z).
import * as THREE from 'three';

// ------------------------------------------------------------------ rig
export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const PARENT = { hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };
export const LIMB = { upper: 0.32, fore: 0.275, hand: 0.17, thigh: 0.44, shin: 0.41, ankle: 0.075 };
export const HIP_HEIGHT = 0.98;
export const OFFSET = {
  hips: [0, HIP_HEIGHT, 0], spine: [0, 0.10, 0], chest: [0, 0.20, 0], neck: [0, 0.26, 0], head: [0, 0.08, 0],
  armL: [0.178, 0.215, 0], foreL: [0, -LIMB.upper, 0], handL: [0, -LIMB.fore, 0],
  armR: [-0.178, 0.215, 0], foreR: [0, -LIMB.upper, 0], handR: [0, -LIMB.fore, 0],
  thighL: [0.093, -0.055, 0], shinL: [0, -LIMB.thigh, 0], footL: [0, -LIMB.shin, 0],
  thighR: [-0.093, -0.055, 0], shinR: [0, -LIMB.thigh, 0], footR: [0, -LIMB.shin, 0],
};
/** Rest-pose world (root-local) position of each bone. */
export const REST = {};
for (const b of BONES) {
  const o = OFFSET[b], p = PARENT[b] ? REST[PARENT[b]] : [0, 0, 0];
  REST[b] = [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
}
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

// ------------------------------------------------------------------ shape primitives
const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

/**
 * Loft through cross-sections. axis 'y': sections {y, rx, rz, cx, cz, f, n}; axis 'z': {z, rx, ry, cx, cy}.
 * Superellipse exponent n (2 = ellipse, higher = squarer). f(angle) multiplies the radius (ridges, bulges).
 * Optional open arc a0..a1 (radians, 0 = +x, π/2 = +z for axis y / +y for axis z).
 */
export function loft(sections, { segs = 10, n = 2, axis = 'y', a0 = null, a1 = null, capStart = true, capEnd = true } = {}) {
  const open = a0 != null;
  const cols = open ? segs + 1 : segs;
  const pos = [], idx = [];
  for (const s of sections) {
    const nn = s.n ?? n, e = 2 / nn;
    for (let i = 0; i < cols; i++) {
      const a = open ? a0 + (a1 - a0) * (i / segs) : (i / segs) * Math.PI * 2;
      const m = s.f ? s.f(a) : 1;
      const u = sgnPow(Math.cos(a), e) * s.rx * m;
      const w = sgnPow(Math.sin(a), e) * (axis === 'y' ? s.rz : s.ry) * m;
      if (axis === 'y') pos.push((s.cx || 0) + u, s.y, (s.cz || 0) + w);
      else pos.push((s.cx || 0) + u, (s.cy || 0) + w, s.z);
    }
  }
  const rings = sections.length;
  for (let r = 0; r < rings - 1; r++) {
    for (let i = 0; i < (open ? segs : cols); i++) {
      const a = r * cols + i, b = r * cols + ((i + 1) % cols), c = (r + 1) * cols + i, d = (r + 1) * cols + ((i + 1) % cols);
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (r, flip) => {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < cols; i++) { cx += pos[(r * cols + i) * 3]; cy += pos[(r * cols + i) * 3 + 1]; cz += pos[(r * cols + i) * 3 + 2]; }
    const ci = pos.length / 3;
    pos.push(cx / cols, cy / cols, cz / cols);
    for (let i = 0; i < (open ? segs : cols); i++) {
      const a = r * cols + i, b = r * cols + ((i + 1) % cols);
      if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  };
  // Winding: (a, c, b) faces outward for y-ascending sections; the other cases are mirrored.
  const ascending = axis === 'y' ? sections[rings - 1].y > sections[0].y : sections[rings - 1].z > sections[0].z;
  const flipSides = axis === 'y' ? !ascending : ascending;
  if (flipSides) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  if (!open) {
    const startFlip = (axis === 'y') === ascending;
    if (capStart) cap(0, startFlip);
    if (capEnd) cap(rings - 1, !startFlip);
  }
  return { pos, idx };
}

/** Tube following a polyline (fingers, grille bars). radii: number or per-point array. */
export function tubePath(points, radii, segs = 6, { capEnd = true } = {}) {
  const P = points.map(p => new THREE.Vector3(...p));
  const R = Array.isArray(radii) ? radii : P.map(() => radii);
  const pos = [], idx = [];
  let N = null;
  for (let i = 0; i < P.length; i++) {
    const T = (i < P.length - 1 ? P[i + 1].clone().sub(P[i]) : P[i].clone().sub(P[i - 1])).normalize();
    if (!N) { N = Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); }
    N = N.clone().sub(T.clone().multiplyScalar(N.dot(T))).normalize();
    const B = new THREE.Vector3().crossVectors(T, N).normalize();
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const v = P[i].clone().addScaledVector(N, Math.cos(a) * R[i]).addScaledVector(B, Math.sin(a) * R[i]);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < segs; k++) {
    const a = i * segs + k, b = i * segs + ((k + 1) % segs), c = (i + 1) * segs + k, d = (i + 1) * segs + ((k + 1) % segs);
    idx.push(a, b, c, b, d, c);
  }
  const capAt = (i, flip) => {
    const ci = pos.length / 3;
    const end = P[i];
    pos.push(end.x, end.y, end.z);
    for (let k = 0; k < segs; k++) { const a = i * segs + k, b = i * segs + ((k + 1) % segs); if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  capAt(0, true);
  if (capEnd) capAt(P.length - 1, false);
  return { pos, idx };
}

/** Deformed sphere (heads, joints, ears). fn(unit vector) -> [x, y, z] */
export function blob(fn, ws = 14, hs = 10) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position, pos = [];
  const u = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { u.set(p.getX(i), p.getY(i), p.getZ(i)); pos.push(...fn(u)); }
  const idx = Array.from(g.index.array);
  g.dispose();
  return mergeCoincident({ pos, idx });
}

/** Ellipsoid shortcut. */
export const ellipsoid = (cx, cy, cz, rx, ry, rz, ws = 10, hs = 8) => blob(u => [cx + u.x * rx, cy + u.y * ry, cz + u.z * rz], ws, hs);

/** Box with optional rounding via a loft (rounded-rect cross-sections). */
export function roundBox(cx, cy, cz, w, h, d, n = 5, segs = 12) {
  return loft([{ y: cy - h / 2, rx: w / 2, rz: d / 2, cx, cz }, { y: cy + h / 2, rx: w / 2, rz: d / 2, cx, cz }], { segs, n });
}

// Sphere geometry has duplicated seam/pole vertices; weld them so smooth normals have no seams.
function mergeCoincident(part) {
  const map = new Map(), remap = [], pos = [];
  for (let i = 0; i < part.pos.length / 3; i++) {
    const k = `${part.pos[i * 3].toFixed(5)},${part.pos[i * 3 + 1].toFixed(5)},${part.pos[i * 3 + 2].toFixed(5)}`;
    if (!map.has(k)) { map.set(k, pos.length / 3); pos.push(part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2]); }
    remap[i] = map.get(k);
  }
  const idx = [];
  for (let t = 0; t < part.idx.length; t += 3) {
    const a = remap[part.idx[t]], b = remap[part.idx[t + 1]], c = remap[part.idx[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { pos, idx };
}

export function transformPart(part, m) {
  const v = new THREE.Vector3();
  for (let i = 0; i < part.pos.length; i += 3) {
    v.set(part.pos[i], part.pos[i + 1], part.pos[i + 2]).applyMatrix4(m);
    part.pos[i] = v.x; part.pos[i + 1] = v.y; part.pos[i + 2] = v.z;
  }
  return part;
}
export const mirrorX = part => {
  for (let i = 0; i < part.pos.length; i += 3) part.pos[i] = -part.pos[i];
  for (let t = 0; t < part.idx.length; t += 3) { const k = part.idx[t + 1]; part.idx[t + 1] = part.idx[t + 2]; part.idx[t + 2] = k; }
  return part;
};

// ------------------------------------------------------------------ skin weights
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const W = {
  one: b => () => [[BI[b], 1]],
  /** Blend toward neighbouring bones across joints. joints: [{to, c:[x,y,z], axis:[..], zone}] */
  joint: (b, joints) => p => {
    const out = [];
    let rest = 1;
    for (const j of joints) {
      const s = (p[0] - j.c[0]) * j.axis[0] + (p[1] - j.c[1]) * j.axis[1] + (p[2] - j.c[2]) * j.axis[2];
      const w = 0.5 * smooth(-j.zone, 0, s);
      if (w > 0.001) { out.push([BI[j.to], w]); rest -= w; }
    }
    return [[BI[b], rest], ...out];
  },
  /** Vertical blending through a chain of bones (torso). anchors: [[y, bone], ...] ascending */
  vertical: anchors => p => {
    const y = p[1];
    if (y <= anchors[0][0]) return [[BI[anchors[0][1]], 1]];
    for (let i = 0; i < anchors.length - 1; i++) {
      const [y0, b0] = anchors[i], [y1, b1] = anchors[i + 1];
      if (y <= y1) { const t = smooth(y0, y1, y); return [[BI[b0], 1 - t], [BI[b1], t]]; }
    }
    return [[BI[anchors[anchors.length - 1][1]], 1]];
  },
};


const DOWN = [0, -1, 0], UP = [0, 1, 0];

// Surface properties per part: [roughness, metalness]
export const RM = {
  cloth: [0.85, 0], clothSheen: [0.74, 0], skin: [0.55, 0], hair: [0.7, 0], pad: [0.58, 0], glove: [0.62, 0],
  shoe: [0.45, 0], sole: [0.9, 0], shell: [0.26, 0.06], metal: [0.32, 0.85], willow: [0.6, 0], rubber: [0.85, 0], eye: [0.25, 0],
};

/**
 * Baked ambient occlusion: darkens creases and the lower body so the characters read solid
 * and grounded without any extra rendering cost.
 */
function bakedAO(p, n) {
  let k = 0.84 + 0.16 * smooth(0.0, 0.55, p[1]);                         // nearer the ground = a bit darker
  if (p[1] < 0.95 && Math.abs(p[0]) < 0.1 && n[0] * Math.sign(p[0] || 1) < -0.25) k *= 0.84; // inner thighs
  if (p[1] > 1.18 && p[1] < 1.47 && Math.abs(p[0]) > 0.13 && Math.abs(p[0]) < 0.2 && Math.abs(n[0]) > 0.5) k *= 0.86; // armpits / torso sides
  if (p[1] > 0.95 && p[1] < 0.99) k *= 0.88;                             // shirt tucked into trousers
  if (n[1] < -0.55 && p[1] > 1.45) k *= 0.8;                             // under the chin / collar
  return k;
}

/** Accumulates parts into one skinned BufferGeometry (with colour, AO and roughness/metalness per vertex). */
class SkinBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.rm = []; this.si = []; this.sw = []; this.idx = []; }
  add(part, color, weight, { flat = false, rm = RM.cloth, ao = true } = {}) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
    g.setIndex(part.idx);
    if (flat) g = g.toNonIndexed();
    g.computeVertexNormals();
    const P = g.attributes.position, Nn = g.attributes.normal;
    const base = this.pos.length / 3;
    const c = new THREE.Color();
    for (let i = 0; i < P.count; i++) {
      const p = [P.getX(i), P.getY(i), P.getZ(i)], n = [Nn.getX(i), Nn.getY(i), Nn.getZ(i)];
      this.pos.push(...p);
      this.nrm.push(...n);
      c.set(typeof color === 'function' ? color(p) : color);
      const k = ao ? bakedAO(p, n) : 1;
      this.col.push(c.r * k, c.g * k, c.b * k);
      this.rm.push(rm[0], rm[1]);
      const ws = weight(p).filter(w => w[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = ws.reduce((s, w) => s + w[1], 0) || 1;
      for (let k2 = 0; k2 < 4; k2++) { this.si.push(ws[k2] ? ws[k2][0] : 0); this.sw.push(ws[k2] ? ws[k2][1] / sum : 0); }
    }
    if (g.index) for (const i of g.index.array) this.idx.push(base + i);
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    g.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.rm, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.6);
    return g;
  }
}

/** Static (non-skinned) part builder for attachments: headgear, bat. */
class StaticBuilder {
  constructor() { this.parts = []; }
  add(part, color, { flat = false, rm = RM.cloth } = {}) { this.parts.push({ part, color, flat, rm }); return this; }
  build() {
    const pos = [], nrm = [], col = [], rms = [], idx = [];
    const c = new THREE.Color();
    for (const { part, color, flat, rm } of this.parts) {
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
      g.setIndex(part.idx);
      if (flat) g = g.toNonIndexed();
      g.computeVertexNormals();
      const base = pos.length / 3, P = g.attributes.position, Nn = g.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        const p = [P.getX(i), P.getY(i), P.getZ(i)];
        pos.push(...p); nrm.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
        c.set(typeof color === 'function' ? color(p) : color); col.push(c.r, c.g, c.b);
        rms.push(rm[0], rm[1]);
      }
      if (g.index) for (const i of g.index.array) idx.push(base + i); else for (let i = 0; i < P.count; i++) idx.push(base + i);
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(rms, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}

export function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f < 0) c.lerp(new THREE.Color('#000000'), -f); else c.lerp(new THREE.Color('#ffffff'), f);
  return '#' + c.getHexString();
}

/** Gentle cloth folds: a few soft vertical ripples whose phase drifts with height. */
const folds = (amp, k = 5, phase = 0) => (a) => 1 + amp * Math.sin(a * k + phase);

// ------------------------------------------------------------------ the body
/**
 * kit = { shirt, trousers, trim, skin, hair, hairStyle, beard, gear: 'batter'|'keeper'|'fielder'|'umpire', quality }
 * Full-sleeved one-day kit, matching trousers, sculpted anatomy.
 */
export function buildBody(kit) {
  const hi = kit.quality !== 'low';
  const S = hi ? 18 : 10;
  const sb = new SkinBuilder();
  const { shirt, trousers, trim, skin } = kit;
  const pads = kit.gear === 'batter' || kit.gear === 'keeper';
  const umpire = kit.gear === 'umpire';

  // --- torso: V-shape, chest volume at the front, shoulder blades at the back
  const torsoF = (y) => (a) => {
    const front = Math.max(0, Math.sin(a)), back = Math.max(0, -Math.sin(a));
    const chest = smooth(1.2, 1.36, y) * (1 - smooth(1.42, 1.5, y));
    return 1 + 0.06 * front * front * chest + 0.03 * back * back * smooth(1.28, 1.42, y) + 0.008 * Math.sin(a * 6 + y * 9);
  };
  const T = (y, rx, rz, cz = 0) => ({ y, rx, rz, cz, f: torsoF(y) });
  const torsoSec = [
    T(0.972, 0.151, 0.099), T(1.04, 0.15, 0.099), T(1.12, 0.153, 0.102), T(1.2, 0.163, 0.108, 0.004),
    T(1.28, 0.176, 0.116, 0.009), T(1.35, 0.185, 0.12, 0.011), T(1.41, 0.188, 0.117, 0.008), T(1.465, 0.182, 0.106),
    T(1.51, 0.152, 0.09), { y: 1.545, rx: 0.097, rz: 0.072 }, { y: 1.57, rx: 0.066, rz: 0.058 },
  ];
  const torsoW = W.vertical([[1.0, 'hips'], [1.14, 'spine'], [1.3, 'chest']]);
  sb.add(loft(torsoSec, { segs: S + 6, n: 2.25 }), shirt, torsoW, { rm: RM.clothSheen });
  // side panels in the trim colour
  for (const side of [1, -1]) {
    const mid = side > 0 ? 0 : Math.PI;
    sb.add(loft(torsoSec.slice(0, 8).map(s => ({ ...s, rx: s.rx * 1.008, rz: s.rz * 1.008 })), { segs: 3, n: 2.25, a0: mid - 0.12, a1: mid + 0.12 }), trim, torsoW, { rm: RM.clothSheen });
  }
  // polo collar with points, placket and buttons
  const collarCol = umpire ? '#ffffff' : trim;
  sb.add(loft([{ y: 1.532, rx: 0.075, rz: 0.067 }, { y: 1.566, rx: 0.07, rz: 0.062 }, { y: 1.592, rx: 0.068, rz: 0.06 }], { segs: S, capStart: false, capEnd: false }), collarCol, W.one('chest'));
  for (const s of [1, -1]) sb.add(loft([{ z: 0.06, rx: 0.026, ry: 0.003, cx: s * 0.026, cy: 1.545 }, { z: 0.083, rx: 0.014, ry: 0.003, cx: s * 0.018, cy: 1.525 }], { axis: 'z', segs: 6, n: 2 }), collarCol, W.one('chest'));
  sb.add(roundBox(0, 1.488, 0.124, 0.032, 0.1, 0.008, 4, 6), umpire ? shade(shirt, 0.15) : trim, W.one('chest'));
  for (const y of [1.515, 1.47]) sb.add(ellipsoid(0, y, 0.13, 0.006, 0.006, 0.004, 6, 4), shade(trim, -0.35), W.one('chest'), { rm: RM.eye });
  if (umpire) sb.add(roundBox(0, 1.41, 0.124, 0.042, 0.17, 0.006, 4, 6), '#1d2433', W.one('chest'));

  // --- trousers: seat, belt, buckle
  const pelvisW = p => (p[0] >= 0 ? W.joint('hips', [{ to: 'thighL', c: [0.093, 0.88, 0], axis: DOWN, zone: 0.09 }]) : W.joint('hips', [{ to: 'thighR', c: [-0.093, 0.88, 0], axis: DOWN, zone: 0.09 }]))(p);
  sb.add(loft([
    { y: 0.83, rx: 0.142, rz: 0.1 },
    { y: 0.89, rx: 0.163, rz: 0.113, cz: -0.009, f: a => 1 + 0.03 * Math.max(0, -Math.sin(a)) },
    { y: 0.95, rx: 0.163, rz: 0.108, cz: -0.004 },
    { y: 1.0, rx: 0.155, rz: 0.102 },
    { y: 1.02, rx: 0.152, rz: 0.1 },
  ], { segs: S + 6, n: 2.35 }), trousers, pelvisW);
  sb.add(loft([{ y: 0.994, rx: 0.157, rz: 0.104 }, { y: 1.024, rx: 0.156, rz: 0.103 }], { segs: S + 6, n: 2.35, capStart: false, capEnd: false }), '#1b1c21', W.one('hips'), { rm: RM.shoe });
  sb.add(roundBox(0, 1.009, 0.104, 0.04, 0.026, 0.006, 4, 6), '#c3c7cf', W.one('hips'), { rm: RM.metal });

  // --- neck
  sb.add(loft([{ y: 1.5, rx: 0.055, rz: 0.059 }, { y: 1.59, rx: 0.051, rz: 0.055 }, { y: 1.66, rx: 0.049, rz: 0.051, cz: 0.006 }], { segs: S, capStart: false }), skin,
    W.vertical([[1.53, 'chest'], [1.58, 'neck'], [1.64, 'head']]), { rm: RM.skin });

  buildHead(sb, kit, S);

  // --- arms in long sleeves
  for (const side of [1, -1]) {
    const L = side > 0 ? 'L' : 'R';
    const [sx, sy] = REST['arm' + L];
    const ey = sy - LIMB.upper, wy = ey - LIMB.fore;
    const armW = W.joint('arm' + L, [
      { to: 'chest', c: [sx, sy, 0], axis: UP, zone: 0.065 },
      { to: 'fore' + L, c: [sx, ey, 0], axis: DOWN, zone: 0.06 },
    ]);
    const foreW = W.joint('fore' + L, [
      { to: 'arm' + L, c: [sx, ey, 0], axis: UP, zone: 0.06 },
      { to: 'hand' + L, c: [sx, wy, 0], axis: DOWN, zone: 0.03 },
    ]);
    // shoulder (deltoid) under the sleeve
    sb.add(ellipsoid(sx - side * 0.006, sy - 0.002, 0, 0.062, 0.066, 0.068, S, 10), shirt, W.joint('arm' + L, [{ to: 'chest', c: [sx, sy + 0.03, 0], axis: UP, zone: 0.07 }]), { rm: RM.clothSheen });
    const ku = LIMB.upper / 0.29, kf = LIMB.fore / 0.26;   // sections were laid out for a 0.29 / 0.26 arm
    const A = (dy, rx, rz, cz = 0, amp = 0.012) => ({ y: sy + dy * ku, rx, rz, cx: sx, cz, f: folds(amp, 4, dy * 30) });
    sb.add(loft([A(0.01, 0.066, 0.069), A(-0.05, 0.068, 0.073), A(-0.12, 0.064, 0.07, 0.004), A(-0.2, 0.059, 0.063, 0.002), A(-0.265, 0.053, 0.055), A(-(LIMB.upper + 0.005) / ku, 0.051, 0.052)],
      { segs: S, capStart: false, capEnd: false }), shirt, armW, { rm: RM.clothSheen });
    // elbow and sleeve on the forearm, with a trim cuff
    sb.add(ellipsoid(sx, ey, -0.003, 0.051, 0.048, 0.052, S, 8), shirt, W.joint('fore' + L, [{ to: 'arm' + L, c: [sx, ey, 0], axis: UP, zone: 0.05 }]), { rm: RM.clothSheen });
    const F = (dy, rx, rz, cz = 0, amp = 0.014) => ({ y: ey + dy * kf, rx, rz, cx: sx, cz, f: folds(amp, 3, dy * 40) });
    sb.add(loft([F(0.01, 0.051, 0.052), F(-0.05, 0.054, 0.052, 0.003), F(-0.12, 0.049, 0.045, 0.001), F(-0.2, 0.042, 0.038), F(-0.238, 0.039, 0.035, 0, 0.004)],
      { segs: S, capStart: false, capEnd: false }), shirt, foreW, { rm: RM.clothSheen });
    sb.add(loft([{ y: ey - 0.232 * kf, rx: 0.0405, rz: 0.0365, cx: sx }, { y: ey - 0.256 * kf, rx: 0.038, rz: 0.034, cx: sx }], { segs: S, capStart: false }), umpire ? shade(shirt, -0.1) : trim, foreW, { rm: RM.clothSheen });
    sb.add(loft([{ y: wy + 0.012, rx: 0.031, rz: 0.026, cx: sx }, { y: wy - 0.01, rx: 0.03, rz: 0.025, cx: sx }], { segs: S, capStart: false, capEnd: false }), skin, foreW, { rm: RM.skin });
    if (kit.gear === 'batter' && side > 0) {   // arm guard on the front forearm
      sb.add(loft([{ y: ey - 0.045 * kf, rx: 0.062, rz: 0.06, cx: sx, cz: 0.004 }, { y: ey - 0.1 * kf, rx: 0.06, rz: 0.057, cx: sx, cz: 0.003 }, { y: ey - 0.17 * kf, rx: 0.051, rz: 0.047, cx: sx }], { segs: S }), '#f3f3ef', foreW, { rm: RM.pad });
    }
    buildHand(sb, kit, side, sx, wy, S);
  }

  // --- legs
  for (const side of [1, -1]) {
    const L = side > 0 ? 'L' : 'R';
    const [hx, hy] = REST['thigh' + L];
    const ky = hy - LIMB.thigh, ay = ky - LIMB.shin;
    const thighW = W.joint('thigh' + L, [
      { to: 'hips', c: [hx, hy - 0.03, 0], axis: UP, zone: 0.08 },
      { to: 'shin' + L, c: [hx, ky, 0], axis: DOWN, zone: 0.07 },
    ]);
    const Th = (y, rx, rz, cz = 0) => ({ y, rx, rz, cx: hx, cz, f: folds(0.012, 3, y * 20) });
    const thighSec = [Th(hy + 0.04, 0.088, 0.096), Th(hy - 0.04, 0.092, 0.1, -0.003), Th(hy - 0.14, 0.087, 0.094, 0.003), Th(hy - 0.26, 0.079, 0.084, 0.004), Th(hy - 0.36, 0.069, 0.073, 0.004), Th(ky + 0.01, 0.064, 0.068, 0.006)];
    sb.add(loft(thighSec, { segs: S, capStart: false, capEnd: false }), trousers, thighW);
    if (!umpire) {
      const mid = side > 0 ? 0 : Math.PI;
      sb.add(loft(thighSec.slice(1, 5).map(s => ({ ...s, rx: s.rx * 1.012, rz: s.rz * 1.012 })), { segs: 2, a0: mid - 0.09, a1: mid + 0.09 }), trim, thighW);
    }
    sb.add(ellipsoid(hx, ky, 0.008, 0.063, 0.058, 0.068, S, 8), trousers, W.joint('shin' + L, [{ to: 'thigh' + L, c: [hx, ky, 0], axis: UP, zone: 0.05 }]));
    const shinW = W.joint('shin' + L, [
      { to: 'thigh' + L, c: [hx, ky, 0], axis: UP, zone: 0.07 },
      { to: 'foot' + L, c: [hx, ay, 0], axis: DOWN, zone: 0.03 },
    ]);
    const Sh = (y, rx, rz, cz = 0) => ({ y, rx, rz, cx: hx, cz, f: folds(0.014, 3, y * 25) });
    sb.add(loft([Sh(ky, 0.062, 0.066, 0.004), Sh(ky - 0.08, 0.061, 0.069, -0.006), Sh(ky - 0.17, 0.058, 0.069, -0.011), Sh(ky - 0.27, 0.05, 0.055, -0.004), Sh(ay + 0.06, 0.047, 0.049), Sh(ay + 0.02, 0.055, 0.06, 0.004)],
      { segs: S, capStart: false }), trousers, shinW);
    if (pads) buildPad(sb, kit, hx, ky, ay, shinW, S);
    if (kit.gear === 'batter' && side > 0) {   // thigh guard on the front thigh
      sb.add(loft([{ y: hy - 0.08, rx: 0.1, rz: 0.108, cx: hx }, { y: hy - 0.2, rx: 0.097, rz: 0.102, cx: hx }, { y: hy - 0.3, rx: 0.087, rz: 0.092, cx: hx }],
        { segs: 6, a0: -0.3, a1: Math.PI * 0.75 }), '#f2f2ee', thighW, { rm: RM.pad });
    }
    buildShoe(sb, kit, hx, ay, W.joint('foot' + L, [{ to: 'shin' + L, c: [hx, ay + 0.02, 0], axis: UP, zone: 0.03 }]), S);
  }
  return sb.build();
}

function buildHead(sb, kit, S) {
  const { skin } = kit;
  const hc = [0, REST.head[1] + 0.105, 0.004];
  const RX = 0.086, RY = 0.112, RZ = 0.097;
  const headW = W.joint('head', [{ to: 'neck', c: [0, REST.head[1] + 0.01, 0], axis: DOWN, zone: 0.04 }]);
  const stubble = kit.beard === 'stubble' ? shade(skin, -0.18) : kit.beard === 'beard' ? shade(kit.hair, 0.25) : null;
  const shapeHead = u => {
    let x = u.x, y = u.y, z = u.z;
    const t = Math.min(1, Math.max(0, (-y - 0.1) / 0.9));
    x *= 1 - 0.26 * t;                                            // jaw taper
    z *= z > 0 ? 1 - 0.07 * t : 1 - 0.42 * t;
    if (z > 0.55 && y > 0.05) z *= 0.97;                          // forehead
    if (y > -0.25 && y < 0.15 && z > 0.3) x *= 1.04;              // cheekbones
    if (z < -0.3 && y > -0.25) z *= 1.07;                         // back of the skull
    if (y > 0.05 && y < 0.25 && z > 0.6 && Math.abs(x) < 0.55) z *= 1 - 0.035 * (1 - Math.abs(x) / 0.55); // eye sockets
    let cz = 0;
    if (y < -0.55 && z > 0.35) cz = 0.008;
    return [hc[0] + x * RX, hc[1] + y * RY, hc[2] + z * RZ + cz];
  };
  // Facial hair is shading on the skin: jaw, chin and upper lip only, fading out softly towards the
  // cheeks and ears (stubble is a light tint, a beard is denser).
  const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const cSkin = new THREE.Color(skin), cHair = stubble && new THREE.Color(stubble), cMix = new THREE.Color();
  const density = kit.beard === 'beard' ? 0.92 : 0.42;
  const headColor = stubble ? p => {
    const dy = p[1] - hc[1], dz = p[2] - hc[2], dx = Math.abs(p[0]);
    let w = sstep(-0.034, -0.062, dy) * sstep(-0.035, 0.015, dz);          // below the cheekbones, in front of the ears
    w *= 1 - 0.6 * sstep(-0.05, -0.03, dy) * sstep(0.03, 0.05, dx);        // keep the cheeks clear
    const lip = dy < -0.043 && dy > -0.054 && dx < 0.026 && dz > 0.07 ? 1 : 0;   // moustache over the lip
    w = Math.max(w, lip * 0.85);
    return '#' + cMix.copy(cSkin).lerp(cHair, w * density).getHexString();
  } : skin;
  sb.add(blob(shapeHead, S + 6, S + 2), headColor, headW, { rm: RM.skin });
  const fy = hc[1];
  sb.add(loft([{ z: 0.088, rx: 0.012, ry: 0.019, cy: fy - 0.014 }, { z: 0.099, rx: 0.0095, ry: 0.013, cy: fy - 0.021 }, { z: 0.106, rx: 0.0055, ry: 0.006, cy: fy - 0.027 }], { axis: 'z', segs: 8, n: 2 }), shade(skin, -0.03), headW, { rm: RM.skin });
  for (const s of [1, -1]) {
    sb.add(ellipsoid(s * 0.031, fy + 0.012, 0.0855, 0.0105, 0.0062, 0.0065, 8, 6), '#ddd6cb', headW, { rm: RM.eye, ao: false });
    sb.add(ellipsoid(s * 0.0305, fy + 0.012, 0.0905, 0.005, 0.005, 0.0032, 6, 4), '#2a1b12', headW, { rm: RM.eye, ao: false });
    sb.add(roundBox(s * 0.032, fy + 0.03, 0.09, 0.032, 0.007, 0.012, 4, 6), shade(kit.hair, 0.05), headW, { rm: RM.hair });
    sb.add(ellipsoid(s * 0.086, fy, -0.006, 0.012, 0.027, 0.02, 8, 6), shade(skin, -0.06), headW, { rm: RM.skin });
  }
  const lips = '#' + new THREE.Color(skin).lerp(new THREE.Color('#8a3f38'), 0.4).multiplyScalar(kit.beard === 'beard' ? 0.62 : 0.8).getHexString();
  sb.add(roundBox(0, fy - 0.057, 0.084, 0.03, 0.0055, 0.008, 4, 6), lips, headW, { rm: RM.skin });
  const style = kit.hairStyle;
  if (style !== 'bald') {
    const scale = style === 'buzz' ? 1.03 : style === 'curly' ? 1.09 : 1.06;
    const cut = style === 'long' ? -0.25 : 0.0;
    sb.add(blob(u => {
      const hl = cut + (u.z > 0 ? 0.22 * u.z : 0.35 * u.z);
      const bump = style === 'curly' ? 1 + 0.035 * Math.sin(u.x * 23) * Math.sin(u.z * 19) * Math.sin(u.y * 17) : 1;
      return shapeHead({ x: u.x * scale * bump, y: Math.max(u.y, hl) * scale, z: u.z * scale * bump });
    }, S + 6, S + 2), kit.hair, headW, { rm: RM.hair });
  }
}

function buildHand(sb, kit, side, sx, wy, S) {
  const L = side > 0 ? 'L' : 'R';
  const handW = W.joint('hand' + L, [{ to: 'fore' + L, c: [sx, wy, 0], axis: UP, zone: 0.025 }]);
  const gear = kit.gear;
  const batGlove = gear === 'batter';
  const keepGlove = gear === 'keeper';
  const col = batGlove ? '#f4f4f0' : keepGlove ? '#f1f1ec' : kit.skin;
  const accent = batGlove || keepGlove ? kit.shirt : null;
  const rm = batGlove || keepGlove ? RM.glove : RM.skin;
  const k = batGlove ? 1.18 : keepGlove ? 1.5 : 1;
  const inward = -side;
  sb.add(loft([
    { y: wy + 0.005, rx: 0.018 * k, rz: 0.03 * k, cx: sx },
    { y: wy - 0.03, rx: 0.021 * k, rz: 0.04 * k, cx: sx },
    { y: wy - 0.075, rx: 0.018 * k, rz: 0.043 * k, cx: sx },
    { y: wy - 0.088, rx: 0.015 * k, rz: 0.041 * k, cx: sx },
  ], { segs: S, n: 2.6 }), col, handW, { rm });
  if (accent) {   // coloured cuff and back-of-hand panel
    sb.add(loft([{ y: wy + 0.032, rx: 0.031 * k, rz: 0.036 * k, cx: sx }, { y: wy - 0.012, rx: 0.028 * k, rz: 0.04 * k, cx: sx }], { segs: S, n: 2.6 }), accent, handW, { rm });
    sb.add(loft([{ y: wy - 0.02, rx: 0.0225 * k, rz: 0.035 * k, cx: sx }, { y: wy - 0.07, rx: 0.0195 * k, rz: 0.038 * k, cx: sx }], { segs: 4, n: 2.6, a0: side > 0 ? -0.6 : Math.PI - 0.6, a1: side > 0 ? 0.6 : Math.PI + 0.6 }), accent, handW, { rm });
  }
  if (kit.quality === 'low') return;
  const curl = batGlove ? 1.0 : keepGlove ? 0.45 : 0.55;
  const fr = batGlove ? 0.011 : keepGlove ? 0.016 : 0.0085;
  const zs = [0.029, 0.01, -0.009, -0.027];
  const lens = [0.07, 0.078, 0.074, 0.06];
  zs.forEach((z, i) => {
    const len = lens[i] * (keepGlove ? 1.15 : 1);
    const base = [sx, wy - 0.085, z * k];
    const a1 = 0.35 * curl, a2 = 0.95 * curl;
    const p1 = [base[0] + inward * Math.sin(a1) * len * 0.5, base[1] - Math.cos(a1) * len * 0.5, base[2]];
    const p2 = [p1[0] + inward * Math.sin(a2) * len * 0.5, p1[1] - Math.cos(a2) * len * 0.5, base[2]];
    const radii = batGlove ? [fr, fr * 1.12, fr * 0.95, fr * 1.05, fr * 0.85] : [fr, fr * 0.95, fr * 0.8];
    const pts = batGlove ? [base, [(base[0] + p1[0]) / 2, (base[1] + p1[1]) / 2, z * k], p1, [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, z * k], p2] : [base, p1, p2];
    sb.add(tubePath(pts, radii, 7), col, handW, { rm });
  });
  const tb = [sx + inward * 0.008, wy - 0.025, 0.035 * k];
  sb.add(tubePath([tb, [sx + inward * 0.016, wy - 0.05, 0.052 * k], [sx + inward * 0.024, wy - 0.075, 0.056 * k]], [fr * 1.15, fr * 1.05, fr * 0.9], 7), col, handW, { rm });
  if (keepGlove) sb.add(roundBox(sx + inward * 0.012, wy - 0.065, 0.045 * k, 0.012, 0.05, 0.03, 3, 6), col, handW, { rm });
}

/** Batting pads: tall white pads with six bolsters, a knee roll, side wings, coloured accents and straps. */
function buildPad(sb, kit, hx, ky, ay, shinW, S) {
  const white = '#f6f6f1';
  const keeper = kit.gear === 'keeper';
  const accent = kit.shirt;
  const strap = shade(kit.shirt, -0.35);
  const ridge = a => 1 + 0.06 * Math.pow(Math.abs(Math.cos(a * 3)), 2.5);
  const a0 = -0.45, a1 = Math.PI + 0.45;                         // front and both wings, open at the back
  const top = keeper ? ky + 0.1 : ky + 0.18;
  const sec = (y, r, cz = 0.02) => ({ y, rx: r * 1.02, rz: r, cx: hx, cz, f: ridge });
  const padSecs = [
    sec(ay + 0.04, 0.058, 0.004), sec(ay + 0.075, 0.077, 0.022), sec(ay + 0.16, 0.083, 0.026), sec(ky - 0.2, 0.089, 0.025),
    sec(ky - 0.06, 0.091, 0.027), sec(ky + 0.02, 0.1, 0.032), sec(ky + 0.07, 0.097, 0.03),
    sec(top - 0.04, 0.09, 0.022), sec(top - 0.008, 0.075, 0.01), sec(top + 0.004, 0.064, 0.004),
  ];
  sb.add(loft(padSecs, { segs: S >= 12 ? 18 : 10, a0, a1 }), white, shinW, { rm: RM.pad });
  // coloured accent lines down the outer bolsters
  for (const ac of [Math.PI / 2 - 0.62, Math.PI / 2 + 0.62]) {
    sb.add(loft(padSecs.slice(1, 6).map(s => ({ ...s, rx: s.rx * 1.035, rz: s.rz * 1.035 })), { segs: 2, a0: ac - 0.05, a1: ac + 0.05 }), accent, shinW, { rm: RM.pad });
  }
  // knee roll: a rounded bolster across the knee
  const roll = [];
  for (let i = 0; i <= 10; i++) { const a = a0 + 0.2 + (i / 10) * (a1 - a0 - 0.4); roll.push([hx + Math.cos(a) * 0.104, ky + 0.045, 0.032 + Math.sin(a) * 0.104]); }
  sb.add(tubePath(roll, 0.016, 7), white, shinW, { rm: RM.pad });
  // straps and buckles around the back of the leg
  for (const y of [ay + 0.11, ky - 0.14, ky + 0.11]) {
    sb.add(loft([{ y: y - 0.014, rx: 0.071, rz: 0.076, cx: hx }, { y: y + 0.014, rx: 0.071, rz: 0.076, cx: hx }], { segs: 8, a0: Math.PI + 0.3, a1: Math.PI * 2 - 0.3 }), strap, shinW, { rm: RM.rubber });
    sb.add(roundBox(hx + (hx > 0 ? 0.08 : -0.08), y, -0.02, 0.012, 0.03, 0.02, 3, 6), '#c9ccd3', shinW, { rm: RM.metal });
  }
}

function buildShoe(sb, kit, hx, ay, footW, S) {
  const ump = kit.gear === 'umpire';
  const upper = ump ? '#1c1d22' : '#f4f4f1';
  const accent = ump ? '#2a2b30' : kit.shirt;
  const sole = ump ? '#3a3a3a' : '#5a5e66';
  sb.add(loft([
    { z: -0.072, rx: 0.038, ry: 0.034, cx: hx, cy: 0.06 },
    { z: -0.055, rx: 0.046, ry: 0.044, cx: hx, cy: 0.058 },
    { z: 0.0, rx: 0.05, ry: 0.048, cx: hx, cy: 0.055 },
    { z: 0.07, rx: 0.052, ry: 0.036, cx: hx, cy: 0.043 },
    { z: 0.14, rx: 0.048, ry: 0.026, cx: hx, cy: 0.034 },
    { z: 0.185, rx: 0.034, ry: 0.019, cx: hx, cy: 0.03 },
  ], { axis: 'z', segs: S, n: 2.8 }), upper, footW, { rm: RM.shoe });
  sb.add(loft([
    { z: -0.078, rx: 0.041, ry: 0.013, cx: hx, cy: 0.013 },
    { z: 0.0, rx: 0.05, ry: 0.012, cx: hx, cy: 0.012 },
    { z: 0.12, rx: 0.053, ry: 0.011, cx: hx, cy: 0.011 },
    { z: 0.192, rx: 0.035, ry: 0.01, cx: hx, cy: 0.012 },
  ], { axis: 'z', segs: S, n: 4 }), sole, footW, { rm: RM.sole });
  for (const z of [-0.05, 0.03, 0.1, 0.16]) for (const dx of [-0.025, 0.025]) sb.add(ellipsoid(hx + dx, 0.002, z, 0.006, 0.006, 0.006, 5, 3), '#8a8e96', footW, { rm: RM.metal, ao: false });
  const out = hx > 0 ? 1 : -1;
  sb.add(loft([{ z: -0.04, rx: 0.051, ry: 0.013, cx: hx, cy: 0.054 }, { z: 0.09, rx: 0.051, ry: 0.009, cx: hx, cy: 0.038 }], { axis: 'z', segs: 2, a0: out > 0 ? -0.55 : Math.PI - 0.55, a1: out > 0 ? 0.55 : Math.PI + 0.55 }), accent, footW, { rm: RM.shoe });
  sb.add(roundBox(hx, 0.088, 0.045, 0.03, 0.006, 0.07, 3, 6), shade(upper, -0.15), footW, { rm: RM.shoe });
}

// ------------------------------------------------------------------ attachments (static, parented to bones)
const headCentre = () => [0, 0.105, 0.004];

/** Batting / keeping helmet: glossy shell with a peak, ear guards, stem guards and a metal grille. */
export function buildHelmet(shell, stripe, quality = 'high') {
  const S = quality === 'low' ? 12 : 20;
  const b = new StaticBuilder();
  const [cx, cy, cz] = headCentre();
  b.add(blob(u => {
    const y = Math.max(u.y, u.z > 0.4 ? 0.12 : -0.42 - 0.22 * Math.max(0, -u.z));
    return [cx + u.x * 0.108, cy + 0.014 + y * 0.128, cz - 0.004 + u.z * 0.118];
  }, S + 2, S - 2), shell, { rm: RM.shell });
  const arc = [];
  for (let i = 0; i <= 12; i++) { const a = 0.35 + (i / 12) * 2.45; arc.push([cx, cy + 0.017 + Math.sin(a) * 0.131, cz + Math.cos(a) * 0.12]); }
  b.add(tubePath(arc, 0.007, 7), stripe, { rm: RM.shell });
  b.add(loft([{ z: cz + 0.088, rx: 0.104, ry: 0.006, cx, cy: cy + 0.052 }, { z: cz + 0.125, rx: 0.098, ry: 0.005, cx, cy: cy + 0.044 }, { z: cz + 0.155, rx: 0.084, ry: 0.004, cx, cy: cy + 0.035 }], { axis: 'z', segs: 14, n: 3 }), shell, { rm: RM.shell });
  const metal = '#3b3f47';
  for (const [dy, r] of [[-0.03, 0.132], [-0.06, 0.128], [-0.09, 0.117], [-0.115, 0.1]]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const a = -1.2 + (i / 10) * 2.4; pts.push([cx + Math.sin(a) * r * 0.86, cy + dy, cz + Math.cos(a) * r]); }
    b.add(tubePath(pts, 0.0042, 6), metal, { rm: RM.metal });
  }
  for (const x of [-0.034, 0, 0.034]) b.add(tubePath([[cx + x, cy + 0.045, cz + 0.128], [cx + x, cy - 0.04, cz + 0.132], [cx + x * 0.85, cy - 0.112, cz + 0.098]], 0.004, 6), metal, { rm: RM.metal });
  for (const s of [1, -1]) {
    b.add(ellipsoid(cx + s * 0.101, cy - 0.02, cz + 0.012, 0.015, 0.048, 0.042, 10, 8), shell, { rm: RM.shell });
    b.add(roundBox(cx + s * 0.052, cy - 0.125, cz - 0.07, 0.04, 0.06, 0.015, 4, 6), shade(shell, -0.25), { rm: RM.glove });   // neck/stem guards
  }
  return b.build();
}

export function buildCap(crown, brim, quality = 'high') {
  const S = quality === 'low' ? 12 : 18;
  const b = new StaticBuilder();
  const [cx, cy, cz] = headCentre();
  b.add(blob(u => {
    const y = Math.max(u.y, 0.12 + 0.12 * u.z);
    return [cx + u.x * 0.1, cy + 0.014 + y * 0.124, cz + u.z * 0.11];
  }, S + 2, S - 2), crown, { rm: RM.cloth });
  b.add(loft([
    { z: cz + 0.075, rx: 0.088, ry: 0.005, cx, cy: cy + 0.042 },
    { z: cz + 0.13, rx: 0.08, ry: 0.004, cx, cy: cy + 0.032 },
    { z: cz + 0.165, rx: 0.06, ry: 0.003, cx, cy: cy + 0.024 },
  ], { axis: 'z', segs: 12, n: 2.4 }), brim, { rm: RM.cloth });
  b.add(ellipsoid(cx, cy + 0.137, cz, 0.012, 0.007, 0.012, 6, 4), brim, { rm: RM.cloth });
  return b.build();
}

export function buildUmpireHat(quality = 'high') {
  const S = quality === 'low' ? 12 : 22;
  const b = new StaticBuilder();
  const [cx, cy, cz] = headCentre();
  const cream = '#f1ece0';
  b.add(loft([{ y: cy + 0.032, rx: 0.21, rz: 0.22, cx, cz }, { y: cy + 0.052, rx: 0.12, rz: 0.13, cx, cz }], { segs: S, capStart: true, capEnd: false }), cream, { rm: RM.cloth });
  b.add(loft([{ y: cy + 0.052, rx: 0.21, rz: 0.22, cx, cz }, { y: cy + 0.034, rx: 0.212, rz: 0.222, cx, cz }], { segs: S, capStart: false, capEnd: false }), shade(cream, -0.1), { rm: RM.cloth });
  b.add(loft([{ y: cy + 0.046, rx: 0.101, rz: 0.111, cx, cz }, { y: cy + 0.076, rx: 0.1, rz: 0.11, cx, cz }], { segs: S, capStart: false, capEnd: false }), '#24262c', { rm: RM.cloth });
  b.add(loft([{ y: cy + 0.075, rx: 0.098, rz: 0.108, cx, cz }, { y: cy + 0.128, rx: 0.091, rz: 0.1, cx, cz }, { y: cy + 0.142, rx: 0.06, rz: 0.07, cx, cz }], { segs: S }), cream, { rm: RM.cloth });
  return b.build();
}

/** Cricket bat: rubber grip, splice, shoulders, blade with a ridged spine and rounded toe. Origin at the top of the handle, blade along -y, face +z. */
export function buildBat(grip = '#1f2126', quality = 'high') {
  const b = new StaticBuilder();
  const willow = '#e8d09c', edge = '#d3b67d';
  const n = quality === 'low' ? 8 : 12;
  const handle = [];
  for (let i = 0; i <= 14; i++) { const y = -i * 0.0205; handle.push({ y, rx: 0.0178 + (i % 2) * 0.0013, rz: 0.0178 + (i % 2) * 0.0013 }); }
  b.add(loft(handle, { segs: n }), grip, { rm: RM.rubber });
  b.add(ellipsoid(0, 0.002, 0, 0.019, 0.01, 0.019, 8, 4), shade(grip, 0.1), { rm: RM.rubber });
  const blade = (y, half, spine, edgeT) => ({ y, rx: half, spine, edgeT });
  const secs = [blade(-0.29, 0.03, 0.03, 0.018), blade(-0.32, 0.052, 0.034, 0.02), blade(-0.42, 0.054, 0.04, 0.02), blade(-0.58, 0.054, 0.058, 0.022), blade(-0.72, 0.054, 0.055, 0.024), blade(-0.82, 0.053, 0.042, 0.024), blade(-0.85, 0.046, 0.032, 0.022)];
  const segs = quality === 'low' ? 12 : 20;
  const pos = [], idx = [];
  for (const s of secs) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const x = sgnPow(c, 0.5) * s.rx;
      const t = 1 - (x / s.rx) ** 2;
      const z = sn >= 0 ? sgnPow(sn, 0.35) * 0.012 : -(s.edgeT * 0.5 + (s.spine - s.edgeT * 0.5) * t) * sgnPow(-sn, 0.6);
      pos.push(x, s.y, z);
    }
  }
  for (let r = 0; r < secs.length - 1; r++) for (let i = 0; i < segs; i++) {
    const a = r * segs + i, bb = r * segs + ((i + 1) % segs), c2 = (r + 1) * segs + i, d = (r + 1) * segs + ((i + 1) % segs);
    idx.push(a, bb, c2, bb, d, c2);
  }
  const capC = (r, flip) => { const ci = pos.length / 3; pos.push(0, secs[r].y, -0.01); for (let i = 0; i < segs; i++) { const a = r * segs + i, bb = r * segs + ((i + 1) % segs); if (flip) idx.push(ci, bb, a); else idx.push(ci, a, bb); } };
  capC(0, true); capC(secs.length - 1, false);
  b.add({ pos, idx }, p => (Math.abs(p[0]) > 0.048 ? edge : willow), { rm: RM.willow });
  b.add(roundBox(0, -0.335, 0.004, 0.02, 0.07, 0.03, 3, 6), shade(willow, -0.08), { rm: RM.willow });
  b.add(roundBox(0, -0.4, 0.0125, 0.096, 0.05, 0.002, 6, 8), grip, { rm: RM.shell });
  b.add(roundBox(0, -0.8, 0.0125, 0.096, 0.03, 0.002, 6, 8), shade(grip, 0.25), { rm: RM.shell });
  return b.build();
}
