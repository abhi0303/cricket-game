// localStorage wrappers that never throw (private mode, quota, disabled storage).
const PREFIX = 'lpcricket.';

export const Storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ } },
};

export const DEFAULT_SETTINGS = {
  overs: 5,
  format: 'limited',      // 'limited' (5/10/20 overs) or 'test' (5 days, 90 overs a day)
  freeHit: true,          // free hit after a no-ball (limited overs only)
  difficulty: 'normal',
  stadium: 'harbour',
  timeOfDay: 'day',
  opponent: 'random',
  tossMode: 'coin',
  userBatsFirst: true,
  sound: true,
  volume: 0.7,
  quality: 'medium',
  battingCamera: 'behind',
  bowlingCamera: 'behindBowler',
  assistRunning: false,
  aimMarker: true,
  autoReplay: true,
  hints: 'on',            // the button card under the field chart
  touch: 'auto',          // on-screen touch controls: 'auto' (phones, tablets, or once a finger is used), 'on', 'off'
};
