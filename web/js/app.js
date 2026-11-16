import { Terrain, makeSyntheticTerrain, hillshade } from "./terrain.js";
import { sunPosition } from "./sun.js";
import {
  sampleRoute, routeVisibility, blindRuns, skyline, hiddenGroundAhead,
  viewshed, renderPanorama, costField, daylightLeftMin, radioCoverage, relaySites, skylineAt, skylineMismatch, sunTransmission, visualRangeM, lineOfSight, walkMinutes, cumulativeWalkMinutes, inTerrainShadow, visibilityFraction, planRoute, azimuthDeg, suggestLandmarks, SLOPE_BASELINE_M,
} from "./visibility.js";

const $ = (id) => document.getElementById(id);
const S = {
  T: null, route: [], landmarks: [], habitat: null, rover: null, mode: "route",
  rows: [], runs: [], traverse: null, hs: null, vs: null, vsTimer: null, fit: true, view: null,
};

// ---------- load ----------
async function init() {
  try {
    S.T = await Terrain.load("data/");
    if (S.T.meta.synthetic) throw new Error("data flagged synthetic");
    $("dataBadge").textContent = `USGS Gale DEM, ${S.T.width}x${S.T.height} at ${S.T.cell} m`;
    $("dataBadge").className = "chip real";
  } catch (e) {
    S.T = makeSyntheticTerrain(800, 800, 2); // development fallback only
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
  bind();
  provenance();
  loadValidation();
  defaultScene();
  fitView();
  setupMap();
  syncZoomLabel();
  recompute();
  heroStart();
}


// ---------- validation panel ----------
async function loadValidation() {
  const chip = $("valChip"), box = $("valPanel");
  try {
    const d = await (await fetch("data/validation/results.json")).json();
    S.valid = d;
    const f = (v, n = 2) => (+v).toFixed(n);
    const rows = d.stops.map((s) => `<tr><td>Sol ${s.sol}</td><td>${s.skyline_all.n}</td><td><b>${f(s.skyline_all.rmse_deg)}&deg;</b></td><td>${Math.round(s.skyline_all.within_1deg * 100)}%</td></tr>`).join("");
    chip.textContent = "Skyline vs real Navcam: " + d.stops.map((x) => f(x.skyline_all.rmse_deg, 1)).join(" / ") + "\u00b0 at 3 stops";
    chip.title = "RMSE of predicted vs real skyline at sols " + d.stops.map((x) => x.sol).join(", ") + ". The 4.9 deg stop looks toward a far horizon outside the model window.";
    chip.className = "chip warn";
    box.innerHTML = `<p class="note"><b>Predicted skyline vs real Curiosity Navcam frames</b> (${d.stops.length} stops, ${d.pooled.all.n} samples, camera height 2.0 m, nothing tuned to these images).</p>
      <table class="vtab"><tr><th></th><th>n</th><th>RMSE</th><th>within 1&deg;</th></tr>${rows}</table>
      <p class="note"><b>Works:</b> when the skyline is terrain inside the 2.5 km window (foothills, nearby ridges), error is about half a degree.</p>
      <p class="note"><b>Fails:</b> when the real skyline lies beyond the window (looking north across the crater floor at sol 4634) the model horizon is 3 to 6&deg; too low. That case is measured at one stop only. Treat far horizons as unvalidated.</p>
      <p class="note">Moving the observer 25 m raises error at sol 4748 from 0.43&deg; to 0.81&deg;.</p>
      <div class="vbtns"><span class="note">Show the real camera skyline over the predicted view:</span>${d.stops.map((x, i) => `<button class="pill" data-stop="${i}">Sol ${x.sol}</button>`).join("")}<button class="pill" data-stop="-1">Clear</button></div>
      <div class="vbtns"><span class="note">Find where Curiosity stood from the photo\u2019s skyline alone:</span>${d.stops.map((x, i) => `<button class="pill" data-loc="${i}">Sol ${x.sol}</button>`).join("")}</div>
      <img class="vimg" src="data/validation/skyline_comparison.png" alt="Predicted vs real skyline at three Curiosity stops" loading="lazy">
      <p class="note">Images: NASA/JPL-Caltech. <a href="https://github.com/" id="valLink" target="_blank" rel="noopener">Method and links</a> are in docs/VALIDATION.md.</p>`;
    box.querySelectorAll("button[data-stop]").forEach((b) => { b.onclick = () => showRealCamera(+b.dataset.stop); });
    box.querySelectorAll("button[data-loc]").forEach((b) => { b.onclick = () => { locateFromPhoto(+b.dataset.loc); window.scrollTo({ top: 0, behavior: "smooth" }); }; });
    const a = $("valLink"); if (a) { a.href = "https://github.com/" + (location.hostname.split(".")[0] || "") + "/vantage-mars/blob/main/docs/VALIDATION.md"; }
  } catch (_) {
    chip.textContent = "Validation: results unavailable"; chip.className = "chip warn";
    box.innerHTML = '<p class="note">Validation results could not be loaded. Treat predictions as unvalidated.</p>';
  }
}


// ---------- safety layers: shelter reach, return-by clocks, radio shadow ----------
function refreshSafety() {
  const T = S.T, h = S.habitat;
  if (!h) { S.reach = null; S.reachKey = ""; S.radio = null; S.relay = null; return; }
  const hk = Math.round(h.x) + "," + Math.round(h.y);
  if (S.reachKey !== hk) { S.reach = costField(T, h); S.reachKey = hk; S.reachImg = null; }
  if (S.rows.length > 1) {
    const habH = +$("habH").value;
    S.radio = radioCoverage(T, S.rows, h, habH, 1.7, (a, b) => (S.cum[b] || 0) - (S.cum[a] || 0) + 0.3);
    const rk = [hk, habH, +$("relayH").value, S.rows.length, Math.round(S.rows[0].x), Math.round(S.rows[S.rows.length - 1].x), Math.round(S.rows[S.rows.length >> 1].y)].join("|");
    if (S.relayKey !== rk) { S.relay = relaySites(T, S.rows, h, habH, { relayH: +$("relayH").value, grid: 25 }); S.relayKey = rk; }
  } else { S.radio = null; S.relay = null; S.relayKey = ""; }
}
function returnMin(cur) { return S.reach && cur ? S.reach.at(cur.x, cur.y) : null; }
// Smallest slack among the clocks that apply here. All are time clocks on assumed numbers, not a dose or life-support model.
function startBack(cur) {
  const ret = returnMin(cur);
  if (ret === null || !isFinite(ret)) return null;
  const idx = S.rows.indexOf(cur), used = S.cum && S.cum.length && idx >= 0 ? S.cum[idx] : 0;
  const items = [];
  if ($("sepAlert").checked) items.push({ k: "shelter limit", min: +$("shelterMin").value - ret });
  const lat = S.T?.meta?.window_center_lonlat?.[1] ?? -4.8, ls = +$("ls").value;
  const day = daylightLeftMin(S.T, cur.x, cur.y, (h) => sunPosition(lat, ls, h), +$("ltst").value);
  if (day) items.push({ k: day.reason.startsWith("terrain") ? "terrain shadow" : "daylight", min: day.min - ret });
  items.push({ k: "suit time", min: +$("evaMin").value - used - +$("reserveMin").value - ret });
  items.sort((a, b) => a.min - b.min);
  return { ret, used, limiting: items[0], items };
}
function reachImage() {
  const R = S.reach; if (!R) return null;
  const lim = +$("shelterMin").value, key = S.reachKey + "|" + lim;
  if (S.reachImg && S.reachImgKey === key) return S.reachImg;
  const cv = document.createElement("canvas"); cv.width = R.gw; cv.height = R.gh;
  const cx = cv.getContext("2d"), id = cx.createImageData(R.gw, R.gh), D = id.data;
  for (let j = 0; j < R.gh; j++) for (let i = 0; i < R.gw; i++) {
    const k = j * R.gw + i, m = R.minutes[k];
    if (!isFinite(m) || Math.hypot((i + 0.5) * R.g - (S.habitat.x - R.x0), (j + 0.5) * R.g - (S.habitat.y - R.y0)) > R.radius * 0.97) continue;
    const mr = i + 1 < R.gw ? R.minutes[k + 1] : m, md = j + 1 < R.gh ? R.minutes[k + R.gw] : m;
    let r, g, b, a;
    if (m <= lim) { r = 76; g = 201; b = 160; a = 36; } else { r = 239; g = 91; b = 91; a = 48; }
    if (Math.floor(m / 15) !== Math.floor(mr / 15) || Math.floor(m / 15) !== Math.floor(md / 15)) { r = g = b = 255; a = 120; }
    if ((m <= lim) !== (mr <= lim) || (m <= lim) !== (md <= lim)) { r = 245; g = 185; b = 74; a = 255; }
    const o = k * 4; D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = a;
  }
  cx.putImageData(id, 0, 0);
  S.reachImg = cv; S.reachImgKey = key; return cv;
}
function drawReach() {
  const cv = reachImage(), R = S.reach; if (!cv) return;
  const [ax, ay] = toPx(R.x0, R.y0), [bx, by] = toPx(R.x0 + R.gw * R.g, R.y0 + R.gh * R.g);
  mctx.imageSmoothingEnabled = true; mctx.drawImage(cv, ax, ay, bx - ax, by - ay);
}
function drawRadioLayer() {
  const v = S.rvs;
  if (v) {
    mctx.fillStyle = "rgba(150,135,255,.15)";
    for (let j = 0; j < v.gh; j++) for (let i = 0; i < v.gw; i++) {
      if (v.grid[j * v.gw + i] !== 1) continue;
      const [a, b] = toPx(v.x0 + i * v.cellM, v.y0 + j * v.cellM);
      mctx.fillRect(a, b, v.cellM * view.px + 0.6, v.cellM * view.px + 0.6);
    }
  }
}
function drawRadioRoute() {
  if (!S.radio || S.rows.length < 2) return;
  const d = view.dpr || 1; mctx.save(); mctx.strokeStyle = "#9687ff"; mctx.lineWidth = 7 * d; mctx.lineCap = "round"; mctx.setLineDash([2 * d, 7 * d]);
  let open = false; mctx.beginPath();
  S.rows.forEach((p, i) => { const [a, b] = toPx(p.x, p.y); if (!S.radio.ok[i]) { open ? mctx.lineTo(a, b) : mctx.moveTo(a, b); open = true; } else open = false; });
  mctx.stroke(); mctx.restore();
  (S.relay?.picks || []).forEach((r, i) => marker(r, "R" + (i + 1), "#b9a8ff"));
}


// ---------- horizon fix ("Locate"): find the walker from the skyline alone ----------
// Search a 1.2 km box around the habitat on a 20 m grid, then refine to 4 m around the best cell. Animated in chunks.
let locJob = 0;
function gaussRand() { return Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random()); }
function locateFromHere() {
  const c = currentSample(); if (!c) return;
  const azs = []; for (let a = 0; a < 360; a += 4) azs.push(a);
  const sk = skylineAt(S.T, c.x, c.y, +$("eyeH").value, azs);
  const obs = azs.map((a, i) => ({ az: a, el: sk[i] + gaussRand() * 0.5 }));
  runLocate({ obs, eyeH: +$("eyeH").value, truth: { x: c.x, y: c.y }, label: `horizon from one slow turn on the spot (simulated helmet camera, 0.5\u00b0 measurement noise)`, sim: true });
}
function locateFromPhoto(i) {
  const st = S.valid?.stops?.[i]; if (!st) return;
  const bins = new Map(); for (const q of st.columns) { const k = Math.round(q.az / 2) * 2; if (!bins.has(k)) bins.set(k, []); bins.get(k).push(q.real_el); }
  const obs = [...bins].map(([a, v]) => ({ az: (a + 360) % 360, el: v.reduce((t, q) => t + q, 0) / v.length }));
  runLocate({ obs, eyeH: 2.0, truth: { x: st.rover_position.x_m, y: st.rover_position.y_m }, label: `skyline traced from a real Curiosity Navcam frame, sol ${st.sol} (${obs.length} directions)`, sol: st.sol });
}
function runLocate(job) {
  const id = ++locJob, T = S.T, ctr = S.habitat || job.truth, R = 600, g = 20;
  const x0 = Math.max(T.cell * 2, ctr.x - R), y0 = Math.max(T.cell * 2, ctr.y - R);
  const gw = Math.floor((Math.min(T.extentX - 2, ctr.x + R) - x0) / g), gh = Math.floor((Math.min(T.extentY - 2, ctr.y + R) - y0) / g);
  const err = new Float32Array(gw * gh).fill(NaN);
  S.loc = { ...job, x0, y0, g, gw, gh, err, done: false, best: null };
  $("showReach").checked = false;
  const box = $("locBox"); box.classList.remove("hidden");
  box.innerHTML = `<div class="lh">HORIZON FIX</div><button class="lclose" id="locClose">Close</button><div class="lmain">Matching the horizon against ${gw * gh} positions...</div><div class="locbar"><i id="locBar"></i></div>`;
  $("locClose").onclick = closeLocate;
  setupMap(); refresh();
  let k = 0;
  const step = () => {
    if (id !== locJob) return;
    const end = Math.min(gw * gh, k + 220);
    for (; k < end; k++) { const i = k % gw, j = (k / gw) | 0; err[k] = skylineMismatch(T, x0 + (i + 0.5) * g, y0 + (j + 0.5) * g, job.eyeH, job.obs); }
    $("locBar").style.width = (100 * k / (gw * gh)).toFixed(0) + "%";
    S.locImg = null; drawMap();
    if (k < gw * gh) return setTimeout(step, 0);
    // best cell, refine, and the best fit somewhere else (more than 100 m away) to judge ambiguity
    const order = [...err.keys()].filter((q) => isFinite(err[q])).sort((p1, p2) => err[p1] - err[p2]);
    const seeds = []; for (const q of order) { const x = x0 + ((q % gw) + 0.5) * g, y = y0 + (((q / gw) | 0) + 0.5) * g; if (seeds.every((t) => Math.hypot(t.x - x, t.y - y) > 40)) seeds.push({ x, y }); if (seeds.length === 5) break; }
    let best = { x: seeds[0].x, y: seeds[0].y, e: Infinity };
    for (const sd of seeds) for (let y = sd.y - 16; y <= sd.y + 16; y += 4) for (let x = sd.x - 16; x <= sd.x + 16; x += 4) { const e = skylineMismatch(T, x, y, job.eyeH, job.obs); if (e < best.e) best = { x, y, e }; }
    let alt = Infinity; for (let q = 0; q < err.length; q++) { const x = x0 + ((q % gw) + 0.5) * g, y = y0 + (((q / gw) | 0) + 0.5) * g; if (Math.hypot(x - best.x, y - best.y) > 100 && err[q] < alt) alt = err[q]; }
    S.loc.best = best; S.loc.alt = alt; S.loc.done = true; drawMap();
    const miss = Math.hypot(best.x - job.truth.x, best.y - job.truth.y), conf = alt > best.e * 1.5;
    const why = job.sol === 4634 ? "Real horizon is the far crater rim, outside the 2.5 km terrain window." : job.sol === 4839 ? "Only about 30\u00b0 of skyline in this frame." : "";
    const src = job.sim ? "simulated turn on the spot" : `real Navcam photo, sol ${job.sol}`;
    box.innerHTML = `<div class="lh">HORIZON FIX</div><button class="lclose" id="locClose">Close</button><div class="lmain"><b class="${conf ? "" : "bad"}">${miss.toFixed(0)} m</b> from true position \u00b7 ${conf ? "unambiguous" : "ambiguous, do not trust"}</div><div class="lsub">${src.charAt(0).toUpperCase() + src.slice(1)}. ${why ? why + " " : ""}Skyline fit ${best.e.toFixed(2)}\u00b0 vs ${alt.toFixed(2)}\u00b0 for the best spot elsewhere. Heading from a sun sighting. Advisory.</div>`;
    $("locClose").onclick = closeLocate;
  };
  step();
}
function closeLocate() { locJob++; S.loc = null; S.locImg = null; $("locBox").classList.add("hidden"); setupMap(); refresh(); }
function drawLoc() {
  const L = S.loc; if (!L) return;
  if (!S.locImg) {
    const cv = document.createElement("canvas"); cv.width = L.gw; cv.height = L.gh;
    const cx = cv.getContext("2d"), id = cx.createImageData(L.gw, L.gh), D = id.data;
    for (let k = 0; k < L.err.length; k++) { const e = L.err[k]; if (!isFinite(e)) continue; const q = Math.max(0, 1 - e / 2); const o = k * 4; D[o] = 20 + 80 * q; D[o + 1] = 60 + 190 * q; D[o + 2] = 90 + 160 * q; D[o + 3] = 70 + 185 * q * q; }
    cx.putImageData(id, 0, 0); S.locImg = cv;
  }
  const [ax, ay] = toPx(L.x0, L.y0), [bx, by] = toPx(L.x0 + L.gw * L.g, L.y0 + L.gh * L.g);
  mctx.imageSmoothingEnabled = false; mctx.drawImage(S.locImg, ax, ay, bx - ax, by - ay); mctx.imageSmoothingEnabled = true;
  const d = view.dpr || 1;
  if (L.done && L.best) {
    const [tx, ty] = toPx(L.truth.x, L.truth.y), [fx, fy] = toPx(L.best.x, L.best.y);
    mctx.strokeStyle = "#fff"; mctx.lineWidth = 1.5 * d; mctx.setLineDash([4 * d, 4 * d]); mctx.beginPath(); mctx.moveTo(tx, ty); mctx.lineTo(fx, fy); mctx.stroke(); mctx.setLineDash([]);
    mctx.lineWidth = 2.5 * d; mctx.beginPath(); mctx.moveTo(tx - 6 * d, ty - 6 * d); mctx.lineTo(tx + 6 * d, ty + 6 * d); mctx.moveTo(tx + 6 * d, ty - 6 * d); mctx.lineTo(tx - 6 * d, ty + 6 * d); mctx.stroke();
    mctx.strokeStyle = "#4cc9d8"; mctx.lineWidth = 3 * d; mctx.beginPath(); mctx.arc(fx, fy, 11 * d, 0, 7); mctx.stroke();
    mctx.fillStyle = "#4cc9d8"; mctx.beginPath(); mctx.arc(fx, fy, 3.5 * d, 0, 7); mctx.fill();
    mctx.font = `700 ${11 * d}px sans-serif`; mctx.textAlign = "left"; mctx.shadowColor = "#000"; mctx.shadowBlur = 4 * d;
    mctx.fillText("FIX", fx + 14 * d, fy + 4 * d); mctx.fillStyle = "#fff"; mctx.fillText("TRUE", tx + 10 * d, ty - 8 * d); mctx.shadowBlur = 0;
  }
}

