// Match flow: toss, innings, target, bowler changes, fatigue, result and statistics.
// The state is plain JSON so a match can be saved and resumed.

import {
  createInnings, applyBall, eligibleBowlers, setBowler, oversString, runRate, requiredRunRate,
  ballsRemaining, runsRequired, BALLS_PER_OVER, maxOversPerBowler,
} from './CricketRules.js';
import { canBowl, BOWLING_TYPES, ROLE } from './PlayerAttributes.js';
import { reconcileBattingOrder, validatePlayingXI } from './TeamManager.js';

const SAVE_VERSION = 2;

/** Snapshot of a team for one match: only the XI travels with the match. */
export function teamSnapshot(team) {
  const byId = new Map(team.players.map(p => [p.id, p]));
  const order = reconcileBattingOrder(team.players, team.xi, team.battingOrder);
  return {
    id: team.id,
    name: team.name,
    short: team.short,
    primary: team.primary,
    secondary: team.secondary,
    emblem: team.emblem,
    isUser: !!team.isUser,
    strategy: { ...(team.strategy || {}) },
    players: order.map(id => ({ ...byId.get(id) })),
    battingOrder: order,
  };
}

export class MatchEngine {
  /**
   * @param {object} o
   * @param {object[]} o.teams   two full teams (with players / xi / battingOrder)
   * @param {object}   o.config  { overs, difficulty, stadium, timeOfDay }
   * @param {object}   o.toss    { winner: teamId, decision: 'bat'|'bowl' }
   */
  constructor({ teams, config, toss, state = null }) {
    if (state) { this.state = state; return; }
    if (!teams || teams.length !== 2) throw new Error('A match needs two teams');
    for (const t of teams) {
      const v = validatePlayingXI(t.players, t.xi);
      if (!v.ok) throw new Error(`${t.name} does not have a legal XI: ${v.errors[0].message}`);
    }
    const snaps = teams.map(teamSnapshot);
    const winner = toss.winner;
    const other = snaps.find(t => t.id !== winner).id;
    const battingFirst = toss.decision === 'bat' ? winner : other;
    this.state = {
      version: SAVE_VERSION,
      config: { overs: 5, difficulty: 'normal', ...config },
      teams: snaps,
      toss: { ...toss },
      battingFirst,
      innings: [],
      current: -1,
      phase: 'pre', // pre | innings | break | complete
      fatigue: {},
      result: null,
      ballsBowled: 0,
    };
    this.startInnings();
  }

  static fromJSON(json) {
    const state = typeof json === 'string' ? JSON.parse(json) : json;
    if (!state || state.version !== SAVE_VERSION) throw new Error('Unsupported save');
    return new MatchEngine({ state });
  }
  toJSON() { return JSON.parse(JSON.stringify(this.state)); }

  // ------------------------------------------------------------------ accessors
  get config() { return this.state.config; }
  get phase() { return this.state.phase; }
  get innings() { return this.state.innings[this.state.current] || null; }
  get inningsIndex() { return this.state.current; }
  team(id) { return this.state.teams.find(t => t.id === id); }
  get userTeam() { return this.state.teams.find(t => t.isUser) || this.state.teams[0]; }
  get cpuTeam() { return this.state.teams.find(t => !t.isUser) || this.state.teams[1]; }
  get battingTeam() { return this.innings ? this.team(this.innings.battingTeam) : null; }
  get bowlingTeam() { return this.innings ? this.team(this.innings.bowlingTeam) : null; }
  get userIsBatting() { return !!this.battingTeam?.isUser; }

  player(id) {
    for (const t of this.state.teams) {
      const p = t.players.find(x => x.id === id);
      if (p) return p;
    }
    return null;
  }

  get striker() { return this.player(this.innings?.striker); }
  get nonStriker() { return this.player(this.innings?.nonStriker); }
  get bowler() { return this.player(this.innings?.currentBowler); }

  keeper(teamId) {
    const t = this.team(teamId);
    return t.players.find(p => p.role === ROLE.WICKETKEEPER) || t.players[t.players.length - 1];
  }

  bowlingOptions(teamId = this.innings?.bowlingTeam) {
    return this.team(teamId).players.filter(canBowl);
  }

  // ------------------------------------------------------------------ flow
  startInnings() {
    const s = this.state;
    if (s.current >= 1) throw new Error('Both innings already started');
    const idx = s.current + 1;
    const batId = idx === 0 ? s.battingFirst : s.teams.find(t => t.id !== s.battingFirst).id;
    const bowlId = s.teams.find(t => t.id !== batId).id;
    const target = idx === 1 ? s.innings[0].runs + 1 : null;
    s.innings.push(createInnings({
      number: idx + 1,
      battingTeam: batId,
      bowlingTeam: bowlId,
      battingOrder: this.team(batId).battingOrder,
      maxOvers: s.config.overs,
      target,
    }));
    s.current = idx;
    s.phase = 'innings';
    s.fatigue = {};
  }

  needsBowler() {
    return this.phase === 'innings' && !this.innings.complete && !this.innings.currentBowler;
  }

  eligibleBowlers() {
    const ids = this.bowlingOptions().map(p => p.id);
    return eligibleBowlers(this.innings, ids, this.config.overs);
  }

  setBowler(id) {
    setBowler(this.innings, id, this.eligibleBowlers());
  }

