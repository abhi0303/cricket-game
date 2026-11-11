// Runs a match the human is playing: ball by ball, with input profiles, cameras, HUD,
// replays and overlays. Scoring only ever goes through MatchEngine.recordBall().

import { buildDeliverySim, ensureBowler } from './MatchSim.js';
import { chooseBowler } from '../ai/BowlingAI.js';
import { deliveryTypesFor, PITCH } from './BallPhysics.js';
import { PHYSICS, lengthDef, defaultLengthTarget, clampToLength } from './PhysicsConfig.js';
import { FIELD_PRESETS } from './FieldPlacements.js';
import { BOWLING_TYPES } from './PlayerAttributes.js';
import { RNG, clamp } from '../utils/Random.js';
import { HUD, renderOverlay, hideOverlay, pauseHTML, bowlerSelectHTML, inningsBreakHTML, resultHTML, scorecardHTML, settingsHTML, skipHTML, simulatingHTML, updateSimulating, testBreakHTML, stumpsHTML } from '../ui/HUD.js';
import { simulateBalls, simulateAcross, untilStumps, chaseFinishReached } from './SkipSim.js';
import { aiShouldDeclare, aiEnforceFollowOn } from '../ai/CaptainAI.js';
import { ballWear } from '../scene/BallLook.js';
import { ReviewView } from '../scene/ReviewView.js';
import { reviewVerdict, aiWantsReview, applyVerdict, VERDICT_TEXT, verdictTone } from './DRS.js';
import { reviewPromptHTML } from '../ui/HUD.js';
import { esc, toast, moveFocus, adjustFocused } from '../ui/UI.js';
import { BATTING_VIEWS, BOWLING_VIEWS, viewEnd, normalizeBattingView, normalizeBowlingView } from '../scene/CameraPoses.js';
import { applyBattingInput, SHOT_HINTS } from './BattingInput.js';

const END_NAMES = ['Pavilion End', 'City End'];

export class MatchController {
  constructor(app, engine) {
    this.app = app;
    this.engine = engine;
    this.rng = new RNG();
    this.state = 'init';
    this.hud = new HUD(app.hudRoot);
    this.overlay = app.overlayRoot;
    this.userTeamId = engine.userTeam.id;
    this.lastSpecs = [];
    this.userFieldPreset = 'auto';
    this.typeIndex = 0;
    this.timingShownAt = -1;
    this.lastResult = null;
    this.auto = false;        // auto-play: the AI plays the human's side
    this.simulating = null;   // skip-ahead in progress
    this.captainPicks = false; // the AI chooses the human's bowlers (they still bowl) for the rest of the innings
    this.lastSession = null;
  }

  get settings() { return this.app.settings; }

  /**
   * Is the human controlling the current delivery? Auto-play switches over between balls, so the ball
   * in progress when it's toggled is finished by whoever started it.
   */
  get humanBall() {
    const c = this.sim?.control;
    return !!c && ((this.userBatting && c.bat === 'user') || (this.userBowling && c.bowl === 'user'));
  }
  get input() { return this.app.input; }

  start() {
    const e = this.engine;
    this.app.hudRoot.classList.remove('hidden');
    this.settings.battingCamera = normalizeBattingView(this.settings.battingCamera ?? this.settings.camera);
    this.settings.bowlingCamera = normalizeBowlingView(this.settings.bowlingCamera);
    this.app.cameras.setViews(this.settings.battingCamera, this.settings.bowlingCamera);
    this.app.stadium.updateScoreboard({ title: `${e.state.teams[0].short} v ${e.state.teams[1].short}`, subtitle: e.isTest ? `Test match · Day ${e.state.test.day}` : `${e.config.overs}-over match` });
    this.hud.hudRoot = this.app.hudRoot;
    this.app.hudRoot.onclick = (ev) => { if (ev.target.closest('[data-hud="pause"]')) this.pause(); };
    this.nextBall();
  }

  destroy() {
    clearTimeout(this.reviewTimer);
    this.reviewView?.clear();
    this.simulating = null;
    this.app.view.stopReplay();
    this.app.view.hideAll();
    this.app.view.sim = null;
    hideOverlay(this.overlay);
    this.app.hudRoot.classList.add('hidden');
    this.app.hudRoot.onclick = null;
  }

  // ------------------------------------------------------------------ ball setup
  nextBall() {
    const e = this.engine;
    if (e.phase === 'break') return this.showInningsBreak();
    if (e.phase === 'complete') return this.showResult();
    const inn = e.innings;
    this.hud.setTeams(e.battingTeam, e.bowlingTeam);
    if (e.needsBowler()) {
      if (inn.bowlingTeam === this.userTeamId && !this.auto && !this.captainPicks) return this.showBowlerSelect();
      const id = chooseBowler({ engine: e, eligible: e.eligibleBowlers(), rng: this.rng });
      e.setBowler(id);
      const p = e.player(id);
      if (inn.legalBalls > 0 || inn.overs.length) toast(`Over ${inn.overs.length + 1}: <b>${esc(p.name)}</b> (${esc(BOWLING_TYPES[p.bowlingType].label)})`, 2400);
    }
    this.setupBall();
  }

