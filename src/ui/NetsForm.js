// The net-practice bowler form: bowler type, fixed or random speed, deliveries and the batter.
// Used by the Net Practice screen and by "Change bowler" in the pause menu.
import { esc } from './UI.js';
import { BOWLING_TYPES, ROLE_SHORT } from '../game/PlayerAttributes.js';
import { PHYSICS, lengthDef } from '../game/PhysicsConfig.js';
import { deliveryTypesFor } from '../game/BallPhysics.js';
import {
  NET_TYPES, NET_SPEEDS, NET_ACCURACY, NET_MOVEMENT, NET_LINES, NET_DIFFICULTY, normalizeNetsConfig, withNetType,
} from '../game/NetsConfig.js';

const opts = obj => Object.entries(obj).map(([k, v]) => [k, v.label]);

function batterOptions(team) {
  const order = (team.battingOrder || []).map(id => team.players.find(p => p.id === id)).filter(Boolean);
  const rest = team.players.filter(p => !order.includes(p));
  return [...order, ...rest].map(p => [p.id, `${p.name} (${ROLE_SHORT[p.role]} · ${p.overall})`]);
}

export function netsFormHTML(cfg, team) {
  const sel = (id, list, cur) => `<select data-nf="${id}">${list.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const S = NET_SPEEDS[cfg.type];
  const random = cfg.speedMode === 'random';
  const slider = (id, v, label) => `<label class="nf-speed"><span>${label}</span><b><output data-nf-out="${id}">${v}</output> km/h</b>
    <input type="range" data-nf="${id}" min="${S.min}" max="${S.max}" step="1" value="${v}" aria-label="${label} (km/h)"></label>`;
  const types = NET_TYPES.map(t => `<button class="ntype ${cfg.type === t ? 'sel' : ''}" data-ntype="${t}" aria-pressed="${cfg.type === t}">
      <b>${esc(BOWLING_TYPES[t].label)}</b><small>${esc(NET_SPEEDS[t].blurb)}</small><small>${NET_SPEEDS[t].min}–${NET_SPEEDS[t].max} km/h</small></button>`).join('');
  const variations = [['mixed', 'Mixed (bowler plans)'], ...deliveryTypesFor({ bowlingType: cfg.type }).map(d => [d.id, d.label])];
  const lengths = [['mixed', 'Mixed (bowler plans)'], ...PHYSICS.lengthOrder.map(id => [id, lengthDef(id).label])];
  return `<div class="nets-form">
    <h3>Bowler type</h3>
    <div class="ntypes">${types}</div>
    <h3>Speed</h3>
    <div class="nf-speeds">
      <div class="seg" role="group" aria-label="Speed mode">
        <button class="chip ${random ? '' : 'sel'}" data-nmode="fixed" aria-pressed="${!random}">Fixed speed</button>
        <button class="chip ${random ? 'sel' : ''}" data-nmode="random" aria-pressed="${random}">Random speed</button>
      </div>
      ${random ? slider('speedMin', cfg.speedMin, 'From') + slider('speedMax', cfg.speedMax, 'To') : slider('speed', cfg.speed, 'Every ball at')}
    </div>
    <p class="muted nf-note">${random
      ? `Each ball comes down at a different speed between <b data-nf-out="lo">${cfg.speedMin}</b> and <b data-nf-out="hi">${cfg.speedMax}</b> km/h.`
      : `Every ball comes down at exactly <b data-nf-out="fixed">${cfg.speed}</b> km/h.`}</p>
    <h3>Deliveries</h3>
    <div class="grid3">
      <label>Delivery ${sel('variation', variations, cfg.variation)}</label>
      <label>Length ${sel('length', lengths, cfg.length)}</label>
      <label>Line ${sel('line', opts(NET_LINES), cfg.line)}</label>
      <label>Accuracy ${sel('accuracy', opts(NET_ACCURACY), cfg.accuracy)}</label>
      <label>Swing / turn ${sel('movement', opts(NET_MOVEMENT), cfg.movement)}</label>
      <label>Difficulty ${sel('difficulty', opts(NET_DIFFICULTY), cfg.difficulty)}</label>
      <label>Batter ${sel('batterId', batterOptions(team), cfg.batterId)}</label>
    </div>
  </div>`;
}

/** The form's current values as a complete config. */
export function readNetsForm(root, cfg, team) {
  const next = { ...cfg };
  root.querySelectorAll('[data-nf]').forEach(el => { next[el.dataset.nf] = el.value; });
  return normalizeNetsConfig(next, team);
}

/** Keep the km/h read-outs next to the sliders in step while dragging. */
export function syncNetsFormLabels(root) {
  const val = id => root.querySelector(`input[data-nf="${id}"]`)?.value;
  const put = (key, v) => root.querySelectorAll(`[data-nf-out="${key}"]`).forEach(el => { el.textContent = v; });
  for (const id of ['speed', 'speedMin', 'speedMax']) if (val(id) != null) put(id, val(id));
  if (val('speed') != null) put('fixed', val('speed'));
  if (val('speedMin') != null) {
    const a = Number(val('speedMin')), b = Number(val('speedMax'));
    put('lo', Math.min(a, b)); put('hi', Math.max(a, b));
  }
}

/** A click on a bowler-type or speed-mode button: the new config (to redraw the form), else null. */
export function netsFormClick(target, cfg, team) {
  const t = target.closest?.('[data-ntype]');
  if (t) return t.dataset.ntype === cfg.type ? null : withNetType(cfg, t.dataset.ntype, team);
  const m = target.closest?.('[data-nmode]');
  if (m) return m.dataset.nmode === cfg.speedMode ? null : normalizeNetsConfig({ ...cfg, speedMode: m.dataset.nmode }, team);
  return null;
}

/** After redrawing, put focus back on the button that was pressed (keeps controller navigation in place). */
export function refocusNetsForm(root, target) {
  const key = target.closest?.('[data-ntype]') ? `[data-ntype="${target.closest('[data-ntype]').dataset.ntype}"]`
    : target.closest?.('[data-nmode]') ? `[data-nmode="${target.closest('[data-nmode]').dataset.nmode}"]` : null;
  if (key) root.querySelector(key)?.focus({ preventScroll: true });
}
