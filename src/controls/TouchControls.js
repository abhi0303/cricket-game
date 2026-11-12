// Touch controls for phones and tablets: an on-screen thumb-stick (shot direction, bowling aim) and buttons for
// the actions that make sense right now, laid out like the controller (the buttons sit where the controller's do:
// A at the bottom of the diamond, B right, X left, Y top, the shoulder buttons above it, the stick press beside it,
// the D-pad's left/right over the thumb-stick). The input manager reads it like the keyboard and gamepad: by action.
//
// Which buttons show comes from the same place as the controls card (HUD.hints offers its items), so the touch
// layout always matches what the game is asking for. Power and Precision are toggles on touch (tap to arm them for
// the next shot or delivery) since the other thumb is on the stick.
import { PAD } from './Bindings.js';
import { ICONS } from '../ui/TouchIcons.js';

/** Where a controller button's action goes on screen. */
export const SLOT_OF_PAD = {
  [PAD.A]: 'a', [PAD.B]: 'b', [PAD.X]: 'x', [PAD.Y]: 'y',
  [PAD.LT]: 'lt', [PAD.LB]: 'lb', [PAD.RB]: 'rb', [PAD.RT]: 'rt',
  [PAD.RS]: 'rs', [PAD.LEFT]: 'dl', [PAD.RIGHT]: 'dr',
};
/** Toggled on touch (tap to arm, tap again or play the shot / let it go to clear). */
export const LATCHED = new Set(['power', 'precision']);
/** Actions that aim with the stick: the thumb-stick shows while one of them is on offer. */
const AIMS = new Set(['ground', 'lofted', 'defend', 'advanced', 'leave', 'bowl']);
/** Buttons the game keeps on screen elsewhere (the pause button) or in the top row (camera). */
const ELSEWHERE = new Set(['pause', 'camera', 'continue_menu']);
const DEAD = 0.12;
// Short labels for the buttons (the controls card's text is longer).
const SHORT = {
  bowl: 'Bowl', run: 'Run', cancelRun: 'Back', dive: 'Dive', sprint: 'Sprint', continue: 'Next', replay: 'Replay',
  speedUp: 'Faster', speedDown: 'Slower', lengthNext: 'Length', lengthPrev: 'Length', typeNext: 'Variation', typePrev: 'Variation',
  throwKeeper: 'Keeper', throwBowler: 'Bowler', throwAuto: 'Best', advanced: 'Sweep', ground: 'Ground', lofted: 'Lofted', defend: 'Defend', leave: 'Leave', precision: 'Precise',
};

export class TouchControls {
  constructor() {
    this.held = new Map();        // action -> performance time it went down (fingers on it now)
    this.latches = new Set();     // toggled actions armed
    this.taps = new Map();        // pressed since the last poll (a quick tap still counts)
    this.lastTaps = new Map();
    this.stickV = { x: 0, y: 0 };
    this.lastActivity = 0;
    this.items = [];              // [[action | actions[], text]] on offer
    this.offerKey = '';
    this.profile = 'menu';
    this.enabled = false;
    this.root = null;
  }

  // ------------------------------------------------------------------ state (used by InputManager)
  /** 0..1: held down, or armed (toggles). */
  value(action) { return this.held.has(action) || this.latches.has(action) ? 1 : 0; }
  isDown(action) { return this.value(action) > 0.5; }
  takeTaps() { const t = this.taps; this.taps = new Map(); this.lastTaps = t; return t; }
  /** Seconds since this action was pressed (for back-dating shots), 0 if it isn't. */
  ageOf(action) {
    const t = this.held.get(action) ?? this.lastTaps.get(action);
    return t == null ? 0 : Math.max(0, (performance.now() - t) / 1000);
  }
  stick() { return { ...this.stickV }; }

  /** Finger down / up on an action's button (t: event time, performance.now() clock). */
  press(action, t = performance.now()) {
    this.lastActivity = t;
    if (LATCHED.has(action)) {
      if (this.latches.has(action)) this.latches.delete(action); else this.latches.add(action);
      this.taps.set(action, t);
      return;
    }
    if (!this.held.has(action)) { this.held.set(action, t); this.taps.set(action, t); }
  }
  release(action) { this.held.delete(action); }
  releaseAll() { this.held.clear(); this.stickV = { x: 0, y: 0 }; }
  /** Thumb-stick, x right and y up, each -1..1 (a small dead zone in the middle). */
  setStick(x, y) {
    const m = Math.hypot(x, y);
    if (m < DEAD) { this.stickV = { x: 0, y: 0 }; return; }
    const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
    this.stickV = { x: x * k, y: y * k };
    this.lastActivity = performance.now();
  }

  /**
   * What the game offers right now (HUD.hints' items). A toggle that's no longer on offer is cleared (the shot was
   * played, the delivery bowled).
   */
  offer(profile, items) {
    const key = profile + '|' + items.map(([a, t]) => [].concat(a).join('+') + ':' + t).join(',');
    if (key === this.offerKey) return;
    this.offerKey = key;
    this.profile = profile;
    this.items = items;
    const offered = new Set(items.flatMap(([a]) => [].concat(a)));
    for (const a of [...this.latches]) if (!offered.has(a)) this.latches.delete(a);
    for (const a of [...this.held.keys()]) if (!offered.has(a)) this.held.delete(a);
    this.dirty = true;
  }

