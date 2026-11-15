# Methodology

How Sightline turns a digital elevation model (DEM) into visibility predictions for a walking crew member. Every formula here is implemented in `web/js/visibility.js` and `web/js/sun.js` and covered by tests in `tests/core.test.mjs`.

## 1. Problem statement

Given a route across Mars terrain, an observer at eye height, and a set of targets (habitat, rover, partner, landmarks), determine for each point on the route which targets are in line of sight, what the terrain skyline looks like, and where perception is likely to be unreliable.

## 2. Conventions

- Local frame: `x` east, `y` south, metres, origin at the north-west corner of the terrain window.
- Elevations in metres. Azimuth in degrees clockwise from north.
- Observer eye height `h_e` and target heights `h_t` are above local ground (the DEM surface).
- Planet radius `R = 3,396,190 m` (value in the USGS product metadata).

## 3. Terrain sampling

- Elevation at an arbitrary point uses bilinear interpolation between the four nearest cell centres. If any neighbour is no-data, the result is no-data and the sample is excluded.
- Slope is the angle of the central-difference gradient over one cell: `slope = atan(|grad z|)`.

## 4. Line of sight

For observer `A` and target `B`, separated by horizontal distance `D`:

1. Observer height: `z_A = z(A) + h_e`. Target top: `z_B = z(B) + h_t - D^2 / (2R)`.
2. Sample the straight sight line at steps of `max(0.5 * cell, 0.5 m)`. At fraction `t` (distance `d = tD`) the sight line height is `z_A + (z_B - z_A) t`.
3. Terrain height at that point, corrected for curvature, is `z(p) - d^2 / (2R)`.
4. Clearance is the sight line height minus corrected terrain height. If clearance is negative anywhere, the target is hidden and the first blocking distance is recorded.

Curvature matters little at EVA scales (about 1.5 mm at 100 m, about 1.3 m at 3 km) but is included so results stay valid for long sight lines to distant landmarks.

## 5. Route products

- **Resampling:** the drawn polyline is resampled at 10 m spacing with cumulative distance `s` and local heading.
- **Visibility strip:** for each sample and each target, line of sight is evaluated. Rows are rendered per target along `s`.
- **Partner:** a second observer trails the walker by a set gap along the route (default 30 m). Visibility of the partner from the walker uses the same line-of-sight test.
- **Blind stretch:** a contiguous run of route samples where none of the habitat, rover or landmark targets is visible, at least `blindMin` metres long (default 20 m).

## 6. Predicted view

For each image column (azimuth), a ray is marched outward from the observer. A running maximum of elevation angle `atan2(z - z_A - d^2/2R, d)` is kept. Whenever a terrain sample exceeds the running maximum, the column segment between the old and new angle is painted with that sample's shade, so near terrain correctly occludes far terrain (painter's algorithm in angle space).

- Shading: Lambertian, using the DEM surface normal and the Sun direction for the chosen time.
- Depth cue: a mild lightening with distance. This is a visual aid, not an atmospheric model.
- The white skyline overlay is the maximum-angle profile per column, which is also computed independently by `skyline()`. A unit test checks that both agree.

## 7. Hidden ground ahead

Pattern from Apollo 16 and 14 debriefs: a crew standing at a crater rim or crest cannot see the ground just beyond it.

- Sample ground points in a cone of 60 degrees centred on the heading, from 4 m to 50 m range.
- Test line of sight from eye height to each ground point (target height 0).
- Report the hidden fraction and the nearest hidden distance. Default flag: hidden fraction above 25 percent.

## 8. Sun geometry

Solar declination from obliquity and solar longitude: `sin(delta) = sin(25.19 deg) * sin(Ls)`. Hour angle `H = (LTST - 12) * 15 deg` for local true solar time `LTST` in hours. Elevation and azimuth follow from the standard spherical-astronomy relations with site latitude.

- This is a geometric model. It does not include the equation of time (not needed because the input is local true solar time), refraction, or dust.
- Expected accuracy is about a degree, adequate for shadow-length and low-sun flagging. It is not a replacement for SPICE ephemerides.

## 9. Mobility

Walking time uses a deliberately simple model: level speed 2 km/h, derated linearly with slope to a floor of 5 percent at the 20 degree planning limit. These are lunar Artemis planning figures. No measured suited-walking speed on natural Martian slopes exists to our knowledge. The number is for comparing routes, not for scheduling.

## Assumption register

| Parameter | Default | Basis | Status |
|---|---|---|---|
| Eye height | 1.7 m | Typical standing suited crew eye height | Assumption, editable |
| Partner height | 1.7 m | Same | Assumption |
| Partner gap | 30 m | Planning choice | Assumption, editable |
| Habitat height | 3 m | Placeholder | Assumption, editable |
| Rover height | 2.5 m | Placeholder | Assumption |
| Landmark height | 2 m | Placeholder | Assumption, editable |
| Low-sun flag | below 20 deg | Apollo-era evidence that low sun exaggerates slope | Lunar-derived, editable |
| Slope caution / limit | 15 / 20 deg | Apollo traverses stayed under 15 deg; Artemis planning limit 20 deg | Planning figures for the Moon |
| Walking speed | 2 km/h, derated | Artemis EVA concept of operations | Planning figure for the Moon |
| Hidden-ground flag | above 25 percent hidden | Heuristic | Assumption |
| Blind stretch minimum | 20 m | Heuristic | Assumption, editable |
| Route sample spacing | 10 m | Compute/precision trade-off | Fixed |
| Planet radius | 3,396,190 m | USGS product metadata | Source value |

Thresholds marked lunar-derived are the main scientific uncertainty. They are exposed in the UI so a user can change them, and results should be read with that in mind.

## What is not modeled

See [LIMITATIONS.md](LIMITATIONS.md).
