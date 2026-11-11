// In-match HUD and overlays (pause, bowler choice, innings break, match result).
import { esc, hintBar, glyph } from './UI.js';
import { emblemDataURL } from './Emblem.js';
import { oversString, runRate, totalExtras, DISMISSALS } from '../game/CricketRules.js';
import { BOWLING_TYPES, ROLE_SHORT } from '../game/PlayerAttributes.js';
import { FIELD_PRESETS } from '../game/FieldPlacements.js';
import { finalOversFor } from '../game/SkipSim.js';
import { ordinal } from '../game/MatchEngine.js';
import { FieldMap, fieldCounts, chartColor } from './FieldMap.js';
import { projectionField } from '../game/NetsSim.js';
import { BATTER_X, STANCE_Z } from '../game/ShotModel.js';

const HUD_COMMON = `
      <div class="banner hidden"><div class="b-main"></div><div class="b-sub"></div></div>
      <div class="timing hidden"><div class="t-bar"><i class="z late"></i><i class="z good"></i><i class="z perfect"></i><i class="z good2"></i><i class="z early"></i><b class="t-mark"></b></div><div class="t-label"></div></div>
      <div class="meter hidden"><div class="m-type"></div><div class="m-bar"><i class="m-good"></i><i class="m-perfect"></i><i class="m-over"></i><b class="m-cursor"></b></div><div class="m-power"><i></i></div><div class="m-label"></div></div>
      <div class="prompt hidden"></div>
      <div class="replay-tag hidden"></div>`;

const HINT_TITLE = { batting: 'Batting', bowling: 'Bowling', fielding: 'Fielding', between: 'Between balls' };
const HUD_TOP_LEFT = `<div class="hud-tl"><button class="hud-btn" data-hud="pause" aria-label="Pause">❚❚</button><div class="hud-cap"><span class="hud-end"></span><span class="hud-last"></span><span class="hud-drs"></span></div></div>`;

export class HUD {
  /** nets: the net-practice layout (bowler card and session stats instead of field chart and scorecard). */
  constructor(root, { nets = false } = {}) {
    this.root = root;
    this.cache = new Map();
    this.nets = nets;
    if (nets) {
      root.innerHTML = `${HUD_TOP_LEFT}
      <div class="hud-right">
        <div class="fieldmap"><canvas aria-label="Standard field"></canvas><div class="fm-caption"><span class="fm-name"></span><span class="fm-count"></span></div></div>
        <div class="nets-card"></div>
        <div class="hints"></div>
      </div>${HUD_COMMON}
      <div class="netsbar">
        <div class="nb-head"><b>NET PRACTICE</b><span class="nb-bowler"></span></div>
        <div class="nb-stat"><span>Balls</span><b class="nb-balls">0</b></div>
        <div class="nb-stat"><span>Runs</span><b class="nb-runs">0</b></div>
        <div class="nb-stat"><span>4s · 6s</span><b class="nb-bnd">0 · 0</b></div>
        <div class="nb-stat"><span>Out</span><b class="nb-outs">0</b></div>
        <div class="nb-stat"><span>Middled</span><b class="nb-mid">–</b></div>
        <div class="nb-hist"><span class="tv-lab">LAST BALLS</span><span class="nb-chips"></span></div>
      </div>`;
      this.q = sel => root.querySelector(sel);
      this.map = new FieldMap(this.q('.fieldmap canvas'));
      return;
    }
    // Layout: pause + end caption top-left; field chart with the controls under it top-right;
    // a broadcast-style score strip along the bottom.
    root.innerHTML = `${HUD_TOP_LEFT}
      <div class="hud-right">
        <div class="fieldmap"><canvas aria-label="Field placings"></canvas><div class="fm-caption"><span class="fm-name"></span><span class="fm-count"></span></div></div>
        <div class="hints"></div>
      </div>${HUD_COMMON}
      <div class="auto-badge hidden"><b>AUTO-PLAY</b> <span>The AI is playing for you · pause to take control</span></div>
      <div class="drs hidden"><div class="drs-head"></div><div class="drs-sub"></div><div class="drs-rows"></div><div class="drs-final"></div></div>
      <div class="tvbar">
        <div class="tv-emb tv-bat"><img alt=""></div>
        <div class="tv-team">
          <div class="tv-r1"><span class="tv-short"></span><span class="tv-score"></span><span class="tv-ov"></span></div>
          <div class="tv-r2 tv-status"></div>
        </div>
        <div class="tv-col">
          <div class="tv-r1 tv-player tv-striker"></div>
          <div class="tv-r2 tv-thisover"></div>
        </div>
        <div class="tv-col">
          <div class="tv-r1 tv-player tv-non"></div>
          <div class="tv-r2 tv-bowler"></div>
        </div>
        <div class="tv-emb tv-bowl"><img alt=""></div>
      </div>`;
    this.q = sel => root.querySelector(sel);
    this.map = new FieldMap(this.q('.fieldmap canvas'));
  }

  set(sel, html, attr = 'innerHTML') {
    const k = sel + attr;
    if (this.cache.get(k) === html) return;
    this.cache.set(k, html);
    const el = this.q(sel);
    if (el) el[attr] = html;
  }
  show(sel, on) { const el = this.q(sel); if (el) el.classList.toggle('hidden', !on); }

  setTeams(bat, bowl) {
    this.q('.tv-bat img').src = emblemDataURL(bat, 96);
    this.q('.tv-bowl img').src = emblemDataURL(bowl, 96);
    const bar = this.q('.tvbar');
    bar.style.setProperty('--c1', bat.primary);
    bar.style.setProperty('--c2', bowl.primary);
    this.bat = bat; this.bowl = bowl;
    this.cache.clear();
  }

