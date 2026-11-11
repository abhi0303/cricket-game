// Central configuration for bowling / ball physics. Every tunable physics number lives here,
// so behaviour can be adjusted without touching gameplay code.
//
// Coordinates: the "delivery frame". Striker's stumps at z = +10.06, bowler's stumps at z = -10.06,
// x > 0 = off side of a right-handed batter, y up. Distances in metres, times in seconds.

export const PHYSICS = {
  gravity: 9.81,
  ballRadius: 0.036,            // regulation ball ≈ 72 mm diameter
  ballMass: 0.16,               // kg (reference only; drag below is already per unit mass)
  // Quadratic air drag per unit mass: a = -k |v| v, k = ½ ρ Cd A / m ≈ ½·1.2·0.45·0.00407/0.16
  dragK: 0.0068,
  integrationDt: 1 / 720,       // fixed physics step for precomputing the delivery (frame-rate independent)
  maxFlightTime: 3.5,

  pitch: {
    length: 20.12,              // stumps to stumps (22 yards)
    half: 10.06,                // stumps at ±half
    popping: 8.84,              // popping (batting) crease at ±popping
    stumpHalfWidth: 0.1143,
    stumpHeight: 0.711,
    returnCrease: 1.32,
    wideOff: 0.9,
    wideLeg: -0.6,
    headHeight: 1.85,
    width: 3.05,
  },

  release: {
    z: -8.5,                    // just ahead of the bowler's popping crease (front-foot landing)
    x: 0.32,                    // right-arm over the wicket
    xJitter: 0.03,
    heightPace: 2.18,
    heightSpin: 1.96,
  },

  // The striker's hitting zone: from the furthest front-foot reach to the stumps.
  // "Reaction time after bounce" = pitch -> zStart. "Total travel" = release -> travelEndZ (the striker's stumps,
  // the far end of the 22 yards, matching the 20.12 m baseline).
  hittingZone: { zStart: 7.6, zEnd: 10.06 },
  travelEndZ: 10.06,
  batterZ: 9.1,                 // stance line, used for 'height at the batter'

  // Batter body volume used for body / helmet collisions (relative to the stance line).
  body: { halfWidth: 0.2, yMin: 0.95, yMax: 1.9, helmetFrom: 1.55 },

  // Selectable bowling speeds (km/h). velocity (m/s) = kph / 3.6
  speeds: [150, 145, 140, 130, 125, 115, 100, 95, 85, 70],
  speedJitterKph: 0,            // optional random variation of the release speed (0 = exact)

  // Which speeds each bowling type may select (debug mode unlocks all).
  speedRanges: {
    fast: [125, 150],
    'fast-medium': [115, 145],
    medium: [95, 140],
    'off-spin': [70, 100],
    'leg-spin': [70, 95],
  },
  stockHeadroomKph: 6,          // a bowler can bowl up to this much above their natural stock pace
  fatigueSpeedLossKph: 8,       // max speed lost from the top of the range when fully tired

  // Delivery lengths: pitching distance measured back from the batsman's stumps.
  // Steeper (shorter) deliveries hit the pitch with more vertical speed, so they rise higher even with
  // similar restitution; the values below are tuned for realistic heights at the batter.
  //   restitution: vertical bounce coefficient (pace); retention: horizontal speed kept after pitching.
  lengthOrder: ['yorker', 'fullToss', 'full', 'good', 'backOfLength', 'shortOfLength', 'short', 'bouncer'],
  lengths: {
    yorker:        { label: 'Yorker',            range: [0, 1],   restitution: 0.40, retention: 0.92 },
    fullToss:      { label: 'Full Toss',         range: null,     heightRange: [0.45, 0.95], restitution: 0.5, retention: 0.9 },
    full:          { label: 'Full Length',       range: [2, 4],   restitution: 0.47, retention: 0.9 },
    good:          { label: 'Good Length',       range: [6, 8],   restitution: 0.53, retention: 0.88 },   // ~0.63 m at the batter (140 km/h)
    backOfLength:  { label: 'Back of a Length',  range: [8, 10],  restitution: 0.55, retention: 0.87 },   // ~0.95 m (hip)
    shortOfLength: { label: 'Short of a Length', range: [10, 12], restitution: 0.5,  retention: 0.86 },   // ~1.2 m (waist/chest)
    short:         { label: 'Short Ball',        range: [12, 14], restitution: 0.41, retention: 0.86 },   // ~1.4 m (chest), more time after pitching
    bouncer:       { label: 'Bouncer',           range: [12, 14], restitution: 0.445, retention: 0.85 },  // ~1.65 m (shoulder/head): hits the deck harder
  },
  bounceVariation: 0.03,        // ± fraction of random restitution variation per delivery (pitch inconsistency)
  spinBounce: { restitution: 0.86, retention: 0.92 },   // multipliers for spinners (slower, grippier)
  effortBounce: 0.05,           // extra restitution at full "power" (hitting the deck hard)
  laterBounce: { restitution: 0.45, retention: 0.8, rollBelow: 0.6, rollDecel: 2.5 },

  solver: { iterations: 6, tolerance: 0.004 },          // drag-aware aiming at the pitching point

  // Classification of where a ball actually pitched (for HUD / commentary).
  lengthBands: [[1.5, 'yorker'], [5, 'full'], [8, 'good'], [10, 'backOfLength'], [12, 'shortOfLength'], [Infinity, 'short']],
};

