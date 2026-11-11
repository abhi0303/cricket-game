// Field presets for a right-handed batter, in the delivery frame.
// Angle 0° = straight down the ground past the bowler, + = off side, ±180° = behind the keeper.

import { PITCH } from './BallPhysics.js';

const ORIGIN_Z = 9.2;
const DEEP_R = 58.5;

function polar(angleDeg, dist) {
  const a = angleDeg * Math.PI / 180;
  return { x: dist * Math.sin(a), z: ORIGIN_Z - dist * Math.cos(a) };
}

/** Point at radius R from the ground centre along the ray from the striker at the given angle. */
function deep(angleDeg, R = DEEP_R) {
  const a = angleDeg * Math.PI / 180;
  const c = ORIGIN_Z * Math.cos(a);
  const d = c + Math.sqrt(c * c - (ORIGIN_Z * ORIGIN_Z - R * R));
  return polar(angleDeg, d);
}

const P = (name, angle, dist, close = false) => ({ name, angle, ...(dist === 'deep' ? deep(angle) : polar(angle, dist)), deep: dist === 'deep', close });

export const FIELD_PRESETS = {
  attacking: {
    label: 'Attacking',
    positions: [
      P('first slip', 167, 10.6, true), P('second slip', 158, 11.2, true), P('gully', 130, 12.5, true),
      P('point', 98, 22), P('cover', 60, 24), P('mid-off', 16, 26), P('mid-on', -16, 26),
      P('square leg', -96, 21), P('fine leg', -160, 'deep'),
    ],
  },
  balanced: {
    label: 'Balanced',
    positions: [
      P('first slip', 167, 10.6, true), P('point', 98, 23), P('cover', 58, 25), P('mid-off', 15, 27),
      P('mid-on', -15, 27), P('midwicket', -58, 25), P('square leg', -100, 22),
      P('third man', 158, 'deep'), P('fine leg', -158, 'deep'),
    ],
  },
  defensive: {
    label: 'Defensive',
    positions: [
      P('point', 100, 24), P('mid-off', 14, 27), P('mid-on', -14, 27),
      P('long-off', 16, 'deep'), P('long-on', -18, 'deep'), P('deep cover', 62, 'deep'),
      P('deep midwicket', -62, 'deep'), P('deep square leg', -100, 'deep'), P('third man', 150, 'deep'),
    ],
  },
  spin: {
    label: 'Spin attack',
    positions: [
      P('slip', 148, 2.6, true), P('short leg', -95, 5.5, true), P('point', 95, 21), P('cover', 55, 23),
      P('mid-off', 12, 24), P('mid-on', -12, 24), P('midwicket', -55, 23),
      P('deep square leg', -95, 'deep'), P('long-on', -20, 'deep'),
    ],
  },
  death: {
    label: 'Death overs',
    positions: [
      P('short third man', 140, 30), P('deep point', 100, 'deep'), P('deep cover', 55, 'deep'),
      P('long-off', 12, 'deep'), P('long-on', -12, 'deep'), P('deep midwicket', -55, 'deep'),
      P('deep square leg', -95, 'deep'), P('fine leg', -158, 'deep'), P('mid-off', 12, 25),
    ],
  },
};

export const FIELD_PRESET_IDS = Object.keys(FIELD_PRESETS);

export function keeperPosition(kind) {
  return kind === 'spin' ? { x: 0.05, z: PITCH.half + 0.8 } : { x: 0.15, z: PITCH.half + 8.5 };
}

/**
 * Put the nine outfielders into a preset's positions. Close catching spots go to the best catchers.
 * @param {object[]} fielders  players excluding the bowler and keeper
 */
export function assignFielders(presetId, fielders) {
  const preset = FIELD_PRESETS[presetId] || FIELD_PRESETS.balanced;
  const spots = preset.positions.map((p, i) => ({ ...p, i }));
  const order = spots.slice().sort((a, b) => Number(b.close) - Number(a.close) || Number(a.deep) - Number(b.deep));
  const byCatch = fielders.slice().sort((a, b) => b.catching - a.catching);
  const byArm = fielders.slice().sort((a, b) => b.fielding - a.fielding);
  const used = new Set();
  const out = [];
  for (const s of order) {
    const pool = s.deep ? byArm : byCatch;
    const p = pool.find(x => !used.has(x.id));
    if (!p) break;
    used.add(p.id);
    out.push({ player: p, spot: s });
  }
  return out;
}
