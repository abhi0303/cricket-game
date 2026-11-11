// Procedural animation clips for the low-poly players.
// A pose is joint rotations in degrees ([x, y, z], Euler XYZ) plus optional root offset,
// bat keyframe (handle H, toe T, face direction F in the character's local space) and IK hand targets.
// Character local space: +z = facing direction, +x = character's left, y up.
// For a right-handed batter facing the off side, +x points at the bowler.

// Pose channels. 'torso' is shared by the spine and chest bones, 'head' by the neck and head.
const JOINTS = ['hips', 'torso', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR', 'handL', 'handR', 'footL', 'footR'];
export { JOINTS };

const S = Math.sin, C = Math.cos;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);

export function emptyPose() {
  const p = { root: [0, 0, 0], rootRot: [0, 0, 0], bat: null, ikL: null, ikR: null, ballHand: null, legIK: 0, ftL: null, ftR: null, poleL: null, poleR: null };
  for (const j of JOINTS) p[j] = [0, 0, 0];
  return p;
}

function base(o = {}) {
  const p = emptyPose();
  p.armL = [0, 0, 7]; p.armR = [0, 0, -7]; p.foreL = [-8, 0, 0]; p.foreR = [-8, 0, 0];
  return Object.assign(p, o);
}

// Optional array channels: foot targets for leg IK ([x, z, yaw°, heel lift m] in root space)
// and elbow pole directions for the arm IK (root space).
const OPT = ['ftL', 'ftR', 'poleL', 'poleR'];

/** Copy/blend helpers */
export function copyPose(dst, src) {
  for (const j of JOINTS) { dst[j][0] = src[j][0]; dst[j][1] = src[j][1]; dst[j][2] = src[j][2]; }
  dst.root = src.root.slice(); dst.rootRot = src.rootRot.slice();
  dst.bat = src.bat ? { H: src.bat.H.slice(), T: src.bat.T.slice(), F: src.bat.F.slice() } : null;
  dst.ikL = src.ikL ? src.ikL.slice() : null; dst.ikR = src.ikR ? src.ikR.slice() : null;
  dst.ballHand = src.ballHand;
  dst.legIK = src.legIK || 0;
  for (const k of OPT) dst[k] = src[k] ? src[k].slice() : null;
  return dst;
}

const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const lerpN = (a, b, t) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => lerp(a[i] ?? 0, b[i] ?? 0, t));

export function blendPose(out, a, b, t) {
  for (const j of JOINTS) out[j] = lerp3(a[j], b[j], t);
  out.root = lerp3(a.root, b.root, t);
  out.rootRot = lerp3(a.rootRot, b.rootRot, t);
  if (a.bat && b.bat) out.bat = { H: lerp3(a.bat.H, b.bat.H, t), T: lerp3(a.bat.T, b.bat.T, t), F: lerp3(a.bat.F, b.bat.F, t) };
  else out.bat = t < 0.5 ? (a.bat && { ...a.bat }) : (b.bat && { ...b.bat });
  out.ikL = t < 0.5 ? a.ikL : b.ikL;
  out.ikR = t < 0.5 ? a.ikR : b.ikR;
  out.ballHand = t < 0.5 ? a.ballHand : b.ballHand;
  // IK fades in/out; targets are kept from whichever side has them
  out.legIK = lerp(a.legIK || 0, b.legIK || 0, t);
  for (const k of OPT) out[k] = a[k] && b[k] ? lerpN(a[k], b[k], t) : (a[k] || b[k]) ? (b[k] || a[k]).slice() : null;
  return out;
}

// A pose as one flat number vector (for spline interpolation)
const FLAT_OPT = [['ftL', 4], ['ftR', 4], ['poleL', 3], ['poleR', 3]];
const ZERO_BAT = { H: [0, 0, 0], T: [0, 0, 0], F: [0, 0, 1] };
function flatten(p) {
  const a = [];
  for (const j of JOINTS) a.push(p[j][0], p[j][1], p[j][2]);
  a.push(...p.root, ...p.rootRot, p.legIK || 0);
  const bat = p.bat || ZERO_BAT;
  a.push(...bat.H, ...bat.T, ...bat.F);
  for (const [k, n] of FLAT_OPT) for (let i = 0; i < n; i++) a.push(p[k] ? p[k][i] : 0);
  return a;
}
function unflatten(a, out, like) {
  let i = 0;
  const take = n => a.slice(i, (i += n));
  for (const j of JOINTS) out[j] = take(3);
  out.root = take(3); out.rootRot = take(3); out.legIK = take(1)[0];
  const H = take(3), T = take(3), F = take(3);
  out.bat = like.bat ? { H, T, F } : null;
  for (const [k, n] of FLAT_OPT) { const v = take(n); out[k] = like[k] ? v : null; }
  for (const k of ['ftL', 'ftR']) if (out[k]) out[k][3] = Math.max(0, out[k][3]);   // spline overshoot: heels can't go below the sole
  out.legIK = Math.min(1, Math.max(0, out.legIK));
  out.ikL = like.ikL; out.ikR = like.ikR; out.ballHand = like.ballHand;
  return out;
}

/**
 * Keyframed clip: keys = [[time, partialPose], ...]; missing joints inherit from `basePose`.
 * spline: Catmull-Rom style (C1) interpolation through the keys instead of easing in and out of
 * every key, so a swing keeps its speed through contact and the bat follows a curved arc.
 */
function keyed(dur, keys, { loop = false, basePose = base(), spline = false } = {}) {
  const full = keys.map(([t, k]) => {
    const p = copyPose(emptyPose(), basePose);
    for (const [name, v] of Object.entries(k)) {
      if (name === 'bat') p.bat = v ? { H: v.H.slice(), T: v.T.slice(), F: (v.F || [1, 0, 0]).slice() } : null;
      else if (v == null || typeof v !== 'object') p[name] = v;
      else p[name] = v.slice();
    }
    return [t, p];
  });
  let flats = null, tans = null;
  if (spline) {
    flats = full.map(([, p]) => flatten(p));
    tans = flats.map((f, k) => {
      if (k === 0 || k === flats.length - 1) return f.map(() => 0);
      const dt = full[k + 1][0] - full[k - 1][0];
      return f.map((_, c) => (flats[k + 1][c] - flats[k - 1][c]) / dt);
    });
  }
  return {
    dur, loop,
    sample(t, out) {
      let tt = loop ? ((t % dur) + dur) % dur : Math.min(t, dur);
      if (tt <= full[0][0]) return copyPose(out, full[0][1]);
      for (let i = 0; i < full.length - 1; i++) {
        const [t0, p0] = full[i], [t1, p1] = full[i + 1];
        if (tt > t1) continue;
        const u = (tt - t0) / (t1 - t0);
        if (!spline) return blendPose(out, p0, p1, ease(u));
        const h = t1 - t0, u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * h, h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * h;
        const a = flats[i], b = flats[i + 1], ma = tans[i], mb = tans[i + 1];
        const v = a.map((_, c) => h00 * a[c] + h10 * ma[c] + h01 * b[c] + h11 * mb[c]);
        return unflatten(v, out, u < 0.5 ? p0 : p1);
      }
      return copyPose(out, full[full.length - 1][1]);
    },
  };
}