  /** Score strip text from the engine. */
  updateScore(engine, lastBall = null) {
    const inn = engine.innings;
    const bat = engine.battingTeam;
    const sit = engine.situation();
    const upper = t => esc(String(t).toUpperCase());
    this.set('.tv-short', esc(bat.short));
    this.set('.tv-score', `${inn.runs}-${inn.wickets}`);
    let status;
    if (engine.isTest) {
      // Test: overs without a limit; the lead/trail (or the target) and the day of the match.
      this.set('.tv-ov', `${oversString(inn.legalBalls)}<small> ov</small>`);
      const lead = sit.lead;
      const state = inn.target != null ? (sit.need <= 0 ? 'TARGET REACHED' : `NEED ${sit.need} TO WIN`)
        : sit.innings === 1 ? `1ST INNINGS · RR ${sit.crr.toFixed(2)}` : lead > 0 ? `LEAD BY ${lead}` : lead < 0 ? `TRAIL BY ${-lead}` : 'SCORES LEVEL';
      status = `${state} · DAY ${sit.day}`;
    } else {
      this.set('.tv-ov', `${oversString(inn.legalBalls)}<small>/${inn.maxOvers}</small>`);
      if (inn.target != null) {
        status = sit.need <= 0 ? 'TARGET REACHED' : `NEED ${sit.need} FROM ${sit.ballsLeft} BALL${sit.ballsLeft === 1 ? '' : 'S'}`;
      } else status = `RUN RATE ${sit.crr.toFixed(2)}`;
      if (inn.freeHit) status = `<b class="tv-fh">FREE HIT</b> ${status}`;
    }
    this.set('.tv-status', status);
    const bline = (id, star) => {
      if (!id) return '';
      const p = engine.player(id), s = inn.batters[id];
      return `<span class="tv-nm">${star ? '<i class="tv-on">▸</i>' : ''}${upper(p.name.split(' ').slice(-1)[0])}</span><span class="tv-rn">${s.runs}</span><span class="tv-bl">${s.balls}</span>`;
    };
    this.set('.tv-striker', bline(inn.striker, true));
    this.set('.tv-non', bline(inn.nonStriker, false));
    const chips = inn.thisOver.map(b => `<span class="tv-ball ${b.wicket ? 'w' : b.boundary === 6 ? 's' : b.boundary === 4 ? 'f' : b.extra ? 'x' : b.runs ? 'r' : 'd'}">${b.label === '0' || b.label === '•' ? '•' : esc(b.label)}</span>`).join('');
    this.set('.tv-thisover', `<span class="tv-lab">THIS OVER</span>${chips}`);
    const bw = engine.bowler || (inn.lastOverBowler && engine.player(inn.lastOverBowler));
    if (bw) {
      const s = inn.bowlers[bw.id] || { balls: 0, maidens: 0, runs: 0, wickets: 0 };
      this.set('.tv-bowler', `<span class="tv-nm">${upper(bw.name.split(' ').slice(-1)[0])}</span><span class="tv-fig">${s.wickets}-${s.runs}</span><span class="tv-bl">${oversString(s.balls)}</span>`);
    }
    if (lastBall) this.set('.hud-last', lastBall.speedKph ? `Last ball: ${esc(lastBall.deliveryType)} · ${lastBall.speedKph} km/h · ${esc(lastBall.lengthClass)}` : '');
  }

  /** Field chart (see FieldMap): the field, the batter's aim while a shot is lined up, and the ball's track once hit. */
  fieldMap(sim, up, presetLabel, aim = null) {
    if (!sim || !this.map) return;
    const ball = sim.phase === 'inplay' || sim.phase === 'dead' ? sim.ball?.p : null;
    const onField = ball && Math.hypot(ball.x, ball.z) < 70 ? ball : null;
    this.map.draw({
      fielders: sim.fielders, keeper: sim.keeper, bowler: sim.bowler, batters: sim.runners,
      ball: onField, up, aim,
      trail: sim.contactAt && onField && sim.ball.state !== 'thrown' && !sim.ball.holder ? { from: sim.contactAt, to: onField } : null,
      fieldColor: chartColor(this.bowl?.primary, this.bowl?.secondary), batColor: chartColor(this.bat?.primary, this.bat?.secondary),
    });
    const n = fieldCounts(sim.fielders);
    this.set('.fm-name', esc(presetLabel || 'Field'));
    this.set('.fm-count', `Off ${n.off} · Leg ${n.leg} · In ${n.inside}`);
  }

  /** Nets: the standard field the shots are scored against, the aim, and where the last shot would have gone. */
  netsMap(sim, up, aim = null, trail = null) {
    if (!sim || !this.map) return;
    const field = projectionField(sim.kind);
    const fielders = field.filter(f => !f.keeper && !f.bowler);
    this.map.draw({
      fielders, keeper: field.find(f => f.keeper), bowler: field.find(f => f.bowler),
      batters: [{ x: BATTER_X + (sim.guard || 0), z: STANCE_Z }], ball: null, up, aim, trail,
      fieldColor: '#3a86ff', batColor: chartColor(this.bat?.primary, this.bat?.secondary),
    });
    const n = fieldCounts(fielders);
    this.set('.fm-name', sim.kind === 'spin' ? 'Standard field (spin)' : 'Standard field');
    this.set('.fm-count', `Off ${n.off} · Leg ${n.leg} · In ${n.inside}`);
  }

  setEnd(text) { this.set('.hud-end', esc(text)); }

