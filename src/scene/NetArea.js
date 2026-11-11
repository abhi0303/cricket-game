// The practice net lane: green netting on both sides, behind the striker and over the batting half,
// on metal poles, with a synthetic-turf apron. Built in the delivery frame from the same dimensions
// the nets simulation uses, so the ball stops exactly on the netting you see.
import * as THREE from 'three';
import { GeoBuilder, lambert } from './GeoBuilder.js';
import { NET } from '../game/NetsSim.js';

const CELL = 0.14;   // size of one mesh square (m)

/** Diamond netting: transparent canvas with green twine and a faint green tint so it reads from afar. */
function netTexture(renderer) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(30, 120, 52, 0.10)';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(38, 150, 66, 0.95)';
  g.lineWidth = 4;
  g.beginPath();
  for (const o of [-S, 0, S]) {
    g.moveTo(o, 0); g.lineTo(o + S, S);
    g.moveTo(o + S, 0); g.lineTo(o, S);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
  return tex;
}

/** A w × h panel whose texture repeats every CELL metres (so every panel shares one material). */
function panel(w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / CELL, uv.getY(i) * h / CELL);
  return g;
}

export class NetArea {
  constructor(renderer) {
    this.group = new THREE.Group();
    this.group.name = 'nets';
    this.group.visible = false;
    const { halfW: W, backZ, frontZ, height: H, roofFrom } = NET;
    const len = backZ - frontZ;

    // Netting
    const mat = new THREE.MeshLambertMaterial({ map: netTexture(renderer), transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const add = (geo, pos, rot) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      m.rotation.set(...rot);
      m.renderOrder = 2;
      this.group.add(m);
    };
    for (const s of [-1, 1]) add(panel(len, H), [s * W, H / 2, (frontZ + backZ) / 2], [0, Math.PI / 2, 0]);
    add(panel(2 * W, H), [0, H / 2, backZ], [0, 0, 0]);
    add(panel(2 * W, backZ - roofFrom), [0, H, (roofFrom + backZ) / 2], [-Math.PI / 2, 0, 0]);

    // Poles, top rails and the weighted bottom edge of the netting
    const gb = new GeoBuilder();
    const metal = '#3a4a3f', rope = '#1f5a2c';
    const poles = [backZ, 12, 8, 4, roofFrom, -2, frontZ];
    for (const s of [-1, 1]) {
      for (const z of poles) gb.cyl(0.035, 0.045, H + 0.12, 6, metal, [s * (W + 0.04), (H + 0.12) / 2, z]);
      gb.box(0.05, 0.05, len, metal, [s * (W + 0.04), H, (frontZ + backZ) / 2]);
      gb.box(0.07, 0.04, len, rope, [s * W, 0.02, (frontZ + backZ) / 2]);
    }
    for (const z of poles.filter(z => z >= roofFrom)) gb.box(2 * W + 0.1, 0.05, 0.05, metal, [0, H, z]);
    gb.box(2 * W, 0.04, 0.07, rope, [0, 0.02, backZ]);
    const frame = gb.build(lambert());
    frame.castShadow = true;
    this.group.add(frame);

    // Synthetic-turf apron under the lane (the natural pitch sits on top of it)
    const turf = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, len).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2f7a3a' }));
    turf.position.set(0, 0.008, (frontZ + backZ) / 2);
    turf.receiveShadow = true;
    this.group.add(turf);
  }

  attach(parent) { if (this.group.parent !== parent) parent.add(this.group); }
  setVisible(on) { this.group.visible = !!on; }
}
