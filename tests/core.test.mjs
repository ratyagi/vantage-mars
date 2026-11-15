import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Terrain, makeSyntheticTerrain } from "../web/js/terrain.js";
import { sunPosition } from "../web/js/sun.js";
import {
  lineOfSight, sampleRoute, routeVisibility, blindRuns, skyline,
  hiddenGroundAhead, renderPanorama, curvDrop, azimuthDeg, walkMinutes, suggestLandmarks,
  cumulativeWalkMinutes, inTerrainShadow, shadowMap, visibilityFraction, planRoute,
} from "../web/js/visibility.js";

function flat(w = 400, h = 400, cell = 1, z = 0) {
  return new Terrain(w, h, cell, new Float32Array(w * h).fill(z));
}
function withBlock(T, x0, x1, y0, y1, z) {
  for (let j = 0; j < T.height; j++) for (let i = 0; i < T.width; i++) {
    const x = (i + 0.5) * T.cell, y = (j + 0.5) * T.cell;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) T.data[j * T.width + i] = z;
  }
  return T;
}

test("flat ground is visible both ways", () => {
  const T = flat();
  const r = lineOfSight(T, 50, 200, 1.7, 300, 200, 0);
  assert.equal(r.visible, true);
});

test("a 20 m wall between observer and target blocks the view", () => {
  const T = withBlock(flat(), 150, 154, 0, 400, 20);
  const r = lineOfSight(T, 50, 200, 1.7, 300, 200, 2);
  assert.equal(r.visible, false);
  assert.ok(r.blockDist > 95 && r.blockDist < 105, `blockDist ${r.blockDist}`);
});

test("a low ridge hides a person-height target but not a tall one", () => {
  const T = withBlock(flat(), 100, 104, 0, 400, 1.5); // ridge 1.5 m, eye 1.7 m
  // observer 20 m from ridge, target 40 m behind it
  const hidden = lineOfSight(T, 80, 200, 1.7, 144, 200, 0.0);
  const tall = lineOfSight(T, 80, 200, 1.7, 144, 200, 3.0);
  assert.equal(hidden.visible, false, "ground behind ridge should be hidden");
  assert.equal(tall.visible, true, "3 m target should clear a 1.5 m ridge seen from 1.7 m eye");
});

test("curvature drop is about 1.5 mm at 100 m and about 1.3 m at 3 km", () => {
  assert.ok(curvDrop(100) < 0.002);
  assert.ok(Math.abs(curvDrop(3000) - 1.325) < 0.02);
});

test("azimuth: east 90, south 180, north 0 (y is south)", () => {
  assert.ok(Math.abs(azimuthDeg(10, 0) - 90) < 1e-9);
  assert.ok(Math.abs(azimuthDeg(0, 10) - 180) < 1e-9);
  assert.ok(Math.abs(azimuthDeg(0, -10) - 0) < 1e-9);
});

test("sun: equinox noon at equator is overhead; solstice noon elevation = 90 - obliquity", () => {
  assert.ok(Math.abs(sunPosition(0, 0, 12).elevDeg - 90) < 1e-6);
  assert.ok(Math.abs(sunPosition(0, 90, 12).elevDeg - (90 - 25.19)) < 0.01);
  const m = sunPosition(-4.8, 0, 8), a = sunPosition(-4.8, 0, 16);
  assert.ok(m.azDeg < 180 && a.azDeg > 180, "morning sun east, afternoon sun west");
  assert.ok(Math.abs(m.elevDeg - a.elevDeg) < 1e-6, "symmetric about noon");
});

test("route resampling keeps spacing and total length", () => {
  const s = sampleRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], 10);
  assert.ok(Math.abs(s[s.length - 1].s - 150) < 1e-6);
  assert.ok(Math.abs(s[1].s - s[0].s - 10) < 1e-6);
});

