// Application state: menus, the user's team, settings, controls and the match lifecycle.
import { SCREENS } from '../ui/Screens.js';
import { esc, toast, moveFocus, adjustFocused, glyph } from '../ui/UI.js';
import { MatchController } from './MatchController.js';
import { NetsController } from './NetsController.js';
import { MatchEngine } from './MatchEngine.js';
import { createDefaultUserTeam, generateCpuTeam, validatePlayingXI, autoSelectXI, reconcileBattingOrder } from './TeamManager.js';
import { normalizePlayer } from './PlayerAttributes.js';
import { CPU_TEAMS } from './NameGenerator.js';
import { Storage, DEFAULT_SETTINGS } from '../utils/Storage.js';
import { RNG } from '../utils/Random.js';
import { DemoController } from './DemoController.js';
import { ACTION_LABELS, bindingsForSave } from '../controls/Bindings.js';

export class GameManager {
  constructor(deps) {
    Object.assign(this, deps); // renderer, stadium, cameras, view, input, keyboard, gamepad, sound, uiRoot, hudRoot, overlayRoot
    this.settings = { ...DEFAULT_SETTINGS, ...(Storage.get('settings') || {}) };
    this.team = this.loadTeam();
    this.input.setBindings(Storage.get('bindings'));
    this.screen = 'main';
    this.match = null;
    this.opponent = null;
    this.demo = new DemoController({ stadium: this.stadium, view: this.view, cameras: this.cameras });
    this.sound.setEnabled(this.settings.sound);
    this.sound.setVolume(this.settings.volume);
    this.uiRoot.addEventListener('click', e => { if (e.target.closest('button')) this.sound.click(); });
    this.gamepad.onChange(s => {
      const ind = document.getElementById('pad-indicator');
      ind.classList.toggle('hidden', !s.connected);
      ind.textContent = s.connected ? (s.style === 'ps' ? '🎮 PS' : '🎮 XB') : '';
      toast(s.connected ? `Controller connected (${s.style === 'ps' ? 'PlayStation' : 'Xbox'} layout)` : 'Controller disconnected — keyboard still works', 2500);
      if (!this.match) this.render();
      else if (!s.connected && this.match.state === 'ball') this.match.pause();
    });
  }

  // ------------------------------------------------------------------ persistence
  loadTeam() {
    const saved = Storage.get('team');
    if (saved && Array.isArray(saved.players) && saved.players.length) {
      saved.players = saved.players.map(normalizePlayer);
      saved.xi = (saved.xi || []).filter(id => saved.players.some(p => p.id === id));
      saved.strategy = { fieldApproach: 'auto', ...(saved.strategy || {}) };
      saved.emblem = saved.emblem || { shape: 'shield', icon: 'bat' };
      saved.isUser = true;
      return saved;
    }
    const t = createDefaultUserTeam(new RNG());
    Storage.set('team', t);
    return t;
  }
  saveTeam() { Storage.set('team', this.team); }
  saveSettings() {
    Storage.set('settings', this.settings);
    this.sound.setEnabled(this.settings.sound);
    this.sound.setVolume(this.settings.volume);
  }
  saveBindings() { Storage.set('bindings', bindingsForSave(this.input.bindings)); }

  saveMatch(engine) {
    Storage.set('match', { engine: engine.toJSON(), savedAt: Date.now() });
  }
  clearSavedMatch() { Storage.remove('match'); }
  hasSavedMatch() {
    const m = Storage.get('match');
    if (!m?.engine || m.engine.phase === 'complete') return null;
    try {
      const e = MatchEngine.fromJSON(m.engine);
      const s = e.situation();
      return `${e.state.teams[0].short} v ${e.state.teams[1].short} · ${e.battingTeam.short} ${s.runs}/${s.wickets} (${s.overs})`;
    } catch { return null; }
  }

  // ------------------------------------------------------------------ screens
  go(name) {
    if (name === 'players' || name === 'strategy') this.ensureXIShape();
    if (name !== 'toss') { if (SCREENS.toss) SCREENS.toss.state = null; }
    if (name === 'setup' || name === 'main') this.opponent = null;
    this.screen = name;
    this.render();
    const first = this.uiRoot.querySelector('.btn.primary:not([disabled]), button:not([disabled])');
    if (first && !this.focusStart) first.focus({ preventScroll: true });
  }