/** Procedural clip from a function (t, out) */
function proc(dur, fn, loop = true) { return { dur, loop, sample(t, out) { const p = base(); fn(t, p); return copyPose(out, p); } }; }

// ---------------------------------------------------------------- locomotion
function runPose(t, p, { period = 0.62, amp = 1, carryBat = false, ball = false } = {}) {
  const ph = (t / period) * Math.PI * 2;
  const s = S(ph);
  p.thighL = [-42 * s * amp - 8, 0, 3]; p.thighR = [42 * s * amp - 8, 0, -3];
  p.shinL = [30 + 55 * Math.max(0, -S(ph - 0.6)) * amp, 0, 0];
  p.shinR = [30 + 55 * Math.max(0, S(ph - 0.6)) * amp, 0, 0];
  p.armL = [38 * s * amp, 0, 10]; p.armR = [-38 * s * amp, 0, -10];
  p.foreL = [-75, 0, 0]; p.foreR = [-75, 0, 0];
  p.torso = [12 * amp, 4 * s, 0]; p.head = [-6 * amp, -4 * s, 0];
  p.root = [0, Math.abs(C(ph)) * 0.05 * amp - 0.03 * amp, 0];
  if (carryBat) {
    p.armR = [-30, 0, -12]; p.foreR = [-50, 0, 0];
    p.bat = { H: [-0.22, 0.95, 0.42], T: [-0.25, 0.85, 1.25], F: [-1, 0, 0] };
  }
  if (ball) p.ballHand = 'R';
}

function walkPose(t, p, period = 1.0) {
  const ph = (t / period) * Math.PI * 2, s = S(ph);
  p.thighL = [-20 * s, 0, 2]; p.thighR = [20 * s, 0, -2];
  p.shinL = [10 + 20 * Math.max(0, -S(ph - 0.5)), 0, 0]; p.shinR = [10 + 20 * Math.max(0, S(ph - 0.5)), 0, 0];
  p.armL = [15 * s, 0, 8]; p.armR = [-15 * s, 0, -8];
  p.root = [0, Math.abs(C(ph)) * 0.02 - 0.01, 0];
}

// ---------------------------------------------------------------- batting
// Batter local space: +x points at the bowler, +z at the off side (the way the body faces), y up.
// Feet are planted with leg IK: FT(x, z, yaw°, heel) — yaw > 0 opens the toes towards the bowler,
// heel lifts the heel (m) with the toes kept on the grass.
// Bats are authored as BAT(top of the handle, handle direction (toe -> handle), face direction)
// or BATS(sweet spot, ...); the face defaults to "facing the way the swing travels".
const DEG = Math.PI / 180;
const FT = (x, z, yaw = 0, heel = 0) => [x, z, yaw, heel];
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const BAT_LEN = 0.85, SWEET = 0.62;
function BAT(H, axis, F) {
  const a = nrm(axis);
  return { H, T: [H[0] - a[0] * BAT_LEN, H[1] - a[1] * BAT_LEN, H[2] - a[2] * BAT_LEN], F: F || [a[1], -a[0], 0.12] };
}
function BATS(S, axis, F) { const a = nrm(axis); return BAT([S[0] + a[0] * SWEET, S[1] + a[1] * SWEET, S[2] + a[2] * SWEET], a, F); }
/** Middle of the bat (root space) for a bat keyframe. */
export function sweetSpot(bat) {
  const a = nrm([bat.H[0] - bat.T[0], bat.H[1] - bat.T[1], bat.H[2] - bat.T[2]]);
  return [bat.H[0] - a[0] * SWEET, bat.H[1] - a[1] * SWEET, bat.H[2] - a[2] * SWEET];
}
// Turn a swing towards the off side (deg > 0) or the leg side about a vertical axis through the chest.
const PIV = [0.3, 0.1];
const rotV = (v, deg) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]; };
const rotP = (p, deg) => { const r = rotV([p[0] - PIV[0], p[1], p[2] - PIV[1]], deg); return [r[0] + PIV[0], r[1], r[2] + PIV[1]]; };
const rotBat = (b, deg) => ({ H: rotP(b.H, deg), T: rotP(b.T, deg), F: rotV(b.F, deg) });

const STANCE = {
  legIK: 1, ftL: FT(0.2, 0.03, 12), ftR: FT(-0.2, 0, -3),
  root: [0, -0.09, -0.03], hips: [0, 4, 0], torso: [28, 8, -3], head: [-24, 70, -6],
  // FK fallback for blends with clips that don't plant the feet
  thighL: [-22, 0, 13], shinL: [36, 0, 0], thighR: [-20, 0, -13], shinR: [34, 0, 0],
  poleL: [0.9, -0.5, 0.2], poleR: [-0.4, -1, 0],
  bat: BAT([0.05, 0.8, 0.2], [0.12, 1, -0.14], [1, 0, 0.2]),
};
// Trigger + backlift: back foot back and across, bat up towards the slips with an open face.
const BACKLIFT = {
  ...STANCE, ftL: FT(0.19, 0.05, 12, 0.015), ftR: FT(-0.25, 0.07, -3),
  root: [-0.03, -0.095, -0.01], torso: [24, 2, 0], head: [-20, 74, -4],
  poleL: [1, -0.3, 0.3], poleR: [-0.8, -0.6, 0],
  bat: BAT([-0.12, 1.12, 0.2], [0.55, -0.8, 0.12], [0.1, 0.25, 1]),
};

/** Shot clips: contact always happens at t = CONTACT_T. */
export const CONTACT_T = 0.2;

