// Net practice: a computer bowler, set up by the player, bowls ball after ball to the player's batter in
// the nets for as long as they like. It uses the match's delivery simulation, batting controls and view;
// nothing is scored, but every ball is graded (timing, shot, what it would have been worth in a match).

import { NetsDeliverySim } from './NetsSim.js';
import {
  normalizeNetsConfig, netBowler, netSpec, netOutcome, emptyNetStats, addNetBall, netsLabel, NETS_TEAM, NET_LINES, NET_DIFFICULTY,
} from './NetsConfig.js';
import { applyBattingInput, SHOT_HINTS } from './BattingInput.js';
import { deliveryTypesFor } from './BallPhysics.js';
import { lengthDef } from './PhysicsConfig.js';
import { BOWLING_TYPES } from './PlayerAttributes.js';
import { RNG } from '../utils/Random.js';
import { HUD, renderOverlay, hideOverlay, settingsHTML, netsPauseHTML, netsSummaryHTML } from '../ui/HUD.js';
import { netsFormHTML, readNetsForm, netsFormClick, syncNetsFormLabels, refocusNetsForm } from '../ui/NetsForm.js';
import { esc, toast, moveFocus, adjustFocused } from '../ui/UI.js';
import { BATTING_VIEWS, BOWLING_VIEWS, viewEnd, normalizeBattingView, normalizeBowlingView } from '../scene/CameraPoses.js';

const NEXT_BALL_AFTER = 2.6;   // seconds before the bowler runs in again (Continue skips the wait)

