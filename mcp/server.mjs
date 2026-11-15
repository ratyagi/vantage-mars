#!/usr/bin/env node
// Vantage MCP server: exposes the Vantage terrain checks as tools an AI assistant can call.
// Zero dependencies. Speaks MCP (JSON-RPC 2.0, newline-delimited) over stdio.
// Runs offline on the local terrain window, which is the point: on Mars, ground support is minutes away by radio.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Terrain } from "../web/js/terrain.js";
import { sunPosition } from "../web/js/sun.js";
import {
  lineOfSight, sampleRoute, routeVisibility, cumulativeWalkMinutes, suggestLandmarks, costField,
  radioCoverage, relaySites, planRoute, daylightLeftMin, sunTransmission, visualRangeM, inTerrainShadow,
  hiddenGroundAhead, SLOPE_BASELINE_M, skylineAt, skylineMismatch,
} from "../web/js/visibility.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "web", "data");
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, "dem.json"), "utf8"));
const buf = fs.readFileSync(path.join(dataDir, "dem.f32"));
const T = new Terrain(meta.width, meta.height, meta.cell_m, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), meta);
const traverse = JSON.parse(fs.readFileSync(path.join(dataDir, "route.json"), "utf8"));
const wp = traverse.waypoints.filter((w) => w.inside && w.sol >= 4605 && w.sol <= 4860);
const LAT = meta.window_center_lonlat[1];

// Default scene: the same one the web app opens with.
const route = wp.map((w) => ({ x: w.x_m, y: w.y_m }));
const habitat = { x: wp[0].x_m, y: wp[0].y_m };
const rover = { x: wp[2].x_m, y: wp[2].y_m };
const landmarks = suggestLandmarks(T, route).map((c, i) => ({ x: c.x, y: c.y, name: "Summit " + (i + 1) }));
const targets = [
  { id: "hab", name: "Habitat", x: habitat.x, y: habitat.y, h: 3 },
  { id: "rov", name: "Rover", x: rover.x, y: rover.y, h: 2.5 },
  ...landmarks.map((l, i) => ({ id: "lm" + i, name: l.name, x: l.x, y: l.y, h: 2 })),
];
const rows = routeVisibility(T, sampleRoute(route, 10), targets, { eyeH: 1.7, partnerGap: 30 });
const cum = cumulativeWalkMinutes(T, rows);
const reach = costField(T, habitat);
const r1 = (v, n = 1) => (isFinite(v) ? +(+v).toFixed(n) : null);

function resolvePoint(a) {
  if (a.sol !== undefined) {
    const w = wp.filter((q) => q.sol === a.sol);
    if (!w.length) throw new Error(`No boxwork waypoint on sol ${a.sol}. Sols ${wp[0].sol} to ${wp[wp.length - 1].sol} are inside the window.`);
    const q = w[w.length - 1];
    const r = rows.reduce((bb, z) => (Math.hypot(z.x - q.x_m, z.y - q.y_m) < Math.hypot(bb.x - q.x_m, bb.y - q.y_m) ? z : bb));
    return { x: q.x_m, y: q.y_m, label: `Curiosity end-of-drive position, sol ${a.sol} (${r.s.toFixed(0)} m along the route)`, row: Math.hypot(r.x - q.x_m, r.y - q.y_m) < 15 ? r : undefined };
  }
  if (a.route_m !== undefined) {
    const s = Math.max(0, Math.min(rows[rows.length - 1].s, a.route_m));
    const r = rows.reduce((b, q) => (Math.abs(q.s - s) < Math.abs(b.s - s) ? q : b));
    return { x: r.x, y: r.y, label: `${r.s.toFixed(0)} m along the Curiosity boxwork route`, row: r };
  }
  if (a.x !== undefined && a.y !== undefined) return { x: a.x, y: a.y, label: `x ${a.x} m east, y ${a.y} m south of the window's NW corner` };
  throw new Error("Give one of: sol, route_m, or x and y (metres).");
}

