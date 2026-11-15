import { Terrain, makeSyntheticTerrain, hillshade } from "./terrain.js";
import { sunPosition } from "./sun.js";
import {
  sampleRoute, routeVisibility, blindRuns, skyline, hiddenGroundAhead,
  viewshed, renderPanorama, walkMinutes, azimuthDeg,
} from "./visibility.js";

const $ = (id) => document.getElementById(id);
const S = {
  T: null, route: [], landmarks: [], habitat: null, rover: null, mode: "route",
  rows: [], runs: [], traverse: null, hs: null, vs: null, vsTimer: null,
};

// ---------- load ----------
async function init() {
  try {
    S.T = await Terrain.load("data/");
    $("dataBadge").textContent = `REAL DEM: ${S.T.meta.product || "USGS Gale 1 m"}, ${S.T.width}x${S.T.height} at ${S.T.cell} m`;
    $("dataBadge").className = "chip real";
  } catch (e) {
    S.T = makeSyntheticTerrain(800, 800, 2);
    $("dataBadge").textContent = "SYNTHETIC TERRAIN (not Mars data)";
    $("dataBadge").className = "chip synth";
    const b = $("banner");
    b.classList.remove("hidden");
    b.textContent = "Showing SYNTHETIC test terrain because data/dem.f32 was not found. Run pipeline/fetch_terrain_window.py to fetch the real USGS Gale DEM. Nothing on this screen describes real Mars until then.";
  }
  try {
    S.traverse = await (await fetch("data/route.json")).json();
    if (S.traverse.waypoints?.some((w) => w.inside)) $("btnTraverse").classList.remove("hidden");
  } catch (_) { /* optional */ }
  setupMap();
  bind();
  provenance();
  defaultScene();
  recompute();
}

// ---------- map ----------
const map = $("map"), mctx = map.getContext("2d");
let view = { px: 1, W: 0, H: 0 };