export class NetsController {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = normalizeNetsConfig(cfg, app.team);
    this.rng = new RNG();
    this.state = 'init';
    this.hud = new HUD(app.hudRoot, { nets: true });
    this.overlay = app.overlayRoot;
    this.stats = emptyNetStats();
    this.lastSpecs = [];
    this.last = null;
    this.timingShownAt = -1;
    this.userBatting = true;
    this.userBowling = false;
  }

  get settings() { return this.app.settings; }
  get input() { return this.app.input; }
  get batter() { return this.app.team.players.find(p => p.id === this.cfg.batterId) || this.app.team.players[0]; }

  start() {
    const app = this.app;
    app.hudRoot.classList.remove('hidden');
    this.settings.battingCamera = normalizeBattingView(this.settings.battingCamera ?? this.settings.camera);
    this.settings.bowlingCamera = normalizeBowlingView(this.settings.bowlingCamera);
    app.cameras.setViews(this.settings.battingCamera, this.settings.bowlingCamera);
    app.stadium.setEnds(0);
    app.stadium.setNets(true);
    app.stadium.updateScoreboard({ title: 'NET PRACTICE', subtitle: netsLabel(this.cfg) });
    app.hudRoot.onclick = (ev) => { if (ev.target.closest('[data-hud="pause"]')) this.pause(); };
    app.sound.crowd(0);
    this.setupBall(true);
  }

  destroy() {
    const app = this.app;
    app.view.stopReplay();
    app.view.hideAll();
    app.view.sim = null;
    this.overlay.onchange = this.overlay.oninput = null;
    hideOverlay(this.overlay);
    app.hudRoot.classList.add('hidden');
    app.hudRoot.onclick = null;
    app.stadium.setNets(false);
    app.cameras.look = { x: 0, y: 0 };
  }

  // ------------------------------------------------------------------ balls
  setupBall(cut = false) {
    const app = this.app, cfg = this.cfg;
    this.bowler = netBowler(cfg);
    const D = NET_DIFFICULTY[cfg.difficulty];
    this.sim = new NetsDeliverySim({ striker: this.batter, bowler: this.bowler, rng: this.rng, difficulty: D.base, realTime: !!D.realTime });
    const spec = netSpec(cfg, this.bowler, this.batter, this.rng, this.lastSpecs);
    this.sim.setSpec(spec);
    this.lastSpecs = [...this.lastSpecs.slice(-4), spec];
    app.view.setLook({ whites: false, ball: 'white', wear: 0.3 });   // a used practice ball
    app.stadium.setSightscreens('black');
    app.view.bind(this.sim, { battingTeam: app.team, bowlingTeam: NETS_TEAM });
    app.cameras.set('batting', {}, cut);
    this.hud.setEnd(`Nets · ${this.bowler.name} (${BOWLING_TYPES[cfg.type].label})`);
    this.hud.timing(null);
    this.hud.hideBanner();
    this.hud.prompt(null);
    this.refreshHUD();
    this.recorded = false;
    this.state = 'ball';
    this.deadT = 0;
  }

  nextBall() {
    this.hud.hideBanner();
    this.setupBall();
  }

  recordBall() {
    this.recorded = true;
    const r = this.sim.result();
    const o = netOutcome(r);
    addNetBall(this.stats, r, o);
    this.last = r;
    this.hud.banner(o.main, esc(o.sub), o.kind);
    this.refreshHUD();
    this.state = 'between';
    this.deadT = 0;
  }

  // ------------------------------------------------------------------ main loop
  update(dt) {
    const input = this.input;
    if (this.state === 'paused' || this.state === 'overlay') { this.overlayNav(); return; }
    if (this.state === 'init' || !this.sim) return;
    if (input.pressed('pause')) { this.pause(); return; }
    if (input.pressed('camera')) this.cycleCamera();
    const sim = this.sim, view = this.app.view, cams = this.app.cameras;
    if (this.state === 'ball') {
      this.aim = applyBattingInput(this.app, sim, dt, { running: false });
      sim.update(dt);
      this.handleEvents();
      view.update(dt);
      cams.set('batting');
      if (sim.phase === 'dead' && !this.recorded) this.recordBall();
    } else if (this.state === 'between') {
      input.setProfile('between');
      this.aim = null;
      sim.update(dt);
      view.update(dt);
      cams.set('batting');
      this.deadT += dt;
      if (input.pressed('replay')) { this.startReplay(); return; }
      if ((input.pressed('continue') && this.deadT > 0.35) || this.deadT > NEXT_BALL_AFTER) this.nextBall();
    } else if (this.state === 'replay') {
      input.setProfile('between');
      view.update(dt);
      cams.set('cinematic', { kind: this.replayKind });
      this.camCtx = { frameYaw: 0, ball: view.replayBall || { x: 0, y: 1, z: 0 }, bowler: sim.bowler };
      if (view.replayDone || input.pressed('continue')) {
        view.stopReplay();
        this.state = 'between';
        this.deadT = Math.max(this.deadT, NEXT_BALL_AFTER - 1);
        this.hud.show('.banner', true);
      }
    }
    this.updateHUD();
  }

  cameraContext() {
    if (this.state === 'replay' && this.camCtx) return this.camCtx;
    return { frameYaw: 0, bowler: this.sim?.bowler, ball: this.sim?.ball?.p };
  }

  handleEvents() {
    const sim = this.sim, snd = this.app.sound, hud = this.hud;
    for (const ev of sim.drainEvents()) {
      this.app.view.onEvent(ev);
      switch (ev.type) {
        case 'release': snd.whoosh(); break;
        case 'noBall': hud.banner('NO BALL', esc(ev.reason || ''), 'small x'); break;
        case 'timing': hud.timing(ev); this.timingShownAt = sim.t; break;
        case 'contact': snd.bat(ev.edge ? 0.3 : Math.max(0.3, ev.quality || 0.6)); this.app.gamepad.vibrate(70, ev.edge ? 0.3 : 0.7); break;
        case 'padHit': case 'bodyHit': snd.pad(); break;
        case 'stumpsHit': snd.stumps(); this.app.gamepad.vibrate(160, 0.6); break;
        case 'netHit': snd.thud(Math.min(0.22, 0.04 + ev.speed * 0.006), 95); break;
        case 'appeal': if (ev.denied) hud.banner('NOT OUT', 'Appeal turned down', 'small'); break;
        default: break;
      }
    }
  }

  startReplay() {
    const d = this.last?.dismissal?.type;
    this.replayKind = d === 'bowled' || d === 'lbw' ? 'stumpCam' : this.last?.contact ? 'sideOn' : 'bowlerEnd';
    const dur = this.app.view.startReplay({ speed: d ? 0.4 : 0.55, fromEnd: 3 });
    if (!dur) return;
    this.state = 'replay';
    this.hud.show('.banner', false);
    this.app.cameras.set('cinematic', { kind: this.replayKind }, true);
    toast('REPLAY', 1500, 'replay');
  }

  cycleCamera() {
    const cams = this.app.cameras;
    const next = BATTING_VIEWS[(BATTING_VIEWS.findIndex(v => v.id === cams.battingView) + 1) % BATTING_VIEWS.length];
    this.settings.battingCamera = next.id;
    cams.setViews(this.settings.battingCamera, this.settings.bowlingCamera);
    this.app.saveSettings();
    toast(`Camera: ${esc(next.label)}`, 1400);
  }

  // ------------------------------------------------------------------ HUD
  cardRows() {
    const c = this.cfg;
    const variation = c.variation === 'mixed' ? 'Mixed' : deliveryTypesFor(this.bowler).find(d => d.id === c.variation)?.label || c.variation;
    return [
      ['Type', BOWLING_TYPES[c.type].label],
      ['Speed', c.speedMode === 'random' ? `${c.speedMin}–${c.speedMax} km/h` : `${c.speed} km/h`],
      ['Delivery', variation],
      ['Length', c.length === 'mixed' ? 'Mixed' : lengthDef(c.length).label],
      ['Line', c.line === 'mixed' ? 'Mixed' : NET_LINES[c.line].label],
    ];
  }

  refreshHUD() { this.hud.updateNets(this.stats, netsLabel(this.cfg), this.cardRows(), this.last); }

  updateHUD() {
    const hud = this.hud, input = this.input, sim = this.sim;
    if (this.timingShownAt >= 0 && sim.t - this.timingShownAt > 2.2) { hud.timing(null); this.timingShownAt = -1; }
    this.app.hudRoot.classList.toggle('no-hints', this.settings.hints === 'off');
    // the standard field the shots are scored against, with the aim and where the last shot would have gone
    const p = sim.projection, from = sim.contactAt;
    hud.netsMap(sim, viewEnd(this.app.cameras.battingView) === 'bowler' ? 1 : -1, this.state === 'ball' ? this.aim : null,
      p?.to && from ? { from, to: p.to } : null);
    if (this.state === 'replay') hud.hints(input, 'between', [['continue', 'Skip replay']]);
    else if (this.state === 'between') hud.hints(input, 'between', [['continue', 'Next ball'], ['replay', 'Replay'], ['pause', 'Change bowler']]);
    else hud.hints(input, 'batting', [...SHOT_HINTS, ['pause', 'Change bowler']]);
  }

  // ------------------------------------------------------------------ overlays
  overlayNav() {
    const input = this.input, root = this.overlay;
    input.setProfile('paused');
    if (input.pressed('up')) moveFocus(root, 'up');
    if (input.pressed('down')) moveFocus(root, 'down');
    if (input.pressed('left') && !adjustFocused(-1)) moveFocus(root, 'left');
    if (input.pressed('right') && !adjustFocused(1)) moveFocus(root, 'right');
    if (input.pressed('confirm') && document.activeElement && root.contains(document.activeElement)) document.activeElement.click();
    if ((input.pressed('back') || input.pressed('pause')) && this.state === 'paused') this.resume();
  }

  pause() {
    if (this.state === 'paused' || this.state === 'overlay') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.showPause();
  }

  resume() {
    this.overlay.onchange = this.overlay.oninput = null;
    hideOverlay(this.overlay);
    this.state = this.prevState || 'ball';
    this.input.setProfile('menu');
  }

  showPause() {
    this.overlay.onchange = this.overlay.oninput = null;
    renderOverlay(this.overlay, netsPauseHTML(this.stats, netsLabel(this.cfg)), (act) => {
      if (act === 'resume') this.resume();
      else if (act === 'bowler') this.showBowlerForm(this.cfg);
      else if (act === 'reset') { this.stats = emptyNetStats(); this.last = null; this.refreshHUD(); toast('Session stats reset', 1600); this.showPause(); }
      else if (act === 'controls') renderOverlay(this.overlay, this.app.controlsSummaryHTML(), () => this.showPause());
      else if (act === 'settings') this.showSettings();
      else if (act === 'quit') this.showSummary();
    });
  }

  /** The bowler form inside the pause overlay; "Bowl to me" brings the new bowler on straight away. */
  showBowlerForm(cfg) {
    this.formCfg = cfg;
    const team = this.app.team;
    const draw = (focusFrom = null) => {
      renderOverlay(this.overlay, `<h2>Change bowler</h2>${netsFormHTML(this.formCfg, team)}
        <div class="ov-actions"><button class="btn primary" data-ov="apply">Bowl to me →</button><button class="btn ghost" data-ov="back">Back</button></div>`, (act) => {
        if (act === 'apply') this.applyConfig(readNetsForm(this.overlay, this.formCfg, team));
        else if (act === 'back') this.showPause();
      });
      const onOv = this.overlay.onclick;
      this.overlay.onclick = (e) => {
        const next = netsFormClick(e.target, this.formCfg, team);
        if (next) { this.formCfg = next; draw(e.target); return; }
        onOv(e);
      };
      this.overlay.oninput = () => syncNetsFormLabels(this.overlay);
      this.overlay.onchange = () => { this.formCfg = readNetsForm(this.overlay, this.formCfg, team); };
      if (focusFrom) refocusNetsForm(this.overlay, focusFrom);
    };
    draw();
  }

  applyConfig(cfg) {
    this.cfg = normalizeNetsConfig(cfg, this.app.team);
    this.app.saveNetsConfig(this.cfg);
    this.app.stadium.updateScoreboard({ title: 'NET PRACTICE', subtitle: netsLabel(this.cfg) });
    this.overlay.onchange = this.overlay.oninput = null;
    hideOverlay(this.overlay);
    this.input.setProfile('menu');
    // The new bowler starts a fresh ball (an unfinished one isn't counted).
    this.app.view.stopReplay();
    this.setupBall();
    toast(`${esc(this.bowler.name)} · ${esc(netsLabel(this.cfg))}`, 2200);
  }

  showSettings() {
    renderOverlay(this.overlay, settingsHTML(this.settings, BATTING_VIEWS, BOWLING_VIEWS, { nets: true }), (act) => { if (act === 'back') this.showPause(); });
    this.overlay.onchange = this.overlay.oninput = (e) => {
      const key = e.target.dataset.setting;
      if (!key) return;
      const v = e.target.value;
      this.settings[key] = key === 'volume' ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
      if (key === 'battingCamera') this.app.cameras.setViews(this.settings.battingCamera, this.settings.bowlingCamera);
      this.app.saveSettings();
    };
  }

  showSummary() {
    this.overlay.onchange = this.overlay.oninput = null;
    renderOverlay(this.overlay, netsSummaryHTML(this.stats, netsLabel(this.cfg), this.batter), (act) => {
      if (act === 'back') this.showPause();
      else if (act === 'setup') this.app.leaveNets('nets');
      else if (act === 'menu') this.app.leaveNets('main');
    });
  }
}
