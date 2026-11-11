// Third-party work used in the game. CC BY needs the author, the work, a link and the licence wherever it's shared:
// shown on the main menu and listed in the README (and the CREDITS.txt next to each model).
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
  {
    what: 'Batsman', title: 'Virat Kohli Cricket Batting Animation - Low Poly', author: 'bhagathartworks', authorUrl: 'https://sketchfab.com/bhagathartworks',
    url: 'https://sketchfab.com/3d-models/virat-kohli-cricket-batting-animation-low-poly-a21f5e7ee14f4b6aa5cf6c94a1016932', license: 'CC BY 4.0', licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    what: 'Keeper', title: 'Stylized Cricketer', author: 'kanesk06', authorUrl: 'https://sketchfab.com/kanesk06',
    url: 'https://sketchfab.com/3d-models/stylized-cricketer-8bb84d0f58dd4dac9d85d3a2e02c176b', license: 'CC BY 4.0', licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    what: 'Fielders', title: 'indian male character', author: 'Aashutosh Dabhade', authorUrl: 'https://sketchfab.com/adabhade17',
    url: 'https://sketchfab.com/3d-models/indian-male-character-0baf0a4bbe314764a8d7b639e8f600ca', license: 'CC BY 4.0', licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
];

const a = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

/** A short credit line for the main menu: each kind of model, its works, author and licence. */
export function creditsLineHTML() {
  const groups = [];
  for (const c of CREDITS) {
    let g = groups.find(x => x.what === c.what);
    if (!g) groups.push(g = { what: c.what, items: [] });
    g.items.push(c);
  }
  return groups.map(g => `3D ${g.what.toLowerCase()}: ${g.items.map(c => a(c.url, c.title.replace(/\.$/, ''))).join(' and ')} by ${a(g.items[0].authorUrl, g.items[0].author)}, ${a(g.items[0].licenseUrl, g.items[0].license)}`).join(' · ') + ' (adapted for the game)';
}
