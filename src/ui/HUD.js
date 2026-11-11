// In-match HUD and overlays (pause, bowler choice, innings break, match result).
import { esc, hintBar, glyph } from './UI.js';
import { emblemDataURL } from './Emblem.js';
import { oversString, runRate, totalExtras, DISMISSALS } from '../game/CricketRules.js';
import { BOWLING_TYPES, ROLE_SHORT } from '../game/PlayerAttributes.js';
import { FIELD_PRESETS } from '../game/FieldPlacements.js';
import { finalOversFor } from '../game/SkipSim.js';

export class HUD {
  constructor(root) {
    this.root = root;
    this.cache = new Map();
    root.innerHTML = `
      <div class="hud-top">
        <div class="scorebug"><img class="sb-emb" alt=""><div class="sb-main"><div class="sb-team"></div><div class="sb-score"></div></div>
          <div class="sb-overs"></div><div class="sb-extra"></div><div class="sb-fh hidden">FREE HIT</div></div>
        <div class="thisover"></div>
        <div class="hud-tr"><span class="hud-end"></span><button class="hud-btn" data-hud="pause" aria-label="Pause">❚❚</button></div>
      </div>
      <div class="banner hidden"><div class="b-main"></div><div class="b-sub"></div></div>
      <div class="timing hidden"><div class="t-bar"><i class="z late"></i><i class="z good"></i><i class="z perfect"></i><i class="z good2"></i><i class="z early"></i><b class="t-mark"></b></div><div class="t-label"></div></div>
      <div class="meter hidden"><div class="m-type"></div><div class="m-bar"><i class="m-good"></i><i class="m-perfect"></i><i class="m-over"></i><b class="m-cursor"></b></div><div class="m-power"><i></i></div><div class="m-label"></div></div>
      <div class="prompt hidden"></div>
      <div class="auto-badge hidden"><b>AUTO-PLAY</b> <span>The AI is playing for you · pause to take control</span></div>
      <div class="hud-bottom">
        <div class="batters"><div class="bt bt-s"></div><div class="bt bt-n"></div><div class="partner"></div></div>
        <div class="hints"></div>
        <div class="bowlerbox"><div class="bw-name"></div><div class="bw-fig"></div><div class="bw-last"></div></div>
      </div>`;
    this.q = sel => root.querySelector(sel);
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
    const img = this.q('.sb-emb');
    img.src = emblemDataURL(bat, 96);
    this.q('.scorebug').style.setProperty('--c1', bat.primary);
    this.q('.scorebug').style.setProperty('--c2', bat.secondary);
    this.q('.bowlerbox').style.setProperty('--c1', bowl.primary);
    this.cache.clear();
  }

