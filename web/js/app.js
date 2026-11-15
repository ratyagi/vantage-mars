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
    $("dataBadge").className = "badge real";
  } catch (e) {
    S.T = makeSyntheticTerrain(800, 800, 2);
    $("dataBadge").textContent = "SYNTHETIC TERRAIN (not Mars data)";
    $("dataBadge").className = "badge synth";
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
  const cssW = map.clientWidth || 600;
  map.width = cssW; map.height = Math.round(cssW * (T.extentY / T.extentX));
  view.W = map.width; view.H = map.height; view.px = map.width / T.extentX;
  drawHillshade();
}
function drawHillshade() {
  const T = S.T, sun = sunNow();
  const g = hillshade(T, sun.azDeg, Math.max(15, sun.elevDeg), 3);
  const off = document.createElement("canvas"); off.width = T.width; off.height = T.height;
  const id = off.getContext("2d").createImageData(T.width, T.height);
  for (let i = 0; i < g.length; i++) { id.data[i * 4] = g[i] * 0.95; id.data[i * 4 + 1] = g[i] * 0.78; id.data[i * 4 + 2] = g[i] * 0.62; id.data[i * 4 + 3] = 255; }
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
    mctx.lineWidth = 3; mctx.strokeStyle = "#fff"; mctx.beginPath();
    S.rows.forEach((p, i) => { const [a, b] = toPx(p.x, p.y); i ? mctx.lineTo(a, b) : mctx.moveTo(a, b); });
    mctx.stroke();
    mctx.strokeStyle = "#eb5757"; mctx.lineWidth = 5;
    for (const r of S.runs) {
      mctx.beginPath();
      let first = true;
      for (const p of S.rows) if (p.s >= r.from && p.s <= r.to) { const [a, b] = toPx(p.x, p.y); first ? mctx.moveTo(a, b) : mctx.lineTo(a, b); first = false; }
      mctx.stroke();
    }
  } else if (S.route.length) {
    for (const p of S.route) { const [a, b] = toPx(p.x, p.y); mctx.fillStyle = "#fff"; mctx.fillRect(a - 3, b - 3, 6, 6); }
  }
  marker(S.habitat, "H", "#7fb4e6"); marker(S.rover, "R", "#6fcf97");
  S.landmarks.forEach((l, i) => marker(l, "L" + (i + 1), "#e0a458"));
  const cur = currentSample();
  if (cur) {
    const [a, b] = toPx(cur.x, cur.y);
    mctx.strokeStyle = "#00e5ff"; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(a, b, 7, 0, 7); mctx.stroke();
    const az = lookAz() * Math.PI / 180, f = $("fov").value * Math.PI / 360;
    mctx.beginPath(); mctx.moveTo(a, b);
    mctx.lineTo(a + Math.sin(az - f) * 40, b - Math.cos(az - f) * 40);
    mctx.moveTo(a, b); mctx.lineTo(a + Math.sin(az + f) * 40, b - Math.cos(az + f) * 40); mctx.stroke();
  }
}
function marker(m, label, color) {
  if (!m) return;
  const [a, b] = toPx(m.x, m.y);
  mctx.fillStyle = color; mctx.beginPath(); mctx.arc(a, b, 8, 0, 7); mctx.fill();
  mctx.fillStyle = "#111"; mctx.font = "bold 10px sans-serif"; mctx.textAlign = "center"; mctx.fillText(label, a, b + 3.5);
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
  $("sunReadout").textContent = `Sun: elevation ${sun.elevDeg.toFixed(1)} deg, azimuth ${sun.azDeg.toFixed(0)} deg (approximate, geometric; no atmosphere or equation of time).`
    + (S.rows.length ? ` Walk estimate ${walkMinutes(S.T, S.rows).toFixed(0)} min (assumed 2 km/h, derated to 0 at 20 deg).` : "");
}

