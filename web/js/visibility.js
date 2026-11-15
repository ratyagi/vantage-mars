// Visibility core. Pure functions over a Terrain. No DOM.
// Conventions: x east (m), y south (m). Azimuth degrees clockwise from north. Heights above local ground.
// Every height and threshold here is an ASSUMPTION exposed to the UI; none is a validated Mars value.

export const MARS_R = 3396190; // m, radius in the USGS product metadata
const RAD = Math.PI / 180;

export const curvDrop = (d) => (d * d) / (2 * MARS_R);
export const azimuthDeg = (dx, dySouth) => ((Math.atan2(dx, -dySouth) / RAD) + 360) % 360;

// Straight-line visibility from A (eye) to B (target top). Returns clearance (m) at the tightest point.
export function lineOfSight(T, ax, ay, ah, bx, by, bh, opts = {}) {
  const dx = bx - ax, dy = by - ay;
  const D = Math.hypot(dx, dy);
  const za = T.heightAt(ax, ay) + ah;
  const zb0 = T.heightAt(bx, by) + bh;
  if (!isFinite(za) || !isFinite(zb0)) return { visible: null, unknown: true, dist: D };
  const step = opts.step ?? Math.max(T.cell * 0.5, 0.5);
  const n = Math.max(2, Math.ceil(D / step));
  const zb = zb0 - curvDrop(D);
  let minClear = Infinity, blockDist = null, unknown = 0;
  for (let i = 1; i < n; i++) {
    const t = i / n, d = t * D;
    const zt = T.heightAt(ax + dx * t, ay + dy * t);
    if (!isFinite(zt)) { unknown++; continue; }
    const clear = za + (zb - za) * t - (zt - curvDrop(d));
    if (clear < minClear) minClear = clear;
    if (clear < 0 && blockDist === null) blockDist = d;
  }
  return { visible: blockDist === null, clearance: minClear, blockDist, dist: D, unknownFraction: unknown / (n - 1) };
}

// Resample a polyline [{x,y}] at a fixed spacing. Adds cumulative distance s and heading (deg).
export function sampleRoute(points, spacing = 10) {
  const out = [];
  if (points.length < 2) return out;
  let s = 0, carry = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k], b = points[k + 1];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L === 0) continue;
    const hd = azimuthDeg(dx, dy);
    let pos = carry;
    while (pos <= L) {
      const t = pos / L;
      out.push({ s: s + pos, x: a.x + dx * t, y: a.y + dy * t, heading: hd });
      pos += spacing;
    }
    carry = pos - L;
    s += L;
  }
  const last = points[points.length - 1];
  if (!out.length || Math.hypot(out[out.length - 1].x - last.x, out[out.length - 1].y - last.y) > 1e-6) {
    out.push({ s, x: last.x, y: last.y, heading: out.length ? out[out.length - 1].heading : 0 });
  }
  return out;
}

export function slopeAlong(T, samples) {
  return samples.map((p) => T.slopeDeg(p.x, p.y));
}

// For each sample, which targets are visible. targets: [{id,name,kind,x,y,h}] with kind 'habitat'|'rover'|'landmark'.
// Partner trails the walker by partnerGap meters along the route (distance by s), if partnerGap > 0.
export function routeVisibility(T, samples, targets, opts = {}) {
  const eyeH = opts.eyeH ?? 1.7;
  const partnerGap = opts.partnerGap ?? 0;
  const partnerH = opts.partnerH ?? 1.7;
  const rows = [];
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const vis = {};
    for (const t of targets) {
      const r = lineOfSight(T, p.x, p.y, eyeH, t.x, t.y, t.h, opts);
      vis[t.id] = { visible: r.visible, dist: r.dist, bearing: azimuthDeg(t.x - p.x, t.y - p.y), clearance: r.clearance };
    }
    let partner = null;
    if (partnerGap > 0) {
      let j = i;
      while (j > 0 && p.s - samples[j].s < partnerGap) j--;
      if (j !== i) {
        const q = samples[j];
        const r = lineOfSight(T, p.x, p.y, eyeH, q.x, q.y, partnerH, opts);
        partner = { visible: r.visible, dist: r.dist };
      }
    }
    rows.push({ ...p, vis, partner });
  }
  return rows;
}