  /** Scoreboard text from the engine. */
  updateScore(engine, lastBall = null) {
    const inn = engine.innings;
    const bat = engine.battingTeam;
    const sit = engine.situation();
    this.set('.sb-team', esc(bat.short));
    this.set('.sb-score', `${inn.runs}<small>/${inn.wickets}</small>`);
    this.set('.sb-overs', `${oversString(inn.legalBalls)} <small>/ ${inn.maxOvers} ov</small>`);
    let extra = `CRR ${sit.crr.toFixed(2)}`;
    if (inn.target != null) {
      const rrr = Number.isFinite(sit.rrr) ? sit.rrr.toFixed(2) : '-';
      extra = `Need <b>${sit.need}</b> from <b>${sit.ballsLeft}</b> · RRR ${rrr}`;
    } else if (engine.inningsIndex === 0) extra += ` · 1st innings`;
    this.set('.sb-extra', extra);
    this.show('.sb-fh', inn.freeHit);
    this.set('.thisover', inn.thisOver.map(b => `<span class="ball ${b.wicket ? 'w' : b.boundary === 6 ? 's' : b.boundary === 4 ? 'f' : b.extra ? 'x' : b.runs ? 'r' : ''}">${esc(b.label)}</span>`).join('') || '<span class="ball dim">new over</span>');
    const bline = (id, star) => {
      if (!id) return '';
      const p = engine.player(id), s = inn.batters[id];
      return `<span class="nm">${star ? '▸ ' : ''}${esc(p.name)}</span><span class="rn">${s.runs}<small>(${s.balls})</small></span>`;
    };
    this.set('.bt-s', bline(inn.striker, true));
    this.set('.bt-n', bline(inn.nonStriker, false));
    this.set('.partner', `Partnership ${inn.partnership.runs} (${inn.partnership.balls})`);
    const bw = engine.bowler || (inn.lastOverBowler && engine.player(inn.lastOverBowler));
    if (bw) {
      const s = inn.bowlers[bw.id] || { balls: 0, maidens: 0, runs: 0, wickets: 0 };
      this.set('.bw-name', `${esc(bw.name)} <small>${esc(BOWLING_TYPES[bw.bowlingType]?.label || '')}</small>`);
      this.set('.bw-fig', `${oversString(s.balls)}-${s.maidens}-${s.runs}-${s.wickets}`);
    }
    if (lastBall) this.set('.bw-last', lastBall.speedKph ? `${esc(lastBall.deliveryType)} · ${lastBall.speedKph} km/h · ${esc(lastBall.lengthClass)}` : '');
  }

  setEnd(text) { this.set('.hud-end', esc(text)); }

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
  autoBadge(on) { this.show('.auto-badge', on); }
  hints(input, profile, items) { this.set('.hints', hintBar(input, profile, items)); }
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
  return `<h2>Paused</h2><p class="muted">${esc(engine.battingTeam.name)} ${s.runs}/${s.wickets} (${s.overs} ov)</p>
    <div class="ov-actions col">
      <button class="btn primary" data-ov="resume">Resume</button>
      ${optionButtons([
        auto ? ['autoplay', 'Take back control', `Stop the AI ${userBowling ? 'bowling' : 'batting'} for you`]
          : ['autoplay', 'Auto-play', `The AI ${userBowling ? 'bowls' : 'bats'} for you while you watch`],
        ...(userBowling ? [['skip', 'Skip bowling', s.target != null ? 'Simulate ahead: the final overs or the result' : 'Simulate the rest of this innings']] : []),
      ])}
      <button class="btn" data-ov="scorecard">Scorecard</button>
      <button class="btn" data-ov="controls">Controls</button>
      <button class="btn" data-ov="settings">Settings</button>
      <button class="btn ghost" data-ov="quit">Save &amp; quit to menu</button>
    </div>`;
}

/** Skip-bowling choices for the current innings (first innings: finish it; a chase: the finish or the result). */
export function skipHTML(engine) {
  const s = engine.situation(), bat = engine.battingTeam;
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
  q('.sim-score').innerHTML = `${esc(bat.name)} <b>${inn.runs}/${inn.wickets}</b> <small>(${oversString(inn.legalBalls)} / ${inn.maxOvers} ov)</small>`;
  q('.sim-need').textContent = inn.target != null ? `Target ${inn.target} · need ${Math.max(0, inn.target - inn.runs)}` : '';
  q('.sim-bar i').style.width = Math.min(100, inn.legalBalls / (inn.maxOvers * 6) * 100) + '%';
}

