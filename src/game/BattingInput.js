// The human batter's controls, shared by matches and net practice: move across the crease, aim,
// play a shot and (in a match) call the runs.
import { viewMirrored } from '../scene/CameraPoses.js';
import { shotFromInput, BATTER_X, STANCE_Z } from './ShotModel.js';
import { assistAim } from '../ai/BattingAI.js';

export const SHOT_BUTTONS = ['defend', 'ground', 'lofted', 'advanced', 'leave'];

/** Button hints while the ball is coming (shared by matches and the nets). */
export const SHOT_HINTS = [[['moveLeft', 'moveRight'], 'Move across'], ['ground', 'Ground'], ['lofted', 'Lofted'], ['defend', 'Defend'], ['advanced', 'Sweep'], ['leave', 'Leave'], ['power', 'Power'], ['precision', 'Precision']];

/**
 * Shot direction from the stick, in batter terms (x + = off side, y + = front foot / towards the bowler).
 * The stick works the way the picture looks: from the bowler's end (TV and umpire views) the picture is
 * mirrored both ways, so right stays screen-right and pushing *down* (towards the bowler on screen) is forward.
 */
export function shotAxis(ax, battingView) {
  const m = viewMirrored(battingView) ? -1 : 1;
  return { x: ax.x * m, y: ax.y * m };
}

/**
 * Where a ground shot would go with the stick as it is: { deg, x, z } (field angle from the striker, 0 = straight,
 * + off side), including the aim assist's nudge towards a gap, or null with the stick centred (the assist picks).
 */
export function aimPreview(sim, ax) {
  if (Math.hypot(ax.x, ax.y) < 0.25) return null;
  const s = shotFromInput('ground', ax.x, ax.y, { bowlerKind: sim.kind, lengthHint: sim.phase === 'flight' ? sim.plan?.bounceLen ?? null : null });
  let deg = s.dirDeg;
  if (sim.D?.aimAssist && Math.abs(ax.x) >= 0.2) deg = assistAim(s.shotId, deg, sim.fielders.map(f => ({ x: f.x, z: f.z })), sim.D.aimAssist);
  return { deg, x: BATTER_X + (sim.guard || 0), z: STANCE_Z };
}

/** Plays the human batter's input for this frame; returns the aim to show on the field chart (or null). */
export function applyBattingInput(app, sim, dt, { running = true } = {}) {
  const input = app.input;
  // ← → move the batter across the crease, so they don't also swing the shot direction.
  const ax = shotAxis(input.axis(['moveLeft', 'moveRight'], 'batting'), app.cameras.battingView);
  const mirror = viewMirrored(app.cameras.battingView) ? -1 : 1;
  input.setProfile('batting');
  // Shuffle across the crease to cover the line (screen left/right, + = towards the off side).
  const move = (input.value('moveRight') - input.value('moveLeft')) * mirror;
  if (move) sim.moveGuard(move, dt);
  const aiming = (sim.phase === 'runup' || sim.phase === 'flight' || sim.phase === 'ready') && !sim.shot;
  const aim = aiming ? aimPreview(sim, ax) : null;
  if (sim.phase === 'flight' && !sim.shot) {
    for (const b of SHOT_BUTTONS) {
      if (input.pressed(b)) {
        sim.inputShot({ button: b, sx: ax.x, sy: ax.y, power: input.value('power') > 0.5, precision: input.value('precision') > 0.5, age: input.pressAge(b) });
        break;
      }
    }
  }
  if (running && sim.phase === 'inplay') {
    if (input.pressed('run')) sim.inputRun('run');
    if (input.pressed('cancelRun')) sim.inputRun('back');
    sim.setSprint(input.value('sprint') > 0.35);   // either trigger, part-way is enough
    if (input.pressed('dive')) sim.inputDive();
  } else if (sim.sprint) sim.setSprint(false);
  const look = input.lookAxis();
  app.cameras.look = { x: look.x, y: look.y };
  return aim;
}