/**
 * Front-foot stroke: stride in, head over the ball, bat down in a vertical arc, through the line and up into a
 * high finish. dir turns the swing plane towards the off side (+) or leg side (-).
 */
function frontShot({ dir = 0, stride = FT(0.7, 0.15, 32), sweet = [0.8, 0.3, 0.38], axis = [0.02, 1, -0.05], face = [1, 0.05, 0.05],
  contactBody = {}, finish = 'high', finishBody = {}, through = null, top = null }) {
  const R = b => rotBat(b, dir);
  const landing = {
    ...BACKLIFT, ftL: FT(stride[0] * 0.75, stride[1] * 0.8, stride[2] * 0.8, 0.07), ftR: FT(-0.23, 0.06, 2, 0.02),
    root: [0.16, -0.11, 0.03], hips: [0, 8, 0], torso: [25, 6, -10], head: [-8, 70, -10],
    bat: R(BAT([0.2, 1.1, 0.28], [0.78, -0.62, 0.02])), poleL: rotV([1, 0.1, 0.3], dir), poleR: [-0.6, -0.8, 0.1],
  };
  const contact = {
    ...landing, ftL: stride, ftR: FT(-0.22, 0.05, 12, 0.05),
    root: [0.42, -0.18, 0.06], hips: [0, 14, 0], torso: [36, 4, -20], head: [16, 58, -14],
    bat: BATS(sweet, axis, face), poleL: [1, 0.6, 0.15], poleR: [-0.2, -1, 0.35], ...contactBody,
  };
  if (finish === 'none') {   // defensive: dead bat, hold the shape
    const hold = { ...contact, bat: BATS([sweet[0] - 0.03, sweet[1] - 0.02, sweet[2]], axis, face), root: [contact.root[0] - 0.02, contact.root[1], contact.root[2]] };
    return keyed(1.4, [[0, BACKLIFT], [0.1, landing], [CONTACT_T, contact], [0.34, hold], [0.85, hold], [1.4, { ...hold, ftR: FT(-0.22, 0.05, 8, 0), root: [0.3, -0.14, 0.05], torso: [24, 6, -10], head: [0, 66, -8], bat: BAT([0.55, 0.92, 0.32], [0.2, 1, 0]) }]], { spline: true });
  }
  const thru = {
    ...contact, ftR: FT(-0.2, 0.05, 20, 0.07), root: [0.44, -0.16, 0.06], torso: [30, 10, -18], head: [8, 54, -12],
    bat: through || R(BAT([0.88, 1.2, 0.33], [-0.6, -0.8, 0.02])), poleL: rotV([1, 0.4, 0.3], dir), poleR: rotV([0.3, -0.8, 0.5], dir),
  };
  const high = {
    ...thru, ftR: FT(-0.17, 0.05, 28, 0.09), root: [0.42, -0.12, 0.05], hips: [0, 20, 0], torso: [16, 20, -12], head: [-6, 46, -6],
    bat: top || R(BAT([0.58, 1.58, 0.3], [0.68, -0.68, 0.22])), poleL: rotV([1, 0.2, 0.3], dir), poleR: rotV([0.6, -0.5, 0.6], dir), ...finishBody,
  };
  const relax = { ...high, ftR: FT(-0.17, 0.05, 22, 0.05), root: [0.36, -0.11, 0.04], torso: [20, 14, -8], head: [-10, 52, -4], bat: R(BAT([0.5, 1.02, 0.3], [0.25, 1, 0.05])), poleL: [0.8, -0.5, 0.2], poleR: [-0.3, -1, 0.2] };
  return keyed(1.6, [[0, BACKLIFT], [0.1, landing], [CONTACT_T, contact], [0.3, thru], [0.48, high], [0.95, high], [1.6, relax]], { spline: true });
}

// Back-foot base: back foot goes back and across, front foot slides back to it.
const BACKFOOT = { ftR: FT(-0.32, 0.2, -2), ftL: FT(0.1, 0.08, 14, 0.03), root: [-0.13, -0.05, 0.1], hips: [0, 6, 0], torso: [12, 8, -2], head: [-4, 72, -4] };
function backShot({ sweet = [-0.06, 0.72, 0.42], axis = [0.14, 1, -0.02], face = [1, 0, 0.05], body = {}, follow = null, followBody = {} }) {
  const move = { ...BACKLIFT, ...BACKFOOT, ftR: FT(-0.3, 0.17, -2, 0.04), ftL: FT(0.15, 0.06, 13, 0.04), root: [-0.1, -0.04, 0.07], bat: BAT([-0.02, 1.25, 0.3], [0.6, -0.75, 0.1]) };
  const contact = { ...BACKLIFT, ...BACKFOOT, bat: BATS(sweet, axis, face), poleL: [1, 0.7, 0.1], poleR: [-0.3, -1, 0.3], ...body };
  if (!follow) {
    const hold = { ...contact, bat: BATS([sweet[0] - 0.02, sweet[1] - 0.02, sweet[2]], axis, face) };
    return keyed(1.4, [[0, BACKLIFT], [0.1, move], [CONTACT_T, contact], [0.34, hold], [0.85, hold], [1.4, { ...hold, torso: [18, 8, -2], head: [-10, 72, -4], bat: BAT([0.08, 0.98, 0.3], [0.15, 1, 0]) }]], { spline: true });
  }
  const end = { ...contact, ...followBody, bat: follow };
  return keyed(1.6, [[0, BACKLIFT], [0.1, move], [CONTACT_T, contact], [0.34, { ...end, bat: { H: follow.H.map((v, i) => (v + contact.bat.H[i]) / 2), T: follow.T.map((v, i) => (v + contact.bat.T[i]) / 2), F: follow.F } }], [0.5, end], [1.0, end], [1.6, { ...end, torso: [18, 8, -2], head: [-10, 72, -4], bat: BAT([0.08, 0.98, 0.3], [0.15, 1, 0]) }]], { spline: true });
}

