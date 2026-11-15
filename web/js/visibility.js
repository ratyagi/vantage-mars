// Visibility core. Pure functions over a Terrain. No DOM.
// Conventions: x east (m), y south (m). Azimuth degrees clockwise from north. Heights above local ground.
// Every height and threshold here is an ASSUMPTION exposed to the UI; none is a validated Mars value.

export const MARS_R = 3396190; // m, radius in the USGS product metadata
export const SLOPE_BASELINE_M = 5; // slope is evaluated over 5 m, closer to rover and walker scale than one 1 m cell
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
export function hiddenGroundAhead(T, ox, oy, headingDeg, eyeH = 1.7, range = 50, spanDeg = 60, hazardH = 0.0) {
  let total = 0, hidden = 0, firstHidden = null;
  for (let r = 4; r <= range; r += 3) {
    const nA = Math.max(1, Math.round((r * spanDeg * RAD) / 3));
    for (let a = 0; a < nA; a++) {
      const az = (headingDeg - spanDeg / 2 + ((a + 0.5) / nA) * spanDeg) * RAD;
      const bx = ox + Math.sin(az) * r, by = oy - Math.cos(az) * r;
      if (!T.inside(bx, by)) continue;
      const res = lineOfSight(T, ox, oy, eyeH, bx, by, hazardH);
      if (res.visible === null) continue;
      total++;
      if (!res.visible) { hidden++; if (firstHidden === null || r < firstHidden) firstHidden = r; }
    }
  }
  return { hiddenFraction: total ? hidden / total : NaN, firstHiddenDist: firstHidden, samples: total };
}

// Viewshed over a coarse grid (for the map overlay). Returns Uint8Array: 1 visible, 0 hidden, 2 no data / out of range.
// bounds {x0,y0,x1,y1} in metres limits the grid (default: whole terrain).
export function viewshed(T, ox, oy, eyeH, targetH = 0, stride = 4, maxRange = 1500, bounds = null) {
  const b = bounds || { x0: 0, y0: 0, x1: T.extentX, y1: T.extentY };
  const cs = stride * T.cell;
  const gw = Math.max(1, Math.floor((b.x1 - b.x0) / cs)), gh = Math.max(1, Math.floor((b.y1 - b.y0) / cs));
  const out = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = b.x0 + (i + 0.5) * cs, y = b.y0 + (j + 0.5) * cs;
      if (Math.hypot(x - ox, y - oy) > maxRange) { out[j * gw + i] = 2; continue; }
      const r = lineOfSight(T, ox, oy, eyeH, x, y, targetH, { step: Math.max(T.cell, 1) });
      out[j * gw + i] = r.visible === null ? 2 : r.visible ? 1 : 0;
    }
  }
  return { grid: out, gw, gh, stride, x0: b.x0, y0: b.y0, cellM: cs };
}

// Predicted terrain view (painter's algorithm near to far, running maximum elevation angle).
// angle range is [angMin, angMax] degrees relative to the horizontal at eye height.
export function renderPanorama(T, ox, oy, eyeH, azCenterDeg, fovDeg, W, H, sun, opts = {}) {
  const angMin = opts.angMin ?? -35, angMax = opts.angMax ?? 20, maxRange = opts.maxRange ?? 2500;
  const px = new Uint8ClampedArray(W * H * 4);
  const sky = [236, 205, 170];
  // sky: horizon colour at the horizon row, darker toward the zenith (cosmetic gradient; the fog target stays the horizon colour)
  const horizonRow = Math.round(((angMax - 0) / (angMax - angMin)) * (H - 1));
  for (let r = 0; r < H; r++) {
    const k = r < horizonRow ? Math.pow(Math.min(1, (horizonRow - r) / Math.max(1, horizonRow)), 1.4) : 0;
    const R = sky[0] - 52 * k, G = sky[1] - 66 * k, B = sky[2] - 56 * k;
    for (let c = 0; c < W; c++) { const o = (r * W + c) * 4; px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 255; }
  }
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
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
      const amp = d < 200 ? 0.16 : d < 800 ? 0.07 : 0.03; // hash noise hides banding from the 1 m cells in the foreground; not terrain data
      for (let rr = rTop; rr <= rBot; rr++) {
        const o = (rr * W + c) * 4, nz = 1 + (hash(c >> 1, rr >> 1) - 0.5) * amp;
        px[o] = Math.min(255, r * nz); px[o + 1] = Math.min(255, g * nz); px[o + 2] = Math.min(255, b * nz);
      }
      maxA = a;
      if (a >= angMax) break;
    }
    sky_row[c] = rowOf(Math.min(maxA, angMax));
  }
  return { pixels: px, width: W, height: H, skylineRow: sky_row, angMin, angMax };
}

