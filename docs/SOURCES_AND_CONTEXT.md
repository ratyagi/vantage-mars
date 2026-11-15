# Mars astronaut map: sources and context log

Purpose: this is the grounding document. If the chat drifts, repeats itself, or I suspect I am inventing facts, re-read this file and rebuild from it. Anything not traceable to a line here should be treated as unverified.
Last updated: 2026-11-14

## 1. Project frame (from Roo, highest weight)
- Objective (success parameter for the whole project): create a map, tool, or interface a Mars astronaut could use during a surface exploration mission, using NASA data and tools.
- Must: pick scientific goal and location; layer at least 3 data kinds; astronaut safety first (radiation, suited mobility, carried equipment, obstacle-avoiding route); show point-of-view surface imagery; consider rovers/robots and crew pairs; format is open (habitat display, tablet, helmet HUD, other).
- Rule from Roo: do not just build around the listed ideas. Extract the success criteria behind them and what NASA professionals would want (integration, design, etc.).
- Roo's motivation: a project to be proud of, aiming for excellence and innovation. Winning is a bonus, not the goal. Challenge rules still apply. Numerical success parameters will come later.
- Roo's advice to me: (1) innovation comes from the intersection of fields; (2) consider alternative explanations, not one approach; (3) check my work, keep thoughts short and solutions creative.
- Style: short scannable bullets, concise, direct, no em dashes, no "honest/honestly", flag weak points plainly, explain with examples.

## 2. Confidence key
- READ = I opened and read the page or document text.
- SNIPPET = I only saw a search-result excerpt. Do not lean on details beyond the excerpt.
- EARLIER = gathered earlier in the chat before context was compacted; known from my summary, not re-verified now.
- WEAK = low-quality or secondhand; use only for orientation.

## 3. Sources: Mars data and existing tools (all EARLIER unless noted)
- Mars Trek, trek.nasa.gov/mars/ (READ via browser). Borrowed: it is a Cesium web portal with 21 data products, WMTS tile services, tools (elevation profile, slope, sun angle, crater and rock detection, 3D print, VR, share link). Gap: regional/global focus, no route planner or astronaut-oriented hyperlocal layering found in its menu (verify again before claiming).
- Mars Trek tile API, api.nasa.gov/mars-wmts/catalog and trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars. Borrowed: free tile access for CTX 5 m mosaic and MOLA hillshade 463 m.
- USGS-NASA Planetary Geologic Mapping hub, astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars. Borrowed: standardized geologic maps (I- and SIM-series) as a geology layer.
- JMARS (ASU). Borrowed: free GIS with 1+ TB orbiter data; shows what a desktop planetary GIS already does.
- iMARS web-GIS. Borrowed: coregistered multitemporal image time series for surface change.
- NASA MMGIS rover GeoJSON, mars.nasa.gov/mmgis-maps/M20/Layers/json/ (M20_waypoints, M20_traverse, helicopter flight path). Borrowed: real traverse paths for replaying actual rover drives against our terrain model.
- PDS Analyst's Notebook and PDS Geosciences (pds-geosciences.wustl.edu). Borrowed: traverse data on HiRISE basemaps. MER note (an.rsl.wustl.edu, SNIPPET): uncorrected rover traverses come from wheel counting and are imprecise; PDS made corrected versions.
- HiRISE 25 cm orthomosaics and 1 m DTMs for Jezero and Gale. Borrowed: hyperlocal terrain exists only at select sites.
- MARCI daily global maps, Mars Dust Activity Database (14,974 storm instances), Mars Climate Database (www-mars.lmd.jussieu.fr/mars/info_web/). Borrowed: time-varying atmosphere/dust layers.
- Planetary nomenclature (planetarynames.wr.usgs.gov), NAIF (naif.jpl.nasa.gov). Borrowed: named features, geometry kernels.
- Hedrick et al. expected-drive-velocity maps (slope, rock abundance, terrain type). Borrowed: path cost = distance / expected velocity.
- Human landing site criteria: latitude within +/-50, elevation <= +2 km, ice access, 100 km exploration zones. Borrowed: scale of a mission area (100 km zone) and that MOLA (463 m) is too coarse for hyperlocal slope.
- Open pipeline co-locating Mastcam images with HiRISE via ray projection over a terrain model. Borrowed: feasibility of point-of-view imagery placed on the map.

