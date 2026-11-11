// Merge many small vertex-coloured primitives into one mesh (one draw call).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

export class GeoBuilder {
  constructor() { this.parts = []; }

  add(geometry, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], matrix = null } = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    else {
      _m.compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(...scale));
      g.applyMatrix4(_m);
    }
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }

  box(w, h, d, color, pos, rot, scale) { return this.add(new THREE.BoxGeometry(w, h, d), color, { pos, rot, scale }); }
  cyl(rt, rb, h, seg, color, pos, rot, scale) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, { pos, rot, scale }); }

  /** Raw triangles: positions as flat array, one colour per triangle (array of colours). */
  tris(positions, colors) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    const col = new Float32Array(positions.length);
    for (let t = 0; t < positions.length / 9; t++) {
      _c.set(colors[t] ?? colors[0]);
      for (let v = 0; v < 3; v++) { col[t * 9 + v * 3] = _c.r; col[t * 9 + v * 3 + 1] = _c.g; col[t * 9 + v * 3 + 2] = _c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }

  geometry() {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach(p => p.dispose());
    this.parts = [];
    return g;
  }

  build(material) {
    return new THREE.Mesh(this.geometry(), material);
  }
}

export const lambert = (opts = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });
