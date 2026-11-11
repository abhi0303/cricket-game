// The match ball: stitched leather (white for limited overs, red for Tests) that picks up a little mud,
// grass and scuffing as it gets older. One material is shared by the ball in flight and the balls in the
// players' hands, and redrawn only when the ball type or its wear changes noticeably.
//
// The ball is the 3D model in assets/models/ball/ ("Cricket Ball (Sports)" and "Cricket Ball (Sports) (White)" by
// Rohit Pawar, CC BY 4.0; slimmed by scripts/ball-model.html): the leather sphere with its own texture and the
// raised stitching. Until it has loaded (or if it can't be), a ball painted here stands in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL = { glb: 'assets/models/ball/ball.glb', red: 'assets/models/ball/red.jpg', white: 'assets/models/ball/white.jpg', size: 1024 };
const THREAD = { red: ['#fff0d2', '#c9b48e'], white: ['#ffe9c2', '#c2ab83'] };   // the stitching, new and old

const W = 512, H = 256;           // equirectangular: the seam runs round the equator (v = 0.5)
const STYLE = {
  red:   { leather: '#a8161f', aged: '#7a1d19', thread: '#f1ece2', groove: '#4a0b0e', scuff: '255,225,210', roughness: [0.3, 0.72] },
  white: { leather: '#f6f4ec', aged: '#e3dccb', thread: '#a69f90', groove: '#8f8879', scuff: '120,105,85', roughness: [0.42, 0.75] },
};

/** How worn the ball looks (0 new .. 1 old) after `overs`: a red ball over 80 overs, a white one over 25. */
export function ballWear(kind, overs) {
  return Math.max(0, Math.min(1, kind === 'red' ? overs / 80 : overs / 25));
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const mix = (a, b, t) => {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
};

/** Paint the leather, seam, stitching, quarter seams and (with wear) light mud, grass and scuffs. */
function paint(colorCtx, bumpCtx, kind, wear) {
  const S = STYLE[kind], g = colorCtx, b = bumpCtx, r = rng(kind === 'red' ? 7 : 11);
  // leather, with a fine grain
  g.fillStyle = mix(S.leather, S.aged, wear * 0.55);
  g.fillRect(0, 0, W, H);
  b.fillStyle = '#808080'; b.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const x = r() * W, y = r() * H, d = r() < 0.5;
    g.fillStyle = d ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    g.fillRect(x, y, 1.5, 1.5);
    b.fillStyle = d ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
    b.fillRect(x, y, 1.5, 1.5);
  }
  // quarter seams: a fine line over each half, at right angles to each other
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1.2;
  b.strokeStyle = '#5a5a5a'; b.lineWidth = 1.5;
  for (const [x, y0, y1] of [[W * 0.25, 0, H * 0.45], [W * 0.75, H * 0.55, H]]) {
    for (const c of [g, b]) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke(); }
  }
  // the main seam: a raised band with a groove in the middle and three rows of stitches either side
  const cy = H / 2, half = 9;
  g.fillStyle = mix(S.leather, S.groove, 0.25); g.fillRect(0, cy - half, W, half * 2);
  b.fillStyle = '#d0d0d0'; b.fillRect(0, cy - half, W, half * 2);
  g.fillStyle = S.groove; g.fillRect(0, cy - 0.9, W, 1.8);
  b.fillStyle = '#303030'; b.fillRect(0, cy - 1, W, 2);
  g.strokeStyle = S.thread; g.lineCap = 'round';
  b.strokeStyle = '#ffffff'; b.lineCap = 'round';
  const step = W / 84;
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      const y = cy + side * (2.6 + row * 2.2);
      g.lineWidth = 1.25; b.lineWidth = 1.5;
      for (let i = 0; i < 84; i++) {
        const x = i * step + (row % 2) * step * 0.5;
        for (const c of [g, b]) { c.beginPath(); c.moveTo(x - 1.6, y - side * 0.8); c.lineTo(x + 1.6, y + side * 0.8); c.stroke(); }
      }
    }
  }
  // maker's stamp: a small gold oval (no lettering)
  g.strokeStyle = 'rgba(212,175,55,0.75)'; g.lineWidth = 1.4;
  g.beginPath(); g.ellipse(W * 0.12, H * 0.3, 18, 8, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(212,175,55,0.55)';
  for (let i = -2; i <= 2; i++) g.fillRect(W * 0.12 + i * 5 - 1.5, H * 0.3 - 1, 3, 2);

  paintWear(g, W, H, 1, S, wear);
}

