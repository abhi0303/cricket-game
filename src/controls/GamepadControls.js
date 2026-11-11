// Browser Gamepad API: polling, connect/disconnect, dead zones, controller style detection.

export const DEADZONE = 0.2;

/** Radial dead zone with rescaling so the stick still reaches 1.0. */
export function applyDeadzone(x, y, dz = DEADZONE) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k };
}

export function padStyle(id = '') {
  const s = id.toLowerCase();
  // Xbox pads first: the Xbox Series pad calls itself "Xbox Wireless Controller", which would otherwise
  // match Sony's plain "Wireless Controller".
  if (/xbox|xinput|045e/.test(s)) return 'xbox';
  if (/054c|playstation|dualshock|dualsense|wireless controller|ps4|ps5/.test(s)) return 'ps';
  return 'xbox';
}

export class GamepadControls {
  /**
   * @param {() => (Gamepad|null)[]} getPads  defaults to navigator.getGamepads
   * @param {EventTarget} target              window, for connect/disconnect events
   */
  constructor(getPads = null, target = typeof window !== 'undefined' ? window : null) {
    this.getPads = getPads || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()) : []));
    this.index = null;
    this.connected = false;
    this.id = '';
    this.style = 'xbox';
    this.buttons = new Array(17).fill(0);
    this.axes = [0, 0, 0, 0];
    this.listeners = new Set();
    this.lastActivity = 0;
    this.captureCb = null;
    this.prevForCapture = new Array(17).fill(0);
    if (target && target.addEventListener) {
      target.addEventListener('gamepadconnected', e => this.handleConnect(e.gamepad));
      target.addEventListener('gamepaddisconnected', e => this.handleDisconnect(e.gamepad));
    }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn({ connected: this.connected, id: this.id, style: this.style }); }

  handleConnect(pad) {
    if (!pad) return;
    if (this.index == null || !this.connected) {
      this.index = pad.index; this.connected = true; this.id = pad.id; this.style = padStyle(pad.id);
      this.emit();
    }
  }

  handleDisconnect(pad) {
    if (pad && pad.index !== this.index) return;
    this.connected = false; this.index = null; this.id = '';
    this.buttons.fill(0); this.axes = [0, 0, 0, 0];
    this.emit();
    // Fall back to another connected pad if there is one
    this.poll();
  }

  poll() {
    let pads = [];
    try { pads = this.getPads() || []; } catch { pads = []; }
    let pad = this.index != null ? pads[this.index] : null;
    if (!pad || !pad.connected) pad = pads.find(p => p && p.connected) || null;
    if (!pad) {
      if (this.connected) { this.connected = false; this.index = null; this.buttons.fill(0); this.axes = [0, 0, 0, 0]; this.emit(); }
      return;
    }
    if (!this.connected || pad.index !== this.index) { this.index = pad.index; this.connected = true; this.id = pad.id; this.style = padStyle(pad.id); this.emit(); }
    for (let i = 0; i < this.buttons.length; i++) {
      const b = pad.buttons[i];
      this.buttons[i] = b ? (typeof b === 'object' ? (b.pressed ? Math.max(b.value || 1, 0.5) : b.value || 0) : b) : 0;
    }
    const L = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0);
    const R = applyDeadzone(pad.axes[2] || 0, pad.axes[3] || 0);
    this.axes = [L.x, L.y, R.x, R.y];
    if (this.buttons.some(v => v > 0.5) || Math.hypot(L.x, L.y) > 0.3) this.lastActivity = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.captureCb) {
      for (let i = 0; i < this.buttons.length; i++) {
        if (this.buttons[i] > 0.5 && this.prevForCapture[i] <= 0.5) { const cb = this.captureCb; this.captureCb = null; cb(i); break; }
      }
    }
    this.prevForCapture = this.buttons.slice();
  }

  value(i) { return this.connected ? this.buttons[i] || 0 : 0; }
  isDown(i) { return this.value(i) > 0.5; }
  stick(which = 'left') { return which === 'left' ? { x: this.axes[0], y: this.axes[1] } : { x: this.axes[2], y: this.axes[3] }; }
  captureNext(cb) { this.prevForCapture = this.buttons.slice(); this.captureCb = cb; }

  vibrate(ms = 120, strength = 0.6) {
    try {
      const pad = this.getPads()[this.index];
      pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 });
    } catch { /* not supported */ }
  }
}