/** Pull/hook: back and across, turn the hips, roll the bat over the ball and finish over the front shoulder. */
function pullShot({ high = false }) {
  const h = high ? 0.32 : 0;
  const feet = { ftR: FT(-0.42, 0.16, 30), ftL: FT(0.06, -0.04, 45, 0.05) };
  const move = { ...BACKLIFT, ...feet, ftL: FT(0.12, 0.02, 25, 0.06), root: [-0.2, -0.04, 0.06], hips: [0, 20, 0], torso: [10, 10, 0], head: [-8, 72, -4],
    bat: BAT([-0.18, 1.35 + h * 0.5, 0.28], [0.35, -0.75, -0.55]), poleL: [1, -0.2, 0.2], poleR: [-0.6, -0.6, -0.4] };
  const contact = { ...move, ...feet, root: [-0.3, -0.05, 0.06], hips: [0, 55, 0], torso: [high ? -2 : 6, 30, 6], head: [high ? -22 : -10, 22, 0],
    bat: BATS([-0.06, 1.12 + h, 0.34], [-0.28, -0.12, -1], [0.8, -0.15, -0.55]), poleL: [0.2, -1, -0.4], poleR: [0.1, -1, 0.5] };
  const thru = { ...contact, root: [-0.3, -0.04, 0.04], hips: [0, 85, 0], torso: [high ? -4 : 4, 50, 6], head: [high ? -20 : -8, 0, 0],
    bat: BAT([-0.2, 1.2 + h, -0.22], [0.55, 0.05, 0.85]), poleL: [-0.4, -0.6, -0.6], poleR: [0.7, -0.6, 0.2] };
  const finish = { ...thru, ftR: FT(-0.4, 0.16, 60, 0.06), hips: [0, 100, 0], torso: [high ? -6 : 2, 60, 6], head: [high ? -16 : -6, -10, 0],
    bat: BAT([-0.3, 1.45 + h * 0.6, -0.12], [0.45, -0.55, 0.7]), poleL: [-0.5, 0.2, -0.8], poleR: [0.8, -0.2, 0.4] };
  return keyed(1.6, [[0, BACKLIFT], [0.1, move], [CONTACT_T, contact], [0.3, thru], [0.48, finish], [1.0, finish], [1.6, { ...finish, hips: [0, 70, 0], torso: [6, 40, 4], bat: BAT([-0.25, 1.05, 0.0], [0.3, 1, 0.2]) }]], { spline: true });
}

const SHOT_CLIPS = {
  defend: frontShot({ stride: FT(0.66, 0.14, 26), sweet: [0.74, 0.24, 0.36], axis: [0.14, 1, -0.04], face: [1, -0.25, 0.04], finish: 'none',
    contactBody: { root: [0.4, -0.19, 0.06], torso: [38, 2, -18], head: [20, 60, -14] } }),
  defendBack: backShot({ sweet: [-0.04, 0.68, 0.42], axis: [0.22, 1, -0.02], face: [1, -0.15, 0.04] }),
  straightDrive: frontShot({}),
  coverDrive: frontShot({ dir: 28, stride: FT(0.66, 0.3, 42), sweet: [0.78, 0.3, 0.58], axis: [0.15, 1, -0.12], face: [0.72, 0.05, 0.68],
    contactBody: { torso: [38, 8, -18] }, finishBody: { torso: [16, 30, -10] } }),
  flick: frontShot({ dir: -42, stride: FT(0.68, 0.08, 22), sweet: [0.8, 0.32, 0.24], axis: [0.15, 1, 0.08], face: [0.45, 0, -0.9],
    contactBody: { torso: [34, 0, -20] }, finishBody: { torso: [14, 4, -10], head: [-4, 34, -4] },
    top: BAT([0.36, 1.48, -0.08], [0.55, -0.6, 0.55]) }),
  punch: backShot({ sweet: [0.0, 0.8, 0.52], axis: [0.22, 1, -0.1], face: [0.72, 0, 0.66],
    follow: BAT([0.3, 1.3, 0.52], [-0.45, 0.7, -0.4]), followBody: { torso: [14, 18, -6], poleL: [1, 0.6, 0.3], poleR: [0.2, -1, 0.5] } }),
  cut: (() => {
    const feet = { ftR: FT(-0.26, 0.34, 20), ftL: FT(0.16, 0.2, 32, 0.05) };
    const up = { ...BACKLIFT, ...feet, ftR: FT(-0.26, 0.28, 10, 0.03), root: [-0.06, -0.04, 0.14], torso: [12, 0, 4], head: [-6, 70, 0],
      bat: BAT([-0.02, 1.52, 0.3], [0.25, -0.85, -0.45]), poleL: [0.6, 0.2, 0.8], poleR: [-0.8, -0.2, 0.3] };
    const contact = { ...up, ...feet, root: [-0.1, -0.1, 0.18], hips: [0, 0, 0], torso: [24, -12, 8], head: [6, 64, 4],
      bat: BATS([-0.1, 0.9, 0.86], [-0.62, 0.32, -0.72], [0.55, -0.45, 0.7]), poleL: [0.3, -0.6, 0.8], poleR: [-0.7, -0.7, 0.2] };
    const thru = { ...contact, torso: [22, -24, 8], bat: BAT([-0.3, 0.98, 0.42], [0.25, 0.2, -1]), poleL: [0, -0.5, 1], poleR: [-0.9, -0.4, 0] };
    const finish = { ...thru, torso: [16, -22, 6], head: [-4, 60, 0], bat: BAT([-0.25, 1.3, 0.35], [0.1, -0.7, -0.7]), poleL: [0.2, 0.2, 1], poleR: [-1, -0.2, 0.2] };
    return keyed(1.6, [[0, BACKLIFT], [0.1, up], [CONTACT_T, contact], [0.3, thru], [0.48, finish], [1.0, finish], [1.6, { ...finish, torso: [12, -6, 2], bat: BAT([-0.05, 0.95, 0.35], [0.15, 1, 0]) }]], { spline: true });
  })(),
  pull: pullShot({}),
  hook: pullShot({ high: true }),
  lofted: frontShot({ stride: FT(0.76, 0.14, 30), sweet: [0.84, 0.36, 0.38], axis: [0.05, 1, -0.04], face: [1, 0.22, 0.05],
    contactBody: { root: [0.46, -0.17, 0.06], torso: [30, 6, -20], head: [10, 58, -14] },
    through: BAT([0.9, 1.32, 0.32], [-0.75, -0.65, 0.02]), top: BAT([0.55, 1.72, 0.25], [0.5, -0.85, 0.18]),
    finishBody: { torso: [8, 28, -12], head: [-14, 40, -6] } }),
  sweep: (() => {
    // down on the back knee, front leg bent, bat swept horizontally across the line
    const legs = { ftL: FT(0.66, 0.22, 25), ftR: FT(-0.28, 0.06, -10, 0.12) };
    const down = { ...BACKLIFT, ...legs, ftL: FT(0.5, 0.18, 20, 0.05), root: [0.15, -0.3, 0.06], torso: [34, 10, -8], head: [8, 66, -6],
      bat: BAT([0.2, 0.95, 0.4], [0.35, 0.1, -0.9]), poleL: [1, 0, 0.3], poleR: [-0.5, -0.5, 0.5] };
    const contact = { ...down, ...legs, root: [0.34, -0.5, 0.08], hips: [0, 10, 0], torso: [44, 20, -12], head: [18, 56, -10],
      bat: BATS([0.92, 0.18, 0.4], [-0.55, 0.3, -0.75], [0.85, 0.1, -0.5]), poleL: [0.6, 0.5, -0.3], poleR: [0, -1, 0.5] };
    const thru = { ...contact, torso: [38, 40, -6], head: [12, 30, -6], bat: BAT([0.45, 0.6, -0.15], [0.45, 0.2, 0.85]), poleL: [0.6, 0.5, -0.6], poleR: [0.6, -0.6, 0.4] };
    const finish = { ...thru, torso: [30, 50, -6], bat: BAT([0.25, 0.9, -0.3], [0.45, -0.5, 0.75]) };
    return keyed(1.6, [[0, BACKLIFT], [0.1, down], [CONTACT_T, contact], [0.3, thru], [0.5, finish], [1.1, finish], [1.6, { ...finish, root: [0.2, -0.3, 0.06], torso: [24, 20, -6], bat: BAT([0.3, 0.9, 0.2], [0.3, 1, 0]) }]], { spline: true });
  })(),
  leave: keyed(1.4, [
    [0, BACKLIFT],
    [0.12, { ...BACKLIFT, ...BACKFOOT, root: [-0.1, -0.04, 0.06], bat: BAT([-0.06, 1.45, 0.12], [0.35, -0.9, 0.2]) }],
    [CONTACT_T, { ...BACKLIFT, ...BACKFOOT, root: [-0.12, -0.04, 0.06], torso: [8, 2, 0], head: [-8, 80, 0], bat: BAT([-0.02, 1.6, 0.08], [0.25, -0.95, 0.15]), poleL: [0.6, 0.3, 0.7], poleR: [-0.6, 0.2, -0.7] }],
    [1.0, { ...BACKLIFT, ...BACKFOOT, root: [-0.12, -0.04, 0.06], torso: [8, 0, 0], head: [-6, 110, 0], bat: BAT([-0.02, 1.55, 0.08], [0.25, -0.95, 0.15]), poleL: [0.6, 0.3, 0.7], poleR: [-0.6, 0.2, -0.7] }],
    [1.4, { ...STANCE, ...BACKFOOT, torso: [18, 4, 0], head: [-10, 74, -4], bat: BAT([0.04, 0.98, 0.3], [0.1, 1, 0]) }],
  ], { spline: true }),
};

