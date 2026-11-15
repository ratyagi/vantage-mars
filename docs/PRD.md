# PRD: Sightline

Version 0.1, 2026-11-15. Owner: Roo (Rashi Tyagi). Evidence base: SOURCES_AND_CONTEXT.md (read it if any claim here looks unsupported).

## 1. One-line summary
Sightline predicts what a walking Mars astronaut will and will not be able to see from each point on a planned route (habitat, rover, partner, landmarks), flags where low sun or hidden ground will mislead judgment, and proves the predictions by comparing them with what Curiosity actually saw at real stops in the Gale Crater boxwork.

## 2. Problem
- Statement: in terrain whose relief is about eye height, an EV pair cannot know in advance where they will lose sight of the habitat, rover, partner or confirming landmarks. Orbital maps show where things are, not what is visible from the ground.
- Evidence:
  - Boxwork ridges are about 1 to 2 m tall with sandy hollows between (NASA/JPL boxwork release). A suited eye at about 1.6 to 1.7 m inside a hollow sits near or below ridge crests. (The eye-height geometry is my inference, not a published result.)
  - Apollo 14 missed its main geology target near the Cone Crater rim, within roughly 20 to 40 m depending on source, because the rim was not recognizable from the ground (NASA ALSJ and others).
  - Apollo crews misjudged distance and slope; at Apollo 16 a crater wall seen without its floor was judged about 60 degrees when it was under 30 (EPSC 2024). Lunar evidence only.
  - Mars: rover planners report no sense of scale in Mars terrain (JPL, NASA podcast); operator studies show trouble judging distant terrain scale (IEEE); a VR study shows large distance errors in a generic Mars-like scene.
  - BASALT: under latency, the science backroom could not influence the EVA, so the crew must carry their own context.
- Not found: any published measurement of human slope estimation from Mars imagery. This is a research question the project helps answer.

## 3. Users
- Primary: the indoor (IV) crew member who plans and monitors EVAs without real-time Earth help. Uses a habitat tablet.
- Secondary: the EV pair on foot. Uses a glanceable cuff or chest card, not a head-mounted display.
- Reviewer persona: a NASA EVA or flight-operations engineer who asks about validation, uncertainty, standards and suit constraints.

## 4. Goals and non-goals
Goals
- G1: for any drawn route at one hyperlocal site, show per-segment visibility of habitat, rover, partner and named landmarks.
- G2: predict the view from chosen stops at a chosen local time.
- G3: flag perception risks (low sun, hidden ground ahead) with their evidence level shown.
- G4: validate G1 and G2 against real Curiosity panoramas and report numbers, including failures.
- G5: use at least three data kinds (topographic, optical, spectral, thermal, radiation, atmospheric) with source and resolution labeled on every layer.
Non-goals
- Not a general Mars map or a Mars Trek clone.
- Not a global route optimizer, a shelter-time field, or a self-correcting registration engine (prior art exists; see Section 13).
- No head-mounted display design. No claims of flight readiness.
- No fabricated Mars data. If a number is unavailable, the UI says so.

## 5. Product concept
Three core outputs
1. Visibility strip: along the route, per segment, which references are visible (habitat, rover, partner, each landmark) and the bearing and distance to the nearest visible landmark. Blind stretches are marked.
2. Predicted view: rendered terrain view and skyline at a stop, at a chosen local time, with landmarks labeled and "not visible until X m" callouts.
3. Perception flags: (a) low-sun flag, (b) hidden-ground flag where the ground ahead within a set distance is not visible (Apollo 16 pattern), each tagged with its evidence level (lunar-derived or Mars-validated).
Supporting context (kept simple)
- Slope and walkback time per segment, labeled as treadmill-derived for Mars.
- Spectral and thermal layers to pick science stops and to hint at sand-floored hollows.
- Radiation as context only: RAD dose series and computed sky-view fraction, with the measured Butte M12 result stated (about 5 percent dose reduction with 19 percent of sky blocked). It is not presented as shelter.

