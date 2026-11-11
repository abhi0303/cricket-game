// Squad creation, playing-XI composition rules and validation.
// Pure functions only (no DOM, no Three.js) so they can be unit tested.

import {
  ROLE, slotCategory, SLOT_LABELS, normalizePlayer, playerProblems, overallRating, canBowl,
  batScore, bowlScore, BOWLING_TYPES,
} from './PlayerAttributes.js';
import { RNG, clamp, uid } from '../utils/Random.js';
import { randomName, CPU_TEAMS } from './NameGenerator.js';

export const SQUAD_SIZE = 15;
export const XI_SIZE = 11;

/**
 * Initial playing-XI configuration:
 *  - 6 designated batting slots: exactly 3 Attackers, exactly 2 Defensive batsmen, at least 1 All-rounder
 *  - 5 full-time bowlers: at least 2 specialist spinners and at least 3 fast/medium bowlers
 *    (with 11 players this works out to exactly 2 + 3)
 *  - exactly 1 wicketkeeper, who must also fill an Attacker or Defensive batting slot
 */
export const XI_RULES = Object.freeze({
  attackers: 3,
  defensive: 2,
  allroundersMin: 1,
  battingSlots: 6,
  bowlersMin: 5,
  spinnersMin: 2,
  paceMin: 3,
  keepers: 1,
  total: XI_SIZE,
});

