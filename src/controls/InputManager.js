// Merges keyboard and gamepad into actions for the active profile, with press edges
// (a held button never re-triggers), analog values for triggers and one direction axis.

import { mergeBindings, AXIS_KEYS, PAD } from './Bindings.js';

export class InputManager {
  constructor({ keyboard, gamepad, bindings = null }) {
    this.kb = keyboard;
    this.pad = gamepad;
    this.bindings = mergeBindings(bindings);
    this.profile = 'menu';
    this.prev = new Map();
    this.cur = new Map();
    this.edges = new Set();
    this.releases = new Set();
    this.lastDevice = 'keyboard';
    this.consumed = new Set();
  }

  setBindings(b) { this.bindings = mergeBindings(b); }

  setProfile(name) {
    if (name === this.profile) return;
    this.profile = name;
    // Buttons already held when switching don't count as fresh presses.
    this.prev = new Map(this.cur);
    for (const a of Object.keys(this.bindings[name] || {})) this.prev.set(a, this.rawDown(a, name));
  }

  rawValue(action, profile = this.profile) {
    const b = this.bindings[profile]?.[action];
    if (!b) return 0;
    let v = 0;
    if (this.kb && this.kb.anyDown(b.keys)) v = 1;
    if (this.pad && this.pad.connected) for (const i of b.pad) v = Math.max(v, this.pad.value(i));
    return v;
  }
  rawDown(action, profile) { return this.rawValue(action, profile) > 0.5; }

  /** Call once per frame. */
  update(frameDt = 0) {
    this.frameDt = frameDt;
    if (this.pad) this.pad.poll();
    this.edges.clear();
    this.releases.clear();
    this.consumed.clear();
    const acts = this.bindings[this.profile] || {};
    const taps = this.kb?.takeTaps ? this.kb.takeTaps() : new Map();
    if (this.kb) this.kb.lastTaps = taps;
    for (const a of Object.keys(acts)) {
      // A key tapped and released between two frames still counts as a press.
      const now = this.rawDown(a) || (!this.prev.get(a) && acts[a].keys.some(k => taps.has(k)));
      const before = !!this.prev.get(a);
      if (now && !before) this.edges.add(a);
      if (!now && before) this.releases.add(a);
      this.cur.set(a, now);
      this.prev.set(a, now);
    }
    const padT = this.pad?.lastActivity || 0, kbT = this.kb?.lastActivity || 0;
    if (padT || kbT) this.lastDevice = padT > kbT ? 'gamepad' : 'keyboard';
  }

  /** True once on the frame the action was pressed. */
  pressed(action) {
    if (!this.edges.has(action) || this.consumed.has(action)) return false;
    this.consumed.add(action);
    return true;
  }
  released(action) { return this.releases.has(action); }

  /** How long ago (seconds) the physical press of this action happened — used to back-date shots
   *  so timing doesn't depend on the frame the press was noticed in. Keyboard events carry exact times;
   *  gamepads are polled, so their age is estimated as half a frame. */
  pressAge(action) {
    const b = this.bindings[this.profile]?.[action];
    if (!b) return 0;
    if (this.kb && (this.kb.anyDown(b.keys) || b.keys.some(k => this.kb.lastTaps?.has(k)))) return this.kb.ageOf(b.keys);
    return this.frameDt ? this.frameDt / 2 : 0;
  }
  down(action) { return !!this.cur.get(action); }
  value(action) { return this.rawValue(action); }

  /** Direction: keys (WASD / arrows), D-pad, or left stick. y > 0 = up/forward. */
  axis() {
    let x = 0, y = 0;
    if (this.kb) {
      if (this.kb.anyDown(AXIS_KEYS.left)) x -= 1;
      if (this.kb.anyDown(AXIS_KEYS.right)) x += 1;
      if (this.kb.anyDown(AXIS_KEYS.up)) y += 1;
      if (this.kb.anyDown(AXIS_KEYS.down)) y -= 1;
    }
    if (this.pad && this.pad.connected) {
      const s = this.pad.stick('left');
      x += s.x; y -= s.y;
      if (this.pad.isDown(PAD.LEFT)) x -= 1;
      if (this.pad.isDown(PAD.RIGHT)) x += 1;
      if (this.pad.isDown(PAD.UP)) y += 1;
      if (this.pad.isDown(PAD.DOWN)) y -= 1;
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  lookAxis() {
    if (!this.pad || !this.pad.connected) return { x: 0, y: 0 };
    const s = this.pad.stick('right');
    return { x: s.x, y: -s.y };
  }

  /** Label for the first binding of an action on the device the player last used. */
  hint(action, profile = this.profile, labels = null) {
    const b = this.bindings[profile]?.[action];
    if (!b) return '';
    if (this.lastDevice === 'gamepad' && this.pad?.connected && labels) return labels[this.pad.style]?.[b.pad[0]] ?? '';
    return b.keys[0] || '';
  }
}
