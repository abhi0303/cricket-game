// Generated team emblems, drawn with Canvas 2D so the same art is used in menus and in 3D.

export const EMBLEM_SHAPES = ['shield', 'circle', 'hexagon', 'diamond'];
export const EMBLEM_ICONS = ['bat', 'ball', 'stumps', 'star', 'wings', 'bolt', 'sun', 'wave', 'crown'];

function shapePath(ctx, shape, s) {
  ctx.beginPath();
  const c = s / 2;
  if (shape === 'circle') ctx.arc(c, c, s * 0.46, 0, Math.PI * 2);
  else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      ctx.lineTo(c + Math.cos(a) * s * 0.47, c + Math.sin(a) * s * 0.47);
    }
    ctx.closePath();
  } else if (shape === 'diamond') {
    ctx.moveTo(c, s * 0.03); ctx.lineTo(s * 0.97, c); ctx.lineTo(c, s * 0.97); ctx.lineTo(s * 0.03, c); ctx.closePath();
  } else {
    ctx.moveTo(s * 0.1, s * 0.08);
    ctx.lineTo(s * 0.9, s * 0.08);
    ctx.lineTo(s * 0.9, s * 0.48);
    ctx.quadraticCurveTo(s * 0.88, s * 0.82, c, s * 0.97);
    ctx.quadraticCurveTo(s * 0.12, s * 0.82, s * 0.1, s * 0.48);
    ctx.closePath();
  }
}

function icon(ctx, name, s, color) {
  const c = s / 2;
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = s * 0.035; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const y0 = s * 0.27;
  switch (name) {
    case 'bat':
      ctx.translate(c, y0 + s * 0.03); ctx.rotate(-0.6);
      ctx.fillRect(-s * 0.035, -s * 0.16, s * 0.07, s * 0.12);
      ctx.beginPath(); ctx.roundRect(-s * 0.07, -s * 0.05, s * 0.14, s * 0.3, s * 0.03); ctx.fill();
      ctx.rotate(1.2);
      ctx.fillRect(-s * 0.035, -s * 0.16, s * 0.07, s * 0.12);
      ctx.beginPath(); ctx.roundRect(-s * 0.07, -s * 0.05, s * 0.14, s * 0.3, s * 0.03); ctx.fill();
      break;
    case 'ball':
      ctx.beginPath(); ctx.arc(c, y0 + s * 0.06, s * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(c - s * 0.02, y0 + s * 0.06, s * 0.1, -0.9, 0.9); ctx.stroke();
      break;
    case 'stumps':
      for (let i = -1; i <= 1; i++) ctx.fillRect(c + i * s * 0.07 - s * 0.018, y0 - s * 0.06, s * 0.036, s * 0.26);
      ctx.fillRect(c - s * 0.11, y0 - s * 0.09, s * 0.22, s * 0.025);
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.07 : s * 0.16;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(c + Math.cos(a) * r, y0 + s * 0.06 + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'wings':
      for (const d of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(c, y0 + s * 0.12);
        ctx.quadraticCurveTo(c + d * s * 0.16, y0 - s * 0.1, c + d * s * 0.3, y0 - s * 0.04);
        ctx.quadraticCurveTo(c + d * s * 0.2, y0 + s * 0.04, c + d * s * 0.24, y0 + s * 0.06);
        ctx.quadraticCurveTo(c + d * s * 0.12, y0 + s * 0.08, c, y0 + s * 0.16);
        ctx.fill();
      }
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(c + s * 0.05, y0 - s * 0.1); ctx.lineTo(c - s * 0.09, y0 + s * 0.08); ctx.lineTo(c, y0 + s * 0.08);
      ctx.lineTo(c - s * 0.05, y0 + s * 0.24); ctx.lineTo(c + s * 0.1, y0 + s * 0.03); ctx.lineTo(c + s * 0.01, y0 + s * 0.03);
      ctx.closePath(); ctx.fill();
      break;
    case 'sun':
      ctx.beginPath(); ctx.arc(c, y0 + s * 0.06, s * 0.08, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * s * 0.11, y0 + s * 0.06 + Math.sin(a) * s * 0.11);
        ctx.lineTo(c + Math.cos(a) * s * 0.17, y0 + s * 0.06 + Math.sin(a) * s * 0.17); ctx.stroke();
      }
      break;
    case 'wave':
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) {
          const x = c - s * 0.2 + (i / 20) * s * 0.4;
          ctx.lineTo(x, y0 + k * s * 0.09 + Math.sin(i / 20 * Math.PI * 2) * s * 0.03);
        }
        ctx.stroke();
      }
      break;
    case 'crown':
      ctx.beginPath();
      ctx.moveTo(c - s * 0.16, y0 + s * 0.16); ctx.lineTo(c - s * 0.18, y0 - s * 0.06); ctx.lineTo(c - s * 0.07, y0 + s * 0.04);
      ctx.lineTo(c, y0 - s * 0.1); ctx.lineTo(c + s * 0.07, y0 + s * 0.04); ctx.lineTo(c + s * 0.18, y0 - s * 0.06);
      ctx.lineTo(c + s * 0.16, y0 + s * 0.16); ctx.closePath(); ctx.fill();
      break;
  }
  ctx.restore();
}

/** Draw an emblem into a 2D context at (0,0) with size s. */
export function drawEmblem(ctx, team, s) {
  const shape = team.emblem?.shape || 'shield';
  ctx.save();
  shapePath(ctx, shape, s);
  ctx.fillStyle = team.primary || '#226';
  ctx.fill();
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = team.secondary || '#fff';
  ctx.stroke();
  ctx.clip();
  // diagonal sash
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = team.secondary || '#fff';
  ctx.beginPath(); ctx.moveTo(0, s * 0.75); ctx.lineTo(s, s * 0.35); ctx.lineTo(s, s * 0.5); ctx.lineTo(0, s * 0.9); ctx.fill();
  ctx.globalAlpha = 1;
  icon(ctx, team.emblem?.icon || 'star', s, team.secondary || '#fff');
  const text = (team.short || team.name || '?').slice(0, 4).toUpperCase();
  ctx.fillStyle = team.secondary || '#fff';
  ctx.font = `800 ${Math.round(s * (text.length > 3 ? 0.17 : 0.21))}px "Rajdhani", "Arial Narrow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s / 2, s * 0.66);
  ctx.restore();
}

const cache = new Map();
/** Data URL of an emblem (cached), for <img> tags. */
export function emblemDataURL(team, s = 128) {
  const key = `${team.primary}|${team.secondary}|${team.emblem?.shape}|${team.emblem?.icon}|${team.short}|${s}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = s;
  drawEmblem(c.getContext('2d'), team, s);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