const nameOf = p => (p && p.name && p.name.trim()) || `#${p?.number ?? '?'}`;
const listNames = (players, max = 4) => {
  const names = players.map(nameOf);
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max} more` : names.join(', ');
};

/** Count XI slot categories for a list of selected players. */
export function countComposition(selected) {
  const c = { attackers: 0, defensive: 0, allrounders: 0, spinners: 0, pace: 0, keepers: 0, keeperOnly: 0, invalid: 0 };
  for (const p of selected) {
    const cat = slotCategory(p);
    if (cat === 'attacker') c.attackers++;
    else if (cat === 'defensive') c.defensive++;
    else if (cat === 'allrounder') c.allrounders++;
    else if (cat === 'spinner') c.spinners++;
    else if (cat === 'pace') c.pace++;
    else if (cat === 'keeperOnly') c.keeperOnly++;
    else c.invalid++;
    if (p.role === ROLE.WICKETKEEPER) c.keepers++;
  }
  c.battingSlots = c.attackers + c.defensive + c.allrounders;
  c.bowlers = c.spinners + c.pace;
  c.total = selected.length;
  return c;
}

/**
 * Validates a playing XI chosen from a squad.
 * @returns {{ok:boolean, errors:{code:string,message:string,players?:string[]}[], lines:object[], counts:object, slots:object}}
 */
export function validatePlayingXI(squad, xiIds) {
  const errors = [];
  const byId = new Map(squad.map(p => [p.id, p]));
  const ids = Array.isArray(xiIds) ? xiIds : [];

  // Unique players only: a player counts once no matter how often they appear.
  const seen = new Set();
  const dupes = new Set();
  const unknown = [];
  const selected = [];
  for (const id of ids) {
    if (seen.has(id)) { dupes.add(id); continue; }
    seen.add(id);
    const p = byId.get(id);
    if (!p) { unknown.push(id); continue; }
    selected.push(p);
  }
  if (dupes.size) errors.push({ code: 'duplicate', message: `A player can only be selected once (${listNames([...dupes].map(id => byId.get(id)).filter(Boolean))}).`, players: [...dupes] });
  if (unknown.length) errors.push({ code: 'unknown', message: `${unknown.length} selected player(s) are not in the squad.` });

  const c = countComposition(selected);
  const remaining = squad.filter(p => !seen.has(p.id));
  const available = cat => remaining.filter(p => slotCategory(p) === cat);
  const selectedOf = cat => selected.filter(p => slotCategory(p) === cat);

  // Broken player setups first: they can't count towards any slot.
  for (const p of selected) {
    const probs = playerProblems(p);
    if (probs.length) errors.push({ code: 'player', message: probs[0], players: [p.id] });
  }

  if (c.total !== XI_RULES.total) {
    errors.push({
      code: 'total',
      message: c.total < XI_RULES.total
        ? `Select ${XI_RULES.total - c.total} more player${XI_RULES.total - c.total > 1 ? 's' : ''} (${c.total}/11).`
        : `Too many players selected (${c.total}/11). Remove ${c.total - XI_RULES.total}.`,
    });
  }

  const exact = (key, count, target, cat, label) => {
    if (count < target) {
      const av = available(cat);
      errors.push({ code: key, message: `Need ${target - count} more ${label}${target - count > 1 ? 's' : ''} (${count}/${target}).${av.length ? ` Available: ${listNames(av)}.` : ' None left in the squad — edit a player\'s role.'}` });
    } else if (count > target) {
      errors.push({ code: key, message: `Too many ${label}s (${count}/${target}). Deselect one of: ${listNames(selectedOf(cat))}.`, players: selectedOf(cat).map(p => p.id) });
    }
  };
  exact('attackers', c.attackers, XI_RULES.attackers, 'attacker', 'Attacker');
  exact('defensive', c.defensive, XI_RULES.defensive, 'defensive', 'Defensive batsman');

  if (c.allrounders < XI_RULES.allroundersMin) {
    const av = available('allrounder');
    errors.push({ code: 'allrounders', message: `An All-rounder must fill one of the 6 batting slots (0/1).${av.length ? ` Available: ${listNames(av)}.` : ' The squad has no all-rounder with a bowling type.'}` });
  }
  if (c.battingSlots > XI_RULES.battingSlots) {
    errors.push({ code: 'battingSlots', message: `Too many designated batters (${c.battingSlots}/6). The 6 batting slots are 3 Attackers, 2 Defensive batsmen and 1 All-rounder.` });
  }

  if (c.spinners < XI_RULES.spinnersMin) {
    const av = available('spinner');
    errors.push({ code: 'spinners', message: `Need ${XI_RULES.spinnersMin - c.spinners} more specialist spinner${XI_RULES.spinnersMin - c.spinners > 1 ? 's' : ''} (${c.spinners}/2). Fast/medium bowlers and all-rounders can't fill a spin slot.${av.length ? ` Available: ${listNames(av)}.` : ''}` });
  }
  if (c.pace < XI_RULES.paceMin) {
    const av = available('pace');
    errors.push({ code: 'pace', message: `Need ${XI_RULES.paceMin - c.pace} more fast/medium bowler${XI_RULES.paceMin - c.pace > 1 ? 's' : ''} (${c.pace}/3). Spinners and all-rounders can't fill a pace slot.${av.length ? ` Available: ${listNames(av)}.` : ''}` });
  }
  if (c.bowlers < XI_RULES.bowlersMin) {
    errors.push({ code: 'bowlers', message: `Pick at least 5 full-time bowlers (${c.bowlers}/5). All-rounders don't count as full-time bowlers.` });
  }
  // With 6 batting slots and 11 players, the initial setup is exactly 2 spinners + 3 pace.
  if (c.spinners > XI_RULES.spinnersMin && c.pace >= XI_RULES.paceMin) {
    errors.push({ code: 'spinners', message: `The initial setup uses exactly 2 specialist spinners (${c.spinners} selected). Deselect one of: ${listNames(selectedOf('spinner'))}.`, players: selectedOf('spinner').map(p => p.id) });
  }
  if (c.pace > XI_RULES.paceMin && c.spinners >= XI_RULES.spinnersMin) {
    errors.push({ code: 'pace', message: `The initial setup uses exactly 3 fast/medium bowlers (${c.pace} selected). Deselect one of: ${listNames(selectedOf('pace'))}.`, players: selectedOf('pace').map(p => p.id) });
  }

  // Wicketkeeper
  const keepersSel = selected.filter(p => p.role === ROLE.WICKETKEEPER);
  const keeperOnly = selected.filter(p => slotCategory(p) === 'keeperOnly');
  if (keeperOnly.length) {
    errors.push({ code: 'keeperOnly', message: `${listNames(keeperOnly)} is set up as keeper-only. Every XI slot is a batting or bowling slot, so the wicketkeeper must also bat as an Attacker or Defensive batsman.`, players: keeperOnly.map(p => p.id) });
  }
  if (keepersSel.length === 0) {
    const av = remaining.filter(p => p.role === ROLE.WICKETKEEPER && slotCategory(p) !== 'keeperOnly');
    errors.push({ code: 'keeper', message: `Select a wicketkeeper (0/1). The keeper fills one of the Attacker/Defensive slots.${av.length ? ` Available: ${listNames(av)}.` : ' No batting-capable keeper in the squad.'}` });
  } else if (keepersSel.length > 1) {
    errors.push({ code: 'keeper', message: `Only one wicketkeeper can play (${keepersSel.length} selected: ${listNames(keepersSel)}).`, players: keepersSel.map(p => p.id) });
  }

  const invalid = selected.filter(p => slotCategory(p) === 'invalid');
  if (invalid.length && !errors.some(e => e.code === 'player')) {
    errors.push({ code: 'invalid', message: `${listNames(invalid)} can't fill any slot with their current role setup.`, players: invalid.map(p => p.id) });
  }

  const squadOk = squad.length === SQUAD_SIZE;
  if (!squadOk) errors.push({ code: 'squad', message: `The squad must have exactly 15 players (currently ${squad.length}).` });

  const lines = [
    { key: 'attackers', label: 'Attackers', count: c.attackers, target: 3, mode: 'exact' },
    { key: 'defensive', label: 'Defensive batsmen', count: c.defensive, target: 2, mode: 'exact' },
    { key: 'allrounders', label: 'All-rounders in batting slots', count: c.allrounders, target: 1, mode: 'min' },
    { key: 'battingSlots', label: 'Designated batting slots', count: c.battingSlots, target: 6, mode: 'exact' },
    { key: 'keeper', label: 'Wicketkeeper (bats in top 6)', count: keepersSel.length - keeperOnly.length, target: 1, mode: 'exact' },
    { key: 'bowlers', label: 'Full-time bowlers', count: c.bowlers, target: 5, mode: 'min' },
    { key: 'spinners', label: 'Specialist spinners', count: c.spinners, target: 2, mode: 'min' },
    { key: 'pace', label: 'Fast/medium bowlers', count: c.pace, target: 3, mode: 'min' },
    { key: 'total', label: 'Total selected players', count: c.total, target: 11, mode: 'exact' },
    { key: 'squad', label: 'Squad size', count: squad.length, target: 15, mode: 'exact' },
  ];
  for (const l of lines) {
    l.ok = l.mode === 'exact' ? l.count === l.target : l.count >= l.target;
    if (errors.some(e => e.code === l.key)) l.ok = false;
  }

  const slots = {};
  for (const p of selected) slots[p.id] = slotCategory(p);
  return { ok: errors.length === 0, errors, lines, counts: c, slots };
}

