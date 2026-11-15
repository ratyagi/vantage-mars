# Skyline validation

Compares the predicted skyline from `web/js/visibility.js` with skylines traced in real Curiosity Navcam images. Results and discussion: `docs/VALIDATION.md`.

## Files

| File | What it is |
|---|---|
| `image_meta.json` | For each of the 7 frames used: sol, site/drive, image ID, MSL raw image API record ID, CAHVOR camera model (rover frame), rover attitude quaternion. Copied from the MSL raw image API (mars.nasa.gov/api/v1/raw_image_items). |
| `image_rows.txt` | Traced skyline row per sampled column (columns 4, 12, ..., 1020; -1 = not traced). One line per frame, keyed by frame number. |
| `validate.mjs` | Cleans the traces, converts pixels to azimuth and elevation, runs `skyline()` at each rover position, computes metrics and sensitivity, writes `web/data/validation/results.json`. |
| `plot_skyline.py` | Draws `web/data/validation/skyline_comparison.png` from the results. |

## Run

From the repo root:

```
node validation/validate.mjs
python3 validation/plot_skyline.py
```

## How the traces were made

The images were opened in a browser from mars.nasa.gov. For each frame, column ranges where sky is visible above the terrain were chosen by eye. Inside those ranges the boundary was found automatically: either the first sustained brightness drop below the sky, or the strongest bright-above, dark-below edge path. Rows were sampled every 8 px and saved to `image_rows.txt`. The browser computed a checksum of the rows, which was checked after the file was written.

`validate.mjs` then drops samples within 5 px of the frame top, isolated jumps (more than 8 px from the median of their neighbours), vertical ramps from the path tracer (36 px or more between neighbouring samples), and the manual exclusions listed in `EXCLUDE`, each with its reason.

Pixel to direction: CAHVOR inverse (with the radial distortion terms), then the rover attitude quaternion (rover frame to local north-east-down). The script checks the CAHVOR inverse against the forward projection, and the quaternion heading against the waypoint yaw.
