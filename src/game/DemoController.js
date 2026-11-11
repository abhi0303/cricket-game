// "Attract mode" behind the main menu: two computer teams playing deliveries
// in the real simulation, shown with a slow orbiting or broadcast camera.

import { MatchEngine } from './MatchEngine.js';
import { generateCpuTeam } from './TeamManager.js';
import { ensureBowler, buildDeliverySim } from './MatchSim.js';
import { RNG } from '../utils/Random.js';

export class DemoController {
  constructor({ stadium, view, cameras }) {
    this.stadium = stadium;
    this.view = view;
    this.cameras = cameras;
    this.rng = new RNG(20261101);
    this.active = false;
    this.camMode = 'menu';
  }

  start(camMode = 'menu') {
    this.active = true;
    this.camMode = camMode;
    const a = generateCpuTeam(this.rng, { difficulty: 'hard' });
    const b = generateCpuTeam(this.rng, { difficulty: 'hard', avoidName: a.name });
    this.engine = new MatchEngine({ teams: [a, b], config: { overs: 20, difficulty: 'normal' }, toss: { winner: a.id, decision: 'bat' } });
    this.overCount = 0;
    this.nextBall();
    this.cameras.set(camMode, {}, true);
  }

  stop() {
    this.active = false;
    this.sim = null;
    this.view.hideAll();
    this.view.sim = null;
  }

  nextBall() {
    const e = this.engine;
    if (e.phase === 'break') e.beginSecondInnings();
    if (e.phase === 'complete') { this.start(this.camMode); return; }
    if (e.needsBowler()) { this.overCount++; ensureBowler(e, this.rng); }
    this.stadium.setEnds(this.overCount % 2);
    this.sim = buildDeliverySim(e, { rng: this.rng });
    this.view.bind(this.sim, { battingTeam: e.battingTeam, bowlingTeam: e.bowlingTeam });
    this.deadTimer = 0;
  }

  update(dt) {
    if (!this.active || !this.sim) return;
    this.sim.update(dt);
    for (const ev of this.sim.drainEvents()) {
      this.view.onEvent(ev);
      if (ev.type === 'boundary' || ev.type === 'wicket') this.stadium.cheer(1);
    }
    this.view.update(dt);
    if (this.camMode !== 'menu') {
      const sim = this.sim;
      if (sim.phase === 'inplay' || (sim.phase === 'dead' && sim.contactMade)) this.cameras.set('follow');
      else this.cameras.set('bowling', { phase: 'runup' });
    }
    if (this.sim.phase === 'dead') {
      this.deadTimer += dt;
      if (this.deadTimer > 2.2) {
        this.engine.recordBall(this.sim.result());
        this.nextBall();
      }
    }
  }

  cameraContext() {
    const sim = this.sim;
    return { frameYaw: this.stadium.frame.rotation.y, bowler: sim?.bowler, ball: sim?.ball?.p };
  }
}
