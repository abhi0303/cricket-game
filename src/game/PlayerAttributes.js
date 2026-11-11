// Player roles, styles and ratings. Everything here is plain data + pure functions
// so it can be used by the UI, the simulation and the Node tests alike.

import { clamp, uid } from '../utils/Random.js';

export const ROLE = Object.freeze({
  BATSMAN: 'batsman',
  WICKETKEEPER: 'wicketkeeper',
  ALLROUNDER: 'allrounder',
  BOWLER: 'bowler',
});

export const ROLE_LABELS = {
  batsman: 'Batsman',
  wicketkeeper: 'Wicketkeeper',
  allrounder: 'All-rounder',
  bowler: 'Bowler',
};
export const ROLE_SHORT = { batsman: 'BAT', wicketkeeper: 'WK', allrounder: 'AR', bowler: 'BOWL' };

export const BAT_STYLE_LABELS = {
  attacker: 'Attacker',
  defensive: 'Defensive',
  balanced: 'Balanced',
  tailender: 'Tail-ender',
};

// Which batting styles each role may use. A wicketkeeper with "tailender" style is a
// keeper-only player: they keep wicket but are not batting-capable for the top six.
export const BAT_STYLES_FOR_ROLE = {
  batsman: ['attacker', 'defensive'],
  wicketkeeper: ['attacker', 'defensive', 'tailender'],
  allrounder: ['attacker', 'balanced', 'defensive'],
  bowler: ['tailender'],
};

export const TECHNIQUES = {
  'front-foot': { label: 'Front-foot driver', short: 'Front foot' },
  'back-foot': { label: 'Back-foot player', short: 'Back foot' },
  balanced: { label: 'Balanced', short: 'Balanced' },
  sweeper: { label: 'Sweep specialist', short: 'Sweeper' },
};

export const AR_TYPES = { batting: 'Batting all-rounder', bowling: 'Bowling all-rounder' };

// Bowling types and how they behave in the ball physics.
export const BOWLING_TYPES = {
  fast: { kind: 'pace', label: 'Fast', short: 'FAST', baseKph: 141, kphPerPoint: 0.3, swing: 0.9, seam: 1.15, accuracyMod: -5, staminaDrain: 1.35, bounce: 1.08 },
  'fast-medium': { kind: 'pace', label: 'Fast-medium', short: 'FM', baseKph: 131, kphPerPoint: 0.25, swing: 1.1, seam: 1.0, accuracyMod: 0, staminaDrain: 1.1, bounce: 1.0 },
  medium: { kind: 'pace', label: 'Medium pace', short: 'MED', baseKph: 121, kphPerPoint: 0.22, swing: 1.3, seam: 0.85, accuracyMod: 5, staminaDrain: 0.85, bounce: 0.95 },
  'off-spin': { kind: 'spin', label: 'Off-spin', short: 'OS', baseKph: 86, kphPerPoint: 0.16, turn: 1.0, flight: 0.9, drift: 0.5, accuracyMod: 6, staminaDrain: 0.6, bounce: 0.92, turnSign: -1 },
  'leg-spin': { kind: 'spin', label: 'Leg-spin', short: 'LS', baseKph: 82, kphPerPoint: 0.16, turn: 1.5, flight: 1.2, drift: 0.8, accuracyMod: -4, staminaDrain: 0.65, bounce: 1.02, turnSign: 1 },
};
export const PACE_TYPES = ['fast', 'fast-medium', 'medium'];
export const SPIN_TYPES = ['off-spin', 'leg-spin'];

export const isBowlingType = t => !!BOWLING_TYPES[t];
export const isSpinType = t => SPIN_TYPES.includes(t);
export const isPaceType = t => PACE_TYPES.includes(t);
export const bowlingKind = t => (BOWLING_TYPES[t] ? BOWLING_TYPES[t].kind : null);