  render() {
    const sc = SCREENS[this.screen];
    const scroll = this.uiRoot.querySelector('.panel, .menu-wrap')?.scrollTop || 0;
    const fresh = this.uiRoot.cloneNode(false);
    this.uiRoot.replaceWith(fresh);
    this.uiRoot = fresh;
    fresh.addEventListener('click', e => { if (e.target.closest('button')) this.sound.click(); });
    fresh.innerHTML = `<div class="screen screen-${this.screen}">${sc.html(this)}</div>`;
    sc.bind(fresh, this);
    const p = fresh.querySelector('.panel, .menu-wrap');
    if (p) p.scrollTop = scroll;
    fresh.classList.remove('hidden');
  }

  ensureXIShape() {
    const t = this.team;
    t.xi = t.xi.filter(id => t.players.some(p => p.id === id));
    if (!t.xi.length) t.xi = autoSelectXI(t.players) || [];
    t.battingOrder = reconcileBattingOrder(t.players, t.xi, t.battingOrder);
  }

  playMatch() {
    const v = validatePlayingXI(this.team.players, this.team.xi);
    if (!v.ok) {
      toast(`Your playing XI isn't legal yet: ${esc(v.errors[0].message)}`, 4200, 'bad');
      this.go('strategy');
      return;
    }
    this.focusStart = true;
    this.go('setup');
  }

