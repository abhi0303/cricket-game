// Difficulty knobs. "user*" values change how forgiving the game is to the human,
// "cpu*" values change how well the computer plays.

export const DIFFICULTY = {
  easy: {
    label: 'Easy',
    timeScale: 0.6,          // deliveries play slower (real-time feel)
    userWindow: 1.35,        // timing windows when the human bats
    aimAssist: 22,           // degrees a held stick is nudged towards the nearest gap
    userEdge: 0.62,          // edge / beaten risk when the human bats
    userBowlSpread: 0.72,    // human bowling accuracy (lower = tighter)
    cpuBatSigma: 1.5,        // computer batter timing error
    cpuBatEdge: 1.35,
    cpuReadNoise: 1.4,       // how badly the computer reads length/line
    cpuBowlQuality: [0.6, 0.18],
    cpuOverstep: 0.02,
    cpuCatch: 0.88,          // computer fielders' catching
    userCatch: 1.06,
  },
  normal: {
    label: 'Normal',
    timeScale: 0.7,
    userWindow: 1.0,
    aimAssist: 12,
    userEdge: 1.0,
    userBowlSpread: 1.0,
    cpuBatSigma: 1.0,
    cpuBatEdge: 1.0,
    cpuReadNoise: 1.0,
    cpuBowlQuality: [0.75, 0.14],
    cpuOverstep: 0.012,
    cpuCatch: 1.0,
    userCatch: 1.0,
  },
  hard: {
    label: 'Hard',
    timeScale: 0.82,
    userWindow: 0.78,
    aimAssist: 0,
    userEdge: 1.28,
    userBowlSpread: 1.2,
    cpuBatSigma: 0.8,
    cpuBatEdge: 0.82,
    cpuReadNoise: 0.8,
    cpuBowlQuality: [0.85, 0.1],
    cpuOverstep: 0.007,
    cpuCatch: 1.05,
    userCatch: 0.95,
  },
};

export const diff = id => DIFFICULTY[id] || DIFFICULTY.normal;