/** Validates the 15-player squad itself (names, numbers, roles, and that a legal XI exists). */
export function validateSquad(squad) {
  const errors = [];
  if (squad.length !== SQUAD_SIZE) errors.push({ code: 'size', message: `The squad must have exactly 15 players (currently ${squad.length}).` });
  for (const p of squad) for (const m of playerProblems(p)) errors.push({ code: 'player', message: m, players: [p.id] });
  const numbers = new Map();
  for (const p of squad) {
    if (!numbers.has(p.number)) numbers.set(p.number, []);
    numbers.get(p.number).push(p);
  }
  for (const [num, ps] of numbers) {
    if (ps.length > 1) errors.push({ code: 'number', message: `Jersey number ${num} is used by ${listNames(ps)}.`, players: ps.map(p => p.id) });
  }
  const ids = new Set();
  for (const p of squad) {
    if (ids.has(p.id)) errors.push({ code: 'id', message: `Duplicate player entry for ${nameOf(p)}.` });
    ids.add(p.id);
  }
  const feas = canFormValidXI(squad);
  if (!feas.ok) for (const m of feas.missing) errors.push({ code: 'feasible', message: m });
  return { ok: errors.length === 0, errors };
}

/** Can this squad produce at least one legal XI? Lists what's missing if not. */
export function canFormValidXI(squad) {
  const pick = autoSelectXI(squad);
  if (pick) return { ok: true, missing: [] };
  const missing = [];
  const by = cat => squad.filter(p => slotCategory(p) === cat);
  const keepers = squad.filter(p => p.role === ROLE.WICKETKEEPER && slotCategory(p) !== 'keeperOnly');
  if (!keepers.length) missing.push('The squad needs a wicketkeeper who can bat (Attacker or Defensive style).');
  if (by('attacker').length < 3) missing.push(`The squad needs at least 3 Attackers (has ${by('attacker').length}, including keepers).`);
  if (by('defensive').length < 2) missing.push(`The squad needs at least 2 Defensive batsmen (has ${by('defensive').length}, including keepers).`);
  if (by('allrounder').length < 1) missing.push('The squad needs at least 1 All-rounder who can bowl.');
  if (by('spinner').length < 2) missing.push(`The squad needs at least 2 specialist spinners (has ${by('spinner').length}).`);
  if (by('pace').length < 3) missing.push(`The squad needs at least 3 fast/medium bowlers (has ${by('pace').length}).`);
  if (!missing.length) missing.push('No legal XI can be formed with one wicketkeeper: too many of the batters are keepers.');
  return { ok: false, missing };
}