## 4. Sources: Earth-side inspiration (EARLIER)
- CalTopo: slope-angle shading, custom shading by slope/aspect/elevation, route drawing with gain/distance, offline layers, resolution caveats.
- PeakFinder: offline panorama from a DEM with named peaks. No route planning.
- Strava: heatmaps, popularity-weighted routing, segments.
- Windy / WeatherLayers GL: timeline playback, particle wind animation.
- Google Earth Voyager, Esri story maps: authored guided tours.
- Google Maps: traffic, ETA, Street View, place cards.
- Borrowed idea across these: layers become useful when they drive a decision (route, ETA) and when time can be scrubbed.

## 5. Sources: Mars mission challenges (EARLIER)
- JPL Perseverance operations paper 2026, www-robotics.jpl.nasa.gov/media/documents/2026_RO_AAS_final.pdf. Borrowed: slip above 94% near 20 degrees; Summerland Trail loose slope; tilt limits; AutoNav outage; brake and wheel wear; a 75 m featureless stretch caused 34 visual odometry failures (42% of total); localization to orbital maps done manually; commanding every 1-3 days.
- Science Robotics autonomy paper and global localization paper (JPL). Borrowed: localization to orbital maps is a hard, manual problem.
- Curiosity wheel damage ("test as you fly"), Ingenuity crash over featureless terrain, InSight mole failure and dust-ended mission, Zhurong dust wake failure, Mars Sample Return independent review. Borrowed: terrain texture, dust and surface-property surprises are recurring causes of trouble.
- Excluded: some low-quality blog sources on InSight; disclosed earlier.
- Not obtained: the 2025 IEEE paper on robotics.jpl.nasa.gov failed to load; I used the 2026 paper instead.

## 6. Sources: how NASA builds astronaut traverse and EVA tools (this session, SNIPPET unless noted)
- Artemis Geospatial Data Team capabilities (ntrs.nasa.gov 20230006633). Borrowed: NASA workflow = data fusion, then hazard assessment, then mission planning, with validation; traverse inputs include slope, boulders, line of sight to lander, darkness, rover power and speed.
- Artemis III landing site multi-criteria study (arxiv 2406.19863). Borrowed: criteria set: surface visibility, lander-to-astronaut line of sight, shadow, sunlight, Earth communication.
- Pena-Asensio et al., automated astronaut traverses with minimum metabolic workload (Acta Astronautica 2023; ddd.uab.cat/record/284640 and Universe Today summary). Borrowed: 15 degree slope limit, boulder avoidance, simultaneous temperature, illumination, bearing capacity, lander view; 2 km radius; metabolic cost; atlas of 521 traverses.
- Early Artemis surface navigation (ntrs 20230012314, Gramling). Borrowed: crews were sometimes unsure of location even on easy terrain; reference frame/map consistency required; pre-planned traverses use slope, lander line of sight, illumination.
- Scoville Artemis presentation (ntrs 20210026296). Borrowed: example EVA planning with range limit around lander.
- Slopes along Apollo EVAs (EPSC2024-196). Borrowed: Apollo 16 crew judged a crater wall about 60 degrees when under 30; low sun exaggerates slope; Apollo walked slopes under 15 degrees; Artemis sites differ by about 3400 m elevation vs 150 m for Apollo.
- Oravetz MIT thesis, human estimation of slope, distance, height (dspace.mit.edu 1721.1/47809). Borrowed: slope estimates were larger at low sun and short distance; recommends VR calibration training. Lunar only.
- Apollo 14 navigation debrief (outwardspace blogspot, quoting the technical debrief) (WEAK as a host, but quotes primary debrief). Borrowed: distance easy to misjudge; roughness and undulation surprised crews.
- Lunar surface navigation survey (ntrs 20250000720). Borrowed: Apollo navigation by eye and map; navigation on foot was hard; hazards left to the crew.
- BASALT and tools (PMC6442304, ntrs 20170002363, 20170002364, 20170000363, 20190001439; MIT SEXTANT thesis 1721.1/119309; SEXTANT evaluation core.ac.uk/download/17204791). Borrowed: planning flow science objective -> stations -> route; poor plan forced crew to spend time finding their way; tailor UI by role; SEXTANT predicted traverse time was significantly shorter than actual (n=6).
- NASA EVA tool inventory, STRIVES/LeAP presentation (ntrs 20260001895). Borrowed: SEXTANT, xGDS, Electronic Field Book are "supported analog testing only"; most users are mission control or indoor crew.
- NEREUS adaptive EVA route guidance (SpaceCHI 2025, drops.dagstuhl.de). Borrowed: current route systems rely on static, manually mapped routes from simulated or low-resolution data; cognitive load matters.
- RASAGE onboard EVA decision support (bioastro.ucdavis.edu/rasage). Borrowed: Mars delay up to 20 min removes mission control loop; explainable onboard support.
- NASA human factors article (nasa.gov/?p=972006). Borrowed: modeling found IV workload supporting a Mars EVA at ISS pace was unacceptably high; reliance on crew expertise.
- Feigh/Miller decision support (scientia.global), PersEIDS (ntrs 20230007488), Vera SmartHab (humanfactors.arc.nasa.gov), 2025 HRP communication delay assessment (ntrs 20250000703). Borrowed: shift of safety-critical work from ground to crew as delay grows.
- Joint AR trade study (ntrs 20230010234) and Joint AR ConOps (ntrs 20230016622). Borrowed: baseline requirement that nothing is mounted to the crew's head inside the suit; display modular for any suit. Matters for helmet HUD assumptions.
- Columbia hybrid Mars HUD paper (engrxiv) and UMD Team VISOR report. Borrowed: HUD overlays must not block external view. Student work, treat as ideas not requirements.
- WEAK / excluded: "hot-sitemirror-store.pages.dev" Artemis suit pages and similar mirrors; not used for facts. newspaceeconomy.ca suit pieces: only the generic statement that a HUD is expected; unverified.

