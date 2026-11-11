// Fielding decisions: which end to throw to after gathering the ball.

import { PITCH } from '../game/BallPhysics.js';

export const END_Z = { striker: PITCH.half, nonStriker: -PITCH.half };
export const CREASE_Z = { striker: PITCH.popping, nonStriker: -PITCH.popping };
export const BAT_REACH = 0.85;

export function isSafe(runner, end) {
  return end === 'striker' ? runner.z >= CREASE_Z.striker - BAT_REACH : runner.z <= CREASE_Z.nonStriker + BAT_REACH;
}

export function throwTime(from, end, throwSpeed) {
  const d = Math.hypot(from.x, from.z - END_Z[end]);
  return 0.28 + d / throwSpeed + 0.32;
}

/** Time for the batter nearest to `end` to make their ground there (0 if safe and staying). */
export function batterTimeToGround(runners, end) {
  const near = runners.slice().sort((a, b) => Math.abs(a.z - CREASE_Z[end]) - Math.abs(b.z - CREASE_Z[end]))[0];
  if (!near) return 0;
  if (isSafe(near, end) && near.target !== (end === 'striker' ? 'nonStriker' : 'striker')) return 0;
  const safeZ = end === 'striker' ? CREASE_Z.striker - BAT_REACH : CREASE_Z.nonStriker + BAT_REACH;
  // A batter running away from this end still has to come back.
  const away = near.target && near.target !== end;
  const dist = Math.abs(safeZ - near.z) + (away ? 1.5 : 0);
  const v = near.target === end ? (near.v || 0) : 0;
  return dist / near.speed + (near.speed - v) * (near.speed - v) / (14 * near.speed) + (near.target === end ? 0 : 0.35);
}

/**
 * Pick the end to throw to. Throws at the end with the best run-out chance, otherwise
 * back to the keeper (or the bowler if that's much closer).
 */
export function chooseThrowEnd(from, runners, throwSpeed, runState) {
  let best = null;
  if (runState !== 'idle') {
    for (const end of ['striker', 'nonStriker']) {
      const margin = batterTimeToGround(runners, end) - throwTime(from, end, throwSpeed);
      if (!best || margin > best.margin) best = { end, margin };
    }
    if (best && best.margin > -0.25) return best.end;
  }
  const dK = Math.hypot(from.x, from.z - END_Z.striker);
  const dB = Math.hypot(from.x, from.z - END_Z.nonStriker);
  return dB < dK * 0.55 ? 'nonStriker' : 'striker';
}