/** In-match settings: camera angles and a few comfort options, applied immediately. */
export function settingsHTML(s, battingViews, bowlingViews) {
  const sel = (id, opts, cur) => `<select id="${id}" data-setting="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const onOff = [['true', 'On'], ['false', 'Off']];
  return `<h2>Settings</h2>
    <div class="settings-grid">
      <label>Batting camera ${sel('battingCamera', battingViews.map(v => [v.id, v.label]), s.battingCamera)}</label>
      <label>Bowling camera ${sel('bowlingCamera', bowlingViews.map(v => [v.id, v.label]), s.bowlingCamera)}</label>
      <label>Sound ${sel('sound', onOff, String(s.sound))}</label>
      <label class="slider">Volume <input type="range" id="volume" data-setting="volume" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label>Replays after big moments ${sel('autoReplay', onOff, String(s.autoReplay))}</label>
      <label>Bowling aim marker ${sel('aimMarker', [['true', 'Show'], ['false', 'Hide']], String(s.aimMarker))}</label>
      <label>Running between wickets ${sel('assistRunning', [['false', 'Manual'], ['true', 'Assisted']], String(s.assistRunning))}</label>
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
      ${Object.entries(FIELD_PRESETS).map(([k, v]) => `<option value="${k}" ${preset === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>`;
}

function battingCard(engine, inn) {
  const rows = inn.battingOrder.map(id => {
    const p = engine.player(id), s = inn.batters[id];
    if (s.status === 'yet') return '';
    const pn = id => esc(engine.player(id)?.name || '');
    let how = 'not out';
    if (s.out) {
      const o = s.out;
      if (o.type === 'runout') how = `run out${o.fielder ? ` (${pn(o.fielder)})` : ''}`;
      else if (o.type === 'caught') how = o.fielder === o.bowler ? `c &amp; b ${pn(o.bowler)}` : `c ${pn(o.fielder)} b ${pn(o.bowler)}`;
      else if (o.type === 'stumped') how = `st ${pn(o.fielder)} b ${pn(o.bowler)}`;
      else if (o.type === 'lbw') how = `lbw b ${pn(o.bowler)}`;
      else if (o.type === 'hitwicket') how = `hit wicket b ${pn(o.bowler)}`;
      else how = `b ${pn(o.bowler)}`;
    }
    return `<tr><td>${esc(p.name)}</td><td class="how">${how}</td><td>${s.runs}</td><td>${s.balls}</td><td>${s.fours}</td><td>${s.sixes}</td><td>${s.balls ? (s.runs / s.balls * 100).toFixed(0) : '-'}</td></tr>`;
  }).join('');
  const dnb = inn.battingOrder.filter(id => inn.batters[id].status === 'yet').map(id => esc(engine.player(id).name)).join(', ');
  const e = inn.extras;
  return `<table class="card"><thead><tr><th>Batter</th><th></th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Extras</td><td colspan="6">${totalExtras(inn)} (w ${e.wides}, nb ${e.noballs}, b ${e.byes}, lb ${e.legbyes})</td></tr>
    <tr><td><b>Total</b></td><td colspan="6"><b>${inn.runs}/${inn.wickets}</b> (${oversString(inn.legalBalls)} ov, RR ${runRate(inn.runs, inn.legalBalls).toFixed(2)})</td></tr>
    ${dnb ? `<tr><td>Did not bat</td><td colspan="6" class="how">${dnb}</td></tr>` : ''}</tfoot></table>`;
}

function bowlingCard(engine, inn) {
  const rows = Object.entries(inn.bowlers).sort((a, b) => a[1].order - b[1].order).map(([id, s]) =>
    `<tr><td>${esc(engine.player(id).name)}</td><td>${oversString(s.balls)}</td><td>${s.maidens}</td><td>${s.runs}</td><td>${s.wickets}</td><td>${s.balls ? (s.runs / s.balls * 6).toFixed(2) : '-'}</td><td>${s.wides}/${s.noballs}</td></tr>`).join('');
  return `<table class="card"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th><th>Wd/Nb</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function scorecardHTML(engine) {
  return engine.state.innings.map((inn, i) => `<div class="sc-inn"><h3>${esc(engine.team(inn.battingTeam).name)} — ${i === 0 ? '1st' : '2nd'} innings</h3>${battingCard(engine, inn)}${bowlingCard(engine, inn)}</div>`).join('');
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
  return `<h2 class="${r.type === 'tie' ? '' : userWon ? 'win' : 'loss'}">${r.type === 'tie' ? 'It\'s a tie!' : userWon ? 'Victory!' : 'Defeat'}</h2>
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
