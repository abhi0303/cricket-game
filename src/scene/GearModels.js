// Batting gear from 3D models (assets/models/gear, made by scripts/gear-model.html), loaded once and shared:
//   bat  "Cricket BAT 3D model SS" by knitro_vedant, CC BY 4.0: in the game's bat frame (handle top at the origin,
//        toe at -0.85 m on -y, face +z), so it drops into PlayerModel's bat in place of the built-in one
//   pad  one leg pad from "cricket leg ped" by arogeek, CC BY 4.0: 1 unit tall from the bottom of the instep flap
//        (y = 0) to the top of the knee roll, face +z, wrapped round the y axis (the shin). RiggedBody sizes one to
//        each shin and mirrors it for the other leg.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FILES = { bat: 'assets/models/gear/bat.glb', pad: 'assets/models/gear/pad.glb' };
const loads = {};

/** The gear model's scene (shared: clone it to use it). */
export function loadGear(name) {
  if (!loads[name]) {
    loads[name] = new GLTFLoader().loadAsync(FILES[name]).then(g => {
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material.map) o.material.map.anisotropy = 4; } });
      return g.scene;
    });
  }
  return loads[name];
}

/** A copy of a gear model mirrored left to right (the other leg's pad). */
export function mirrored(scene) {
  const out = scene.clone();
  out.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.scale(-1, 1, 1);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
    o.geometry = g;
  });
  return out;
}