## 6. Functional requirements
Must (Tier 0)
- FR-1: load a terrain model for one site and display it with an orthoimage basemap.
- FR-2: user draws or loads a route (GeoJSON).
- FR-3: compute line of sight from observer to each reference along the route (default observer height 1.7 m, configurable; partner and rover heights configurable). Heights are assumptions and are shown.
- FR-4: render visibility strip and a blind-segment list.
- FR-5: predicted skyline and shaded view at a selected route point and local time.
- FR-6: every layer shows source product ID, resolution, and stated uncertainty.
Should (Tier 1)
- FR-7: validation page for 3 or more real Curiosity stops: overlay synthetic skyline on the real panorama, show angular error and landmark hit rate.
- FR-8: perception flags with evidence labels.
- FR-9: cuff card view: one glanceable card per next segment (for example "Next 120 m: habitat hidden, partner visible, landmark Butte B bearing 040").
- FR-10: export route and results as GeoJSON for MMGIS or Mars Trek loading.
Could (Tier 2)
- FR-11: 5 to 10 validation stops.
- FR-12: spectral (CRISM) and thermal (THEMIS) layer toggles with science stop picker.
- FR-13: RAD time series and sky-view fraction panel.
- FR-14: rover-scout mode: mark blind segments where a rover should capture a panorama first, and swap in the real image when available.
- FR-15: partner line-of-sight loss alert along the route.

## 7. Data requirements (verify access before relying on any row)
| Need | Candidate source | Use | Status |
|---|---|---|---|
| Terrain | USGS Calef and Parker Gale merged 1 m DEM; or HiRISE DTM used for boxwork (ID DTEEC_001488_1750_001752_1750_U02, from the research report) | viewshed, slope | not downloaded; ID unverified |
| Ortho | USGS Gale merged 25 cm ortho | basemap, landmark picking | not downloaded |
| Ground truth | Curiosity Mastcam and Navcam panoramas (PDS Imaging) | validation | access and release status unverified |
| Rover positions | MMGIS MSL waypoints/traverse JSON, or PDS Analyst's Notebook | stop locations | exact URL unverified (the Perseverance path is known, MSL path is not) |
| Spectral | CRISM maps | science stops | optional |
| Thermal | THEMIS thermal inertia | sand vs bedrock hint | optional |
| Radiation | MSL RAD dose time series (PDS) | context panel | optional |
| Atmosphere / sun | Mars Climate Database or REMS; sun position from Ls and local time | shadow and low-sun flag | optional |
Known uncertainty figures to display (from the research report; excerpts only, not independently verified by me)
- HiRISE DTM vertical precision: a few tens of cm for 1 m DTMs; Gale fine-scale DEM expected precision about 0.06 to 0.14 m; MSL site DTMs slope error at most about 2 degrees RMS.
- HRSC-tied basemaps are only as accurate as MOLA (about 100 m horizontal, about 1 m vertical).
- Rover onboard localization against HiRISE: 0.36 m mean (JPL), worst case 0.93 to 1.07 m depending on source.

## 8. Technical specification
- Viewshed: heightfield ray march from observer eye to each target over the DEM, with a small earth-curvature correction for Mars radius (3389.5 km). Precompute where cheap; compute in-browser for route interaction.
- Landmark continuity: sample route every N m (default 10); count visible named landmarks; report nearest visible landmark bearing and range; blind = zero landmarks and habitat hidden for more than a threshold distance (parameter).
- Hidden-ground flag: along heading, fraction of terrain within D m (default 50) that is not visible from the observer. High fraction triggers the flag.
- Low-sun flag: solar elevation below a threshold (parameter, default 20 degrees). Threshold is a lunar-derived assumption and is labeled so.
- Sun position: computed from site latitude, Ls and local true solar time; checked against local time metadata in real image labels.
- Predicted view: heightfield render from observer position with Lambert shading from sun vector; skyline as elevation angle per azimuth.
- Walkback: segment time from slope and a speed model tied to Artemis planning assumptions (about 2 km/h on level ground; walking slopes up to about 20 degrees); labeled as treadmill/offload-derived for Mars. No field-validated Mars suited speed exists.
- Outputs: GeoJSON (routes, segments, flags), Cloud-Optimized GeoTIFF or PNG tiles for rasters. Every output carries source IDs.
- Hosting: static web app (GitHub Pages) with pre-processed data. Pipeline in Python (GDAL or rasterio, numpy).
- Terrain size: clip to a few km around the boxwork traverse; decide 1 m versus 2 m cell size from file size. State the trade-off in the UI.

## 9. UX
- Habitat planner (tablet): map, route drawing, visibility strip, predicted view panel, layer toggles, validation tab.
- Cuff card: high contrast, large text, at most 3 facts per segment, no animation. Designed to be glanced at in about 10 seconds.
- Display constraint: no head-mounted element. NASA-STD-3001 requires an unencumbered helmet field of regard if helmet or head-mounted displays are provided, and Joint AR asks for modularity. Cuff, chest or habitat display fits both.
- Always visible: data source and resolution for each layer; "assumption" badges on heights, thresholds and speeds.

