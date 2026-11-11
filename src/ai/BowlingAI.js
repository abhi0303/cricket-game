// Computer bowling and captaincy: delivery plans per batter and situation,
// bowler rotation and field settings. Simple state-based rules.

import { BOWLING_TYPES, bowlScore, battingStyleMods, bowlerKph } from '../game/PlayerAttributes.js';
import { PHYSICS, allowedSpeeds, stockSpeed, lengthDef } from '../game/PhysicsConfig.js';
import { deliveryTypesFor } from '../game/BallPhysics.js';
import { clamp } from '../utils/Random.js';
import { diff } from '../game/Difficulty.js';

// Plans: [variation, line x, length id, pitching distance (null = anywhere in the range), speed: 'stock' | 'slower' | 'quick']
const PACE_PLANS = {
  probe:   [['stock', 0.08, 'good', 6.3], ['outswing', 0.02, 'good', 6.5], ['inswing', 0.14, 'good', 6.2], ['stock', 0.2, 'backOfLength', 8.4]],
  attack:  [['outswing', 0.04, 'good', 6.0], ['inswing', 0.12, 'full', 3.8], ['stock', 0.24, 'bouncer', 12.2, 'quick'], ['stock', 0.06, 'good', 6.4], ['outswing', 0.1, 'full', 3.6]],
  contain: [['stock', 0.28, 'backOfLength', 8.6], ['stock', 0.15, 'good', 6.8, 'slower'], ['stock', 0.38, 'good', 7.2], ['stock', 0.18, 'yorker', 0.7]],
  death:   [['stock', 0.04, 'yorker', 0.6], ['stock', 0.45, 'yorker', 0.8], ['stock', 0.25, 'good', 7.0, 'slower'], ['stock', 0.26, 'bouncer', 12.2], ['stock', 0.38, 'backOfLength', 8.8], ['stock', 0.2, 'shortOfLength', 10.4, 'slower']],
};
const SPIN_PLANS = {
  probe:   [['stock', 0.1, 'full', 3.9], ['flighted', 0.14, 'full', 3.3], ['quicker', 0.02, 'good', 6.0], ['variation', 0.06, 'full', 3.9]],
  attack:  [['flighted', 0.16, 'full', 3.0], ['stock', 0.08, 'full', 3.6], ['variation', 0.08, 'full', 3.7]],
  contain: [['quicker', 0.05, 'good', 6.2], ['stock', 0.02, 'good', 6.0], ['quicker', 0.3, 'good', 6.4]],
  death:   [['quicker', 0.0, 'good', 6.1], ['stock', 0.4, 'full', 3.9], ['quicker', 0.1, 'yorker', 0.8]],
};

export function bowlingMode(batter, situation = {}, ballsFaced = 0) {
  const s = situation;
  const aggr = battingStyleMods(batter).aiAggression;
  if (s.phaseOfInnings === 'death') return 'death';
  if (ballsFaced < 6) return 'attack';
  if (s.target != null && s.rrr != null && s.rrr > 10) return 'contain';
  if (s.target != null && s.rrr != null && s.rrr < 6 && s.wicketsLeft > 4) return 'attack';
  if (aggr > 0.6) return 'contain';
  if (s.phaseOfInnings === 'early') return 'attack';
  return 'probe';
}

/**
 * Choose the next delivery for a computer bowler.
 * @returns spec {type, target:{x,len}, power, quality, overstep, mode}
 */
