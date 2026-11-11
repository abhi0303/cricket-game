// Bowling physics report: every selectable speed x every delivery length, with perfect accuracy
// and no swing/seam, compared with the constant-speed baseline (20.12 m / v).
//   node scripts/physicsReport.mjs            (table)
//   node scripts/physicsReport.mjs --md       (markdown table)
import { planDelivery } from '../src/game/BallPhysics.js';
import { PHYSICS, defaultLengthTarget, lengthDef } from '../src/game/PhysicsConfig.js';
import { normalizePlayer } from '../src/game/PlayerAttributes.js';
import { RNG } from '../src/utils/Random.js';

const md = process.argv.includes('--md');
const bowler = normalizePlayer({ id: 'b', name: 'Test', number: 1, role: 'bowler', bowlingType: 'medium', bowlAccuracy: 99, bowlSpeed: 50, bowlMovement: 1, bowlStamina: 50 });
export function runReport() {
  const rows = [];
  for (const kph of PHYSICS.speeds) {
    for (const id of PHYSICS.lengthOrder) {
      const t = defaultLengthTarget(id);
      const plan = planDelivery({ ...bowler }, { speedKph: kph, length: id, type: 'stock', quality: 1, spreadMult: 0, target: { x: 0.1, len: t.len, height: t.height } }, new RNG(1));
      const T = plan.timing;
      rows.push({ kph, id, label: lengthDef(id).label, pitch: plan.bounceLen, tPitch: T.tPitch, tTotal: T.tTotal, base: T.baseline, post: T.tPostPitch, reaction: T.reaction, inZone: T.pitchedInZone, hZone: T.heightAtZone, hBat: plan.path.at(plan.path.timeAtZ(PHYSICS.batterZ)).p.y, hStumps: T.heightAtStumps, peak: T.bouncePeak, vStumps: T.stumpsSpeed, release: T.releaseSpeed });
    }
  }
  return rows;
}
const f = (v, d = 3) => (v == null ? '—' : v.toFixed(d));
if (process.argv[1] && process.argv[1].endsWith('physicsReport.mjs')) {
  const rows = runReport();
  const head = ['km/h', 'Delivery', 'Pitched (m)', 'Release→pitch', 'Pitch→stumps', 'Reaction after bounce', 'Total travel', 'Baseline', 'Δ', 'Height at batter', 'Height at stumps', 'Speed at stumps (km/h)'];
  if (md) console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
  else console.log(head.join('\t'));
  for (const r of rows) {
    const cells = [r.kph, r.label, f(r.pitch, 2), f(r.tPitch), f(r.post), r.inZone ? '0 (pitches in zone)' : f(r.reaction), f(r.tTotal), f(r.base), (r.tTotal - r.base >= 0 ? '+' : '') + f(r.tTotal - r.base), f(r.hBat, 2), f(r.hStumps, 2), f(r.vStumps * 3.6, 1)];
    console.log(md ? `| ${cells.join(' | ')} |` : cells.join('\t'));
  }
}