  oversBowledBy(id) {
    const b = this.innings.bowlers[id];
    return b ? b.balls / BALLS_PER_OVER : 0;
  }

  maxOversPerBowler() { return maxOversPerBowler(this.config.overs); }

  fatigueOf(id) { return this.state.fatigue[id] || 0; }

  /** Record a finished delivery. Returns { events, inningsComplete, matchComplete }. */
  recordBall(ball) {
    if (this.phase !== 'innings') throw new Error('No innings in progress');
    const inn = this.innings;
    const bowlerId = inn.currentBowler;
    const events = applyBall(inn, ball);
    this.state.ballsBowled++;

    // Bowler fatigue: rises with every ball, recovers for bowlers resting.
    const bp = this.player(bowlerId);
    const drain = (BOWLING_TYPES[bp?.bowlingType]?.staminaDrain || 1) * (1.55 - (bp?.bowlStamina || 50) / 100) * 0.03;
    this.state.fatigue[bowlerId] = Math.min(1, this.fatigueOf(bowlerId) + drain * (ball.effort || 1));
    if (events.some(e => e.type === 'overComplete')) {
      for (const id of Object.keys(this.state.fatigue)) {
        if (id !== bowlerId) this.state.fatigue[id] = Math.max(0, this.state.fatigue[id] - 0.12);
      }
    }

    let inningsComplete = false;
    let matchComplete = false;
    if (inn.complete) {
      inningsComplete = true;
      if (this.state.current === 0) {
        this.state.phase = 'break';
      } else {
        this.state.phase = 'complete';
        this.state.result = this.computeResult();
        matchComplete = true;
      }
    }
    return { events, inningsComplete, matchComplete };
  }

  /** Called by the UI after the innings-break screen. */
  beginSecondInnings() {
    if (this.phase !== 'break') throw new Error('Not at the innings break');
    this.startInnings();
  }

  computeResult() {
    const [i1, i2] = this.state.innings;
    const t1 = this.team(i1.battingTeam);
    const t2 = this.team(i2.battingTeam);
    if (i2.runs >= i2.target) {
      const wl = i2.maxWickets - i2.wickets;
      const balls = ballsRemaining(i2);
      return { winner: t2.id, type: 'wickets', margin: wl, text: `${t2.name} won by ${wl} wicket${wl === 1 ? '' : 's'}${balls ? ` (${balls} ball${balls === 1 ? '' : 's'} left)` : ''}` };
    }
    if (i2.runs === i2.target - 1) return { winner: null, type: 'tie', margin: 0, text: 'Match tied' };
    const m = i2.target - 1 - i2.runs;
    return { winner: t1.id, type: 'runs', margin: m, text: `${t1.name} won by ${m} run${m === 1 ? '' : 's'}` };
  }

  // ------------------------------------------------------------------ situation summaries (HUD / AI)
  situation() {
    const inn = this.innings;
    if (!inn) return null;
    const ballsLeft = ballsRemaining(inn);
    return {
      innings: this.state.current + 1,
      runs: inn.runs,
      wickets: inn.wickets,
      overs: oversString(inn.legalBalls),
      legalBalls: inn.legalBalls,
      ballsLeft,
      maxOvers: inn.maxOvers,
      target: inn.target,
      need: runsRequired(inn),
      crr: runRate(inn.runs, inn.legalBalls),
      rrr: requiredRunRate(inn),
      freeHit: inn.freeHit,
      wicketsLeft: inn.maxWickets - inn.wickets,
      phaseOfInnings: inn.legalBalls < inn.maxOvers * 6 * 0.3 ? 'early' : ballsLeft <= Math.max(6, inn.maxOvers * 6 * 0.25) ? 'death' : 'middle',
    };
  }

  /** Top scorer, best bowler and player of the match. */
  summary() {
    const all = [];
    for (const inn of this.state.innings) {
      for (const [id, b] of Object.entries(inn.batters)) all.push({ type: 'bat', id, team: inn.battingTeam, ...b });
    }
    const bowls = [];
    for (const inn of this.state.innings) {
      for (const [id, b] of Object.entries(inn.bowlers)) bowls.push({ id, team: inn.bowlingTeam, ...b });
    }
    const topScorer = all.filter(b => b.status !== 'yet').sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0] || null;
    const bestBowler = bowls.filter(b => b.balls > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs || b.balls - a.balls)[0] || null;
    const impact = new Map();
    const add = (id, team, v) => impact.set(id, { id, team, v: (impact.get(id)?.v || 0) + v });
    for (const b of all) add(b.id, b.team, b.runs + b.fours * 1 + b.sixes * 2 + (b.balls > 0 && b.runs / b.balls > 1.4 ? 6 : 0));
    for (const b of bowls) add(b.id, b.team, b.wickets * 22 + b.dots * 1 - Math.max(0, b.runs - b.balls * 1.3) * 0.8);
    const winner = this.state.result?.winner;
    const ranked = [...impact.values()].sort((a, b) => (b.v + (b.team === winner ? 15 : 0)) - (a.v + (a.team === winner ? 15 : 0)));
    return {
      topScorer: topScorer && { ...topScorer, player: this.player(topScorer.id) },
      bestBowler: bestBowler && { ...bestBowler, player: this.player(bestBowler.id), overs: oversString(bestBowler.balls) },
      playerOfMatch: ranked[0] ? this.player(ranked[0].id) : null,
    };
  }
}
