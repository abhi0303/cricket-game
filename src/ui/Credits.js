// Third-party work used in the game. CC BY needs the author, the work, a link and the licence wherever it's shared:
// shown on the main menu and listed in the README (and assets/models/ball/CREDITS.txt).
import { esc } from './UI.js';

export const CREDITS = [
  {
    what: 'Ball', title: 'Cricket Ball (Sports).', author: 'Rohit Pawar', authorUrl: 'https://sketchfab.com/rohit8999',
    url: 'https://sketchfab.com/3d-models/cricket-ball-sports-b13a0d69d6ca48d4b125de2cc2e7f940', license: 'CC BY 4.0', licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    what: 'Ball', title: 'Cricket Ball (Sports) (White).', author: 'Rohit Pawar', authorUrl: 'https://sketchfab.com/rohit8999',
    url: 'https://sketchfab.com/3d-models/cricket-ball-sports-white-f7fb5ae0d11e4d37a2d9ebccfcba5592', license: 'CC BY 4.0', licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
];

const a = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

/** One short line for the main menu. */
export function creditsLineHTML() {
  return `3D ball: ${CREDITS.map(c => a(c.url, c.title.replace(/\.$/, ''))).join(' and ')} by ${a(CREDITS[0].authorUrl, CREDITS[0].author)}, ${a(CREDITS[0].licenseUrl, CREDITS[0].license)} (simplified for the game)`;
}
