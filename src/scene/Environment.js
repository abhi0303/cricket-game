// Scenery outside the stadium: city skyline + harbour, or hills; trees and clouds. opts.inner: nothing is placed
// closer than this to the centre (the stands of the stadium model reach about 180 m).
import * as THREE from 'three';
import { GeoBuilder } from './GeoBuilder.js';
import { windowTexture } from './Textures.js';

export function buildScenery(type, mat, quality = 'medium', { inner = 0 } = {}) {
  const group = new THREE.Group();
  group.name = 'scenery';
  const q = { low: 0.45, medium: 1, high: 1.4 }[quality] ?? 1;

  // Land beyond the stadium
  const land = new THREE.Mesh(new THREE.CircleGeometry(1200, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: type === 'city' ? '#6d7a66' : '#5f8a45' }));
  land.position.y = -0.08;
  group.add(land);

  let windowsMat = null, water = null;
  const dayWin = windowTexture(false), nightWin = windowTexture(true);
  if (type === 'city') {
    // Harbour water behind the pavilion end
    water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 900).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2e6e9e' }));
    water.position.set(0, -0.04, -620);
    group.add(water);
    // Skyline: instanced boxes
    const count = Math.round(140 * q);
    windowsMat = new THREE.MeshLambertMaterial({ map: dayWin, emissiveMap: nightWin, emissive: '#000000' });
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(box, windowsMat, count);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const tints = ['#ffffff', '#dfe7f1', '#f2e8d8', '#cfd8e6', '#e6eef2'];
    let k = 0;
    for (let i = 0; i < count; i++) {
      // keep the harbour side (-z) mostly open
      let a = Math.random() * Math.PI * 2;
      if (Math.cos(a) < -0.45) a += Math.PI * 0.7;
      const r = Math.max(170, inner) + Math.random() * 230;
      const w = 14 + Math.random() * 22, d = 14 + Math.random() * 22;
      const h = 18 + Math.pow(Math.random(), 1.8) * (r > 280 ? 140 : 80);
      m.makeRotationY(Math.random() * Math.PI);
      m.scale(new THREE.Vector3(w, h, d));
      m.setPosition(Math.sin(a) * r, 0, Math.cos(a) * r);
      inst.setMatrixAt(k, m);
      inst.setColorAt(k, c.set(tints[i % tints.length]));
      k++;
    }
    group.add(inst);
  } else {
    // Hills ring
    const gb = new GeoBuilder();
    const n = Math.round(46 * q) + 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const r = Math.max(260, inner + 60) + Math.random() * 220;
      const h = 45 + Math.random() * 110;
      const rad = 70 + Math.random() * 90;
      const col = r > 380 ? '#7f9aa8' : ['#5c8a46', '#6a9450', '#4e7b3d'][i % 3];
      gb.add(new THREE.ConeGeometry(rad, h, 7, 1), col, { pos: [Math.sin(a) * r, h / 2 - 2, Math.cos(a) * r], rot: [0, Math.random() * 3, 0] });
    }
    // Grass banks behind the low stands (not when a bigger stadium stands there)
    for (let i = 0; i < (inner > 130 ? 0 : 12); i++) {
      const a = (i / 12) * Math.PI * 2;
      gb.add(new THREE.ConeGeometry(30, 10, 6, 1), '#5f9248', { pos: [Math.sin(a) * 118, 2, Math.cos(a) * 118], scale: [1.4, 1, 0.7], rot: [0, -a, 0] });
    }
    group.add(gb.build(mat));
  }

  // Trees (instanced trunk + canopy)
  const treeCount = Math.round((type === 'city' ? 70 : 220) * q);
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 4, 5).translate(0, 2, 0);
  const crown = new THREE.IcosahedronGeometry(3.2, 0).translate(0, 6.2, 0);
  const trunkMesh = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: '#6b4a2f', flatShading: true }), treeCount);
  const crownMesh = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), treeCount);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const greens = ['#3f7a35', '#4d8a3a', '#2f6a30', '#5a9442', '#6a9a3a'];
  for (let i = 0; i < treeCount; i++) {
    let a = Math.random() * Math.PI * 2;
    if (type === 'city' && Math.cos(a) < -0.5) a += 1.2;
    const r = Math.max(113, inner) + Math.random() * (type === 'city' ? 40 : 110);
    const s = 0.8 + Math.random() * 0.9;
    m.makeRotationY(Math.random() * 6);
    m.scale(new THREE.Vector3(s, s * (0.9 + Math.random() * 0.4), s));
    m.setPosition(Math.sin(a) * r, 0, Math.cos(a) * r);
    trunkMesh.setMatrixAt(i, m); crownMesh.setMatrixAt(i, m);
    crownMesh.setColorAt(i, c.set(greens[i % greens.length]));
  }
  group.add(trunkMesh, crownMesh);

  // Clouds
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, transparent: true, opacity: 0.92, fog: false });
  for (let i = 0; i < 9; i++) {
    const gb = new GeoBuilder();
    const n = 4 + (Math.random() * 4 | 0);
    for (let j = 0; j < n; j++) gb.add(new THREE.IcosahedronGeometry(14 + Math.random() * 12, 0), '#ffffff', { pos: [j * 16 - n * 8, Math.random() * 8, Math.random() * 10] });
    const cl = gb.build(cloudMat);
    const a = Math.random() * Math.PI * 2, r = 380 + Math.random() * 260;
    cl.position.set(Math.sin(a) * r, 150 + Math.random() * 90, Math.cos(a) * r);
    cl.rotation.y = a;
    clouds.add(cl);
  }
  group.add(clouds);

  return {
    group,
    setNight(night, evening) {
      if (windowsMat) {
        windowsMat.map = night ? nightWin : dayWin;
        windowsMat.emissive.set(night ? '#ffffff' : evening ? '#3a3a3a' : '#000000');
        windowsMat.needsUpdate = true;
      }
      cloudMat.color.set(night ? '#2a3350' : evening ? '#ffc9a0' : '#ffffff');
      cloudMat.opacity = night ? 0.5 : 0.92;
      if (water) water.material.color.set(night ? '#0d2236' : evening ? '#3b5d86' : '#2e6e9e');
      land.material.color.set(night ? (type === 'city' ? '#2a3128' : '#22341b') : type === 'city' ? '#6d7a66' : '#5f8a45');
    },
    update(dt) { clouds.rotation.y += dt * 0.002; },
  };
}
