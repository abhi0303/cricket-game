// Keyboard state tracking (by KeyboardEvent.code).

// Keys the game uses that would otherwise scroll the page. Tab is left alone for keyboard navigation.
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class KeyboardControls {
  constructor(target = typeof window !== 'undefined' ? window : null) {
    this.down = new Set();
    this.pressTime = new Map();   // code -> performance.now() when it went down
    this.taps = new Map();        // keys pressed since the last poll (so a tap shorter than a frame isn't lost)
    this.listeners = [];
    this.onAnyKey = null;      // used by the remapping screen
    this.lastActivity = 0;
    if (target) this.attach(target);
  }

  attach(target) {
    const kd = (e) => {
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
      if (this.onAnyKey) { e.preventDefault(); const cb = this.onAnyKey; this.onAnyKey = null; cb(e.code); return; }
      if (typing) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) { this.pressTime.set(e.code, performance.now()); this.taps.set(e.code, performance.now()); }
      this.down.add(e.code);
      this.lastActivity = performance.now();
    };
    const ku = (e) => { this.down.delete(e.code); };
    const blur = () => this.down.clear();
    target.addEventListener('keydown', kd);
    target.addEventListener('keyup', ku);
    target.addEventListener('blur', blur);
    this.listeners.push(['keydown', kd], ['keyup', ku], ['blur', blur]);
    this.target = target;
  }

  detach() {
    for (const [t, f] of this.listeners) this.target.removeEventListener(t, f);
    this.listeners = [];
  }

  isDown(code) { return this.down.has(code); }
  anyDown(codes = []) { return codes.some(c => this.down.has(c)); }

  /** Simulate input (tests / debug). */
  press(code) { if (!this.down.has(code)) { this.pressTime.set(code, performance.now()); this.taps.set(code, performance.now()); } this.down.add(code); this.lastActivity = performance.now(); }

  /** Keys pressed since the previous call (code -> time). */
  takeTaps() { const t = this.taps; this.taps = new Map(); return t; }

  /** Seconds since the most recent of these keys went down (0 if none is down). */
  ageOf(codes = []) {
    let best = null;
    for (const c of codes) if (this.down.has(c)) { const t = this.pressTime.get(c); if (t != null && (best == null || t > best)) best = t; }
    if (best == null) for (const c of codes) { const t = this.lastTaps?.get(c); if (t != null && (best == null || t > best)) best = t; }
    return best == null ? 0 : Math.max(0, (performance.now() - best) / 1000);
  }
  release(code) { this.down.delete(code); }

  /** Capture the next key press (for remapping). */
  captureNext(cb) { this.onAnyKey = cb; }
}