/** Best-rated legal XI for a squad, or null if none exists. */
export function autoSelectXI(squad) {
  const sortBy = (arr, f) => arr.slice().sort((a, b) => f(b) - f(a));
  const keepers = squad.filter(p => p.role === ROLE.WICKETKEEPER && slotCategory(p) !== 'keeperOnly' && playerProblems(p).length === 0);
  let best = null;
  for (const k of keepers) {
    const pool = squad.filter(p => p.role !== ROLE.WICKETKEEPER && playerProblems(p).length === 0);
    const kCat = slotCategory(k);
    const needA = 3 - (kCat === 'attacker' ? 1 : 0);
    const needD = 2 - (kCat === 'defensive' ? 1 : 0);
    const att = sortBy(pool.filter(p => slotCategory(p) === 'attacker'), batScore).slice(0, needA);
    const def = sortBy(pool.filter(p => slotCategory(p) === 'defensive'), batScore).slice(0, needD);
    const ar = sortBy(pool.filter(p => slotCategory(p) === 'allrounder'), overallRating).slice(0, 1);
    const sp = sortBy(pool.filter(p => slotCategory(p) === 'spinner'), bowlScore).slice(0, 2);
    const pc = sortBy(pool.filter(p => slotCategory(p) === 'pace'), bowlScore).slice(0, 3);
    if (att.length < needA || def.length < needD || ar.length < 1 || sp.length < 2 || pc.length < 3) continue;
    const xi = [k, ...att, ...def, ...ar, ...sp, ...pc];
    const score = xi.reduce((s, p) => s + overallRating(p), 0);
    if (!best || score > best.score) best = { xi, score };
  }
  return best ? best.xi.map(p => p.id) : null;
}

/** Sensible batting order: openers, the middle order with the keeper at 5, all-rounder, then bowlers. */
export function defaultBattingOrder(squad, xiIds) {
  const byId = new Map(squad.map(p => [p.id, p]));
  const xi = xiIds.map(id => byId.get(id)).filter(Boolean);
  const keeper = xi.find(p => p.role === ROLE.WICKETKEEPER && slotCategory(p) !== 'keeperOnly');
  const bats = xi.filter(p => (slotCategory(p) === 'attacker' || slotCategory(p) === 'defensive') && p !== keeper);
  const att = bats.filter(p => slotCategory(p) === 'attacker').sort((a, b) => batScore(b) - batScore(a));
  const def = bats.filter(p => slotCategory(p) === 'defensive').sort((a, b) => batScore(b) - batScore(a));
  const top = [];
  if (att.length) top.push(att.shift());
  if (def.length) top.push(def.shift());
  const rest = [...def, ...att].sort((a, b) => batScore(b) - batScore(a));
  top.push(...rest);
  if (keeper) top.splice(Math.min(4, top.length), 0, keeper);
  const ars = xi.filter(p => slotCategory(p) === 'allrounder').sort((a, b) => batScore(b) - batScore(a));
  const others = xi.filter(p => !top.includes(p) && !ars.includes(p)).sort((a, b) => batScore(b) - batScore(a));
  return [...top, ...ars, ...others].map(p => p.id);
}

