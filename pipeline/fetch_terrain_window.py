#!/usr/bin/env python3
"""
Fetch a small window of the USGS Gale 1 m DEM and Curiosity waypoints for Sightline.

What it does
  1. Downloads Curiosity waypoints (NASA MMGIS JSON) and keeps sols >= --sol-min.
  2. Picks a window centered on the waypoints in --sol-min..--sol-max.
  3. Reads ONLY that window of the 3.6 GB GeoTIFF using HTTP range requests.
  4. Writes web/data/dem.f32, dem.json, route.json, qa.json.

Run (from repo root):
    pip install -r pipeline/requirements.txt
    python pipeline/fetch_terrain_window.py

The file is stored one row per strip (LZW), so a window costs about
(window height in rows) x ~60 KB. A 2.5 km window is roughly 150 MB of transfer.
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import urllib.request

import numpy as np
import rasterio
from rasterio.windows import Window

DEM_URL = ("https://asc-pds-services.s3.us-west-2.amazonaws.com/"
           "mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif")
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
MARS_RADIUS_M = 3396190.0  # radius used by the USGS product metadata


def log(*a):
    print("[fetch]", *a, flush=True)


def load_json(src, cache_path=None):
    if os.path.exists(src):
        with open(src, "r", encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(src, headers={"User-Agent": "sightline-mars/0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    if cache_path:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "wb") as f:
            f.write(raw)
    return json.loads(raw)


class Georef:
    """Maps lon/lat (deg, planetocentric, east positive) to DEM pixel coordinates."""

    def __init__(self, ds):
        self.ds = ds
        self.crs = ds.crs
        self.geographic = bool(self.crs is not None and self.crs.is_geographic)
        self._proj = None
        if not self.geographic:
            self._proj = self._build_projector()

    def _build_projector(self):
        # Preferred: let PROJ do the inverse using the file's own CRS.
        try:
            from rasterio.warp import transform as wt
            geod = self.crs.geodetic_crs
            self._wt = wt
            self._geod = geod
            x, y = wt(geod, self.crs, [137.4], [-4.8])
            if all(math.isfinite(v) for v in (x[0], y[0])):
                return "proj"
        except Exception as e:  # noqa: BLE001
            log("PROJ route unavailable, using equirectangular fallback:", e)
        # Fallback: manual equirectangular from the CRS parameters.
        d = self.crs.to_dict()
        self._lat_ts = math.radians(float(d.get("lat_ts", 0.0)))
        self._lon_0 = float(d.get("lon_0", 0.0))
        self._R = float(d.get("a", MARS_RADIUS_M))
        return "eqc"

    def lonlat_to_xy(self, lon, lat):
        if self.geographic:
            return lon, lat
        if self._proj == "proj":
            x, y = self._wt(self._geod, self.crs, [lon], [lat])
            return x[0], y[0]
        x = self._R * math.radians(lon - self._lon_0) * math.cos(self._lat_ts)
        y = self._R * math.radians(lat)
        return x, y

    def lonlat_to_pixel(self, lon, lat):
        x, y = self.lonlat_to_xy(lon, lat)
        col, row = ~self.ds.transform * (x, y)
        return col, row  # fractional pixel coordinates (pixel edges, not centers)


def block_mean(a, step):
    if step == 1:
        return a
    h = (a.shape[0] // step) * step
    w = (a.shape[1] // step) * step
    a = a[:h, :w].reshape(h // step, step, w // step, step)
    with np.errstate(all="ignore"):
        out = np.nanmean(a, axis=(1, 3))
    return out.astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", default=DEM_URL, help="DEM URL or local path")
    ap.add_argument("--waypoints", default=WAYPOINTS_URL, help="MMGIS waypoints URL or local json")
    ap.add_argument("--sol-min", type=int, default=4500, help="first sol to center the window on")
    ap.add_argument("--sol-max", type=int, default=99999)
    ap.add_argument("--keep-sol-min", type=int, default=4300, help="keep waypoints from this sol on")
    ap.add_argument("--half-size-m", type=float, default=1250.0, help="half window size in meters")
    ap.add_argument("--center-lonlat", type=float, nargs=2, metavar=("LON", "LAT"), default=None)
    ap.add_argument("--step", type=int, default=1, help="block-average factor (1 = native 1 m)")
    ap.add_argument("--out", default=os.path.join("web", "data"))
    ap.add_argument("--raw-dir", default=os.path.join("data", "raw"))
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    retrieved = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    # 1. waypoints
    log("loading waypoints")
    wj = load_json(args.waypoints, os.path.join(args.raw_dir, "MSL_waypoints.json"))
    feats = [f["properties"] for f in wj["features"]]
    kept = [p for p in feats if p["sol"] >= args.keep_sol_min]
    center_set = [p for p in feats if args.sol_min <= p["sol"] <= args.sol_max]
    if not center_set and args.center_lonlat is None:
        sys.exit("No waypoints in the sol range and no --center-lonlat given.")
    if args.center_lonlat:
        clon, clat = args.center_lonlat
    else:
        clon = float(np.mean([p["lon"] for p in center_set]))
        clat = float(np.mean([p["lat"] for p in center_set]))
    log(f"{len(feats)} waypoints total, {len(kept)} kept, window center lon={clon:.5f} lat={clat:.5f}")

    # 2. open DEM
    env = rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
        GDAL_HTTP_MULTIPLEX="YES",
        GDAL_HTTP_MAX_RETRY="5",
        GDAL_HTTP_RETRY_DELAY="2",
        VSI_CACHE="TRUE",
        VSI_CACHE_SIZE=str(256 * 1024 * 1024),
    )
    with env, rasterio.open(args.dem) as ds:
        log("DEM size", ds.width, "x", ds.height, "dtype", ds.dtypes[0], "crs:")
        log(ds.crs.to_wkt()[:400] if ds.crs else "NO CRS")
        res = ds.res[0]
        if abs(ds.res[0] - ds.res[1]) > 1e-6:
            sys.exit(f"Non-square pixels {ds.res}; not supported.")
        georef = Georef(ds)
        if georef.geographic:
            sys.exit("DEM CRS is geographic (degrees); expected projected meters.")
        cell_native = res  # meters per pixel in projected units

        ccol, crow = georef.lonlat_to_pixel(clon, clat)
        half_px = int(round(args.half_size_m / cell_native))
        col_off = int(round(ccol)) - half_px
        row_off = int(round(crow)) - half_px
        size = 2 * half_px
        # keep window multiple of step
        size -= size % args.step
        col_off = max(0, min(col_off, ds.width - size))
        row_off = max(0, min(row_off, ds.height - size))
        log(f"window: col_off={col_off} row_off={row_off} size={size} px ({size*cell_native/1000:.2f} km)")
        if not (0 <= ccol < ds.width and 0 <= crow < ds.height):
            sys.exit(f"Center pixel ({ccol:.0f},{crow:.0f}) is outside the DEM. Check CRS handling.")

        # 3. read window
        log("reading window (range requests); this can take minutes")
        band = ds.read(1, window=Window(col_off, row_off, size, size), masked=True)
        dem = np.ma.filled(band.astype(np.float32), np.nan)
        nodata = ds.nodata
        if nodata is not None:
            dem[dem == np.float32(nodata)] = np.nan
        # also treat absurd values as nodata
        dem[(dem < -1e5) | (dem > 1e5)] = np.nan
        dem = block_mean(dem, args.step)
        cell_m = cell_native * args.step
        h, w = dem.shape
        valid = np.isfinite(dem)
        log(f"read {w}x{h}, valid {valid.mean()*100:.1f}%, range {np.nanmin(dem):.1f}..{np.nanmax(dem):.1f} m")

        # 4. waypoints into window-local meters (x east, y south from the NW corner)
        route = []
        for p in kept:
            c, r = georef.lonlat_to_pixel(p["lon"], p["lat"])
            x_m = (c - col_off) * cell_native
            y_m = (r - row_off) * cell_native
            inside = 0 <= x_m < w * cell_m and 0 <= y_m < h * cell_m
            route.append({
                "rmc": p["RMC"], "sol": p["sol"], "lon": p["lon"], "lat": p["lat"],
                "elev_geoid": p.get("elev_geoid"), "yaw": p.get("yaw"),
                "pitch": p.get("pitch"), "roll": p.get("roll"),
                "dist_total_m": p.get("dist_total_m"),
                "x_m": round(x_m, 3), "y_m": round(y_m, 3), "inside": bool(inside),
            })

        # 5. QA: compare DEM height with the rover-reported elevation at each waypoint
        diffs = []
        for rp in route:
            if not rp["inside"] or rp["elev_geoid"] is None:
                continue
            ci = int(rp["x_m"] / cell_m)
            ri = int(rp["y_m"] / cell_m)
            z = dem[ri, ci]
            if np.isfinite(z):
                diffs.append(float(z) - float(rp["elev_geoid"]))
        qa = {"n_compared": len(diffs)}
        if diffs:
            d = np.array(diffs)
            med = float(np.median(d))
            mad = float(np.median(np.abs(d - med)))
            qa.update({
                "median_dem_minus_rover_m": round(med, 3),
                "mad_m": round(mad, 3),
                "p10_m": round(float(np.percentile(d, 10)), 3),
                "p90_m": round(float(np.percentile(d, 90)), 3),
                "note": ("Rover elevation and DEM may use different vertical references; "
                         "the median offset is informational, the spread (MAD) hints at "
                         "horizontal registration and local relief effects. Not a formal accuracy."),
            })
        log("QA:", qa)

        # 6. write
        dem.astype("<f4").tofile(os.path.join(args.out, "dem.f32"))
        meta = {
            "width": int(w), "height": int(h), "cell_m": cell_m,
            "dtype": "float32-le", "nodata": "NaN", "row_order": "north_first",
            "units": "meters", "min": float(np.nanmin(dem)), "max": float(np.nanmax(dem)),
            "valid_fraction": float(valid.mean()),
            "window_center_lonlat": [clon, clat],
            "native_col_off": col_off, "native_row_off": row_off, "step": args.step,
            "source_dem": args.dem, "source_waypoints": args.waypoints,
            "retrieved_utc": retrieved,
            "radius_m": MARS_RADIUS_M,
            "product": "MSL_Gale_DEM_Mosaic_1m_v3 (Calef and Parker, USGS Astrogeology, PDS Annex)",
            "stated_control": ("HRSC controlled to MOLA: about 100 m horizontal and about 1 m vertical "
                               "per USGS metadata; HiRISE parts tied to CTX/HRSC. Local relative accuracy is better."),
            "synthetic": False,
        }
        with open(os.path.join(args.out, "dem.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        with open(os.path.join(args.out, "route.json"), "w", encoding="utf-8") as f:
            json.dump({"waypoints": route, "coordinate_note":
                       "x_m east and y_m south of the window NW corner, in meters"}, f)
        with open(os.path.join(args.out, "qa.json"), "w", encoding="utf-8") as f:
            json.dump(qa, f, indent=2)
        size_mb = os.path.getsize(os.path.join(args.out, "dem.f32")) / 1e6
        log(f"done. dem.f32 = {size_mb:.1f} MB. Open web/index.html through a local server.")


if __name__ == "__main__":
    main()
