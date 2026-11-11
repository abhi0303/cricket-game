// Procedural sound effects with the Web Audio API: bat on ball, bounce, stumps,
// crowd ambience and cheers, UI clicks. Starts on the first user gesture.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
    this.crowdLevel = 0.25;
  }

  init() {
    if (this.ctx || typeof window === 'undefined') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);
    // White noise buffer reused by everything
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startCrowd();
  }

  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? this.volume : 0; }
  setVolume(v) { this.volume = v; if (this.master && this.enabled) this.master.gain.value = v; }

  noiseSource() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; return s; }

  env(gainNode, t, a, peak, dcy) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  startCrowd() {
    const c = this.ctx;
    const src = this.noiseSource();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    this.crowdGain = c.createGain(); this.crowdGain.gain.value = 0.04;
    src.connect(bp); bp.connect(lp); lp.connect(this.crowdGain); this.crowdGain.connect(this.master);
    src.start();
  }

  /** Crowd level 0..1 (ambience swells on big moments). */
  crowd(level, time = 0.4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(0.03 + level * 0.22, t, time);
    if (level > 0.3) this.crowdGain.gain.setTargetAtTime(0.04, t + 2.2, 1.2);
  }

  bat(quality = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    // woody "tock": short resonant noise + pitched click
    const n = this.noiseSource();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400 + quality * 900; bp.Q.value = 4;
    const g = c.createGain();
    n.connect(bp); bp.connect(g); g.connect(this.master);
    this.env(g, t, 0.002, 0.9 * (0.5 + quality * 0.5), 0.09);
    n.start(t); n.stop(t + 0.15);
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(900 + quality * 400, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.06);
    const og = c.createGain(); o.connect(og); og.connect(this.master);
    this.env(og, t, 0.002, 0.35, 0.07);
    o.start(t); o.stop(t + 0.1);
  }

  thud(vol = 0.3, freq = 160) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    const g = c.createGain(); o.connect(g); g.connect(this.master);
    this.env(g, t, 0.003, vol, 0.09);
    o.start(t); o.stop(t + 0.12);
  }

  bounce() { this.thud(0.18, 220); }
  pad() { this.thud(0.3, 130); }
  gloves() { this.thud(0.35, 260); }

  stumps() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.value = 520 + i * 170;
      const g = c.createGain(); o.connect(g); g.connect(this.master);
      this.env(g, t + i * 0.035, 0.002, 0.12, 0.12);
      o.start(t + i * 0.035); o.stop(t + 0.3);
    }
    this.thud(0.3, 300);
  }

  cheer(level = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSource();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.5;
    const g = c.createGain();
    n.connect(bp); bp.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * level, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    n.start(t); n.stop(t + 3.4);
    // whistles
    for (let i = 0; i < Math.round(3 * level); i++) {
      const o = c.createOscillator(); o.type = 'sine';
      const st = t + 0.2 + Math.random() * 0.8;
      o.frequency.setValueAtTime(1800 + Math.random() * 600, st);
      o.frequency.linearRampToValueAtTime(2600 + Math.random() * 600, st + 0.25);
      const og = c.createGain(); o.connect(og); og.connect(this.master);
      this.env(og, st, 0.02, 0.05, 0.3);
      o.start(st); o.stop(st + 0.4);
    }
    this.crowd(level);
  }

  groan() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSource();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(300, t + 1.2);
    const g = c.createGain(); n.connect(lp); lp.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    n.start(t); n.stop(t + 1.6);
  }

  click(high = false) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = high ? 880 : 620;
    const g = c.createGain(); o.connect(g); g.connect(this.master);
    this.env(g, t, 0.002, 0.08, 0.06);
    o.start(t); o.stop(t + 0.08);
  }

  whoosh() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSource();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
    const g = c.createGain(); n.connect(bp); bp.connect(g); g.connect(this.master);
    this.env(g, t, 0.05, 0.08, 0.25);
    n.start(t); n.stop(t + 0.4);
  }
}
