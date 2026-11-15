# Data

| Data | Provider | Product / endpoint | Resolution | Use in Vantage |
|---|---|---|---|---|
| Topography | USGS Astrogeology Science Center, NASA PDS Annex | `MSL_Gale_DEM_Mosaic_1m_v3` GeoTIFF (Calef and Parker), `asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/` | 1 m per pixel, float32 | Line of sight, skyline, slope, hillshade, predicted view |
| Rover traverse | NASA / JPL MMGIS | MSL waypoints JSON, `mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json` (1389 waypoints through sol 5073 when checked) | per-drive waypoints | Real route to replay; position for validation; sanity check of the DEM |
| Solar geometry | Computed | Solar longitude Ls, local true solar time, obliquity 25.19 degrees | n/a | Sun elevation and azimuth, shading, low-sun flag |
| Slope | Derived | From the DEM | 1 m | Slope overlay, mobility, flags |
| Surface imagery | NASA / JPL, PDS Imaging Node | Curiosity Mastcam and Navcam panoramas | n/a | Validation of predicted skyline (see [VALIDATION.md](VALIDATION.md)) |

## Provenance and control

- The DEM mosaic merges HiRISE-derived terrain with other orbital data. USGS metadata states that the product is controlled to the MOLA global reference, so its absolute position is tied to a coarser dataset than its pixel size. Relative terrain shape over a few hundred metres is far better than the absolute position. This is why the validation measures sensitivity to horizontal offset.
- `web/data/dem.json` records the source product, stated control, retrieval time and window.
- The app shows a provenance table with these fields and the assumptions in use.

## Access and licensing

- NASA and USGS data products are publicly available. Check the provider pages for current terms before redistributing.
- Only the processed window (`web/data/`) is committed. The full DEM is not redistributed.
- The pipeline reads data directly from the provider's server by HTTP range request. It needs no account.

## Reproducing the processed data

```bash
pip install -r pipeline/requirements.txt
python pipeline/fetch_terrain_window.py            # default: window centred on sol 4500+ traverse
python pipeline/fetch_terrain_window.py --center-lonlat 137.38 -4.81 --half-size-m 1250   # custom centre
```

The pipeline prints the window, transfer size and QA summary, and writes `web/data/`.

## Georeferencing check

`web/data/qa.json` compares the DEM with the elevation recorded for each Curiosity waypoint inside the window. On the committed data (160 waypoints) the difference is within about 1 cm at the nearest pixel and about 0.3 m with bilinear sampling. This shows the longitude/latitude to pixel mapping is correct. It is **not** an independent accuracy measurement, because the waypoint elevations appear to come from the same orbital terrain model. Independent checks are in [VALIDATION.md](VALIDATION.md).
