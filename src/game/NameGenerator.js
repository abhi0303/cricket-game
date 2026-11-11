// Fictional player and team names.

const FIRST = [
  'Arlo', 'Dev', 'Kofi', 'Hamish', 'Rafi', 'Theo', 'Nikhil', 'Jonah', 'Callum', 'Tavish', 'Omar', 'Felix',
  'Mateo', 'Lachlan', 'Zubair', 'Kenji', 'Elias', 'Pranav', 'Brody', 'Sami', 'Viktor', 'Desmond', 'Aarav',
  'Ronan', 'Ezra', 'Kian', 'Idris', 'Jasper', 'Milan', 'Tariq', 'Wyatt', 'Anand', 'Corbin', 'Luca', 'Nilesh',
  'Oisin', 'Reuben', 'Silas', 'Tobias', 'Yusuf', 'Bilal', 'Dario', 'Emeka', 'Farhan', 'Gideon', 'Harlan',
  'Ishaan', 'Jory', 'Keanu', 'Leandro', 'Marlon', 'Niko', 'Orrin', 'Quentin', 'Rory', 'Sunny', 'Ved', 'Zeke',
];

const LAST = [
  'Mensah', 'Okafor', 'Lindqvist', 'Rao', 'Barrett', 'Fonseca', 'Halloran', 'Quint', 'Dasgupta', 'Whitfield',
  'Nakamura', 'Pereira', 'Ashby', 'Kowalski', 'Varga', 'Castillo', 'Thorne', 'Bhatt', 'Okoro', 'Ferris',
  'Llewellyn', 'Doyle', 'Sato', 'Hartley', 'Mirza', 'Banerjee', 'Sutton', 'Pryce', 'Ndlovu', 'Fraser',
  'Kelner', 'Abara', 'Brennan', 'Chowdhury', 'Delacroix', 'Eastwood', 'Fairbairn', 'Gallagher', 'Hossain',
  'Ingram', 'Jansen', 'Kariuki', 'Lomax', 'Madsen', 'Nair', 'Oduya', 'Prescott', 'Quayle', 'Rahim', 'Sandhu',
  'Talbot', 'Underhill', 'Vance', 'Wardle', 'Yeoman', 'Zaidi', 'Achterberg', 'Bose', 'Carver', 'Duggan',
];

export const CPU_TEAMS = [
  { name: 'Harbour Hawks', short: 'HHK', primary: '#1f6feb', secondary: '#f2c94c', emblem: { shape: 'shield', icon: 'wings' } },
  { name: 'Ridgeback Rangers', short: 'RBR', primary: '#b3261e', secondary: '#ffffff', emblem: { shape: 'circle', icon: 'stumps' } },
  { name: 'Monsoon Mavericks', short: 'MNM', primary: '#0f8b8d', secondary: '#f9f871', emblem: { shape: 'hexagon', icon: 'bolt' } },
  { name: 'Sandstorm Strikers', short: 'SSS', primary: '#e07a1f', secondary: '#2b2d42', emblem: { shape: 'diamond', icon: 'sun' } },
  { name: 'Northern Lynx', short: 'NLX', primary: '#5b3fa6', secondary: '#c0f0ff', emblem: { shape: 'shield', icon: 'star' } },
  { name: 'Coral Coast XI', short: 'CCX', primary: '#ff5a76', secondary: '#123c69', emblem: { shape: 'circle', icon: 'wave' } },
  { name: 'Ironwood Owls', short: 'IWO', primary: '#3d5a40', secondary: '#e9c46a', emblem: { shape: 'hexagon', icon: 'crown' } },
];

export function randomName(rng, used = new Set()) {
  for (let i = 0; i < 50; i++) {
    const n = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
  const n = `${rng.pick(FIRST)} ${rng.pick(LAST)} ${used.size}`;
  used.add(n);
  return n;
}