  pendingOpponent() {
    if (this.opponent) return this.opponent;
    const rng = new RNG();
    const tmpl = this.settings.opponent !== 'random' ? CPU_TEAMS.find(t => t.name === this.settings.opponent) : null;
    // Avoid kits that look alike on the field.
    const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const close = (a, b) => { const x = hex(a), y = hex(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 110; };
    const usable = CPU_TEAMS.filter(t => !close(t.primary, this.team.primary));
    const pick = tmpl && !close(tmpl.primary, this.team.primary) ? tmpl : tmpl ? { ...tmpl, primary: (usable[0] || CPU_TEAMS[0]).primary, secondary: (usable[0] || CPU_TEAMS[0]).secondary } : rng.pick(usable.length ? usable : CPU_TEAMS);
    const opp = generateCpuTeam(rng, { difficulty: this.settings.difficulty, template: pick });
    this.opponent = opp;
    return opp;
  }

  // ------------------------------------------------------------------ match lifecycle
  startMatch({ userWon, decision }) {
    const opp = this.pendingOpponent();
    const toss = { winner: userWon ? this.team.id : opp.id, decision };
    let engine;
    try {
      engine = new MatchEngine({
        teams: [{ ...this.team, isUser: true }, { ...opp, isUser: false }],
        config: { overs: this.settings.overs, difficulty: this.settings.difficulty, stadium: this.settings.stadium, timeOfDay: this.settings.timeOfDay },
        toss,
      });
    } catch (err) {
      toast(esc(err.message), 4000, 'bad');
      this.go('strategy');
      return;
    }
    this.lastOpponent = opp;
    this.launch(engine);
    const bf = engine.team(engine.state.battingFirst);
    toast(`${esc(engine.team(toss.winner).name)} won the toss and chose to ${decision}. ${esc(bf.name)} bat first.`, 3500);
  }

  resumeMatch() {
    const m = Storage.get('match');
    try {
      const e = MatchEngine.fromJSON(m.engine);
      this.launch(e);
      toast('Match resumed', 1800);
    } catch (err) {
      console.error(err);
      toast('Could not resume the saved match', 3000, 'bad');
      this.clearSavedMatch();
      this.render();
    }
  }

  launch(engine) {
    this.sound.resume();
    this.demo.stop();
    const c = engine.config;
    this.stadium.setCrowdTeamColor(this.team.primary);
    if (this.stadium.stadiumId !== c.stadium || this.stadium.quality !== this.settings.quality) {
      this.stadium.quality = this.settings.quality;
      this.stadium.build(c.stadium || 'harbour', c.timeOfDay || 'day');
    } else this.stadium.setTimeOfDay(c.timeOfDay || 'day');
    this.uiRoot.classList.add('hidden');
    document.activeElement?.blur?.();
    this.match = new MatchController(this, engine);
    this.match.start();
    this.saveMatch(engine);
  }

  exitMatch() {
    if (this.match) this.match.destroy();
    this.match = null;
    this.opponent = null;
    this.demo.start('menu');
    this.go('main');
  }

  rematch() {
    const opp = this.lastOpponent;
    if (this.match) this.match.destroy();
    this.match = null;
    this.demo.start('menu');
    this.opponent = opp || null;
    this.screen = 'toss';
    SCREENS.toss.state = null;
    this.render();
  }

  // ------------------------------------------------------------------ net practice
  netsConfig() { return Storage.get('nets') || {}; }
  saveNetsConfig(cfg) { Storage.set('nets', cfg); }

  /** Start a net session with the chosen bowler (in the current stadium, with the stands empty). */
  startNets(cfg) {
    this.saveNetsConfig(cfg);
    this.sound.resume();
    this.demo.stop();
    const s = this.settings;
    if (this.stadium.stadiumId !== s.stadium || this.stadium.quality !== s.quality) {
      this.stadium.quality = s.quality;
      this.stadium.build(s.stadium || 'harbour', s.timeOfDay || 'day');
    } else this.stadium.setTimeOfDay(s.timeOfDay || 'day');
    this.uiRoot.classList.add('hidden');
    document.activeElement?.blur?.();
    this.match = new NetsController(this, cfg);
    this.match.start();
  }

  /** Leave the nets for the Net Practice screen ('nets') or the main menu. */
  leaveNets(to = 'main') {
    if (this.match) this.match.destroy();
    this.match = null;
    this.demo.start('menu');
    this.go(to);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const input = this.input;
    if (this.match) {
      this.match.update(dt);
      return this.match.cameraContext();
    }
    this.demo.update(dt);
    input.setProfile('menu');
    const root = this.uiRoot;
    if (input.pressed('up')) moveFocus(root, 'up');
    if (input.pressed('down')) moveFocus(root, 'down');
    if (input.pressed('left') && !adjustFocused(-1)) moveFocus(root, 'left');
    if (input.pressed('right') && !adjustFocused(1)) moveFocus(root, 'right');
    if (input.pressed('confirm') && document.activeElement && root.contains(document.activeElement)) document.activeElement.click();
    if (input.pressed('back')) {
      const sc = SCREENS[this.screen];
      if (sc.back) this.go(sc.back);
    }
    return this.demo.cameraContext();
  }

  glyph(action, profile) { return glyph(this.input, action, profile); }

  controlsSummaryHTML() {
    const row = (p, a) => `<tr><td>${esc(ACTION_LABELS[a])}</td><td>${glyph(this.input, a, p)}</td></tr>`;
    return `<h2>Controls</h2><div class="grid2"><div><h3>Batting</h3><table class="binds">
      <tr><td>Direction / footwork</td><td><span class="glyph key">WASD</span> / stick</td></tr>
      ${['ground', 'lofted', 'defend', 'advanced', 'leave', 'power', 'precision', 'run', 'cancelRun', 'sprint', 'dive'].map(a => row('batting', a)).join('')}</table></div>
      <div><h3>Bowling</h3><table class="binds"><tr><td>Aim line &amp; length</td><td><span class="glyph key">WASD</span> / stick</td></tr>
      ${['bowl', 'typeNext', 'typePrev', 'power'].map(a => row('bowling', a)).join('')}</table>
      <h3>Fielding</h3><table class="binds">${['throwKeeper', 'throwBowler', 'throwAuto'].map(a => row('fielding', a)).join('')}</table></div></div>
      <p class="muted">Remap everything from the main menu → Controls &amp; Tutorial.</p>
      <div class="ov-actions"><button class="btn primary" data-ov="back">Back</button></div>`;
  }
}