/** Batting order that contains exactly the XI (keeps the user's order where possible). */
export function reconcileBattingOrder(squad, xiIds, order) {
  const xiSet = new Set(xiIds);
  const kept = (order || []).filter((id, i, a) => xiSet.has(id) && a.indexOf(id) === i);
  if (kept.length === xiIds.length) return kept;
  const def = defaultBattingOrder(squad, xiIds);
  for (const id of def) if (!kept.includes(id)) kept.push(id);
  return kept;
}

export function bowlingOptions(squad, xiIds) {
  const byId = new Map(squad.map(p => [p.id, p]));
  return xiIds.map(id => byId.get(id)).filter(p => p && canBowl(p));
}

export function keeperOf(squad, xiIds) {
  const byId = new Map(squad.map(p => [p.id, p]));
  return xiIds.map(id => byId.get(id)).find(p => p && p.role === ROLE.WICKETKEEPER) || null;
}

// ---------------------------------------------------------------------------
// Squad generation

const TEMPLATE = [
  { role: 'batsman', battingStyle: 'attacker' },
  { role: 'batsman', battingStyle: 'attacker' },
  { role: 'batsman', battingStyle: 'attacker' },
  { role: 'batsman', battingStyle: 'defensive' },
  { role: 'batsman', battingStyle: 'defensive' },
  { role: 'wicketkeeper', battingStyle: 'attacker' },
  { role: 'wicketkeeper', battingStyle: 'defensive' },
  { role: 'allrounder', battingStyle: 'balanced', arType: 'batting', bowlingType: 'medium' },
  { role: 'allrounder', battingStyle: 'attacker', arType: 'bowling', bowlingType: 'leg-spin' },
  { role: 'bowler', battingStyle: 'tailender', bowlingType: 'off-spin' },
  { role: 'bowler', battingStyle: 'tailender', bowlingType: 'leg-spin' },
  { role: 'bowler', battingStyle: 'tailender', bowlingType: 'fast' },
  { role: 'bowler', battingStyle: 'tailender', bowlingType: 'fast' },
  { role: 'bowler', battingStyle: 'tailender', bowlingType: 'fast-medium' },
  { role: 'bowler', battingStyle: 'tailender', bowlingType: 'medium' },
];

const TECH_BY_STYLE = {
  attacker: ['front-foot', 'back-foot', 'balanced', 'front-foot'],
  defensive: ['balanced', 'back-foot', 'front-foot', 'sweeper'],
  balanced: ['balanced', 'sweeper', 'front-foot'],
  tailender: ['balanced', 'front-foot'],
};