/** Wear, kept light: scuffed patches, specks of mud, a few grass smears. k scales the marks to the canvas. */
function paintWear(g, W, H, k, S, wear) {
  if (wear > 0.01) {
    const wr = rng(97);
    for (let i = 0; i < 26; i++) {
      const x = wr() * W, y = wr() * H, rad = (6 + wr() * 22) * k;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(${S.scuff},${(0.16 * wear).toFixed(3)})`); grd.addColorStop(1, `rgba(${S.scuff},0)`);
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const mud = Math.round(70 * wear);
    for (let i = 0; i < mud; i++) {
      const x = wr() * W, y = wr() * H;
      g.fillStyle = `rgba(104,74,44,${(0.12 + 0.16 * wr()) * wear})`;
      g.beginPath(); g.ellipse(x, y, (1 + wr() * 3.5) * k, (0.8 + wr() * 2) * k, wr() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    const grass = Math.round(18 * wear);
    g.lineCap = 'round';
    for (let i = 0; i < grass; i++) {
      const x = wr() * W, y = wr() * H, len = (6 + wr() * 18) * k, a = wr() * Math.PI;
      g.strokeStyle = `rgba(78,124,46,${(0.1 + 0.12 * wr()) * wear})`; g.lineWidth = (1.5 + wr() * 2.5) * k;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
  }
}

let mat = null, colorCanvas = null, bumpCanvas = null, current = { kind: null, wear: -1 };
let model = null, loading = null, leatherMat = null, threadMat = null, leatherCanvas = null, env = null;
const balls = [];                  // ball meshes to fit with the model (weak, so finished players can go)
const geoCache = new Map();        // radius -> { leather, stitches }

/** The shared ball material (created on first use): the painted stand-in until the model is in. */
export function ballMaterial() {
  if (model) return leatherMat;
  if (mat) return mat;
  colorCanvas = document.createElement('canvas'); colorCanvas.width = W; colorCanvas.height = H;
  bumpCanvas = document.createElement('canvas'); bumpCanvas.width = W; bumpCanvas.height = H;
  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  mat = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.2, roughness: 0.4, metalness: 0, envMapIntensity: 0.55 });
  setBallLook('white', 0);
  loadModel();
  return mat;
}

/**
 * A ball mesh (sphere of `radius` m, centred, seam round its equator like the model) to be shown as the model:
 * its geometry and material are swapped, and the stitching added, as soon as the model is in.
 */
export function registerBall(mesh, radius) {
  mesh.userData.ballRadius = radius;
  if (model) fitModel(mesh);
  else { balls.push(new WeakRef(mesh)); ballMaterial(); }
}

function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

function loadModel() {
  if (loading || typeof document === 'undefined') return loading;
  loading = Promise.all([new GLTFLoader().loadAsync(MODEL.glb), loadImage(MODEL.red), loadImage(MODEL.white)]).then(([gltf, red, white]) => {
    let leather = null, stitches = null;
    gltf.scene.traverse(o => { if (o.isMesh) { if (o.name === 'stitches') stitches = o.geometry; else leather = o.geometry; } });
    if (!leather || !stitches) throw new Error('ball model: missing parts');
    leatherCanvas = document.createElement('canvas'); leatherCanvas.width = leatherCanvas.height = MODEL.size;
    const map = new THREE.CanvasTexture(leatherCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    leatherMat = new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0, envMapIntensity: 0.55, envMap: env });
    threadMat = new THREE.MeshStandardMaterial({ color: THREAD.white[0], roughness: 0.82, metalness: 0, envMapIntensity: 0.3, envMap: env });
    model = { leather, stitches, images: { red, white } };
    const keep = current;
    current = { kind: null, wear: -1 };
    setBallLook(keep.kind || 'white', keep.wear < 0 ? 0 : keep.wear);
    for (const ref of balls.splice(0)) { const m = ref.deref(); if (m) fitModel(m); }
  }).catch(err => { console.warn('Ball model not loaded; using the painted ball.', err); });
  return loading;
}

function fitModel(mesh) {
  const r = mesh.userData.ballRadius;
  let g = geoCache.get(r);
  if (!g) { g = { leather: model.leather.clone().scale(r, r, r), stitches: model.stitches.clone().scale(r, r, r) }; geoCache.set(r, g); }
  mesh.geometry = g.leather;
  mesh.material = leatherMat;
  if (!mesh.getObjectByName('stitches')) {
    const s = new THREE.Mesh(g.stitches, threadMat);
    s.name = 'stitches';
    mesh.add(s);
  }
}

/** Ball type ('red' | 'white') and wear (0..1). Redraws only on a visible change. */
export function setBallLook(kind = 'white', wear = 0) {
  if (!STYLE[kind]) kind = 'white';
  ballMaterial();
  const w = Math.round(Math.max(0, Math.min(1, wear)) * 20) / 20;   // 5% steps
  if (current.kind === kind && current.wear === w) return;
  current = { kind, wear: w };
  const [r0, r1] = STYLE[kind].roughness;
  if (model) {
    // the model's leather, with the wear painted over it; the stitching dulls a little as the ball gets older
    const g = leatherCanvas.getContext('2d'), N = MODEL.size;
    g.drawImage(model.images[kind], 0, 0, N, N);
    paintWear(g, N, N, N / W, STYLE[kind], w);
    leatherMat.map.needsUpdate = true;
    leatherMat.roughness = 0.5 + (0.8 - 0.5) * w * 0.8 + (kind === 'white' ? 0.05 : 0);
    threadMat.color.set(THREAD[kind][0]).lerp(new THREE.Color(THREAD[kind][1]), w * 0.7);
    return;
  }
  paint(colorCanvas.getContext('2d'), bumpCanvas.getContext('2d'), kind, w);
  mat.map.needsUpdate = true;
  mat.bumpMap.needsUpdate = true;
  mat.roughness = r0 + (r1 - r0) * w;
}

export function ballLookState() { return { ...current, model: !!model }; }

/** Give the ball the same studio reflections as the players (new leather has a polish). */
export function setBallEnvironment(e) {
  env = e;
  for (const m of [mat || ballMaterial(), leatherMat, threadMat]) if (m) { m.envMap = e; m.needsUpdate = true; }
}
