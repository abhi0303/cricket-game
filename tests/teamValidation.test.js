import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePlayingXI, validateSquad, autoSelectXI, generateSquad, canFormValidXI,
  defaultBattingOrder, generateCpuTeam, reconcileBattingOrder,
} from '../src/game/TeamManager.js';
import { normalizePlayer, slotCategory } from '../src/game/PlayerAttributes.js';
import { RNG } from '../src/utils/Random.js';

let n = 0;
const mk = (role, battingStyle, bowlingType = null, extra = {}) => normalizePlayer({
  id: `p${++n}`, name: `Player ${n}`, number: n, role, battingStyle, bowlingType,
  batting: 60, timing: 60, aggression: 50, bowlAccuracy: 60, bowlSpeed: 60, bowlMovement: 60, bowlStamina: 60,
  fielding: 60, catching: 60, ...extra,
});

/** A squad of 15 whose first 11 entries form a legal XI. */
function makeSquad() {
  n = 0;
  const s = {
    att1: mk('batsman', 'attacker'), att2: mk('batsman', 'attacker'),
    wk: mk('wicketkeeper', 'attacker'),
    def1: mk('batsman', 'defensive'), def2: mk('batsman', 'defensive'),
    ar: mk('allrounder', 'balanced', 'medium', { arType: 'batting' }),
    os: mk('bowler', 'tailender', 'off-spin'), ls: mk('bowler', 'tailender', 'leg-spin'),
    f1: mk('bowler', 'tailender', 'fast'), f2: mk('bowler', 'tailender', 'fast-medium'), m1: mk('bowler', 'tailender', 'medium'),
    // bench
    att3: mk('batsman', 'attacker'), wk2: mk('wicketkeeper', 'tailender'),
    ar2: mk('allrounder', 'attacker', 'off-spin', { arType: 'bowling' }), f3: mk('bowler', 'tailender', 'fast'),
  };
  const squad = Object.values(s);
  const xi = ['att1', 'att2', 'wk', 'def1', 'def2', 'ar', 'os', 'ls', 'f1', 'f2', 'm1'].map(k => s[k].id);
  return { s, squad, xi };
}
const swap = (xi, outId, inId) => xi.map(id => (id === outId ? inId : id));
const codes = r => r.errors.map(e => e.code);

test('a correct XI passes every rule', () => {
  const { squad, xi } = makeSquad();
  const r = validatePlayingXI(squad, xi);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.counts.attackers, 3);
  assert.equal(r.counts.defensive, 2);
  assert.equal(r.counts.allrounders, 1);
  assert.equal(r.counts.battingSlots, 6);
  assert.equal(r.counts.spinners, 2);
  assert.equal(r.counts.pace, 3);
  assert.equal(r.counts.bowlers, 5);
  assert.equal(r.counts.total, 11);
  assert.ok(r.lines.every(l => l.ok));
});

test('4 attackers (one replacing a defensive batsman) fails', () => {
  const { s, squad, xi } = makeSquad();
  const r = validatePlayingXI(squad, swap(xi, s.def1.id, s.att3.id));
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('attackers'));
  assert.ok(codes(r).includes('defensive'));
  assert.match(r.errors.find(e => e.code === 'attackers').message, /Too many Attackers \(4\/3\)/);
});

test('missing an all-rounder fails even with 11 players', () => {
  const { s, squad, xi } = makeSquad();
  const r = validatePlayingXI(squad, swap(xi, s.ar.id, s.att3.id));
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('allrounders'));
});

test('an all-rounder without a bowling type is not an all-rounder', () => {
  const { s, squad, xi } = makeSquad();
  s.ar.bowlingType = null;
  assert.equal(slotCategory(s.ar), 'invalid');
  const r = validatePlayingXI(squad, xi);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('player'));
  assert.ok(codes(r).includes('allrounders'));
});

test('an all-rounder is not counted as a full-time bowler', () => {
  const { s, squad, xi } = makeSquad();
  // Replace a pace bowler with the second all-rounder: 2 ARs, only 4 full-time bowlers.
  const r = validatePlayingXI(squad, swap(xi, s.m1.id, s.ar2.id));
  assert.equal(r.ok, false);
  assert.equal(r.counts.bowlers, 4);
  assert.ok(codes(r).includes('pace'));
  assert.ok(codes(r).includes('bowlers'));
  assert.ok(codes(r).includes('battingSlots'));
});