## 7. Sources: Mars gaps and hazards (this session, SNIPPET unless noted)
- HiRISE replacement measurement team terms of reference, Aug 2026 (science.nasa.gov hirep-mdt-tor-final.pdf). Borrowed: need imaging of a roughly 100 km radius zone, multi-pass for DTMs; HiRISE needs replenishing.
- ESA SpotLight measurement definition team report (explorationscience.esa.int). Borrowed: 1 m/pixel DTM goal; HiRISE nearing end of life.
- 2015 landing site workshop abstracts (nasa.gov mars-c-abstracts), Planetary Society workshop report, NASA HLS2 overview. Borrowed: HiRISE coverage of candidate zones was a few percent; about 400 HiRISE images for one zone; exploration zone concept (LS, HS, ROIs within 100 km); first explorers limited to about 100 km travel.
- MEPAG goals and SKGs (discovery.larc.nasa.gov 2010 goals; kiss.caltech.edu Banfield slides; ADS 2016 SKG abstract; MPPG/P-SAG). Borrowed: Goal IV human exploration list: surface radiation and dust hazards, dust storm risks, landing site hazards; SKG list includes high-resolution maps of mineral composition and ice depth, SEP at surface over the solar cycle.
- Mars Human Precursor SSG 2005 (corpora.tika govdocs 779875). Borrowed: early request to determine ground-level dust storm meteorology affecting EVA.
- NASEM, A Science Strategy for the Human Exploration of Mars 2026 (nationalacademies.org/read/28594, appendix C only). Borrowed: key gaps in near-surface dust lifting and wind data. I did NOT read the full report.
- NASA Mars science objectives 2026 (science.nasa.gov mep-science-objectives-2026b.pdf). Only the header/structure seen. Do not cite details from it.
- NASA 2025 Moon to Mars architecture update. Only that "architecture-driven data gaps" were introduced; details not read.
- Dust storm sources: forecasting dust storms (astrobiology.nasa.gov), Pieris et al. via Labroots/Universe Today (68% of large storms linked to surface temperature spikes, MRO 15 years), decadal white paper (core.ac.uk 459156741), Goddard global storm piece. Borrowed: models fail to simulate dust storms self-consistently; forecasting is immature; dust devils clean panels.
- Radiation: MSL/RAD NASA page (science.nasa.gov/?p=348225), Hassler et al. 2013 via sci.news, Guo et al. review (Living Reviews, springerlink mirror), Mars SEP dose modeling (arxiv 1705.06763), RAD terrain shielding poster (cpaess.ucar.edu, 2026). Borrowed: GCR surface dose about 0.67 mSv/day; one weak SEP in first 300 sols; SEPs are the big unknown; 10 cm soil shielding helps; crews need space weather forecasts and alarm dosimeters; terrain (cliffs, hills) shielding is being studied.
- Civil engineering white paper (core.ac.uk 519804749). Borrowed: existing Mars data insufficient for engineering, including surface consolidation and geotechnical properties.
- Registration and DEM error: THEMIS controlled mosaics (wufs.wustl.edu psida 6030): uncontrolled offsets 2-4 pixels up to 30; CMU orbital registration correction paper (ri.cmu.edu): misregistration can cause unsafe navigation; LuNaMaps (ntrs 20210024816, 20220008667): seamless navigation maps are manual and DEM error quantification is ongoing; arxiv 2603.17229: typical DEM RMS height 0.3-0.5 m and slope 1.5-2.5 degrees (lunar, secondhand, from a citation inside that paper).

