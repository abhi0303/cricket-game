// Net practice set-up: the bowler the player picks (type, pace, deliveries, accuracy), how each ball is
// chosen from those settings, and the running session stats. Plain data and pure functions (unit tested).

import { BOWLING_TYPES, normalizePlayer, batScore } from './PlayerAttributes.js';
import { PHYSICS, lengthDef } from './PhysicsConfig.js';
import { deliveryTypesFor } from './BallPhysics.js';
import { chooseDelivery } from '../ai/BowlingAI.js';
import { clamp } from '../utils/Random.js';

export const NET_TYPES = ['fast', 'fast-medium', 'medium', 'off-spin', 'leg-spin'];

// Speed slider limits, the default fixed speed and the default random range for each type (km/h).
export const NET_SPEEDS = {
  fast:          { min: 120, max: 160, fixed: 145, random: [120, 150], blurb: 'Express pace' },
  'fast-medium': { min: 110, max: 145, fixed: 135, random: [120, 140], blurb: 'Hits the seam' },
  medium:        { min: 95,  max: 135, fixed: 122, random: [110, 130], blurb: 'Swing bowler' },
  'off-spin':    { min: 65,  max: 100, fixed: 85,  random: [78, 92],   blurb: 'Turns into the bat' },
  'leg-spin':    { min: 65,  max: 100, fixed: 82,  random: [75, 90],   blurb: 'Leg breaks and googlies' },
};

export const NET_ACCURACY = {
  wayward:  { label: 'Wayward (club bowler)', rating: 55, quality: 0.62, spread: 1.25 },
  steady:   { label: 'Steady (first-class)', rating: 78, quality: 0.82, spread: 0.85 },
  pinpoint: { label: 'Pinpoint (international)', rating: 94, quality: 0.97, spread: 0.45 },
};

export const NET_MOVEMENT = {
  little: { label: 'A little', rating: 35 },
  normal: { label: 'Normal', rating: 68 },
  big:    { label: 'Big swing / turn', rating: 95 },
};

// Line at pitching (m, + = off side of a right-hander). Mixed = the bowler's own plans.
export const NET_LINES = {
  mixed:      { label: 'Mixed (bowler plans)', x: null },
  offStump:   { label: 'Off stump', x: 0.1 },
  corridor:   { label: 'Outside off (corridor)', x: 0.32 },
  wide:       { label: 'Wide outside off', x: 0.62 },
  middle:     { label: 'Middle stump', x: 0 },
  legStump:   { label: 'Leg stump / pads', x: -0.14 },
};

// How the delivery plays on screen. "Real time" is Hard with no slow motion.
export const NET_DIFFICULTY = {
  easy:   { label: 'Easy (slowed down)', base: 'easy' },
  normal: { label: 'Normal', base: 'normal' },
  hard:   { label: 'Hard', base: 'hard' },
  real:   { label: 'Real time (no slow motion)', base: 'hard', realTime: true },
};

const BOWLER_NAMES = { fast: 'Express Quick', 'fast-medium': 'Seam Bowler', medium: 'Swing Bowler', 'off-spin': 'Off-Spinner', 'leg-spin': 'Leg-Spinner' };

export const NETS_TEAM = Object.freeze({ id: 'nets', name: 'Net Bowlers', short: 'NET', primary: '#24324a', secondary: '#f4d35e' });

/** The batter who faces by default: the top of the batting order, else the best batter. */
export function defaultNetBatter(team) {
  if (!team?.players?.length) return null;
  const first = team.battingOrder?.map(id => team.players.find(p => p.id === id)).find(Boolean);
  return first || team.players.slice().sort((a, b) => batScore(b) - batScore(a))[0];
}

/** A complete, valid nets configuration (missing or out-of-range values fall back to defaults). */
export function normalizeNetsConfig(c = {}, team = null) {
  const type = NET_TYPES.includes(c.type) ? c.type : 'fast';
  const S = NET_SPEEDS[type];
  const num = (v, d) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
  let lo = clamp(num(c.speedMin, S.random[0]), S.min, S.max);
  let hi = clamp(num(c.speedMax, S.random[1]), S.min, S.max);
  if (lo > hi) [lo, hi] = [hi, lo];
  const variations = ['mixed', ...deliveryTypesFor({ bowlingType: type }).map(d => d.id)];
  const lengths = ['mixed', ...PHYSICS.lengthOrder];
  const batterOk = team?.players?.some(p => p.id === c.batterId);
  return {
    type,
    speedMode: c.speedMode === 'random' ? 'random' : 'fixed',
    speed: clamp(num(c.speed, S.fixed), S.min, S.max),
    speedMin: lo,
    speedMax: hi,
    variation: variations.includes(c.variation) ? c.variation : 'mixed',
    length: lengths.includes(c.length) ? c.length : 'mixed',
    line: NET_LINES[c.line] ? c.line : 'mixed',
    accuracy: NET_ACCURACY[c.accuracy] ? c.accuracy : 'steady',
    movement: NET_MOVEMENT[c.movement] ? c.movement : 'normal',
    difficulty: NET_DIFFICULTY[c.difficulty] ? c.difficulty : 'normal',
    batterId: batterOk ? c.batterId : (defaultNetBatter(team)?.id ?? null),
  };
}

