// Live field chart for the HUD: a top-down map of the ground with every fielder, both batters and the
// ball in play. It is turned to match the camera, so a fielder on the right of the chart is on the
// right of the screen (and pushing the stick right aims the shot towards it).

import { BOUNDARY_RADIUS, PITCH } from '../game/BallPhysics.js';

const INNER = 27.43;                 // fielding restriction circle (30 yards) around each set of stumps
const AIM_SPREAD = 8;                // half-width of the aim wedge, degrees (about how far timing moves a shot)
const PITCH_W = 3.05;

/**
 * Count fielders by side of the striker and inside the circle. x > 0 is the off side for the striker,
 * as in the delivery frame. Keeper and bowler are not counted.
 */
export function fieldCounts(fielders) {
  let off = 0, leg = 0, inside = 0;
  for (const f of fielders) {
    if (f.x >= 0) off++; else leg++;
    const dz = Math.max(0, Math.abs(f.z) - PITCH.half);   // distance outside the stumps' line, along the pitch
    if (Math.hypot(f.x, dz) <= INNER) inside++;
  }
  return { off, leg, inside };
}

/**
 * Map a delivery-frame ground point to chart pixels. `up` is +1 when the camera looks towards the
 * striker (bowler's-end views: striker at the top) and -1 when it looks towards the bowler.
 */
export function chartPoint(x, z, up, cx, cy, k) {
  return [cx - up * x * k, cy - up * z * k];
}

/** A team colour that stands out on the grass: too green or too dark falls back to `alt` (then white). */
export function chartColor(hex, alt = '#ffffff') {
  const rgb = h => { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const ok = h => {
    if (!/^#?[0-9a-f]{6}$/i.test(String(h))) return false;
    const [r, g, b] = rgb(h), grass = [52, 138, 61];
    const dist = Math.hypot(r - grass[0], g - grass[1], b - grass[2]);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return dist > 90 && lum > 45;
  };
  return ok(hex) ? hex : ok(alt) ? alt : '#ffffff';
}

export class FieldMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr);
    if (w > 0 && this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = w; }
    return w;
  }

  /**
   * o = { fielders: [{x,z}], keeper, bowler, batters: [{x,z}], ball: {x,z}|null, up: ±1,
   *       fieldColor, batColor,
   *       aim: { deg, x, z } | null   the batter's aim: field angle (0 = straight, + off side) from (x, z),
   *       trail: { from: {x,z}, to: {x,z} } | null   where the hit ball has gone }
   */
  draw(o) {
    const w = this.fit();
    if (!w) return;
    const ctx = this.ctx, c = w / 2, R = c - w * 0.02, k = R / (BOUNDARY_RADIUS + 1);
    const dot = w * 0.026;
    const P = (x, z) => chartPoint(x, z, o.up, c, c, k);
    ctx.clearRect(0, 0, w, w);

    // outfield with soft mowing stripes
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    const g = ctx.createRadialGradient(c, c, R * 0.1, c, c, R);
    g.addColorStop(0, '#3f9a45'); g.addColorStop(1, '#2c7a35');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    for (let i = -6; i <= 6; i += 2) ctx.fillRect(c + i * R / 6.5 - R / 13, 0, R / 6.5, w);
    ctx.restore();
    ctx.lineWidth = Math.max(1.5, w * 0.008);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();

    // inner circle: two semicircles round the stumps joined by straight lines
    ctx.save();
    ctx.setLineDash([w * 0.018, w * 0.014]);
    ctx.lineWidth = Math.max(1, w * 0.005);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    const [ax, ay] = P(0, PITCH.half), [bx, by] = P(0, -PITCH.half);
    const r = INNER * k;
    const a0 = Math.atan2(ay - c, ax - c);   // direction from the centre to the striker's stumps
    ctx.arc(ax, ay, r, a0 - Math.PI / 2, a0 + Math.PI / 2);
    ctx.arc(bx, by, r, a0 + Math.PI / 2, a0 + Math.PI * 1.5);
    ctx.closePath(); ctx.stroke();
    ctx.restore();

    // pitch and creases
    const [p1x, p1y] = P(-PITCH_W / 2, PITCH.half + 1.2), [p2x, p2y] = P(PITCH_W / 2, -PITCH.half - 1.2);
    ctx.fillStyle = '#d8c38f';
    ctx.fillRect(Math.min(p1x, p2x), Math.min(p1y, p2y), Math.abs(p2x - p1x), Math.abs(p2y - p1y));

    // side labels (off side is +x for the striker)
    ctx.font = `700 ${Math.round(w * 0.05)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const [ox] = P(BOUNDARY_RADIUS * 0.8, 0), [lx] = P(-BOUNDARY_RADIUS * 0.8, 0);
    ctx.fillText('OFF', ox, c); ctx.fillText('LEG', lx, c);

    // The batter's aim: a gold wedge from the striker to the rope, with the line the shot will take.
    if (o.aim) {
      const toRope = deg => {
        const d = deg * Math.PI / 180, ux = Math.sin(d), uz = -Math.cos(d);
        const b = o.aim.x * ux + o.aim.z * uz, cc = o.aim.x * o.aim.x + o.aim.z * o.aim.z - BOUNDARY_RADIUS * BOUNDARY_RADIUS;
        const t = -b + Math.sqrt(Math.max(0, b * b - cc));
        return P(o.aim.x + ux * t, o.aim.z + uz * t);
      };
      const [sx0, sy0] = P(o.aim.x, o.aim.z), [ex, ey] = toRope(o.aim.deg);
      const [l1x, l1y] = toRope(o.aim.deg - AIM_SPREAD), [l2x, l2y] = toRope(o.aim.deg + AIM_SPREAD);
      ctx.save();
      const wg = ctx.createLinearGradient(sx0, sy0, ex, ey);
      wg.addColorStop(0, 'rgba(255,201,74,0.6)'); wg.addColorStop(1, 'rgba(255,201,74,0.2)');
      ctx.fillStyle = wg;
      ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(l1x, l1y); ctx.lineTo(l2x, l2y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffc94a'; ctx.lineWidth = Math.max(2, w * 0.014); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey, w * 0.022, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // Where the hit ball has gone, from the bat.
    if (o.trail) {
      const [fx, fy] = P(o.trail.from.x, o.trail.from.z), [tx, ty] = P(o.trail.to.x, o.trail.to.z);
      ctx.save();
      ctx.setLineDash([w * 0.02, w * 0.014]);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(1.2, w * 0.008);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.restore();
    }

    const disc = (x, z, fill, stroke, rad = dot, lw = w * 0.007) => {
      const [px, py] = P(x, z);
      ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke();
    };
    for (const f of o.fielders) disc(f.x, f.z, o.fieldColor, '#ffffff');
    if (o.keeper) disc(o.keeper.x, o.keeper.z, o.fieldColor, '#ffd166');
    if (o.bowler) disc(o.bowler.x, o.bowler.z, o.fieldColor, '#ffd166', dot * 0.85);
    for (const b of o.batters || []) disc(b.x, b.z, o.batColor, '#06d6a0', dot * 0.85);
    if (o.ball) disc(o.ball.x, o.ball.z, '#ffffff', '#b3121a', dot * 0.6, w * 0.01);
    else if (o.trail) disc(o.trail.to.x, o.trail.to.z, '#ffffff', '#b3121a', dot * 0.6, w * 0.01);
  }
}