## 8. Sources about the challenge itself (context only)
- Space Apps 2026 page snippets (edeon.sonoma.edu; spacedata.swapniltamse.com), judging guide (spaceappschallenge.org/resources/judging-awards-guide). Borrowed: challenge name "Interplanetary Survival Guide: Martian Map"; criteria are Impact, Creativity, Validity, Relevance, Presentation; Mars Trek WMTS layers and THEMIS day/night mosaics are suggested datasets. Official challenge page was not fetchable. Roo asked me not to optimize for the competition; this is background only.
- Public hackathon repos for the same challenge (GitHub: RISHI-1453, towkir4601, pollob-kumar, ahsanur-official). Used only to see what others build: route drawing, slope, elevation profile, oxygen/time budgets, daylight, some thermal/radiation. Not used as evidence of NASA needs.
- National Geographic piece on the ICA Mars map design competition (47 exploration zones, 200 km wide, "proximal humans"). Borrowed: precedent for cartographic design of astronaut maps; older (about 2015).

## 9. Documented gaps (my synthesis; each traced above)
- G1 hyperlocal data sparse (sec 7 HiRISE items)
- G2 layers misaligned (THEMIS, CMU, LuNaMaps)
- G3 maps lack error bars (LuNaMaps, arxiv 2603.17229)
- G4 human perception errors (Apollo 16, Oravetz, Apollo 14)
- G5 crews get lost (Gramling, Apollo)
- G6 comm delay shifts work onboard (NASA human factors, RASAGE)
- G7 EVA tools are analog-only, built for mission control (STRIVES inventory, NEREUS)
- G8 ground-level dust and wind not forecastable (NASEM, decadal white paper)
- G9 SEPs unmeasured on Mars surface, terrain shielding open (RAD)
- G10 surface strength poorly known (civil engineering paper, Perseverance slip)

## 10. Candidate directions (mine, not evidence)
- Confidence/coverage/registration error as a first-class layer: "how much to trust this map."
- Perception correction: show where the eye will misjudge slope and distance for a viewpoint and sun angle; real landmark views for position confirmation.
- Time-to-shelter field instead of one route; shrinks with a particle or dust alert.
- Alternatives to weigh before committing: (a) ground-truth loop, where each rover image tightens the map; (b) crew-pair role-split views; (c) offline-first planning pack with abort routes; (d) route replay validated against real rover drives.
- Cross-field ideas to explore: aviation terrain awareness (TAWS) and alerting, mountaineering avalanche/aspect-time planning, wildfire evacuation time-to-safety maps, hurricane cone-of-uncertainty graphics, geodesy error ellipses, perceptual psychology.

## 11. Known weak spots
- Gaps G3, G4, G5, G7 lean on lunar evidence; Mars equivalents unverified.
- No Mars HiRISE DTM error numbers yet. Do not state any until found.
- No Mars study on slope perception found.
- Several items are search excerpts only (marked SNIPPET).
- Section 3-5 items are from before compaction and not re-verified.

## 12. Refresh protocol
- If unsure about a fact: find it here, check its confidence tag, and re-fetch the source before using it in a deliverable.
- If a fact is not here, say so and search again.
- Add new sources to the right section with: what I borrowed, confidence tag, date.
- Next research targets: Mars HiRISE DTM vertical accuracy; orbital-to-rover registration offsets at Gale; MSL RAD terrain shielding results; boxwork location data at Mount Sharp; Mars-specific suit mobility and metabolic cost data.