// Contiguous stretches where no habitat/rover AND no landmark is visible.
export function blindRuns(rows, targets, minLen = 20) {
  const refs = targets.map((t) => t.id);
  const runs = [];
  let start = null;
  for (let i = 0; i < rows.length; i++) {
    const anyVisible = refs.some((id) => rows[i].vis[id].visible === true);
    if (!anyVisible && start === null) start = i;
    if ((anyVisible || i === rows.length - 1) && start !== null) {
      const end = anyVisible ? i - 1 : i;
      if (end >= start) {
        const len = rows[end].s - rows[start].s;
        if (len >= minLen) runs.push({ from: rows[start].s, to: rows[end].s, length: len });
      }
      start = null;
    }
  }
  return runs;
}

// Elevation angle (deg) of the terrain horizon for each azimuth, as seen from (ox,oy) at eye height.
export function skyline(T, ox, oy, eyeH, nAz = 360, maxRange = 2500) {
  const z0 = T.heightAt(ox, oy) + eyeH;
  const ang = new Float32Array(nAz), dist = new Float32Array(nAz), edge = new Uint8Array(nAz);
  for (let k = 0; k < nAz; k++) {
    const az = (k / nAz) * 2 * Math.PI;
    const ux = Math.sin(az), uy = -Math.cos(az); // y south
    let best = -90, bestD = 0, hitEdge = 1;
    for (let d = T.cell; d <= maxRange; d += d < 200 ? T.cell : T.cell * 2) {
      const z = T.heightAt(ox + ux * d, oy + uy * d);
      if (!isFinite(z)) { hitEdge = 1; break; }
      const a = Math.atan2(z - z0 - curvDrop(d), d) / RAD;
      if (a > best) { best = a; bestD = d; }
      hitEdge = 0;
    }
    ang[k] = best; dist[k] = bestD; edge[k] = hitEdge;
  }
  return { angleDeg: ang, dist, edge, nAz };
}

// Fraction of ground within `range` ahead (sector +/- span/2 about heading) that is NOT visible.
// Pattern: Apollo 16 crew could not see the floor of a crater they were standing at the rim of.
export function hiddenGroundAhead(T, ox, oy, headingDeg, eyeH = 1.7, range = 50, spanDeg = 60) {
  let total = 0, hidden = 0, firstHidden = null;
  for (let r = 4; r <= range; r += 3) {
    const nA = Math.max(1, Math.round((r * spanDeg * RAD) / 3));
    for (let a = 0; a < nA; a++) {
      const az = (headingDeg - spanDeg / 2 + ((a + 0.5) / nA) * spanDeg) * RAD;
      const bx = ox + Math.sin(az) * r, by = oy - Math.cos(az) * r;
      if (!T.inside(bx, by)) continue;
      const res = lineOfSight(T, ox, oy, eyeH, bx, by, 0.0);
      if (res.visible === null) continue;
      total++;
      if (!res.visible) { hidden++; if (firstHidden === null || r < firstHidden) firstHidden = r; }
    }
  }
  return { hiddenFraction: total ? hidden / total : NaN, firstHiddenDist: firstHidden, samples: total };
}

// Viewshed over a coarse grid (for the map overlay). Returns Uint8Array: 1 visible, 0 hidden, 2 no data.
export function viewshed(T, ox, oy, eyeH, targetH = 0, stride = 4, maxRange = 1500) {
  const gw = Math.floor(T.width / stride), gh = Math.floor(T.height / stride);
  const out = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = (i + 0.5) * stride * T.cell, y = (j + 0.5) * stride * T.cell;
      if (Math.hypot(x - ox, y - oy) > maxRange) { out[j * gw + i] = 2; continue; }
      const r = lineOfSight(T, ox, oy, eyeH, x, y, targetH, { step: Math.max(T.cell, 1) });
      out[j * gw + i] = r.visible === null ? 2 : r.visible ? 1 : 0;
    }
  }
  return { grid: out, gw, gh, stride };
}