test('a spinner cannot fill a fast/medium slot', () => {
  const { s, squad, xi } = makeSquad();
  const extraSpinner = mk('bowler', 'tailender', 'off-spin');
  squad[squad.length - 1] = extraSpinner; // swap bench pacer for a spinner, keep 15
  const r = validatePlayingXI(squad, swap(xi, s.m1.id, extraSpinner.id));
  assert.equal(r.ok, false);
  assert.equal(r.counts.spinners, 3);
  assert.equal(r.counts.pace, 2);
  assert.ok(codes(r).includes('pace'));
  assert.match(r.errors.find(e => e.code === 'pace').message, /Spinners and all-rounders can't fill a pace slot/);
});

test('a fast bowler cannot fill a spin slot', () => {
  const { s, squad, xi } = makeSquad();
  const r = validatePlayingXI(squad, swap(xi, s.ls.id, s.f3.id));
  assert.equal(r.ok, false);
  assert.equal(r.counts.spinners, 1);
  assert.equal(r.counts.pace, 4);
  assert.ok(codes(r).includes('spinners'));
});

test('a keeper-only player cannot be the wicketkeeper', () => {
  const { s, squad, xi } = makeSquad();
  const r = validatePlayingXI(squad, swap(xi, s.wk.id, s.wk2.id));
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('keeperOnly'));
  assert.ok(codes(r).includes('attackers'));
});

test('a wicketkeeper is not automatically a specialist batsman', () => {
  const { s } = makeSquad();
  assert.equal(slotCategory(s.wk), 'attacker');
  assert.equal(slotCategory(s.wk2), 'keeperOnly');
});

test('two wicketkeepers are rejected', () => {
  const { s, squad, xi } = makeSquad();
  const wkDef = mk('wicketkeeper', 'defensive');
  squad[squad.length - 3] = wkDef; // replace the keeper-only bench player
  const r = validatePlayingXI(squad, swap(xi, s.def2.id, wkDef.id));
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('keeper'));
});

test('no wicketkeeper is rejected', () => {
  const { s, squad, xi } = makeSquad();
  const r = validatePlayingXI(squad, swap(xi, s.wk.id, s.att3.id));
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('keeper'));
});

test('a player selected twice is only counted once', () => {
  const { s, squad, xi } = makeSquad();
  const r = validatePlayingXI(squad, [...xi.slice(0, 10), s.att1.id]);
  assert.equal(r.ok, false);
  assert.equal(r.counts.total, 10);
  assert.ok(codes(r).includes('duplicate'));
  assert.ok(codes(r).includes('total'));
});

test('10 or 12 players fail the total check', () => {
  const { s, squad, xi } = makeSquad();
  assert.ok(codes(validatePlayingXI(squad, xi.slice(0, 10))).includes('total'));
  assert.ok(codes(validatePlayingXI(squad, [...xi, s.att3.id])).includes('total'));
});

test('unknown player ids are rejected', () => {
  const { squad, xi } = makeSquad();
  const r = validatePlayingXI(squad, [...xi.slice(0, 10), 'ghost']);
  assert.ok(codes(r).includes('unknown'));
});

test('squad must have exactly 15 players', () => {
  const { squad, xi } = makeSquad();
  assert.ok(codes(validatePlayingXI(squad.slice(0, 14), xi)).includes('squad'));
  assert.ok(codes(validateSquad(squad.slice(0, 14))).includes('size'));
  assert.ok(codes(validateSquad([...squad, mk('batsman', 'attacker')])).includes('size'));
  assert.equal(validateSquad(squad).ok, true, JSON.stringify(validateSquad(squad).errors));
});

test('squad validation catches duplicate jersey numbers and empty names', () => {
  const { s, squad } = makeSquad();
  s.att2.number = s.att1.number;
  s.def1.name = '  ';
  const r = validateSquad(squad);
  assert.ok(codes(r).includes('number'));
  assert.ok(r.errors.some(e => /name is empty/.test(e.message)));
});

test('squad without two spinners cannot form an XI', () => {
  const { s, squad } = makeSquad();
  s.ls.bowlingType = 'fast';
  s.ar2.role = 'batsman'; s.ar2.battingStyle = 'attacker'; s.ar2.bowlingType = null;
  const f = canFormValidXI(squad);
  assert.equal(f.ok, false);
  assert.ok(f.missing.some(m => /spinners/.test(m)));
});

test('autoSelectXI picks a legal XI from generated squads', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const squad = generateSquad(new RNG(seed));
    assert.equal(squad.length, 15);
    assert.equal(validateSquad(squad).ok, true);
    const xi = autoSelectXI(squad);
    assert.ok(xi);
    const r = validatePlayingXI(squad, xi);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const order = defaultBattingOrder(squad, xi);
    assert.equal(new Set(order).size, 11);
    assert.deepEqual([...order].sort(), [...xi].sort());
  }
});

test('CPU teams obey the same rules', () => {
  for (let seed = 1; seed <= 20; seed++) {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const t = generateCpuTeam(new RNG(seed), { difficulty });
      assert.equal(validatePlayingXI(t.players, t.xi).ok, true);
    }
  }
});

test('reconcileBattingOrder keeps user order and fixes XI changes', () => {
  const { s, squad, xi } = makeSquad();
  const order = [...xi].reverse();
  assert.deepEqual(reconcileBattingOrder(squad, xi, order), order);
  const xi2 = swap(xi, s.att1.id, s.att3.id);
  const fixed = reconcileBattingOrder(squad, xi2, order);
  assert.equal(fixed.length, 11);
  assert.ok(fixed.includes(s.att3.id));
  assert.ok(!fixed.includes(s.att1.id));
});
