# Validation

Validation answers one question: **does the terrain-only predicted view match what a real Mars surface camera saw from the same place?**

## Hypotheses

- **H1.** At a known rover position, the predicted skyline elevation profile agrees with the skyline extracted from a real panorama to within a small angular error.
- **H2.** Landmarks the model calls visible are visible in the real panorama, and landmarks it calls hidden are hidden.
- **H3.** Prediction quality degrades gracefully with horizontal position error. We report how fast.

## Protocol

1. Choose 3 Curiosity stops in the boxwork campaign with a wide Mastcam or Navcam panorama and a known rover position (MMGIS waypoint).
2. For each stop, set the observer at the rover position, eye height at camera mast height (about 2.0 m for Mastcam), and render the predicted skyline for the panorama's azimuth range.
3. Extract the real skyline from the panorama (terrain/sky boundary) and convert pixel rows to elevation angle using the camera model and mast pitch.
4. Select 5 to 10 landmarks per stop that are identifiable in both the DEM (distinct high points) and the image. Record whether each is visible in reality.
5. Repeat the prediction with the observer shifted by 0, 5, 10 and 25 m in each horizontal direction to measure sensitivity to registration error.

## Metrics

| Metric | Definition |
|---|---|
| Skyline RMSE | Root-mean-square difference, in degrees of elevation angle, between predicted and real skyline across the azimuth range. |
| Within 1 and 2 degrees | Fraction of azimuth columns where the absolute error is under 1 or 2 degrees. |
| Landmark precision and recall | Over the chosen landmarks, with "visible" as the positive class. |
| Sensitivity | Change in skyline RMSE and landmark F1 versus horizontal offset. |

## Results

Results are added here as they are produced. Until a row is filled in, treat predictions at that stop as unvalidated.

| Stop | Sol | Azimuth range | Skyline RMSE (deg) | Within 1 deg | Within 2 deg | Landmark precision | Landmark recall |
|---|---|---|---|---|---|---|---|
| 1 | | | pending | | | | |
| 2 | | | pending | | | | |
| 3 | | | pending | | | | |

## Threats to validity

- The DEM cell (1 m) limits what small relief can be matched.
- The real skyline includes rocks and shadows that a bare-earth DEM does not.
- Rover position is itself an estimate (wheel odometry corrected by visual and orbital localization).
- Camera pointing and pixel-to-angle conversion add error.
- Three stops is a small sample. Results show feasibility, not a general accuracy claim.