  /**
   * Net practice: the session strip (stats and the last few balls), the bowler card and the last-ball caption.
   * stats = NetsConfig stats, card = [[label, value]…], last = sim result of the last ball (or null).
   */
  updateNets(stats, bowlerLabel, card, last = null) {
    const chipClass = c => (c === '6' ? 's' : c === '4' ? 'f' : c === 'W' || c === 'C' ? 'w' : c === 'wd' ? 'x' : c === '•' ? 'd' : 'r');
    this.set('.nb-bowler', esc(bowlerLabel));
    this.set('.nb-balls', String(stats.balls));
    this.set('.nb-runs', String(stats.runs));
    this.set('.nb-bnd', `${stats.fours} · ${stats.sixes}`);
    this.set('.nb-outs', String(stats.outs));
    this.set('.nb-mid', stats.shots ? `${Math.round(stats.middled / stats.shots * 100)}%` : '–');
    this.set('.nb-chips', stats.history.map(c => `<span class="tv-ball ${chipClass(c)}">${esc(c)}</span>`).join(''));
    this.set('.nets-card', `<div class="nc-title">Bowler</div>${card.map(([k, v]) => `<div class="nc-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}`);
    this.set('.hud-last', last?.speedKph ? `Last ball: ${esc(last.deliveryType)} · <b>${last.speedKph} km/h</b> · ${esc(last.lengthClass)}` : '');
  }

  banner(main, sub = '', kind = '') {
    this.set('.b-main', main);
    this.set('.b-sub', sub);
    const b = this.q('.banner');
    b.className = 'banner ' + kind;
    void b.offsetWidth;
    b.classList.add('pop');
  }
  hideBanner() { this.show('.banner', false); }

  timing(t) {
    if (!t || !t.windows) { this.show('.timing', false); return; }
    const { perfect, good, ok } = t.windows;
    const range = ok * 1.25;
    const pos = Math.max(-1, Math.min(1, t.error / range)); // -1 early .. +1 late
    const bar = this.q('.t-bar');
    bar.style.setProperty('--p', (perfect / range * 50) + '%');
    bar.style.setProperty('--g', (good / range * 50) + '%');
    bar.style.setProperty('--o', (ok / range * 50) + '%');
    this.q('.t-mark').style.left = (50 - pos * 50) + '%';
    const label = { perfect: 'PERFECT', good: 'GOOD', early: 'EARLY', late: 'LATE', 'missed-early': 'WAY TOO EARLY', 'missed-late': 'TOO LATE' }[t.label] || String(t.label || '').toUpperCase();
    this.set('.t-label', `${label}${t.shot ? ` <small>${esc(t.shot)}</small>` : ''}`);
    this.q('.timing').className = 'timing ' + t.label;
  }

  meter(sim, typeLabel, power, sel = null) {
    const on = !!sim;
    this.show('.meter', on);
    if (!on) return;
    const m = sim.meter;
    this.q('.m-cursor').style.left = Math.min(100, (m.released ? m.releaseValue : m.value) * 100) + '%';
    const speed = sel ? `<span class="m-speed">${sel.canSlower ? '‹' : ' '} <b>${sel.speed}</b> km/h ${sel.canFaster ? '›' : ' '}</span>` : '';
    this.set('.m-type', `${speed}<span class="m-len">${esc(sel?.length || '')}</span><span class="m-var">${esc(typeLabel)}</span>`);
    this.q('.m-power i').style.width = Math.round(power * 100) + '%';
    this.set('.m-label', m.released ? `${esc(m.rating)} release` : m.active ? 'Release in the green zone' : 'Aim, pick a delivery, then hold to run in');
  }

  prompt(html) { this.show('.prompt', !!html); if (html) this.set('.prompt', html); }
  /** The third umpire's panel: o = { head, sub, rows: [{label, value, tone}], final: {text, sub, tone} } or null to hide. */
  drs(o) {
    this.show('.drs', !!o);
    if (!o) return;
    this.set('.drs-head', esc(o.head));
    this.set('.drs-sub', esc(o.sub || ''));
    this.set('.drs-rows', (o.rows || []).map(r => `<div class="drs-row"><span>${esc(r.label)}</span><b class="${r.tone}">${esc(r.value)}</b></div>`).join(''));
    this.set('.drs-final', o.final ? `<div class="drs-dec ${o.final.tone}">${esc(o.final.text)}</div><div class="drs-why">${esc(o.final.sub)}</div>` : '');
  }
  /** Reviews left for each side, e.g. "DRS  MCC ●●● · RBR ●●○". */
  drsCount(html) { this.set('.hud-drs', html); }

  replayTag(text) { this.show('.replay-tag', !!text); if (text) this.set('.replay-tag', `<i></i>${esc(text)}`); }
  autoBadge(on) { this.show('.auto-badge', on); }
  /** Compact two-column button card under the field chart; `title` names the situation (e.g. BATTING). */
  /**
   * The controls card under the field chart: a title, an optional status line (e.g. the running call) and the
   * buttons for what can be done right now. No items hides it.
   */
  hints(input, profile, items, title = HINT_TITLE[profile] || '', { status = '', urgent = false } = {}) {
    const el = this.q('.hints');
    if (el) { el.classList.toggle('live', !!status && items.length > 0); el.classList.toggle('urgent', urgent); }
    this.set('.hints', items.length ? `${title ? `<div class="hints-head">${esc(title)}</div>` : ''}${status ? `<div class="hints-status">${esc(status)}</div>` : ''}<div class="hints-grid">${hintBar(input, profile, items)}</div>` : '');
  }
}

// ---------------------------------------------------------------- overlays
export function renderOverlay(root, html, onClick) {
  root.innerHTML = `<div class="ov-card">${html}</div>`;
  root.classList.remove('hidden');
  root.onclick = e => { const b = e.target.closest('[data-ov]'); if (b) onClick(b.dataset.ov, b); };
  const first = root.querySelector('button:not([disabled])');
  if (first) first.focus();
}
export function hideOverlay(root) { root.classList.add('hidden'); root.innerHTML = ''; root.onclick = null; }

const optionButtons = opts => opts.map(([act, label, sub, primary]) =>
  `<button class="btn${primary ? ' primary' : ''}" data-ov="${act}">${label}${sub ? `<small>${sub}</small>` : ''}</button>`).join('');

export function pauseHTML(engine, { auto = false, userBowling = false } = {}) {
  const s = engine.situation();
  const test = engine.isTest;
  const canDeclare = test && !userBowling && engine.inningsIndex < 3 && engine.innings.legalBalls > 0;
  return `<h2>Paused <small>${esc(engine.state.teams[0].short)} v ${esc(engine.state.teams[1].short)} · ${test ? `Test, day ${s.day} of ${s.days}` : `${engine.config.overs}-over match`}</small></h2>
    <div class="pause-grid">
      <div class="ov-actions col menu">
        <button class="btn primary" data-ov="resume">Resume</button>
        ${optionButtons([
          auto ? ['autoplay', 'Take back control', `Stop the AI ${userBowling ? 'bowling' : 'batting'} for you`]
            : ['autoplay', 'Auto-play', `The AI ${userBowling ? 'bowls' : 'bats'} for you while you watch`],
          ...(canDeclare ? [['declare', 'Declare', `Close the innings at ${s.runs}/${s.wickets}${s.lead ? ` (${s.lead > 0 ? 'lead' : 'trail'} by ${Math.abs(s.lead)})` : ''}`]] : []),
          ...(test ? [['skip', 'Skip ahead', 'To stumps, the end of the innings, or the result']]
            : userBowling ? [['skip', 'Skip bowling', s.target != null ? 'The final overs or the result' : 'Simulate the rest of this innings']] : []),
        ])}
        <button class="btn" data-ov="scorecard">Scorecard</button>
        <button class="btn" data-ov="controls">Controls</button>
        <button class="btn" data-ov="settings">Settings</button>
        <button class="btn ghost" data-ov="quit">Save &amp; quit to menu</button>
      </div>
      ${matchSummaryHTML(engine)}
    </div>`;
}

/** At-a-glance match state for the pause menu: score, the chase or lead, the batters in, the bowler, this over. */
export function matchSummaryHTML(engine) {
  const inn = engine.innings;
  if (!inn) return '';
  const s = engine.situation(), bat = engine.battingTeam, bowl = engine.bowlingTeam;
  const status = engine.isTest
    ? (inn.target != null ? `Need ${s.need} to win · ${Math.floor(s.ballsLeft / 6)} overs left in the match` : s.innings === 1 ? `1st innings · run rate ${s.crr.toFixed(2)}` : s.lead > 0 ? `Lead by ${s.lead}` : s.lead < 0 ? `Trail by ${-s.lead}` : 'Scores level')
    : inn.target != null ? `Need ${s.need} from ${s.ballsLeft} ball${s.ballsLeft === 1 ? '' : 's'} · required ${s.rrr === Infinity ? '—' : s.rrr.toFixed(2)}` : `Run rate ${s.crr.toFixed(2)} · ${s.ballsLeft} balls left`;
  const batter = id => {
    if (!id) return '';
    const p = engine.player(id), b = inn.batters[id];
    return `<div class="ps-row${id === inn.striker ? ' on' : ''}"><span>${esc(p.name)}${id === inn.striker ? ' <i>*</i>' : ''}</span><b>${b.runs}</b><small>(${b.balls})</small></div>`;
  };
  const bw = engine.bowler || (inn.lastOverBowler && engine.player(inn.lastOverBowler));
  const bs = bw && (inn.bowlers[bw.id] || { balls: 0, maidens: 0, runs: 0, wickets: 0 });
  const chips = inn.thisOver.map(b => `<span class="tv-ball ${b.wicket ? 'w' : b.boundary === 6 ? 's' : b.boundary === 4 ? 'f' : b.extra ? 'x' : b.runs ? 'r' : 'd'}">${b.label === '0' || b.label === '•' ? '•' : esc(b.label)}</span>`).join('');
  const last = inn.fallOfWickets[inn.fallOfWickets.length - 1];
  return `<div class="pause-info" style="--c1:${bat.primary}">
    <div class="ps-head"><img src="${emblemDataURL(bat, 64)}" alt=""><div><b>${esc(bat.name)}</b><span>${esc(status)}</span></div>
      <div class="ps-score"><b>${inn.runs}/${inn.wickets}</b><span>${s.overs} ov</span></div></div>
    <div class="ps-sec"><div class="ps-lab">At the crease</div>${batter(inn.striker)}${batter(inn.nonStriker)}
      <div class="ps-note">Partnership ${inn.partnership.runs} (${inn.partnership.balls})${last ? ` · last wicket ${esc(engine.player(last.batter)?.name || '')} at ${last.runs}` : ''}</div></div>
    ${bw ? `<div class="ps-sec"><div class="ps-lab">Bowling · ${esc(bowl.short)}</div><div class="ps-row"><span>${esc(bw.name)}</span><b>${bs.wickets}-${bs.runs}</b><small>(${oversString(bs.balls)})</small></div></div>` : ''}
    <div class="ps-sec"><div class="ps-lab">This over</div><div class="ps-over">${chips || '<span class="muted">New over</span>'}</div></div>
  </div>`;
}

/** Offer the player a review of an LBW decision. */
export function reviewPromptHTML({ onField, side, left, seconds }) {
  const out = onField === 'out';
  return `<h2 class="${out ? 'loss' : ''}">${out ? 'OUT · LBW' : 'NOT OUT · LBW appeal turned down'}</h2>
    <p class="muted">${side === 'bat' ? 'Your batter has been given out leg before wicket.' : 'The umpire has turned down your LBW appeal.'} Send it to the third umpire? You have <b>${left}</b> review${left === 1 ? '' : 's'} left this innings (a review you lose on a clear decision is gone; umpire's call keeps it).</p>
    <div class="ov-actions">${optionButtons([
      ['review', 'Review (DRS)', 'Ball tracking decides', true],
      ['accept', side === 'bat' ? 'Walk off' : 'Accept the decision', ''],
    ])}</div>
    <div class="review-timer" style="--secs:${seconds}s"><i></i></div>`;
}

/** Net practice pause menu. */
export function netsPauseHTML(stats, bowlerLabel) {
  return `<h2>Paused</h2><p class="muted">Net practice · ${esc(bowlerLabel)} · ${stats.balls} ball${stats.balls === 1 ? '' : 's'} faced</p>
    <div class="ov-actions col">
      <button class="btn primary" data-ov="resume">Resume</button>
      ${optionButtons([
        ['bowler', 'Change bowler', 'Type, speed, length, line or batter'],
        ['reset', 'Reset session stats', 'Start counting again from zero'],
      ])}
      <button class="btn" data-ov="controls">Controls</button>
      <button class="btn" data-ov="settings">Settings</button>
      <button class="btn ghost" data-ov="quit">Leave the nets</button>
    </div>`;
}

/** Summary shown when leaving the nets. */
export function netsSummaryHTML(stats, bowlerLabel, batter) {
  const sr = stats.balls ? (stats.runs / stats.balls * 100).toFixed(0) : '–';
  const pct = n => (stats.shots ? `${Math.round(n / stats.shots * 100)}%` : '–');
  const tile = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  return `<h2>Session summary</h2>
    <p class="muted">${esc(batter?.name || 'Batter')} against ${esc(bowlerLabel)}</p>
    <div class="awards nets-summary">
      ${tile('Balls faced', stats.balls)}${tile('Runs (match value)', stats.runs)}${tile('Strike rate', sr)}
      ${tile('Fours · Sixes', `${stats.fours} · ${stats.sixes}`)}${tile('Dismissals', stats.outs)}${tile('Dot balls', stats.dots)}
      ${tile('Shots middled', pct(stats.middled))}${tile('Edges', stats.edges)}${tile('Played and missed', stats.beaten)}
    </div>
    <div class="ov-actions">${optionButtons([
      ['back', 'Keep practising', '', true],
      ['setup', 'New bowler set-up', 'Back to the Net Practice screen'],
      ['menu', 'Main menu', ''],
    ])}</div>`;
}

/** Skip-bowling choices for the current innings (first innings: finish it; a chase: the finish or the result). */
export function skipHTML(engine) {
  const s = engine.situation(), bat = engine.battingTeam;
  if (engine.isTest) {
    return `<h2>Skip ahead</h2>
    <p class="muted">${esc(bat.name)} ${s.runs}/${s.wickets} (${s.overs} ov) · Day ${s.day}, ${s.oversLeftToday} over${s.oversLeftToday === 1 ? '' : 's'} left today</p>
    <div class="ov-actions col">${optionButtons([
      ['stumps', 'Simulate to stumps', `The rest of Day ${s.day}`, true],
      ['innings', 'Simulate this innings', `${esc(bat.name)} bat until they are out or declare`],
      ['result', 'Simulate to the result', 'Play out the rest of the match'],
    ])}<button class="btn ghost" data-ov="back">Back</button></div>`;
  }
  const n = finalOversFor(engine.config.overs);
  const fin = `last ${n} over${n > 1 ? 's' : ''}, a close finish or the last two wickets`;
  const opts = s.target != null ? [
    ['finalWatch', 'Watch the final overs', `Simulate to the finish (${fin}), then watch it play out`, true],
    ['finalPlay', 'Bowl the final overs', 'Simulate to the finish, then bowl it yourself'],
    ['result', 'Simulate to the result', 'Go straight to the result'],
  ] : [
    ['innings', 'Simulate the innings', `${esc(bat.name)} finish their innings instantly. Then you choose how to play the chase.`, true],
  ];
  return `<h2>Skip bowling</h2>
    <p class="muted">${esc(bat.name)} ${s.runs}/${s.wickets} (${s.overs} ov)${s.target != null ? ` · need ${s.need} from ${s.ballsLeft} ball${s.ballsLeft === 1 ? '' : 's'}` : ''}</p>
    <div class="ov-actions col">${optionButtons(opts)}<button class="btn ghost" data-ov="back">Back</button></div>`;
}

/** Shown while balls are simulated; updateSimulating() refreshes the score in place. */
export function simulatingHTML(title) {
  return `<h2>${esc(title)}</h2>
    <p class="big sim-score"></p><p class="muted sim-need"></p>
    <div class="sim-bar"><i></i></div>
    <div class="ov-actions"><button class="btn" data-ov="simStop">Stop here and play<small>Take over from this ball</small></button></div>`;
}
export function updateSimulating(root, engine) {
  const inn = engine.innings || engine.state.innings[engine.state.innings.length - 1];
  if (!inn) return;
  const bat = engine.team(inn.battingTeam);
  const q = sel => root.querySelector(sel);
  if (!q('.sim-score')) return;
  if (engine.isTest) {
    const T = engine.state.test, day = engine.config.oversPerDay * 6;
    q('.sim-score').innerHTML = `${esc(bat.name)} <b>${inn.runs}/${inn.wickets}</b> <small>(${oversString(inn.legalBalls)} ov) · Day ${T.day}</small>`;
    q('.sim-need').innerHTML = testScoreLine(engine);
    q('.sim-bar i').style.width = Math.min(100, ((T.day - 1) * day + T.dayBalls) / (engine.config.days * day) * 100) + '%';
    return;
  }
  q('.sim-score').innerHTML = `${esc(bat.name)} <b>${inn.runs}/${inn.wickets}</b> <small>(${oversString(inn.legalBalls)} / ${inn.maxOvers} ov)</small>`;
  q('.sim-need').textContent = inn.target != null ? `Target ${inn.target} · need ${Math.max(0, inn.target - inn.runs)}` : '';
  q('.sim-bar i').style.width = Math.min(100, inn.legalBalls / (inn.maxOvers * 6) * 100) + '%';
}

/** In-match settings: camera angles and a few comfort options, applied immediately. nets: batting-only options. */
export function settingsHTML(s, battingViews, bowlingViews, { nets = false } = {}) {
  const sel = (id, opts, cur) => `<select id="${id}" data-setting="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const onOff = [['true', 'On'], ['false', 'Off']];
  return `<h2>Settings</h2>
    <div class="settings-grid">
      <label>Batting camera ${sel('battingCamera', battingViews.map(v => [v.id, v.label]), s.battingCamera)}</label>
      ${nets ? '' : `<label>Bowling camera ${sel('bowlingCamera', bowlingViews.map(v => [v.id, v.label]), s.bowlingCamera)}</label>`}
      <label>Sound ${sel('sound', onOff, String(s.sound))}</label>
      <label>On-screen control hints ${sel('hints', [['on', 'Show'], ['off', 'Hide']], s.hints === 'off' ? 'off' : 'on')}</label>
      <label class="slider">Volume <input type="range" id="volume" data-setting="volume" min="0" max="1" step="0.05" value="${s.volume}"></label>
      ${nets ? '' : `<label>Replays after big moments ${sel('autoReplay', onOff, String(s.autoReplay))}</label>
      <label>Bowling aim marker ${sel('aimMarker', [['true', 'Show'], ['false', 'Hide']], String(s.aimMarker))}</label>
      <label>Running between wickets ${sel('assistRunning', [['false', 'Manual'], ['true', 'Assisted']], String(s.assistRunning))}</label>`}
    </div>
    <p class="muted">Tip: press the camera button (V / View / Share) during play to cycle the cameras.</p>
    <div class="ov-actions"><button class="btn primary" data-ov="back">Back</button></div>`;
}

export function bowlerSelectHTML(engine, suggested, preset) {
  const inn = engine.innings;
  const eligible = new Set(engine.eligibleBowlers());
  const cap = engine.maxOversPerBowler();
  const rows = engine.bowlingOptions().map(p => {
    const s = inn.bowlers[p.id] || { balls: 0, maidens: 0, runs: 0, wickets: 0 };
    const fat = engine.fatigueOf(p.id);
    const ok = eligible.has(p.id);
    const why = !ok ? (p.id === inn.lastOverBowler ? 'bowled last over' : `${cap} over limit`) : '';
    return `<button class="bsel ${p.id === suggested ? 'sug' : ''}" data-ov="bowler" data-id="${p.id}" ${ok ? '' : 'disabled'}>
      <span class="badge ${p.role === 'allrounder' ? 'r-ar' : 'r-bowl'}">${ROLE_SHORT[p.role]}</span>
      <span class="bs-name">${esc(p.name)} <small>${esc(BOWLING_TYPES[p.bowlingType].label)}</small></span>
      <span class="bs-fig">${oversString(s.balls)}-${s.maidens}-${s.runs}-${s.wickets}</span>
      <span class="bs-fat" title="Fatigue"><i style="width:${Math.round((1 - fat) * 100)}%"></i></span>
      <span class="bs-why">${why || (p.id === suggested ? 'suggested' : '')}</span></button>`;
  }).join('');
  return `<h2>Over ${inn.overs.length + 1} — choose your bowler</h2>
    <div class="bsel-list">${rows}</div>
    <label class="field-pick">Field <select id="fieldPreset">
      <option value="auto" ${preset === 'auto' ? 'selected' : ''}>Captain decides</option>
      ${Object.entries(FIELD_PRESETS).map(([k, v]) => `<option value="${k}" ${preset === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <div class="ov-actions">${optionButtons([
      ['captain', 'Captain picks the bowlers', 'For the rest of this innings; you still bowl'],
      ['autoBowl', 'Auto-play', 'The AI bowls for you while you watch'],
      ...(engine.isTest ? [] : [['skip', 'Skip bowling', inn.target != null ? 'Simulate ahead: the final overs or the result' : 'Simulate the rest of this innings']]),
    ])}</div>`;
}

function howOut(engine, s) {
  if (!s.out) return s.status === 'batting' ? 'not out' : '';
  const o = s.out, pn = id => esc(engine.player(id)?.name || '');
  if (o.type === 'runout') return `run out${o.fielder ? ` (${pn(o.fielder)})` : ''}`;
  if (o.type === 'caught') return o.fielder === o.bowler ? `c &amp; b ${pn(o.bowler)}` : `c ${pn(o.fielder)} b ${pn(o.bowler)}`;
  if (o.type === 'stumped') return `st ${pn(o.fielder)} b ${pn(o.bowler)}`;
  if (o.type === 'lbw') return `lbw b ${pn(o.bowler)}`;
  if (o.type === 'hitwicket') return `hit wicket b ${pn(o.bowler)}`;
  return `b ${pn(o.bowler)}`;
}

/** One innings as a TV-style card: team band with the total, batting, fall of wickets, bowling. */
function inningsCard(engine, inn, label) {
  const team = engine.team(inn.battingTeam);
  const live = engine.innings === inn && engine.phase === 'innings';
  const played = inn.battingOrder.filter(id => inn.batters[id].status !== 'yet');
  const top = played.reduce((b, id) => (!b || inn.batters[id].runs > inn.batters[b].runs ? id : b), null);
  const rows = played.map(id => {
    const p = engine.player(id), s = inn.batters[id];
    const notOut = !s.out;
    const cls = [notOut ? 'live' : '', id === top && s.runs > 0 ? 'top' : '', live && id === inn.striker ? 'strike' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}"><td class="nm">${esc(p.name)}${notOut ? '<i>*</i>' : ''}</td><td class="how">${howOut(engine, s)}</td>
      <td class="r">${s.runs}</td><td>${s.balls}</td><td>${s.fours}</td><td>${s.sixes}</td><td>${s.balls ? (s.runs / s.balls * 100).toFixed(1) : '-'}</td></tr>`;
  }).join('');
  const yet = inn.battingOrder.filter(id => inn.batters[id].status === 'yet').map(id => esc(engine.player(id).name));
  const e = inn.extras;
  const fow = inn.fallOfWickets.map(w => `<span><b>${w.wicket}-${w.runs}</b> ${esc(engine.player(w.batter)?.name.split(' ').slice(-1)[0] || '')} <small>${w.overs}</small></span>`).join('');
  const bowlers = Object.entries(inn.bowlers).sort((a, b) => a[1].order - b[1].order);
  const best = bowlers.reduce((b, [id, s]) => (!b || s.wickets > b[1].wickets || (s.wickets === b[1].wickets && s.runs < b[1].runs && s.balls) ? [id, s] : b), null);
  const brows = bowlers.map(([id, s]) => `<tr class="${best && best[0] === id && s.wickets ? 'top' : ''}${live && id === inn.currentBowler ? ' strike' : ''}"><td class="nm">${esc(engine.player(id).name)}</td>
    <td>${oversString(s.balls)}</td><td>${s.maidens}</td><td>${s.runs}</td><td class="r">${s.wickets}</td><td>${s.balls ? (s.runs / s.balls * 6).toFixed(2) : '-'}</td><td>${s.wides}</td><td>${s.noballs}</td></tr>`).join('');
  const rr = runRate(inn.runs, inn.legalBalls).toFixed(2);
  const status = inn.endReason === 'declared' ? 'declared' : inn.endReason === 'allout' ? 'all out' : inn.endReason === 'target' ? 'target reached' : live ? 'batting' : '';
  return `<div class="sc-head" style="--c1:${team.primary};--c2:${team.secondary}">
      <img src="${emblemDataURL(team, 64)}" alt="">
      <div class="sc-team"><b>${esc(team.name)}</b><span>${esc(label)}${status ? ` · ${status}` : ''}</span></div>
      <div class="sc-total"><b>${inn.runs}${inn.wickets < 10 ? `/${inn.wickets}` : ''}</b><span>${oversString(inn.legalBalls)}${inn.maxOvers ? ` / ${inn.maxOvers}` : ''} ov · RR ${rr}</span></div>
    </div>
    <table class="sc-tab sc-bat"><thead><tr><th>Batter</th><th></th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="how">Yet to bat</td></tr>'}</tbody>
      <tfoot><tr><td>Extras</td><td class="how">w ${e.wides} · nb ${e.noballs} · b ${e.byes} · lb ${e.legbyes}</td><td class="r">${totalExtras(inn)}</td><td colspan="4"></td></tr>
      <tr class="tot"><td>Total</td><td class="how">${oversString(inn.legalBalls)} overs · run rate ${rr}</td><td class="r">${inn.runs}/${inn.wickets}</td><td colspan="4"></td></tr></tfoot></table>
    ${yet.length ? `<div class="sc-line"><span class="lab">${live ? 'Yet to bat' : 'Did not bat'}</span>${yet.join(', ')}</div>` : ''}
    ${fow ? `<div class="sc-line sc-fow"><span class="lab">Fall of wickets</span>${fow}</div>` : ''}
    <table class="sc-tab sc-bowl"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th><th>Wd</th><th>Nb</th></tr></thead><tbody>${brows}</tbody></table>`;
}

let scSeq = 0;
/** The full scorecard: one tab per innings (the latest open), switched with radio buttons so no script is needed. */
export function scorecardHTML(engine) {
  const inns = engine.state.innings;
  const id = `sc${++scSeq}`;
  const label = (inn, i) => engine.isTest
    ? `${['1st', '2nd'][inns.slice(0, i + 1).filter(x => x.battingTeam === inn.battingTeam).length - 1] || ''} innings`
    : `${['1st', '2nd', '3rd', '4th'][i]} innings`;
  return `<div class="scard">
    ${inns.map((inn, i) => `<input type="radio" class="sc-pick" name="${id}" id="${id}-${i}" ${i === inns.length - 1 ? 'checked' : ''}>`).join('')}
    <div class="sc-tabs">${inns.map((inn, i) => `<label for="${id}-${i}"><b>${esc(engine.team(inn.battingTeam).short)}</b> ${esc(label(inn, i))} <small>${inn.runs}/${inn.wickets}</small></label>`).join('')}</div>
    <div class="sc-panes">${inns.map((inn, i) => `<section class="sc-pane">${inningsCard(engine, inn, label(inn, i))}</section>`).join('')}</div>
  </div>`;
}

/** Short Test score line: "HHK 325 & 210/4d" for each side. */
export function testScoreLine(engine) {
  return engine.state.teams.map(t => {
    const inns = engine.state.innings.filter(i => i.battingTeam === t.id);
    if (!inns.length) return `<b>${esc(t.short)}</b> yet to bat`;
    return `<b>${esc(t.short)}</b> ${inns.map(i => `${i.runs}${i.wickets < 10 ? `/${i.wickets}` : ''}${i.endReason === 'declared' ? 'd' : ''}`).join(' &amp; ')}`;
  }).join(' &nbsp;·&nbsp; ');
}

/** Test innings break: the scores, who bats next, and the follow-on choice when there is one. */
export function testBreakHTML(engine, { followOn = null } = {}) {
  const s = engine.state, last = engine.innings, idx = engine.inningsIndex;
  const opt = s.test.followOnOption;
  const leader = opt && engine.team(opt.team);
  const userLeads = leader?.isUser;
  const nextBat = engine.team(engine.battingTeamFor(idx + 1));
  const why = last.endReason === 'declared' ? 'declared' : last.endReason === 'allout' ? 'all out' : '';
  let body = '';
  if (opt && userLeads && followOn == null) {
    body = `<p>You lead by <b>${opt.lead}</b>. Enforce the follow-on and make them bat again straight away, or bat again yourself?</p>
      <div class="ov-actions">${optionButtons([
        ['enforce', 'Enforce the follow-on', `${esc(engine.team(last.battingTeam).name)} bat again, ${opt.lead} behind`, true],
        ['batAgain', 'Bat again', 'Build a bigger lead first'],
      ])}</div>`;
  } else {
    const fo = followOn ?? false;
    const third = idx === 1 ? (fo ? engine.team(last.battingTeam) : engine.team(s.innings[0].battingTeam)) : nextBat;
    const batNext = idx === 1 ? third : nextBat;
    const tgt = idx === 2 ? engine.teamTotal(last.battingTeam) - engine.teamTotal(batNext.id) + 1 : null;
    const info = opt && !userLeads ? `<p><b>${esc(leader.name)}</b> ${fo ? 'enforce the follow-on' : 'choose to bat again'} (lead ${opt.lead}).</p>` : '';
    body = `${info}<p>${esc(batNext.name)} bat next${tgt != null ? `, needing <b>${tgt}</b> to win` : ''}.</p>
      <div class="ov-actions">${optionButtons([
        ['next', batNext.isUser ? 'Start batting →' : 'Start bowling →', `${ordinal(idx + 2)} innings, Day ${s.test.day}`, true],
        ['watch', 'Watch (auto-play)', 'The AI plays your side; pause to take control'],
        ['simInnings', 'Simulate this innings', ''],
        ['result', 'Simulate to the result', ''],
      ])}</div>`;
  }
  return `<h2>${esc(engine.team(last.battingTeam).name)} ${last.runs}/${last.wickets}${why ? ` <small>${why}</small>` : ''}</h2>
    <p class="big">${testScoreLine(engine)}</p>
    ${body}
    <div class="sc-scroll">${scorecardHTML(engine)}</div>`;
}

/** End of a day's play in a Test. */
export function stumpsHTML(engine, day) {
  const inn = engine.innings || engine.state.innings[engine.state.innings.length - 1];
  const sit = engine.phase === 'innings' ? engine.situation() : null;
  const bat = engine.team(inn.battingTeam);
  const next = engine.phase === 'break' ? 'The next innings starts' : `${esc(bat.name)} resume on ${inn.runs}/${inn.wickets}`;
  const lead = sit ? (inn.target != null ? `, needing ${sit.need} more to win` : sit.lead > 0 ? `, ${sit.lead} ahead` : sit.lead < 0 ? `, ${-sit.lead} behind` : '') : '';
  return `<h2>Stumps — Day ${day}</h2>
    <p class="big">${testScoreLine(engine)}</p>
    <p>${next} on Day ${day + 1}${lead}.</p>
    <div class="ov-actions">${optionButtons([
      ['nextDay', `Start Day ${day + 1} →`, '', true],
      ['simDay', `Simulate Day ${day + 1}`, 'Then carry on from stumps'],
      ['result', 'Simulate to the result', ''],
      ['scorecard', 'Scorecard', ''],
      ['quit', 'Save &amp; quit', 'Carry on later from the main menu'],
    ])}</div>`;
}

export function inningsBreakHTML(engine) {
  const i1 = engine.state.innings[0];
  const bat = engine.team(i1.battingTeam);
  const chase = engine.team(i1.bowlingTeam);
  return `<h2>Innings break</h2>
    <p class="big">${esc(bat.name)} <b>${i1.runs}/${i1.wickets}</b> <small>(${oversString(i1.legalBalls)} ov)</small></p>
    <p>${esc(chase.name)} need <b>${i1.runs + 1}</b> to win from ${i1.maxOvers} overs (${(((i1.runs + 1) / i1.maxOvers)).toFixed(2)} per over).</p>
    <div class="sc-scroll">${scorecardHTML(engine)}</div>
    <div class="ov-actions">${optionButtons(chase.isUser ? [
      ['second', 'Start the chase →', 'You bat from the first ball', true],
      ['finalPlay', 'Jump to the final overs', 'The AI bats until the finish, then you take over'],
      ['watch', 'Watch the chase', 'Auto-play: the AI bats for you (pause to take control)'],
      ['result', 'Simulate to the result', ''],
    ] : [
      ['second', 'Defend the total →', 'You bowl from the first ball', true],
      ['finalWatch', 'Watch the final overs', 'Skip the bowling, then watch the finish of the chase'],
      ['finalPlay', 'Bowl the final overs', 'Skip ahead, then bowl the finish yourself'],
      ['result', 'Simulate to the result', ''],
    ])}</div>`;
}

export function resultHTML(engine) {
  const r = engine.state.result;
  const s = engine.summary();
  const userWon = r.winner && engine.team(r.winner).isUser;
  const fig = (x) => x ? `${esc(x.player.name)} <small>${x.wickets != null && x.overs != null ? `${x.wickets}/${x.runs} (${x.overs})` : `${x.runs} (${x.balls})`}</small>` : '-';
  const level = r.type === 'tie' || r.type === 'draw';
  return `<h2 class="${level ? '' : userWon ? 'win' : 'loss'}">${r.type === 'tie' ? 'It\'s a tie!' : r.type === 'draw' ? 'Match drawn' : userWon ? 'Victory!' : 'Defeat'}</h2>
    ${engine.isTest ? `<p class="muted">${testScoreLine(engine)}</p>` : ''}
    <p class="big">${esc(r.text)}</p>
    <div class="awards">
      <div><span>Top scorer</span><b>${s.topScorer ? `${esc(s.topScorer.player.name)} <small>${s.topScorer.runs} (${s.topScorer.balls})</small>` : '-'}</b></div>
      <div><span>Best bowler</span><b>${fig(s.bestBowler)}</b></div>
      <div><span>Player of the match</span><b>${s.playerOfMatch ? esc(s.playerOfMatch.name) : '-'}</b></div>
    </div>
    <div class="sc-scroll">${scorecardHTML(engine)}</div>
    <div class="ov-actions"><button class="btn primary" data-ov="rematch">Rematch</button><button class="btn" data-ov="replay">Watch last ball</button><button class="btn ghost" data-ov="menu">Main menu</button></div>`;
}

export { glyph };