/** Switch bowler type: the speeds reset to that type's defaults; the other choices stay where they make sense. */
export function withNetType(cfg, type, team = null) {
  const S = NET_SPEEDS[type] || NET_SPEEDS.fast;
  return normalizeNetsConfig({ ...cfg, type, speed: S.fixed, speedMin: S.random[0], speedMax: S.random[1], variation: 'mixed' }, team);
}

/** The computer bowler built from the settings. */
export function netBowler(cfg) {
  return normalizePlayer({
    id: `nets-${cfg.type}`, name: BOWLER_NAMES[cfg.type] || 'Net Bowler', number: NET_TYPES.indexOf(cfg.type) + 31,
    role: 'bowler', battingStyle: 'tailender', bowlingType: cfg.type,
    bowlAccuracy: NET_ACCURACY[cfg.accuracy].rating, bowlMovement: NET_MOVEMENT[cfg.movement].rating,
    bowlSpeed: 70, bowlStamina: 90, fielding: 70, catching: 70, batting: 20, timing: 20, aggression: 30,
  });
}

/** Stand-in for the players a delivery needs but the nets don't use (keeper, non-striker). */
export function netExtra(id) {
  return normalizePlayer({ id: `nets-${id}`, name: 'Net', number: 0, role: 'wicketkeeper', battingStyle: 'tailender', fielding: 60, catching: 60 });
}

/** Pace for the next ball: the fixed speed, or a whole number anywhere in the random range (inclusive). */
export function netSpeed(cfg, rng) {
  if (cfg.speedMode !== 'random') return cfg.speed;
  return cfg.speedMin + Math.min(cfg.speedMax - cfg.speedMin, Math.floor(rng.next() * (cfg.speedMax - cfg.speedMin + 1)));
}

/**
 * The next delivery. "Mixed" choices come from the computer bowler's own plans (so a mixed length gets a
 * realistic spread of yorkers, good-length balls and bouncers); fixed choices are always honoured.
 */
export function netSpec(cfg, bowler, batter, rng, lastSpecs = []) {
  const situation = { phaseOfInnings: rng.chance(0.2) ? 'death' : 'middle' };
  const base = chooseDelivery({ bowler, batter, situation, ballsFaced: rng.chance(0.4) ? 2 : 12, rng, difficulty: 'normal', isCpuVsUser: true, lastSpecs });
  const spec = { ...base, target: { ...base.target } };
  if (cfg.length !== 'mixed') {
    const L = lengthDef(cfg.length);
    spec.length = cfg.length;
    spec.target = { x: spec.target.x };
    if (L.range) spec.target.len = rng.range(L.range[0], L.range[1]);
    else spec.target.height = rng.range(L.heightRange[0], L.heightRange[1]);
    if (cfg.length === 'bouncer' || cfg.length === 'short') spec.power = Math.min(spec.power, 0.3);
  }
  if (cfg.line !== 'mixed') spec.target.x = NET_LINES[cfg.line].x + rng.gauss(0, 0.04);
  if (cfg.variation !== 'mixed') spec.type = cfg.variation;
  const A = NET_ACCURACY[cfg.accuracy];
  spec.speedKph = netSpeed(cfg, rng);
  spec.quality = clamp(rng.gauss(A.quality, 0.05), 0.3, 1);
  spec.spreadMult = A.spread;
  spec.overstep = false;
  return spec;
}

/** Short label for the HUD, e.g. "Fast · 145 km/h" or "Leg-spin · 75–90 km/h". */
export function netsLabel(cfg) {
  const t = BOWLING_TYPES[cfg.type]?.label || cfg.type;
  return `${t} · ${cfg.speedMode === 'random' ? `${cfg.speedMin}–${cfg.speedMax}` : cfg.speed} km/h`;
}

