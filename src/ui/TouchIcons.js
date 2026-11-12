// Line icons for the touch buttons (24 x 24, drawn in the button's text colour).
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const bat = 'M15.5 3.5l5 5-9.5 9.5c-1.4 1.4-3.6 1.4-5 0s-1.4-3.6 0-5z M5 19l-2.5 2.5';
const ball = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/><path d="M${cx - r * 0.55} ${cy - r * 0.8}q${r * 0.9} ${r * 0.8} 0 ${r * 1.6} M${cx + r * 0.55} ${cy - r * 0.8}q-${r * 0.9} ${r * 0.8} 0 ${r * 1.6}" stroke-width="1.2"/>`;
const stumps = '<path d="M7 21V8 M12 21V8 M17 21V8 M6 7.5h5 M13 7.5h5"/>';

export const ICONS = {
  // batting
  ground: svg(`<path d="${bat}"/><path d="M3 22h18" stroke-width="1.6"/>`),
  lofted: svg(`<path d="M3 19c3-9 10-13 18-12"/><path d="M17 4l4 3-4 3"/>${ball(6, 18.5, 2)}`),
  defend: svg('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>'),
  advanced: svg(`<path d="M3 15c4 5 13 5 18-2"/><path d="M17 11l4 2-1.5 4"/>`),
  leave: svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11 M12 10V4.5a1.5 1.5 0 0 1 3 0V11 M15 10.5V6.5a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 7-6.5 7S6 17 5 14l-1.7-3.3a1.5 1.5 0 0 1 2.6-1.4L8 12V7.5a1.5 1.5 0 0 1 1 0"/>'),
  power: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  precision: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3"/>'),
  moveLeft: svg('<path d="M15 5l-7 7 7 7"/>'),
  moveRight: svg('<path d="M9 5l7 7-7 7"/>'),
  // running
  run: svg('<circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5 M6 12l3-4h5l2 4 3 1 M11 15l2-6"/>'),
  cancelRun: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  dive: svg('<circle cx="18" cy="6" r="2"/><path d="M3 18l6-3 5 1 4-6 M9 15l-2-4 5-2 M3 21h18"/>'),
  sprint: svg('<path d="M3 6l8 6-8 6z M12 6l8 6-8 6z"/>'),
  // bowling
  bowl: svg(ball(12, 12, 8)),
  speedUp: svg('<path d="M5 15l7-7 7 7"/><path d="M12 8v13" stroke-width="1.4"/>'),
  speedDown: svg('<path d="M5 9l7 7 7-7"/><path d="M12 3v13" stroke-width="1.4"/>'),
  lengthNext: svg('<path d="M9 3h6v18H9z" stroke-width="1.4"/><path d="M5 9l-2 3 2 3 M19 9l2 3-2 3"/><circle cx="12" cy="8" r="1.4" fill="currentColor"/>'),
  lengthPrev: svg('<path d="M9 3h6v18H9z" stroke-width="1.4"/><path d="M5 9l-2 3 2 3 M19 9l2 3-2 3"/><circle cx="12" cy="16" r="1.4" fill="currentColor"/>'),
  typeNext: svg('<path d="M12 4a8 8 0 1 1-7.4 5"/><path d="M4 4v5h5"/>'),
  typePrev: svg('<path d="M12 4a8 8 0 1 0 7.4 5"/><path d="M20 4v5h-5"/>'),
  // fielding
  throwKeeper: svg(`${stumps}<path d="M3 3l3 3" />`),
  throwBowler: svg(`${stumps}<path d="M21 3l-3 3" />`),
  throwAuto: svg(`${stumps}<path d="M12 1.5l1 2 2 .3-1.5 1.4.4 2L12 6.2 10.1 7.2l.4-2L9 3.8l2-.3z" stroke-width="1.2"/>`),
  // between balls and the top row
  continue: svg('<path d="M7 4l12 8-12 8z"/>'),
  replay: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M10 9l5 3-5 3z" stroke-width="1.4"/>'),
  camera: svg('<path d="M4 7h3l2-2.5h6L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  fullscreen: svg('<path d="M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5"/>'),
  dot: svg('<circle cx="12" cy="12" r="4"/>'),
};
