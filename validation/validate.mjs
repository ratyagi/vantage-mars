// Skyline validation: Vantage DEM skyline (web/js/visibility.js) vs skylines traced in real Curiosity Navcam images.
// Run from the repo root: node validation/validate.mjs
// Inputs (all in validation/): image_meta.json (camera models + rover attitude from the MSL raw image API),
// image_rows.txt (traced skyline row per sampled image column, -1 = no trace). No model parameter is fitted here.
import fs from "node:fs";
import { Terrain } from "../web/js/terrain.js";
import { skyline, azimuthDeg } from "../web/js/visibility.js";

const RAD = Math.PI / 180;
const EYE_H = 2.0;          // m, camera height used for the prediction (task spec; Navcam is about 1.9 m above the rover frame origin)
const COL0 = 4, COLSTEP = 8; // image_rows.txt samples columns 4, 12, ..., 1020
const NAZ = 3600;            // predicted skyline at 0.1 deg
const EDGE_MARGIN_M = 100;   // horizon point within this distance of the DEM window exit counts as window-limited

const meta = JSON.parse(fs.readFileSync("validation/image_meta.json", "utf8"));
const route = JSON.parse(fs.readFileSync("web/data/route.json", "utf8")).waypoints;
const demMeta = JSON.parse(fs.readFileSync("web/data/dem.json", "utf8"));
const buf = fs.readFileSync("web/data/dem.f32");
const T = new Terrain(demMeta.width, demMeta.height, demMeta.cell_m,
  new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), demMeta);

const rows = {};
for (const line of fs.readFileSync("validation/image_rows.txt", "utf8").trim().split("\n")) {
  const [n, a] = line.split(":"); rows[n] = a.split(",").map(Number);
}

// ---------- vector helpers ----------
const vec = (s) => s.replace(/[()]/g, "").split(",").map(Number);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scl(a, 1 / Math.hypot(...a));