  setupBall() {
    const e = this.engine, inn = e.innings, app = this.app;
    const endIdx = inn.overs.length % 2;
    app.stadium.setEnds(endIdx);
    const userBowling = inn.bowlingTeam === this.userTeamId;
    const userBatting = inn.battingTeam === this.userTeamId;
    // Under auto-play the delivery is AI against AI; the cameras and HUD still follow the human's side.
    this.sim = buildDeliverySim(e, {
      rng: this.rng,
      userTeamId: this.auto ? null : this.userTeamId,
      assistRunning: this.settings.assistRunning,
      fieldPreset: userBowling && this.userFieldPreset !== 'auto' ? this.userFieldPreset : null,
      lastSpecs: this.lastSpecs,
      unlockSpeeds: !!this.app.debugPhysics,
    });
    const sim = this.sim;
    this.userBowling = userBowling;
    this.userBatting = userBatting;
    if (userBowling && !this.auto) {
      this.types = deliveryTypesFor(sim.bowlerP);
      this.typeIndex = Math.min(this.typeIndex, this.types.length - 1);
      if (this.bowlerForTypes !== sim.bowlerP.id) { this.typeIndex = 0; this.bowlerForTypes = sim.bowlerP.id; }
      // Remember each bowler's last speed, length and aim between deliveries.
      const keep = this.aimFor?.[sim.bowlerP.id];
      const spec = { type: this.types[this.typeIndex].id, quality: 0.8, overstep: false };
      if (keep) {
        spec.length = keep.length;
        spec.target = { x: keep.x, len: keep.len, height: keep.height };
        // Tired bowlers may no longer reach their earlier pace.
        spec.speedKph = sim.speedOptions.reduce((b, v) => (Math.abs(v - keep.speedKph) < Math.abs(b - keep.speedKph) ? v : b), sim.speedOptions[0]);
      }
      sim.setSpec(spec);
    }
    this.applyLook();
    app.view.bind(sim, { battingTeam: e.battingTeam, bowlingTeam: e.bowlingTeam });
    app.view.aim.userHidden = !this.settings.aimMarker;
    app.cameras.set(userBatting ? 'batting' : 'bowling', { phase: 'aim' }, true);
    const sit = e.situation();
    this.hud.setEnd(`${sim.bowlerP.name} from the ${END_NAMES[endIdx]}${e.isTest ? ` · Day ${sit.day}, session ${sit.session} · ${sit.oversLeftToday} ov left today` : ''}`);
    this.hud.updateScore(e, this.lastResult);
    this.hud.timing(null);
    this.hud.hideBanner();
    this.hud.prompt(null);
    this.recorded = false;
    this.boundaryCamAt = null;
    this.state = 'ball';
    this.deadT = 0;
    this.replayed = false;
    app.sound.crowd(0.1);
  }

  /** Kit, ball and sightscreens for the format: whites and a red ball for Tests. The ball gets grubbier with age. */
  applyLook() {
    const e = this.engine, inn = e.innings;
    const ball = e.isTest ? 'red' : 'white';
    const age = inn ? (inn.legalBalls - (inn.ballStart || 0)) / 6 : 0;
    this.app.view.setLook({ whites: e.isTest, ball, wear: ballWear(ball, age) });
    this.app.stadium.setSightscreens(e.isTest ? 'white' : 'black');
  }

  /** Does the computer captain the batting side right now (it declares for them)? */
  cpuCaptains(teamId) { return teamId !== this.userTeamId || this.auto; }

  // ------------------------------------------------------------------ main loop
  update(dt) {
    const input = this.input;
    if (this.state === 'paused' || this.state === 'overlay') { this.overlayNav(); return; }
    if (this.state === 'init' || !this.sim) return;
    if (input.pressed('pause')) { this.pause(); return; }
    if (input.pressed('camera')) this.cycleCamera();

    const sim = this.sim;
    if (this.state === 'ball') {
      this.handleControls(dt);
      sim.update(dt);
      this.handleEvents();
      this.app.view.update(dt);
      this.updateCamera();
      if (sim.phase === 'dead' && !this.recorded && !this.reviewing) this.ballDone();
    } else if (this.state === 'between') {
      input.setProfile('between');
      sim.update(dt);
      this.app.view.update(dt);
      this.updateCamera();
      this.deadT += dt;
      const hl = this.lastResult?.highlight;
      if (hl && this.settings.autoReplay && !this.replayed && this.deadT > 1.3 && this.app.view.hasReplay()) { this.startReplay(); return; }
      if (input.pressed('replay')) { this.startReplay(); return; }
      if ((input.pressed('continue') && this.deadT > 0.35) || this.deadT > (hl ? 3.4 : 2.4)) this.afterBall();
    } else if (this.state === 'review') {
      this.updateReview(dt);
    } else if (this.state === 'replay') {
      input.setProfile('between');
      const view = this.app.view;
      view.update(dt);
      const seg = view.replaySegment, idx = view.replay?.i ?? 0;
      const b = view.replayBall || { x: 0, y: 1, z: 0 };
      this.app.cameras.set('cinematic', { kind: seg?.kind || 'bowlerEnd', end: seg?.end }, idx !== this.replaySegIdx);
      this.replaySegIdx = idx;
      this.hud.replayTag(seg?.label || 'REPLAY');
      this.camCtx = { frameYaw: this.app.stadium.frame.rotation.y, ball: b, bowler: sim.bowler };
      if (view.replayDone || input.pressed('continue')) {
        view.stopReplay();
        this.hud.replayTag(null);
        this.state = this.afterReplayState || 'between';
        this.afterReplayState = null;
        this.replayed = true;
        this.deadT = Math.max(this.deadT, 2.2);
        this.hud.show('.banner', true);
      }
    }
    this.updateHUD();
  }

  cameraContext() {
    if ((this.state === 'replay' || this.state === 'review') && this.camCtx) return this.camCtx;
    const sim = this.sim;
    return { frameYaw: this.app.stadium.frame.rotation.y, bowler: sim?.bowler, ball: sim?.ball?.p };
  }

  /** Which end the player's chosen camera watches from (the follow camera stays on that end). */
  get viewingEnd() {
    const cams = this.app.cameras;
    return this.userBatting ? viewEnd(cams.battingView) : viewEnd(cams.bowlingView);
  }

  updateCamera() {
    const sim = this.sim, cams = this.app.cameras;
    if (sim.phase === 'inplay' || (sim.phase === 'dead' && (sim.contactMade || sim.padHit))) {
      if (this.boundaryCamAt != null && sim.t >= this.boundaryCamAt) cams.set('cinematic', { kind: 'boundary', exit: sim.bat?.boundary?.p });
      else cams.set('follow', { end: this.viewingEnd });
    } else if (this.userBatting) cams.set('batting');
    else cams.set('bowling', { phase: sim.phase === 'ready' ? 'aim' : 'runup' });
    // In the umpire's-eye view the camera *is* the umpire, so hide that model.
    this.app.view.hideUmpire = this.userBatting && cams.battingView === 'umpire' && cams.mode === 'batting';
  }

  cycleCamera() {
    const cams = this.app.cameras;
    const list = this.userBatting ? BATTING_VIEWS : BOWLING_VIEWS;
    const cur = this.userBatting ? cams.battingView : cams.bowlingView;
    const next = list[(list.findIndex(v => v.id === cur) + 1) % list.length];
    if (this.userBatting) this.settings.battingCamera = next.id; else this.settings.bowlingCamera = next.id;
    cams.setViews(this.settings.battingCamera, this.settings.bowlingCamera);
    this.app.saveSettings();
    toast(`Camera: ${esc(next.label)}`, 1400);
  }

