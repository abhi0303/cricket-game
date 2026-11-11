// Cricket scoring rules for one innings. Pure data in, pure data out, no animation.
// The delivery simulation produces a "ball record"; applyBall() is the only place
// runs, wickets and balls are ever added, so nothing can be counted twice.

export const BALLS_PER_OVER = 6;

export const DISMISSALS = {
  bowled: { label: 'Bowled', bowlerCredit: true },
  caught: { label: 'Caught', bowlerCredit: true },
  lbw: { label: 'LBW', bowlerCredit: true },
  runout: { label: 'Run out', bowlerCredit: false },
  stumped: { label: 'Stumped', bowlerCredit: true },
  hitwicket: { label: 'Hit wicket', bowlerCredit: true },
};

export function maxOversPerBowler(totalOvers) {
  return Math.max(1, Math.ceil(totalOvers / 5));
}

/** Which dismissals the laws allow on this ball. */
export function dismissalAllowed(type, { extra = null, freeHit = false } = {}) {
  if (!DISMISSALS[type]) return false;
  if (type === 'runout') return true;
  if (freeHit) return false;
  if (extra === 'noball') return false;
  if (extra === 'wide') return type === 'stumped' || type === 'hitwicket';
  return true;
}

export function oversString(legalBalls) {
  return `${Math.floor(legalBalls / BALLS_PER_OVER)}.${legalBalls % BALLS_PER_OVER}`;
}

export function runRate(runs, legalBalls) {
  return legalBalls > 0 ? (runs * BALLS_PER_OVER) / legalBalls : 0;
}

function newBatterStats(order) {
  return { runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, status: 'yet', out: null, order };
}

function bowlerStats(inn, id) {
  if (!inn.bowlers[id]) inn.bowlers[id] = { balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noballs: 0, dots: 0, order: Object.keys(inn.bowlers).length };
  return inn.bowlers[id];
}

/**
 * @param {object} o
 * @param {string} o.battingTeam  team id
 * @param {string} o.bowlingTeam  team id
 * @param {string[]} o.battingOrder player ids (11)
 * @param {number} o.maxOvers
 * @param {number|null} o.target   runs needed to win (2nd innings), or null
 */
export function createInnings({ number = 1, battingTeam, bowlingTeam, battingOrder, maxOvers, target = null, maxWickets = null, freeHits = true }) {
  if (!battingOrder || battingOrder.length < 2) throw new Error('Batting order needs at least two players');
  const batters = {};
  battingOrder.forEach((id, i) => { batters[id] = newBatterStats(i); });
  batters[battingOrder[0]].status = 'batting';
  batters[battingOrder[1]].status = 'batting';
  return {
    number,
    battingTeam,
    bowlingTeam,
    battingOrder: battingOrder.slice(),
    maxOvers: maxOvers ?? null,           // null: no limit (Test cricket: the match clock ends it)
    freeHits: freeHits !== false,         // free hit after a no-ball (limited overs, if switched on)
    reviews: { bat: 3, bowl: 3 },         // DRS reviews left for the batting and fielding sides
    ballStart: 0,                         // legal ball at which the ball in use was new
    maxWickets: maxWickets ?? battingOrder.length - 1,
    target,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0 },
    striker: battingOrder[0],
    nonStriker: battingOrder[1],
    nextBatter: 2,
    batters,
    bowlers: {},
    currentBowler: null,
    lastOverBowler: null,
    overRunsConceded: 0,
    thisOver: [],
    overs: [],
    fallOfWickets: [],
    partnership: { runs: 0, balls: 0 },
    freeHit: false,
    complete: false,
    endReason: null,
    ballLog: [],
  };
}

export function totalExtras(inn) {
  const e = inn.extras;
  return e.wides + e.noballs + e.byes + e.legbyes;
}

export function ballsRemaining(inn) {
  if (inn.maxOvers == null) return Infinity;
  return Math.max(0, inn.maxOvers * BALLS_PER_OVER - inn.legalBalls);
}

export function runsRequired(inn) {
  return inn.target == null ? null : Math.max(0, inn.target - inn.runs);
}

export function requiredRunRate(inn) {
  if (inn.target == null) return null;
  const b = ballsRemaining(inn);
  return b > 0 ? (runsRequired(inn) * BALLS_PER_OVER) / b : Infinity;
}

/** Bowlers allowed to bowl the next over. */
export function eligibleBowlers(inn, bowlerIds, totalOvers = inn.maxOvers) {
  const cap = maxOversPerBowler(totalOvers);
  const oversOf = id => Math.floor((inn.bowlers[id]?.balls || 0) / BALLS_PER_OVER);
  let list = bowlerIds.filter(id => id !== inn.lastOverBowler && oversOf(id) < cap);
  // Safety valve so a match can never get stuck: allow anyone but the last bowler.
  if (!list.length) list = bowlerIds.filter(id => id !== inn.lastOverBowler);
  if (!list.length) list = bowlerIds.slice();
  return list;
}

