// Small DOM helpers, toasts, controller glyphs and gamepad/keyboard menu navigation.
import { PAD_LABELS, keyLabel } from '../controls/Bindings.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(msg, ms = 2200, kind = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.className = 'toast ' + kind;
  t.innerHTML = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/** Button glyph for an action, using the controller style when a pad was used last. */
export function glyph(input, action, profile) {
  const b = input.bindings[profile]?.[action];
  if (!b) return '';
  if (input.lastDevice === 'gamepad' && input.pad?.connected) {
    const style = input.pad.style;
    const label = PAD_LABELS[style][b.pad[0]] ?? '?';
    return `<span class="glyph pad ${style} b${b.pad[0]}">${esc(label)}</span>`;
  }
  return `<span class="glyph key">${esc(keyLabel(b.keys[0]))}</span>`;
}

/** items: [action | [action, action…], text] — several actions share one hint (e.g. ← → Move). */
export function hintBar(input, profile, items) {
  return items.map(([action, text]) => `<span class="hint">${[].concat(action).map(a => glyph(input, a, profile)).join('')} ${esc(text)}</span>`).join('');
}

// ---------------------------------------------------------------- spatial navigation
const FOCUSABLE = 'button:not([disabled]), [data-nav], select, input:not([type=hidden]), .card-pick';

function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

export function focusables(root) { return $$(FOCUSABLE, root).filter(visible); }

/** Move focus to the nearest focusable element in a direction. */
export function moveFocus(root, dir) {
  const items = focusables(root);
  if (!items.length) return;
  const cur = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
  if (!cur) { items[0].focus(); return; }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const bx = r.left + r.width / 2, by = r.top + r.height / 2;
    const dx = bx - ax, dy = by - ay;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    if (along <= 4) continue;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

/** Gamepad left/right on selects and sliders changes their value. */
export function adjustFocused(delta) {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'SELECT') {
    const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + delta));
    if (i !== el.selectedIndex) { el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  }
  if (el.tagName === 'INPUT' && el.type === 'range') {
    el.value = Number(el.value) + delta * Number(el.step || 1);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

export function pct(v) { return `${Math.round(v * 100)}%`; }
