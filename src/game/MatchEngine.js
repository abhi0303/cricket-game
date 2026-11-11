// Match flow: toss, innings, target, bowler changes, fatigue, result and statistics.
// The state is plain JSON so a match can be saved and resumed.

import {
  createInnings, applyBall, eligibleBowlers, setBowler, oversString, runRate, requiredRunRate,
  ballsRemaining, runsRequired, BALLS_PER_OVER, maxOversPerBowler, declareInnings,
} from './CricketRules.js';
import { canBowl, BOWLING_TYPES, ROLE } from './PlayerAttributes.js';
import { reconcileBattingOrder, validatePlayingXI } from './TeamManager.js';

const SAVE_VERSION = 2;

// Test cricket: the minimum overs in a day, the overs lost when an innings changes over (10 minutes),
// when the fielding side may take a new ball, and the follow-on margin for the length of the match.
export const TEST = { oversPerDay: 90, days: 5, changeoverBalls: 12, newBallOvers: 80 };
export function followOnMargin(days) { return days >= 5 ? 200 : days >= 3 ? 150 : days === 2 ? 100 : 75; }
const ordinal = n => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
export { ordinal };

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
    const cfg = { overs: 5, difficulty: 'normal', format: 'limited', freeHit: true, ...config };
    if (cfg.format === 'test') { cfg.days = cfg.days || TEST.days; cfg.oversPerDay = cfg.oversPerDay || TEST.oversPerDay; cfg.freeHit = false; }
    this.state = {
      version: SAVE_VERSION,
      config: cfg,
      teams: snaps,
      toss: { ...toss },
      battingFirst,
      innings: [],
      current: -1,
      phase: 'pre', // pre | innings | break | complete
      fatigue: {},
      result: null,
      ballsBowled: 0,
      // Test match clock: day of the match and balls used today (legal balls plus changeovers).
      test: cfg.format === 'test' ? { day: 1, dayBalls: 0, followOn: false, followOnOption: null } : null,
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
  get isTest() { return this.state.config.format === 'test'; }
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
  /** Runs a team has scored in all its innings so far. */
  teamTotal(teamId) {
    return this.state.innings.filter(i => i.battingTeam === teamId).reduce((sum, i) => sum + i.runs, 0);
  }

  get maxInnings() { return this.isTest ? 4 : 2; }

  /** Who bats in innings idx (0-based). Tests: 1st/2nd as tossed, 3rd the side that batted first unless it enforced the follow-on. */
  battingTeamFor(idx) {
    const s = this.state;
    const other = s.teams.find(t => t.id !== s.battingFirst).id;
    if (idx === 0) return s.battingFirst;
    if (idx === 1) return other;
    if (idx === 2) return s.test?.followOn ? s.innings[1].battingTeam : s.innings[0].battingTeam;
    const batted = s.innings.slice(0, 3).map(i => i.battingTeam);
    return s.teams.map(t => t.id).find(id => batted.filter(x => x === id).length < 2);
  }

  startInnings() {
    const s = this.state;
    const idx = s.current + 1;
    if (idx >= this.maxInnings) throw new Error('All innings already started');
    const batId = this.battingTeamFor(idx);
    const bowlId = s.teams.find(t => t.id !== batId).id;
    let target = null;
    if (!this.isTest && idx === 1) target = s.innings[0].runs + 1;
    if (this.isTest && idx === 3) target = this.teamTotal(bowlId) - this.teamTotal(batId) + 1;
    s.innings.push(createInnings({
      number: idx + 1,
      battingTeam: batId,
      bowlingTeam: bowlId,
      battingOrder: this.team(batId).battingOrder,
      maxOvers: this.isTest ? null : s.config.overs,
      target,
      freeHits: !this.isTest && s.config.freeHit !== false,
    }));
    s.current = idx;
    s.phase = 'innings';
    s.fatigue = {};
    if (s.test) s.test.followOnOption = null;
  }

  needsBowler() {
    return this.phase === 'innings' && !this.innings.complete && !this.innings.currentBowler;
  }

  eligibleBowlers() {
    const ids = this.bowlingOptions().map(p => p.id);
    return eligibleBowlers(this.innings, ids, this.isTest ? Infinity : this.config.overs);
  }

  setBowler(id) {
    setBowler(this.innings, id, this.eligibleBowlers());
  }

  oversBowledBy(id) {
    const b = this.innings.bowlers[id];
    return b ? b.balls / BALLS_PER_OVER : 0;
  }

  maxOversPerBowler() { return this.isTest ? Infinity : maxOversPerBowler(this.config.overs); }

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

    if (this.isTest) this.testClock(inn, ball, events);
    return this.afterBall(inn, events);
  }

  /** Shared end-of-ball handling: innings end, result, the day's play. */
  afterBall(inn, events) {
    let inningsComplete = false;
    let matchComplete = false;
    if (inn.complete) {
      inningsComplete = true;
      if (this.isTest) {
        const r = this.testResult();
        if (r) { this.state.phase = 'complete'; this.state.result = r; matchComplete = true; }
        else {
          this.state.phase = 'break';
          const T = this.state.test;
          T.dayBalls += TEST.changeoverBalls;   // ten minutes between innings
          if (this.state.current === 1) {
            const lead = this.teamTotal(this.state.innings[0].battingTeam) - this.teamTotal(inn.battingTeam);
            if (lead >= followOnMargin(this.config.days)) T.followOnOption = { team: this.state.innings[0].battingTeam, lead };
          }
        }
      } else if (this.state.current === 0) {
        this.state.phase = 'break';
      } else {
        this.state.phase = 'complete';
        this.state.result = this.computeResult();
        matchComplete = true;
      }
    }
    // Tests: stumps once the day's overs are bowled (at the end of an over, or at an innings change).
    let stumps = null;
    if (this.isTest && !matchComplete) {
      const T = this.state.test;
      const overDone = inn.complete || events.some(e => e.type === 'overComplete');
      if (overDone && T.dayBalls >= this.config.oversPerDay * BALLS_PER_OVER) {
        stumps = { type: 'stumps', day: T.day };
        if (T.day >= this.config.days) {
          this.state.phase = 'complete';
          this.state.result = { winner: null, type: 'draw', margin: 0, text: 'Match drawn' };
          matchComplete = true;
          stumps.final = true;
        } else {
          T.day++;
          T.dayBalls = 0;
          this.state.fatigue = {};   // a night's rest
        }
        events.push(stumps);
      }
    }
    return { events, inningsComplete, matchComplete, stumps };
  }

  /** Tests: the day's clock and the new ball (taken as soon as it's due, after 80 overs). */
  testClock(inn, ball, events) {
    if (ball.extra) return;
    this.state.test.dayBalls++;
    if (!inn.complete && inn.legalBalls % BALLS_PER_OVER === 0 && inn.legalBalls - (inn.ballStart || 0) >= TEST.newBallOvers * BALLS_PER_OVER) {
      inn.ballStart = inn.legalBalls;
      events.push({ type: 'newBall', over: inn.legalBalls / BALLS_PER_OVER });
    }
  }

  /** Tests: the batting side declares its innings closed. */
  declare() {
    if (!this.isTest) throw new Error('Declarations are only for Test matches');
    if (this.phase !== 'innings') throw new Error('No innings in progress');
    if (this.state.current >= 3) throw new Error('The fourth innings cannot be declared');
    const inn = this.innings;
    return this.afterBall(inn, declareInnings(inn));
  }

  /** Called by the UI after the innings-break screen. followOn: the side ahead enforces the follow-on (Tests). */
  beginNextInnings({ followOn = false } = {}) {
    if (this.phase !== 'break') throw new Error('Not at the innings break');
    if (this.state.test) this.state.test.followOn = !!(followOn && this.state.test.followOnOption && this.state.current === 1);
    this.startInnings();
  }

  /** Kept for the limited-overs flow and older callers. */
  beginSecondInnings(opts) { this.beginNextInnings(opts); }

  /** Test result once it's decided by the innings (time running out is handled by the clock). */
  testResult() {
    const s = this.state, idx = s.current, inn = this.innings;
    const name = id => this.team(id).name;
    if (idx === 2) {
      // The side batting third has batted twice; still behind once they're out: an innings defeat.
      const bat = inn.battingTeam, other = inn.bowlingTeam;
      const short = this.teamTotal(other) - this.teamTotal(bat);
      if (short > 0) return { winner: other, type: 'innings', margin: short, text: `${name(other)} won by an innings and ${short} run${short === 1 ? '' : 's'}` };
      return null;
    }
    if (idx === 3) {
      if (inn.runs >= inn.target) {
        const wl = inn.maxWickets - inn.wickets;
        return { winner: inn.battingTeam, type: 'wickets', margin: wl, text: `${name(inn.battingTeam)} won by ${wl} wicket${wl === 1 ? '' : 's'}` };
      }
      if (inn.runs === inn.target - 1) return { winner: null, type: 'tie', margin: 0, text: 'Match tied' };
      const m = inn.target - 1 - inn.runs;
      return { winner: inn.bowlingTeam, type: 'runs', margin: m, text: `${name(inn.bowlingTeam)} won by ${m} run${m === 1 ? '' : 's'}` };
    }
    return null;
  }

  /** DRS reviews the batting ('bat') or fielding ('bowl') side has left this innings. */
  reviewsLeft(side) { return this.innings?.reviews?.[side] ?? 3; }
  /** A review was used: it's lost unless the decision was overturned or stayed on umpire's call. */
  useReview(side, { retained = false } = {}) {
    const inn = this.innings;
    if (!inn) return;
    inn.reviews = inn.reviews || { bat: 3, bowl: 3 };
    if (!retained) inn.reviews[side] = Math.max(0, inn.reviews[side] - 1);
  }

  /** Tests: balls left in the match (today's and the remaining days'). */
  matchBallsLeft() {
    const T = this.state.test;
    if (!T) return null;
    const day = this.config.oversPerDay * BALLS_PER_OVER;
    return (this.config.days - T.day) * day + Math.max(0, day - T.dayBalls);
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
    if (this.isTest) return this.testSituation(inn);
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

  testSituation(inn) {
    const T = this.state.test;
    const dayLen = this.config.oversPerDay * BALLS_PER_OVER;
    const ballsLeft = this.matchBallsLeft();
    const need = runsRequired(inn);
    const ballAge = (inn.legalBalls - (inn.ballStart || 0)) / BALLS_PER_OVER;
    return {
      format: 'test',
      innings: this.state.current + 1,
      runs: inn.runs,
      wickets: inn.wickets,
      overs: oversString(inn.legalBalls),
      legalBalls: inn.legalBalls,
      ballsLeft,
      maxOvers: null,
      target: inn.target,
      need,
      crr: runRate(inn.runs, inn.legalBalls),
      rrr: inn.target != null ? (need * BALLS_PER_OVER) / Math.max(1, ballsLeft) : null,
      freeHit: false,
      wicketsLeft: inn.maxWickets - inn.wickets,
      day: T.day,
      days: this.config.days,
      session: Math.min(3, 1 + Math.floor(T.dayBalls / (dayLen / 3))),
      oversLeftToday: Math.max(0, Math.ceil((dayLen - T.dayBalls) / BALLS_PER_OVER)),
      lead: this.teamTotal(inn.battingTeam) - this.teamTotal(inn.bowlingTeam),
      ballAge,
      phaseOfInnings: inn.target != null && ballsLeft <= 60 ? 'death' : ballAge < 15 ? 'early' : 'middle',
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