  // ------------------------------------------------------------------ input
  handleControls(dt) {
    const sim = this.sim, input = this.input;
    if (this.userBatting) {
      if (!this.humanBall) { input.setProfile('batting'); this.app.view.setShotArrow(0, 0, false); return; }
      applyBattingInput(this.app, sim, dt);
    } else if (this.userBowling) {
      const ax = input.axis();
      this.app.view.setShotArrow(0, 0, false);
      if (sim.awaitThrow) {
        input.setProfile('fielding');
        if (input.pressed('throwKeeper')) sim.inputThrow('striker');
        else if (input.pressed('throwBowler')) sim.inputThrow('nonStriker');
        else if (input.pressed('throwAuto')) sim.inputThrow('auto');
        return;
      }
      input.setProfile('bowling');
      if (!this.humanBall) return;
      if (sim.phase === 'ready' || sim.phase === 'runup') {
        const k = sim.phase === 'runup' ? 0.35 : 1;
        const t = sim.spec.target;
        const L = lengthDef(sim.spec.length);
        // From behind the bowler, screen-right is the batter's leg side (-x); up = fuller.
        // Up/down moves the pitching point within the selected length's range (full toss: target height).
        const x = clamp(t.x - ax.x * dt * 0.85 * k, -0.9, 1.25);
        const len = L.range ? clampToLength(sim.spec.length, t.len - ax.y * dt * 2.5 * k) : t.len;
        const height = L.range ? t.height : clamp((t.height ?? 0.7) + ax.y * dt * 0.5 * k, L.heightRange[0], L.heightRange[1]);
        sim.setSpec({ target: { x, len, height } });
        this.rememberAim();
      }
      if (sim.phase === 'ready') {
        if (input.pressed('typeNext')) this.changeType(1);
        if (input.pressed('typePrev')) this.changeType(-1);
        if (input.pressed('speedUp')) this.changeSpeed(1);
        if (input.pressed('speedDown')) this.changeSpeed(-1);
        if (input.pressed('lengthNext')) this.changeLength(1);
        if (input.pressed('lengthPrev')) this.changeLength(-1);
        if (input.pressed('bowl')) { sim.startRunup(); this.app.sound.click(); }
      } else if (sim.phase === 'runup') {
        sim.setPower(input.value('power'));
        if (input.released('bowl') || !input.down('bowl')) sim.releaseMeter();
      }
    }
  }

  changeType(d) {
    this.typeIndex = (this.typeIndex + d + this.types.length) % this.types.length;
    this.sim.setSpec({ type: this.types[this.typeIndex].id });
    this.app.sound.click(true);
  }

  /** Step through the speeds this bowler can bowl (fastest first in speedOptions). */
  changeSpeed(d) {
    const sim = this.sim, opts = sim.speedOptions;
    const i = Math.max(0, opts.indexOf(sim.spec.speedKph));
    const j = clamp(i - d, 0, opts.length - 1);
    sim.setSpec({ speedKph: opts[j] });
    this.rememberAim();
    this.app.sound.click(true);
  }

  changeLength(d) {
    const sim = this.sim, order = PHYSICS.lengthOrder;
    const i = (order.indexOf(sim.spec.length) + d + order.length) % order.length;
    const id = order[i];
    sim.setSpec({ length: id, target: { ...defaultLengthTarget(id) } });
    this.rememberAim();
    this.app.sound.click(true);
  }

  rememberAim() {
    const s = this.sim.spec;
    this.aimFor = this.aimFor || {};
    this.aimFor[this.sim.bowlerP.id] = { x: s.target.x, len: s.target.len, height: s.target.height, length: s.length, speedKph: s.speedKph };
  }

  // ------------------------------------------------------------------ events
  handleEvents() {
    const sim = this.sim, snd = this.app.sound, hud = this.hud;
    for (const ev of sim.drainEvents()) {
      this.app.view.onEvent(ev);
      switch (ev.type) {
        case 'release': snd.whoosh(); break;
        case 'noBall': hud.banner('NO BALL', esc(ev.reason || ''), 'small x'); break;
        case 'timing': hud.timing(ev); this.timingShownAt = sim.t; break;
        case 'contact': snd.bat(ev.edge ? 0.3 : Math.max(0.3, ev.quality || 0.6)); if (this.userBatting) this.app.gamepad.vibrate(70, ev.edge ? 0.3 : 0.7); break;
        case 'padHit': snd.pad(); break;
        case 'keeperCollect': snd.gloves(); break;
        case 'stumpsHit': snd.stumps(); break;
        case 'beaten': snd.crowd(0.35, 0.2); break;
        case 'appeal': snd.crowd(0.6, 0.1); if (ev.denied) hud.banner('NOT OUT', 'Appeal turned down', 'small'); break;
        case 'drop': snd.groan(); hud.banner('DROPPED!', '', 'small'); break;
        case 'throwChoice': hud.prompt(`Batters running! Throw to: ${this.glyphs([['throwKeeper', "keeper's end"], ['throwBowler', "bowler's end"], ['throwAuto', 'best end']], 'fielding')}`); break;
        case 'throw': hud.prompt(null); break;
        case 'interceptPlanned':
          if (ev.boundary && !ev.intercept && this.boundaryCamAt == null) this.boundaryCamAt = sim.t + 0.55;
          break;
        case 'boundary': snd.cheer(ev.runs === 6 ? 1 : 0.75); this.app.stadium.cheer(ev.runs === 6 ? 1 : 0.7); break;
        case 'wicket': {
          const good = this.userBowling; // the human's side took it
          if (good || !this.userBatting) snd.cheer(0.9); else snd.groan();
          this.app.stadium.cheer(0.9);
          this.app.gamepad.vibrate(200, 0.8);
          break;
        }
        default: break;
      }
    }
  }

  glyphs(items, profile) {
    return items.map(([a, t]) => `<span class="hint">${this.app.glyph(a, profile)} ${esc(t)}</span>`).join(' ');
  }

  // ------------------------------------------------------------------ after the ball
  // ------------------------------------------------------------------ DRS
  /**
   * The ball is dead. An LBW decision can be reviewed by the side it went against (3 reviews an innings):
   * the player is asked; the computer decides for itself. Otherwise the ball is recorded straight away.
   */
  ballDone() {
    const res = this.sim.result(), lbw = this.sim.lbw, e = this.engine;
    if (lbw && e.phase === 'innings') {
      const side = lbw.onField === 'out' ? 'bat' : 'bowl';
      const team = side === 'bat' ? e.innings.battingTeam : e.innings.bowlingTeam;
      const left = e.reviewsLeft(side);
      if (left > 0) {
        if (team === this.userTeamId && !this.auto) return this.offerReview(res, lbw, side, left);
        if (aiWantsReview(lbw, left, this.rng)) return this.startReview(res, lbw, side);
      }
    }
    this.recordBall(res);
  }

