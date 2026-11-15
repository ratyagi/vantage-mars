# Limitations

Stated plainly so results are read correctly.

## Terrain data
- **Resolution.** The DEM cell is 1 m. Features smaller than a few cells (rocks, small steps, ripples) are invisible to the model. Boxwork ridges (about 1 to 2 m tall) are near the limit of what a 1 m DEM resolves.
- **Registration.** Orbital DEMs are tied to a global reference. A horizontal offset between the DEM and the rover's own position estimate shifts every prediction. [VALIDATION.md](VALIDATION.md) measures how sensitive results are to this.
- **Vertical reference.** Rover-reported elevations and the DEM can use different vertical datums. The pipeline reports the offset (`web/data/qa.json`) but does not correct it, because visibility depends on relative terrain, not absolute height.
- **Coverage.** Only one 2.5 km window is loaded by default. Larger windows cost more data and memory.

## Perception model
- **Thresholds are lunar-derived.** The low-sun and slope-misjudgment flags rest on Apollo and lunar-simulation evidence. We found no published measurement of human slope estimation from Mars imagery or in Mars gravity. The flags are cautions, not predictions of error size.
- **No atmosphere.** The predicted view has no dust haze, color, or scattering. Real Mars images have lower contrast at distance than this render.
- **Terrain only.** Rocks, shadows from objects, and surface texture are not rendered. Predicted skyline can be validated; fine appearance cannot.

## Mobility and safety scope
- **Walking speed** is a lunar planning figure with a simple slope derate. Suited metabolic cost on Mars terrain is not modeled.
- **Radiation, dust storms, thermal limits, consumables** are out of scope. Radiation shielding by terrain was measured at one Mars site and is small there, so terrain should not be treated as shelter. This tool addresses navigation and awareness, not the full EVA hazard set.
- **No route optimizer.** The route is user-drawn. The tool evaluates it. It does not search for the best route.

## Software
- Single-user browser app. No multi-user state, no offline packaging beyond the static files.
- The sun model is geometric and approximate (about 1 degree).
- Results are deterministic for a given terrain and inputs. They are predictions, not measurements, and are unvalidated until the results in [VALIDATION.md](VALIDATION.md) say otherwise.