test("skyline: a 10 m block 100 m east shows ~ atan((10-1.7)/100) degrees", () => {
  const T = withBlock(flat(), 100, 110, 0, 400, 10);
  const sk = skyline(T, 50, 200, 1.7, 360, 300);
  const expected = (Math.atan2(10 - 1.7, 50) * 180) / Math.PI; // block starts 50 m away
  const east = sk.angleDeg[90];
  assert.ok(Math.abs(east - expected) < 1.0, `east ${east} vs ${expected}`);
  assert.ok(sk.angleDeg[270] < 0.1, "west is open flat ground, horizon near 0 or below");
});

test("hidden ground: none on flat terrain, some at a drop-off edge", () => {
  const T = flat();
  assert.equal(hiddenGroundAhead(T, 200, 200, 90, 1.7, 50, 60).hiddenFraction, 0);
  // drop-off: ground east of x=210 is 30 m lower; standing at the edge cannot see the foot of the wall
  const D = new Terrain(400, 400, 1, new Float32Array(400 * 400));
  for (let j = 0; j < 400; j++) for (let i = 0; i < 400; i++) D.data[j * 400 + i] = i < 210 ? 0 : -30;
  const r = hiddenGroundAhead(D, 205, 200, 90, 1.7, 50, 60);
  assert.ok(r.hiddenFraction > 0.2, `hiddenFraction ${r.hiddenFraction}`);
  assert.ok(r.firstHiddenDist !== null);
});

test("route visibility and blind runs: ridge wall splits the walk", () => {
  const T = withBlock(flat(), 200, 206, 0, 400, 12);
  const route = sampleRoute([{ x: 20, y: 200 }, { x: 380, y: 200 }], 10);
  const targets = [{ id: "hab", name: "Habitat", kind: "habitat", x: 20, y: 200, h: 3 }];
  const rows = routeVisibility(T, route, targets, { eyeH: 1.7, partnerGap: 30 });
  assert.equal(rows[2].vis.hab.visible, true);
  assert.equal(rows[rows.length - 2].vis.hab.visible, false);
  const runs = blindRuns(rows, targets, 20);
  assert.equal(runs.length, 1);
  assert.ok(runs[0].length > 100);
  assert.ok(rows[rows.length - 1].partner !== null);
});

test("panorama skyline row agrees with the independent skyline() result", () => {
  const T = withBlock(flat(), 100, 110, 0, 400, 10);
  const sun = { azDeg: 90, elevDeg: 30 };
  const W = 360, H = 200, fov = 90;
  const p = renderPanorama(T, 50, 200, 1.7, 90, fov, W, H, sun, { maxRange: 300 });
  const sk = skyline(T, 50, 200, 1.7, 360, 300);
  const rowOf = (a) => Math.round(((p.angMax - a) / (p.angMax - p.angMin)) * (H - 1));
  const centerCol = Math.floor(W / 2);
  const expectedRow = rowOf(sk.angleDeg[90]);
  assert.ok(Math.abs(p.skylineRow[centerCol] - expectedRow) <= 2, `row ${p.skylineRow[centerCol]} vs ${expectedRow}`);
});

test("synthetic terrain builds, has relief, and walk time is positive", () => {
  const T = makeSyntheticTerrain(300, 300, 2);
  assert.equal(T.meta.synthetic, true);
  assert.ok(T.slopeDeg(300, 300) >= 0);
  const rows = sampleRoute([{ x: 50, y: 50 }, { x: 500, y: 400 }], 10);
  assert.ok(walkMinutes(T, rows) > 5);
});

test("slope over a longer baseline smooths cell-scale noise", () => {
  const T = flat();
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < T.data.length; k++) T.data[k] = rnd() * 1.0; // 1 m scale noise, 1 m amplitude
  const fine = T.slopeDeg(200, 200, 1), coarse = T.slopeDeg(200, 200, 5);
  assert.ok(fine > 5, `fine ${fine}`);
  assert.ok(coarse < fine, `coarse ${coarse} should be below fine ${fine}`);
});