// ------------------------------------------------------------------ outcome of one ball
const OUT_TEXT = { bowled: 'BOWLED!', lbw: 'LBW!', hitwicket: 'HIT WICKET!', stumped: 'STUMPED!' };
const TIMING_TEXT = { perfect: 'Perfect timing', good: 'Good timing', early: 'Early', late: 'Late', 'missed-early': 'Way too early', 'missed-late': 'Too late' };

/**
 * What one ball in the nets was worth. r = NetsDeliverySim.result().
 * Returns { main, sub, kind (banner style), chip (history), runs, out, middled }.
 */
export function netOutcome(r) {
  const p = r.projection;
  const timing = TIMING_TEXT[r.timing] || '';
  const shotLine = [r.contact ? r.desc : r.shot, timing].filter(Boolean).join(' · ');
  const middled = !!r.contact && !r.edge && (r.timing === 'perfect' || r.timing === 'good');
  const base = { runs: 0, out: false, middled };
  if (r.dismissal) {
    const main = r.desc === 'Played on!' ? 'PLAYED ON!' : OUT_TEXT[r.dismissal.type] || 'OUT!';
    return { ...base, main, sub: [r.desc !== main ? r.desc : '', r.shot && r.shot !== 'Leave' ? r.shot : ''].filter(s => s && s.toUpperCase() !== main).join(' · '), kind: 'wicket', chip: 'W', out: true };
  }
  if (r.contact && p) {
    switch (p.kind) {
      case 'six': return { ...base, main: 'SIX!', sub: `${shotLine} · ${p.where}`, kind: 'six', chip: '6', runs: 6 };
      case 'four': return { ...base, main: 'FOUR!', sub: `${shotLine} · ${p.where}`, kind: 'four', chip: '4', runs: 4 };
      case 'caught': return { ...base, main: 'CAUGHT!', sub: `${shotLine} · would be caught ${p.where}`, kind: 'wicket', chip: 'C', out: true };
      case 'chance': return { ...base, main: 'CHANCE', sub: `${shotLine} · a diving chance ${p.where}`, kind: 'x', chip: '•' };
      case 'runs': return { ...base, main: `${p.runs} RUN${p.runs > 1 ? 'S' : ''}`, sub: `${shotLine} · ${p.where}`, kind: '', chip: String(p.runs), runs: p.runs };
      default: return { ...base, main: 'DOT BALL', sub: [shotLine, p.where].filter(Boolean).join(' · '), kind: '', chip: '•' };
    }
  }
  if (r.bodyHit) return { ...base, main: r.desc === 'Hit on the helmet!' ? 'ON THE HELMET' : 'HIT ON THE BODY', sub: shotLine, kind: 'x small', chip: '•' };
  if (r.padHit) return { ...base, main: 'ON THE PADS', sub: [r.appealDenied ? 'Appeal turned down' : '', shotLine].filter(Boolean).join(' · '), kind: 'small', chip: '•' };
  if (r.extra === 'wide') return { ...base, main: 'WIDE', sub: 'Too wide to reach', kind: 'x small', chip: 'wd' };
  if (r.beaten) return { ...base, main: 'BEATEN', sub: shotLine || 'Played and missed', kind: 'small', chip: '•' };
  if (r.left) return { ...base, main: 'LEFT ALONE', sub: 'Well left', kind: 'small', chip: '•' };
  return { ...base, main: 'NO SHOT', sub: 'Through to the back net', kind: 'small', chip: '•' };
}

// ------------------------------------------------------------------ session stats
export function emptyNetStats() {
  return { balls: 0, runs: 0, fours: 0, sixes: 0, outs: 0, dots: 0, shots: 0, contact: 0, middled: 0, edges: 0, beaten: 0, history: [] };
}

/** Add one ball to the session (r = sim result, o = netOutcome(r)). Returns the same stats object. */
export function addNetBall(s, r, o) {
  s.balls++;
  s.runs += o.runs;
  if (o.runs === 4) s.fours++;
  if (o.runs === 6) s.sixes++;
  if (o.out) s.outs++;
  if (!o.runs && !o.out) s.dots++;
  if (r.shot && r.shot !== 'Leave') s.shots++;
  if (r.contact) s.contact++;
  if (o.middled) s.middled++;
  if (r.edge) s.edges++;
  if (r.beaten) s.beaten++;
  s.history = [...s.history, o.chip].slice(-8);
  return s;
}

/** Share of the shots played (leaves don't count) that came out of the middle of the bat; null before the first shot. */
export function middledPct(s) { return s.shots ? Math.round(s.middled / s.shots * 100) : null; }