// ---------- strip ----------
function drawStrip() {
  const c = $("strip"), ctx = c.getContext("2d");
  c.width = c.clientWidth; c.height = c.clientHeight;
  ctx.fillStyle = "#0e0c0a"; ctx.fillRect(0, 0, c.width, c.height);
  if (!S.rows.length) { ctx.fillStyle = "#a99a8a"; ctx.fillText("Draw a route to see visibility.", 12, 24); return; }
  const tg = targets(), n = S.rows.length, total = S.rows[n - 1].s;
  const left = 78, rowH = 18, top = 8, W = c.width - left - 8;
  const X = (s) => left + (s / total) * W;
  ctx.font = "11px sans-serif"; ctx.textAlign = "right";
  const lines = [...tg.map((t) => ({ id: t.id, label: t.name })), { id: "__p", label: "Partner" }];
  lines.forEach((ln, k) => {
    const y = top + k * (rowH + 3);
    ctx.fillStyle = "#a99a8a"; ctx.fillText(ln.label.slice(0, 12), left - 6, y + 13);
    for (let i = 0; i < n - 1; i++) {
      const v = ln.id === "__p" ? S.rows[i].partner?.visible : S.rows[i].vis[ln.id]?.visible;
      ctx.fillStyle = v === true ? "#2f8f6b" : v === false ? "#a33a3a" : "#3a312a";
      ctx.fillRect(X(S.rows[i].s), y, Math.max(1, X(S.rows[i + 1].s) - X(S.rows[i].s) + 0.5), rowH);
    }
  });
  const base = top + lines.length * (rowH + 3) + 6;
  // slope
  ctx.fillStyle = "#a99a8a"; ctx.fillText("Slope", left - 6, base + 30);
  const hgt = c.height - base - 22;
  ctx.strokeStyle = "#e0a458"; ctx.beginPath();
  S.rows.forEach((r, i) => { const sl = S.T.slopeDeg(r.x, r.y); const y = base + hgt - Math.min(30, isFinite(sl) ? sl : 0) / 30 * hgt; i ? ctx.lineTo(X(r.s), y) : ctx.moveTo(X(r.s), y); });
  ctx.stroke();
  for (const [deg, col] of [[15, "#f2994a"], [20, "#eb5757"]]) {
    const y = base + hgt - (deg / 30) * hgt; ctx.strokeStyle = col; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + W, y); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = "#a99a8a"; ctx.textAlign = "center"; ctx.fillText("distance along route (m)", left + W / 2, c.height - 4);
  const cur = currentSample();
  if (cur) { ctx.strokeStyle = "#00e5ff"; ctx.beginPath(); ctx.moveTo(X(cur.s), 0); ctx.lineTo(X(cur.s), c.height - 14); ctx.stroke(); }
}

// ---------- panorama ----------
function drawPano() {
  const c = $("pano"), ctx = c.getContext("2d");
  const cur = currentSample();
  const W = 720, H = Math.round(720 / 3.2); c.width = W; c.height = H;
  if (!cur) { ctx.fillStyle = "#0e0c0a"; ctx.fillRect(0, 0, W, H); return; }
  const sun = sunNow(), az = lookAz(), fov = +$("fov").value;
  const p = renderPanorama(S.T, cur.x, cur.y, +$("eyeH").value, az, fov, W, H, sun, { angMin: -30, angMax: 20 });
  ctx.putImageData(new ImageData(p.pixels, W, H), 0, 0);
  const colOf = (b) => ((((b - az + 540) % 360) - 180) / fov + 0.5) * W;
  ctx.font = "11px sans-serif"; ctx.textAlign = "center";
  let k = 0;
  for (const t of targets()) {
    const v = cur.vis[t.id]; if (!v) continue;
    const stag = (k++ % 4) * 13;
    const x = colOf(v.bearing); if (x < 0 || x > W) continue;
    const ang = (Math.atan2(t.h - 0, v.dist) * 180) / Math.PI - (Math.atan2(0, v.dist));
    const baseA = Math.atan2((S.T.heightAt(t.x, t.y) - (S.T.heightAt(cur.x, cur.y) + +$("eyeH").value)), v.dist) * 180 / Math.PI;
    const y = ((p.angMax - (baseA + ang)) / (p.angMax - p.angMin)) * (H - 1);
    ctx.fillStyle = v.visible ? "#6fcf97" : "#eb5757";
    ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x - 5, y - 20); ctx.lineTo(x + 5, y - 20); ctx.fill();
    ctx.fillText(`${t.name} ${v.dist.toFixed(0)} m${v.visible ? "" : " (hidden)"}`, x, Math.max(11, y - 24 - stag));
  }
  ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, H - 16, W, 16);
  ctx.fillStyle = "#efe6dc"; ctx.textAlign = "left";
  ctx.fillText(`az ${az.toFixed(0)} deg  fov ${fov}  sun el ${sun.elevDeg.toFixed(1)} deg  eye ${$("eyeH").value} m`, 6, H - 4);
  $("panoTag").textContent = S.T.meta.synthetic ? "SYNTHETIC" : "predicted, unvalidated";
  $("panoNote").textContent = "Terrain only: no rocks smaller than the DEM cell, no atmosphere model, no color. Markers show landmark top positions.";
}

// ---------- flags ----------
function flags() {
  const ul = $("flags"); ul.innerHTML = "";
  const add = (cls, text, ev) => { const li = document.createElement("li"); li.className = cls; li.innerHTML = text + `<span class="ev">${ev}</span>`; ul.appendChild(li); };
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
  const sun = sunNow();
  b.innerHTML =
    `Heading <span class="k">${cur.heading.toFixed(0)}&deg;</span><br>` +
    (hab !== null ? `Habitat <span class="k">${hab.toFixed(0)} m</span> ${cur.vis.hab.visible ? "in view" : "<b>hidden</b>"}<br>` : "") +
    `Max slope next 120 m <span class="k">${maxSl.toFixed(0)}&deg;</span><br>` +
    (nextBlind ? `Blind stretch at <span class="k">${Math.max(0, nextBlind.from - cur.s).toFixed(0)} m</span> for ${nextBlind.length.toFixed(0)} m<br>` : "No blind stretch ahead<br>") +
    `Sun <span class="k">${sun.elevDeg.toFixed(0)}&deg;</span> el<small>Unvalidated prediction. Terrain model only.</small>`;
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