test("suggestLandmarks: picks a clear summit near the route, away from edges", () => {
  const T = withBlock(flat(600, 600, 2), 600, 640, 600, 640, 25); // 25 m block summit at (600..640)
  const route = [{ x: 300, y: 620 }, { x: 500, y: 620 }];
  const lm = suggestLandmarks(T, route, { n: 2, margin: 100, maxRoute: 500 });
  assert.ok(lm.length >= 1);
  assert.ok(lm.every((c) => c.x >= 100 && c.x <= T.extentX - 100 && c.y >= 100 && c.y <= T.extentY - 100));
  assert.ok(Math.hypot(lm[0].x - 620, lm[0].y - 620) < 40, `got ${lm[0].x},${lm[0].y}`);
});

test("cumulative walk minutes ends at the total and is monotonic", () => {
  const T = makeSyntheticTerrain(300, 300, 2);
  const rows = sampleRoute([{ x: 50, y: 50 }, { x: 500, y: 400 }], 10);
  const c = cumulativeWalkMinutes(T, rows);
  assert.equal(c.length, rows.length);
  assert.ok(Math.abs(c[c.length - 1] - walkMinutes(T, rows)) < 1e-9);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1]);
});

test("terrain shadow: ridge toward a low sun shadows the lee side, flat ground is lit, night is dark", () => {
  const T = withBlock(flat(600, 600, 2), 400, 420, 0, 1200, 30); // 30 m wall at x 400..420
  // sun in the east (az 90) at 10 deg: point west of wall (x=300) is shadowed, point east (x=800) lit
  assert.equal(inTerrainShadow(T, 300, 600, 90, 10), true);
  assert.equal(inTerrainShadow(T, 800, 600, 90, 10), false);
  assert.equal(inTerrainShadow(T, 300, 600, 90, 80), false, "high sun clears a 30 m wall 100 m away");
  assert.equal(inTerrainShadow(flat(), 100, 100, 90, -5), true, "sun below horizon");
  const m = shadowMap(T, { azDeg: 90, elevDeg: 10 }, null, 10);
  assert.ok(m.grid.some((v) => v === 1) && m.grid.some((v) => v === 0));
});

test("visibility fraction: certain on open ground, certain when blocked, sensitive at a wall edge", () => {
  const open = flat();
  assert.equal(visibilityFraction(open, 50, 200, 1.7, 300, 200, 2, 5), 1);
  const wall = withBlock(flat(), 150, 154, 0, 400, 20);
  assert.equal(visibilityFraction(wall, 50, 200, 1.7, 300, 200, 2, 5), 0);
  // wall only covers y 100..300; target line passes near its end so +-5 m changes the answer
  const edge = withBlock(flat(), 150, 154, 100, 198, 20);
  const f = visibilityFraction(edge, 50, 200, 1.7, 300, 200, 2, 8);
  assert.ok(f > 0 && f < 1, `fraction ${f}`);
});

test("route planner: goes around an impassable wall through the gap, avoids steep cells", () => {
  const T = withBlock(flat(600, 600, 2), 600, 620, 0, 900, 40); // wall from y=0..900, gap at y>900 (extent 1200)
  const r = planRoute(T, { x: 300, y: 300 }, { x: 900, y: 300 }, { pad: 800, slopeLimit: 20 });
  assert.ok(r, "route found");
  const onWall = r.points.filter((p) => p.x >= 600 && p.x <= 620);
  assert.ok(onWall.length > 0 && onWall.every((p) => p.y >= 899), "path must cross the wall's line only through the gap");
  assert.deepEqual([r.points[0].x, r.points[0].y], [300, 300]);
  assert.deepEqual([r.points[r.points.length - 1].x, r.points[r.points.length - 1].y], [900, 300]);
  const blocked = planRoute(withBlock(flat(600, 600, 2), 600, 620, 0, 1200, 40), { x: 300, y: 300 }, { x: 900, y: 300 }, { pad: 800 });
  assert.equal(blocked, null, "fully walled: no route");
});