## 10. Validation and success metrics
Validation procedure
1. Choose 3 stops (Tier 1) up to 5 to 10 (Tier 2) in the boxwork campaign with full panoramas.
2. Place the observer at the recorded rover position at mast height; render skyline and view at the image's local time.
3. Extract the real skyline from the panorama (semi-manual sky/ground boundary).
4. Compare: angular skyline error per azimuth, and landmark visibility predicted versus observed.
Metrics to report (numbers set after first run, not promised in advance)
- Median and 90th percentile skyline angular error (degrees).
- Landmark visibility precision and recall.
- Error versus distance to ridge, to show where the 1 m DEM smooths narrow ridges.
- Later user study (if time): position-estimation error and time-to-confirm, Sightline versus ortho only; slope-estimate error with and without perception flags.
Success definition
- Tier 0 working at one site with labeled sources, plus at least 3 validated stops with honest results, including where predictions failed.

## 11. What NASA reviewers will look for (traceability)
- Real data, cited by product ID, not synthetic terrain.
- Stated uncertainty on every layer and every assumption.
- Validation against real rover ground truth.
- Standards: GeoJSON and tile outputs loadable in MMGIS or Trek; PDS product IDs as provenance.
- Operational realism: IV-first workflow under latency (BASALT); two-person EV assumption (NASEM 2026).
- Suit realism: no head-mounted element.
- Clear scope: what is validated, what is assumed, what is lunar-derived.

## 12. Non-functional requirements
- Offline-capable static bundle (no server needed at use time).
- Provenance file for every dataset: URL, date retrieved, product ID, license or usage note.
- Reproducible pipeline: one command from raw files to site data.
- Performance: route recompute in under a second for a few km.
- Accessibility: contrast and font sizes suitable for the cuff card; no color-only encoding.

## 13. Prior art and what we deliberately do not claim
- Other 2026 hackathon repos (per the research report, excerpt level) already cover: slope routing, walk-back and survival envelopes, DEM error ensembles, O2 budgets, rover street view, helmet HUD, and one replays a real Perseverance drive against slope. Sightline differs by predicting visibility at eye height and validating views, not slopes.
- SEXTANT covers shelter-style walkback from any point.
- Perseverance onboard global localization already reaches sub-meter registration; we reuse the idea for validation, not as a headline.
- Lunar horizon matching for astronaut photos exists (NASA NTRS, AAS 25-358). Our difference: Mars site, eye-height route visibility, validation on real Curiosity stops. Novelty is unproven; I did not find prior art for this exact combination, which is not proof none exists.

## 14. Risks and assumptions
- 1 m DEM may smooth narrow ridges and over-predict visibility. Validation will measure this; the result is a finding.
- Low-sun thresholds come from the Moon; Mars haze may reduce the effect. Keep the evidence label.
- Eye height, rover and partner heights are assumptions.
- Panorama alignment requires correct rover orientation; metadata handling may be fiddly.
- Data access: the cloud shell network is allowlisted; large downloads may need to be fetched from Roo's laptop or browser and placed in the folder.
- Time: the hackathon runs November 14 to 15, and one team repo cites 11:59 PM local on Nov 15 for submission. Confirm the real deadline. Scope to hours.
- Space Apps rules (pre-event work, AI use disclosure, open licensing) must be checked in the 2026 Project Submission Guide and Judging Guide released Nov 13. Follow them.
- Research report numbers are mostly excerpt-level. Re-open the key sources before putting any number in a deliverable.

## 15. Build plan (tiers, adjust to time left)
- T0: data in, DEM and ortho clipped, route, viewshed, visibility strip, predicted skyline, provenance panel.
- T1: validation on 3 stops, perception flags, cuff card, GeoJSON export.
- T2: more stops, spectral, thermal, RAD panel, rover-scout swap, partner alert.
- Write-up and demo in parallel: results table with failures, assumptions list, sources.

## 16. Proposed repo layout
- README.md (problem, results, assumptions, data provenance)
- docs/PRD.md, docs/SOURCES.md
- data/raw (gitignored), data/processed, data/PROVENANCE.md
- pipeline/ (clip, resample, viewshed, skyline, sun, export)
- web/ (map, strip, predicted view, cuff card, validation tab)
- validation/ (stop list, extracted skylines, results.csv, notebooks)
- tests/

## 17. Open questions for Roo
- Final site: Gale boxwork campaign area (recommended) or another site?
- Which tier is realistic with the time left?
- Can you download the DEM, ortho and panoramas from your laptop if the cloud shell cannot reach them?
- Confirm submission deadline and rule requirements from the official guides.