function setupMap() {
  const T = S.T;
  const wrap = $("mapwrap");
  const aw = Math.max(300, wrap.clientWidth - 24), ah = Math.max(300, wrap.clientHeight - 24);
  const aspect = T.extentY / T.extentX;
  let w = aw, h = aw * aspect;
  if (h > ah) { h = ah; w = ah / aspect; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  map.style.width = Math.round(w) + "px"; map.style.height = Math.round(h) + "px";
  map.width = Math.round(w * dpr); map.height = Math.round(h * dpr);
  view.W = map.width; view.H = map.height; view.px = map.width / T.extentX; view.dpr = dpr;
  drawHillshade();
}
function drawHillshade() {
  const T = S.T, sun = sunNow();
  const g = hillshade(T, sun.azDeg, Math.max(15, sun.elevDeg), 3);
  const off = document.createElement("canvas"); off.width = T.width; off.height = T.height;
  const id = off.getContext("2d").createImageData(T.width, T.height);
  const lo = T.meta.min ?? -4000, hi = T.meta.max ?? -3000;
  for (let i = 0; i < g.length; i++) {
    const z = T.data[i], e = isFinite(z) ? Math.max(0, Math.min(1, (z - lo) / (hi - lo || 1))) : 0.5;
    const k = 0.35 + 0.65 * (g[i] / 255); // relief
    // subtle hypsometric tint: low = cool slate, high = warm sand
    id.data[i * 4] = 255 * k * (0.62 + 0.38 * e);
    id.data[i * 4 + 1] = 255 * k * (0.64 + 0.22 * e);
    id.data[i * 4 + 2] = 255 * k * (0.70 - 0.22 * e);
    id.data[i * 4 + 3] = 255;
  }
  off.getContext("2d").putImageData(id, 0, 0);
  S.hs = off;
}
const toPx = (x, y) => [x * view.px, y * view.px];
const toM = (cx, cy) => [cx / view.px, cy / view.px];

function drawMap() {
  const T = S.T;
  mctx.clearRect(0, 0, view.W, view.H);
  mctx.imageSmoothingEnabled = true;
  mctx.drawImage(S.hs, 0, 0, view.W, view.H);
  if ($("showSlope").checked) drawSlope();
  if ($("showView").checked && S.vs) drawViewshed();
  // route with blind runs
  if (S.rows.length > 1) {
    mctx.lineWidth = 3 * (view.dpr || 1); mctx.lineJoin = "round"; mctx.strokeStyle = "#fff"; mctx.beginPath();
    S.rows.forEach((p, i) => { const [a, b] = toPx(p.x, p.y); i ? mctx.lineTo(a, b) : mctx.moveTo(a, b); });
    mctx.stroke();
    mctx.strokeStyle = "#ef5b5b"; mctx.lineWidth = 5 * (view.dpr || 1);
    for (const r of S.runs) {
      mctx.beginPath();
      let first = true;
      for (const p of S.rows) if (p.s >= r.from && p.s <= r.to) { const [a, b] = toPx(p.x, p.y); first ? mctx.moveTo(a, b) : mctx.lineTo(a, b); first = false; }
      mctx.stroke();
    }
  } else if (S.route.length) {
    for (const p of S.route) { const [a, b] = toPx(p.x, p.y); mctx.fillStyle = "#fff"; mctx.fillRect(a - 3, b - 3, 6, 6); }
  }
  marker(S.habitat, "H", "#7fb4ff"); marker(S.rover, "R", "#5fd39a");
  S.landmarks.forEach((l, i) => marker(l, "L" + (i + 1), "#f5b94a"));
  scaleAndNorth();
  const cur = currentSample();
  if (cur) {
    const d = view.dpr || 1, [a, b] = toPx(cur.x, cur.y);
    const az = lookAz() * Math.PI / 180, f = $("fov").value * Math.PI / 360, R = 46 * d;
    mctx.fillStyle = "rgba(76,201,216,.16)"; mctx.strokeStyle = "#4cc9d8"; mctx.lineWidth = 1.5 * d;
    mctx.beginPath(); mctx.moveTo(a, b); mctx.arc(a, b, R, az - f - Math.PI / 2, az + f - Math.PI / 2); mctx.closePath(); mctx.fill(); mctx.stroke();
    mctx.fillStyle = "#4cc9d8"; mctx.beginPath(); mctx.arc(a, b, 5 * d, 0, 7); mctx.fill();
    mctx.strokeStyle = "#fff"; mctx.lineWidth = 1.5 * d; mctx.stroke();
  }
}
function marker(m, label, color) {
  if (!m) return;
  const d = view.dpr || 1, [a, b] = toPx(m.x, m.y);
  mctx.fillStyle = "rgba(0,0,0,.55)"; mctx.beginPath(); mctx.arc(a, b, 10 * d, 0, 7); mctx.fill();
  mctx.fillStyle = color; mctx.beginPath(); mctx.arc(a, b, 8 * d, 0, 7); mctx.fill();
  mctx.fillStyle = "#0b0e12"; mctx.font = `700 ${10 * d}px sans-serif`; mctx.textAlign = "center"; mctx.fillText(label, a, b + 3.5 * d);
}
function scaleAndNorth() {
  const T = S.T, d = view.dpr || 1;
  const nice = [10, 20, 50, 100, 200, 250, 500, 1000];
  const target = T.extentX * 0.2;
  const len = nice.reduce((p, c) => (Math.abs(c - target) < Math.abs(p - target) ? c : p), nice[0]);
  const px = len * view.px, x0 = view.W - px - 16 * d, y0 = view.H - 18 * d;
  mctx.strokeStyle = "#fff"; mctx.lineWidth = 2 * d; mctx.beginPath();
  mctx.moveTo(x0, y0 - 5 * d); mctx.lineTo(x0, y0); mctx.lineTo(x0 + px, y0); mctx.lineTo(x0 + px, y0 - 5 * d); mctx.stroke();
  mctx.fillStyle = "#fff"; mctx.font = `600 ${11 * d}px sans-serif`; mctx.textAlign = "center";
  mctx.shadowColor = "#000"; mctx.shadowBlur = 4 * d;
  mctx.fillText(len >= 1000 ? len / 1000 + " km" : len + " m", x0 + px / 2, y0 - 8 * d);
  const nx = view.W - 26 * d, ny = 30 * d;
  mctx.beginPath(); mctx.moveTo(nx, ny - 14 * d); mctx.lineTo(nx - 6 * d, ny + 6 * d); mctx.lineTo(nx, ny + 2 * d); mctx.lineTo(nx + 6 * d, ny + 6 * d); mctx.closePath(); mctx.fill();
  mctx.fillText("N", nx, ny + 20 * d);
  mctx.shadowBlur = 0;
}
function drawSlope() {
  const T = S.T, st = Math.max(2, Math.round(T.width / 160));
  for (let j = 0; j < T.height; j += st) for (let i = 0; i < T.width; i += st) {
    const x = (i + st / 2) * T.cell, y = (j + st / 2) * T.cell;
    const sl = T.slopeDeg(x, y);
    if (!(sl > 15)) continue;
    mctx.fillStyle = sl > 20 ? "rgba(235,87,87,.55)" : "rgba(242,153,74,.5)";
    mctx.fillRect(i * T.cell * view.px, j * T.cell * view.px, st * T.cell * view.px + 1, st * T.cell * view.px + 1);
  }
}
function drawViewshed() {
  const v = S.vs, T = S.T, cs = v.stride * T.cell * view.px;
  for (let j = 0; j < v.gh; j++) for (let i = 0; i < v.gw; i++) {
    if (v.grid[j * v.gw + i] !== 1) continue;
    mctx.fillStyle = "rgba(80,200,200,.28)";
    mctx.fillRect(i * cs, j * cs, cs + 0.5, cs + 0.5);
  }
}

// ---------- state helpers ----------
function sunNow() {
  const lat = S.T?.meta?.window_center_lonlat?.[1] ?? -4.8;
  return sunPosition(lat, +$("ls").value, +$("ltst").value);
}
function currentSample() {
  if (!S.rows.length) return null;
  const t = +$("pos").value / 1000;
  const i = Math.min(S.rows.length - 1, Math.round(t * (S.rows.length - 1)));
  return S.rows[i];
}
function lookAz() {
  if ($("lookMode").value === "manual") return +$("lookAz").value;
  const c = currentSample();
  return c ? c.heading : 90;
}
function targets() {
  const t = [];
  const lh = +$("landH").value, hh = +$("habH").value;
  if (S.habitat) t.push({ id: "hab", name: "Habitat", kind: "habitat", x: S.habitat.x, y: S.habitat.y, h: hh });
  if (S.rover) t.push({ id: "rov", name: "Rover", kind: "rover", x: S.rover.x, y: S.rover.y, h: 2.5 });
  S.landmarks.forEach((l, i) => t.push({ id: "L" + (i + 1), name: l.name || "Landmark " + (i + 1), kind: "landmark", x: l.x, y: l.y, h: lh }));
  return t;
}

// ---------- compute ----------
function recompute() {
  const T = S.T;
  const opts = { eyeH: +$("eyeH").value, partnerGap: +$("partnerGap").value };
  S.rows = S.route.length > 1 ? routeVisibility(T, sampleRoute(S.route, 10), targets(), opts) : [];
  S.runs = S.rows.length ? blindRuns(S.rows, targets(), +$("blindMin").value) : [];
  $("oLtst").textContent = (+$("ltst").value).toFixed(2);
  $("oLs").textContent = $("ls").value;
  $("oFov").textContent = $("fov").value;
  $("oAz").textContent = $("lookAz").value;
  scheduleViewshed();
  refresh();
}
function scheduleViewshed() {
  clearTimeout(S.vsTimer);
  S.vsTimer = setTimeout(() => {
    const c = currentSample();
    if (!c || !$("showView").checked) { S.vs = null; drawMap(); return; }
    const stride = Math.max(2, Math.round(S.T.width / 150));
    S.vs = viewshed(S.T, c.x, c.y, +$("eyeH").value, 0, stride, 1500);
    drawMap();
  }, 150);
}
function refresh() {
  drawMap(); drawStrip(); drawPano(); flags(); cuff();
  const c = currentSample();
  $("oPos").textContent = c ? `${c.s.toFixed(0)} m of ${S.rows[S.rows.length - 1].s.toFixed(0)} m` : "";
  const sun = sunNow();
  $("sunChip").textContent = `Sun ${sun.elevDeg.toFixed(0)}\u00b0 el / ${sun.azDeg.toFixed(0)}\u00b0 az`;
  $("sunReadout").textContent = `Sun: elevation ${sun.elevDeg.toFixed(1)} deg, azimuth ${sun.azDeg.toFixed(0)} deg (approximate, geometric; no atmosphere or equation of time).`
    + (S.rows.length ? ` Walk estimate ${walkMinutes(S.T, S.rows).toFixed(0)} min (assumed 2 km/h, derated to 0 at 20 deg).` : "");
}

// ---------- strip ----------
function drawStrip() {
  const c = $("strip"), ctx = c.getContext("2d"), d = Math.min(2, window.devicePixelRatio || 1);
  const cw = c.clientWidth, ch = c.clientHeight;
  c.width = cw * d; c.height = ch * d; ctx.scale(d, d);
  ctx.fillStyle = "#0b0e12"; ctx.fillRect(0, 0, cw, ch);
  ctx.font = "11px Inter, system-ui, sans-serif";
  if (!S.rows.length) { ctx.fillStyle = "#8b95a4"; ctx.fillText("Draw a route on the map to see what stays in view.", 14, 28); return; }
  const tg = targets(), n = S.rows.length, total = S.rows[n - 1].s;
  const left = 84, rowH = 14, gap = 4, top = 10, W = cw - left - 12;
  const X = (s) => left + (s / total) * W;
  const lines = [...tg.map((t) => ({ id: t.id, label: t.name })), { id: "__p", label: "Partner" }];
  ctx.textAlign = "right";
  lines.forEach((ln, k) => {
    const y = top + k * (rowH + gap);
    ctx.fillStyle = "#8b95a4"; ctx.fillText(ln.label.slice(0, 13), left - 8, y + 11);
    for (let i = 0; i < n - 1; i++) {
      const v = ln.id === "__p" ? S.rows[i].partner?.visible : S.rows[i].vis[ln.id]?.visible;
      ctx.fillStyle = v === true ? "#2e9e78" : v === false ? "#b4454a" : "#2a313b";
      ctx.fillRect(X(S.rows[i].s), y, Math.max(1, X(S.rows[i + 1].s) - X(S.rows[i].s) + 0.6), rowH);
    }
  });
  const base = top + lines.length * (rowH + gap) + 6, hgt = Math.max(24, ch - base - 30);
  ctx.fillStyle = "#8b95a4"; ctx.fillText("Slope", left - 8, base + 12);
  for (const [deg, col] of [[15, "rgba(245,185,74,.6)"], [20, "rgba(239,91,91,.7)"]]) {
    const y = base + hgt - (deg / 30) * hgt; ctx.strokeStyle = col; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + W, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(deg + "°", left + W - 22, y - 3); ctx.textAlign = "right";
  }
  ctx.strokeStyle = "#e0774a"; ctx.lineWidth = 1.5; ctx.beginPath();
  S.rows.forEach((r, i) => { const sl = S.T.slopeDeg(r.x, r.y); const y = base + hgt - Math.min(30, isFinite(sl) ? sl : 0) / 30 * hgt; i ? ctx.lineTo(X(r.s), y) : ctx.moveTo(X(r.s), y); });
  ctx.stroke();
  ctx.fillStyle = "#5d6775"; ctx.textAlign = "center";
  const step = total > 1500 ? 500 : total > 600 ? 200 : 100;
  for (let s = 0; s <= total; s += step) { ctx.fillText(s + " m", Math.min(X(s), left + W - 14), ch - 5); }
  const cur = currentSample();
  if (cur) { ctx.strokeStyle = "#4cc9d8"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(cur.s), 2); ctx.lineTo(X(cur.s), ch - 16); ctx.stroke(); }
  S.stripGeom = { left, W, total };
}