export const RATING_KEYS = ['batting', 'aggression', 'timing', 'bowlAccuracy', 'bowlSpeed', 'bowlMovement', 'bowlStamina', 'fielding', 'catching'];
export const RATING_LABELS = {
  batting: 'Batting skill',
  aggression: 'Batting aggression',
  timing: 'Timing & shot control',
  bowlAccuracy: 'Bowling accuracy',
  bowlSpeed: 'Bowling speed',
  bowlMovement: 'Swing / turn',
  bowlStamina: 'Bowling stamina',
  fielding: 'Fielding',
  catching: 'Catching',
};
export const BOWLING_RATING_KEYS = ['bowlAccuracy', 'bowlSpeed', 'bowlMovement', 'bowlStamina'];

export const canBowl = p => isBowlingType(p.bowlingType) && (p.role === ROLE.BOWLER || p.role === ROLE.ALLROUNDER);

/**
 * Which designated XI slot a player fills, decided only by their configured role and style:
 *  'attacker' | 'defensive' | 'allrounder' | 'spinner' | 'pace' | 'keeperOnly' | 'invalid'
 * Wicketkeepers fill a batting slot only if configured as Attacker or Defensive.
 */
export function slotCategory(p) {
  switch (p.role) {
    case ROLE.BATSMAN:
      if (p.battingStyle === 'attacker') return 'attacker';
      if (p.battingStyle === 'defensive') return 'defensive';
      return 'invalid';
    case ROLE.WICKETKEEPER:
      if (p.battingStyle === 'attacker') return 'attacker';
      if (p.battingStyle === 'defensive') return 'defensive';
      return 'keeperOnly';
    case ROLE.ALLROUNDER:
      return isBowlingType(p.bowlingType) ? 'allrounder' : 'invalid';
    case ROLE.BOWLER:
      if (isSpinType(p.bowlingType)) return 'spinner';
      if (isPaceType(p.bowlingType)) return 'pace';
      return 'invalid';
    default:
      return 'invalid';
  }
}

export const SLOT_LABELS = {
  attacker: 'Attacker',
  defensive: 'Defensive batsman',
  allrounder: 'All-rounder',
  spinner: 'Specialist spinner',
  pace: 'Fast/medium bowler',
  keeperOnly: 'Keeper only',
  invalid: 'Invalid setup',
};

export function batScore(p) { return 0.55 * p.batting + 0.45 * p.timing; }
export function bowlScore(p) {
  if (!isBowlingType(p.bowlingType)) return 0;
  return 0.4 * p.bowlAccuracy + 0.25 * p.bowlMovement + 0.2 * p.bowlSpeed + 0.15 * p.bowlStamina;
}
export function fieldScore(p) { return 0.5 * p.fielding + 0.5 * p.catching; }

export function overallRating(p) {
  let v;
  switch (p.role) {
    case ROLE.BATSMAN: v = 0.86 * batScore(p) + 0.14 * fieldScore(p); break;
    case ROLE.WICKETKEEPER:
      v = p.battingStyle === 'tailender'
        ? 0.25 * batScore(p) + 0.6 * p.catching + 0.15 * p.fielding
        : 0.52 * batScore(p) + 0.38 * p.catching + 0.1 * p.fielding;
      break;
    case ROLE.ALLROUNDER:
      v = p.arType === 'bowling'
        ? 0.36 * batScore(p) + 0.54 * bowlScore(p) + 0.1 * fieldScore(p)
        : 0.54 * batScore(p) + 0.36 * bowlScore(p) + 0.1 * fieldScore(p);
      v += 4; // being useful at both is worth something
      break;
    case ROLE.BOWLER: v = 0.86 * bowlScore(p) + 0.14 * fieldScore(p); break;
    default: v = 40;
  }
  return Math.round(clamp(v, 1, 99));
}

/** Bowling speed in km/h for a player's stock delivery. */
export function bowlerKph(p) {
  const t = BOWLING_TYPES[p.bowlingType];
  if (!t) return 0;
  return t.baseKph + (p.bowlSpeed - 50) * t.kphPerPoint;
}

const DEFAULT_RATINGS = {
  batting: 50, aggression: 50, timing: 50,
  bowlAccuracy: 20, bowlSpeed: 20, bowlMovement: 20, bowlStamina: 20,
  fielding: 60, catching: 60,
};

