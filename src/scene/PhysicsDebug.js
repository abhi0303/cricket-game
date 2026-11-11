// Developer-only bowling physics overlay. Enable with ?debug=physics (F8 toggles it).
// Shows the selected speed/length, measured timings and live velocities, and draws the
// planned trajectory, pitching point and hitting zone in the delivery frame.
import * as THREE from 'three';
import { PHYSICS } from '../game/PhysicsConfig.js';

const fmt = (v, d = 3, unit = 's') => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)} ${unit}`);

export class PhysicsDebug {
  constructor(stadium) {
    this.frame = stadium.frame;
    this.visible = true;
    this.plan = null;
    this.group = new THREE.Group();
    this.group.name = 'physicsDebug';
    this.frame.add(this.group);

    this.maxPts = 4000;
    this.positions = new Float32Array(this.maxPts * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setDrawRange(0, 0);
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ff3df2', depthTest: false, transparent: true }));
    this.line.frustumCulled = false;
    this.line.renderOrder = 10;
    this.group.add(this.line);

    const dot = (c, r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false })); m.renderOrder = 11; this.group.add(m); return m; };
    this.pitchDot = dot('#ff2b2b', 0.07);
    this.releaseDot = dot('#2bd4ff', 0.06);
    this.ballDot = dot('#ffffff', 0.045);

    const hz = PHYSICS.hittingZone;
    const box = new THREE.Box3(new THREE.Vector3(-1.2, 0, hz.zStart), new THREE.Vector3(1.2, 2.0, hz.zEnd));
    this.zone = new THREE.Box3Helper(box, new THREE.Color('#ffd166'));
    this.zone.material.depthTest = false;
    this.group.add(this.zone);

    this.panel = document.createElement('div');
    this.panel.id = 'physics-debug';
    this.panel.className = 'physics-debug';
    document.body.appendChild(this.panel);

    addEventListener('keydown', e => { if (e.code === 'F8') { this.visible = !this.visible; this.apply(); } });
    this.apply();
  }

  apply() { this.group.visible = this.visible; this.panel.style.display = this.visible ? 'block' : 'none'; }

  setPlan(plan) {
    this.plan = plan;
    const P = plan.path;
    let n = 0;
    for (let i = 0; i < P.p.length && n < this.maxPts; i++) {
      const p = P.p[i];
      if (p.z > PHYSICS.pitch.half + 2.5) break;
      this.positions.set([p.x, p.y, p.z], n * 3);
      n++;
    }
    this.line.geometry.setDrawRange(0, n);
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    this.releaseDot.position.set(plan.release.x, plan.release.y, plan.release.z);
    this.pitchDot.visible = !!plan.bounce;
    if (plan.bounce) this.pitchDot.position.set(plan.bounce.x, PHYSICS.ballRadius, plan.bounce.z);
  }

  update(sim, realFps) {
    if (!this.visible) return;
    if (!sim) { this.panel.innerHTML = '<b>Bowling physics debug</b><br>No delivery in progress'; return; }
    const plan = sim.plan;
    if (plan && plan !== this.plan) this.setPlan(plan);
    this.line.visible = !!plan;
    const spec = sim.spec;
    const b = sim.ball;
    if (b?.p) this.ballDot.position.set(b.p.x, b.p.y, b.p.z);
    const v = b?.v || { x: 0, y: 0, z: 0 };
    const T = plan?.timing;
    const L = PHYSICS.lengths[plan?.lengthId || spec.length];
    const rows = [
      ['Selected speed', `${plan ? plan.speedKph : spec.speedKph} km/h (${((plan ? plan.speedKph : spec.speedKph) / 3.6).toFixed(2)} m/s)`],
      ['Delivery length', `${L?.label || '—'}${L?.range ? ` (${L.range[0]}–${L.range[1]} m)` : ''}`],
      ['Variation', plan ? plan.typeLabel : spec.type],
      ['Actual pitching', plan ? (plan.bounceLen != null ? `${plan.bounceLen.toFixed(2)} m from stumps, line ${plan.bounce.x.toFixed(2)} m` : 'no bounce (full toss)') : '—'],
      ['Release → pitch', fmt(T?.tPitch)],
      ['Pitch → stumps', fmt(T?.tPostPitch)],
      ['Reaction after bounce', T ? (T.pitchedInZone ? '0 (pitched inside hitting zone)' : fmt(T.reaction)) : '—'],
      ['Total travel (to stumps)', fmt(T?.tTotal)],
      ['Baseline 20.12 m / v', T ? `${fmt(T.baseline)} (Δ ${(T.tTotal - T.baseline >= 0 ? '+' : '')}${(T.tTotal - T.baseline).toFixed(3)} s)` : '—'],
      ['Horizontal velocity', `${Math.hypot(v.x, v.z).toFixed(2)} m/s (${(Math.hypot(v.x, v.z) * 3.6).toFixed(1)} km/h)`],
      ['Vertical velocity', `${v.y.toFixed(2)} m/s`],
      ['Bounce peak / at batter', T ? `${fmt(T.bouncePeak, 2, 'm')} / ${plan.path.timeAtZ(PHYSICS.batterZ) != null ? plan.path.at(plan.path.timeAtZ(PHYSICS.batterZ)).p.y.toFixed(2) + ' m' : '—'}` : '—'],
      ['Speed: release → pitch → stumps', T ? `${(T.releaseSpeed * 3.6).toFixed(1)} → ${T.impactSpeed ? (T.impactSpeed * 3.6).toFixed(1) + '/' + (T.exitSpeed * 3.6).toFixed(1) : '—'} → ${T.stumpsSpeed ? (T.stumpsSpeed * 3.6).toFixed(1) : '—'} km/h` : '—'],
      ['Phase / ball', `${sim.phase} / ${b?.state} · game time ×${sim.scale.toFixed(2)}`],
      ['Render', `${realFps.toFixed(0)} fps`],
    ];
    this.panel.innerHTML = `<b>Bowling physics debug</b> <small>(F8 hides)</small><table>${rows.map(([k, val]) => `<tr><td>${k}</td><td>${val}</td></tr>`).join('')}</table>`;
  }
}

export function physicsDebugEnabled() {
  try {
    if (new URLSearchParams(location.search).get('debug') === 'physics') return true;
    return localStorage.getItem('lpcricket.debug') === '"physics"';
  } catch { return false; }
}