export function setBowler(inn, bowlerId, eligible = null) {
  if (inn.complete) throw new Error('Innings is complete');
  if (inn.legalBalls % BALLS_PER_OVER !== 0 && inn.currentBowler) throw new Error('Cannot change bowler mid-over');
  if (eligible && !eligible.includes(bowlerId)) throw new Error('Bowler is not eligible for this over');
  inn.currentBowler = bowlerId;
  bowlerStats(inn, bowlerId);
  inn.overRunsConceded = 0;
}

function ballLabel(b, runs, extraRuns) {
  if (b.dismissal) return b.extra === 'wide' ? 'W+Wd' : b.dismissal.type === 'runout' && runs ? `${runs}W` : 'W';
  if (b.extra === 'wide') return extraRuns > 1 ? `${extraRuns}Wd` : 'Wd';
  if (b.extra === 'noball') return runs ? `Nb+${runs}` : 'Nb';
  if (b.runType === 'bye') return `${runs}B`;
  if (b.runType === 'legbye') return `${runs}Lb`;
  return runs === 0 ? '•' : String(runs);
}

/**
 * Apply one delivery to the innings.
 * ball = {
 *   extra: null | 'wide' | 'noball',
 *   runs: completed runs (or the boundary value),
 *   boundary: 0 | 4 | 6,
 *   runType: 'bat' | 'bye' | 'legbye',
 *   dismissal: null | { type, batter, fielder, end: 'striker'|'nonStriker' (run outs) },
 *   shot, speedKph, ... (descriptive only)
 * }
 * Returns a list of events. Mutates inn.
 */
