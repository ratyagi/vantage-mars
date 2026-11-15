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

## 10b. Shelter reach, start-back clocks and radio shadow

- `costField` runs a one-to-all Dijkstra from the habitat on a 5 m grid within 800 m, using the same slope-derated pace as the planner (2 km/h on level ground, 5 percent floor at 20 degrees, steep cells stay walkable at the floor). The result is the fastest walking time home from any cell. The map draws it as contours every 15 min, with the shelter limit in amber. The retrace time along the drawn route is shown beside it.
- `Start back within` is the smallest of: shelter limit minus fastest return (alert on only), `daylightLeftMin` minus fastest return (steps local time forward until the Sun is below 5 degrees or the spot falls in terrain shadow; skipped before noon), and EVA length minus time already walked minus a reserve minus fastest return. Defaults: 360 min EVA, 30 min reserve. All are labeled assumptions and time clocks, not a life-support or dose model. Time used assumes continuous walking from the route start.
- `radioCoverage` tests geometric line of sight between a 3 m habitat mast and a 1.7 m suit antenna at each route sample (2 m steps along the ray) and reports the longest outage. `relaySites` tries candidate sites on a 25 m grid, keeps those that see the habitat mast, and greedily picks the sites that cover the most uncovered samples (relay height 2.5 m). Not a link budget: no diffraction, ground reflection, Fresnel clearance or antenna pattern. Real links can work somewhat beyond geometric line of sight and can fail with marginal clearance.
- Hidden-ground flag now tests a 0.3 m hazard within 25 m ahead (it was a 0 m target within 50 m, which flagged almost every point on the 1 m DEM).

## 10c. Dust, verdict confidence and the MCP server

- Dust: direct sun transmission is `exp(-tau / sin(el))` (Beer-Lambert, plane-parallel). Below 10 percent the app flags that shadows and the sun compass are not usable. Visual range for a 2 percent contrast threshold is `ln(50) H / tau` with an assumed uniform dust scale height H = 11 km; near-surface dust can be denser, so this is an upper bound. The predicted view raises its haze with tau (cosmetic depth cue).
- Verdict confidence: the location-dependent HOLD checks (slope over 20 degrees, nothing in view) are rerun at 8 points on a circle with radius equal to the assumed position error (default 5 m). "Robust" means all 8 agree with the current point.
- MCP server (`mcp/server.mjs`): the same functions as the app, loaded in Node on the same terrain and default scene, exposed as tools over the Model Context Protocol (JSON-RPC over stdio). No network access, no dependencies.

## 10d. Horizon fix (position from the skyline)

- Observation: a list of (azimuth, elevation) skyline samples. Real case: the skyline traced from a Curiosity Navcam frame (validation data), binned to 2 degrees, eye height 2.0 m. Simulated case: a full 360 degree turn at 4 degree steps from the walker's position with 0.5 degree Gaussian noise.
- Heading is assumed known (sun sighting or camera attitude). Mars has no global magnetic field.
- Search: predicted skyline (`skylineAt`, same geometry as `skyline()`) at every cell of a 20 m grid over a 1.2 x 1.2 km box around the habitat; score = RMS difference in degrees (`skylineMismatch`). The 5 best distinct cells are refined on a 4 m grid within 16 m.
- Ambiguity: the fix is called unambiguous when the best fit more than 100 m away is at least 1.5 times worse. This is a heuristic threshold.
- Result on real photos: sol 4748 within 5 m (2 m in the MCP run, which uses a slightly different grid origin); sols 4634 and 4839 fail (far horizon outside the window; about 30 degrees of skyline only).
- Related NASA work: horizon-based navigation for the Moon at NASA Goddard (Yew; Driessen et al. 2024).

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

The verdict is the worst state among the flags at the current point. Red (HOLD): sun below the horizon, local slope over 20 degrees, nothing used for navigation in view, partner out of sight, or the fastest way home over the shelter limit during an alert, or no margin left on the daylight or suit clock. Amber (CAUTION): low sun, hidden ground ahead, slope over 15 degrees, an upcoming blind stretch, terrain shadow, position-sensitive habitat visibility, or walk-back within the limit during an alert. Otherwise NOMINAL (not a safety certification). These are rules over the labeled assumptions below. They are not a certified safety determination.

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
| Hidden-ground flag | above 25 percent of the ground within 25 m ahead hides a 0.3 m hazard | Heuristic | Assumption |
| EVA length / suit reserve | 360 / 30 min | Placeholder; Mars PLSS studies consider 2 to 8 h EVAs | Assumption, editable |
| Light cutoff | Sun below 5 deg or terrain shadow | Heuristic | Assumption |
| Radio heights | mast 3 m, suit 1.7 m, relay 2.5 m | Placeholder | Assumption, editable |
| Shelter reach grid | 5 m, radius 800 m | Compute/precision trade-off | Fixed |
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