  offerReview(res, lbw, side, left) {
    this.reviewing = true;
    this.state = 'overlay';
    const secs = 7;
    const decide = (review) => {
      clearTimeout(this.reviewTimer);
      if (this.state !== 'overlay' || !this.reviewing) return;
      hideOverlay(this.overlay);
      if (review) this.startReview(res, lbw, side);
      else { this.reviewing = false; this.recordBall(res); }
    };
    renderOverlay(this.overlay, reviewPromptHTML({ onField: lbw.onField, side, left, seconds: secs }), act => decide(act === 'review'));
    this.reviewTimer = setTimeout(() => decide(false), secs * 1000);
  }

  startReview(res, lbw, side) {
    const e = this.engine;
    const team = e.team(side === 'bat' ? e.innings.battingTeam : e.innings.bowlingTeam);
    const verdict = reviewVerdict(lbw.track, lbw.onField);
    this.reviewing = true;
    this.review = { res, lbw, side, team, verdict, phase: 'intro', t: 0, rows: [], plan: this.sim.plan, striker: e.innings.striker };
    this.state = 'review';
    this.hud.hideBanner(); this.hud.timing(null); this.hud.prompt(null); this.hud.meter(null);
    this.app.sound.crowd(0.55);
    toast(`<b>${esc(team.name)}</b> ${side === 'bat' ? 'review the LBW' : 'review for LBW'}`, 2000);
    this.drawReview();
  }

  drawReview() {
    const R = this.review;
    this.hud.drs({
      head: `DRS · ${R.team.short} REVIEW`,
      sub: `On-field decision: ${R.lbw.onField === 'out' ? 'OUT' : 'NOT OUT'} · LBW`,
      rows: R.rows,
      final: R.final || null,
    });
  }

  /** Reveal a tracking row (pitching / impact / wickets) once. */
  reviewRow(kind) {
    const R = this.review;
    if (R.rows.some(r => r.kind === kind)) return;
    const tr = R.lbw.track, v = tr[kind];
    let value = VERDICT_TEXT[kind][v];
    if (kind === 'impact' && tr.waived) value = 'OUTSIDE OFF · NO SHOT';
    R.rows.push({ kind, label: kind.toUpperCase(), value, tone: verdictTone(kind, v, tr) });
    this.app.sound.click(true);
    this.drawReview();
  }

  /**
   * The review plays out: the third umpire's replay up to the pad, then ball tracking (the real path, where it
   * pitched and hit the pad; then the projection on to the stumps), then the decision.
   */
  updateReview(dt) {
    const R = this.review, view = this.app.view, cams = this.app.cameras, input = this.input;
    input.setProfile('between');
    R.t += dt;
    const skip = input.pressed('continue');
    if (!this.reviewView) this.reviewView = new ReviewView(this.app.stadium.frame);
    const rv = this.reviewView;
    switch (R.phase) {
      case 'intro':
        view.update(dt);
        cams.set('cinematic', { kind: 'bowlerEnd' });
        if (R.t > 1.3 || skip) {
          const range = view.replayRange, M = view.replayMarks;
          const to = (M.padHit ?? R.lbw.t ?? range?.[1] ?? 0) + 0.35;
          const ok = range && view.startReplay({ segments: [{ from: range[0], to, speed: 0.45, kind: 'bowlerEnd', label: 'THIRD UMPIRE' }] });
          R.phase = ok ? 'replay' : 'track'; R.t = 0;
          if (!ok) this.beginTracking();
        }
        break;
      case 'replay':
        view.update(dt);
        cams.set('cinematic', { kind: 'bowlerEnd' });
        this.hud.replayTag('THIRD UMPIRE');
        this.camCtx = { frameYaw: this.app.stadium.frame.rotation.y, ball: view.replayBall || { x: 0, y: 1, z: 0 }, bowler: this.sim.bowler };
        if (view.replayDone || skip) { view.stopReplay(); this.hud.replayTag(null); R.phase = 'track'; R.t = 0; this.beginTracking(); }
        break;
      case 'track': {
        cams.set('cinematic', { kind: 'hawkEye' });
        const u = Math.min(1, R.t / 1.9);
        rv.setProgress(u, 0);
        if (rv.pitchFraction != null && u >= rv.pitchFraction) this.reviewRow('pitching');
        if (u >= 1) { if (!rv.pitchFraction) this.reviewRow('pitching'); this.reviewRow('impact'); }
        if (R.t > 2.6 || skip) { rv.setProgress(1, 0); this.reviewRow('pitching'); this.reviewRow('impact'); R.phase = 'project'; R.t = 0; cams.set('cinematic', { kind: 'hawkEyeStumps' }, true); }
        break;
      }
      case 'project': {
        cams.set('cinematic', { kind: 'hawkEyeStumps' });
        const u = Math.min(1, R.t / 1.1);
        rv.setProgress(1, u);
        if (u >= 1) this.reviewRow('wickets');
        if (R.t > 2.1 || skip) {
          rv.setProgress(1, 1); this.reviewRow('wickets');
          const v = R.verdict;
          R.final = { text: v.out ? 'OUT' : 'NOT OUT', tone: v.out ? 'out' : 'safe',
            sub: `${v.overturned ? 'Decision overturned' : v.umpiresCall ? "Umpire's call: the decision stands" : 'On-field decision stands'} · ${v.retained ? 'review retained' : 'review lost'}` };
          this.drawReview();
          if (v.out) this.app.sound.cheer(0.8); else this.app.sound.crowd(0.4);
          R.phase = 'decision'; R.t = 0;
        }
        break;
      }
      case 'decision':
        if (R.t > 3 || (skip && R.t > 0.5)) this.finishReview();
        break;
    }
  }

  beginTracking() {
    const R = this.review;
    this.app.view.stopReplay();
    this.app.view.setActorsVisible(false);
    this.app.stadium.resetStumps();
    if (!this.reviewView) this.reviewView = new ReviewView(this.app.stadium.frame);
    this.reviewView.show(R.lbw.track, R.plan);
    this.app.cameras.set('cinematic', { kind: 'hawkEye' }, true);
  }

