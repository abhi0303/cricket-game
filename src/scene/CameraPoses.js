// Camera placement maths in the delivery frame (pure functions, unit tested).
// Delivery frame: striker's stumps at z = +10.06, bowler's end at z = -10.06.

export const STRIKER_Z = 10.06;
export const BOWLER_END_Z = -10.06;

// Camera choices shown in Settings. `end` says which end of the pitch the camera looks from.
export const BATTING_VIEWS = [
  { id: 'behind', label: 'Behind batsman', end: 'striker' },
  { id: 'behindLow', label: 'Behind batsman (low)', end: 'striker' },
  { id: 'behindHigh', label: 'Behind batsman (high)', end: 'striker' },
  { id: 'bowlerEnd', label: "Bowler's end (TV broadcast)", end: 'bowler' },
  { id: 'umpire', label: "Umpire's end (umpire's eye)", end: 'bowler' },
];
export const BOWLING_VIEWS = [
  { id: 'behindBowler', label: 'Behind bowler', end: 'bowler' },
  { id: 'behindBowlerHigh', label: 'Behind bowler (high)', end: 'bowler' },
  { id: 'batsmanEnd', label: "Batsman's end", end: 'striker' },
];
const LEGACY = { standard: 'behind', low: 'behindLow', high: 'behindHigh' };
export const normalizeBattingView = id => (BATTING_VIEWS.some(v => v.id === id) ? id : LEGACY[id] || 'behind');
export const normalizeBowlingView = id => (BOWLING_VIEWS.some(v => v.id === id) ? id : 'behindBowler');
export const viewEnd = id => [...BATTING_VIEWS, ...BOWLING_VIEWS].find(v => v.id === id)?.end || 'striker';
/** From the bowler's end the picture is mirrored: screen-right is the batter's leg side. */
export const viewMirrored = id => viewEnd(id) === 'bowler';

export const UMPIRE_EYE = [0.05, 1.66, -11.95];

/** Batting cameras: behind the striker (three heights), the TV view from the bowler's end, or the umpire's eye. */
export function battingCam(variant = 'behind') {
  const v = {
    behind: { pos: [0.95, 2.85, 15.9], target: [0.0, 0.75, -3.5], fov: 40 },
    behindLow: { pos: [0.55, 1.75, 13.8], target: [0.05, 1.0, -4], fov: 44 },
    behindHigh: { pos: [0.4, 4.6, 19.5], target: [0.0, 0.6, -2.5], fov: 38 },
    // TV broadcast: high behind the bowler's arm on a long lens, so bowler and batter look a similar size.
    // Framed like the TV shot: keeper and slips along the top, the batter a third of the way down,
    // the bowler and umpire just above the score strip. (Same line of sight, aimed at the striker's end.)
    bowlerEnd: { pos: [-0.9, 13.0, -64], target: [-0.2, -1.47, 9.1], fov: 6.6 },
    // Where the umpire stands, at eye height, behind the bowler's stumps.
    umpire: { pos: UMPIRE_EYE.slice(), target: [-0.1, 0.9, 9.4], fov: 30 },
  }[normalizeBattingView(variant)];
  return { ...v, pos: v.pos.slice(), target: v.target.slice() };
}

/** Behind the bowler: follows the run-up, then settles behind the bowler's end. */
export function bowlingCam(bowler, phase = 'runup', variant = 'standard') {
  const high = variant === 'high';
  if (phase === 'aim') return { pos: [1.4, high ? 6.5 : 3.6, BOWLER_END_Z - (high ? 13 : 9.5)], target: [0.0, 0.6, 7.5], fov: 40 };
  const bz = Math.min(bowler.z, -9.2);
  const t = Math.min(1, Math.max(0, (bowler.z + 26) / 17));
  const back = 7.2 - 1.6 * t;
  return {
    pos: [bowler.x + 1.15 - 0.4 * t, (high ? 5.5 : 2.95) - 0.25 * t, bz - back],
    target: [0.15, 0.95, 8.5],
    fov: 40,
  };
}