export const PITCH = Object.freeze({ ...PHYSICS.pitch });
export const BALL_R = PHYSICS.ballRadius;
export const G = PHYSICS.gravity;

export const kphToMs = kph => kph / 3.6;

/** Constant-speed baseline time over the 22-yard pitch: 20.12 m / v. */
export function baselineTravelTime(kph, distance = PHYSICS.pitch.length) {
  return distance / kphToMs(kph);
}

export function lengthDef(id) { return PHYSICS.lengths[id] || PHYSICS.lengths.good; }

/** Middle of a length's range (or a sensible full-toss height). */
export function defaultLengthTarget(id) {
  const L = lengthDef(id);
  if (!L.range) return { len: -0.8, height: (L.heightRange[0] + L.heightRange[1]) / 2 };
  return { len: (L.range[0] + L.range[1]) / 2 };
}

/** Keep a pitching target inside its length's range. */
export function clampToLength(id, len) {
  const L = lengthDef(id);
  if (!L.range) return -0.8;
  return Math.max(L.range[0], Math.min(L.range[1], len));
}

/** Which length band an actual pitching distance falls in. */
export function classifyPitch(len) {
  if (len == null) return 'fullToss';
  for (const [max, id] of PHYSICS.lengthBands) if (len < max) return id;
  return 'short';
}

/** Speeds a bowler may choose (natural pace + headroom, reduced when tired). */
export function allowedSpeeds(bowlingType, stockKph, { fatigue = 0, unlockAll = false } = {}) {
  if (unlockAll) return PHYSICS.speeds.slice();
  const [lo, hi] = PHYSICS.speedRanges[bowlingType] || [95, 140];
  const cap = Math.min(hi, stockKph + PHYSICS.stockHeadroomKph - fatigue * PHYSICS.fatigueSpeedLossKph);
  let list = PHYSICS.speeds.filter(s => s >= lo && s <= cap);
  if (list.length < 2) list = PHYSICS.speeds.filter(s => s >= lo && s <= hi).slice(-2);
  return list.sort((a, b) => b - a);
}

/** The allowed speed closest to a bowler's natural pace. */
export function stockSpeed(bowlingType, stockKph, opts) {
  const list = allowedSpeeds(bowlingType, stockKph, opts);
  return list.reduce((best, s) => (Math.abs(s - stockKph) < Math.abs(best - stockKph) ? s : best), list[0]);
}