  finishReview() {
    const R = this.review, sim = this.sim;
    this.reviewView?.clear();
    this.app.view.setActorsVisible(true);
    this.hud.drs(null);
    this.hud.replayTag(null);
    this.engine.useReview(R.side, { retained: R.verdict.retained });
    // the players and the umpire go with the final decision
    if (R.verdict.overturned) {
      sim.setAction(sim.strikerRunner, R.verdict.out ? 'out' : 'idle');
      sim.umpire.signal = R.verdict.out ? 'out' : 'notout';
      sim.setAction(sim.umpire, 'signal');
    }
    const res = applyVerdict(R.res, R.verdict, R.striker);
    this.review = null;
    this.reviewing = false;
    this.replayed = true;            // the review was the replay
    this.recordBall(res);
  }

  recordBall(res = this.sim.result()) {
    this.recorded = true;
    this.lastResult = res;
    if (!this.userBowling && this.sim.cpuSpec) this.lastSpecs = [...this.lastSpecs.slice(-4), this.sim.cpuSpec];
    const out = this.engine.recordBall(res);
    this.pendingEvents = out;
    this.showBallBanner(res);
    this.hud.updateScore(this.engine, res);
    this.updateScoreboard(res);
    this.app.saveMatch(this.engine);
    this.state = 'between';
    this.deadT = 0;
  }

  showBallBanner(r) {
    let main, kind = '';
    const extraLabel = r.extra === 'wide' ? 'WIDE' : r.extra === 'noball' ? 'NO BALL' : '';
    if (r.dismissal) { main = 'OUT!'; kind = 'wicket'; }
    else if (r.boundary === 6) { main = 'SIX!'; kind = 'six'; }
    else if (r.boundary === 4) { main = r.runType === 'bat' ? 'FOUR!' : `4 ${r.runType === 'legbye' ? 'LEG BYES' : 'BYES'}`; kind = 'four'; }
    else if (extraLabel) { main = extraLabel + (r.runs ? ` +${r.runs}` : ''); kind = 'x'; }
    else if (r.runs) main = r.runType === 'bat' ? `${r.runs} RUN${r.runs > 1 ? 'S' : ''}` : `${r.runs} ${r.runType === 'legbye' ? 'LEG BYE' : 'BYE'}${r.runs > 1 ? 'S' : ''}`;
    else main = 'DOT BALL';
    const sub = [r.desc && !/^(SIX|FOUR)!/.test(r.desc) ? r.desc : (r.shot || ''), r.extra === 'noball' && !r.dismissal ? 'Free hit next ball' : ''].filter(Boolean).join(' · ');
    this.hud.banner(main, esc(sub), kind);
  }

  updateScoreboard(r) {
    const e = this.engine, inn = e.innings || e.state.innings[e.state.innings.length - 1];
    const bat = e.team(inn.battingTeam);
    const s = inn.batters[inn.striker], n = inn.batters[inn.nonStriker];
    this.app.stadium.updateScoreboard({
      bat, runs: inn.runs, wickets: inn.wickets, overs: `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`,
      crr: (inn.legalBalls ? inn.runs * 6 / inn.legalBalls : 0).toFixed(2),
      line1: inn.striker && s ? `${e.player(inn.striker).name}  ${s.runs} (${s.balls})` : '',
      line2: inn.nonStriker && n ? `${e.player(inn.nonStriker).name}  ${n.runs} (${n.balls})` : '',
      footer: inn.target != null ? `TARGET ${inn.target} · NEED ${Math.max(0, inn.target - inn.runs)}` : r?.highlight ? { six: 'SIX!', four: 'FOUR!', wicket: 'WICKET!' }[r.highlight]
        : e.isTest && e.phase === 'innings' ? (() => { const l = e.situation().lead; return `DAY ${e.state.test.day} · ${l > 0 ? `LEAD ${l}` : l < 0 ? `TRAIL ${-l}` : 'LEVEL'}`; })() : '',
      highlight: r?.highlight === 'wicket',
    });
  }

  afterBall() {
    // A replay watched from the result screen returns there instead of bowling on.
    if (this.afterReplay) { const f = this.afterReplay; this.afterReplay = null; f(); return; }
    const ev = this.pendingEvents;
    this.pendingEvents = null;
    this.hud.hideBanner();
    const e = this.engine;
    let stumps = ev?.stumps && !ev.stumps.final ? ev.stumps : null;
    if (e.isTest && e.phase === 'innings' && !stumps) {
      // The computer captain may declare at the end of an over.
      if (this.cpuCaptains(e.innings.battingTeam) && aiShouldDeclare(e)) {
        const inn = e.innings, name = e.battingTeam.name;
        const out = e.declare();
        toast(`<b>${esc(name)} declare</b> at ${inn.runs}/${inn.wickets}`, 3200);
        this.app.saveMatch(e);
        if (out.stumps && !out.stumps.final) stumps = out.stumps;
      } else if (ev?.events.some(x => x.type === 'newBall')) toast('<b>New ball</b> taken', 2000);
      const sit = e.phase === 'innings' ? e.situation() : null;
      if (sit && this.lastSession && sit.session !== this.lastSession && sit.session > 1) {
        toast(`${sit.session === 2 ? 'Lunch' : 'Tea'}, Day ${sit.day}: ${esc(e.battingTeam.short)} ${sit.runs}/${sit.wickets}`, 2600);
      }
      this.lastSession = sit?.session ?? null;
    } else if (ev?.events.some(x => x.type === 'overComplete') && !ev.inningsComplete && !e.isTest) {
      const inn = e.innings;
      const last = inn.overs[inn.overs.length - 1];
      toast(`End of over ${inn.overs.length}: ${last.runs} run${last.runs === 1 ? '' : 's'} · ${e.battingTeam.short} ${inn.runs}/${inn.wickets}`, 2200);
    }
    if (stumps) return this.showStumps(stumps.day);
    this.nextBall();
  }

