"""Plot predicted vs image skyline per stop from web/data/validation/results.json.
Run from the repo root: python3 validation/plot_skyline.py"""
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

REAL, PRED, INK, MUTED, GRID = "#2a78d6", "#eb6834", "#1f1f1e", "#6b6a64", "#e6e5e0"
r = json.load(open("web/data/validation/results.json"))
stops = r["stops"]
fig, axes = plt.subplots(len(stops), 1, figsize=(9, 3.1 * len(stops)), constrained_layout=True)
for ax, s in zip(axes, stops):
    cols = sorted(s["columns"], key=lambda c: (c["az"] + 180) % 360)
    def runs(key):
        seg, out, prev = [], [], None
        for c in cols:
            a = (c["az"] + 180) % 360 - 180  # -180..180, north at 0
            if prev is not None and a - prev > 1.0:
                out.append(seg); seg = []
            seg.append((a, c[key])); prev = a
        out.append(seg)
        return out
    for i, seg in enumerate(runs("real_el")):
        ax.plot(*zip(*seg), color=REAL, lw=2, marker="o", ms=3, label="Navcam image (traced)" if i == 0 else None)
    for i, seg in enumerate(runs("pred_el")):
        ax.plot(*zip(*seg), color=PRED, lw=2, label="Vantage DEM prediction" if i == 0 else None)
    a = s["skyline_all"]
    ax.set_title(f"Sol {s['sol']} (site/drive {s['rmc']}): RMSE {a['rmse_deg']:.2f} deg, "
                 f"{a['within_1deg']*100:.0f}% within 1 deg, n = {a['n']}", loc="left", fontsize=10, color=INK)
    ax.set_ylabel("Elevation angle (deg)", color=MUTED, fontsize=9)
    ax.grid(color=GRID, lw=0.8); ax.set_axisbelow(True)
    for sp in ("top", "right"): ax.spines[sp].set_visible(False)
    for sp in ("left", "bottom"): ax.spines[sp].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=8)
    ax.legend(frameon=False, fontsize=8, loc="best")
axes[-1].set_xlabel("Azimuth (deg from north, clockwise; negative = west of north)", color=MUTED, fontsize=9)
fig.suptitle("Skyline: Curiosity Navcam vs Vantage terrain prediction (eye height 2.0 m, no tuning)",
             fontsize=11, color=INK, x=0.01, ha="left")
fig.text(0.01, -0.01, "Images: NASA/JPL-Caltech, MSL raw images. Prediction: web/js/visibility.js skyline() on the USGS 1 m Gale DEM window.",
         fontsize=7, color=MUTED, ha="left")
fig.savefig("web/data/validation/skyline_comparison.png", dpi=130, bbox_inches="tight")
print("ok")