// ---------- panorama ----------
function drawPano() {
  const c = $("pano"), ctx = c.getContext("2d");
  const cur = currentSample();
  const W = 960, H = 300; c.width = W; c.height = H;
  if (!cur) { ctx.fillStyle = "#0b0e12"; ctx.fillRect(0, 0, W, H); return; }
  const sun = sunNow(), az = lookAz(), fov = +$("fov").value;
  const p = renderPanorama(S.T, cur.x, cur.y, +$("eyeH").value, az, fov, W, H, sun, { angMin: -30, angMax: 20 });
  ctx.putImageData(new ImageData(p.pixels, W, H), 0, 0);
  const colOf = (b) => ((((b - az + 540) % 360) - 180) / fov + 0.5) * W;
  const rowOfA = (a) => ((p.angMax - a) / (p.angMax - p.angMin)) * (H - 1);
  ctx.font = "13px Inter, system-ui, sans-serif";
  // horizon reference and skyline
  ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.setLineDash([4, 5]); ctx.beginPath();
  ctx.moveTo(0, rowOfA(0)); ctx.lineTo(W, rowOfA(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.2; ctx.beginPath();
  for (let x = 0; x < W; x++) { const y = p.skylineRow[x]; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  // sun marker
  if (sun.elevDeg > p.angMin && sun.elevDeg < p.angMax) {
    const sx = colOf(sun.azDeg);
    if (sx > 0 && sx < W) { ctx.fillStyle = "#fff3c4"; ctx.beginPath(); ctx.arc(sx, rowOfA(sun.elevDeg), 6, 0, 7); ctx.fill(); }
  }
  // compass band
  const g = ctx.createLinearGradient(0, 0, 0, 20); g.addColorStop(0, "rgba(8,10,13,.85)"); g.addColorStop(1, "rgba(8,10,13,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 26);
  ctx.textAlign = "center"; ctx.fillStyle = "#e7eaef";
  const names = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  for (let a = Math.ceil((az - fov / 2) / 15) * 15; a <= az + fov / 2; a += 15) {
    const deg = ((a % 360) + 360) % 360, x = colOf(deg);
    ctx.strokeStyle = "rgba(231,234,239,.6)"; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, deg % 45 === 0 ? 9 : 5); ctx.stroke();
    if (deg % 45 === 0) ctx.fillText(names[deg], x, 22); else if (fov <= 120) { ctx.fillStyle = "#8b95a4"; ctx.fillText(deg, x, 18); ctx.fillStyle = "#e7eaef"; }
  }
  // targets
  let k = 0;
  for (const t of targets()) {
    const v = cur.vis[t.id]; if (!v) continue;
    const stag = (k++ % 4) * 13;
    const x = colOf(v.bearing); if (x < 0 || x > W) continue;
    const baseA = Math.atan2(S.T.heightAt(t.x, t.y) - (S.T.heightAt(cur.x, cur.y) + +$("eyeH").value), v.dist) * 180 / Math.PI;
    const topA = baseA + (Math.atan2(t.h, v.dist) * 180 / Math.PI);
    const y = rowOfA(topA);
    ctx.fillStyle = v.visible ? "#5fd39a" : "#ef5b5b";
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x - 5, y - 13); ctx.lineTo(x + 5, y - 13); ctx.closePath(); ctx.fill();
    const label = `${t.name}  ${v.dist.toFixed(0)} m${v.visible ? "" : "  hidden"}`;
    const ty = Math.max(34, y - 17 - stag), tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = "rgba(8,10,13,.8)"; ctx.fillRect(x - tw / 2, ty - 13, tw, 18);
    ctx.fillStyle = v.visible ? "#5fd39a" : "#ef5b5b"; ctx.fillText(label, x, ty);
  }
  const bar = `az ${az.toFixed(0)}°   fov ${fov}°   sun ${sun.elevDeg.toFixed(1)}°   eye ${$("eyeH").value} m`;
  ctx.fillStyle = "rgba(8,10,13,.75)"; ctx.fillRect(0, H - 21, W, 21);
  ctx.textAlign = "left"; ctx.fillStyle = "#c3cad4"; ctx.fillText(bar, 10, H - 6);
  $("panoTag").textContent = S.T.meta.synthetic ? "SYNTHETIC" : "predicted, unvalidated";
  $("panoNote").textContent = "Terrain only. No rocks below DEM cell size, no atmosphere, no color. White line is the predicted skyline.";
}

// ---------- flags ----------
function flags() {
  const ul = $("flags"); ul.innerHTML = "";
  const add = (cls, text, ev) => { const li = document.createElement("li"); li.className = cls; li.innerHTML = `<div>${text}<span class="ev">${ev}</span></div>`; ul.appendChild(li); };
  const cur = currentSample();
  if (!cur) { add("", "Draw a route to get flags.", "n/a"); return; }
  const sun = sunNow(), thr = +$("thrSun").value;
  if (sun.elevDeg < 0) add("bad", "Sun is below the horizon at this time.", "geometry");
  else if (sun.elevDeg < thr) add("warn", `Low sun (${sun.elevDeg.toFixed(1)} deg, below ${thr} deg): slopes and shadows are easy to misjudge.`, "lunar-derived threshold, assumption");
  const h = hiddenGroundAhead(S.T, cur.x, cur.y, cur.heading, +$("eyeH").value, 50, 60);
  if (h.hiddenFraction > 0.25) add("warn", `Ground ahead is hidden: ${(h.hiddenFraction * 100).toFixed(0)}% of the 50 m cone, first hidden at ${h.firstHiddenDist} m.`, "geometry, Apollo 16 pattern");
  const sl = S.T.slopeDeg(cur.x, cur.y);
  if (sl > 20) add("bad", `Local slope ${sl.toFixed(0)} deg exceeds the 20 deg Artemis planning limit.`, "planning figure for the Moon");
  else if (sl > 15) add("warn", `Local slope ${sl.toFixed(0)} deg.`, "planning figure for the Moon");
  const anyVis = targets().some((t) => cur.vis[t.id].visible === true);
  if (targets().length && !anyVis) add("bad", "Nothing you could navigate by is in view from here.", "geometry over DEM");
  if (cur.partner && cur.partner.visible === false) add("bad", "Partner is out of line of sight.", "geometry, assumed partner gap");
  for (const r of S.runs) add("warn", `Blind stretch ${r.from.toFixed(0)} to ${r.to.toFixed(0)} m (${r.length.toFixed(0)} m).`, "geometry over DEM");
  if (!ul.children.length) add("ok", "No flags at this position and time.", "unvalidated");
}

// ---------- cuff card ----------
function cuff() {
  const b = $("cuffBody"), cur = currentSample();
  if (!cur) { b.textContent = "Draw a route (at least 2 points)."; return; }
  const ahead = S.rows.filter((r) => r.s >= cur.s && r.s <= cur.s + 120);
  const maxSl = Math.max(...ahead.map((r) => S.T.slopeDeg(r.x, r.y)).filter(isFinite), 0);
  const nextBlind = S.runs.find((r) => r.to >= cur.s);
  const hab = S.habitat ? Math.hypot(cur.x - S.habitat.x, cur.y - S.habitat.y) : null;
  const sun = sunNow(), thr = +$("thrSun").value;
  const kpi = (cls, l, v, u, s) => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}<small> ${u}</small></div><div class="s">${s || ""}</div></div>`;
  b.innerHTML =
    kpi("", "Heading", cur.heading.toFixed(0), "\u00b0", "travel direction") +
    (hab !== null ? kpi(cur.vis.hab.visible ? "ok" : "bad", "Habitat", hab.toFixed(0), "m", cur.vis.hab.visible ? "in view" : "hidden") : kpi("", "Habitat", "--", "", "not placed")) +
    kpi(maxSl > 20 ? "bad" : maxSl > 15 ? "warn" : "", "Max slope", maxSl.toFixed(0), "\u00b0", "next 120 m") +
    (nextBlind ? kpi("warn", "Blind stretch", Math.max(0, nextBlind.from - cur.s).toFixed(0), "m ahead", nextBlind.length.toFixed(0) + " m long") : kpi("ok", "Blind stretch", "none", "", "next 120 m")) +
    kpi(sun.elevDeg < thr ? "warn" : "", "Sun elevation", sun.elevDeg.toFixed(0), "\u00b0", sun.elevDeg < thr ? "low sun" : "ok") +
    kpi("", "Walk time", S.rows.length ? walkMinutes(S.T, S.rows).toFixed(0) : "--", "min", "assumed pace") +
    `<div class="cuffnote">Unvalidated terrain-model prediction.</div>`;
}

// ---------- provenance ----------
function provenance() {
  const m = S.T.meta;
  const rows = [
    ["Terrain", m.synthetic ? "SYNTHETIC test terrain" : (m.product || "USGS MSL Gale DEM mosaic 1 m"), m.synthetic ? "none" : `${m.cell_m} m cells; vertical error not stated here (HiRISE-class DEMs: tens of cm to a few m, tie dependent)`],
    ["Retrieved", m.retrieved_utc || "n/a", ""],
    ["Sun", "Geometric from latitude, Ls, local true solar time", "about a degree; no equation of time"],
    ["Walk time", "Assumed 2 km/h derated to 0 at 20 deg", "lunar planning numbers, not Mars measurements"],
    ["Low-sun flag", "User threshold (default 20 deg)", "assumption derived from lunar experience"],
    ["Heights", "Eye 1.7 m, partner 1.7 m, habitat 3 m, landmark 2 m", "editable assumptions"],
  ];
  $("prov").innerHTML = "<table>" + rows.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("") + "</table>";
}

// ---------- interaction ----------
function pickXY(ev) {
  const r = map.getBoundingClientRect();
  const [x, y] = toM((ev.clientX - r.left) * (map.width / r.width), (ev.clientY - r.top) * (map.height / r.height));
  return { x, y };
}
function bind() {
  map.addEventListener("click", (ev) => {
    const p = pickXY(ev);
    if (!S.T.inside(p.x, p.y)) return;
    if (S.mode === "route") S.route.push(p);
    else if (S.mode === "habitat") S.habitat = p;
    else if (S.mode === "rover") S.rover = p;
    else if (S.mode === "landmark") S.landmarks.push({ ...p, name: "Landmark " + (S.landmarks.length + 1) });
    recompute();
  });
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
    S.mode = b.dataset.mode;
    document.querySelectorAll(".mode").forEach((x) => x.classList.toggle("active", x === b));
  }));
  $("btnClear").onclick = () => { S.route = []; S.landmarks = []; S.habitat = null; S.rover = null; recompute(); };
  $("btnAuto").onclick = () => { S.landmarks = suggestLandmarks(); recompute(); };
  $("btnTraverse").onclick = () => {
    const w = S.traverse.waypoints.filter((q) => q.inside);
    S.route = w.map((q) => ({ x: q.x_m, y: q.y_m }));
    if (w.length) { S.habitat = { x: w[0].x_m, y: w[0].y_m }; }
    recompute();
  };
  for (const id of ["pos", "ltst", "ls", "lookMode", "lookAz", "fov"]) $(id).addEventListener("input", () => { if (id === "ltst" || id === "ls") drawHillshade(); recompute(); });
  for (const id of ["eyeH", "partnerGap", "landH", "habH", "thrSun", "blindMin", "showView", "showSlope"]) $(id).addEventListener("input", recompute);
  map.addEventListener("mousemove", (ev) => {
    const p = pickXY(ev), z = S.T.heightAt(p.x, p.y), sl = S.T.slopeDeg(p.x, p.y);
    $("hoverReadout").textContent = S.T.inside(p.x, p.y) ? `E ${p.x.toFixed(0)} m  S ${p.y.toFixed(0)} m   elev ${isFinite(z) ? z.toFixed(1) : "--"} m   slope ${isFinite(sl) ? sl.toFixed(1) : "--"}\u00b0` : "outside window";
  });
  $("strip").addEventListener("click", (ev) => {
    if (!S.stripGeom || !S.rows.length) return;
    const r = $("strip").getBoundingClientRect(), g = S.stripGeom;
    const t = Math.max(0, Math.min(1, ((ev.clientX - r.left) - g.left) / g.W));
    $("pos").value = Math.round(t * 1000); recompute();
  });
  let timer = null;
  $("btnPlay").onclick = () => {
    if (timer) { clearInterval(timer); timer = null; $("btnPlay").textContent = "Play"; return; }
    $("btnPlay").textContent = "Pause";
    timer = setInterval(() => { let v = +$("pos").value + 4; if (v > 1000) v = 0; $("pos").value = v; refresh(); scheduleViewshed(); }, 90);
  };
  window.addEventListener("resize", () => { setupMap(); refresh(); });
}
function defaultScene() {
  const T = S.T, W = T.extentX, H = T.extentY;
  S.habitat = { x: W * 0.15, y: H * 0.5 };
  S.rover = { x: W * 0.2, y: H * 0.52 };
  S.route = [{ x: W * 0.2, y: H * 0.5 }, { x: W * 0.4, y: H * 0.42 }, { x: W * 0.6, y: H * 0.55 }, { x: W * 0.8, y: H * 0.45 }];
  S.landmarks = suggestLandmarks();
}
// Highest points per 250 m block, kept if prominent over the window median. Placeholder logic.
function suggestLandmarks() {
  const T = S.T, B = Math.round(250 / T.cell), cand = [];
  for (let j = 0; j + B <= T.height; j += B) for (let i = 0; i + B <= T.width; i += B) {
    let best = -Infinity, bi = 0, bj = 0;
    for (let y = j; y < j + B; y++) for (let x = i; x < i + B; x++) { const z = T.data[y * T.width + x]; if (z > best) { best = z; bi = x; bj = y; } }
    if (isFinite(best)) cand.push({ z: best, x: (bi + 0.5) * T.cell, y: (bj + 0.5) * T.cell });
  }
  cand.sort((a, b) => b.z - a.z);
  return cand.slice(0, 4).map((c, i) => ({ x: c.x, y: c.y, name: "High point " + (i + 1) }));
}

init();
