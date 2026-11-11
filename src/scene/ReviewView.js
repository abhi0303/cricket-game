// Ball tracking for a DRS review, drawn in the delivery frame like the TV graphic: the stump-line corridor
// down the pitch, the ball's real path to the pad (red), where it pitched and where it hit the pad, the
// projected path on to the stumps (blue), the wicket zone and the ball where it would have arrived.
import * as THREE from 'three';
import { PITCH, BALL_R } from '../game/BallPhysics.js';
import { ZONE } from '../game/DRS.js';

const TONE = { out: '#e84a3c', call: '#f2a32c', safe: '#3ccf7a' };
const toneOf = (kind, v, track) => {
  if (v === 'umpiresCall') return TONE.call;
  if (kind === 'pitching') return v === 'outsideLeg' ? TONE.safe : TONE.out;
  if (kind === 'impact') return v === 'inLine' || track.waived ? TONE.out : TONE.safe;
  return v === 'hitting' ? TONE.out : TONE.safe;
};

function tube(points, color, opacity) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p.x, p.y, p.z)));
  const segs = Math.max(8, points.length * 2);
  const geo = new THREE.TubeGeometry(curve, segs, BALL_R * 1.05, 10, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  mesh.renderOrder = 5;
  mesh.userData.total = geo.index.count;
  geo.setDrawRange(0, 0);
  return mesh;
}

export class ReviewView {
  constructor(frame) {
    this.frame = frame;
    this.group = new THREE.Group();
    this.group.name = 'ballTracking';
    this.group.visible = false;
    frame.add(this.group);
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse(c => { c.geometry?.dispose(); c.material?.dispose?.(); });
    }
    this.group.visible = false;
  }

  /** Build the graphic for a tracked LBW (see DRS.lbwTrack) from the delivery plan. Nothing shows until setProgress(). */
  show(track, plan) {
    this.clear();
    this.track = track;
    const Z = ZONE.half, H = ZONE.height, half = PITCH.half;
    const g = this.group;
    // the corridor between the stump lines, down the length of the pitch
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(2 * Z, 2 * half).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#57a6ff', transparent: true, opacity: 0.22, depthWrite: false }));
    lane.position.set(0, 0.016, 0);
    g.add(lane);
    for (const x of [-Z, Z]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 2 * half).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.7, depthWrite: false }));
      edge.position.set(x, 0.017, 0);
      g.add(edge);
    }
    // the ball's path: release to the pad (real), then the pad to the stumps (projected)
    const P = plan.path;
    const tImpact = P.timeAtZ(track.impactPoint.z) ?? P.duration;
    const tStumps = P.timeAtZ(half) ?? P.duration;
    const sample = (t0, t1, n) => Array.from({ length: n + 1 }, (_, i) => P.at(t0 + (t1 - t0) * i / n).p);
    const real = sample(0, tImpact, 48);
    real[real.length - 1] = { ...track.impactPoint };
    const proj = sample(tImpact, Math.max(tImpact + 0.01, tStumps), 16);
    proj[0] = { ...track.impactPoint };
    this.real = tube(real, '#e2382f', 0.9);
    this.proj = tube(proj, '#3f9cff', 0.8);
    g.add(this.real, this.proj);
    this.times = { impact: tImpact, stumps: tStumps, pitch: track.bounce?.t ?? null };
    // pitching point
    if (track.bounce) {
      const ring = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.6, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: toneOf('pitching', track.pitching, track), transparent: true, opacity: 0.95, depthWrite: false }));
      ring.position.set(track.bounce.x, 0.02, track.bounce.z);
      ring.visible = false;
      this.pitchMark = ring;
      g.add(ring);
    }
    // impact on the pad
    const imp = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.5, 24), new THREE.MeshBasicMaterial({ color: toneOf('impact', track.impact, track), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    imp.position.set(track.impactPoint.x, track.impactPoint.y, track.impactPoint.z - 0.03);
    imp.visible = false;
    this.impactMark = imp;
    g.add(imp);
    // the wicket zone and the ball where it would have reached the stumps
    const zone = new THREE.Group();
    const zf = new THREE.Mesh(new THREE.PlaneGeometry(2 * Z, H), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    zf.position.set(0, H / 2, half - 0.05);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(2 * Z, H)), new THREE.LineBasicMaterial({ color: '#ffffff' }));
    outline.position.copy(zf.position);
    zone.add(zf, outline);
    zone.visible = false;
    this.zone = zone;
    g.add(zone);
    const at = track.at || proj[proj.length - 1];
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.15, 20, 14), new THREE.MeshBasicMaterial({ color: toneOf('wickets', track.wickets, track) }));
    ball.position.set(at.x, Math.max(BALL_R, at.y), half - 0.02);
    ball.visible = false;
    this.endBall = ball;
    g.add(ball);
    g.visible = true;
  }

  /**
   * Reveal the graphic: real path drawn 0..1 (with the pitching mark once passed and the impact mark at the end),
   * then the projection 0..1 (with the zone and the arriving ball at the end).
   */
  setProgress(real, proj) {
    if (!this.real) return;
    // the tube's triangles run along the path, 60 indices (10 sides x 6) per segment
    const reveal = (mesh, r) => mesh.geometry.setDrawRange(0, Math.round(Math.max(0, Math.min(1, r)) * mesh.userData.total / 60) * 60);
    reveal(this.real, real);
    reveal(this.proj, proj);
    if (this.pitchMark && this.times.pitch != null) this.pitchMark.visible = real * this.times.impact >= this.times.pitch;
    this.impactMark.visible = real >= 1;
    this.zone.visible = proj > 0;
    this.endBall.visible = proj >= 1;
  }

  /** How far through its flight the pitching point and impact are (0..1 of the real path). */
  get pitchFraction() { return this.times?.pitch != null ? this.times.pitch / this.times.impact : null; }
}