export function applyBall(inn, ball) {
  if (inn.complete) throw new Error('Innings already complete');
  if (!inn.currentBowler) throw new Error('No bowler set for this over');
  const events = [];
  const b = { extra: null, runs: 0, boundary: 0, runType: 'bat', dismissal: null, ...ball };
  if (b.extra && b.extra !== 'wide' && b.extra !== 'noball') throw new Error('Unknown extra ' + b.extra);
  const legal = !b.extra;
  const bowler = bowlerStats(inn, inn.currentBowler);
  const strikerId = inn.striker;
  const striker = inn.batters[strikerId];

  // Dismissals the laws don't allow are voided (e.g. "bowled" off a no-ball or a free hit).
  let dismissal = b.dismissal ? { ...b.dismissal } : null;
  if (dismissal) {
    if (!dismissalAllowed(dismissal.type, { extra: b.extra, freeHit: inn.freeHit })) {
      events.push({ type: 'dismissalVoided', dismissal });
      dismissal = null;
    } else if (dismissal.batter !== inn.striker && dismissal.batter !== inn.nonStriker) {
      throw new Error('Dismissed batter is not at the crease');
    } else if (dismissal.type !== 'runout' && dismissal.batter !== inn.striker) {
      throw new Error('Only the striker can be out ' + dismissal.type);
    }
  }

  let runs = Math.max(0, Math.floor(b.boundary || b.runs || 0));
  const boundary = b.boundary === 4 || b.boundary === 6 ? b.boundary : 0;
  if (dismissal && dismissal.type !== 'runout') runs = 0; // no runs on caught / bowled / lbw / stumped
  if (dismissal && dismissal.type === 'runout' && boundary) runs = b.runs || 0;
  const runType = b.extra === 'wide' ? 'wide' : (b.runType || 'bat');

  // --- runs and extras
  let penalty = 0;
  let charged = 0; // runs charged to the bowler
  if (b.extra === 'wide') {
    penalty = 1;
    inn.extras.wides += 1 + runs;
    charged = 1 + runs;
    bowler.wides++;
  } else if (b.extra === 'noball') {
    penalty = 1;
    inn.extras.noballs += 1;
    charged = 1;
    bowler.noballs++;
  }
  if (runType === 'bat') {
    striker.runs += runs;
    charged += runs;
    if (boundary === 4 && !dismissal) striker.fours++;
    if (boundary === 6 && !dismissal) striker.sixes++;
  } else if (runType === 'bye') inn.extras.byes += runs;
  else if (runType === 'legbye') inn.extras.legbyes += runs;

  const total = runs + penalty;
  inn.runs += total;
  bowler.runs += charged;
  inn.overRunsConceded += charged;
  if (b.extra !== 'wide') {
    striker.balls++;
    if (total === 0 && !dismissal) striker.dots++;
  }
  if (legal) {
    bowler.balls++;
    inn.legalBalls++;
    if (charged === 0) bowler.dots++;
  }
  inn.partnership.runs += total;
  if (legal) inn.partnership.balls++;

  // --- strike rotation from runs actually run (not boundaries)
  const ranRuns = boundary ? 0 : runs;
  if (ranRuns % 2 === 1) {
    [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
  }

  // --- wicket
  if (dismissal) {
    const outId = dismissal.batter;
    const st = inn.batters[outId];
    st.status = 'out';
    st.out = { type: dismissal.type, bowler: inn.currentBowler, fielder: dismissal.fielder || null };
    inn.wickets++;
    if (DISMISSALS[dismissal.type].bowlerCredit) bowler.wickets++;
    inn.fallOfWickets.push({ wicket: inn.wickets, runs: inn.runs, batter: outId, overs: oversString(inn.legalBalls) });
    inn.partnership = { runs: 0, balls: 0 };
    events.push({ type: 'wicket', batter: outId, dismissal: dismissal.type });

    const survivor = outId === inn.striker ? inn.nonStriker : inn.striker;
    // Which end does the incoming batter take? Run outs: the end where the wicket was broken.
    // Every other dismissal (including caught): the new batter comes in at the striker's end.
    const newAtStrikerEnd = dismissal.type === 'runout' ? dismissal.end !== 'nonStriker' : true;
    let incoming = null;
    if (inn.wickets < inn.maxWickets && inn.nextBatter < inn.battingOrder.length) {
      incoming = inn.battingOrder[inn.nextBatter++];
      inn.batters[incoming].status = 'batting';
      events.push({ type: 'newBatter', batter: incoming });
    }
    if (newAtStrikerEnd) { inn.striker = incoming; inn.nonStriker = survivor; }
    else { inn.striker = survivor; inn.nonStriker = incoming; }
  }

  // --- free hit carries to the next ball after a no-ball (and stays through wides); not in Tests or when switched off
  inn.freeHit = inn.freeHits !== false && (b.extra === 'noball' || (inn.freeHit && b.extra === 'wide'));

  // --- log
  const label = ballLabel({ ...b, dismissal }, runs, b.extra === 'wide' ? 1 + runs : runs);
  const entry = { label, runs: total, legal, extra: b.extra, boundary, wicket: !!dismissal, bowler: inn.currentBowler, striker: strikerId };
  inn.thisOver.push(entry);
  inn.ballLog.push({ ...entry, over: Math.floor((inn.legalBalls - (legal ? 1 : 0)) / BALLS_PER_OVER), desc: b.desc || '' });

  // --- end of innings?
  if (inn.wickets >= inn.maxWickets) endInnings(inn, 'allout', events);
  else if (inn.target != null && inn.runs >= inn.target) endInnings(inn, 'target', events);
  else if (inn.maxOvers != null && inn.legalBalls >= inn.maxOvers * BALLS_PER_OVER) endInnings(inn, 'overs', events);

  // --- end of over
  if (legal && inn.legalBalls % BALLS_PER_OVER === 0) {
    if (inn.overRunsConceded === 0 && inn.thisOver.every(x => x.bowler === inn.currentBowler)) bowler.maidens++;
    inn.overs.push({ bowler: inn.currentBowler, balls: inn.thisOver, runs: inn.thisOver.reduce((s, x) => s + x.runs, 0) });
    inn.thisOver = [];
    inn.lastOverBowler = inn.currentBowler;
    inn.currentBowler = null;
    if (!inn.complete) {
      [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
    }
    events.push({ type: 'overComplete', over: inn.overs.length });
  }
  return events;
}

/** The batting side declares (Test cricket). */
export function declareInnings(inn) {
  if (inn.complete) throw new Error('Innings already complete');
  const events = [];
  endInnings(inn, 'declared', events);
  return events;
}

function endInnings(inn, reason, events) {
  inn.complete = true;
  inn.endReason = reason;
  events.push({ type: 'inningsComplete', reason });
}

/** Sum of everything credited, used by tests to check nothing is double counted. */
export function auditInnings(inn) {
  const batRuns = Object.values(inn.batters).reduce((s, b) => s + b.runs, 0);
  const extras = totalExtras(inn);
  const bowlerBalls = Object.values(inn.bowlers).reduce((s, b) => s + b.balls, 0);
  const bowlerWkts = Object.values(inn.bowlers).reduce((s, b) => s + b.wickets, 0);
  const runouts = Object.values(inn.batters).filter(b => b.out && b.out.type === 'runout').length;
  return {
    runsMatch: batRuns + extras === inn.runs,
    ballsMatch: bowlerBalls === inn.legalBalls,
    wicketsMatch: bowlerWkts + runouts === inn.wickets,
    batRuns, extras,
  };
}
