# Data provenance
- Terrain: USGS Astrogeology MSL Gale DEM mosaic 1 m v3 (GeoTIFF, hosted on the PDS Annex S3 bucket). Read by window; vertical reference differs from rover elevations, see web/data/qa.json.
- Rover waypoints: NASA MMGIS MSL waypoints JSON (mars.nasa.gov/mmgis-maps/MSL), used for the traverse overlay and a DEM sanity check.
- Mars radius for curvature: 3396190 m (value in the DEM product metadata).
- Sun: geometric formula, obliquity 25.19 deg. Not SPICE.
- Synthetic terrain (web/js/terrain.js, tests/make_synthetic_geotiff.py) exists only for development and is labeled in the UI.