test("route planner: visibility weight reduces time spent out of sight of the habitat", () => {
  const T = flat(600, 600, 2);
  for (let j = 0; j < 600; j++) for (let i = 0; i < 600; i++) { // smooth hill, about 13 deg max slope, passable
    const x = (i + 0.5) * 2, y = (j + 0.5) * 2;
    T.data[j * 600 + i] = 15 * Math.exp(-(((x - 500) / 40) ** 2 + ((y - 300) / 40) ** 2));
  }
  const hab = { x: 100, y: 300 };
  const hiddenFrac = (pts) => {
    const rows = routeVisibility(T, sampleRoute(pts, 10), [{ id: "h", x: hab.x, y: hab.y, h: 3 }], { eyeH: 1.7 });
    return rows.filter((r) => r.vis.h.visible === false).length / rows.length;
  };
  const a = planRoute(T, { x: 250, y: 300 }, { x: 900, y: 300 }, { pad: 300, habitat: hab, visWeight: 0 });
  const b = planRoute(T, { x: 250, y: 300 }, { x: 900, y: 300 }, { pad: 300, habitat: hab, visWeight: 6 });
  assert.ok(hiddenFrac(b.points) <= hiddenFrac(a.points), `weighted ${hiddenFrac(b.points)} vs plain ${hiddenFrac(a.points)}`);
  assert.ok(b.cost >= a.cost - 1e-9, "weighted cost cannot be lower than the unweighted path cost");
});

test("route planner: still finds a route when the start sits on a steep cell", () => {
  const T = withBlock(flat(600, 600, 2), 296, 306, 296, 306, 40); // 40 m pillar at the start
  const r = planRoute(T, { x: 300, y: 300 }, { x: 700, y: 300 }, { pad: 200 });
  assert.ok(r && r.points.length > 2, "route from a steep start cell");
});

test("route planner: coarsens the grid for long routes so it stays fast", () => {
  const T = flat(1200, 1200, 2);
  const t0 = Date.now();
  const r = planRoute(T, { x: 200, y: 200 }, { x: 2200, y: 2200 }, { habitat: { x: 200, y: 200 }, pad: 250 });
  assert.ok(r, "route found");
  assert.ok(Date.now() - t0 < 5000, "long plan under 5 s");
});

// Runs only when the real terrain window is present (after running the pipeline).
const here = path.dirname(fileURLToPath(import.meta.url));
const demJson = path.join(here, "..", "web", "data", "dem.json");
test("real terrain window (if present): sane grid, landmarks valid, route visible", { skip: !fs.existsSync(demJson) }, () => {
  const meta = JSON.parse(fs.readFileSync(demJson, "utf8"));
  if (meta.synthetic) return;
  const buf = fs.readFileSync(path.join(here, "..", "web", "data", "dem.f32"));
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  assert.equal(data.length, meta.width * meta.height);
  const T = new Terrain(meta.width, meta.height, meta.cell_m, data, meta);
  const wp = JSON.parse(fs.readFileSync(path.join(here, "..", "web", "data", "route.json"), "utf8")).waypoints.filter((w) => w.inside);
  assert.ok(wp.length > 20);
  const route = wp.map((w) => ({ x: w.x_m, y: w.y_m }));
  const lm = suggestLandmarks(T, route);
  assert.ok(lm.length >= 2, "expected at least 2 landmarks");
  for (const c of lm) assert.ok(isFinite(T.heightAt(c.x, c.y)));
  const rows = routeVisibility(T, sampleRoute(route, 10), lm.map((c, i) => ({ id: "L" + i, name: "L", kind: "landmark", x: c.x, y: c.y, h: 2 })), { eyeH: 1.7 });
  const anyVisible = rows.some((r) => Object.values(r.vis).some((v) => v.visible === true));
  const anyUnknown = rows.some((r) => Object.values(r.vis).some((v) => v.visible === null));
  assert.ok(anyVisible, "some landmark should be visible somewhere on the route");
  assert.ok(!anyUnknown, "no target should fall on missing data");
});