// ---------- map ----------
const map = $("map"), mctx = map.getContext("2d");
let view = { px: 1, W: 0, H: 0 };

function fitView() {
  const T = S.T, full = Math.min(T.extentX, T.extentY);
  if (!S.fit || S.route.length < 2) { S.view = { x0: 0, y0: 0, size: full }; return; }
  const pts = [...S.route, ...S.landmarks, ...(S.habitat ? [S.habitat] : []), ...(S.rover ? [S.rover] : [])];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const size = Math.min(full, Math.max(900, Math.max(x1 - x0, y1 - y0) + 700));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  S.view = { x0: Math.max(0, Math.min(T.extentX - size, cx - size / 2)), y0: Math.max(0, Math.min(T.extentY - size, cy - size / 2)), size };
}
function setupMap() {
  const T = S.T;
  if (!S.view) fitView();
  const wrap = $("mapwrap"), lg = wrap.querySelector(".legend");
  const lb = $("locBox"), lbH = lb.classList.contains("hidden") ? 0 : lb.offsetHeight + 10;
  const aw = Math.max(240, wrap.clientWidth - 28), ah = Math.max(240, wrap.clientHeight - 28 - (lg ? lg.offsetHeight + 10 : 0) - lbH);
  const side = Math.min(aw, ah);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  map.style.width = Math.round(side) + "px"; map.style.height = Math.round(side) + "px";
  map.width = Math.round(side * dpr); map.height = Math.round(side * dpr);
  view.W = map.width; view.H = map.height; view.px = map.width / S.view.size; view.dpr = dpr;
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
const toPx = (x, y) => [(x - S.view.x0) * view.px, (y - S.view.y0) * view.px];
const toM = (cx, cy) => [cx / view.px + S.view.x0, cy / view.px + S.view.y0];

function drawMap() {
  const T = S.T;
  mctx.clearRect(0, 0, view.W, view.H);
  mctx.imageSmoothingEnabled = true;
  const V = S.view, cell = T.cell;
  mctx.drawImage(S.hs, V.x0 / cell, V.y0 / cell, V.size / cell, V.size / cell, 0, 0, view.W, view.H);
  if ($("showReach").checked && S.reach) drawReach();
  if ($("showSlope").checked) drawSlope();
  if ($("showRadio").checked) drawRadioLayer();
  if ($("showView").checked && S.vs) drawViewshed();
  if (S.planned) {
    mctx.save(); mctx.setLineDash([8, 6]); mctx.strokeStyle = "#4cc9d8"; mctx.lineWidth = 2.5; mctx.beginPath();
    S.planned.forEach((p, i) => { const [x, y] = toPx(p.x, p.y); i ? mctx.lineTo(x, y) : mctx.moveTo(x, y); });
    mctx.stroke(); mctx.restore();
  }
  if ($("showRadio").checked) drawRadioRoute();
  drawLoc();
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
  const target = S.view.size * 0.2;
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
  const T = S.T, V = S.view, st = Math.max(1, Math.round(V.size / T.cell / 170)), cm = st * T.cell;
  for (let y = V.y0; y < V.y0 + V.size; y += cm) for (let x = V.x0; x < V.x0 + V.size; x += cm) {
    const sl = T.slopeDeg(x + cm / 2, y + cm / 2, SLOPE_BASELINE_M);
    if (!(sl > 15)) continue;
    const [a, b] = toPx(x, y);
    mctx.fillStyle = sl > 20 ? "rgba(239,91,91,.5)" : "rgba(245,185,74,.45)";
    mctx.fillRect(a, b, cm * view.px + 1, cm * view.px + 1);
  }
}
function drawViewshed() {
  const v = S.vs;
  if (!v) return;
  mctx.fillStyle = "rgba(76,201,216,.30)";
  for (let j = 0; j < v.gh; j++) for (let i = 0; i < v.gw; i++) {
    if (v.grid[j * v.gw + i] !== 1) continue;
    const [a, b] = toPx(v.x0 + i * v.cellM, v.y0 + j * v.cellM);
    mctx.fillRect(a, b, v.cellM * view.px + 0.6, v.cellM * view.px + 0.6);
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
  if (S.habitat) t.push({ id: "hab", short: "HAB", name: "Habitat", kind: "habitat", x: S.habitat.x, y: S.habitat.y, h: hh });
  if (S.rover) t.push({ id: "rov", short: "ROV", name: "Rover", kind: "rover", x: S.rover.x, y: S.rover.y, h: 2.5 });
  S.landmarks.forEach((l, i) => t.push({ id: "L" + (i + 1), short: "S" + (i + 1), name: l.name || "Landmark " + (i + 1), kind: "landmark", x: l.x, y: l.y, h: lh }));
  return t;
}

// ---------- compute ----------
function recompute() {
  const T = S.T;
  const opts = { eyeH: +$("eyeH").value, partnerGap: +$("partnerGap").value };
  S.rows = S.route.length > 1 ? routeVisibility(T, sampleRoute(S.route, 10), targets(), opts) : [];
  S.cum = S.rows.length ? cumulativeWalkMinutes(S.T, S.rows) : [];
  refreshSafety();
  S.runs = S.rows.length ? blindRuns(S.rows, targets(), +$("blindMin").value) : [];
  $("oLtst").textContent = (+$("ltst").value).toFixed(2);
  $("oTau").textContent = (+$("tau").value).toFixed(1);
  $("oLs").textContent = $("ls").value;
  $("oFov").textContent = $("fov").value;
  $("oAz").textContent = $("lookAz").value;
  scheduleViewshed();
  refresh();
}
function scheduleViewshed() {
  clearTimeout(S.vsTimer);
  S.vsTimer = setTimeout(() => {
    S.rvs = null;
    if ($("showRadio").checked && S.habitat) { const V0 = S.view, st0 = Math.max(1, Math.round(V0.size / S.T.cell / 170)); S.rvs = viewshed(S.T, S.habitat.x, S.habitat.y, +$("habH").value, 1.7, st0, 2500, { x0: V0.x0, y0: V0.y0, x1: V0.x0 + V0.size, y1: V0.y0 + V0.size }); }
    const c = currentSample();
    if (!c || !$("showView").checked) { S.vs = null; drawMap(); return; }
    const V = S.view, stride = Math.max(1, Math.round(V.size / S.T.cell / 170));
    S.vs = viewshed(S.T, c.x, c.y, +$("eyeH").value, 0, stride, 1500, { x0: V.x0, y0: V.y0, x1: V.x0 + V.size, y1: V.y0 + V.size });
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
  const lines = [...tg.map((t) => ({ id: t.id, label: t.name })), { id: "__p", label: "Partner" }, ...(S.radio ? [{ id: "__r", label: "Radio to hab" }] : [])];
  ctx.textAlign = "right";
  lines.forEach((ln, k) => {
    const y = top + k * (rowH + gap);
    ctx.fillStyle = "#8b95a4"; ctx.fillText(ln.label.slice(0, 13), left - 8, y + 11);
    for (let i = 0; i < n - 1; i++) {
      const v = ln.id === "__p" ? S.rows[i].partner?.visible : ln.id === "__r" ? S.radio.ok[i] : S.rows[i].vis[ln.id]?.visible;
      ctx.fillStyle = v === true ? "#2e9e78" : v === false ? (ln.id === "__r" ? "#6b5fb4" : "#b4454a") : "#2a313b";
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
  S.rows.forEach((r, i) => { const sl = S.T.slopeDeg(r.x, r.y, SLOPE_BASELINE_M); const y = base + hgt - Math.min(30, isFinite(sl) ? sl : 0) / 30 * hgt; i ? ctx.lineTo(X(r.s), y) : ctx.moveTo(X(r.s), y); });
  ctx.stroke();
  ctx.fillStyle = "#5d6775"; ctx.textAlign = "center";
  const step = total > 1500 ? 500 : total > 600 ? 200 : 100;
  for (let s = 0; s <= total; s += step) { ctx.fillText(s + " m", Math.min(X(s), left + W - 14), ch - 5); }
  const cur = currentSample();
  if (cur) { ctx.strokeStyle = "#4cc9d8"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(cur.s), 2); ctx.lineTo(X(cur.s), ch - 16); ctx.stroke(); }
  S.stripGeom = { left, W, total };
}

// ---------- panorama ----------
function drawPano(big) {
  if (big === true) return drawPanoOn($("panoBig"), 2.4);
  drawPanoOn($("pano"), 3.6);
  if (!$("walker").classList.contains("hidden")) { drawPanoOn($("panoBig"), 2.4); walkerHud(); }
}
function drawPanoOn(c, ratio) {
  const ctx = c.getContext("2d"), d = Math.min(2, window.devicePixelRatio || 1);
  const CW = Math.max(320, c.clientWidth || 500), CH = Math.round(CW / ratio);
  const W = Math.round(CW * d), H = Math.round(CH * d);
  c.width = W; c.height = H;
  const cur = currentSample();
  if (!cur) { ctx.fillStyle = "#0b0e12"; ctx.fillRect(0, 0, W, H); return; }
  const sun = sunNow(), az = lookAz(), fov = +$("fov").value;
  const p = renderPanorama(S.T, cur.x, cur.y, +$("eyeH").value, az, fov, W, H, sun, { angMin: -30, angMax: 20, haze: Math.max(1 / 6000, +$("tau").value / 11000 * 3) });
  ctx.putImageData(new ImageData(p.pixels, W, H), 0, 0);
  ctx.setTransform(d, 0, 0, d, 0, 0); // draw annotations in CSS pixels
  const colOf = (b) => ((((b - az + 540) % 360) - 180) / fov + 0.5) * CW;
  const rowOfA = (a) => ((p.angMax - a) / (p.angMax - p.angMin)) * (CH - 1);
  ctx.font = "11px Inter, system-ui, sans-serif";
  // horizon reference and skyline
  ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1; ctx.setLineDash([4, 5]); ctx.beginPath();
  ctx.moveTo(0, rowOfA(0)); ctx.lineTo(CW, rowOfA(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1.2; ctx.beginPath();
  for (let x = 0; x < W; x++) { const y = p.skylineRow[x]; x ? ctx.lineTo(x / d, y / d) : ctx.moveTo(x / d, y / d); }
  ctx.stroke();
  // sun marker
  if (sun.elevDeg > p.angMin && sun.elevDeg < p.angMax) {
    const sx = colOf(sun.azDeg);
    if (sx > -80 && sx < CW + 80) {
      const sy = rowOfA(sun.elevDeg), gr = ctx.createRadialGradient(sx, sy, 2, sx, sy, 120);
      gr.addColorStop(0, "rgba(255,244,200,.55)"); gr.addColorStop(1, "rgba(255,244,200,0)");
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = gr; ctx.fillRect(sx - 120, sy - 120, 240, 240); ctx.restore();
      ctx.fillStyle = "#fff8dc"; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
    }
  }
  // real-camera overlay: skyline traced from a Curiosity Navcam frame at this stop (validation data)
  const rc = S.real;
  if (rc && Math.hypot(cur.x - rc.stop.rover_position.x_m, cur.y - rc.stop.rover_position.y_m) < 40) {
    const pts = rc.stop.columns.map((q) => ({ x: colOf(q.az), yr: rowOfA(q.real_el), yp: rowOfA(q.pred_el) })).filter((q) => q.x > -4 && q.x < CW + 4 && q.yr > 0 && q.yr < CH).sort((a1, b1) => a1.x - b1.x);
    ctx.strokeStyle = "rgba(76,201,216,.35)"; ctx.lineWidth = 1;
    for (const q of pts) { ctx.beginPath(); ctx.moveTo(q.x, q.yr); ctx.lineTo(q.x, q.yp); ctx.stroke(); }
    ctx.fillStyle = "#4cc9d8";
    for (const q of pts) { ctx.beginPath(); ctx.arc(q.x, q.yr, 2.4, 0, 7); ctx.fill(); }
    const t1 = `Blue: skyline traced from a real Curiosity Navcam frame, sol ${rc.stop.sol}.  White: Vantage prediction.  RMSE ${rc.stop.skyline_all.rmse_deg.toFixed(2)}\u00b0`;
    ctx.font = "600 11px Inter, system-ui, sans-serif"; ctx.textAlign = "left";
    const tw1 = ctx.measureText(t1).width + 14;
    ctx.fillStyle = "rgba(8,10,13,.82)"; ctx.fillRect(8, 34, tw1, 20); ctx.fillStyle = "#bfeff5"; ctx.fillText(t1, 15, 48);
  }
  // compass tape
  const g = ctx.createLinearGradient(0, 0, 0, 30); g.addColorStop(0, "rgba(8,10,13,.8)"); g.addColorStop(1, "rgba(8,10,13,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, 30);
  ctx.textAlign = "center"; ctx.font = "600 11px Inter, system-ui, sans-serif"; ctx.lineJoin = "round";
  const names = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  const lbl = (t, x, y, col) => { ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,10,13,.85)"; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y); };
  for (let a = Math.ceil((az - fov / 2) / 5) * 5; a <= az + fov / 2; a += 5) {
    const deg = ((a % 360) + 360) % 360, x = colOf(deg);
    ctx.strokeStyle = "rgba(231,234,239,.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, deg % 15 === 0 ? 8 : 4); ctx.stroke();
    if (deg % 45 === 0) lbl(names[deg], x, 21, "#fff");
    else if (deg % 15 === 0 && fov <= 140) lbl(String(deg), x, 20, "#cfd6e0");
  }
  ctx.strokeStyle = "#4cc9d8"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(CW / 2, 0); ctx.lineTo(CW / 2 - 4, 7); ctx.lineTo(CW / 2 + 4, 7); ctx.closePath(); ctx.fillStyle = "#4cc9d8"; ctx.fill();
  // targets: labels are pushed up when they would overlap the previous one
  ctx.font = "11px Inter, system-ui, sans-serif";
  const items = [];
  for (const t of targets()) {
    const v = cur.vis[t.id]; if (!v) continue;
    const x = colOf(v.bearing); if (x < 0 || x > CW) continue;
    const baseA = Math.atan2(S.T.heightAt(t.x, t.y) - (S.T.heightAt(cur.x, cur.y) + +$("eyeH").value), v.dist) * 180 / Math.PI;
    const topA = baseA + (Math.atan2(t.h, v.dist) * 180 / Math.PI);
    items.push({ t, v, x, y: rowOfA(topA), label: `${t.short || t.name} ${v.dist.toFixed(0)} m` });
  }
  items.sort((a1, b1) => a1.x - b1.x);
  const placed = [];
  for (const it of items) {
    const col = it.v.visible ? "#5fd39a" : "#ef5b5b";
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(it.x, it.y - 3); ctx.lineTo(it.x - 4, it.y - 10); ctx.lineTo(it.x + 4, it.y - 10); ctx.closePath(); ctx.fill();
    const tw = ctx.measureText(it.label).width + 10, lx = Math.max(tw / 2 + 2, Math.min(CW - tw / 2 - 2, it.x));
    let ty = Math.max(44, it.y - 14);
    for (let guard = 0; guard < 8; guard++) { const hit = placed.find((q) => Math.abs(q.lx - lx) < (q.tw + tw) / 2 + 2 && Math.abs(q.ty - ty) < 17); if (!hit) break; ty = hit.ty - 17; if (ty < 44) ty = Math.max(it.y + 18, hit.ty + 17); }
    placed.push({ lx, tw, ty });
    ctx.fillStyle = "rgba(8,10,13,.8)"; ctx.fillRect(lx - tw / 2, ty - 11, tw, 15);
    ctx.fillStyle = col; ctx.fillText(it.label, lx, ty);
  }
  const bar = `az ${az.toFixed(0)}\u00b0   fov ${fov}\u00b0   sun ${sun.elevDeg.toFixed(1)}\u00b0   eye ${$("eyeH").value} m`;
  ctx.fillStyle = "rgba(8,10,13,.75)"; ctx.fillRect(0, CH - 18, CW, 18);
  ctx.textAlign = "left"; ctx.fillStyle = "#c3cad4"; ctx.fillText(bar, 8, CH - 5);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (c.id === "pano") $("panoTag").textContent = S.T.meta.synthetic ? "SYNTHETIC" : "predicted, unvalidated";
  if (c.id === "pano") $("panoNote").textContent = "Terrain only: no rocks below DEM cell size, no atmosphere, no color. White line is the predicted skyline. Green markers are in line of sight, red are hidden (HAB habitat, ROV rover, S summits).";
}

// ---------- flags ----------
function flags() {
  const ul = $("flags"); ul.innerHTML = "";
  let worst = 0, why = null;
  const add = (cls, text, ev) => { const lv = cls === "bad" ? 2 : cls === "warn" ? 1 : 0; if (lv > worst) { worst = lv; why = text; } const li = document.createElement("li"); li.className = cls; li.innerHTML = `<div>${text}<span class="ev">${ev}</span></div>`; ul.appendChild(li); };
  const cur = currentSample();
  if (!cur) { add("", "Draw a route to get flags.", "n/a"); return; }
  const sun = sunNow(), thr = +$("thrSun").value;
  if (sun.elevDeg < 0) add("bad", "Sun is below the horizon at this time.", "geometry");
  else if (sun.elevDeg < thr) add("warn", `Low sun (${sun.elevDeg.toFixed(1)} deg, below ${thr} deg): slopes and shadows are easy to misjudge.`, "lunar-derived threshold, assumption");
  const tau = +$("tau").value;
  if (tau >= 1.5) {
    const tr = sunTransmission(tau, sun.elevDeg), vr = visualRangeM(tau);
    const far = targets().filter((t) => cur.vis[t.id]?.visible === true && cur.vis[t.id].dist > vr * 0.25);
    if (tr < 0.1 && sun.elevDeg > 0) add("warn", `Dust (tau ${tau.toFixed(1)}): only ${(tr * 100).toFixed(1)}% of direct sunlight gets through, so no sharp shadows and no sun compass. Navigate by landmarks${far.length ? ", but " + far.map((t) => t.short || t.name).join(", ") + " may be too faint to recognize" : ""}.`, "Beer-Lambert, assumed 11 km dust scale height");
    else add("warn", `Dust (tau ${tau.toFixed(1)}): direct sunlight ${(tr * 100).toFixed(0)}%, estimated visual range ${(vr / 1000).toFixed(1)} km.`, "Beer-Lambert, assumed 11 km dust scale height");
  }
  const h = hiddenGroundAhead(S.T, cur.x, cur.y, cur.heading, +$("eyeH").value, 25, 60, 0.3);
  if (h.hiddenFraction > 0.25) add("warn", `A 0.3 m hazard would be hidden on ${(h.hiddenFraction * 100).toFixed(0)}% of the ground within 25 m ahead, first at ${h.firstHiddenDist} m.`, "geometry, Apollo 16 pattern, assumed hazard height");
  const sl = S.T.slopeDeg(cur.x, cur.y, SLOPE_BASELINE_M);
  if (sl > 20) add("bad", `Local slope ${sl.toFixed(0)} deg exceeds the 20 deg Artemis planning limit.`, "planning figure for the Moon");
  else if (sl > 15) add("warn", `Local slope ${sl.toFixed(0)} deg.`, "planning figure for the Moon");
  const anyVis = targets().some((t) => cur.vis[t.id].visible === true);
  if (targets().length && !anyVis) add("bad", "Nothing you could navigate by is in view from here.", "geometry over DEM");
  if (cur.partner && cur.partner.visible === false) add("bad", "Partner is out of line of sight.", "geometry, assumed partner gap");
  const sh = inTerrainShadow(S.T, cur.x, cur.y, sun.azDeg, sun.elevDeg);
  if (sh === true && sun.elevDeg > 0) add("warn", "This spot is in terrain shadow from the Sun: low contrast, colder, easy to misjudge ground.", "geometry over DEM, no atmosphere scattering");
  if (S.habitat && cur.vis.hab && !isNaN(cur.s)) {
    const f = visibilityFraction(S.T, cur.x, cur.y, +$("eyeH").value, S.habitat.x, S.habitat.y, +$("habH").value, +$("posErr").value);
    if (f !== null && f > 0 && f < 1) add("warn", `Habitat visibility here depends on position: ${(f * 100).toFixed(0)}% of points within ${$("posErr").value} m see it.`, "position-error sensitivity, assumed error");
  }
  const wb = S.cum && S.cum.length ? S.cum[S.rows.indexOf(cur)] : null;
  const sb = startBack(cur), lim = +$("shelterMin").value;
  const ret = sb ? sb.ret : wb;
  if ($("sepAlert").checked && ret !== null && ret !== undefined && isFinite(ret)) {
    const alt = wb !== null && wb !== undefined && sb ? ` Retracing the drawn route would take ${wb.toFixed(0)} min.` : "";
    if (ret > lim) add("bad", `SEP alert: the fastest way home takes ${ret.toFixed(0)} min, over the ${lim} min shelter limit.${alt}`, "assumed pace and limit, not a radiation model");
    else add("warn", `SEP alert: the fastest way home takes ${ret.toFixed(0)} min of the ${lim} min limit.${alt}`, "assumed pace and limit");
  }
  if (sb && sb.limiting.k !== "shelter limit") {
    const m = sb.limiting.min;
    if (m < 0) add("bad", `No margin: ${sb.limiting.k} runs out before you can get home. Start back now.`, "assumed EVA length, reserve, light cutoff 5 deg");
    else if (m < 30) add("warn", `Start back within ${m.toFixed(0)} min (limited by ${sb.limiting.k}).`, "assumed EVA length, reserve, light cutoff 5 deg");
  }
  if (S.radio && S.rows.indexOf(cur) >= 0 && !S.radio.ok[S.rows.indexOf(cur)]) add("", `No radio line of sight to the habitat here (terrain). Longest outage on this route: ${S.radio.worst.len.toFixed(0)} m${S.radio.gapMin ? ", about " + S.radio.gapMin.toFixed(0) + " min of walking" : ""}.`, "geometry only, not a link budget");
  for (const r of S.runs) add("warn", `Blind stretch ${r.from.toFixed(0)} to ${r.to.toFixed(0)} m (${r.length.toFixed(0)} m).`, "geometry over DEM");
  if (!ul.children.length) add("ok", "No flags at this position and time.", "unvalidated");
  verdict(worst, why, cur);
}

// Rerun the geometric checks at 8 points around the walker at the assumed position error.
function pointHold(x, y) {
  const T = S.T;
  if (T.slopeDeg(x, y, SLOPE_BASELINE_M) > 20) return true;
  const tg = targets(), eye = +$("eyeH").value;
  return tg.length > 0 && !tg.some((t) => lineOfSight(T, x, y, eye, t.x, t.y, t.h, { step: 2 }).visible === true);
}
// Rerun the location-dependent HOLD checks (slope over 20 deg, nothing in view) at 8 points at the assumed position error.
function confidence(cur) {
  const el = $("vConf"); if (!cur) { el.textContent = ""; el.className = "vconf"; return; }
  const r = +$("posErr").value || 5, here = pointHold(cur.x, cur.y);
  let diff = 0;
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (pointHold(cur.x + r * Math.cos(a), cur.y + r * Math.sin(a)) !== here) diff++; }
  if (!diff) { el.textContent = `Robust within ${r} m`; el.className = "vconf robust"; el.title = `The slope and line-of-sight checks give the same answer at 8 points ${r} m around you (assumed position error).`; }
  else { el.textContent = here ? `${diff}/8 nearby points clear` : `${diff}/8 nearby points HOLD`; el.className = "vconf fragile"; el.title = `Within ${r} m (assumed position error), ${diff} of 8 nearby points ${here ? "pass" : "fail"} the slope or line-of-sight check. Treat this spot with care.`; }
}
function verdict(worst, why, cur) {
  confidence(cur);
  const v = $("verdict"), lvl = ["ok", "warn", "bad"][worst];
  v.dataset.level = lvl;
  $("vLabel").textContent = ["NOMINAL", "CAUTION", "HOLD"][worst];
  $("vReason").textContent = worst ? why : "Home or a landmark is in view, slope and sun are within the assumed limits.";
  if (!cur) { $("vStats").innerHTML = ""; return; }
  const wb = S.cum && S.cum.length ? S.cum[S.rows.indexOf(cur)] : null;
  const sun = sunNow();
  const hab = S.habitat ? Math.hypot(cur.x - S.habitat.x, cur.y - S.habitat.y) : null;
  const st = (l, v2) => `<div>${l}<b>${v2}</b></div>`;
  const sb = startBack(cur);
  $("vStats").innerHTML = st("Home, fastest", sb ? sb.ret.toFixed(0) + " min" : "--") + st("Retrace route", wb === null || wb === undefined ? "--" : wb.toFixed(0) + " min") + st("To habitat", hab === null ? "--" : hab.toFixed(0) + " m") + st("Sun", sun.elevDeg.toFixed(0) + "\u00b0");
}

// ---------- cuff card ----------
function cuff() {
  const b = $("cuffBody"), cur = currentSample();
  if (!cur) { b.textContent = "Draw a route (at least 2 points)."; return; }
  const ahead = S.rows.filter((r) => r.s >= cur.s && r.s <= cur.s + 120);
  const maxSl = Math.max(...ahead.map((r) => S.T.slopeDeg(r.x, r.y, SLOPE_BASELINE_M)).filter(isFinite), 0);
  const nextBlind = S.runs.find((r) => r.to >= cur.s);
  const hab = S.habitat ? Math.hypot(cur.x - S.habitat.x, cur.y - S.habitat.y) : null;
  const sun = sunNow(), thr = +$("thrSun").value, sb = startBack(cur);
  const kpi = (cls, l, v, u, s) => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}<small> ${u}</small></div><div class="s">${s || ""}</div></div>`;
  b.innerHTML =
    kpi("", "Heading", cur.heading.toFixed(0), "\u00b0", "travel direction") +
    (hab !== null ? kpi(cur.vis.hab.visible ? "ok" : "bad", "Habitat", hab.toFixed(0), "m", cur.vis.hab.visible ? "in view" : "hidden") : kpi("", "Habitat", "--", "", "not placed")) +
    kpi(maxSl > 20 ? "bad" : maxSl > 15 ? "warn" : "", "Max slope", maxSl.toFixed(0), "\u00b0", "next 120 m") +
    (nextBlind ? kpi("warn", "Blind stretch", Math.max(0, nextBlind.from - cur.s).toFixed(0), "m ahead", nextBlind.length.toFixed(0) + " m long") : kpi("ok", "Blind stretch", "none", "", "next 120 m")) +
    kpi(sun.elevDeg < thr ? "warn" : "", "Sun elevation", sun.elevDeg.toFixed(0), "\u00b0", sun.elevDeg < thr ? "low sun" : "ok") +
    (sb ? kpi($("sepAlert").checked && sb.ret > +$("shelterMin").value ? "bad" : "", "Home, fastest", sb.ret.toFixed(0), "min", "retrace route " + (S.cum && S.cum.length ? S.cum[S.rows.indexOf(cur)].toFixed(0) : "--") + " min") : kpi("", "Home, fastest", "--", "", "place a habitat")) +
    (sb ? kpi(sb.limiting.min < 0 ? "bad" : sb.limiting.min < 30 ? "warn" : "ok", "Start back within", Math.max(0, sb.limiting.min).toFixed(0), "min", "limited by " + sb.limiting.k) : kpi("", "Start back within", "--", "", "place a habitat")) +
    (S.radio ? kpi(S.radio.worst.len > 0 ? "warn" : "ok", "Longest radio gap", S.radio.worst.len.toFixed(0), "m", (S.radio.gapMin ? S.radio.gapMin.toFixed(0) + " min walking" : "none") + (S.relay?.picks?.length ? ", relay R1 closes " + Math.round((S.relay.picks[0].coveredFrac - S.relay.before) * 100) + "%" : "")) : kpi("", "Longest radio gap", "--", "", "place a habitat")) +
    kpi(S.T.slopeDeg(cur.x, cur.y, SLOPE_BASELINE_M) > 20 ? "bad" : "", "Slope here", (S.T.slopeDeg(cur.x, cur.y, SLOPE_BASELINE_M) || 0).toFixed(0), "\u00b0", "5 m baseline") +
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
  $("btnLocate").onclick = locateFromHere;
  $("btnClear").onclick = () => { S.route = []; S.landmarks = []; S.habitat = null; S.rover = null; S.view = null; setupMap(); recompute(); };
  $("btnPlan").onclick = () => {
    if (S.route.length < 2) return;
    const st = S.route[0], gl = S.route[S.route.length - 1];
    const r = planRoute(S.T, st, gl, { slopeLimit: +$("slopeLim").value, eyeH: +$("eyeH").value, habitat: S.habitat, habH: +$("habH").value, visWeight: +$("visW").value });
    if (!r) { $("planCard").classList.remove("hidden"); $("planBody").textContent = "No route found under the slope limit."; $("btnUsePlan").classList.add("hidden"); return; }
    S.planned = r.points;
    const stat = (pts) => {
      const rows = routeVisibility(S.T, sampleRoute(pts, 10), targets(), { eyeH: +$("eyeH").value, partnerGap: +$("partnerGap").value });
      const hid = S.habitat ? rows.filter((q) => q.vis.hab.visible === false).length / rows.length : 0;
      const ms = Math.max(...rows.map((q) => S.T.slopeDeg(q.x, q.y, SLOPE_BASELINE_M)).filter(isFinite), 0);
      return { len: rows.length ? rows[rows.length - 1].s : 0, min: walkMinutes(S.T, rows), hid, ms };
    };
    const d = stat(S.route), p = stat(S.planned);
    const row = (l, x, y) => `<tr><td>${l}</td><td>${x}</td><td>${y}</td></tr>`;
    $("planBody").innerHTML = `<table class="cmp"><tr><td></td><td><b>Drawn</b></td><td><b>Planned</b></td></tr>` +
      row("Length m", d.len.toFixed(0), p.len.toFixed(0)) + row("Walk min", d.min.toFixed(0), p.min.toFixed(0)) +
      row("Max slope", d.ms.toFixed(0) + "\u00b0", p.ms.toFixed(0) + "\u00b0") +
      (S.habitat ? row("Habitat hidden", (d.hid * 100).toFixed(0) + "%", (p.hid * 100).toFixed(0) + "%") : "") + `</table><div class="cuffnote">Planner: Dijkstra on a 5 m grid (coarser for long routes), walking-time cost, slope cells over the limit blocked. Same assumed pace model.</div>`;
    $("planCard").classList.remove("hidden"); $("btnUsePlan").classList.remove("hidden");
    drawMap();
  };
  $("btnUsePlan").onclick = () => { if (S.planned) { S.route = S.planned; S.planned = null; $("planCard").classList.add("hidden"); recompute(); } };
  $("btnZoom").onclick = () => { S.fit = !S.fit; fitView(); setupMap(); syncZoomLabel(); recompute(); };
  $("btnAuto").onclick = () => { S.landmarks = suggestLandmarks(S.T, S.route).map((c, i) => ({ x: c.x, y: c.y, name: "Summit " + (i + 1) })); recompute(); };
  $("btnTraverse").onclick = () => {
    const w = S.traverse.waypoints.filter((q) => q.inside);
    S.route = w.map((q) => ({ x: q.x_m, y: q.y_m }));
    if (w.length) { S.habitat = { x: w[0].x_m, y: w[0].y_m }; }
    fitView(); setupMap(); recompute();
  };
  for (const id of ["pos", "ltst", "tau", "ls", "lookMode", "lookAz", "fov"]) $(id).addEventListener("input", () => { if (id === "ltst" || id === "ls") drawHillshade(); recompute(); });
  for (const id of ["eyeH", "partnerGap", "landH", "habH", "thrSun", "blindMin", "showView", "showSlope", "showReach", "showRadio", "evaMin", "reserveMin", "relayH", "sepAlert", "shelterMin", "posErr"]) $(id).addEventListener("input", recompute);
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
    timer = setInterval(() => { let v = +$("pos").value + 3; if (v > 1000) v = 0; $("pos").value = v; refresh(); scheduleViewshed(); }, 260);
  };
  window.addEventListener("resize", () => { setupMap(); refresh(); });
  syncZoomLabel();
}
function syncZoomLabel() { $("zoomLbl").textContent = S.fit ? "Full" : "Zoom"; }
function defaultScene() {
  const T = S.T, W = T.extentX, H = T.extentY;
  const wp = (S.traverse?.waypoints || []).filter((q) => q.inside);
  const boxwork = wp.filter((q) => q.sol >= 4605 && q.sol <= 4860);
  const seg = boxwork.length >= 10 ? boxwork : wp;
  if (!T.meta.synthetic && seg.length >= 10) {
    S.route = seg.map((q) => ({ x: q.x_m, y: q.y_m }));
    S.habitat = { x: seg[0].x_m, y: seg[0].y_m };
    S.rover = { x: seg[Math.min(2, seg.length - 1)].x_m, y: seg[Math.min(2, seg.length - 1)].y_m };
  } else {
    S.habitat = { x: W * 0.15, y: H * 0.5 };
    S.rover = { x: W * 0.2, y: H * 0.52 };
    S.route = [{ x: W * 0.2, y: H * 0.5 }, { x: W * 0.4, y: H * 0.42 }, { x: W * 0.6, y: H * 0.55 }, { x: W * 0.8, y: H * 0.45 }];
  }
  S.landmarks = suggestLandmarks(T, S.route).map((c, i) => ({ x: c.x, y: c.y, name: "Summit " + (i + 1) }));
}

// ---------- walker view (full screen) ----------
function walkerHud() {
  const v = $("verdict");
  const h = $("wHud");
  h.dataset.level = v.dataset.level;
  h.innerHTML = `<div class="wv">${$("vLabel").textContent}</div><div class="wr">${$("vReason").textContent}</div><div class="ws">${$("vStats").innerHTML}</div>`;
}
function walkerOpen() { $("walker").classList.remove("hidden"); drawPano(); walkerHud(); }
function walkerClose() { $("walker").classList.add("hidden"); }
$("btnWalker").onclick = walkerOpen;
$("btnExpand").onclick = walkerOpen;
$("wClose").onclick = walkerClose;
window.addEventListener("keydown", (e) => {
  if ($("walker").classList.contains("hidden")) return;
  const pos = $("pos");
  if (e.key === "Escape") walkerClose();
  else if (e.key === "ArrowRight" && !e.shiftKey) { pos.value = Math.min(1000, +pos.value + 8); recompute(); }
  else if (e.key === "ArrowLeft" && !e.shiftKey) { pos.value = Math.max(0, +pos.value - 8); recompute(); }
  else if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    $("lookMode").value = "manual"; const a = ((+$("lookAz").value + (e.key === "ArrowRight" ? 10 : -10)) % 360 + 360) % 360; $("lookAz").value = a; recompute();
  } else if (e.key === "t" || e.key === "T") { $("lookMode").value = "travel"; recompute(); }
});
window.addEventListener("resize", () => { if (!$("walker").classList.contains("hidden")) drawPano(); });



function showRealCamera(i) {
  if (i < 0 || !S.valid || !S.rows.length) { S.real = null; recompute(); return; }
  const stop = S.valid.stops[i];
  let best = 0, bd = Infinity;
  S.rows.forEach((r, k) => { const d = Math.hypot(r.x - stop.rover_position.x_m, r.y - stop.rover_position.y_m); if (d < bd) { bd = d; best = k; } });
  if (bd > 40) return;
  let bc = 0, bn = -1;
  for (let c = 0; c < 360; c += 5) { const n = stop.columns.filter((q) => Math.abs(((q.az - c + 540) % 360) - 180) <= 55).length; if (n > bn) { bn = n; bc = c; } }
  { const inw = stop.columns.filter((q) => Math.abs(((q.az - bc + 540) % 360) - 180) <= 55); if (inw.length) bc = Math.round((bc + inw.reduce((t, q) => t + (((q.az - bc + 540) % 360) - 180), 0) / inw.length + 360) % 360); }
  S.real = { stop };
  $("lookMode").value = "manual"; $("lookAz").value = bc; $("pos").value = Math.round((best / (S.rows.length - 1)) * 1000);
  recompute();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- welcome hero: a live view and three numbers computed from the loaded route ----------
let heroTimer = null, heroPos0 = 0;
function heroStats() {
  const box = $("heroStats"); if (!box || !S.rows.length) return;
  const noHab = S.habitat ? S.rows.filter((r) => r.vis.hab && r.vis.hab.visible === false).length / S.rows.length : null;
  const rets = S.reach ? S.rows.map((r) => S.reach.at(r.x, r.y)).filter(isFinite) : [];
  const retHi = rets.length ? Math.round(Math.max(...rets)) : null;
  const retrace = S.cum.length ? Math.round(S.cum[S.cum.length - 1]) : null;
  const st = (b, t) => `<div class="hstat"><b>${b}</b>${t}</div>`;
  box.innerHTML = st(noHab !== null ? Math.round(noHab * 100) + "%" : "--", "of this route is out of sight of the habitat") +
    st(S.radio ? Math.round((1 - S.radio.coveredFrac) * 100) + "%" : "--", "has no radio line of sight to the habitat (geometry only)") +
    st(retHi !== null ? "up to " + retHi + " min" : "--", "fastest way home along the route" + (retrace ? ", against " + retrace + " min retracing it" : ""));
}
function heroStart() {
  if (!S.rows.length || !$("heroPano")) return;
  heroPos0 = +$("pos").value; heroStats();
  const first = S.runs[0]; const tot = S.rows[S.rows.length - 1].s;
  let p = first ? Math.max(0, ((first.from - 40) / tot) * 1000) : 350;
  clearInterval(heroTimer);
  const frame = () => { $("pos").value = Math.round(p); drawPanoOn($("heroPano"), 2.8); p += 2.5; if (p > 960) p = 20; };
  frame(); heroTimer = setInterval(frame, 140);
}
function heroStop() { clearInterval(heroTimer); heroTimer = null; $("pos").value = heroPos0; recompute(); }

// ---------- guided tour ----------
const TOUR = [
  { t: "Real Curiosity boxwork route on 1 m NASA terrain. The verdict, predicted view and timeline update at every step.", go: () => setPos(0) },
  { t: () => { const c = currentSample(); if (!c) return ""; const vis = targets().filter((t) => c.vis[t.id]?.visible === true).map((t) => t.name); const hid = targets().filter((t) => c.vis[t.id]?.visible === false).map((t) => t.name); return S.runs.length || !vis.length ? "Nothing to navigate by here: habitat, rover, partner and every landmark are out of sight. The badge on the verdict shows that a 5 m position error decides it, which is the point: in terrain like this you cannot count on the view." : `Out of sight of home: ${hid.join(", ")} ${hid.length > 1 ? "are" : "is"} hidden here. Only ${vis.join(" and ") || "nothing"} keeps the walker oriented. The strip below shows how often this happens along the route.`; }, go: () => { const tot = S.rows.length ? S.rows[S.rows.length - 1].s : 1; const r = S.runs[0]; if (r) { setPos(((r.from + r.length / 2) / tot) * 1000); return; } let bi = 0, bn = 99; S.rows.forEach((row, i) => { if (row.vis.hab?.visible !== false) return; const n = targets().filter((t) => row.vis[t.id]?.visible === true).length; if (n < bn) { bn = n; bi = i; } }); setPos((bi / Math.max(1, S.rows.length - 1)) * 1000); } },
  { t: () => S.loc && S.loc.done ? `Lost, with no GPS and no magnetic compass on Mars. The walker turns once on the spot, and Vantage matches that horizon against 3,600 places: the fix lands ${Math.hypot(S.loc.best.x - S.loc.truth.x, S.loc.best.y - S.loc.truth.y).toFixed(0)} m from the true position. Deep in a hollow the fix gets ambiguous, and the app says so. Next: the same search on a real Curiosity photo.` : "Lost, with no GPS and no magnetic compass on Mars. The walker turns once on the spot, and Vantage matches that horizon against 3,600 places...", go: () => { setPos(150); locateFromHere(); const iv = setInterval(() => { if (S.loc?.done) { clearInterval(iv); const tt = TOUR[tourI].t; $("tText").textContent = typeof tt === "function" ? tt() : tt; } }, 300); } },
  { t: () => S.loc && S.loc.done ? `Real photo: from the skyline in Curiosity\u2019s Navcam frame at sol 4748, Vantage puts the rover ${Math.hypot(S.loc.best.x - S.loc.truth.x, S.loc.best.y - S.loc.truth.y).toFixed(0)} m from where it actually stood. It fails at the other two stops, for reasons shown in the validation panel.` : "Real photo: matching the skyline from Curiosity\u2019s Navcam frame at sol 4748 against the terrain...", go: () => { locateFromPhoto(1); const iv = setInterval(() => { if (S.loc?.done) { clearInterval(iv); const tt = TOUR[tourI].t; $("tText").textContent = typeof tt === "function" ? tt() : tt; } }, 300); } },
  { t: "Walker view: the full-screen predicted view from the walker's eye height, with the verdict underneath. Arrow keys walk the route.", go: () => { walkerOpen(); } },
  { t: "Same spot, low sun (about 06:30 local time). Slopes and shadows flatten out and the flags warn about it.", go: () => { $("ltst").value = 6.5; drawHillshade(); recompute(); } },
  { t: () => `Solar particle event alert with a 20 minute shelter limit. The contours show the fastest way home, bending around steep ground. From here it takes ${(returnMin(currentSample()) || 0).toFixed(0)} min, over the limit, so the verdict is HOLD. Retracing the drawn route would take ${(S.cum[S.rows.indexOf(currentSample())] || 0).toFixed(0)} min.`, go: () => { $("sepAlert").checked = true; $("shelterMin").value = 20; setPos(950); } },
  { t: () => S.radio && S.relay?.picks?.length ? `Radio shadow: terrain blocks line of sight to the habitat on ${Math.round((1 - S.radio.coveredFrac) * 100)}% of the route, up to ${S.radio.worst.len.toFixed(0)} m in a row. One relay at R1 (${S.relay.picks[0].dHab.toFixed(0)} m from the habitat) would cover ${Math.round(S.relay.picks[0].coveredFrac * 100)}%. Geometry only, not a link budget.` : "Radio shadow: where terrain blocks line of sight to the habitat.", go: () => { $("showRadio").checked = true; setPos(800); } },
  { t: () => `Dust storm, optical depth 4. Direct sunlight drops to ${(sunTransmission(4, sunNow().elevDeg) * 100).toFixed(1)}%, so shadows and the sun compass are gone and the view hazes out. The badge on the verdict says whether it holds within the assumed position error.`, go: () => { $("tau").value = 4; setPos(400); } },
  { t: "The planner finds a slope-limited route that keeps the habitat in view and compares it with the drawn one.", go: () => { $("sepAlert").checked = false; $("shelterMin").value = 60; setPos(300); $("btnPlan").click(); } },
  { t: () => "Real camera check. Blue dots are the skyline traced from a real Curiosity Navcam frame at sol 4748, white is the Vantage prediction: 0.43 degrees of error. Toward the far crater rim at sol 4634 the prediction is about 5 degrees low, and the validation panel shows that too.", go: () => { showRealCamera(1); } },
];
const TOURSTATE = { ltst: 12 };
let tourI = -1;
function setPos(v) { $("pos").value = Math.round(v); recompute(); }
function tourShow(i) {
  tourI = Math.max(0, Math.min(TOUR.length - 1, i));
  $("tourbar").classList.remove("hidden");
  $("tStep").textContent = `${tourI + 1} / ${TOUR.length}`;
  $("tNext").textContent = tourI === TOUR.length - 1 ? "Finish" : "Next";
  walkerClose();
  $("ltst").value = TOURSTATE.ltst; $("sepAlert").checked = false; $("shelterMin").value = 60; $("showRadio").checked = false; $("lookMode").value = "travel"; S.real = null; $("tau").value = 0.6; if (S.loc) closeLocate();
  drawHillshade();
  TOUR[tourI].go();
  const tt = TOUR[tourI].t; $("tText").textContent = typeof tt === "function" ? tt() : tt;
}
function tourStart() {
  TOURSTATE.ltst = +$("ltst").value;
  S.planned = null; $("planCard").classList.add("hidden");
  $("welcome").classList.add("hidden");
  tourShow(0);
}
function tourEnd() {
  walkerClose();
  $("tourbar").classList.add("hidden"); tourI = -1;
  $("ltst").value = TOURSTATE.ltst; drawHillshade(); $("sepAlert").checked = false; $("shelterMin").value = 60; $("showRadio").checked = false; $("lookMode").value = "travel"; S.real = null; $("tau").value = 0.6; recompute();
}
$("wTour").onclick = () => { heroStop(); tourStart(); };
$("wExplore").onclick = () => { heroStop(); $("welcome").classList.add("hidden"); };
$("btnTour").onclick = tourStart;
$("tPrev").onclick = () => tourShow(tourI - 1);
$("tNext").onclick = () => (tourI >= TOUR.length - 1 ? tourEnd() : tourShow(tourI + 1));
$("tEnd").onclick = tourEnd;
window.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (heroTimer) heroStop(); $("welcome").classList.add("hidden"); if (tourI >= 0) tourEnd(); } });

init();
