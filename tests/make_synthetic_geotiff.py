"""
Make a small SYNTHETIC GeoTIFF and fake waypoints to test the pipeline offline.
Mimics the USGS product layout: float32, LZW, one row per strip, Mars equirectangular meters.
This is test scaffolding only. Its output must never be shown as real Mars data.
"""
import json
import math
import sys

import numpy as np
import rasterio
from rasterio.transform import from_origin

R = 3396190.0
out_tif = sys.argv[1] if len(sys.argv) > 1 else "synthetic_dem.tif"
out_json = sys.argv[2] if len(sys.argv) > 2 else "synthetic_waypoints.json"

lat_ts = -4.6
lon0 = 137.4
crs = f"+proj=eqc +lat_ts={lat_ts} +lat_0=0 +lon_0={lon0} +x_0=0 +y_0=0 +a={R} +b={R} +units=m +no_defs"

# upper-left corner at lon 137.30, lat -4.70
def xy(lon, lat):
    return R * math.radians(lon - lon0) * math.cos(math.radians(lat_ts)), R * math.radians(lat)

x0, y0 = xy(137.30, -4.70)
W, H = 3000, 3000
transform = from_origin(x0, y0, 1.0, 1.0)

rng = np.random.default_rng(1)
yy, xx = np.mgrid[0:H, 0:W].astype("float32")
z = -3600 + 0.01 * xx + 0.005 * yy
for cx, cy in [(800, 900), (1500, 1400), (2100, 700), (1200, 2200)]:
    z += 18 * np.exp(-(((xx - cx) / 90) ** 2 + ((yy - cy) / 40) ** 2))  # ridges
z += rng.normal(0, 0.05, z.shape).astype("float32")

with rasterio.open(out_tif, "w", driver="GTiff", width=W, height=H, count=1, dtype="float32",
                   crs=crs, transform=transform, compress="lzw", blockysize=1, tiled=False) as dst:
    dst.write(z, 1)

# waypoints along a diagonal inside the raster
feats = []
for i in range(40):
    lon = 137.305 + i * 0.0006
    lat = -4.705 - i * 0.0006
    feats.append({"type": "Feature", "properties": {
        "RMC": f"1_{i}", "sol": 4400 + i * 5, "lon": lon, "lat": lat, "elev_geoid": -3600.0,
        "yaw": 0.0, "pitch": 0.0, "roll": 0.0, "dist_total_m": i * 40.0}, "geometry": None})
with open(out_json, "w") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f)
print("wrote", out_tif, out_json)
