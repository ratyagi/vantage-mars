# Limitations

Stated plainly so results are read correctly.

## Terrain data
- **Resolution.** The DEM cell is 1 m. Features smaller than a few cells (rocks, small steps, ripples) are invisible to the model. Boxwork ridges (about 1 to 2 m tall) are near the limit of what a 1 m DEM resolves.
- **Registration.** Orbital DEMs are tied to a global reference. A horizontal offset between the DEM and the rover's own position estimate shifts every prediction. [VALIDATION.md](VALIDATION.md) measures it: a 25 m shift raises skyline error from 0.43 to 0.81 deg at one stop.
- **Far horizon is outside the model.** The DEM window is 2.5 km. Where the real skyline is farther away, the predicted skyline and panorama are too low (3 to 6 deg at the one stop measured, looking north across the crater floor). The window-edge flag does not catch this. Treat distant horizons as unvalidated.
- **Waypoint elevations are not independent.** Rover waypoint elevations match the DEM almost exactly, so they confirm georeferencing but cannot reveal DEM error. Only comparison with real camera images (see [VALIDATION.md](VALIDATION.md)) can.
- **Coverage.** Only one 2.5 km window is loaded by default. Larger windows cost more data and memory.

## Perception model
- **Thresholds are lunar-derived.** The low-sun and slope-misjudgment flags rest on Apollo and lunar-simulation evidence. We found no published measurement of human slope estimation from Mars imagery or in Mars gravity. The flags are cautions, not predictions of error size.
- **No atmosphere.** The predicted view has no dust haze, color, or scattering. Real Mars images have lower contrast at distance than this render.
- **Terrain only.** Rocks, shadows from objects, and surface texture are not rendered. Predicted skyline can be validated; fine appearance cannot.

## Mobility and safety scope
- **Walking speed** is a lunar planning figure with a simple slope derate. Suited metabolic cost on Mars terrain is not modeled.
- **Radiation dose, dust storms, thermal limits, consumables** are out of scope. Radiation shielding by terrain was measured at one Mars site and is small there, so terrain should not be treated as shelter. This tool addresses navigation and awareness, not the full EVA hazard set.
- **Planner scope.** The route planner uses the same assumed pace and slope limit, a 5 m grid, and treats the habitat as the only visibility goal. It does not model boulders, soil strength, energy use or consumables, and it does not choose science stops.
- **Shelter reach and clocks** use the same assumed pace as everything else, assume the astronaut walks continuously from the route start, and ignore carrying, rest, suit mobility and any radiation dose. Contours stop at 800 m from the habitat.
- **Dust mode** uses a single optical depth with a uniform scale height. It does not model near-surface dust layers, lifted dust devils, or suit lights. The haze in the predicted view is a depth cue, not a radiative transfer result.
- **Horizon fix** assumes the heading is known, needs the skyline to lie inside the 2.5 km terrain window, and needs a wide enough view. In hollows next to ridges the skyline changes faster than the 20 m search grid, so the fix can miss; the ambiguity check catches the cases we tested but is a heuristic. One real-photo success out of three is a small sample.
- **Verdict confidence** only perturbs position, not the DEM itself or the thresholds.
- **Radio shadow** is geometric line of sight only. It ignores diffraction, ground reflection, Fresnel clearance, antenna pattern and any relay hardware. Relay sites are a siting aid, not a link design.
- **Solar particle event check** is a walk-back time against a user-set limit. It is not a radiation model and uses no measured Mars dose rates.
- **Terrain shadow** is cast by the DEM only, rays leaving the window count as lit, and objects below the DEM cell size cast no shadow.
- **Position uncertainty** uses an assumed error radius, not a measured navigation error.

## Software
- Single-user browser app. No multi-user state, no offline packaging beyond the static files.
- The sun model is geometric and approximate (about 1 degree).
- Results are deterministic for a given terrain and inputs. They are predictions, not measurements, and are validated only as far as [VALIDATION.md](VALIDATION.md) says: skyline within about 0.5 deg at two stops, wrong toward the far horizon at a third. Seven frames at three stops is a small sample. Landmark visibility (not skyline) was not tested directly.