export function chooseDelivery({ bowler, batter, situation, ballsFaced = 0, rng, difficulty = 'normal', isCpuVsUser = true, lastSpecs = [], fatigue = 0 }) {
  const D = diff(difficulty);
  const kind = BOWLING_TYPES[bowler.bowlingType]?.kind || 'pace';
  const mode = bowlingMode(batter, situation, ballsFaced);
  const plans = (kind === 'spin' ? SPIN_PLANS : PACE_PLANS)[mode];
  const valid = deliveryTypesFor(bowler).map(d => d.id);
  // Avoid repeating the same delivery three times in a row.
  const recent = lastSpecs.slice(-2).map(s => s.type);
  let plan = rng.pick(plans);
  for (let i = 0; i < 3 && recent.length === 2 && recent.every(t => t === plan[0]); i++) plan = rng.pick(plans);
  const [type, x, length, len, pace] = plan;
  const [qMean, qSd] = isCpuVsUser ? D.cpuBowlQuality : [0.75, 0.14];
  const quality = clamp(rng.gauss(qMean + (bowler.bowlAccuracy - 70) / 400, qSd), 0.05, 1);
  const overstep = rng.chance(isCpuVsUser ? D.cpuOverstep : 0.008);
  // Short balls are bowled with control rather than maximum effort (extra effort makes them sail over head).
  const power = kind === 'pace' ? clamp(rng.range(0.1, 0.55) + (mode === 'attack' ? 0.2 : 0), 0, 1) * (length === 'bouncer' ? 0.3 : 1) : rng.range(0, 0.3);
  // Speed: the bowler's stock pace, a disguised slower ball, or an effort ball one step up.
  const options = allowedSpeeds(bowler.bowlingType, bowlerKph(bowler), { fatigue });
  const stock = stockSpeed(bowler.bowlingType, bowlerKph(bowler), { fatigue });
  let speedKph = stock;
  const below = PHYSICS.speeds.filter(v => v <= stock - 15);
  const above = options.filter(v => v > stock);
  if (pace === 'slower' && below.length && kind === 'pace') speedKph = below[0];
  else if (pace === 'quick' && above.length && rng.chance(0.3)) speedKph = above[above.length - 1];
  else if (kind === 'spin' && rng.chance(0.25)) speedKph = rng.pick(options);
  const L = lengthDef(length);
  const target = { x: x + rng.gauss(0, 0.08) };
  if (L.range) target.len = clamp((len ?? (L.range[0] + L.range[1]) / 2) + rng.gauss(0, 0.35), L.range[0], L.range[1]);
  else target.height = rng.range(L.heightRange[0], L.heightRange[1]);
  return {
    type: valid.includes(type) ? type : 'stock',
    length,
    target,
    speedKph,
    power,
    quality,
    overstep,
    mode,
  };
}

/** Pick a bowler for the next over from the eligible list. */
export function chooseBowler({ engine, eligible, rng }) {
  const sit = engine.situation();
  const players = eligible.map(id => engine.player(id));
  const totalOvers = engine.config.overs;
  const cap = engine.maxOversPerBowler();
  const oversLeft = totalOvers - Math.floor(sit.legalBalls / 6);
  return rng.weighted(players, p => {
    const kind = BOWLING_TYPES[p.bowlingType]?.kind;
    let w = Math.pow(bowlScore(p) / 60, 3);
    const fatigue = engine.fatigueOf(p.id);
    w *= 1 - fatigue * 0.7;
    if (sit.phaseOfInnings === 'death' && kind === 'pace') w *= 1.6;
    if (sit.phaseOfInnings === 'early' && kind === 'pace') w *= 1.5;
    if (sit.phaseOfInnings === 'middle' && kind === 'spin') w *= 1.5;
    // Keep overs from the best bowlers for later if plenty remain.
    const used = engine.oversBowledBy(p.id);
    if (oversLeft > cap * 2 && used >= cap - 1) w *= 0.5;
    return Math.max(0.01, w);
  }).id;
}

/** Field preset for this over/batter. strategy: 'auto' | 'attacking' | 'balanced' | 'defensive' */
export function chooseField({ bowler, situation, strategy = 'auto', newBatter = false }) {
  const kind = BOWLING_TYPES[bowler.bowlingType]?.kind || 'pace';
  if (strategy === 'attacking') return kind === 'spin' ? 'spin' : 'attacking';
  if (strategy === 'defensive') return situation?.phaseOfInnings === 'death' ? 'death' : 'defensive';
  if (strategy === 'balanced') return 'balanced';
  const s = situation || {};
  if (s.phaseOfInnings === 'death') return 'death';
  // Defending a big lead: protect the boundary. Need wickets: attack.
  if (s.target != null && s.rrr != null) {
    if (s.rrr > 11) return 'defensive';
    if (s.rrr < 6 && s.wicketsLeft > 3) return kind === 'spin' ? 'spin' : 'attacking';
  }
  if (newBatter) return kind === 'spin' ? 'spin' : 'attacking';
  if (s.phaseOfInnings === 'early') return kind === 'spin' ? 'spin' : 'attacking';
  return kind === 'spin' ? 'spin' : 'balanced';
}
