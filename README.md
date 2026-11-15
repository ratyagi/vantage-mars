# Sightline

Predicts what a Mars astronaut can and cannot see along an EVA route (habitat, rover, partner, landmarks) and flags where low sun or hidden ground will mislead judgment. Gale Crater boxwork region, NASA/USGS data. Validation against real Curiosity panoramas is planned and NOT done yet.

## Run it
1. `pip install -r pipeline/requirements.txt`
2. `python pipeline/fetch_terrain_window.py` (reads a ~2.5 km window of the USGS Gale 1 m DEM by HTTP range request, about 150 MB, writes `web/data/`)
3. `cd web && python -m http.server 8000`, open http://localhost:8000
Without step 2 the app shows SYNTHETIC terrain with a red banner. Never treat that as Mars.

## Tests
`node --test tests/core.test.mjs`

## What each output is
- Visibility strip: line of sight from eye height over the DEM, with curvature, to habitat, rover, landmarks and a trailing partner.
- Predicted view: terrain-only panorama for a chosen local solar time (no atmosphere, no rocks smaller than a DEM cell).
- Flags: low sun, ground hidden ahead (Apollo 16 pattern), blind stretches, slope, lost partner. Each shows its evidence level.
- Cuff card: the few numbers to read at a glance.

## Assumptions (all editable in the UI, none validated on Mars)
Eye 1.7 m, low-sun threshold 20 deg (lunar-derived), walk 2 km/h derated to 0 at 20 deg (Artemis planning numbers), sun from geometry only.

## Data
See `data/PROVENANCE.md` and `docs/SOURCES_AND_CONTEXT.md`.