  /**
   * TV-style replay of the last ball: the delivery from behind the bowler, then a slow-motion second angle
   * on what mattered (stump cam for bowled, side-on for LBW, following the ball for catches and boundaries,
   * side-on at the crease for run-outs and stumpings).
   */
  replayPlan(r = this.lastResult) {
    const v = this.app.view;
    const range = v.replayRange;
    if (!range) return [];
    const [first, last] = range;
    const M = v.replayMarks, d = r?.dismissal?.type;
    const contact = M.contact ?? M.padHit ?? M.bodyHit ?? M.keeperCollect ?? last;
    const lead = { from: first, speed: 0.6, kind: 'bowlerEnd', label: 'REPLAY' };
    if (d === 'bowled' || d === 'lbw' || d === 'hitwicket') {
      const at = d === 'lbw' ? (M.padHit ?? contact) : (M.stumpsHit ?? M.wicket ?? last);
      return [{ ...lead, to: at + 0.6 }, { from: at - 0.9, to: at + 1.1, speed: 0.28, kind: d === 'lbw' ? 'sideOnLow' : 'stumpSide', label: 'SUPER SLOW-MO' }];
    }
    if (d === 'caught') {
      const c = M.catch ?? M.wicket ?? last;
      return [{ ...lead, to: Math.min(c, contact + 0.7) }, { from: contact - 0.05, to: c + 0.9, speed: 0.5, kind: 'ballCam', label: 'THE CATCH' }];
    }
    if (d === 'runout' || d === 'stumped') {
      const at = M.stumpsHit ?? M.wicket ?? last;
      return [{ ...lead, to: Math.min(at, contact + 0.8) }, { from: at - 1.4, to: at + 0.8, speed: 0.35, kind: 'creaseCam', end: r.dismissal.end || 'striker', label: d === 'stumped' ? 'STUMPING' : 'RUN OUT' }];
    }
    if (r?.boundary) {
      const b = M.boundary ?? last;
      return [{ ...lead, to: contact + 0.7 }, { from: contact - 0.05, to: b + 0.4, speed: 0.7, kind: 'ballCam', label: r.boundary === 6 ? 'SIX' : 'FOUR' }];
    }
    return [{ ...lead, to: last }];
  }

  startReplay() {
    const segs = this.replayPlan();
    const dur = this.app.view.startReplay({ segments: segs });
    if (!dur) return;
    this.state = 'replay';
    this.replaySegIdx = 0;
    this.hud.show('.banner', false);
    this.app.cameras.set('cinematic', { kind: segs[0].kind, end: segs[0].end }, true);
  }

  // ------------------------------------------------------------------ HUD
  updateHUD() {
    const sim = this.sim, input = this.input, hud = this.hud;
    if (!sim) return;
    if (this.timingShownAt >= 0 && sim.t - this.timingShownAt > 2.2) { hud.timing(null); this.timingShownAt = -1; }
    hud.autoBadge(this.auto && this.state !== 'replay' && this.state !== 'review');
    this.app.hudRoot.classList.toggle('no-hints', this.settings.hints === 'off');
    const inn = this.engine.innings;
    if (inn) {
      const dots = n => '●'.repeat(n) + '○'.repeat(Math.max(0, 3 - n));
      const bat = this.engine.battingTeam, bowl = this.engine.bowlingTeam;
      hud.drsCount(`<b>DRS</b>${esc(bat.short)} <i>${dots(this.engine.reviewsLeft('bat'))}</i> · ${esc(bowl.short)} <i>${dots(this.engine.reviewsLeft('bowl'))}</i>`);
    }
    if (this.state === 'review') { hud.meter(null); hud.prompt(null); hud.hints(input, 'between', [['continue', 'Skip to the decision'], ['pause', 'Pause']]); return; }
    // Field chart turned to match the player's camera: from the bowler's end the striker is at the top.
    const view = this.userBatting ? this.app.cameras.battingView : this.app.cameras.bowlingView;
    hud.fieldMap(sim, viewEnd(view) === 'bowler' ? 1 : -1, FIELD_PRESETS[sim.fieldPreset]?.label);
    if (this.state === 'between' || this.state === 'replay') {
      hud.meter(null);
      hud.prompt(null);
      hud.hints(input, 'between', this.state === 'replay' ? [['continue', 'Skip replay']] : [['continue', 'Next ball'], ['replay', 'Replay'], ['pause', 'Pause']]);
      return;
    }
    if (!this.humanBall) {
      hud.meter(null);
      hud.prompt(null);
      hud.hints(input, this.userBatting ? 'batting' : 'bowling', this.auto ? [['pause', 'Take control'], ['camera', 'Camera']] : [['camera', 'Camera']]);
      return;
    }
    if (this.userBowling) {
      const t = this.types?.[this.typeIndex];
      const sp = sim.spec;
      hud.meter(sim.phase === 'ready' || sim.phase === 'runup' ? sim : null, t ? t.label : '', Math.max(sim.power, input.value('power')),
        { speed: sp.speedKph, length: lengthDef(sp.length).label, canFaster: sp.speedKph < sim.speedOptions[0], canSlower: sp.speedKph > sim.speedOptions[sim.speedOptions.length - 1] });
      if (sim.awaitThrow) return;
      if (sim.phase === 'ready') hud.hints(input, 'bowling', [['bowl', 'Hold to bowl'], ['speedUp', 'Faster'], ['speedDown', 'Slower'], ['lengthNext', 'Length'], ['typeNext', 'Variation'], ['power', 'Effort']]);
      else if (sim.phase === 'runup') hud.hints(input, 'bowling', [['bowl', 'Release on green'], ['power', 'Extra pace']]);
      else hud.hints(input, 'bowling', []);
      hud.prompt(null);
    } else if (this.userBatting) {
      hud.meter(null);
      if (sim.phase === 'inplay') {
        const rs = sim.runState;
        hud.hints(input, 'batting', [['run', rs === 'running' ? 'Another run' : 'Run'], ['cancelRun', 'Send back'], ['sprint', 'Sprint'], ['dive', 'Dive']], 'Running');
        const running = rs === 'running' || rs === 'returning';
        if ((sim.control.running === 'user' || sim.holdRuns) && sim.ball.state !== 'held') hud.prompt(`${rs === 'running' ? `Running… ${sim.runsCompleted} done` : rs === 'returning' ? 'Get back!' : sim.runsCompleted ? `${sim.runsCompleted} run${sim.runsCompleted > 1 ? 's' : ''} — go again?` : 'Run?'} ${this.glyphs(running ? [['sprint', 'Sprint'], ['dive', 'Dive'], ['cancelRun', 'Back']] : [['run', 'Run'], ['cancelRun', 'Back']], 'batting')}`);
        else hud.prompt(null);
      } else {
        hud.prompt(null);
        hud.hints(input, 'batting', SHOT_HINTS);
      }
    }
  }

