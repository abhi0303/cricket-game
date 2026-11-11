// Drives the Three.js camera from the pure camera poses, with smoothing and hard cuts.
import * as THREE from 'three';
import { battingCam, bowlingCam, followCam, cinematicCam, menuCam, toWorld, normalizeBattingView, normalizeBowlingView } from './CameraPoses.js';

export class CameraManager {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'menu';
    this.opts = {};
    this.pos = new THREE.Vector3(0, 30, 80);
    this.target = new THREE.Vector3(0, 0, 0);
    this.fov = 45;
    this.cutNext = true;
    this.t = 0;
    this.battingView = 'behind';
    this.bowlingView = 'behindBowler';
    this.look = { x: 0, y: 0 };   // right-stick nudge
  }

  setViews(batting, bowling) {
    this.battingView = normalizeBattingView(batting);
    this.bowlingView = normalizeBowlingView(bowling);
    this.cutNext = true;
  }

  /** Switch camera mode. cut = jump immediately instead of easing. */
  set(mode, opts = {}, cut = false) {
    if (mode !== this.mode || opts.kind !== this.opts.kind) this.modeT = 0;
    this.mode = mode;
    this.opts = opts;
    if (cut) this.cutNext = true;
  }

  desired(ctx) {
    const yaw = ctx.frameYaw || 0;
    let p;
    switch (this.mode) {
      case 'menu': return menuCam(this.t);
      case 'batting': p = battingCam(this.battingView); break;
      case 'bowling':
        p = this.bowlingView === 'batsmanEnd' ? battingCam('behindHigh')
          : bowlingCam(ctx.bowler || { x: 1.4, z: -26 }, this.opts.phase || 'runup', this.bowlingView === 'behindBowlerHigh' ? 'high' : 'standard');
        break;
      case 'follow': p = followCam(ctx.ball || { x: 0, y: 1, z: 0 }, this.opts.end || 'striker'); break;
      case 'cinematic': p = cinematicCam(this.opts.kind, { ...ctx, t: this.modeT, exit: this.opts.exit, end: this.opts.end }); break;
      default: p = battingCam();
    }
    const nudge = [this.look.x * 1.5, this.look.y * 0.8, 0];
    return { pos: toWorld([p.pos[0] + nudge[0], p.pos[1] + nudge[1], p.pos[2]], yaw), target: toWorld(p.target, yaw), fov: p.fov };
  }

  update(dt, ctx = {}) {
    this.t += dt;
    this.modeT = (this.modeT || 0) + dt;
    const d = this.desired(ctx);
    const rate = this.mode === 'menu' ? 2 : this.mode === 'follow' ? 3.2 : this.mode === 'bowling' ? 7 : this.mode === 'cinematic' ? (this.opts.kind === 'boundary' ? 4 : 8) : 6;
    const k = this.cutNext ? 1 : 1 - Math.exp(-rate * dt);
    this.pos.lerp(_v.set(...d.pos), k);
    this.target.lerp(_v.set(...d.target), this.cutNext ? 1 : 1 - Math.exp(-(rate * 1.6) * dt));
    this.fov += (d.fov - this.fov) * k;
    this.cutNext = false;
    this.camera.position.copy(this.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.25;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.25;
    }
    this.camera.lookAt(this.target);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }
}

const _v = new THREE.Vector3();