/** Ratings for one generated player; strength 0..1 shifts the whole team. */
export function generateRatings(rng, t, strength = 0.55) {
  const s = (lo, hi) => Math.round(clamp(rng.range(lo, hi) + (strength - 0.55) * 30, 1, 99));
  const r = {};
  const isKeeper = t.role === 'wicketkeeper';
  if (t.role === 'batsman' || isKeeper) {
    r.batting = s(isKeeper ? 58 : 66, isKeeper ? 76 : 86);
    r.timing = t.battingStyle === 'defensive' ? s(70, 88) : s(58, 80);
    r.aggression = t.battingStyle === 'attacker' ? s(72, 94) : s(22, 46);
    r.bowlAccuracy = s(10, 25); r.bowlSpeed = s(10, 25); r.bowlMovement = s(10, 25); r.bowlStamina = s(10, 25);
    r.fielding = s(58, 84); r.catching = isKeeper ? s(76, 92) : s(58, 84);
  } else if (t.role === 'allrounder') {
    const batAR = t.arType === 'batting';
    r.batting = batAR ? s(62, 76) : s(48, 62);
    r.timing = batAR ? s(60, 76) : s(48, 64);
    r.aggression = t.battingStyle === 'attacker' ? s(66, 86) : t.battingStyle === 'defensive' ? s(25, 45) : s(45, 65);
    r.bowlAccuracy = batAR ? s(56, 70) : s(66, 80);
    r.bowlSpeed = s(45, 72); r.bowlMovement = batAR ? s(50, 66) : s(62, 80); r.bowlStamina = s(55, 80);
    r.fielding = s(62, 86); r.catching = s(60, 84);
  } else {
    r.batting = s(14, 36); r.timing = s(15, 38); r.aggression = s(30, 70);
    const spin = BOWLING_TYPES[t.bowlingType]?.kind === 'spin';
    r.bowlAccuracy = s(68, 88); r.bowlSpeed = spin ? s(40, 70) : s(55, 90);
    r.bowlMovement = s(62, 88); r.bowlStamina = s(58, 88);
    r.fielding = s(48, 78); r.catching = s(48, 78);
  }
  return r;
}

export function generateSquad(rng = new RNG(), { strength = 0.55, usedNames = new Set() } = {}) {
  const numbers = rng.shuffle(Array.from({ length: 99 }, (_, i) => i + 1)).slice(0, SQUAD_SIZE);
  return TEMPLATE.map((t, i) => normalizePlayer({
    id: uid('p'),
    name: randomName(rng, usedNames),
    number: numbers[i],
    ...t,
    technique: t.role === 'bowler' ? 'balanced' : rng.pick(TECH_BY_STYLE[t.battingStyle] || ['balanced']),
    ...generateRatings(rng, t, strength),
  }));
}

export function buildTeam({ name, short, primary, secondary, emblem, players, isUser = false }) {
  const xi = autoSelectXI(players) || [];
  return {
    id: uid('team'),
    name, short: (short || name.slice(0, 3)).toUpperCase().slice(0, 4),
    primary, secondary,
    emblem: emblem || { shape: 'shield', icon: 'star' },
    players,
    xi,
    battingOrder: defaultBattingOrder(players, xi),
    strategy: { battingApproach: 'balanced', fieldApproach: 'auto' },
    isUser,
  };
}

export function createDefaultUserTeam(rng = new RNG()) {
  return buildTeam({
    name: 'My Cricket Club', short: 'MCC', primary: '#14806a', secondary: '#f4d35e',
    emblem: { shape: 'shield', icon: 'bat' },
    players: generateSquad(rng, { strength: 0.6 }),
    isUser: true,
  });
}

export const DIFFICULTY_STRENGTH = { easy: 0.38, normal: 0.56, hard: 0.74 };

export function generateCpuTeam(rng = new RNG(), { difficulty = 'normal', avoidName = '', template = null } = {}) {
  const pool = CPU_TEAMS.filter(t => t.name !== avoidName);
  const base = template || rng.pick(pool);
  const team = buildTeam({ ...base, players: generateSquad(rng, { strength: DIFFICULTY_STRENGTH[difficulty] ?? 0.56 }) });
  const check = validatePlayingXI(team.players, team.xi);
  if (!check.ok) throw new Error('Generated CPU team is not valid: ' + check.errors.map(e => e.message).join('; '));
  return team;
}

export function newBlankPlayer(squad, rng = new RNG()) {
  const used = new Set(squad.map(p => p.number));
  let num = 1;
  while (used.has(num) && num < 99) num++;
  const t = { role: 'batsman', battingStyle: 'defensive' };
  return normalizePlayer({ id: uid('p'), name: randomName(rng, new Set(squad.map(p => p.name))), number: num, ...t, technique: 'balanced', ...generateRatings(rng, t, 0.5) });
}
