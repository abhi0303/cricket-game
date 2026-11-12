// Quality presets and the resolution governor (no Three.js here, so the tests can load it).
//
// Resolution is a pixel ratio: render pixels per CSS pixel. A phone has 2 to 3 screen pixels per CSS pixel, so
// rendering at 1 (or less) and letting the browser stretch it up makes the 3D blurry next to the sharp HUD. Each
// preset gives the highest ratio it may use (never above the screen's own); the governor starts there and steps the
// ratio down while frames are slow, and back up when there's room, so a phone that can keep up is sharp and one that
// can't stays smooth.

export const QUALITY = {
  // maxRatio: the most render pixels per CSS pixel (phones and tablets get touchMax); minRatio: the governor's floor
  low: { maxRatio: 1, touchMax: 2, minRatio: 0.75, shadows: false, antialias: false, fps: 60 },
  medium: { maxRatio: 1.5, touchMax: 2, minRatio: 0.8, shadows: true, antialias: true, fps: 60 },
  high: { maxRatio: 3, touchMax: 3, minRatio: 1, shadows: true, antialias: true, fps: 60 },
};

/** The range of pixel ratios for a preset on this screen. */
export function ratioRange(quality, { dpr = 1, touch = false } = {}) {
  const q = QUALITY[quality] || QUALITY.medium;
  const max = Math.max(0.5, Math.min(dpr || 1, touch ? q.touchMax : q.maxRatio));
  return { min: Math.min(q.minRatio, max), max };
}

/**
 * Keeps the frame rate up by changing the render resolution. Feed it the time between drawn frames; once a second
 * it looks at the average: two slow seconds in a row (more than 15% over the target frame time) step the ratio down
 * by 15%; four good seconds step it back up by 12%, never above the ceiling. If raising it made frames slow again,
 * the ceiling comes down to where it was good, so it doesn't keep hunting. At the floor and still slow, it drops the
 * frame-rate target to 30, which is steadier than an uneven 40.
 * apply(ratio) is called whenever the ratio changes.
 */
export class ResolutionGovernor {
  constructor({ min, max, fps = 60, apply }) {
    this.apply = apply;
    this.setRange({ min, max }, fps);
  }

  setRange({ min, max }, fps = 60) {
    this.min = min; this.max = max; this.ceiling = max; this.ratio = max;
    this.baseFps = fps; this.fps = fps;
    this.reset();
    this.apply?.(this.ratio);
  }

  reset() { this.sum = 0; this.n = 0; this.windowMs = 0; this.slow = 0; this.good = 0; this.lastRaise = -1; this.lastFpsUp = -1; this.fps30 = false; this.t = 0; this.warm = 2000; }

  /** One drawn frame, `ms` after the previous one. Returns true if the ratio changed. */
  frame(ms) {
    if (!(ms > 0) || ms > 250) return false;          // a stall (tab hidden, loading): not a measure of speed
    this.t += ms;
    if (this.warm > 0) { this.warm -= ms; return false; }   // shaders compiling, models arriving
    this.sum += ms; this.n++; this.windowMs += ms;
    if (this.windowMs < 1000) return false;
    const avg = this.sum / this.n, target = 1000 / this.fps;
    this.sum = 0; this.n = 0; this.windowMs = 0;
    if (avg > target * 1.15) { this.slow++; this.good = 0; } else if (avg < target * 1.05) { this.good++; this.slow = 0; } else { this.slow = 0; this.good = 0; }
    if (this.slow >= 2) {
      this.slow = 0;
      if (this.lastRaise >= 0 && this.t - this.lastRaise < 6000) this.ceiling = Math.max(this.min, this.ratio / 1.12);   // the raise was too much
      if (this.fps > 30 && this.lastFpsUp >= 0 && this.t - this.lastFpsUp < 6000) { this.fps = 30; this.fps30 = true; return false; }   // tried 60 again: no
      if (this.ratio > this.min + 1e-6) return this.set(Math.max(this.min, this.ratio * 0.85));
      if (this.fps > 30) { this.fps = 30; this.good = 0; }
      return false;
    }
    if (this.good >= 4) {
      this.good = 0;
      if (this.fps < this.baseFps) { if (!this.fps30) { this.fps = this.baseFps; this.lastFpsUp = this.t; } return false; }   // try the full rate again first (once)
      if (this.ratio < this.ceiling - 1e-6) { this.lastRaise = this.t; return this.set(Math.min(this.ceiling, this.ratio * 1.12)); }
    }
    return false;
  }

  set(r) {
    if (Math.abs(r - this.ratio) < 1e-4) return false;
    this.ratio = r;
    this.apply?.(r);
    return true;
  }
}
