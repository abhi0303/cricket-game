// Default control bindings per input profile. Keyboard uses KeyboardEvent.code,
// gamepads use the W3C "standard" mapping button indices. All of it can be remapped.

export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export const PAD_LABELS = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'Home'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'PS'],
};

export const ACTION_LABELS = {
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', confirm: 'Select', back: 'Back',
  defend: 'Defensive shot', ground: 'Ground shot', lofted: 'Lofted shot', advanced: 'Advanced shot (sweep)',
  leave: 'Leave the ball', moveLeft: 'Move across the crease (left)', moveRight: 'Move across the crease (right)', power: 'Power modifier', precision: 'Precision / timing modifier',
  run: 'Call run', cancelRun: 'Send back / cancel run', dive: 'Dive to make your ground', sprint: 'Sprint (both batters, hold)',
  bowl: 'Bowl (hold, release on the meter)', typeNext: 'Next variation (swing / spin)', typePrev: 'Previous variation',
  speedUp: 'Faster delivery (km/h)', speedDown: 'Slower delivery (km/h)', lengthNext: 'Next length (yorker → bouncer)', lengthPrev: 'Previous length',
  throwKeeper: "Throw to keeper's end", throwBowler: "Throw to bowler's end", throwAuto: 'Throw: best end',
  pause: 'Pause', camera: 'Change camera', replay: 'Replay last ball', continue: 'Continue / skip',
};

/** Directional "axis" bindings shared by batting and bowling (keys bound to the batting moves are left out while batting). */
export const AXIS_KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
};

export const DEFAULT_BINDINGS = {
  menu: {
    up: { keys: ['ArrowUp', 'KeyW'], pad: [PAD.UP] },
    down: { keys: ['ArrowDown', 'KeyS'], pad: [PAD.DOWN] },
    left: { keys: ['ArrowLeft', 'KeyA'], pad: [PAD.LEFT] },
    right: { keys: ['ArrowRight', 'KeyD'], pad: [PAD.RIGHT] },
    confirm: { keys: [], pad: [PAD.A] }, // keyboard: Enter on the focused button (native)
    back: { keys: ['Escape', 'Backspace'], pad: [PAD.B] },
  },
  // Controller: the face buttons play the shots while the ball is coming and run the batters once it's
  // in play (A ground, B lofted / send back, X precision / run, Y leave / dive); RT/LT sprint.
  batting: {
    moveLeft: { keys: ['ArrowLeft'], pad: [PAD.LEFT] },
    moveRight: { keys: ['ArrowRight'], pad: [PAD.RIGHT] },
    ground: { keys: ['KeyK'], pad: [PAD.A] },
    lofted: { keys: ['KeyL'], pad: [PAD.B] },
    precision: { keys: ['KeyC'], pad: [PAD.X] },
    leave: { keys: ['KeyU'], pad: [PAD.Y] },
    defend: { keys: ['KeyJ'], pad: [PAD.RB] },
    advanced: { keys: ['KeyI'], pad: [PAD.LB] },
    power: { keys: ['ShiftLeft', 'ShiftRight'], pad: [PAD.RT] },
    run: { keys: ['Space'], pad: [PAD.X] },
    cancelRun: { keys: ['KeyQ'], pad: [PAD.B] },
    dive: { keys: ['KeyE'], pad: [PAD.Y] },
    sprint: { keys: ['ShiftLeft', 'ShiftRight'], pad: [PAD.RT, PAD.LT] },
    pause: { keys: ['Escape', 'KeyP'], pad: [PAD.START] },
    camera: { keys: ['KeyV'], pad: [PAD.BACK] },
  },
  bowling: {
    bowl: { keys: ['KeyJ', 'Space'], pad: [PAD.A] },
    typeNext: { keys: ['KeyK'], pad: [PAD.X] },
    typePrev: { keys: ['KeyI'], pad: [PAD.LB] },
    speedUp: { keys: ['KeyE'], pad: [PAD.Y] },
    speedDown: { keys: ['KeyQ'], pad: [PAD.B] },
    lengthNext: { keys: ['KeyL'], pad: [PAD.RB] },
    lengthPrev: { keys: ['KeyO'], pad: [PAD.LT] },
    power: { keys: ['ShiftLeft', 'ShiftRight'], pad: [PAD.RT] },
    pause: { keys: ['Escape', 'KeyP'], pad: [PAD.START] },
    camera: { keys: ['KeyV'], pad: [PAD.BACK] },
  },
  fielding: {
    throwKeeper: { keys: ['KeyJ'], pad: [PAD.A] },
    throwBowler: { keys: ['KeyL'], pad: [PAD.B] },
    throwAuto: { keys: ['KeyK'], pad: [PAD.X] },
    pause: { keys: ['Escape', 'KeyP'], pad: [PAD.START] },
  },
  between: {
    continue: { keys: ['Enter', 'Space', 'KeyJ'], pad: [PAD.A] },
    replay: { keys: ['KeyR'], pad: [PAD.Y] },
    pause: { keys: ['Escape', 'KeyP'], pad: [PAD.START] },
    camera: { keys: ['KeyV'], pad: [PAD.BACK] },
  },
  paused: {
    up: { keys: ['ArrowUp', 'KeyW'], pad: [PAD.UP] },
    down: { keys: ['ArrowDown', 'KeyS'], pad: [PAD.DOWN] },
    left: { keys: ['ArrowLeft', 'KeyA'], pad: [PAD.LEFT] },
    right: { keys: ['ArrowRight', 'KeyD'], pad: [PAD.RIGHT] },
    confirm: { keys: [], pad: [PAD.A] }, // keyboard: Enter on the focused button (native)
    back: { keys: ['Escape', 'Backspace'], pad: [PAD.B] },
    pause: { keys: ['KeyP'], pad: [PAD.START] },
  },
};

export const PROFILE_LABELS = { batting: 'Batting', bowling: 'Bowling', fielding: 'Fielding', between: 'Between balls', menu: 'Menus', paused: 'Paused' };

export function cloneBindings(b = DEFAULT_BINDINGS) { return JSON.parse(JSON.stringify(b)); }

// Saved bindings carry a layout version. Version 2 moved the batting shots and running onto the controller's
// face buttons, so controller buttons saved under an older layout fall back to the new defaults (keys are kept).
export const BINDINGS_VERSION = 2;
const PAD_LAYOUT_CHANGED = { 2: ['batting'] };

/** Merge saved bindings over the defaults (ignores unknown actions). */
export function mergeBindings(saved) {
  const out = cloneBindings();
  if (!saved || typeof saved !== 'object') return out;
  const v = Number(saved._v) || 1;
  const resetPad = new Set(Object.entries(PAD_LAYOUT_CHANGED).filter(([ver]) => v < Number(ver)).flatMap(([, profs]) => profs));
  for (const [prof, acts] of Object.entries(out)) {
    for (const act of Object.keys(acts)) {
      const s = saved[prof]?.[act];
      if (!s || !Array.isArray(s.keys) || !Array.isArray(s.pad)) continue;
      out[prof][act] = { keys: s.keys.slice(0, 3), pad: resetPad.has(prof) ? out[prof][act].pad : s.pad.filter(Number.isInteger).slice(0, 2) };
    }
  }
  return out;
}

/** What to store: the bindings plus the layout version. */
export function bindingsForSave(b) { return { ...b, _v: BINDINGS_VERSION }; }

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Bksp', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', ControlLeft: 'Ctrl', AltLeft: 'Alt' };
  return map[code] || code;
}
