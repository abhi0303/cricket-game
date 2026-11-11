// The human batter's controls, shared by matches and net practice: move across the crease, aim,
// play a shot and (in a match) call the runs.
import { viewMirrored } from '../scene/CameraPoses.js';

export const SHOT_BUTTONS = ['defend', 'ground', 'lofted', 'advanced', 'leave'];

export function applyBattingInput(app, sim, dt, { running = true } = {}) {
  const input = app.input;
  // ← → move the batter across the crease, so they don't also swing the shot direction.
  const ax = input.axis(['moveLeft', 'moveRight'], 'batting');
  // Watching from the bowler's end the picture is mirrored: keep "right" meaning screen-right.
  const mirror = viewMirrored(app.cameras.battingView) ? -1 : 1;
  ax.x *= mirror;
  input.setProfile('batting');
  // Shuffle across the crease to cover the line (screen left/right, + = towards the off side).
  const move = (input.value('moveRight') - input.value('moveLeft')) * mirror;
  if (move) sim.moveGuard(move, dt);
  const aiming = (sim.phase === 'runup' || sim.phase === 'flight' || sim.phase === 'ready') && !sim.shot;
  app.view.setShotArrow(ax.x, ax.y, aiming && Math.hypot(ax.x, ax.y) > 0.25);
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
  }
  const look = input.lookAxis();
  app.cameras.look = { x: look.x, y: look.y };
}
