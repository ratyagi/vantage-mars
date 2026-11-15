// Terrain container. Coordinates: x meters east, y meters SOUTH (row down), origin at the NW corner.
// Elevations in meters. NaN means "no data".

export class Terrain {
  constructor(width, height, cell, data, meta = {}) {
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.data = data; // Float32Array, row-major, north first
    this.meta = meta;
    this.extentX = width * cell;
    this.extentY = height * cell;
  }

  static async load(baseUrl = "data/") {
    const meta = await (await fetch(baseUrl + "dem.json")).json();
    const buf = await (await fetch(baseUrl + "dem.f32")).arrayBuffer();
    const data = new Float32Array(buf);
    if (data.length !== meta.width * meta.height) {
      throw new Error(`dem.f32 size ${data.length} does not match ${meta.width}x${meta.height}`);
    }
    return new Terrain(meta.width, meta.height, meta.cell_m, data, meta);
  }

  // Cell centers sit at (i+0.5)*cell. Bilinear sample; NaN if any neighbor is NaN.
  heightAt(x, y) {
    const fx = x / this.cell - 0.5;
    const fy = y / this.cell - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy);
    if (i0 < 0 || j0 < 0 || i0 + 1 >= this.width || j0 + 1 >= this.height) return NaN;
    const tx = fx - i0, ty = fy - j0;
    const w = this.width, d = this.data;
    const a = d[j0 * w + i0], b = d[j0 * w + i0 + 1];
    const c = d[(j0 + 1) * w + i0], e = d[(j0 + 1) * w + i0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }

  inside(x, y) {
    return x >= this.cell && y >= this.cell && x < this.extentX - this.cell && y < this.extentY - this.cell;
  }

  // Surface gradient: dz/dEast, dz/dNorth (north = -y), central difference over `baseline` metres.
  gradient(x, y, baseline = this.cell) {
    const h = baseline;
    const zE = this.heightAt(x + h, y), zW = this.heightAt(x - h, y);
    const zS = this.heightAt(x, y + h), zN = this.heightAt(x, y - h);
    return [(zE - zW) / (2 * h), (zN - zS) / (2 * h)];
  }

  // Slope in degrees. Use a baseline of a few metres for rover/suited-walker scale; one cell is sensitive to DEM noise.
  slopeDeg(x, y, baseline = this.cell) {
    const [gx, gy] = this.gradient(x, y, baseline);
    if (!isFinite(gx) || !isFinite(gy)) return NaN;
    return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
  }
}

// SYNTHETIC terrain for development only: ridge network with hollows, roughly the scale of boxwork
// (ridges about 1.5 m high, spacing 30 to 60 m) on a gentle regional slope. Not Mars data.
export function makeSyntheticTerrain(width = 800, height = 800, cell = 2) {
  const data = new Float32Array(width * height);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lines = [];
  for (let k = 0; k < 22; k++) {
    const horizontal = k % 2 === 0;
    lines.push({ horizontal, pos: rnd() * (horizontal ? height : width) * cell, tilt: (rnd() - 0.5) * 0.5, w: 4 + rnd() * 4, hgt: 1.0 + rnd() * 1.4 });
  }
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      let z = -3600 + 0.02 * x - 0.03 * y;
      for (const L of lines) {
        const dist = L.horizontal ? (y - L.pos - L.tilt * x) : (x - L.pos - L.tilt * y);
        z += L.hgt * Math.exp(-((dist / L.w) ** 2));
      }
      z += 6 * Math.exp(-(((x - 900) / 140) ** 2 + ((y - 700) / 120) ** 2)); // a butte
      z += 9 * Math.exp(-(((x - 300) / 110) ** 2 + ((y - 1150) / 100) ** 2));
      data[j * width + i] = z;
    }
  }
  return new Terrain(width, height, cell, data, {
    synthetic: true,
    product: "SYNTHETIC test terrain (not Mars data)",
    cell_m: cell,
    min: -3650, max: -3550,
    window_center_lonlat: [137.4, -4.8],
  });
}

// Hillshade as 8-bit gray (0..255) for the map layer.
export function hillshade(T, sunAzDeg, sunElDeg, zExag = 2) {
  const out = new Uint8ClampedArray(T.width * T.height);
  const az = (sunAzDeg * Math.PI) / 180, el = (sunElDeg * Math.PI) / 180;
  const L = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  const w = T.width, h = T.height, d = T.data, c = T.cell;
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const zE = d[j * w + i + 1], zW = d[j * w + i - 1], zS = d[(j + 1) * w + i], zN = d[(j - 1) * w + i];
      if (!(isFinite(zE) && isFinite(zW) && isFinite(zS) && isFinite(zN))) { out[j * w + i] = 0; continue; }
      const gx = ((zE - zW) / (2 * c)) * zExag, gy = ((zN - zS) / (2 * c)) * zExag;
      const nl = Math.hypot(gx, gy, 1);
      const s = (-gx * L[0] - gy * L[1] + L[2]) / nl;
      out[j * w + i] = Math.max(0, Math.min(255, 40 + 215 * Math.max(0, s)));
    }
  }
  return out;
}