  /** The buttons for the current offer: [{ action, text, slot }] (slots from the controller layout). */
  layout(bindings) {
    const out = [];
    for (const [acts, text] of this.items) {
      const list = [].concat(acts);
      for (const a of list) {
        if (ELSEWHERE.has(a)) continue;
        const pad = bindings[this.profile]?.[a]?.pad?.[0];
        const slot = SLOT_OF_PAD[pad] || 'extra';
        const label = a === 'power' ? (this.profile === 'bowling' ? 'Effort' : 'Power') : a === 'cancelRun' && /stay/i.test(text) ? 'Stay in' : SHORT[a] || text;
        out.push({ action: a, text: list.length > 1 ? '' : label, slot });
      }
    }
    return out;
  }
  aims() { return this.items.some(([a]) => [].concat(a).some(x => AIMS.has(x))); }

  // ------------------------------------------------------------------ on screen
  /** Build the touch layer in `root` (an element over the game). */
  mount(root, { onCamera, onFullscreen } = {}) {
    this.root = root;
    root.innerHTML = `
      <div class="tc-stick" aria-label="Shot direction"><div class="tc-base"></div><div class="tc-knob"></div></div>
      <div class="tc-dpad"></div>
      <div class="tc-pad"></div>
      <div class="tc-top">
        <button class="tc-mini" data-tc="camera" aria-label="Change camera">${ICONS.camera}</button>
        <button class="tc-mini" data-tc="fullscreen" aria-label="Full screen">${ICONS.fullscreen}</button>
      </div>`;
    this.padEl = root.querySelector('.tc-pad');
    this.dpadEl = root.querySelector('.tc-dpad');
    this.stickEl = root.querySelector('.tc-stick');
    this.knob = root.querySelector('.tc-knob');
    // buttons: press on pointerdown, release on up / cancel / leaving
    const down = e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      b.classList.add('on');
      this.press(b.dataset.act, e.timeStamp || performance.now());
      b.dataset.pid = e.pointerId;
    };
    const up = e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      this.release(b.dataset.act);
      if (!LATCHED.has(b.dataset.act)) b.classList.remove('on');
    };
    for (const el of [this.padEl, this.dpadEl]) {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
    // the thumb-stick: anywhere in its area; the knob follows the finger up to the rim
    let sid = null, cx = 0, cy = 0, R = 1;
    const move = e => {
      const dx = e.clientX - cx, dy = e.clientY - cy, m = Math.hypot(dx, dy), k = m > R ? R / m : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.setStick(dx / R, -dy / R);
    };
    this.stickEl.addEventListener('pointerdown', e => {
      e.preventDefault();
      sid = e.pointerId;
      this.stickEl.setPointerCapture?.(e.pointerId);
      const r = this.stickEl.querySelector('.tc-base').getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2;
      move(e);
    });
    this.stickEl.addEventListener('pointermove', e => { if (e.pointerId === sid) move(e); });
    const end = e => { if (e.pointerId !== sid) return; sid = null; this.knob.style.transform = ''; this.setStick(0, 0); };
    this.stickEl.addEventListener('pointerup', end);
    this.stickEl.addEventListener('pointercancel', end);
    root.querySelector('[data-tc="camera"]').addEventListener('click', () => onCamera?.());
    root.querySelector('[data-tc="fullscreen"]').addEventListener('click', () => onFullscreen?.());
  }

  /** Redraw the buttons if the offer changed. */
  render(bindings) {
    if (!this.root || !this.dirty) return;
    this.dirty = false;
    const btn = ({ action, text, slot }) => `<button class="tc-btn s-${slot}${LATCHED.has(action) ? ' latch' : ''}${this.latches.has(action) ? ' on' : ''}" data-act="${action}" aria-label="${text || action}">${ICONS[action] || ICONS.dot}${text ? `<span>${text}</span>` : ''}</button>`;
    const all = this.layout(bindings);
    this.dpadEl.innerHTML = all.filter(b => b.slot === 'dl' || b.slot === 'dr').map(btn).join('');
    this.padEl.innerHTML = all.filter(b => b.slot !== 'dl' && b.slot !== 'dr').map(btn).join('');
    this.stickEl.classList.toggle('hidden', !this.aims());
  }

  /** Show or hide the whole layer (in play, on a touch device, nothing over it). */
  show(on) {
    if (!this.root) return;
    if (on !== this.enabled) { this.enabled = on; this.root.classList.toggle('hidden', !on); if (!on) this.releaseAll(); }
  }
}

/** Is this a touch device (a finger is the main pointer, or touch is all there is)? */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return (window.matchMedia?.('(pointer: coarse)').matches) || ('ontouchstart' in window && !window.matchMedia?.('(pointer: fine)').matches);
}
