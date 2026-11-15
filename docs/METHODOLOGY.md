# Methodology

How Vantage turns a digital elevation model (DEM) into visibility predictions for a walking crew member. Every formula here is implemented in `web/js/visibility.js` and `web/js/sun.js` and covered by tests in `tests/core.test.mjs`.

## 1. Problem statement

Given a route across Mars terrain, an observer at eye height, and a set of targets (habitat, rover, partner, landmarks), determine for each point on the route which targets are in line of sight, what the terrain skyline looks like, and where perception is likely to be unreliable.

## 2. Conventions

- Local frame: `x` east, `y` south, metres, origin at the north-west corner of the terrain window.
- Elevations in metres. Azimuth in degrees clockwise from north.
- Observer eye height `h_e` and target heights `h_t` are above local ground (the DEM surface).
- Planet radius `R = 3,396,190 m` (value in the USGS product metadata).

## 3. Terrain sampling

- Elevation at an arbitrary point uses bilinear interpolation between the four nearest cell centres. If any neighbour is no-data, the result is no-data and the sample is excluded.
- Slope is the angle of the central-difference gradient: `slope = atan(|grad z|)`. Flags, the slope overlay and walking time evaluate it over a 5 m baseline, closer to the scale of a walker or rover than one 1 m cell, which is sensitive to DEM noise.

## 4. Line of sight

For observer `A` and target `B`, separated by horizontal distance `D`:

1. Observer height: `z_A = z(A) + h_e`. Target top: `z_B = z(B) + h_t - D^2 / (2R)`.
2. Sample the straight sight line at steps of `max(0.5 * cell, 0.5 m)`. At fraction `t` (distance `d = tD`) the sight line height is `z_A + (z_B - z_A) t`.
3. Terrain height at that point, corrected for curvature, is `z(p) - d^2 / (2R)`.
4. Clearance is the sight line height minus corrected terrain height. If clearance is negative anywhere, the target is hidden and the first blocking distance is recorded.

Curvature matters little at EVA scales (about 1.5 mm at 100 m, about 1.3 m at 3 km) but is included so results stay valid for long sight lines to distant landmarks.

## 5. Route products and defaults

- **Default scene (real data):** the route is the Curiosity drive recorded in the boxwork campaign (sols 4605 to 4857, about 1 km), the habitat marker is its start, and the rover marker is the third waypoint. This lets a reviewer see the tool on a real traverse. Any route can be drawn instead.
- **Landmark suggestion:** summits that stand at least 6 m above their surroundings within a 120 m radius, between 40 and 700 m from the route, at least 100 m from the window edge and at least 250 m apart. This is a convenience for demonstrating visibility. Real planning would choose landmarks by science and navigation value.


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

Pattern from Apollo accounts: a crew standing at a crater rim or crest cannot see the ground just beyond it.

- Sample ground points in a cone of 60 degrees centred on the heading, from 4 m to 50 m range.
- Test line of sight from eye height to each ground point (target height 0).
- Report the hidden fraction and the nearest hidden distance. Default flag: hidden fraction above 25 percent.

## 8. Sun geometry

Solar declination from obliquity and solar longitude: `sin(delta) = sin(25.19 deg) * sin(Ls)`. Hour angle `H = (LTST - 12) * 15 deg` for local true solar time `LTST` in hours. Elevation and azimuth follow from the standard spherical-astronomy relations with site latitude.

- This is a geometric model. It does not include the equation of time (not needed because the input is local true solar time), refraction, or dust.
- Expected accuracy is about a degree, adequate for shadow-length and low-sun flagging. It is not a replacement for SPICE ephemerides.

## 9. Mobility

Walking time uses a deliberately simple model: level speed 2 km/h, derated linearly with slope to a floor of 5 percent at the 20 degree planning limit. These are lunar Artemis planning figures. No measured suited-walking speed on natural Martian slopes exists to our knowledge. The number is for comparing routes, not for scheduling.

## 10. Walk-back time and shelter check

- `cumulativeWalkMinutes` integrates the walking-time model of section 9 along the route, giving minutes from the route start to each sample.
- With the solar particle event alert switched on, the walk-back time from the current point is compared with a user-set shelter limit (default 60 min). Over the limit gives a red flag, inside it gives a caution.
- The walk-back is the time to return along the drawn route to its start, which is the habitat in the default scene. This is a time check only. It is not a radiation dose model and it does not use any measured Mars dose rate.

## 11. Terrain shadow

For a point, a ray is marched toward the Sun (azimuth and elevation from section 8) up to 2 km. If the terrain along the ray rises above the Sun's elevation angle, with curvature correction, the point is in terrain shadow. Sun below the horizon counts as shadow. Rays that leave the terrain window are treated as lit, which is a simplification. Object shadows below the DEM cell size are not modeled.

## 12. Position uncertainty

Without GPS, position carries error. `visibilityFraction` tests line of sight from the current point and from eight points on a circle of the assumed position error (default 5 m). A fraction of 1 or 0 means the answer does not depend on that error. A fraction in between means habitat visibility at that point is position-sensitive, and a flag says so. The 5 m error is an assumption, not a measured navigation error.

## 13. Route planner

- Dijkstra over a 5 m grid (coarsened automatically, in steps of 5 m, so the grid stays under about 70,000 cells on long routes) between the route start and end, within a padded bounding box, with eight-neighbour moves.
- Edge cost is estimated walking time using the slope derate of section 9. Cells at or above the slope limit (default 20 degrees) are not passable, except that moves out of the start cell and into the goal cell are allowed so a start on a steep cell still plans.
- If a habitat is set, cells with no line of sight to it cost `1 + w` times more (default `w = 0.5`), so the planner prefers staying in view of it.
- The result is compared with the drawn route on length, walking time, steepest slope and share of samples with the habitat hidden. On the default Curiosity route (about 1068 m) the planner returns about 617 m with a steepest slope of 17 degrees against 39 degrees. The drawn route is the rover's real traverse, which included science stops and was driven by a rover, so this comparison shows what the planner does and is not a judgment of the rover route.
- Unit tests check that the planner crosses a wall only through a gap, returns no route when fully walled, and that a higher visibility weight does not increase time spent out of sight.

## 14. Verdict

The verdict is the worst state among the flags at the current point. Red (HOLD): sun below the horizon, local slope over 20 degrees, nothing used for navigation in view, partner out of sight, or walk-back over the shelter limit during an alert. Amber (CAUTION): low sun, hidden ground ahead, slope over 15 degrees, an upcoming blind stretch, terrain shadow, position-sensitive habitat visibility, or walk-back within the limit during an alert. Otherwise CLEAR. These are rules over the labeled assumptions below. They are not a certified safety determination.

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
| Shelter limit (alert) | 60 min | Planning placeholder | Assumption, editable |
| Planner slope limit | 20 deg | Artemis planning limit for the Moon | Planning figure for the Moon, editable |
| Habitat view weight | 0.5 | Planning choice | Assumption, editable |
| Position error | 5 m | Placeholder | Assumption, editable |
| Planner grid | 5 m, coarser on long routes | Compute/precision trade-off | Fixed |
| Terrain shadow range | 2 km | Compute/precision trade-off | Fixed |
| Planet radius | 3,396,190 m | USGS product metadata | Source value |

Thresholds marked lunar-derived are the main scientific uncertainty. They are exposed in the UI so a user can change them, and results should be read with that in mind.

## What is not modeled

See [LIMITATIONS.md](LIMITATIONS.md).
