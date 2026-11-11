// The bat blade's painted texture: pale willow with grain and darker edges, a rubber toe guard, and the
// maker's stickers (a small one at the shoulder and a large one near the toe on the face, a long one down
// the back). The lettering is drawn in this game's own style.
import * as THREE from 'three';

export const BAT_BRANDS = ['MRF', 'SG'];
const W = 256, H = 1024;        // u: back 0..0.5, face 0.5..1 (see buildBatBlade); v: shoulder (top) .. toe
const SY = 1.54;                // canvas pixels are taller than they are wide on the bat: draw text 1.54x taller
const FONT = '"Rajdhani", "Arial Black", Impact, sans-serif';

const STYLE = {
  MRF: { ink: '#d71920', dark: '#111111', panel: '#ffffff', accent: '#111111', italic: true },
  SG: { ink: '#1b2f6b', dark: '#0d1736', panel: '#1b2f6b', accent: '#d0312d', italic: false, panelInk: '#ffffff' },
};

/** Text centred at (x, y), squeezed to `maxW` and drawn 1.54x taller so it looks right on the blade. */
function word(g, text, x, y, size, maxW, fill, { italic = false, stroke = null, rotate = 0 } = {}) {
  g.save();
  g.translate(x, y);
  if (rotate) g.rotate(rotate);
  g.scale(1, rotate ? 1 : SY);
  if (rotate) g.scale(SY, 1);
  g.font = `${italic ? 'italic ' : ''}700 ${size}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(text).width;
  if (w > maxW) g.scale(maxW / w, 1);
  if (stroke) { g.lineWidth = Math.max(2, size * 0.08); g.strokeStyle = stroke; g.lineJoin = 'round'; g.strokeText(text, 0, 0); }
  g.fillStyle = fill; g.fillText(text, 0, 0);
  g.restore();
}

function paintWillow(g) {
  g.fillStyle = '#ecdcb0'; g.fillRect(0, 0, W, H);
  // grain: wavy lines along the blade
  let s = 1234;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 22; i++) {
    const x0 = r() * W, wob = 1 + r() * 2.5, ph = r() * 6;
    g.strokeStyle = `rgba(170,128,70,${0.1 + r() * 0.14})`; g.lineWidth = 0.8 + r() * 1.4;
    g.beginPath();
    for (let y = 0; y <= H; y += 16) g.lineTo(x0 + Math.sin(y / 90 + ph) * wob, y);
    g.stroke();
  }
  // the edges of the bat are darker (more weathered); u = 0, 0.5 and 1 are the two edges
  for (const x of [0, W / 2, W]) {
    const grd = g.createLinearGradient(x - 14, 0, x + 14, 0);
    grd.addColorStop(0, 'rgba(160,118,60,0)'); grd.addColorStop(0.5, 'rgba(160,118,60,0.42)'); grd.addColorStop(1, 'rgba(160,118,60,0)');
    g.fillStyle = grd; g.fillRect(x - 14, 0, 28, H);
  }
}

/** Draw in one half (face or back) with x' running the way a viewer of that side reads it. */
function side(g, which, fn) {
  g.save();
  g.translate(which === 'face' ? W : W / 2, 0);
  g.scale(-1, 1);
  fn();
  g.restore();
}

function paintBlade(g, brand) {
  const S = STYLE[brand] || STYLE.MRF;
  paintWillow(g);
  // face: small sticker at the shoulder, the main one near the toe
  side(g, 'face', () => {
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(14, 70, 100, 82);
    g.fillStyle = S.accent; g.fillRect(14, 146, 100, 6);
    word(g, brand, 64, 108, 44, 86, S.ink, { italic: S.italic });
    g.fillStyle = 'rgba(255,255,255,0.94)'; g.fillRect(8, 640, 112, 230);
    g.fillStyle = S.accent; g.fillRect(8, 640, 112, 10); g.fillRect(8, 860, 112, 10);
    word(g, brand, 64, 752, 88, 104, S.ink, { italic: S.italic, stroke: brand === 'MRF' ? S.dark : null });
  });
  // back: the long sticker down the spine, reading from the toe up to the handle
  side(g, 'back', () => {
    g.fillStyle = S.panel; g.fillRect(16, 150, 96, 600);
    g.fillStyle = S.accent; g.fillRect(16, 150, 96, 12); g.fillRect(16, 738, 96, 12);
    g.strokeStyle = S.ink; g.lineWidth = 4; g.strokeRect(18, 152, 92, 596);
    // rotated: the font height runs across the panel (96 px), the word along the blade (up to ~560 px)
    word(g, brand, 64, 450, 84, 360, S.panelInk || S.ink, { italic: S.italic, stroke: brand === 'MRF' ? S.dark : null, rotate: -Math.PI / 2 });
  });
  // rubber toe guard on both sides
  g.fillStyle = '#2a2a2a'; g.fillRect(0, H - 26, W, 26);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, H - 26, W, 3);
}

const cache = new Map();
let env = null;

/** Blade material for a brand (cached). quality 'low' uses a cheaper lit material. */
export function bladeMaterial(brand = 'MRF', quality = 'high') {
  const key = `${brand}:${quality}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const paint = () => { paintBlade(c.getContext('2d'), brand); tex.needsUpdate = true; };
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 4;
  paint();
  // the lettering uses the page font: repaint once it has loaded
  document.fonts?.ready?.then(paint);
  const mat = quality === 'low'
    ? new THREE.MeshLambertMaterial({ map: tex })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.58, metalness: 0, envMap: env, envMapIntensity: 0.45 });
  cache.set(key, mat);
  return mat;
}

/** The pick of bat maker for a player (stable per player). */
export function batBrandFor(id, hash) { return BAT_BRANDS[hash(String(id || '')) % BAT_BRANDS.length]; }

export function setBatEnvironment(e) {
  env = e;
  for (const m of cache.values()) if (m.isMeshStandardMaterial) { m.envMap = e; m.needsUpdate = true; }
}