// Played and missed: bat comes up, head turns to look back at the keeper (front- or back-foot shape).
function beatenClip(feet) {
  return keyed(1.6, [
    [0, { ...STANCE, ...feet, bat: BAT([0.35, 1.0, 0.36], [0.2, 1, 0]) }],
    [0.35, { ...STANCE, ...feet, torso: [10, -4, -4], head: [-4, 140, -4], bat: BAT([0.1, 1.35, 0.25], [0.3, -0.95, 0.15]), poleL: [0.6, 0.2, 0.7], poleR: [-0.6, 0.2, -0.6] }],
    [1.6, { ...STANCE, ...feet, torso: [12, 4, -4], head: [8, 100, -4], bat: BAT([0.1, 0.95, 0.3], [0.15, 1, 0]) }],
  ], { spline: true });
}
const BEATEN_FRONT = { ftL: FT(0.66, 0.15, 30), ftR: FT(-0.2, 0.05, 15, 0.05), root: [0.3, -0.14, 0.05] };
const BEATEN_BACK = { ...BACKFOOT };

// ---------------------------------------------------------------- bowling
/**
 * Bowling action, release at RELEASE_T. style: 'fast' | 'medium' | 'offspin' | 'legspin'.
 * Fast bowlers leap higher, arch the back and follow through hard; spinners stay upright
 * with a shorter gather and flick the wrist at release (opposite directions for off/leg spin).
 */
function deliverClip(style) {
  const fast = style === 'fast', spin = style === 'offspin' || style === 'legspin';
  const leap = fast ? 0.26 : spin ? 0.07 : 0.17;
  const arch = fast ? -22 : spin ? -4 : -12;
  const follow = fast ? 58 : spin ? 30 : 45;
  const wrist = style === 'offspin' ? 70 : style === 'legspin' ? -75 : 0;
  const armBack = spin ? 70 : 92;
  return keyed(1.15, [
    [0, { thighL: [-50, 0, 0], shinL: [70, 0, 0], thighR: [20, 0, 0], shinR: [60, 0, 0], armL: [-40, 0, 20], armR: [-30, 0, -15], foreR: [-60, 0, 0], torso: [10, 0, 0], root: [0, leap * 0.5, 0], ballHand: 'R' }],
    [0.18, { thighL: [-55, 0, 4], shinL: [80, 0, 0], thighR: [15, 0, -4], shinR: [45, 0, 0], armL: [-172, 0, 12], foreL: [-12, 0, 0], armR: [40, 0, -22], foreR: [-35, 0, 0], handR: [-30, 0, 0],
      torso: [arch * 0.5, 72, 0], head: [-4, -68, 0], root: [0, leap, 0], ballHand: 'R' }],
    [0.32, { thighL: [-46, 0, 2], shinL: [10, 0, 0], thighR: [24, 0, -6], shinR: [38, 0, 0], armL: [-128, 0, 30], foreL: [-22, 0, 0], armR: [armBack, 0, -12], foreR: [-6, 0, 0], handR: [-20, 0, 0],
      torso: [arch, 56, 0], head: [-8, -52, 0], root: [0, -0.02, 0], ballHand: 'R' }],
    [0.42, { thighL: [-42, 0, 0], shinL: [4, 0, 0], thighR: [36, 0, 0], shinR: [52, 0, 0], armL: [-22, 0, 42], foreL: [-65, 0, 0], armR: [190, 0, -5], foreR: [0, 0, 0], handR: [spin ? 25 : 40, wrist, 0],
      torso: [16, 6, 0], head: [6, 0, 0], root: [0, -0.05, 0] }],
    [0.64, { thighL: [-30, 0, 0], shinL: [22, 0, 0], thighR: [-34, 0, 0], shinR: [86, 0, 0], armL: [34, 0, 30], foreL: [-62, 0, 0], armR: [302, 0, 22], foreR: [-22, 0, 0], handR: [10, wrist * 0.5, 0],
      torso: [follow, -28, 0], head: [-24, 16, 0], root: [0, -0.11, 0] }],
    [1.15, { thighL: [-14, 0, 0], shinL: [22, 0, 0], thighR: [-8, 0, 0], shinR: [22, 0, 0], armL: [10, 0, 15], foreL: [-32, 0, 0], armR: [340, 0, -10], foreR: [-22, 0, 0],
      torso: [follow * 0.4, -10, 0], root: [0, -0.04, 0] }],
  ]);
}
export const RELEASE_T = 0.42;

