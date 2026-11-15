// Approximate Sun position on Mars from latitude, solar longitude Ls and local true solar time.
// Uses declination from obliquity only (sin d = sin(eps) sin(Ls)). This ignores the equation of time
// because LTST (local TRUE solar time) is the input. Good to roughly a degree for shadow-length use,
// NOT a replacement for SPICE. Azimuth is degrees clockwise from north.

export const MARS_OBLIQUITY_DEG = 25.19;

export function sunPosition(latDeg, LsDeg, ltstHours) {
  const rad = Math.PI / 180;
  const phi = latDeg * rad;
  const sinDec = Math.sin(MARS_OBLIQUITY_DEG * rad) * Math.sin(LsDeg * rad);
  const dec = Math.asin(sinDec);
  const h = (ltstHours - 12) * 15 * rad; // hour angle, negative in the morning
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  let cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(phi)) / (Math.cos(el) * Math.cos(phi) + 1e-12);
  cosAz = Math.max(-1, Math.min(1, cosAz));
  let az = Math.acos(cosAz) / rad; // 0..180 measured from north through east
  if (h > 0) az = 360 - az; // afternoon: west side
  return { elevDeg: el / rad, azDeg: az, declinationDeg: dec / rad };
}