/** After the ball is hit: high behind one end (the end the player was watching from), tracking the ball. */
export function followCam(ball, end = 'striker') {
  const endZ = end === 'bowler' ? BOWLER_END_Z : STRIKER_Z;
  const sign = end === 'bowler' ? -1 : 1;
  const dist = Math.hypot(ball.x, ball.z - endZ);
  const height = 9 + Math.min(26, dist * 0.32);
  const back = 16 + Math.min(20, dist * 0.2);
  const pos = [ball.x * 0.25, height, endZ + sign * back];
  const target = [ball.x, Math.max(0, ball.y * 0.6), ball.z];
  return { pos, target, fov: 46 };
}

/** Cinematic shots used only for replays and boundary moments. */
export function cinematicCam(kind, ctx = {}) {
  const ball = ctx.ball || { x: 0, y: 1, z: 0 };
  switch (kind) {
    case 'sideOn': return { pos: [26, 3.2, 5], target: [0, 1, 6], fov: 30 };
    case 'stumpCam': return { pos: [0.6, 0.35, STRIKER_Z + 1.4], target: [0, 0.4, 0], fov: 55 };
    case 'boundary': {
      const a = Math.atan2(ctx.exit?.x ?? ball.x, ctx.exit?.z ?? ball.z);
      const r = 64.5;   // between the rope (63 m) and the boards (66 m); the stands start at 70 m
      return { pos: [Math.sin(a + 0.25) * r, 2.2, Math.cos(a + 0.25) * r], target: [ball.x, ball.y, ball.z], fov: 42 };
    }
    case 'orbit': {
      const t = ctx.t || 0;
      const a = 1.2 + t * 0.35;
      return { pos: [Math.sin(a) * 9, 2.4, STRIKER_Z - 1 + Math.cos(a) * 9], target: [0, 1.0, STRIKER_Z - 1], fov: 40 };
    }
    case 'bowlerEnd': return { pos: [-2.5, 2.2, BOWLER_END_Z - 6], target: [0, 1, STRIKER_Z], fov: 26 };
    // ball tracking: high behind the bowler down the pitch, then in front of the striker's stumps
    case 'hawkEye': return { pos: [0, 2.7, BOWLER_END_Z - 2.6], target: [0, 0.45, 6.5], fov: 21 };
    case 'hawkEyeStumps': return { pos: [0.45, 0.85, STRIKER_Z - 4.5], target: [0, 0.42, STRIKER_Z], fov: 24 };
    // bowled: low on the off side just in front of the stumps (clear of a keeper standing up)
    case 'stumpSide': return { pos: [1.45, 0.42, STRIKER_Z - 1.15], target: [0, 0.36, STRIKER_Z], fov: 34 };
    // LBW from square on the off side, low: pad, ball and stumps in one frame
    case 'sideOnLow': return { pos: [7.5, 0.75, 9.1], target: [0, 0.45, 9.5], fov: 30 };
    // following the ball from beside its path (catches and boundaries)
    case 'ballCam': return { pos: [ball.x * 0.55 + 3.5, 3.4 + Math.max(0, ball.y) * 0.4, STRIKER_Z + (ball.z - STRIKER_Z) * 0.55 + 2], target: [ball.x, Math.max(0.3, ball.y), ball.z], fov: 34 };
    // side-on at the popping crease where a run-out or stumping happened
    case 'creaseCam': {
      const z = ctx.end === 'nonStriker' ? -8.84 : 8.84;
      return { pos: [6.5, 1.3, z], target: [0, 0.55, z], fov: 34 };
    }
    case 'crowd': return { pos: [0, 12, 30], target: [0, 12, 90], fov: 50 };
    default: return { pos: [0, 30, 60], target: [0, 0, 0], fov: 45 };
  }
}

/** Main-menu orbit, in world space. */
export function menuCam(t) {
  const a = t * 0.05;
  return { pos: [Math.sin(a) * 78, 26 + Math.sin(t * 0.13) * 4, Math.cos(a) * 78], target: [0, 2, 0], fov: 45 };
}

/** Rotate a delivery-frame point into world space for the current ends (frameYaw 0 or π). */
export function toWorld([x, y, z], frameYaw) {
  const c = Math.cos(frameYaw), s = Math.sin(frameYaw);
  return [x * c + z * s, y, -x * s + z * c];
}
