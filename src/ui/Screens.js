// Menu screens. Each screen is { title, html(app), bind(root, app), back }.
import { esc, toast, $, $$, glyph } from './UI.js';
import { emblemDataURL, EMBLEM_SHAPES, EMBLEM_ICONS } from './Emblem.js';
import {
  ROLE_LABELS, ROLE_SHORT, BAT_STYLES_FOR_ROLE, BAT_STYLE_LABELS, TECHNIQUES, AR_TYPES, BOWLING_TYPES,
  RATING_KEYS, RATING_LABELS, BOWLING_RATING_KEYS, normalizePlayer, playerTagline, slotCategory, SLOT_LABELS, bowlerKph,
} from '../game/PlayerAttributes.js';
import {
  validatePlayingXI, validateSquad, autoSelectXI, reconcileBattingOrder, defaultBattingOrder, generateSquad, newBlankPlayer, SQUAD_SIZE,
} from '../game/TeamManager.js';
import { CPU_TEAMS } from '../game/NameGenerator.js';
import { STADIUMS, TIMES } from '../scene/StadiumScene.js';
import { DIFFICULTY } from '../game/Difficulty.js';
import { DEFAULT_BINDINGS, ACTION_LABELS, PROFILE_LABELS, PAD_LABELS, keyLabel, cloneBindings } from '../controls/Bindings.js';
import { RNG } from '../utils/Random.js';
import { BATTING_VIEWS, BOWLING_VIEWS, normalizeBattingView, normalizeBowlingView } from '../scene/CameraPoses.js';

const ROLE_CLASS = { batsman: 'r-bat', wicketkeeper: 'r-wk', allrounder: 'r-ar', bowler: 'r-bowl' };
const COLOR_SWATCHES = ['#14806a', '#1f6feb', '#b3261e', '#5b3fa6', '#e07a1f', '#0f8b8d', '#222831', '#ff5a76', '#3d5a40', '#f4d35e', '#ffffff', '#00b4d8'];

function badge(p) { return `<span class="badge ${ROLE_CLASS[p.role]}">${ROLE_SHORT[p.role]}</span>`; }
function ovr(p) { return `<span class="ovr">${p.overall}</span>`; }

function teamCard(team) {
  const v = validatePlayingXI(team.players, team.xi);
  return `<div class="team-card" style="--c1:${team.primary};--c2:${team.secondary}">
    <img src="${emblemDataURL(team, 96)}" alt="" width="64" height="64">
    <div><div class="tc-name">${esc(team.name)}</div>
    <div class="tc-sub">${team.players.length} players · XI ${v.ok ? '<b class="ok">ready</b>' : '<b class="bad">needs attention</b>'}</div></div></div>`;
}

// ---------------------------------------------------------------- main menu
export const MainMenu = {
  title: 'Main Menu',
  html(app) {
    const saved = app.hasSavedMatch();
    return `<div class="menu-wrap">
      <div class="logo"><span class="l1">LOW-POLY</span><span class="l2">CRICKET</span><span class="l3">World Series</span></div>
      ${teamCard(app.team)}
      <nav class="menu-list">
        ${saved ? `<button class="btn primary" data-go="resume">▶ Resume Match <small>${esc(saved)}</small></button>` : ''}
        <button class="btn ${saved ? '' : 'primary'}" data-go="play">Play Match</button>
        <button class="btn" data-go="create">Create My Team</button>
        <button class="btn" data-go="players">Manage Players</button>
        <button class="btn" data-go="strategy">Team Strategy</button>
        <button class="btn" data-go="setup">Match Settings</button>
        <button class="btn" data-go="controls">Controls &amp; Tutorial</button>
      </nav>
      <div class="menu-foot">${app.input.pad.connected ? `🎮 ${esc(app.input.pad.style === 'ps' ? 'PlayStation' : 'Xbox')}-style controller connected` : 'Keyboard ready · connect a controller any time'}</div>
    </div>`;
  },
  bind(root, app) {
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-go]');
      if (!b) return;
      const go = b.dataset.go;
      if (go === 'resume') app.resumeMatch();
      else if (go === 'play') app.playMatch();
      else app.go(go);
    });
  },
};