// Walking time using a SIMPLE ASSUMED model: level pace 2 km/h (Artemis planning figure), linearly derated to 5 percent
// at 20 degrees (Artemis planning slope limit). Mars suited speed on natural slopes has not been measured; this is a
// placeholder for comparing routes, not for scheduling. Returns cumulative minutes at each row (cum[0] = 0).
export function cumulativeWalkMinutes(T, rows, levelKmh = 2.0, limitDeg = 20) {
  const out = [0];
  let sec = 0;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].s - rows[i - 1].s;
    const sl = T.slopeDeg((rows[i].x + rows[i - 1].x) / 2, (rows[i].y + rows[i - 1].y) / 2, SLOPE_BASELINE_M);
    const f = isFinite(sl) ? Math.max(0.05, 1 - sl / limitDeg) : 1;
    sec += d / ((levelKmh * 1000 / 3600) * f);
    out.push(sec / 60);
  }
  return out;
}
export function walkMinutes(T, rows, levelKmh = 2.0, limitDeg = 20) {
  const c = cumulativeWalkMinutes(T, rows, levelKmh, limitDeg);
  return c.length ? c[c.length - 1] : 0;
}

// Suggest landmarks: local summits that stand clear of their surroundings, near the route but not on it,
// away from the window edge (where the DEM has no neighbours), and well separated from one another.
export function suggestLandmarks(T, route, o = {}) {
  const { n = 4, radius = 120, minRelief = 6, margin = 100, minRoute = 40, maxRoute = 700, minSep = 250, step = 10 } = o;
  const pts = route && route.length ? route : [{ x: T.extentX / 2, y: T.extentY / 2 }];
  const dirs = 16, rings = [radius / 3, (2 * radius) / 3, radius];
  const cand = [];
  for (let y = margin; y < T.extentY - margin; y += step) {
    for (let x = margin; x < T.extentX - margin; x += step) {
      const z = T.heightAt(x, y);
      if (!isFinite(z)) continue;
      let ok = true, zmin = z;
      for (const r of rings) {
        for (let k = 0; k < dirs && ok; k++) {
          const a = (k / dirs) * 2 * Math.PI;
          const zz = T.heightAt(x + Math.cos(a) * r, y + Math.sin(a) * r);
          if (!isFinite(zz)) continue;
          if (zz > z) ok = false;
          if (zz < zmin) zmin = zz;
        }
        if (!ok) break;
      }
      if (!ok || z - zmin < minRelief) continue;
      let dr = Infinity;
      for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < dr) dr = d; }
      if (dr < minRoute || dr > maxRoute) continue;
      cand.push({ x, y, relief: z - zmin, distRoute: dr });
    }
  }
  cand.sort((a, b) => b.relief - a.relief);
  const out = [];
  for (const c of cand) {
    if (out.every((o2) => Math.hypot(o2.x - c.x, o2.y - c.y) >= minSep)) out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

// ---------- terrain shadow ----------
// True if the point at (x,y) is shadowed by terrain from the Sun (or the Sun is below the horizon).
// Rays that leave the terrain window are assumed to be lit (a stated simplification).
export function inTerrainShadow(T, x, y, sunAzDeg, sunElDeg, maxRange = 2000) {
  if (sunElDeg <= 0) return true;
  const z0 = T.heightAt(x, y);
  if (!isFinite(z0)) return null;
  const az = sunAzDeg * RAD, ux = Math.sin(az), uy = -Math.cos(az), tanEl = Math.tan(sunElDeg * RAD);
  for (let d = T.cell; d <= maxRange; d += d < 100 ? T.cell : T.cell * 3) {
    const z = T.heightAt(x + ux * d, y + uy * d);
    if (!isFinite(z)) return false;
    if ((z - z0 - curvDrop(d)) / d > tanEl) return true;
  }
  return false;
}

export function shadowMap(T, sun, bounds, stride = 4, maxRange = 2000) {
  const b = bounds || { x0: 0, y0: 0, x1: T.extentX, y1: T.extentY };
  const cs = stride * T.cell;
  const gw = Math.max(1, Math.floor((b.x1 - b.x0) / cs)), gh = Math.max(1, Math.floor((b.y1 - b.y0) / cs));
  const out = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const r = inTerrainShadow(T, b.x0 + (i + 0.5) * cs, b.y0 + (j + 0.5) * cs, sun.azDeg, sun.elevDeg, maxRange);
    out[j * gw + i] = r === null ? 2 : r ? 1 : 0;
  }
  return { grid: out, gw, gh, x0: b.x0, y0: b.y0, cellM: cs };
}