  // ------------------------------------------------------------------ overlays
  overlayNav() {
    const input = this.input;
    input.setProfile('paused');
    const root = this.overlay;
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

  showPause() {
    renderOverlay(this.overlay, pauseHTML(this.engine, { auto: this.auto, userBowling: this.userBowling }), (act) => {
      if (act === 'resume') this.resume();
      else if (act === 'autoplay') { this.resume(); this.setAutoPlay(!this.auto); }
      else if (act === 'skip') this.showSkip();
      else if (act === 'declare') this.declareInnings();
      else if (act === 'scorecard') renderOverlay(this.overlay, `<h2>Scorecard</h2><div class="sc-scroll">${scorecardHTML(this.engine)}</div><div class="ov-actions"><button class="btn primary" data-ov="back">Back</button></div>`, () => this.showPause());
      else if (act === 'controls') renderOverlay(this.overlay, this.app.controlsSummaryHTML(), () => this.showPause());
      else if (act === 'settings') this.showSettings();
      else if (act === 'quit') { this.app.saveMatch(this.engine); this.app.exitMatch(); }
    });
  }

  showSettings() {
    renderOverlay(this.overlay, settingsHTML(this.settings, BATTING_VIEWS, BOWLING_VIEWS), (act) => { if (act === 'back') this.showPause(); });
    this.overlay.onchange = this.overlay.oninput = (e) => {
      const key = e.target.dataset.setting;
      if (!key) return;
      const v = e.target.value;
      this.settings[key] = key === 'volume' ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
      if (key === 'battingCamera' || key === 'bowlingCamera') this.app.cameras.setViews(this.settings.battingCamera, this.settings.bowlingCamera);
      if (key === 'aimMarker') this.app.view.aim.userHidden = !this.settings.aimMarker;
      if (key === 'assistRunning' && this.sim && this.sim.control.running !== 'skip' && this.userBatting) this.sim.control.running = this.settings.assistRunning ? 'ai' : 'user';
      this.app.saveSettings();
    };
  }

  resume() {
    this.overlay.onchange = this.overlay.oninput = null;
    hideOverlay(this.overlay);
    this.state = this.prevState || 'ball';
    this.input.setProfile('menu');
  }

  showBowlerSelect() {
    const e = this.engine;
    const suggested = chooseBowler({ engine: e, eligible: e.eligibleBowlers(), rng: new RNG(e.state.ballsBowled + 7) });
    this.state = 'overlay';
    renderOverlay(this.overlay, bowlerSelectHTML(e, suggested, this.userFieldPreset), (act, btn) => {
      if (act === 'autoBowl') { hideOverlay(this.overlay); this.setAutoPlay(true); this.nextBall(); return; }
      if (act === 'captain') {
        const fp = this.overlay.querySelector('#fieldPreset');
        if (fp) this.userFieldPreset = fp.value;
        this.captainPicks = true;
        e.setBowler(suggested);
        hideOverlay(this.overlay);
        toast('The captain picks your bowlers for the rest of this innings (you still bowl)', 2800);
        this.setupBall();
        return;
      }
      if (act === 'skip') {
        renderOverlay(this.overlay, skipHTML(e), (a) => { if (a === 'back') this.showBowlerSelect(); else this.skipChoice(a); });
        return;
      }
      if (act !== 'bowler') return;
      const fp = this.overlay.querySelector('#fieldPreset');
      if (fp) this.userFieldPreset = fp.value;
      e.setBowler(btn.dataset.id);
      hideOverlay(this.overlay);
      this.setupBall();
    });
  }

  /** The player declares (Tests). The ball in progress, if any, is abandoned. */
  declareInnings() {
    const e = this.engine;
    this.overlay.onchange = this.overlay.oninput = null;
    hideOverlay(this.overlay);
    this.app.view.stopReplay();
    const inn = e.innings;
    const out = e.declare();
    toast(`<b>${esc(e.team(inn.battingTeam).name)} declare</b> at ${inn.runs}/${inn.wickets}`, 3200);
    this.app.saveMatch(e);
    this.pendingEvents = null;
    if (out.stumps && !out.stumps.final) return this.showStumps(out.stumps.day);
    this.nextBall();
  }

  /** Stumps at the end of a day in a Test. */
  showStumps(day) {
    const e = this.engine;
    this.state = 'overlay';
    this.app.view.stopReplay();
    this.app.saveMatch(e);
    this.updateScoreboard(null);
    this.app.stadium.updateScoreboard({ title: `STUMPS · DAY ${day}`, subtitle: `${e.state.teams[0].short} v ${e.state.teams[1].short}` });
    this.lastSession = null;
    renderOverlay(this.overlay, stumpsHTML(e, day), (act) => {
      if (act === 'nextDay') { hideOverlay(this.overlay); toast(`<b>Day ${e.state.test.day}</b>`, 1800); this.nextBall(); }
      else if (act === 'simDay') this.skipAhead({ title: `Simulating Day ${day + 1}`, stop: untilStumps(e), across: true, thenStumps: true });
      else if (act === 'result') this.skipAhead({ title: 'Simulating to the result', across: true });
      else if (act === 'scorecard') renderOverlay(this.overlay, `<h2>Scorecard</h2><div class="sc-scroll">${scorecardHTML(e)}</div><div class="ov-actions"><button class="btn primary" data-ov="back">Back</button></div>`, () => this.showStumps(day));
      else if (act === 'quit') { this.app.saveMatch(e); this.app.exitMatch(); }
    });
  }

  /** Test innings break: the follow-on choice (when there is one), then who bats next. */
  showTestBreak(followOn = null) {
    const e = this.engine, opt = e.state.test.followOnOption;
    if (opt && !e.team(opt.team).isUser && followOn == null) followOn = aiEnforceFollowOn(e);
    renderOverlay(this.overlay, testBreakHTML(e, { followOn }), (act) => {
      if (act === 'enforce' || act === 'batAgain') { this.showTestBreak(act === 'enforce'); return; }
      if (!['next', 'watch', 'simInnings', 'result'].includes(act)) return;
      e.beginNextInnings({ followOn: !!followOn });
      if (e.state.test.followOn && e.inningsIndex === 2) toast(`<b>Follow-on</b>: ${esc(e.battingTeam.name)} bat again`, 2600);
      this.app.saveMatch(e);
      this.lastResult = null;
      if (act === 'next' || act === 'watch') {
        hideOverlay(this.overlay);
        if (act === 'watch') this.setAutoPlay(true);
        this.nextBall();
      } else if (act === 'simInnings') this.skipAhead({ title: 'Simulating the innings' });
      else this.skipAhead({ title: 'Simulating to the result', across: true });
    });
  }

  showInningsBreak() {
    this.state = 'overlay';
    this.auto = false;   // the chase starts under the player's control unless they pick otherwise
    this.captainPicks = false;
    this.app.sound.crowd(0.3);
    if (this.engine.isTest) return this.showTestBreak();
    renderOverlay(this.overlay, inningsBreakHTML(this.engine), (act) => {
      if (!['second', 'watch', 'finalPlay', 'finalWatch', 'result'].includes(act)) return;
      this.engine.beginSecondInnings();
      this.app.saveMatch(this.engine);
      this.lastResult = null;
      if (act === 'second' || act === 'watch') {
        hideOverlay(this.overlay);
        if (act === 'watch') this.setAutoPlay(true);
        this.nextBall();
      } else this.skipChoice(act);
    });
  }

  // ------------------------------------------------------------------ auto-play and skipping ahead
  /** Auto-play: the AI bats or bowls for the human. A delivery that hasn't started yet is set up again at once. */
  setAutoPlay(on) {
    this.auto = on;
    const role = this.engine.innings?.bowlingTeam === this.userTeamId ? 'bowls' : 'bats';
    toast(on ? `Auto-play on: the AI ${role} for you. Pause to take back control.` : 'Auto-play off: you have control', 2800);
    if (this.state === 'ball' && this.sim?.phase === 'ready') {
      if (!on && this.engine.innings?.bowlingTeam === this.userTeamId) this.typeIndex = 0;
      this.setupBall();
    }
  }

  showSkip() {
    renderOverlay(this.overlay, skipHTML(this.engine), (act) => {
      if (act === 'back') this.showPause();
      else this.skipChoice(act);
    });
  }

  /** innings: finish this innings · result: to the end of the match · finalWatch/finalPlay: to the finish of a chase. */
  skipChoice(act) {
    const e = this.engine;
    if (e.isTest) {
      if (act === 'stumps') this.skipAhead({ title: 'Simulating to stumps', stop: untilStumps(e), across: true, thenStumps: true });
      else if (act === 'innings') this.skipAhead({ title: 'Simulating the innings' });
      else if (act === 'result') this.skipAhead({ title: 'Simulating to the result', across: true });
      return;
    }
    const chase = this.engine.innings?.target != null;
    if (act === 'innings') this.skipAhead({ title: 'Simulating the innings' });
    else if (act === 'result') this.skipAhead({ title: chase ? 'Simulating the chase' : 'Simulating the match' });
    else if (act === 'finalWatch' || act === 'finalPlay') this.skipAhead({ title: 'Skipping to the final overs', stop: chaseFinishReached, watch: act === 'finalWatch' });
  }

  /**
   * Simulate ahead with the AI on both sides, a few balls per frame so the score visibly ticks over.
   * Stops at the end of the innings or when stop(engine) says so, then carries on: innings break,
   * result, or live play (watched under auto-play if `watch`). "Stop here and play" hands back control.
   */
  skipAhead({ title, stop = null, watch = false, across = false, thenStumps = false }) {
    const e = this.engine;
    this.app.view.stopReplay();
    this.pendingEvents = null;
    this.afterReplay = null;
    this.hud.hideBanner(); this.hud.prompt(null); this.hud.timing(null); this.hud.meter(null); this.hud.autoBadge(false);
    this.overlay.onchange = this.overlay.oninput = null;
    this.state = 'overlay';
    const run = { stopped: false };
    this.simulating = run;
    renderOverlay(this.overlay, simulatingHTML(title), (act) => { if (act === 'simStop') run.stopped = true; });
    updateSimulating(this.overlay, e);
    const halt = eng => run.stopped || (stop ? stop(eng) : false);
    // About 20 ms a ball (a 20-over innings takes ~2.5 s), then the final score holds for a moment.
    // Tests are long: simulate a batch of balls per tick (about 1 ms each) so a whole day takes a moment.
    const batch = e.isTest ? 30 : 1;
    const tick = () => {
      if (this.simulating !== run || this.app.match !== this) return;   // quit or superseded meanwhile
      const r = across ? simulateAcross(e, this.rng, { stop: halt, maxBalls: batch }) : simulateBalls(e, this.rng, { stop: halt, maxBalls: batch });
      updateSimulating(this.overlay, e);
      const done = (across ? r.matchOver : r.inningsOver) || r.balls < batch;
      if (done) setTimeout(() => { if (this.simulating === run) this.finishSkip(watch && !run.stopped, thenStumps && !run.stopped); }, r.balls || run.stopped ? 700 : 0);
      else setTimeout(tick, e.isTest ? 0 : 20);
    };
    setTimeout(tick, 150);
  }

  finishSkip(watch, atStumps = false) {
    const e = this.engine;
    this.simulating = null;
    this.lastResult = null;
    this.app.saveMatch(e);
    this.updateScoreboard(null);
    if (e.phase === 'complete') return this.showResult();
    if (atStumps && e.isTest) return this.showStumps(e.state.test.day - 1);
    if (e.phase === 'break') return this.showInningsBreak();
    hideOverlay(this.overlay);
    this.hud.updateScore(e, null);
    this.auto = !!watch;
    this.nextBall();
    const s = e.situation();
    const need = e.isTest ? `Day ${s.day}: ${esc(e.battingTeam.short)} ${s.runs}/${s.wickets} (${s.overs} ov)`
      : s.target != null ? `Final overs: ${esc(e.battingTeam.short)} need <b>${s.need}</b> from <b>${s.ballsLeft}</b> ball${s.ballsLeft === 1 ? '' : 's'}` : `${esc(e.battingTeam.short)} ${s.runs}/${s.wickets} (${s.overs} ov)`;
    toast(`${need}${watch ? ' · auto-play (pause to take control)' : ''}`, 3800);
  }

  showResult() {
    this.state = 'overlay';
    const r = this.engine.state.result;
    const userWon = r.winner && this.engine.team(r.winner).isUser;
    if (userWon) { this.app.sound.cheer(1); this.app.stadium.cheer(1); }
    this.app.clearSavedMatch();
    this.app.stadium.updateScoreboard({ title: r.type === 'tie' ? 'MATCH TIED' : `${this.engine.team(r.winner).short} WIN`, subtitle: r.text });
    renderOverlay(this.overlay, resultHTML(this.engine), (act) => {
      if (act === 'rematch') this.app.rematch();
      else if (act === 'menu') this.app.exitMatch();
      else if (act === 'replay' && this.app.view.hasReplay()) {
        hideOverlay(this.overlay);
        this.state = 'between';
        this.replayed = false;
        this.pendingEvents = null;
        this.startReplay();
        this.afterReplay = () => this.showResult();
      }
    });
  }

}

export { END_NAMES, PITCH };
