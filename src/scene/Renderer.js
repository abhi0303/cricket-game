// WebGL renderer setup (quality presets and the resolution governor are in Resolution.js).
import * as THREE from 'three';
import { QUALITY, ratioRange, ResolutionGovernor } from './Resolution.js';

export { QUALITY, ratioRange, ResolutionGovernor };

/**
 * The renderer. Phones and tablets always get antialiasing: their GPUs draw in tiles, where multisampling costs very
 * little, and without it the edges shimmer.
 */
export function createRenderer(canvas, quality = 'medium', { touch = false } = {}) {
  const q = QUALITY[quality] || QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias || touch, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const { max } = ratioRange(quality, { dpr: window.devicePixelRatio, touch });
  renderer.setPixelRatio(max);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  return renderer;
}