// Predicted terrain view (painter's algorithm near to far, running maximum elevation angle).
// angle range is [angMin, angMax] degrees relative to the horizontal at eye height.
export function renderPanorama(T, ox, oy, eyeH, azCenterDeg, fovDeg, W, H, sun, opts = {}) {
  const angMin = opts.angMin ?? -35, angMax = opts.angMax ?? 20, maxRange = opts.maxRange ?? 2500;
  const px = new Uint8ClampedArray(W * H * 4);
  const sky = [236, 205, 170];
  for (let i = 0; i < W * H; i++) { px[i * 4] = sky[0]; px[i * 4 + 1] = sky[1]; px[i * 4 + 2] = sky[2]; px[i * 4 + 3] = 255; }
  const z0 = T.heightAt(ox, oy) + eyeH;
  const sa = (sun.azDeg * RAD), se = (Math.max(sun.elevDeg, 0.5) * RAD);
  const L = [Math.sin(sa) * Math.cos(se), Math.cos(sa) * Math.cos(se), Math.sin(se)];
  const rowOf = (a) => Math.round(((angMax - a) / (angMax - angMin)) * (H - 1));
  const sky_row = new Int32Array(W).fill(-1);
  for (let c = 0; c < W; c++) {
    const az = (azCenterDeg - fovDeg / 2 + ((c + 0.5) / W) * fovDeg) * RAD;
    const ux = Math.sin(az), uy = -Math.cos(az);
    let maxA = angMin;
    for (let d = Math.max(T.cell, 1.5); d <= maxRange; d += d < 150 ? T.cell * 0.5 : d < 600 ? T.cell : T.cell * 3) {
      const x = ox + ux * d, y = oy + uy * d;
      const z = T.heightAt(x, y);
      if (!isFinite(z)) break;
      const a = Math.atan2(z - z0 - curvDrop(d), d) / RAD;
      if (a <= maxA) continue;
      const [gx, gy] = T.gradient(x, y);
      const nl = Math.hypot(gx, gy, 1);
      const lam = Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) / nl);
      const shade = 0.18 + 0.82 * lam;
      const fog = 1 - Math.exp(-d / 6000); // depth cue only; NOT an atmospheric model
      const r = Math.round((190 * shade) * (1 - fog) + sky[0] * fog);
      const g = Math.round((128 * shade) * (1 - fog) + sky[1] * fog);
      const b = Math.round((92 * shade) * (1 - fog) + sky[2] * fog);
      const rTop = Math.max(0, rowOf(Math.min(a, angMax))), rBot = Math.min(H - 1, rowOf(Math.max(maxA, angMin)));
      for (let rr = rTop; rr <= rBot; rr++) {
        const o = (rr * W + c) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b;
      }
      maxA = a;
      if (a >= angMax) break;
    }
    sky_row[c] = rowOf(Math.min(maxA, angMax));
  }
  return { pixels: px, width: W, height: H, skylineRow: sky_row, angMin, angMax };
}

// Walking time along rows using a SIMPLE ASSUMED model: level pace 2 km/h (Artemis planning figure),
// linearly derated to zero at 20 degrees (Artemis planning slope limit). Mars suited speed on natural
// slopes has not been measured; this is a placeholder for planning-scale comparisons only.
export function walkMinutes(T, rows, levelKmh = 2.0, limitDeg = 20) {
  let sec = 0;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].s - rows[i - 1].s;
    const sl = T.slopeDeg((rows[i].x + rows[i - 1].x) / 2, (rows[i].y + rows[i - 1].y) / 2);
    const f = isFinite(sl) ? Math.max(0.05, 1 - sl / limitDeg) : 1;
    sec += d / ((levelKmh * 1000 / 3600) * f);
  }
  return sec / 60;
}