/** Returns a cleaned-up copy of a player so every field is valid for its role. */
export function normalizePlayer(input) {
  const p = { ...input };
  p.id = p.id || uid('p');
  p.name = String(p.name ?? '').slice(0, 24);
  p.number = Math.round(Number(p.number) || 0);
  if (!ROLE_LABELS[p.role]) p.role = ROLE.BATSMAN;
  const styles = BAT_STYLES_FOR_ROLE[p.role];
  if (!styles.includes(p.battingStyle)) p.battingStyle = styles[0];
  if (!TECHNIQUES[p.technique]) p.technique = 'balanced';
  if (p.role === ROLE.BATSMAN || p.role === ROLE.WICKETKEEPER) {
    p.bowlingType = null;
  } else if (!isBowlingType(p.bowlingType)) {
    p.bowlingType = null; // left empty on purpose so validation reports it
  }
  if (p.role === ROLE.ALLROUNDER) { if (!AR_TYPES[p.arType]) p.arType = 'batting'; }
  else p.arType = null;
  for (const k of RATING_KEYS) {
    const v = Number(p[k]);
    p[k] = Math.round(clamp(Number.isFinite(v) ? v : DEFAULT_RATINGS[k], 1, 99));
  }
  p.overall = overallRating(p);
  return p;
}

/** Field-level problems with one player's configuration. */
export function playerProblems(p) {
  const out = [];
  const label = p.name && p.name.trim() ? p.name.trim() : `Player #${p.number || '?'}`;
  if (!p.name || !p.name.trim()) out.push(`${label}: name is empty.`);
  if (!Number.isInteger(p.number) || p.number < 1 || p.number > 99) out.push(`${label}: jersey number must be 1–99.`);
  if (!ROLE_LABELS[p.role]) out.push(`${label}: unknown role.`);
  else if (!BAT_STYLES_FOR_ROLE[p.role].includes(p.battingStyle)) out.push(`${label}: batting style "${p.battingStyle}" is not allowed for a ${ROLE_LABELS[p.role]}.`);
  if ((p.role === ROLE.BOWLER || p.role === ROLE.ALLROUNDER) && !isBowlingType(p.bowlingType)) {
    out.push(`${label}: ${ROLE_LABELS[p.role]}s need a bowling type (all-rounders must be able to bat and bowl).`);
  }
  for (const k of RATING_KEYS) {
    if (!Number.isFinite(p[k]) || p[k] < 1 || p[k] > 99) out.push(`${label}: ${RATING_LABELS[k]} must be between 1 and 99.`);
  }
  return out;
}

/** Short description used on player cards, e.g. "Attacker · Front-foot driver". */
export function playerTagline(p) {
  const parts = [];
  if (p.role === ROLE.WICKETKEEPER) parts.push(p.battingStyle === 'tailender' ? 'Keeper only' : `Keeper-${BAT_STYLE_LABELS[p.battingStyle]}`);
  else if (p.role === ROLE.BATSMAN) parts.push(BAT_STYLE_LABELS[p.battingStyle]);
  else if (p.role === ROLE.ALLROUNDER) parts.push(AR_TYPES[p.arType]);
  if (p.bowlingType) parts.push(BOWLING_TYPES[p.bowlingType].label);
  if (p.role !== ROLE.BOWLER) parts.push(TECHNIQUES[p.technique].short);
  return parts.join(' · ');
}

/** Play-style modifiers used by the shot model and the AI. */
export function battingStyleMods(p) {
  const aggr = p.aggression / 100;
  switch (p.battingStyle) {
    case 'attacker': return { power: 1.0 + aggr * 0.06, risk: 1.22, defendRisk: 1.1, loftBonus: 0.02, windowMult: 0.96, aiAggression: 0.36 + aggr * 0.3 };
    case 'defensive': return { power: 0.92 + aggr * 0.05, risk: 0.88, defendRisk: 0.5, loftBonus: -0.08, windowMult: 1.08, aiAggression: 0.14 + aggr * 0.3 };
    case 'balanced': return { power: 1.0 + aggr * 0.05, risk: 1.0, defendRisk: 0.8, loftBonus: 0, windowMult: 1.0, aiAggression: 0.26 + aggr * 0.32 };
    default: return { power: 0.85, risk: 1.35, defendRisk: 1.3, loftBonus: -0.05, windowMult: 0.85, aiAggression: 0.25 + aggr * 0.5 }; // tail-ender
  }
}