// ---------------------------------------------------------------- create team
export const CreateTeam = {
  title: 'Create My Team',
  back: 'main',
  html(app) {
    const t = app.team;
    const swatches = (name, cur) => COLOR_SWATCHES.map(c => `<button class="swatch ${c === cur ? 'sel' : ''}" data-swatch="${name}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
    return `<div class="panel wide">
      <h1>Create My Team</h1>
      <div class="grid2">
        <div class="form">
          <label>Team name <input id="tname" maxlength="24" value="${esc(t.name)}"></label>
          <label>Short code (scoreboard) <input id="tshort" maxlength="4" value="${esc(t.short)}"></label>
          <label>Primary (jersey) colour <span class="row"><input type="color" id="c1" value="${t.primary}">${swatches('primary', t.primary)}</span></label>
          <label>Secondary colour <span class="row"><input type="color" id="c2" value="${t.secondary}">${swatches('secondary', t.secondary)}</span></label>
          <label>Emblem shape <select id="eshape">${EMBLEM_SHAPES.map(s => `<option ${s === t.emblem.shape ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>Emblem icon <select id="eicon">${EMBLEM_ICONS.map(s => `<option ${s === t.emblem.icon ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        </div>
        <div class="preview">
          <img id="emb" src="${emblemDataURL(t, 192)}" width="160" height="160" alt="Team emblem">
          <div class="jersey" id="jersey" style="--c1:${t.primary};--c2:${t.secondary}"><span class="j-team">${esc(t.short)}</span><span class="j-num">10</span></div>
          <p class="muted">Your colours appear on the players' kits, the scoreboard and the HUD.</p>
        </div>
      </div>
      <div class="actions">
        <button class="btn" data-act="regen">New random squad (15)</button>
        <button class="btn primary" data-act="save">Save &amp; manage players →</button>
        <button class="btn ghost" data-act="back">Back</button>
      </div>
    </div>`;
  },
  bind(root, app) {
    const t = app.team;
    const refresh = () => {
      t.name = $('#tname', root).value.trim() || 'My Team';
      t.short = ($('#tshort', root).value.trim() || t.name.slice(0, 3)).toUpperCase().slice(0, 4);
      t.primary = $('#c1', root).value; t.secondary = $('#c2', root).value;
      t.emblem = { shape: $('#eshape', root).value, icon: $('#eicon', root).value };
      $('#emb', root).src = emblemDataURL(t, 192);
      const j = $('#jersey', root);
      j.style.setProperty('--c1', t.primary); j.style.setProperty('--c2', t.secondary);
      $('.j-team', j).textContent = t.short;
      $$('.swatch', root).forEach(s => s.classList.toggle('sel', s.dataset.color === (s.dataset.swatch === 'primary' ? t.primary : t.secondary)));
    };
    root.addEventListener('input', refresh);
    root.addEventListener('change', refresh);
    root.addEventListener('click', e => {
      const sw = e.target.closest('[data-swatch]');
      if (sw) { $(sw.dataset.swatch === 'primary' ? '#c1' : '#c2', root).value = sw.dataset.color; refresh(); return; }
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'regen') {
        if (!confirm('Replace all 15 players with a new random squad?')) return;
        t.players = generateSquad(new RNG(), { strength: 0.6 });
        t.xi = autoSelectXI(t.players) || [];
        t.battingOrder = defaultBattingOrder(t.players, t.xi);
        app.saveTeam(); toast('New squad generated');
      } else if (a === 'save') { refresh(); app.saveTeam(); app.go('players'); }
      else if (a === 'back') { refresh(); app.saveTeam(); app.go('main'); }
    });
  },
};

// ---------------------------------------------------------------- manage players
const FILTERS = { all: 'All', batsman: 'Batsmen', wicketkeeper: 'Keepers', allrounder: 'All-rounders', bowler: 'Bowlers', spin: 'Spin', pace: 'Pace', xi: 'In XI' };

function playerCard(p, team, sel) {
  const inXI = team.xi.includes(p.id);
  return `<button class="pcard ${sel ? 'sel' : ''} ${inXI ? 'in-xi' : ''}" data-pid="${p.id}" style="--c1:${team.primary}">
    <span class="pc-num">${p.number}</span>${badge(p)}${ovr(p)}
    <span class="pc-name">${esc(p.name)}</span>
    <span class="pc-tag">${esc(playerTagline(p))}</span>
    ${inXI ? '<span class="pc-xi">XI</span>' : ''}
  </button>`;
}

function editorHTML(p) {
  if (!p) return '<p class="muted">Select a player card to edit name, role, style and ratings.</p>';
  const opt = (list, cur, labels) => list.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(labels ? labels[v] : v)}</option>`).join('');
  const bowls = p.role === 'bowler' || p.role === 'allrounder';
  const styleLabels = { ...BAT_STYLE_LABELS, tailender: p.role === 'wicketkeeper' ? 'Keeper only (not a top-6 batter)' : 'Tail-ender' };
  const sliders = RATING_KEYS.filter(k => bowls || !BOWLING_RATING_KEYS.includes(k)).map(k => `
    <label class="slider"><span>${RATING_LABELS[k]}</span><input type="range" min="1" max="99" data-rate="${k}" value="${p[k]}"><b>${p[k]}</b></label>`).join('');
  return `<div class="editor" data-pid="${p.id}">
    <div class="ed-head"><h2>${esc(p.name)}</h2>${badge(p)}<span class="ovr big">${p.overall}</span></div>
    <div class="grid2 tight">
      <label>Name <input data-f="name" maxlength="24" value="${esc(p.name)}"></label>
      <label>Jersey number <input data-f="number" type="number" min="1" max="99" value="${p.number}"></label>
      <label>Primary role <select data-f="role">${opt(Object.keys(ROLE_LABELS), p.role, ROLE_LABELS)}</select></label>
      <label>Batting style <select data-f="battingStyle">${opt(BAT_STYLES_FOR_ROLE[p.role], p.battingStyle, styleLabels)}</select></label>
      ${p.role !== 'bowler' ? `<label>Batting technique <select data-f="technique">${opt(Object.keys(TECHNIQUES), p.technique, Object.fromEntries(Object.entries(TECHNIQUES).map(([k, v]) => [k, v.label])))}</select></label>` : ''}
      ${p.role === 'allrounder' ? `<label>All-rounder type <select data-f="arType">${opt(Object.keys(AR_TYPES), p.arType, AR_TYPES)}</select></label>` : ''}
      ${bowls ? `<label>Bowling type <select data-f="bowlingType"><option value="">— choose —</option>${opt(Object.keys(BOWLING_TYPES), p.bowlingType, Object.fromEntries(Object.entries(BOWLING_TYPES).map(([k, v]) => [k, v.label])))}</select></label>` : ''}
    </div>
    <div class="ed-slot">XI slot: <b>${SLOT_LABELS[slotCategory(p)]}</b>${bowls && p.bowlingType ? ` · stock ball ≈ ${Math.round(bowlerKph(p))} km/h` : ''}</div>
    <div class="sliders">${sliders}</div>
    <div class="actions"><button class="btn danger" data-act="remove">Release player</button></div>
  </div>`;
}

export const ManagePlayers = {
  title: 'Manage Players',
  back: 'main',
  state: { filter: 'all', sel: null },
  html(app) {
    const t = app.team, s = this.state;
    const list = t.players.filter(p => s.filter === 'all' || p.role === s.filter
      || (s.filter === 'spin' && BOWLING_TYPES[p.bowlingType]?.kind === 'spin')
      || (s.filter === 'pace' && BOWLING_TYPES[p.bowlingType]?.kind === 'pace')
      || (s.filter === 'xi' && t.xi.includes(p.id)));
    const v = validateSquad(t.players);
    const sel = t.players.find(p => p.id === s.sel) || null;
    return `<div class="panel wide players">
      <h1>Manage Players <small>${esc(t.name)} · ${t.players.length}/${SQUAD_SIZE}</small></h1>
      <div class="filters">${Object.entries(FILTERS).map(([k, l]) => `<button class="chip ${s.filter === k ? 'sel' : ''}" data-filter="${k}">${l}</button>`).join('')}
        <span class="spacer"></span><button class="btn small" data-act="add">+ Add player</button></div>
      <div class="split">
        <div class="cards">${list.map(p => playerCard(p, t, p.id === s.sel)).join('') || '<p class="muted">No players match this filter.</p>'}</div>
        <div class="side">${editorHTML(sel)}
          <div class="validation ${v.ok ? 'ok' : 'bad'}"><h3>${v.ok ? '✔ Squad is valid' : '✖ Squad problems'}</h3>
          ${v.ok ? '<p>15 players, unique numbers, and a legal XI can be picked.</p>' : `<ul>${v.errors.slice(0, 8).map(e => `<li>${esc(e.message)}</li>`).join('')}</ul>`}</div>
        </div>
      </div>
      <div class="actions"><button class="btn primary" data-go="strategy">Pick playing XI →</button><button class="btn ghost" data-go="main">Back</button></div>
    </div>`;
  },
  bind(root, app) {
    const s = this.state;
    const rerender = (keepFocus = null) => { app.saveTeam(); app.render(); if (keepFocus) $(keepFocus)?.focus(); };
    root.addEventListener('click', e => {
      const f = e.target.closest('[data-filter]');
      if (f) { s.filter = f.dataset.filter; rerender(); return; }
      const c = e.target.closest('.pcard');
      if (c) { s.sel = c.dataset.pid; rerender(`.pcard[data-pid="${s.sel}"]`); return; }
      const go = e.target.closest('[data-go]');
      if (go) { app.go(go.dataset.go); return; }
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'add') {
        const p = newBlankPlayer(app.team.players);
        app.team.players.push(p); s.sel = p.id;
        toast(app.team.players.length > SQUAD_SIZE ? `Squad has ${app.team.players.length} players — release one to get back to 15.` : 'Player added');
        rerender();
      } else if (a === 'remove' && s.sel) {
        const p = app.team.players.find(x => x.id === s.sel);
        if (!p || !confirm(`Release ${p.name}?`)) return;
        app.team.players = app.team.players.filter(x => x.id !== s.sel);
        app.team.xi = app.team.xi.filter(id => id !== s.sel);
        s.sel = null;
        rerender();
      }
    });
    const edit = (e) => {
      const ed = e.target.closest('.editor');
      if (!ed) return;
      const t = app.team;
      const i = t.players.findIndex(p => p.id === ed.dataset.pid);
      if (i < 0) return;
      const p = { ...t.players[i] };
      const field = e.target.dataset.f, rate = e.target.dataset.rate;
      if (rate) { p[rate] = Number(e.target.value); e.target.nextElementSibling.textContent = e.target.value; }
      if (field) p[field] = field === 'number' ? Number(e.target.value) : e.target.value || null;
      if (field === 'role' && (p.role === 'bowler' || p.role === 'allrounder') && !p.bowlingType) p.bowlingType = p.role === 'bowler' ? 'medium' : 'medium';
      t.players[i] = normalizePlayer(p);
      if (e.type === 'change' && (field === 'role' || field === 'bowlingType' || field === 'battingStyle' || field === 'name' || field === 'number' || field === 'arType' || field === 'technique')) rerender(`[data-f="${field}"]`);
      else if (rate) { $('.ovr.big', ed).textContent = t.players[i].overall; const card = $(`.pcard[data-pid="${p.id}"] .ovr`, root); if (card) card.textContent = t.players[i].overall; app.saveTeam(); }
    };
    root.addEventListener('input', edit);
    root.addEventListener('change', edit);
  },
};

// ---------------------------------------------------------------- team strategy / playing XI
function compositionPanel(v) {
  return `<div class="composition">
    ${v.lines.map(l => `<div class="cline ${l.ok ? 'ok' : 'bad'}"><span>${esc(l.label)}</span><b>${l.count}/${l.target}${l.mode === 'min' ? ' <small>min</small>' : ''}</b></div>`).join('')}
    ${v.ok ? '<div class="cmsg ok">✔ Playing XI is legal — ready to play.</div>' : `<ul class="cmsg bad">${v.errors.map(e => `<li>${esc(e.message)}</li>`).join('')}</ul>`}
  </div>`;
}

export const TeamStrategy = {
  title: 'Team Strategy',
  back: 'main',
  html(app) {
    const t = app.team;
    t.battingOrder = reconcileBattingOrder(t.players, t.xi.filter(id => t.players.some(p => p.id === id)), t.battingOrder);
    const v = validatePlayingXI(t.players, t.xi);
    const byId = new Map(t.players.map(p => [p.id, p]));
    const order = t.battingOrder.filter(id => t.xi.includes(id)).map(id => byId.get(id)).filter(Boolean);
    const sorted = t.players.slice().sort((a, b) => ['wicketkeeper', 'batsman', 'allrounder', 'bowler'].indexOf(a.role) - ['wicketkeeper', 'batsman', 'allrounder', 'bowler'].indexOf(b.role) || b.overall - a.overall);
    return `<div class="panel wide strategy">
      <h1>Team Strategy <small>Pick 11 from your 15</small></h1>
      <div class="split three">
        <div class="col">
          <h3>Squad <button class="btn small" data-act="auto">Auto-pick best XI</button></h3>
          <div class="xi-list">${sorted.map(p => `<button class="xi-row ${t.xi.includes(p.id) ? 'on' : ''}" data-toggle="${p.id}">
            <span class="tick">${t.xi.includes(p.id) ? '✓' : ''}</span><span class="pc-num">${p.number}</span>${badge(p)}
            <span class="xi-name">${esc(p.name)}<small>${esc(SLOT_LABELS[slotCategory(p)])}</small></span>${ovr(p)}</button>`).join('')}</div>
        </div>
        <div class="col"><h3>Squad composition</h3>${compositionPanel(v)}</div>
        <div class="col">
          <h3>Batting order</h3>
          <ol class="order">${order.map((p, i) => `<li><span class="xi-name">${esc(p.name)} <small>${esc(playerTagline(p))}</small></span>
            <button class="mini" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button class="mini" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></li>`).join('')}</ol>
          <h3>Field setting when bowling</h3>
          <select id="fieldApproach">${[['auto', 'Captain decides (by situation)'], ['attacking', 'Attacking (slips, close catchers)'], ['balanced', 'Balanced'], ['defensive', 'Defensive (protect the boundary)']].map(([k, l]) => `<option value="${k}" ${t.strategy.fieldApproach === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <p class="muted">You can still change the field and bowler at the start of every over.</p>
        </div>
      </div>
      <div class="actions"><button class="btn primary" data-act="play" ${v.ok ? '' : 'disabled'} title="${v.ok ? '' : esc(v.errors[0]?.message || '')}">Play Match →</button><button class="btn ghost" data-act="back">Back</button></div>
    </div>`;
  },
  bind(root, app) {
    const t = app.team;
    const re = (sel) => { app.saveTeam(); app.render(); if (sel) $(sel)?.focus(); };
    root.addEventListener('click', e => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const id = tg.dataset.toggle;
        t.xi = t.xi.includes(id) ? t.xi.filter(x => x !== id) : [...t.xi, id];
        re(`[data-toggle="${id}"]`); return;
      }
      const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-down]');
      if (up || dn) {
        const order = t.battingOrder.filter(id => t.xi.includes(id));
        const i = Number((up || dn).dataset[up ? 'up' : 'down']);
        const j = up ? i - 1 : i + 1;
        [order[i], order[j]] = [order[j], order[i]];
        t.battingOrder = order;
        re(`[data-${up ? 'up' : 'down'}="${j}"]`); return;
      }
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'auto') {
        const xi = autoSelectXI(t.players);
        if (!xi) { toast('No legal XI possible with this squad — check Manage Players.', 3500, 'bad'); return; }
        t.xi = xi; t.battingOrder = defaultBattingOrder(t.players, xi); re();
      } else if (a === 'play') app.playMatch();
      else if (a === 'back') app.go('main');
    });
    root.addEventListener('change', e => { if (e.target.id === 'fieldApproach') { t.strategy.fieldApproach = e.target.value; app.saveTeam(); } });
  },
};

// ---------------------------------------------------------------- match settings
export const MatchSetup = {
  title: 'Match Settings',
  back: 'main',
  html(app) {
    const s = app.settings;
    const v = validatePlayingXI(app.team.players, app.team.xi);
    const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    return `<div class="panel wide setup">
      <h1>Match Settings</h1>
      <div class="grid3">
        <label>Format ${sel('overs', [[5, '5 overs'], [10, '10 overs'], [20, '20 overs (T20)']], s.overs)}</label>
        <label>Difficulty ${sel('difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label]), s.difficulty)}</label>
        <label>Opponent ${sel('opponent', [['random', 'Random computer team'], ...CPU_TEAMS.map(t => [t.name, t.name])], s.opponent)}</label>
        <label>Stadium ${sel('stadium', Object.entries(STADIUMS).map(([k, d]) => [k, d.label]), s.stadium)}</label>
        <label>Time of day ${sel('timeOfDay', Object.entries(TIMES).map(([k, d]) => [k, d.label]), s.timeOfDay)}</label>
        <label>Toss ${sel('tossMode', [['coin', 'Coin toss'], ['choose', 'Skip toss — I choose']], s.tossMode)}</label>
        <label>Batting camera ${sel('battingCamera', BATTING_VIEWS.map(v => [v.id, v.label]), normalizeBattingView(s.battingCamera ?? s.camera))}</label>
        <label>Bowling camera ${sel('bowlingCamera', BOWLING_VIEWS.map(v => [v.id, v.label]), normalizeBowlingView(s.bowlingCamera))}</label>
        <label>Running between wickets ${sel('assistRunning', [['false', 'Manual (I call the runs)'], ['true', 'Assisted (computer calls)']], String(s.assistRunning))}</label>
        <label>Replays after big moments ${sel('autoReplay', [['true', 'On'], ['false', 'Off']], String(s.autoReplay))}</label>
        <label>Bowling aim marker ${sel('aimMarker', [['true', 'Show'], ['false', 'Hide (harder)']], String(s.aimMarker))}</label>
        <label>Graphics ${sel('quality', [['low', 'Low (fast)'], ['medium', 'Medium'], ['high', 'High (sharp shadows)']], s.quality)}</label>
        <label>Sound ${sel('sound', [['true', 'On'], ['false', 'Off']], String(s.sound))}</label>
        <label class="slider">Volume <input type="range" id="volume" min="0" max="1" step="0.05" value="${s.volume}"></label>
      </div>
      ${v.ok ? '' : `<div class="validation bad"><h3>Your playing XI isn't legal yet</h3><p>${esc(v.errors[0].message)}</p><button class="btn small" data-go="strategy">Fix in Team Strategy</button></div>`}
      <div class="actions">
        <button class="btn primary" data-act="start" ${v.ok ? '' : 'disabled'}>Start Match →</button>
        <button class="btn" data-act="save">Save settings</button>
        <button class="btn ghost" data-act="back">Back</button>
      </div>
    </div>`;
  },
  bind(root, app) {
    const s = app.settings;
    const read = () => {
      for (const k of ['overs', 'difficulty', 'opponent', 'stadium', 'timeOfDay', 'tossMode', 'battingCamera', 'bowlingCamera', 'quality']) s[k] = $('#' + k, root).value;
      s.overs = Number(s.overs);
      for (const k of ['assistRunning', 'autoReplay', 'aimMarker', 'sound']) s[k] = $('#' + k, root).value === 'true';
      s.volume = Number($('#volume', root).value);
      app.saveSettings();
    };
    root.addEventListener('change', read);
    root.addEventListener('click', e => {
      const go = e.target.closest('[data-go]');
      if (go) { app.go(go.dataset.go); return; }
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'start') { read(); app.go('toss'); }
      else if (a === 'save') { read(); toast('Settings saved'); app.go('main'); }
      else if (a === 'back') { read(); app.go('main'); }
    });
    if (app.focusStart) { $('[data-act="start"]', root)?.focus(); app.focusStart = false; }
  },
};

// ---------------------------------------------------------------- toss
export const Toss = {
  title: 'Toss',
  back: 'setup',
  state: null,
  html(app) {
    const opp = app.pendingOpponent();
    const s = this.state || (this.state = { step: app.settings.tossMode === 'choose' ? 'choose' : 'call' });
    const u = app.team;
    let body = '';
    if (s.step === 'call') body = `<p>Call it, captain!</p><div class="actions center"><button class="btn primary" data-call="heads">Heads</button><button class="btn primary" data-call="tails">Tails</button></div>`;
    else if (s.step === 'choose') body = `<p>${s.result ? `It's <b>${s.result}</b> — you won the toss!` : 'You choose.'} Bat or bowl first?</p><div class="actions center"><button class="btn primary" data-dec="bat">Bat first</button><button class="btn primary" data-dec="bowl">Bowl first</button></div>`;
    else if (s.step === 'lost') body = `<p>It's <b>${s.result}</b>. ${esc(opp.name)} won the toss and chose to <b>${s.cpuDecision}</b> first.</p><div class="actions center"><button class="btn primary" data-act="go">Let's play →</button></div>`;
    return `<div class="panel toss">
      <h1>The Toss</h1>
      <div class="vs"><div><img src="${emblemDataURL(u, 128)}" width="96" height="96" alt=""><b>${esc(u.name)}</b></div><span>VS</span><div><img src="${emblemDataURL(opp, 128)}" width="96" height="96" alt=""><b>${esc(opp.name)}</b></div></div>
      <div class="coin ${s.flipping ? 'flip' : ''} ${s.result || ''}"><span>${s.result === 'tails' ? 'T' : 'H'}</span></div>
      <div class="vs-info">${app.settings.overs} overs · ${esc(DIFFICULTY[app.settings.difficulty].label)} · ${esc(STADIUMS[app.settings.stadium].label)} · ${esc(TIMES[app.settings.timeOfDay].label)}</div>
      ${body}
      <div class="actions center"><button class="btn ghost" data-act="back">Back</button></div>
    </div>`;
  },
  bind(root, app) {
    const s = this.state;
    root.addEventListener('click', e => {
      const call = e.target.closest('[data-call]')?.dataset.call;
      if (call) {
        app.sound.click(true);
        s.flipping = true; app.render();
        setTimeout(() => {
          const res = Math.random() < 0.5 ? 'heads' : 'tails';
          s.flipping = false; s.result = res;
          if (res === call) s.step = 'choose';
          else { s.step = 'lost'; s.cpuDecision = Math.random() < 0.55 ? 'bowl' : 'bat'; }
          app.render();
        }, 1100);
        return;
      }
      const dec = e.target.closest('[data-dec]')?.dataset.dec;
      if (dec) { const st = this.state; this.state = null; app.startMatch({ userWon: true, decision: dec, result: st.result }); return; }
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'go') { const st = this.state; this.state = null; app.startMatch({ userWon: false, decision: st.cpuDecision }); }
      else if (a === 'back') { this.state = null; app.go('setup'); }
    });
  },
};

// ---------------------------------------------------------------- controls & tutorial
const TUTORIAL = {
  batting: `<ol>
    <li>The camera sits behind you at the striker's end. Watch the bowler run in from the far end.</li>
    <li><b>Direction:</b> push the stick (or WASD/arrows) <i>up</i> for front-foot shots, <i>down</i> for back-foot shots, <i>right</i> for the off side and <i>left</i> for the leg side. A green arrow shows your aim.</li>
    <li><b>Pick a shot that suits the ball:</b> drive full balls (front foot), cut or pull short balls (back foot), sweep spinners, leave wide ones. A white ring shows where the ball pitched.</li>
    <li><b>Timing:</b> press the shot button just before the ball reaches you. The timing bar shows Early / Good / Perfect / Late. Perfect timing doesn't guarantee a six — the shot, the line and length, your player's skill and the field all matter.</li>
    <li>Hold <b>power</b> for extra distance (riskier), hold <b>precision</b> for a wider timing window and fewer edges.</li>
    <li><b>Run:</b> press Call Run once per run (press again during a run to come back for another), Send Back to turn around.</li>
  </ol>`,
  bowling: `<ol>
    <li>The camera is behind your bowler. Pick a <b>speed</b> (Faster / Slower, from 70 to 150 km/h — what your bowler can reach depends on their type, pace rating and tiredness) and a <b>length</b>: Yorker, Full Toss, Full, Good, Back of a Length, Short of a Length, Short Ball or Bouncer.</li>
    <li>The yellow band shows where that length pitches. Up/down moves the marker inside the band, left/right changes the line. From over the wicket the ball angles in, so pitch short balls on an off-stump line to target the body.</li>
    <li>Pick a variation (seam, out/inswing; off break, arm ball, leg break, googly, flighted, flatter). A big drop in pace from your usual speed is a disguised slower ball.</li>
    <li><b>Hold</b> Bowl to start the run-up — the meter fills. <b>Release</b> in the green zone for a perfect delivery. Release too late and you'll overstep for a no-ball.</li>
    <li>Hold Power (right trigger / Shift) for extra pace at the cost of accuracy and stamina.</li>
    <li>Your bowlers tire over a spell; rotate them. Each bowler can bowl at most 1/5 of the overs.</li>
  </ol>`,
  fielding: `<ol><li>Fielders chase and catch automatically.</li><li>When your fielder gathers the ball while the batters are running, time slows down: choose to throw to the keeper's end, the bowler's end, or let the fielder pick the best end for a run-out.</li></ol>`,
  menus: `<ol><li>Use the D-pad / arrows to move around menus, A / Enter to select, B / Esc to go back. Left/right on a dropdown changes its value with a controller.</li></ol>`,
};

export const Controls = {
  title: 'Controls & Tutorial',
  back: 'main',
  state: { tab: 'batting', listening: null },
  html(app) {
    const s = this.state;
    const tabs = ['batting', 'bowling', 'fielding', 'between', 'menu'];
    const b = app.input.bindings[s.tab];
    const style = app.input.pad.connected ? app.input.pad.style : 'xbox';
    return `<div class="panel wide controls">
      <h1>Controls &amp; Tutorial</h1>
      <div class="pad-status ${app.input.pad.connected ? 'on' : ''}">${app.input.pad.connected ? `🎮 Connected: ${esc(app.input.pad.id.slice(0, 60))} (${style === 'ps' ? 'PlayStation' : 'Xbox'} layout)` : 'No controller detected — plug in or pair a USB/Bluetooth controller and press any button. Keyboard always works.'}</div>
      <div class="filters">${tabs.map(t => `<button class="chip ${s.tab === t ? 'sel' : ''}" data-tab="${t}">${PROFILE_LABELS[t]}</button>`).join('')}</div>
      <div class="split">
        <table class="binds"><thead><tr><th>Action</th><th>Keyboard</th><th>Controller</th></tr></thead><tbody>
          ${s.tab === 'batting' || s.tab === 'bowling' ? `<tr><td>${s.tab === 'batting' ? 'Shot direction / footwork' : 'Aim line &amp; length'}</td><td>W A S D / Arrows</td><td>Left stick / D-pad</td></tr>` : ''}
          ${Object.entries(b).map(([a, v]) => `<tr><td>${esc(ACTION_LABELS[a] || a)}</td>
            <td><button class="bind ${s.listening === a + ':key' ? 'listen' : ''}" data-bind="${a}" data-dev="key">${s.listening === a + ':key' ? 'Press a key…' : esc(v.keys.map(keyLabel).join(' / '))}</button></td>
            <td><button class="bind ${s.listening === a + ':pad' ? 'listen' : ''}" data-bind="${a}" data-dev="pad">${s.listening === a + ':pad' ? 'Press a button…' : esc(v.pad.map(i => PAD_LABELS[style][i]).join(' / '))}</button></td></tr>`).join('')}
        </tbody></table>
        <div class="tutorial">${TUTORIAL[s.tab === 'between' ? 'menus' : s.tab === 'menu' ? 'menus' : s.tab] || ''}</div>
      </div>
      <div class="actions"><button class="btn" data-act="reset">Reset to defaults</button><button class="btn ghost" data-act="back">Back</button></div>
    </div>`;
  },
  bind(root, app) {
    const s = this.state;
    root.addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { s.tab = tab.dataset.tab; s.listening = null; app.render(); return; }
      const bind = e.target.closest('[data-bind]');
      if (bind) {
        const action = bind.dataset.bind, dev = bind.dataset.dev;
        s.listening = action + ':' + dev;
        app.render();
        const done = (val) => {
          s.listening = null;
          const entry = app.input.bindings[s.tab][action];
          if (dev === 'key') entry.keys = [val]; else entry.pad = [val];
          app.saveBindings();
          toast(`${ACTION_LABELS[action] || action} → ${dev === 'key' ? keyLabel(val) : PAD_LABELS[app.input.pad.style][val]}`);
          app.render();
        };
        if (dev === 'key') app.keyboard.captureNext(code => (code === 'Escape' ? (s.listening = null, app.render()) : done(code)));
        else if (app.input.pad.connected) app.input.pad.captureNext(done);
        else { s.listening = null; toast('Connect a controller to remap its buttons'); app.render(); }
        return;
      }
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'reset') { app.input.bindings = cloneBindings(DEFAULT_BINDINGS); app.saveBindings(); app.render(); toast('Controls reset'); }
      else if (a === 'back') app.go('main');
    });
  },
};

export const SCREENS = { main: MainMenu, create: CreateTeam, players: ManagePlayers, strategy: TeamStrategy, setup: MatchSetup, toss: Toss, controls: Controls };
export { compositionPanel };
