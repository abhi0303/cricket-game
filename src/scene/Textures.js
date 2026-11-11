// Canvas-generated textures (no image assets needed).
import * as THREE from 'three';
import { drawEmblem } from '../ui/Emblem.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { repeat = null, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Outfield: mowing stripes, 30-yard circle, subtle noise. Covers a square of `size` metres. */
export function outfieldTexture({ size = 150, palette }) {
  const N = 1024;
  const c = canvas(N, N);
  const g = c.getContext('2d');
  const px = m => ((m + size / 2) / size) * N;
  const [a, b] = palette;
  // Stripes across the ground (parallel to the pitch)
  const stripe = 6.2;
  for (let x = -size / 2, i = 0; x < size / 2; x += stripe, i++) {
    g.fillStyle = i % 2 ? a : b;
    g.fillRect(px(x), 0, (stripe / size) * N + 1, N);
  }
  // Light checker across for a "cross-mown" look
  g.globalAlpha = 0.06;
  for (let z = -size / 2, i = 0; z < size / 2; z += stripe * 2, i++) {
    if (i % 2) { g.fillStyle = '#ffffff'; g.fillRect(0, px(z), N, (stripe * 2 / size) * N); }
  }
  g.globalAlpha = 1;
  // Speckle noise
  const img = g.getImageData(0, 0, N, N);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] += n; d[i + 1] += n * 1.2; d[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  // Worn square around the pitch
  g.fillStyle = 'rgba(150,140,90,0.18)';
  g.fillRect(px(-4), px(-14), (8 / size) * N, (28 / size) * N);
  // 30-yard (inner) circle: dashed white
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 2.2;
  g.setLineDash([9, 9]);
  g.beginPath(); g.arc(N / 2, N / 2, (27.5 / size) * N, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  return tex(c);
}

/**
 * Pitch strip, 3.66 m wide by 24 m long: the prepared surface from assets/textures/pitch.jpg (made by
 * scripts/pitch-texture.html: dry khaki soil with a crack network, thin straw grass greener at the edges, worn
 * ends, the bowlers' footmarks, the rough and spike marks) with the creases painted on top. Until the image has
 * loaded a plain surface stands in.
 */
const PITCH_IMG = { W: 640, H: 4200, colour: 'assets/textures/pitch.jpg', bump: 'assets/textures/pitch_bump.jpg' };

function paintCreases(g, W, H) {
  const L = 24, Wm = 3.66;
  const X = m => ((m + Wm / 2) / Wm) * W;
  const Z = m => ((m + L / 2) / L) * H;
  g.fillStyle = 'rgba(252,252,246,0.94)';
  const line = (x0, z0, x1, z1, w = 0.05) => {
    if (z0 === z1) g.fillRect(X(x0), Z(z0) - (w / L) * H / 2, X(x1) - X(x0), Math.max(2, (w / L) * H));
    else g.fillRect(X(x0) - (w / Wm) * W / 2, Z(Math.min(z0, z1)), Math.max(2, (w / Wm) * W), Z(Math.max(z0, z1)) - Z(Math.min(z0, z1)));
  };
  for (const s of [-1, 1]) {
    line(-1.83, s * 8.84, 1.83, s * 8.84);            // popping crease
    line(-1.32, s * 10.06, 1.32, s * 10.06);          // bowling crease
    for (const x of [-1.32, 1.32]) line(x, s * 8.84, x, s * 11.3);   // return creases
    for (const x of [-0.89, 0.89]) line(x, s * 8.84, x, s * 8.2);    // wide guidelines
  }
}

export function pitchTexture({ base = '#cdbb8e' } = {}) {
  const { W, H } = PITCH_IMG;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(140,150,92,0.6)'); grad.addColorStop(0.16, 'rgba(140,150,92,0)');
  grad.addColorStop(0.84, 'rgba(140,150,92,0)'); grad.addColorStop(1, 'rgba(140,150,92,0.6)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  paintCreases(g, W, H);
  const t = tex(c, { aniso: 16 });
  const img = new Image();
  img.onload = () => { g.drawImage(img, 0, 0, W, H); paintCreases(g, W, H); t.needsUpdate = true; };
  img.src = PITCH_IMG.colour;
  return t;
}

/** The pitch's relief (cracks, footmarks and spike marks sit lower) for the lighting. */
export function pitchBumpTexture() {
  const t = new THREE.TextureLoader().load(PITCH_IMG.bump);
  t.anisotropy = 8;
  return t;
}

const ADS = [
  ['PIXEL COLA', '#e63946', '#ffffff'], ['LOWPOLY BANK', '#1d3557', '#f1faee'], ['SIXER SPORTS', '#ffb703', '#14213d'],
  ['GREEN WICKET TEA', '#2a9d8f', '#ffffff'], ['BOUNDARY AIR', '#3a86ff', '#ffffff'], ['CREASE MOBILE', '#8338ec', '#ffffff'],
  ['SPIN CITY RADIO', '#fb5607', '#ffffff'], ['YORKER TYRES', '#222222', '#ffd60a'], ['SWING FM', '#06d6a0', '#073b4c'],
  ['DUCK & DIVE PIZZA', '#ef476f', '#ffffff'],
];

/** Advertising boards around the boundary. */
export function adBoardTexture() {
  const W = 4096, H = 64;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const n = ADS.length;
  const w = W / n;
  for (let i = 0; i < n; i++) {
    const [text, bg, fg] = ADS[i];
    g.fillStyle = bg; g.fillRect(i * w, 0, w, H);
    g.fillStyle = fg;
    g.font = '800 40px "Rajdhani", "Arial Narrow", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, i * w + w / 2, H / 2 + 2);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(i * w, 0, 3, H);
  }
  // Negative repeat mirrors the text so it reads correctly from inside the ring
  return tex(c, { repeat: [-3, 1] });
}

/** Lit building windows for the city skyline. */
export function windowTexture(night = false) {
  const c = canvas(64, 128);
  const g = c.getContext('2d');
  g.fillStyle = night ? '#1b2233' : '#9aa7b8';
  g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 10) for (let x = 4; x < 64; x += 10) {
    const lit = Math.random() < (night ? 0.55 : 0.0);
    g.fillStyle = lit ? `rgba(255,${200 + Math.random() * 50},${120 + Math.random() * 60},1)` : night ? '#2b3448' : '#c7d6e6';
    g.fillRect(x, y, 6, 6);
  }
  return tex(c, { repeat: [1, 1] });
}

/** Stadium scoreboard / big screen, redrawn when the score changes. */
export class ScoreboardTexture {
  constructor() {
    this.canvas = canvas(1024, 512);
    this.texture = tex(this.canvas);
    this.draw({ title: 'LOW-POLY CRICKET' });
  }

  draw(info) {
    const g = this.canvas.getContext('2d');
    const W = 1024, H = 512;
    g.fillStyle = '#05080f'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1e2a44'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
    g.textBaseline = 'middle';
    if (!info.bat) {
      g.fillStyle = '#ffd166'; g.font = '800 92px "Rajdhani", sans-serif'; g.textAlign = 'center';
      g.fillText(info.title || 'WELCOME', W / 2, H / 2 - 30);
      g.fillStyle = '#8fb3ff'; g.font = '600 46px "Rajdhani", sans-serif';
      g.fillText(info.subtitle || 'Enjoy the match', W / 2, H / 2 + 60);
      this.texture.needsUpdate = true;
      return;
    }
    const t = info.bat;
    drawEmblem(g, t, 150);
    g.save(); g.translate(30, 30); g.restore();
    g.textAlign = 'left';
    g.fillStyle = '#ffffff'; g.font = '800 64px "Rajdhani", sans-serif';
    g.fillText(t.name.toUpperCase().slice(0, 18), 175, 60);
    g.fillStyle = '#ffd166'; g.font = '800 150px "Rajdhani", sans-serif';
    g.fillText(`${info.runs}/${info.wickets}`, 175, 190);
    g.fillStyle = '#cfe0ff'; g.font = '700 60px "Rajdhani", sans-serif';
    g.fillText(`OVERS ${info.overs}`, 640, 160);
    g.fillText(`RR ${info.crr}`, 640, 225);
    g.fillStyle = '#9fb4d8'; g.font = '600 44px "Rajdhani", sans-serif';
    g.fillText(info.line1 || '', 40, 330);
    g.fillText(info.line2 || '', 40, 390);
    g.fillStyle = info.highlight ? '#ff5d73' : '#7ee0a1';
    g.font = '800 52px "Rajdhani", sans-serif';
    g.fillText(info.footer || '', 40, 460);
    this.texture.needsUpdate = true;
  }
}

/** Name + number printed on the back of a shirt. */
export function jerseyBackTexture(name, number, color) {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 22px "Rajdhani", "Arial Narrow", sans-serif';
  const surname = (name.split(' ').slice(-1)[0] || name).toUpperCase().slice(0, 10);
  g.fillText(surname, 64, 22);
  g.font = '800 72px "Rajdhani", "Arial Narrow", sans-serif';
  g.fillText(String(number), 64, 80);
  return tex(c, { aniso: 4 });
}

export function emblemTexture(team, s = 256) {
  const c = canvas(s, s);
  drawEmblem(c.getContext('2d'), team, s);
  return tex(c);
}

export function glowTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,250,230,0.8)');
  grad.addColorStop(1, 'rgba(255,250,230,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return tex(c);
}

const chestCache = new Map();
/** Team short name printed on the front of the shirt (shared per team). */
export function chestTexture(short, color) {
  const key = short + color;
  if (chestCache.has(key)) return chestCache.get(key);
  const c = canvas(128, 64);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 40px "Rajdhani", "Arial Narrow", sans-serif';
  g.fillText(String(short).toUpperCase().slice(0, 4), 64, 34);
  const t = tex(c, { aniso: 4 });
  chestCache.set(key, t);
  return t;
}
