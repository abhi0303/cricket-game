// WebGL renderer setup and quality presets.
import * as THREE from 'three';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, antialias: false, fps: 30 },
  medium: { pixelRatio: 1, shadows: true, antialias: true, fps: 60 },
  high: { pixelRatio: 2, shadows: true, antialias: true, fps: 60 },
};

export function createRenderer(canvas, quality = 'medium') {
  const q = QUALITY[quality] || QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  applyQuality(renderer, quality);
  return renderer;
}

export function applyQuality(renderer, quality) {
  const q = QUALITY[quality] || QUALITY.medium;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  renderer.shadowMap.enabled = q.shadows;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
