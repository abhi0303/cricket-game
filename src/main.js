// Application bootstrap: renderer, stadium, cameras, input, sound, UI and the main loop.
import * as THREE from 'three';
import { createRenderer, QUALITY } from './scene/Renderer.js';
import { StadiumScene } from './scene/StadiumScene.js';
import { CameraManager } from './scene/CameraManager.js';
import { MatchView } from './scene/MatchView.js';
import { KeyboardControls } from './controls/KeyboardControls.js';
import { GamepadControls } from './controls/GamepadControls.js';
import { InputManager } from './controls/InputManager.js';
import { TouchControls, isTouchDevice } from './controls/TouchControls.js';
import { Sound } from './audio/Sound.js';
import { GameManager } from './game/GameManager.js';
import { Storage, DEFAULT_SETTINGS } from './utils/Storage.js';
import { PhysicsDebug, physicsDebugEnabled } from './scene/PhysicsDebug.js';
import { setCharacterEnvironment } from './scene/PlayerModel.js';

const touchDevice = isTouchDevice();
// Phones and tablets start on Low graphics (it can be changed in the settings).
const settings = { ...DEFAULT_SETTINGS, ...(touchDevice ? { quality: 'low' } : {}), ...(Storage.get('settings') || {}) };
document.documentElement.classList.toggle('touch', touchDevice);
const canvas = document.getElementById('game');
const renderer = createRenderer(canvas, settings.quality);
const stadium = new StadiumScene(renderer, { stadium: settings.stadium, timeOfDay: settings.timeOfDay, quality: settings.quality });
setCharacterEnvironment(renderer);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2200);
const cameras = new CameraManager(camera);
const view = new MatchView(stadium, { shadows: settings.quality !== 'low', quality: settings.quality });
const keyboard = new KeyboardControls(window);
const gamepad = new GamepadControls();
const touch = new TouchControls();
const input = new InputManager({ keyboard, gamepad, touch });
const sound = new Sound();

const app = new GameManager({
  renderer, stadium, cameras, view, input, keyboard, gamepad, sound,
  uiRoot: document.getElementById('ui'),
  hudRoot: document.getElementById('hud'),
  overlayRoot: document.getElementById('overlay'),
});

if (touchDevice && !Storage.get('settings')) app.settings.quality = 'low';   // as the renderer started

// On-screen touch controls (phones, tablets, or once a finger is used): the thumb-stick and the buttons for what the
// game is asking for, in play only (not over menus or pop-ups).
const touchRoot = document.getElementById('touch');
touch.mount(touchRoot, {
  onCamera: () => { touch.press('camera'); touch.release('camera'); },
  onFullscreen: () => toggleFullscreen(),
});
const GAME_PROFILES = new Set(['batting', 'bowling', 'fielding', 'between']);
function touchWanted() {
  const mode = app.settings.touch || 'auto';
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  if (input.lastDevice === 'gamepad' && gamepad.connected) return false;
  return touchDevice || input.lastDevice === 'touch';
}
function syncTouch() {
  const inPlay = !app.hudRoot.classList.contains('hidden') && app.overlayRoot.classList.contains('hidden') && GAME_PROFILES.has(input.profile);
  const on = inPlay && touchWanted();
  touch.show(on);
  app.hudRoot.classList.toggle('touch-on', on);
  if (on) touch.render(input.bindings);
}
addEventListener('pointerdown', e => { if (e.pointerType === 'touch') touch.lastActivity = performance.now(); }, { capture: true });

/** Full screen (and landscape, where the browser allows it). */
function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen)?.call(d); return; }
  const el = d.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
  Promise.resolve(req?.call(el, { navigationUI: 'hide' })).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}
app.toggleFullscreen = toggleFullscreen;

// Audio may only start after a user gesture.
const unlock = () => { sound.resume(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);
addEventListener('gamepadconnected', () => sound.resume());

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Developer-only bowling physics overlay (?debug=physics). Also unlocks all ten bowling speeds.
const physicsDebug = physicsDebugEnabled() ? new PhysicsDebug(stadium) : null;
app.debugPhysics = !!physicsDebug;
let fpsAvg = 60;

const debugQ = new URLSearchParams(location.search);
let showcase = null;
if (debugQ.get('debug') === 'characters') {
  const { startShowcase } = await import('./scene/CharacterShowcase.js');
  showcase = startShowcase({ stadium, camera, q: debugQ });
  document.getElementById('ui').classList.add('hidden');
} else {
  app.demo.start('menu');
  app.go('main');
}
document.getElementById('boot')?.remove();

let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (window.__game?.frozen) { last = now; return; }   // automated tests drive frames themselves
  const fps = QUALITY[app.settings.quality]?.fps || 60;
  acc += now - last;
  const dtMs = now - last;
  last = now;
  if (fps < 60 && acc < 1000 / fps - 2) return;
  const dt = Math.min(0.05, (fps < 60 ? acc : dtMs) / 1000);
  acc = 0;
  input.update(dt);
  if (showcase) { showcase.update(dt); stadium.update(dt, now / 1000); renderer.render(stadium.scene, camera); return; }
  const ctx = app.update(dt);
  syncTouch();
  stadium.update(dt, now / 1000);
  cameras.update(dt, ctx || {});
  if (physicsDebug) { fpsAvg += (1 / Math.max(1e-3, dt) - fpsAvg) * 0.1; physicsDebug.update(app.match?.sim || app.demo.sim, fpsAvg); }
  renderer.render(stadium.scene, camera);
}
requestAnimationFrame(frame);

// Installable and offline (PWA): the service worker saves the game as it loads. Not on localhost during development,
// where a saved copy would hide changes (add ?sw=1 to try it there).
if ('serviceWorker' in navigator && (!/^(localhost|127\.)/.test(location.hostname) || debugQ.get('sw') === '1')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered.', err)));
}

// Debug / automated-test hooks (harmless in normal play).
window.__game = {
  app, stadium, cameras, view, renderer, input, keyboard, touch, syncTouch,
  /** Advance the game by `sec` seconds of simulated frames without rendering. */
  step(sec = 1) {
    for (let i = 0; i < Math.round(sec * 60); i++) { input.update(); const c = app.update(1 / 60); stadium.update(1 / 60, i / 60); cameras.update(1 / 60, c || {}); }
    renderer.render(stadium.scene, camera);
    const m = app.match;
    return m ? `${m.state} ${m.sim?.phase} t=${m.sim?.t.toFixed(2)}` : `menu:${app.screen}`;
  },
};