// ---------- position-uncertainty confidence ----------
// Fraction of observer positions (centre plus 8 around a circle of radius r metres) from which the target is visible.
// 1 or 0 means the answer does not depend on a position error of r; in between means it is position-sensitive.
export function visibilityFraction(T, ax, ay, ah, bx, by, bh, r, opts = {}) {
  let vis = 0, n = 0;
  const offs = [[0, 0]];
  for (let k = 0; k < 8; k++) offs.push([Math.cos((k / 8) * 2 * Math.PI) * r, Math.sin((k / 8) * 2 * Math.PI) * r]);
  for (const [ox, oy] of offs) {
    const res = lineOfSight(T, ax + ox, ay + oy, ah, bx, by, bh, opts);
    if (res.visible === null) continue;
    n++; if (res.visible) vis++;
  }
  return n ? vis / n : null;
}

// ---------- route planner ----------
// Dijkstra over a coarse grid between start and goal. Edge cost is estimated walking time (same slope derate as
// cumulativeWalkMinutes). Cells steeper than slopeLimit are impassable. If `habitat` is given, cells from which the
// habitat is NOT in line of sight cost (1 + visWeight) times more, so the planner prefers keeping it in view.
export function planRoute(T, start, goal, o = {}) {
  const { stride: strideIn = 0, pad = 250, slopeLimit = 20, levelKmh = 2.0, eyeH = 1.7, habitat = null, habH = 3, visWeight = 0.5 } = o;
  const bx = Math.abs(goal.x - start.x) + 2 * pad, by = Math.abs(goal.y - start.y) + 2 * pad;
  // keep the grid under about 70k cells so a long plan does not freeze the page; coarser cells for long routes
  const g = strideIn || Math.max(5, Math.ceil(Math.sqrt((bx * by) / 70000) / 5) * 5);
  const x0 = Math.max(0, Math.min(start.x, goal.x) - pad), x1 = Math.min(T.extentX, Math.max(start.x, goal.x) + pad);
  const y0 = Math.max(0, Math.min(start.y, goal.y) - pad), y1 = Math.min(T.extentY, Math.max(start.y, goal.y) + pad);
  const gw = Math.floor((x1 - x0) / g), gh = Math.floor((y1 - y0) / g);
  if (gw < 2 || gh < 2) return null;
  const N = gw * gh, cx = (i) => x0 + (i + 0.5) * g, cy = (j) => y0 + (j + 0.5) * g;
  const slope = new Float32Array(N), hidden = new Uint8Array(N);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    const sl = T.slopeDeg(cx(i), cy(j), SLOPE_BASELINE_M);
    slope[k] = isFinite(sl) ? sl : 90;
    if (habitat) {
      const r = lineOfSight(T, cx(i), cy(j), eyeH, habitat.x, habitat.y, habH, { step: Math.max(2, g / 2) });
      hidden[k] = r.visible === false ? 1 : 0;
    }
  }
  const idx = (p) => ({ i: Math.max(0, Math.min(gw - 1, Math.floor((p.x - x0) / g))), j: Math.max(0, Math.min(gh - 1, Math.floor((p.y - y0) / g))) });
  const s0 = idx(start), t0 = idx(goal), sK = s0.j * gw + s0.i, tK = t0.j * gw + t0.i;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  // binary heap of [cost, node]
  const heap = [];
  const push = (c, n) => { heap.push([c, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  dist[sK] = 0; push(0, sK);
  const mps = (levelKmh * 1000) / 3600;
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const [c, k] = pop();
    if (done[k]) continue; done[k] = 1;
    if (k === tK) break;
    const ki = k % gw, kj = (k / gw) | 0;
    for (const [di, dj] of nb) {
      const ni = ki + di, nj = kj + dj;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      const nk = nj * gw + ni;
      if (done[nk]) continue;
      const sl = Math.max(slope[k], slope[nk]);
      if (sl >= slopeLimit && nk !== tK && k !== sK) continue; // the start and goal cells may sit on a steep cell
      const step = Math.hypot(di, dj) * g;
      const f = Math.max(0.05, 1 - Math.min(sl, slopeLimit) / 20);
      const w = (step / (mps * f)) * (1 + (hidden[nk] ? visWeight : 0));
      if (c + w < dist[nk]) { dist[nk] = c + w; prev[nk] = k; push(c + w, nk); }
    }
  }
  if (!isFinite(dist[tK])) return null;
  const pts = [];
  for (let k = tK; k !== -1; k = prev[k]) pts.push({ x: cx(k % gw), y: cy((k / gw) | 0) });
  pts.reverse();
  pts[0] = { x: start.x, y: start.y }; pts[pts.length - 1] = { x: goal.x, y: goal.y };
  return { points: pts, cost: dist[tK] };
}


// ---------- shelter reach: one-to-all walking time from a source (the habitat) ----------
// Same pace model as planRoute: 2 km/h on level ground derated to a 5% floor at the slope limit; steep cells stay walkable at the floor
// so every cell has a value. Returns minutes per cell on a g-metre grid and an at(x, y) lookup.
export function costField(T, src, o = {}) {
  const { g = 5, radius = 800, slopeLimit = 20, levelKmh = 2.0 } = o;
  const x0 = Math.max(0, src.x - radius), y0 = Math.max(0, src.y - radius);
  const x1 = Math.min(T.extentX, src.x + radius), y1 = Math.min(T.extentY, src.y + radius);
  const gw = Math.floor((x1 - x0) / g), gh = Math.floor((y1 - y0) / g), N = gw * gh;
  const slope = new Float32Array(N);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const sl = T.slopeDeg(x0 + (i + 0.5) * g, y0 + (j + 0.5) * g, SLOPE_BASELINE_M);
    slope[j * gw + i] = isFinite(sl) ? sl : 90;
  }
  const sI = Math.max(0, Math.min(gw - 1, Math.floor((src.x - x0) / g))), sJ = Math.max(0, Math.min(gh - 1, Math.floor((src.y - y0) / g))), sK = sJ * gw + sI;
  const dist = new Float64Array(N).fill(Infinity), done = new Uint8Array(N), heap = [];
  const push = (c, n) => { heap.push([c, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const mps = (levelKmh * 1000) / 3600, nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  dist[sK] = 0; push(0, sK);
  while (heap.length) {
    const [c, k] = pop();
    if (done[k]) continue; done[k] = 1;
    const ki = k % gw, kj = (k / gw) | 0;
    for (const [di, dj] of nb) {
      const ni = ki + di, nj = kj + dj;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      const nk = nj * gw + ni; if (done[nk]) continue;
      const sl = Math.max(slope[k], slope[nk]);
      const w = (Math.hypot(di, dj) * g) / (mps * Math.max(0.05, 1 - Math.min(sl, slopeLimit) / slopeLimit));
      if (c + w < dist[nk]) { dist[nk] = c + w; push(c + w, nk); }
    }
  }
  const minutes = new Float32Array(N);
  for (let k = 0; k < N; k++) minutes[k] = dist[k] / 60;
  return { minutes, gw, gh, x0, y0, g, radius, at(x, y) { const i = Math.floor((x - x0) / g), j = Math.floor((y - y0) / g); return i < 0 || j < 0 || i >= gw || j >= gh ? Infinity : minutes[j * gw + i]; } };
}

// Minutes of usable light left from local true solar time `ltst` (hours): steps forward until the Sun is below
// `cutoffDeg` or the spot falls into terrain shadow. Returns { min, reason } or null if the Sun is rising (morning).
export function daylightLeftMin(T, x, y, sunAt, ltst, cutoffDeg = 5, maxMin = 600) {
  const LTST_H_PER_EARTH_MIN = 1 / 60 / 1.0275;
  if (ltst < 12 && sunAt(ltst).elevDeg < cutoffDeg) return null;
  for (let m = 0; m <= maxMin; m += 5) {
    const s = sunAt(ltst + m * LTST_H_PER_EARTH_MIN);
    if (s.elevDeg < cutoffDeg) return { min: m, reason: "sun below " + cutoffDeg + " deg" };
    if (m % 10 === 0 && inTerrainShadow(T, x, y, s.azDeg, s.elevDeg) === true) return { min: m, reason: "terrain shadow" };
  }
  return { min: maxMin, reason: "more than " + maxMin + " min" };
}

// ---------- radio line of sight (geometry only, not a link budget) ----------
export function radioCoverage(T, rows, hab, habMastH, suitH = 1.7, perMin = null) {
  const ok = rows.map((r) => lineOfSight(T, hab.x, hab.y, habMastH, r.x, r.y, suitH, { step: 2 }).visible === true);
  let worst = { len: 0, from: 0, to: 0 }, cur = null;
  rows.forEach((r, i) => {
    if (!ok[i]) { if (!cur) cur = { from: r.s, to: r.s, i0: i, i1: i }; cur.to = r.s; cur.i1 = i; }
    if ((ok[i] || i === rows.length - 1) && cur) { const len = cur.to - cur.from + 10; if (len > worst.len) worst = { len, from: cur.from, to: cur.to, i0: cur.i0, i1: cur.i1 }; cur = null; }
  });
  const gapMin = perMin && worst.len > 0 ? perMin(worst.i0, worst.i1) : null;
  return { ok, coveredFrac: ok.filter(Boolean).length / Math.max(1, ok.length), worst, gapMin };
}

// Greedy relay siting: a relay must see the habitat mast and is scored by how many still-uncovered route samples it sees.
export function relaySites(T, rows, hab, habMastH, o = {}) {
  const { grid = 25, relayH = 2.5, suitH = 1.7, pad = 150, top = 3 } = o;
  let covered = rows.map((r) => lineOfSight(T, hab.x, hab.y, habMastH, r.x, r.y, suitH, { step: 2 }).visible === true);
  const xs = rows.map((r) => r.x), ys = rows.map((r) => r.y);
  const bx0 = Math.max(T.cell * 2, Math.min(...xs) - pad), bx1 = Math.min(T.extentX - T.cell * 2, Math.max(...xs) + pad);
  const by0 = Math.max(T.cell * 2, Math.min(...ys) - pad), by1 = Math.min(T.extentY - T.cell * 2, Math.max(...ys) + pad);
  const cands = [];
  for (let y = by0; y <= by1; y += grid) for (let x = bx0; x <= bx1; x += grid) {
    if (lineOfSight(T, x, y, relayH, hab.x, hab.y, habMastH, { step: 2 }).visible !== true) continue;
    cands.push({ x, y, see: rows.map((r) => lineOfSight(T, x, y, relayH, r.x, r.y, suitH, { step: 2 }).visible === true) });
  }
  const before = covered.filter(Boolean).length / Math.max(1, rows.length), picks = [];
  for (let n = 0; n < top; n++) {
    let best = null, bestGain = 0;
    for (const c of cands) { let g = 0; for (let i = 0; i < rows.length; i++) if (!covered[i] && c.see[i]) g++; if (g > bestGain) { bestGain = g; best = c; } }
    if (!best) break;
    covered = covered.map((v, i) => v || best.see[i]);
    picks.push({ x: best.x, y: best.y, gain: bestGain, coveredFrac: covered.filter(Boolean).length / Math.max(1, rows.length), dHab: Math.hypot(best.x - hab.x, best.y - hab.y) });
  }
  return { before, picks, candidates: cands.length };
}