// ---------------------------------------------------------------- fielding / keeping
const READY = { thighL: [-35, 0, 12], shinL: [55, 0, 0], thighR: [-35, 0, -12], shinR: [55, 0, 0], torso: [35, 0, 0], head: [-30, 0, 0], armL: [-45, 0, 12], foreL: [-30, 0, 0], armR: [-45, 0, -12], foreR: [-30, 0, 0], root: [0, -0.18, 0] };
const CROUCH = { thighL: [-100, 0, 22], shinL: [125, 0, 0], thighR: [-100, 0, -22], shinR: [125, 0, 0], torso: [38, 0, 0], head: [-36, 0, 0], armL: [-55, 0, 8], foreL: [-25, 0, 0], armR: [-55, 0, -8], foreR: [-25, 0, 0], root: [0, -0.5, 0.05] };

const CLIPS = {
  idle: proc(3, (t, p) => {
    p.torso = [2 + S(t * 2) * 1.2, 0, 0];
    p.armL = [4, 0, 8 + S(t * 2) * 1.5]; p.armR = [4, 0, -8 - S(t * 2) * 1.5];
    p.thighL = [0, 0, 4]; p.thighR = [0, 0, -4];
  }),
  stance: proc(2.4, (t, p) => {
    const k = copyPose(emptyPose(), Object.assign(base(), STANCE));
    Object.assign(p, k);
    // tap the bat, breathe, shift the weight a touch
    const tap = Math.max(0, S(t * 2.6)) * 0.035;
    p.bat = { H: [STANCE.bat.H[0], STANCE.bat.H[1] + tap, STANCE.bat.H[2]], T: [STANCE.bat.T[0], STANCE.bat.T[1] + tap, STANCE.bat.T[2]], F: STANCE.bat.F.slice() };
    p.root = [STANCE.root[0] + S(t * 1.3) * 0.01, STANCE.root[1] + S(t * 2.6) * 0.004, STANCE.root[2]];
    p.torso = [STANCE.torso[0] + S(t * 2.6) * 0.8, STANCE.torso[1], STANCE.torso[2]];
  }),
  backlift: keyed(0.4, [[0, STANCE], [0.35, BACKLIFT]]),
  waitBat: proc(3, (t, p) => {
    p.armR = [-20, 0, -10]; p.foreR = [-40, 0, 0];
    p.bat = { H: [-0.25, 0.8, 0.3], T: [-0.3, 0.05, 0.42], F: [0, 0, 1] };
    p.torso = [4, 0, 0]; p.head = [0, S(t) * 10, 0];
    p.thighL = [0, 0, 5]; p.thighR = [0, 0, -5];
  }),
  backUp: proc(1, (t, p) => {
    walkPose(t, p, 0.9);
    p.bat = { H: [-0.25, 0.85, 0.3], T: [-0.3, 0.1, 0.5], F: [0, 0, 1] };
  }),
  runBat: proc(0.6, (t, p) => runPose(t, p, { period: 0.6, carryBat: true })),
  run: proc(0.62, (t, p) => runPose(t, p, { period: 0.62 })),
  runBall: proc(0.6, (t, p) => runPose(t, p, { period: 0.6, ball: true })),
  jog: proc(0.8, (t, p) => runPose(t, p, { period: 0.8, amp: 0.55 })),
  walk: proc(1, (t, p) => walkPose(t, p)),
  walkOff: proc(1.3, (t, p) => {
    walkPose(t, p, 1.3); p.head = [25, 0, 0]; p.torso = [8, 0, 0];
    p.armR = [-10, 0, -10]; p.foreR = [-20, 0, 0];
    p.bat = { H: [-0.25, 0.75, 0.15], T: [-0.3, 0.02, 0.2], F: [0, 0, 1] };
  }),
  // Batter diving for the crease: launch, full-length slide with the bat stretched out and grounded ahead,
  // then back up. (Character space: +z is the way they run; the bat isn't turned by the body roll.)
  diveBat: keyed(1.35, [
    [0, { thighL: [-40, 0, 3], thighR: [30, 0, -3], shinL: [40, 0, 0], shinR: [60, 0, 0], torso: [16, 0, 0], armR: [-60, 0, -12], foreR: [-40, 0, 0],
      bat: { H: [-0.2, 0.95, 0.5], T: [-0.22, 0.75, 1.3], F: [-1, 0, 0] } }],
    [0.16, { rootRot: [42, 0, 0], root: [0, -0.3, 0.3], torso: [14, 0, 0], head: [-30, 0, 0], armR: [-120, 0, -12], armL: [-110, 0, 14], foreR: [-15, 0, 0], foreL: [-20, 0, 0],
      thighL: [10, 0, 4], thighR: [24, 0, -4], shinL: [30, 0, 0], shinR: [40, 0, 0], bat: { H: [-0.15, 0.6, 1.0], T: [-0.12, 0.3, 1.8], F: [0, 1, 0] } }],
    [0.34, { rootRot: [80, 0, 0], root: [0, -0.74, 0.45], torso: [4, 0, 0], head: [-58, 0, 0], armR: [-168, 0, -10], armL: [-162, 0, 14], foreR: [-4, 0, 0], foreL: [-6, 0, 0],
      thighL: [8, 0, 5], thighR: [16, 0, -5], shinL: [18, 0, 0], shinR: [26, 0, 0], bat: { H: [-0.12, 0.26, 1.2], T: [-0.08, 0.04, 2.02], F: [0, 1, 0] } }],
    [0.85, { rootRot: [82, 0, 0], root: [0, -0.76, 0.45], torso: [2, 0, 0], head: [-50, 0, 0], armR: [-170, 0, -10], armL: [-165, 0, 14], foreR: [-4, 0, 0], foreL: [-6, 0, 0],
      thighL: [6, 0, 5], thighR: [12, 0, -5], shinL: [14, 0, 0], shinR: [20, 0, 0], bat: { H: [-0.12, 0.24, 1.22], T: [-0.08, 0.03, 2.04], F: [0, 1, 0] } }],
    [1.1, { rootRot: [35, 0, 0], root: [0, -0.48, 0.5], torso: [10, 0, 0], head: [-20, 0, 0], armR: [-60, 0, -14], armL: [-50, 0, 18], foreR: [-30, 0, 0], foreL: [-40, 0, 0],
      thighL: [-85, 0, 8], shinL: [100, 0, 0], thighR: [-5, 0, -8], shinR: [95, 0, 0], bat: { H: [-0.2, 0.6, 0.7], T: [-0.15, 0.08, 1.4], F: [-1, 0, 0] } }],
    [1.35, { torso: [4, 0, 0], armR: [-20, 0, -10], foreR: [-40, 0, 0], thighL: [-6, 0, 4], thighR: [-6, 0, -4], shinL: [10, 0, 0], shinR: [10, 0, 0],
      bat: { H: [-0.25, 0.8, 0.3], T: [-0.3, 0.05, 0.42], F: [0, 0, 1] } }],
  ]),
  celebrateBat: proc(1, (t, p) => {
    p.armR = [-170, 0, -15]; p.foreR = [-5, 0, 0]; p.armL = [-150 + S(t * 6) * 10, 0, 20];
    p.bat = { H: [-0.2, 2.0, 0.1], T: [-0.25, 2.85, 0.1], F: [0, 0, 1] };
    p.root = [0, Math.max(0, S(t * 5)) * 0.08, 0];
  }),
  deliverFast: deliverClip('fast'),
  deliverMedium: deliverClip('medium'),
  deliverPace: deliverClip('medium'),
  deliverOffSpin: deliverClip('offspin'),
  deliverLegSpin: deliverClip('legspin'),
  deliverSpin: deliverClip('offspin'),
  // batter after playing and missing: bat up, looks back at the keeper
  beaten: beatenClip(BEATEN_BACK),
  beatenFront: beatenClip(BEATEN_FRONT),
  beatenBack: beatenClip(BEATEN_BACK),
  // keeper whips the bails off
  stump: keyed(1.4, [
    [0, { ...CROUCH, armL: [-70, 0, 10], armR: [-70, 0, -10], foreL: [-50, 0, 0], foreR: [-50, 0, 0] }],
    [0.16, { thighL: [-70, 0, 14], shinL: [80, 0, 0], thighR: [-10, 0, -14], shinR: [60, 0, 0], torso: [52, 0, 0], head: [-34, 0, 0], armL: [-95, 0, 6], armR: [-95, 0, -6], foreL: [-10, 0, 0], foreR: [-10, 0, 0], handL: [30, 0, 0], handR: [30, 0, 0], root: [0, -0.32, 0.3] }],
    [0.4, { thighL: [-60, 0, 14], shinL: [70, 0, 0], thighR: [-10, 0, -14], shinR: [55, 0, 0], torso: [40, 0, 0], head: [-20, 0, 0], armL: [-150, 0, 20], armR: [-150, 0, -20], foreL: [-10, 0, 0], foreR: [-10, 0, 0], root: [0, -0.22, 0.25] }],
    [1.4, { torso: [8, 0, 0], armL: [-160, 0, 24], armR: [-160, 0, -24], root: [0, 0, 0.2] }],
  ]),
  // ground fielding: long barrier on one knee
  stop: keyed(0.8, [
    [0, { ...READY }],
    [0.22, { thighL: [-85, 0, 10], shinL: [88, 0, 0], thighR: [30, 0, -18], shinR: [112, 0, 0], torso: [55, 0, 0], head: [-40, 0, 0], armL: [-60, 0, 10], armR: [-60, 0, -10], foreL: [-10, 0, 0], foreR: [-10, 0, 0], root: [0, -0.42, 0] }],
    [0.8, { thighL: [-60, 0, 10], shinL: [70, 0, 0], thighR: [-10, 0, -10], shinR: [50, 0, 0], torso: [25, 0, 0], armR: [-40, 0, -20], foreR: [-60, 0, 0], root: [0, -0.15, 0], ballHand: 'R' }],
  ]),
  ready: proc(1.6, (t, p) => { Object.assign(p, copyPose(emptyPose(), Object.assign(base(), READY))); p.root = [0, -0.18 + S(t * 4) * 0.01, 0]; }),
  standField: proc(3, (t, p) => { p.armL = [-10, 0, 12]; p.armR = [-10, 0, -12]; p.foreL = [-40, 0, 0]; p.foreR = [-40, 0, 0]; p.torso = [6, 0, 0]; }),
  crouch: keyed(1, [[0, CROUCH], [1, CROUCH]], { loop: true }),
  collect: keyed(0.6, [[0, { ...READY, armL: [-70, 0, 10], armR: [-70, 0, -10], foreL: [-60, 0, 0], foreR: [-60, 0, 0], root: [0, -0.12, 0] }], [0.6, { armL: [-60, 0, 10], armR: [-60, 0, -10], foreL: [-70, 0, 0], foreR: [-70, 0, 0], torso: [10, 0, 0], ballHand: 'R' }]]),
  catch: keyed(1.2, [
    [0, { ...READY }],
    [0.2, { armL: [-150, 0, 12], armR: [-150, 0, -12], foreL: [-20, 0, 0], foreR: [-20, 0, 0], torso: [-6, 0, 0], head: [-20, 0, 0] }],
    [0.5, { armL: [-90, 0, 10], armR: [-90, 0, -10], foreL: [-80, 0, 0], foreR: [-80, 0, 0], torso: [14, 0, 0], ballHand: 'R' }],
    [1.2, { armL: [-30, 0, 10], armR: [-30, 0, -10], foreL: [-60, 0, 0], foreR: [-60, 0, 0], ballHand: 'R' }],
  ]),
  dive: keyed(1.4, [
    [0, { ...READY }],
    [0.25, { rootRot: [0, 0, 70], root: [0.6, -0.5, 0], armL: [-160, 0, 20], armR: [-160, 0, -20], thighL: [-10, 0, 10], thighR: [20, 0, -10], torso: [10, 0, 0] }],
    [0.6, { rootRot: [0, 0, 84], root: [0.9, -0.82, 0], armL: [-175, 0, 15], armR: [-170, 0, -15], thighL: [-10, 0, 10], thighR: [10, 0, -10], ballHand: 'R' }],
    [1.4, { rootRot: [0, 0, 40], root: [0.6, -0.45, 0], armL: [-60, 0, 30], armR: [-60, 0, -30], thighL: [-50, 0, 10], shinL: [80, 0, 0], ballHand: 'R' }],
  ]),
  pickup: keyed(0.7, [
    [0, { ...READY }],
    [0.25, { torso: [70, 0, 0], head: [-40, 0, 0], armR: [-80, 0, -10], foreR: [-10, 0, 0], armL: [-60, 0, 10], thighL: [-60, 0, 10], shinL: [80, 0, 0], thighR: [-20, 0, -10], shinR: [40, 0, 0], root: [0, -0.3, 0] }],
    [0.7, { torso: [20, 0, 0], armR: [-40, 0, -20], foreR: [-60, 0, 0], ballHand: 'R' }],
  ]),
  throw: keyed(0.9, [
    [0, { armR: [-40, 0, -20], foreR: [-60, 0, 0], ballHand: 'R' }],
    [0.15, { armR: [60, 0, -70], foreR: [-80, 0, 0], armL: [-80, 0, 40], torso: [-10, 70, 0], head: [0, -60, 0], thighL: [-30, 0, 0], ballHand: 'R' }],
    [0.3, { armR: [-140, 0, -40], foreR: [-10, 0, 0], armL: [20, 0, 20], torso: [25, -20, 0], head: [0, 0, 0], thighL: [-30, 0, 0], thighR: [20, 0, 0] }],
    [0.9, { armR: [-30, 0, -10], foreR: [-30, 0, 0], torso: [10, 0, 0] }],
  ]),
  // bowler after a wicket: arms out wide, running off ("aeroplane")
  celebrateBowler: proc(0.62, (t, p) => {
    runPose(t, p, { period: 0.62, amp: 0.7 });
    p.armL = [-10, 0, 95 + Math.sin(t * 5) * 6]; p.armR = [-10, 0, -95 - Math.sin(t * 5) * 6];
    p.foreL = [-8, 0, 0]; p.foreR = [-8, 0, 0];
    p.torso = [14, 0, Math.sin(t * 2.4) * 12]; p.head = [-12, 0, 0];
  }),
  celebrate: proc(1, (t, p) => {
    const j = Math.max(0, S(t * 6));
    p.armL = [-165, 0, 25 + S(t * 6) * 8]; p.armR = [-165, 0, -25 - S(t * 6) * 8];
    p.foreL = [-10, 0, 0]; p.foreR = [-10, 0, 0];
    p.root = [0, j * 0.18, 0];
    p.thighL = [-20 * j, 0, 5]; p.thighR = [-20 * j, 0, -5]; p.shinL = [35 * j, 0, 0]; p.shinR = [35 * j, 0, 0];
  }),
  dejected: proc(2, (t, p) => { p.head = [30, 0, 0]; p.torso = [10, 0, 0]; p.armL = [-20, 0, 30]; p.armR = [-20, 0, -30]; p.foreL = [-120, 0, 0]; p.foreR = [-120, 0, 0]; }),
  // Umpire
  umpire: proc(4, (t, p) => {
    p.armL = [20, 0, 6]; p.armR = [20, 0, -6]; p.foreL = [-80, 0, -30]; p.foreR = [-80, 0, 30];
    p.torso = [12 + S(t) * 1, 0, 0]; p.head = [-10, 0, 0];
    p.thighL = [-12, 0, 8]; p.thighR = [-12, 0, -8]; p.shinL = [22, 0, 0]; p.shinR = [22, 0, 0]; p.root = [0, -0.04, 0];
  }),
  sig_out: keyed(2.5, [[0, {}], [0.3, { armR: [-175, 0, -8], foreR: [0, 0, 0] }], [2.5, { armR: [-175, 0, -8] }]]),
  sig_four: proc(2.5, (t, p) => { p.armR = [-90, 0, -10]; p.foreR = [0, 0, 0]; p.armR[1] = S(t * 7) * 45; p.torso = [0, 0, 0]; }),
  sig_six: keyed(2.5, [[0, {}], [0.3, { armL: [-178, 0, 8], armR: [-178, 0, -8], foreL: [0, 0, 0], foreR: [0, 0, 0] }], [2.5, { armL: [-178, 0, 8], armR: [-178, 0, -8] }]]),
  sig_wide: keyed(2.5, [[0, {}], [0.3, { armL: [0, 0, 90], armR: [0, 0, -90], foreL: [0, 0, 0], foreR: [0, 0, 0] }], [2.5, { armL: [0, 0, 90], armR: [0, 0, -90] }]]),
  sig_noball: keyed(2.5, [[0, {}], [0.3, { armR: [0, 0, -90], foreR: [0, 0, 0] }], [2.5, { armR: [0, 0, -90] }]]),
  // NOT OUT: shake of the head, hands folded in front
  sig_notout: proc(2.5, (t, p) => {
    p.armL = [-30, 0, 8]; p.armR = [-30, 0, -8]; p.foreL = [-75, 0, -25]; p.foreR = [-75, 0, 25];
    p.torso = [8, 0, 0];
    p.head = [-6, t < 1.4 ? Math.sin(t * 13) * 28 * (1 - t / 1.4) : 0, 0];
    p.thighL = [-10, 0, 8]; p.thighR = [-10, 0, -8]; p.shinL = [18, 0, 0]; p.shinR = [18, 0, 0];
  }),
  sig_bye: keyed(2.5, [[0, {}], [0.3, { armR: [-165, 0, -5], foreR: [0, 0, 0] }], [2.5, { armR: [-165, 0, -5] }]]),
};
for (const [k, v] of Object.entries(SHOT_CLIPS)) CLIPS['shot_' + k] = v;

export function getClip(name) { return CLIPS[name] || CLIPS.idle; }
export { CLIPS };