## 13. Deep research report, 2026-11-15 (task wf-fffd441f; report text, excerpt-level confidence unless noted)
All items below come from a research agent's report. I have NOT independently opened them. Re-open before using any number in a deliverable.
- Space Apps 2026 challenges page (spaceappschallenge.org/2026/challenges/): challenge statement wording, "layered, integrated view of a location or route".
- Competitor repos: MONSTER4REX/Martian-Map (read in full by the agent): DEM error ensembles, walk-back, survival envelope, orienteering. Others (Code Huzzlers RISHI-1453, Team Protikriti drive replay on slope map, ARES-SURVIVOR, RedNav HUD, MARSWAY, stoicsatvik/martian, pollob-kumar): prior art only, not evidence of NASA needs.
- Sutton et al. 2022 (mdpi.com/2072-4292/14/10/2403): HiRISE DTM vertical precision few tens of cm for 1 m DTM; MOLA tie about 1.3 m.
- Kirk et al., MSL candidate site DTMs (researchgate 258558174): 0.1 to 0.4 m RMS, at most 2 degrees RMS slope error; 1 mrad tilt.
- Stack et al. 2022 (agupubs 10.1029/2021JE007096) and Siebach and Grotzinger 2014 (10.1002/2013JE004508): Gale DEM precision 0.06 to 0.14 m; boxwork ridge measurement within about 10 cm.
- USGS Gale merged 25 cm ortho and 1 m DEM (astrogeology.usgs.gov): control only as good as MOLA (about 100 m horizontal, 1 m vertical).
- USGS MSR TRN HiRISE mosaic (Jezero): vertical offsets under 2.3 m at 99th percentile; CTX alignment under 10.2 m at 99th.
- JPL Perseverance global localization (researchgate 380564271; robotics.jpl.nasa.gov 2026 IEEE Aero memory workaround paper; theopenreader and ts2.tech secondary coverage, WEAK): 0.36 m mean, max 0.93 (ICRA table) or 1.07 m (2026 paper); operations from Feb 2, 2026.
- Chiodini 2017 (researchgate 318891926) and ALPER SkyM 2025 (sciencedirect S0094576525006186): Mars skyline matching errors tens of meters (MER) vs claimed about 5 m (ALPER, test data unclear).
- Nachon et al. 2020 (researchgate 343556575): Mastcam viewsheds from public datasets, meter-scale error unquantified. Useful method precedent.
- Norcross et al. NASA/TP-2009-214796 walkback test and NTRS 20100017354: suited Mars metabolic cost rises sharply with speed; treadmill data only.
- NASA EVA lunar ConOps (nasa.gov topic_1 eva_lunar_surface_concept_of_operations.pdf): 2 km/h pace, 20 degree slope, 2 km range.
- NASA ALSJ Apollo 14 summary (hq.nasa.gov/alsj/a14/a14.summary.html): Cone Crater rim not recognized within about 30 m. Primary.
- EPSC 2024-196 and researchgate 382006984: Apollo distance and slope misperception (lunar).
- kattrahill.com/lunar-psychophysics: Al Bean 11 degree anecdote. WEAK, personal site.
- NASA podcast On a Mission, how to drive a Mars rover (Vandi Verma): no context or scale in Mars terrain. Primary but anecdotal.
- IEEE novice rover operators' obstacle height perception (researchgate 3412443); Park et al. 2021 VR distance errors (10.3390/app112311510).
- NASA/JPL boxwork releases and space.com coverage: ridges 1 to 2 m tall, hollows sandy, clay on ridges and carbonate in hollows; Stroupe quote about driving ridges versus hollows.
- BASALT papers (PMC6442240, PMC6442241): latency made voice unacceptable; need for precursor imagery; SBT could not influence EVA.
- NASEM 2026 Mars science strategy chapters 5 and 8: human-agent teaming, EVA evaluation, two-crew geophysical surveys.
- NASA-STD-3001 tech brief (ochmo-tb-050-spacesuits.pdf), Joint AR trades papers (NTRS 20230009093, 20230010234), xEVA ConOps, NASA SUITS FY27 mission description: helmet field of regard unencumbered; modular display; map display with crew position; 2D map with live assets.
- Ehresmann et al. 2021 and Guo et al. 2021, 2026 (Butte M12 and later terrain studies): about 5 percent dose reduction with 19 percent sky blocked; albedo about 19 percent of surface dose; later reductions reaching 19 percent at other terrain sites. Peer reviewed, excerpt.
- NTRS monocular horizon navigation and AAS 25-358: lunar horizon matching prior art.
- Open caveats from the report: 2015 HiRISE coverage figure, HiRISE replacement team, THEMIS offsets, 94 percent slip, IV workload model, and the "nothing mounted to head" wording were not re-verified in that pass.
