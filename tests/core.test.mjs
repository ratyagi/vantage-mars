import test from "node:test";
import assert from "node:assert/strict";
import { Terrain, makeSyntheticTerrain } from "../web/js/terrain.js";
import { sunPosition } from "../web/js/sun.js";
import {
  lineOfSight, sampleRoute, routeVisibility, blindRuns, skyline,
  hiddenGroundAhead, renderPanorama, curvDrop, azimuthDeg, walkMinutes,
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