const TOOLS = {
  terrain_info: {
    description: "Describe the terrain window, coordinate convention, default scene (habitat, rover, landmarks, Curiosity route) and data sources. Call this first.",
    inputSchema: { type: "object", properties: {} },
    run: () => ({
      terrain: meta.product, cell_m: meta.cell_m, size_m: [T.extentX, T.extentY], center_lonlat: meta.window_center_lonlat,
      coordinates: "x metres east, y metres south from the window's north-west corner; azimuth clockwise from north",
      route: { source: "NASA MMGIS MSL waypoints, Curiosity boxwork campaign", sols: [wp[0].sol, wp[wp.length - 1].sol], length_m: r1(rows[rows.length - 1].s, 0) },
      habitat, rover, landmarks: landmarks.map((l) => ({ name: l.name, x: r1(l.x, 0), y: r1(l.y, 0) })),
      caveat: "Predictions from a terrain model with labeled assumptions (pace, slope limits, heights). Advisory only.",
    }),
  },
  eva_check: {
    description: "Safety check for a walking astronaut at one point: verdict inputs, what is in view, fastest walk home, start-back margin, sun, dust and radio. Point is given by sol (Curiosity position that sol), route_m (distance along the default route) or x/y metres.",
    inputSchema: {
      type: "object",
      properties: {
        sol: { type: "integer" }, route_m: { type: "number" }, x: { type: "number" }, y: { type: "number" },
        ltst: { type: "number", description: "Local true solar time, hours (default 9)" },
        ls: { type: "number", description: "Solar longitude, deg (default 90)" },
        tau: { type: "number", description: "Dust optical depth (default 0.6)" },
        shelter_limit_min: { type: "number", description: "Shelter limit during a solar particle event alert (default 60)" },
        eva_min: { type: "number", description: "Planned EVA length in minutes (default 360)" },
      },
    },
    run: (a) => {
      const p = resolvePoint(a), ltst = a.ltst ?? 9, ls = a.ls ?? 90, tau = a.tau ?? 0.6;
      const sun = sunPosition(LAT, ls, ltst);
      const inView = targets.map((t) => { const v = lineOfSight(T, p.x, p.y, 1.7, t.x, t.y, t.h); return { name: t.name, visible: v.visible, distance_m: r1(v.dist, 0) }; });
      const slope = T.slopeDeg(p.x, p.y, SLOPE_BASELINE_M);
      const ret = reach.at(p.x, p.y);
      const radio = lineOfSight(T, habitat.x, habitat.y, 3, p.x, p.y, 1.7, { step: 2 }).visible;
      const day = daylightLeftMin(T, p.x, p.y, (h) => sunPosition(LAT, ls, h), ltst);
      const used = p.row ? cum[rows.indexOf(p.row)] : null;
      const lim = a.shelter_limit_min ?? 60, eva = a.eva_min ?? 360;
      const hidden = hiddenGroundAhead(T, p.x, p.y, p.row ? p.row.heading : 0, 1.7, 25, 60, 0.3);
      const issues = [];
      if (sun.elevDeg < 0) issues.push("HOLD: sun below horizon");
      if (slope > 20) issues.push(`HOLD: slope ${r1(slope, 0)} deg over the 20 deg planning limit`);
      if (!inView.some((v) => v.visible)) issues.push("HOLD: nothing to navigate by is in view");
      if (ret > lim) issues.push(`HOLD during an SPE alert: fastest way home ${r1(ret, 0)} min exceeds the ${lim} min shelter limit`);
      if (slope > 15 && slope <= 20) issues.push(`CAUTION: slope ${r1(slope, 0)} deg`);
      if (sun.elevDeg >= 0 && sun.elevDeg < 20) issues.push("CAUTION: low sun, slopes and shadows easy to misjudge");
      if (sunTransmission(tau, sun.elevDeg) < 0.1 && sun.elevDeg > 0) issues.push("CAUTION: dust blocks the direct sun, no sun compass");
      if (hidden.hiddenFraction > 0.25) issues.push(`CAUTION: a 0.3 m hazard would be hidden on ${Math.round(hidden.hiddenFraction * 100)}% of the ground within 25 m`);
      if (!radio) issues.push("NOTE: no radio line of sight to the habitat (geometry only)");
      return {
        point: p.label, x: r1(p.x, 0), y: r1(p.y, 0), slope_deg: r1(slope),
        in_view: inView,
        fastest_return_min: r1(ret, 0), retrace_route_min: used === null ? null : r1(used, 0),
        start_back_within_min: r1(Math.min(day ? day.min - ret : Infinity, used === null ? Infinity : eva - used - 30 - ret), 0),
        sun: { elevation_deg: r1(sun.elevDeg), azimuth_deg: r1(sun.azDeg, 0), in_terrain_shadow: inTerrainShadow(T, p.x, p.y, sun.azDeg, sun.elevDeg), direct_transmission: r1(sunTransmission(tau, sun.elevDeg), 3) },
        dust: { tau, visual_range_km: r1(visualRangeM(tau) / 1000) },
        radio_line_of_sight_to_habitat: radio,
        issues,
        assumptions: "Pace 2 km/h derated to 5% at 20 deg slope; eye 1.7 m; habitat mast 3 m; 30 min suit reserve; lunar-derived thresholds. Not a radiation or link-budget model.",
      };
    },
  },
  radio_plan: {
    description: "Radio line of sight between the habitat mast and the suit along the Curiosity route: coverage, longest outage and the best relay sites.",
    inputSchema: { type: "object", properties: { mast_m: { type: "number" }, relay_m: { type: "number" } } },
    run: (a) => {
      const mast = a.mast_m ?? 3;
      const c = radioCoverage(T, rows, habitat, mast, 1.7, (i, j) => cum[j] - cum[i]);
      const rs = relaySites(T, rows, habitat, mast, { relayH: a.relay_m ?? 2.5 });
      return {
        coverage_fraction: r1(c.coveredFrac, 2), longest_gap_m: r1(c.worst.len, 0), longest_gap_walk_min: r1(c.gapMin, 0),
        gap_from_m: r1(c.worst.from, 0), gap_to_m: r1(c.worst.to, 0),
        relays: rs.picks.map((q, i) => ({ rank: i + 1, x: r1(q.x, 0), y: r1(q.y, 0), distance_from_habitat_m: r1(q.dHab, 0), coverage_after: r1(q.coveredFrac, 2) })),
        caveat: "Geometric line of sight only, not a link budget (no diffraction, Fresnel clearance or antenna pattern).",
      };
    },
  },
  horizon_fix: {
    description: "Find where an observer is from the skyline alone (no GPS, no magnetic compass on Mars). Give either a sol (uses the skyline traced from the real Curiosity Navcam frame at that stop) or observations [{az, el}] in degrees with heading known. Searches 1.2 x 1.2 km around the habitat.",
    inputSchema: { type: "object", properties: { sol: { type: "integer", enum: [4634, 4748, 4839] }, observations: { type: "array", items: { type: "object", properties: { az: { type: "number" }, el: { type: "number" } } } }, eye_m: { type: "number" } } },
    run: (a) => {
      let obs = a.observations, eye = a.eye_m ?? 1.7, truth = null;
      if (a.sol !== undefined) {
        const V = JSON.parse(fs.readFileSync(path.join(dataDir, "validation", "results.json"), "utf8"));
        const st = V.stops.find((q) => q.sol === a.sol); if (!st) throw new Error("Real photos exist for sols 4634, 4748, 4839.");
        const bins = new Map(); for (const q of st.columns) { const k = Math.round(q.az / 2) * 2; if (!bins.has(k)) bins.set(k, []); bins.get(k).push(q.real_el); }
        obs = [...bins].map(([az, v]) => ({ az: (az + 360) % 360, el: v.reduce((t, q) => t + q, 0) / v.length })); eye = 2.0;
        truth = { x: st.rover_position.x_m, y: st.rover_position.y_m };
      }
      if (!obs || obs.length < 5) throw new Error("Need at least 5 skyline observations, or a sol.");
      const g = 20, R = 600, cand = [];
      for (let y = habitat.y - R; y <= habitat.y + R; y += g) for (let x = habitat.x - R; x <= habitat.x + R; x += g) if (T.inside(x, y)) cand.push({ x, y, e: skylineMismatch(T, x, y, eye, obs) });
      cand.sort((p, q) => p.e - q.e);
      const seeds = []; for (const c of cand) { if (seeds.every((s) => Math.hypot(s.x - c.x, s.y - c.y) > 40)) seeds.push(c); if (seeds.length === 5) break; }
      let best = { ...seeds[0] };
      for (const sd of seeds) for (let y = sd.y - 16; y <= sd.y + 16; y += 4) for (let x = sd.x - 16; x <= sd.x + 16; x += 4) { const e = skylineMismatch(T, x, y, eye, obs); if (e < best.e) best = { x, y, e }; }
      const alt = cand.find((c) => Math.hypot(c.x - best.x, c.y - best.y) > 100)?.e ?? Infinity;
      return { fix: { x: r1(best.x, 0), y: r1(best.y, 0) }, skyline_fit_deg: r1(best.e, 2), best_fit_elsewhere_deg: r1(alt, 2), unambiguous: alt > best.e * 1.5,
        error_vs_true_m: truth ? r1(Math.hypot(best.x - truth.x, best.y - truth.y), 0) : null,
        caveat: "Heading assumed known (sun sighting). Fails when the skyline is beyond the 2.5 km terrain window or covers too few directions. Advisory." };
    },
  },
  line_of_sight: {
    description: "Can an observer at A see a target at B? Heights above ground in metres. Includes Mars curvature.",
    inputSchema: { type: "object", required: ["ax", "ay", "bx", "by"], properties: { ax: { type: "number" }, ay: { type: "number" }, ah: { type: "number" }, bx: { type: "number" }, by: { type: "number" }, bh: { type: "number" } } },
    run: (a) => { const v = lineOfSight(T, a.ax, a.ay, a.ah ?? 1.7, a.bx, a.by, a.bh ?? 1.7); return { visible: v.visible, distance_m: r1(v.dist, 0), clearance_m: r1(v.clearance, 2), blocked_at_m: r1(v.blockDist, 0) }; },
  },
  plan_route: {
    description: "Plan a slope-limited walking route between two points that prefers keeping the habitat in view. Points as {x,y} metres or {sol}.",
    inputSchema: { type: "object", required: ["start", "goal"], properties: { start: { type: "object" }, goal: { type: "object" }, slope_limit_deg: { type: "number" } } },
    run: (a) => {
      const s = resolvePoint(a.start), g = resolvePoint(a.goal);
      const p = planRoute(T, s, g, { habitat, slopeLimit: a.slope_limit_deg ?? 20 });
      if (!p) return { found: false, reason: "No route under the slope limit inside the planning box." };
      const rr = sampleRoute(p.points, 10), cm = cumulativeWalkMinutes(T, rr);
      return { found: true, length_m: r1(rr[rr.length - 1].s, 0), walk_min: r1(cm[cm.length - 1], 0), waypoints: p.points.filter((_, i) => i % 10 === 0 || i === p.points.length - 1).map((q) => ({ x: r1(q.x, 0), y: r1(q.y, 0) })) };
    },
  },
};

// ---------- minimal MCP over stdio ----------
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
let bufIn = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  bufIn += chunk;
  let i;
  while ((i = bufIn.indexOf("\n")) >= 0) {
    const line = bufIn.slice(0, i).trim(); bufIn = bufIn.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    handle(msg);
  }
});
function handle(m) {
  const { id, method, params } = m;
  if (id === undefined) return; // notifications
  try {
    if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "vantage-mars", version: "1.0.0" } } });
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) } });
    if (method === "tools/call") {
      const t = TOOLS[params?.name];
      if (!t) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
      try { const out = t.run(params.arguments || {}); return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out } }); }
      catch (e) { return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Error: " + e.message }], isError: true } }); }
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) { send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } }); }
}