function parseCmod(s) {
  const p = s.split(";").map(vec);
  return { C: p[0], A: p[1], H: p[2], V: p[3], O: p[4], R: p[5] };
}
// CAHVOR pixel (x = sample, y = line) -> unit ray in the camera model frame.
function cahvorRay(m, x, y) {
  let u = norm(cross(sub(m.V, scl(m.A, y)), sub(m.H, scl(m.A, x))));
  if (dot(u, m.A) < 0) u = scl(u, -1);
  const w = scl(u, 1 / dot(u, m.O));          // scale so that w.O = 1
  const lp = sub(w, m.O);                      // distorted perpendicular part
  const k = Math.hypot(...lp);
  if (k < 1e-12) return norm(w);
  const [r0, r1, r2] = m.R;
  let t = k;                                   // solve t (1 + r0 + r1 t^2 + r2 t^4) = k
  for (let i = 0; i < 20; i++) {
    const f = t * (1 + r0 + r1 * t * t + r2 * t ** 4) - k;
    const df = 1 + r0 + 3 * r1 * t * t + 5 * r2 * t ** 4;
    t -= f / df;
  }
  return norm(add(m.O, scl(lp, t / k)));
}
// Forward CAHVOR projection, used only as a self-check of the inverse.
function cahvorProject(m, P) {
  const p = sub(P, m.C), z = dot(p, m.O), lam = sub(p, scl(m.O, z)), tau = dot(lam, lam) / (z * z);
  const mu = m.R[0] + m.R[1] * tau + m.R[2] * tau * tau;
  const q = add(p, scl(lam, mu)), d = dot(q, m.A);
  return [dot(q, m.H) / d, dot(q, m.V) / d];
}
// Quaternion (w,x,y,z), rover navigation frame (x fwd, y right, z down) -> site frame (x north, y east, z down).
function quatMat(s) {
  const [w, x, y, z] = vec(s);
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
          [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
          [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
}
const mul = (M, v) => M.map((r) => dot(r, v));

// ---------- prediction helpers ----------
function exitDist(ox, oy, az) {
  const ux = Math.sin(az * RAD), uy = -Math.cos(az * RAD);
  let d = Infinity;
  if (ux > 1e-9) d = Math.min(d, (T.extentX - ox) / ux); if (ux < -1e-9) d = Math.min(d, -ox / ux);
  if (uy > 1e-9) d = Math.min(d, (T.extentY - oy) / uy); if (uy < -1e-9) d = Math.min(d, -oy / uy);
  return d;
}
function predictAt(sk, az) {
  const f = (((az % 360) + 360) % 360) / 360 * sk.nAz;
  const k0 = Math.floor(f) % sk.nAz, k1 = (k0 + 1) % sk.nAz, t = f - Math.floor(f);
  return { ang: sk.angleDeg[k0] * (1 - t) + sk.angleDeg[k1] * t, dist: t < 0.5 ? sk.dist[k0] : sk.dist[k1] };
}
function stats(err) {
  if (!err.length) return { n: 0 };
  const a = err.map(Math.abs);
  const rmse = Math.sqrt(err.reduce((s, e) => s + e * e, 0) / err.length);
  const r = (v) => Math.round(v * 1000) / 1000;
  return { n: err.length, rmse_deg: r(rmse), bias_deg: r(err.reduce((s, e) => s + e, 0) / err.length),
    median_abs_deg: r([...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]),
    within_1deg: r(a.filter((v) => v < 1).length / a.length), within_2deg: r(a.filter((v) => v < 2).length / a.length) };
}
// Skyline peaks: local max within +-2 deg azimuth that rises >= 0.5 deg above the minimum within +-4 deg.
function peaks(pts) {
  const out = [];
  for (const p of pts) {
    const near = pts.filter((q) => Math.abs(q.az - p.az) <= 2), wide = pts.filter((q) => Math.abs(q.az - p.az) <= 4);
    if (near.length < 3 || wide.length < 5) continue;
    if (p.el < Math.max(...near.map((q) => q.el))) continue;
    if (p.el - Math.min(...wide.map((q) => q.el)) < 0.5) continue;
    if (Math.min(...wide.map((q) => q.az)) > p.az - 3.5 || Math.max(...wide.map((q) => q.az)) < p.az + 3.5) continue; // need both sides
    out.push(p);
  }
  return out;
}

// ---------- 1. extract real skyline directions ----------
// Manual exclusions found on review of the trace overlays (image evidence only, listed here so they can be audited).
const EXCLUDE = [
  { imageid: "NLB_808884389EDR_F1181608NCAM00252M_", colMin: 340, colMax: 490,
    reason: "trace scattered over faint distant hills; not consistently on the sky boundary" },
  { imageid: "NLB_818994980EDR_F1200346NCAM00271M_", colMin: 0, colMax: 295,
    reason: "trace on a lower ridge with terrain visible above it" },
  { imageid: "NLB_818994980EDR_F1200346NCAM00271M_", colMin: 885, colMax: 1023,
    reason: "trace drops below the skyline at the right edge" },
  { imageid: "NLB_818995760EDR_F1200346NCAM00272M_", colMin: 0, colMax: 255,
    reason: "trace on a lower ridge with terrain visible above it; the true sky boundary starts near column 256" },
  { imageid: "NLB_827077719EDR_F1210396NCAM00268M_", colMin: 260, colMax: 660,
    reason: "dust haze: the far skyline is not distinguishable, the trace marks the farthest visible terrain edge" },
];
const cleanLog = [];
const samples = []; // {stop, imageid, col, row, az, el}
for (const m of meta) {
  const cm = parseCmod(m.cmod), M = quatMat(m.attitude);
  const r = rows[String(m.n)];
  // self-check: inverse then forward projection returns the pixel
  const ray = cahvorRay(cm, 512, 300), back = cahvorProject(cm, add(cm.C, scl(ray, 100)));
  if (Math.hypot(back[0] - 512, back[1] - 300) > 0.01) throw new Error("CAHVOR inverse check failed " + m.imageid);
  let dropTop = 0, dropOut = 0, dropRamp = 0, dropManual = 0;
  for (let i = 0; i < r.length; i++) {
    const y = r[i];
    if (y < 0) continue;
    if (y <= 5) { dropTop++; continue; }                       // trace touching the frame top: not a skyline
    const nb = [];
    for (let j = i - 2; j <= i + 2; j++) if (j !== i && j >= 0 && j < r.length && r[j] > 5) nb.push(r[j]);
    if (nb.length < 2) { dropOut++; continue; }
    nb.sort((a, b) => a - b);
    const med = nb.length % 2 ? nb[(nb.length - 1) / 2] : (nb[nb.length / 2 - 1] + nb[nb.length / 2]) / 2;
    if (Math.abs(y - med) > 8) { dropOut++; continue; }          // isolated jump = tracer artifact
    const pv = i > 0 ? r[i - 1] : -1, nx = i < r.length - 1 ? r[i + 1] : -1;
    if ((pv > 5 && Math.abs(y - pv) >= 36) || (nx > 5 && Math.abs(y - nx) >= 36)) { dropRamp++; continue; } // path-tracer step limit (5 px/col): jump between edges, not a skyline
    const x = COL0 + i * COLSTEP;
    if (EXCLUDE.some((e) => e.imageid === m.imageid && x >= e.colMin && x <= e.colMax)) { dropManual++; continue; }
    const d = mul(M, cahvorRay(cm, x, y));                         // site frame N,E,D
    const az = ((Math.atan2(d[1], d[0]) / RAD) + 360) % 360, el = Math.asin(-d[2]) / RAD;
    samples.push({ sol: m.sol, rmc: m.rmc, imageid: m.imageid, col: x, row: y, az, el });
  }
  cleanLog.push({ imageid: m.imageid, traced: r.filter((v) => v >= 0).length, dropped_frame_top: dropTop, dropped_isolated: dropOut, dropped_tracer_ramp: dropRamp, dropped_manual: dropManual });
}

// attitude check: rover heading from the quaternion vs route.json yaw
const attitudeCheck = [];
for (const rmc of [...new Set(meta.map((m) => m.rmc))]) {
  const m = meta.find((q) => q.rmc === rmc), w = route.find((q) => q.rmc === rmc);
  const f = mul(quatMat(m.attitude), [1, 0, 0]);
  const hdg = Math.atan2(f[1], f[0]) / RAD;
  attitudeCheck.push({ rmc, quaternion_heading_deg: +hdg.toFixed(2), route_yaw_deg: w.yaw, camera_C_above_rover_origin_m: +(-parseCmod(m.cmod).C[2]).toFixed(3) });
}

// ---------- 2. compare at each stop ----------
const stops = [];
const SHIFTS = [0, 5, 10, 25], DIRS = [0, 45, 90, 135, 180, 225, 270, 315];
for (const rmc of [...new Set(samples.map((s) => s.rmc))]) {
  const w = route.find((q) => q.rmc === rmc);
  const S = samples.filter((s) => s.rmc === rmc).sort((a, b) => a.az - b.az);
  const evalAt = (ox, oy, eyeH = EYE_H) => {
    const sk = skyline(T, ox, oy, eyeH, NAZ, 2500);
    return S.map((s) => {
      const p = predictAt(sk, s.az), ed = exitDist(ox, oy, s.az);
      return { ...s, pred: p.ang, predDist: p.dist, exitDist: ed, windowLimited: p.dist > ed - EDGE_MARGIN_M, err: p.ang - s.el };
    });
  };
  const base = evalAt(w.x_m, w.y_m);
  const all = stats(base.map((c) => c.err));
  const inWin = stats(base.filter((c) => !c.windowLimited).map((c) => c.err));
  const winLim = stats(base.filter((c) => c.windowLimited).map((c) => c.err));

  // skyline peaks (landmark proxy)
  const predPts = base.map((c) => ({ az: c.az, el: c.pred })), realPts = base.map((c) => ({ az: c.az, el: c.el }));
  const pp = peaks(predPts), rp = peaks(realPts);
  const match = (a, b) => a.filter((p) => b.some((q) => Math.abs(q.az - p.az) <= 1.5));
  const peakRes = {
    predicted_peaks: pp.map((p) => ({ az: +p.az.toFixed(2), el: +p.el.toFixed(2), matched: match([p], rp).length > 0 })),
    image_peaks: rp.map((p) => ({ az: +p.az.toFixed(2), el: +p.el.toFixed(2), matched: match([p], pp).length > 0 })),
    precision: pp.length ? +(match(pp, rp).length / pp.length).toFixed(3) : null,
    recall: rp.length ? +(match(rp, pp).length / rp.length).toFixed(3) : null,
  };

  // sensitivity to horizontal position
  const sens = SHIFTS.map((d) => {
    const vals = (d === 0 ? [0] : DIRS).map((b) => {
      const ox = w.x_m + d * Math.sin(b * RAD), oy = w.y_m - d * Math.cos(b * RAD);
      return stats(evalAt(ox, oy).map((c) => c.err)).rmse_deg;
    });
    return { shift_m: d, directions: d === 0 ? 1 : DIRS.length, rmse_mean_deg: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3),
      rmse_min_deg: Math.min(...vals), rmse_max_deg: Math.max(...vals) };
  });
  const eyeSens = [1.5, 2.0, 2.5].map((h) => ({ eye_h_m: h, rmse_deg: stats(evalAt(w.x_m, w.y_m, h).map((c) => c.err)).rmse_deg }));

  const azs = S.map((s) => s.az);
  stops.push({
    sol: w.sol, rmc, rover_position: { x_m: w.x_m, y_m: w.y_m, lon: w.lon, lat: w.lat, elev_geoid_m: w.elev_geoid,
      dem_elev_m: +T.heightAt(w.x_m, w.y_m).toFixed(2), source: "route.json waypoint (MMGIS MSL_waypoints) for this site_drive" },
    images: [...new Set(S.map((s) => s.imageid))],
    azimuth_min_deg: +Math.min(...azs).toFixed(1), azimuth_max_deg: +Math.max(...azs).toFixed(1),
    skyline_all: all, skyline_horizon_inside_window: inWin, skyline_horizon_window_limited: winLim,
    window_limited_fraction: +(base.filter((c) => c.windowLimited).length / base.length).toFixed(3),
    real_minus_window_note: "error = predicted minus real elevation angle (negative = model horizon too low)",
    skyline_peaks: peakRes, position_sensitivity: sens, eye_height_sensitivity: eyeSens,
    columns: base.map((c) => ({ imageid: c.imageid, col: c.col, row: c.row, az: +c.az.toFixed(3), real_el: +c.el.toFixed(3),
      pred_el: +c.pred.toFixed(3), pred_horizon_dist_m: Math.round(c.predDist), window_exit_m: Math.round(c.exitDist), window_limited: c.windowLimited, err: +c.err.toFixed(3) })),
  });
}
const pooled = stops.flatMap((s) => s.columns);
const out = {
  generated_utc: new Date().toISOString(),
  method: { eye_height_m: EYE_H, predicted_skyline: "web/js/visibility.js skyline(), 0.1 deg azimuth, maxRange 2500 m, DEM web/data/dem.f32 (2.5 x 2.5 km window, 1 m)",
    real_skyline: "Navcam left B full-frame EDR JPEGs; sky/terrain boundary traced per column (see validation/README.md), sampled every 8 px; pixel to direction via the CAHVOR model and rover attitude quaternion published with each image",
    window_limited_rule: `horizon point within ${EDGE_MARGIN_M} m of where the ray leaves the DEM window`, tuning: "none; no model parameter was changed or fitted" },
  images: meta.map((m) => ({ sol: m.sol, site_drive: m.rmc, imageid: m.imageid, camera: "Navcam left (NAV_LEFT_B), full frame 1024x1024", date_taken_utc: m.date_taken, lmst: m.lmst,
    mast_az_deg: m.mast_az, mast_el_deg: m.mast_el, credit: "NASA/JPL-Caltech",
    page: `https://mars.nasa.gov/raw_images/${m.id}`,
    jpg: `https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/${String(m.sol).padStart(5, "0")}/opgs/edr/ncam/${m.imageid}.JPG` })),
  attitude_check: attitudeCheck, extraction_cleaning: cleanLog, manual_exclusions: EXCLUDE,
  pooled: { all: stats(pooled.map((c) => c.err)), horizon_inside_window: stats(pooled.filter((c) => !c.window_limited).map((c) => c.err)),
    horizon_window_limited: stats(pooled.filter((c) => c.window_limited).map((c) => c.err)) },
  stops,
};
fs.writeFileSync("web/data/validation/results.json", JSON.stringify(out, null, 1));
const brief = { ...out, stops: out.stops.map(({ columns, ...s }) => s) };
console.log(JSON.stringify(brief, null, 1));
