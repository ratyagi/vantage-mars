"""End-to-end test of the terrain pipeline on a small synthetic GeoTIFF.

The fixture mimics the layout of the USGS product (float32, LZW, one row per strip,
Mars equirectangular metres). It exists only to test code paths; it is never shipped as data.
Run: python -m pytest tests/test_pipeline.py   (or: python tests/test_pipeline.py)
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    return r.stdout


def test_pipeline_end_to_end():
    with tempfile.TemporaryDirectory() as td:
        tif, wp, out, raw = (os.path.join(td, n) for n in ("dem.tif", "wp.json", "out", "raw"))
        run([sys.executable, os.path.join(HERE, "make_synthetic_geotiff.py"), tif, wp])
        run([sys.executable, os.path.join(ROOT, "pipeline", "fetch_terrain_window.py"),
             "--dem", tif, "--waypoints", wp, "--out", out, "--raw-dir", raw,
             "--center-lonlat", "137.31", "-4.71", "--half-size-m", "600", "--keep-sol-min", "4300",
             "--synthetic"])
        meta = json.load(open(os.path.join(out, "dem.json")))
        data = np.fromfile(os.path.join(out, "dem.f32"), dtype="<f4")
        assert data.size == meta["width"] * meta["height"]
        assert meta["cell_m"] == 1.0
        assert 0.99 <= meta["valid_fraction"] <= 1.0
        assert meta["synthetic"] is True, "test output must be flagged synthetic"
        assert meta["radius_m"] == 3396190.0
        route = json.load(open(os.path.join(out, "route.json")))
        assert any(w["inside"] for w in route["waypoints"])
        qa = json.load(open(os.path.join(out, "qa.json")))
        assert qa["n_compared"] > 0 and qa["mad_m"] >= 0


if __name__ == "__main__":
    test_pipeline_end_to_end()
    print("pipeline test passed")
