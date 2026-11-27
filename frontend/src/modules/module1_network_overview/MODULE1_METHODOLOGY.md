# Module 1: Network Overview — Methodology, Official Sources & MDIT 2026 Evidence Reference

## 1. Alignment with Central Research Question & RO1

- **Central Research Question:** *“Can Malaysia's railway network keep up with growing passenger demand?”*
- **Research Objective 1 (RO1):** *Analyse historical railway ridership trends and geographical passenger demand distribution across Malaysia.*

Module 1 establishes the **descriptive empirical demand baseline** for the platform:
- Quantifies cumulative national headline passenger rail demand (**1,781,070,919** trips from **1 Jan 2019 to 31 Aug 2026**, `2,800` days across `11` rail series), full-year growth (**+8.24% YoY** in **2025** vs **2024**: **354,935,387** vs **327,900,590**), and equivalent-period Year-to-Date growth (**+4.44% YTD**, Jan–Aug 2026 vs Jan–Aug 2025: **244,973,460** vs **234,566,924**).
- Identifies line-level demand concentration (**LRT Kelana Jaya** leads cumulative headline volume with **527,722,321** trips / **29.63%** share across 2019–Aug 2026; **MRT Kajang** **469,366,127** / **26.35%**; **LRT Ampang–Sri Petaling** **400,272,303** / **22.47%**).
- Maps station-level monthly boardings across Malaysia across **20 railway service layers** (`7` official Rapid Rail GTFS shapes, `9` KTMB schematic stop-to-stop corridors, and `4` supplementary approximate corridors: ERL KLIA Ekspres, ERL KLIA Transit, Sabah State Railway, Penang Hill Railway) with explicit timeline-aware station data coverage (`0/351` pre-Sep 2023 $\rightarrow$ `KTM Komuter only` Sep 2023–Dec 2025 $\rightarrow$ `300/351` across Rapid Rail, KTM Komuter & Intercity in Aug 2026).
- Quantifies observed hourly passenger peaking strictly where hourly data exists (**KTM Komuter**), driving both the Peak Hour KPI and its 24-hour weekday Mini Bar Chart (`00:00`–`23:00` MYT).

**Scope Boundary:** Historical ridership and station boardings measure *observed passenger demand*, not train capacity, occupancy, crowding, or service adequacy. Increased demand does not by itself prove insufficient capacity. Supply readiness, scheduled headways, LRT3 nominal places, and district equity screening are evaluated separately in Module 4 (SP01–SP04).

---

## 2. Pre-COVID Legacy Four-Line Growth vs. Full 11-Series Network Expansion

Comparing `2019` to `2026` strictly across all `11` headline series conflates organic passenger growth with newly added reporting series (`MRT Putrajaya` Jun 2022+, `KTMB` Oct 2020/Sep 2023+, `LRT Shah Alam` Jun 2026+). To isolate passenger load growth on **continuously operated legacy infrastructure**, `module1_geospatial.py` independently tracks the **four Rapid Rail lines continuously observed since 1 Jan 2019** (`LRT Kelana Jaya`, `LRT Ampang–Sri Petaling`, `MRT Kajang`, `KL Monorail`):

| Metric (`ridership_headline.csv`, 4 Legacy Rapid Rail Lines) | Full Year 2019 (`365d`) | Jan–Aug 2019 (`243d`) | Jan–Aug 2025 (`243d`) | Jan–Aug 2026 (`243d`) | Growth (`Jan–Aug 2026 vs Full 2019`) | Seasonally Comparable Growth (`Jan–Aug 2026 vs Jan–Aug 2019`) |
|---|---:|---:|---:|---:|---:|---:|
| **4-Line Combined Trips** | `236,293,739` | `154,187,119` | `181,552,260` | `185,553,224` | — | — |
| **4-Line Mean Trips / Day** | **647,380.1** | **634,514.9** | **747,128.6** | **763,593.5** | **+17.95% (+18.0%)** | **+20.34%** |
| • `LRT Kelana Jaya` / day | `259,336.9` | `256,134.1` | `245,054.1` | `244,808.2` | `-5.60%` | `-4.42%` |
| • `LRT Ampang–Sri Petaling` / day | `178,485.5` | `175,748.0` | `193,558.7` | `200,355.2` | `+12.25%` | `+14.00%` |
| • `MRT Kajang` / day | `175,213.2` | `170,565.2` | `251,112.8` | `261,579.2` | `+49.29%` | `+53.36%` |
| • `KL Monorail` / day | `34,344.5` | `32,067.6` | `57,403.0` | `56,850.9` | `+65.53%` | `+77.28%` |

- **Distinct Interpretation from Full 11-Service Headline:** Across all `11` rail series, daily average ridership rose from `647,380` (`2019`, when only those 4 lines existed in headline reporting) to `1,008,121` in `Jan–Aug 2026` (`+55.7%`). Even after excluding all post-2019 network additions, the **same four legacy Klang Valley corridors now carry `+18.0%` more daily riders than full-year 2019 (`+20.34%` vs seasonally matched Jan–Aug 2019)**—led by `MRT Kajang` (`+53.36%`) and `KL Monorail` (`+77.28%`). Increasing patronage establishes sustained demand growth without implying proven capacity saturation (evaluated via scheduled departures and nominal LRT3 supply in Module 4 SP01).

---

## 3. Peak-Hour Calculation, Route Aliasing & Station Growth Methodology

### A. KTM Komuter Peak-Hour Calculation
Previously, `module1_geospatial.py` and `NetworkOverview.tsx` hardcoded `07:00–09:00 & 17:00–19:00`. Peak-hour metrics and the 24-hour Card 3 Mini Bar Chart are **reproducibly calculated** inside `backend/pipelines/module1_geospatial.py` (`compute_komuter_peak_analysis`) directly from official KTM Komuter hourly OD files:

- **Input Files:** `komuter_2023.parquet`, `komuter_2024.parquet`, `komuter_2025.parquet`, and `komuter_2026.csv` (`7,044,721` hourly OD records).
- **Observation Window:** `2023-09-10` to `2026-11-20` (`1,168` continuous calendar days; `0` missing dates; `0` null timestamps or ridership rows).
- **Time Definition:** Hourly buckets `00:00`–`23:00` in local Malaysian operating time (**Asia/Kuala_Lumpur, MYT, UTC+8**).
- **Daily Audit Reconciliation:** OD sums match `ridership_ktmb_daily.csv` (`service == "komuter"`) across all **1,168 / 1,168** overlapping dates with **`max_abs_delta = 0`** trips (sum = `32,867,113` trips over the OD window; `ridership_ktmb_daily.csv` continues 1 day further to `2026-11-21`).
- **Day-Type Classification (ISO 8601):** Using Polars `.dt.weekday()` (`1=Mon..7=Sun`):
  - **Weekdays (`Mon–Fri`, `iso_weekday <= 5`):** **835** observed days (`25,853,285` total trips; mean **30,962.0** trips/day).
  - **Weekends (`Sat–Sun`, `iso_weekday >= 6`):** **333** observed days (`7,013,828` total trips; mean **21,062.5** trips/day).
  - **Weekday vs. Weekend Demand Ratio:** Mean weekday volume is **+47.0%** (`1.47×`) higher per day than weekends.
- **Formula:** For cohort $C$ with $N_C$ unique observed dates, mean demand in hour $h \in \{0, \dots, 23\}$ is:
  $$\bar{R}_C(h) = \frac{1}{N_C} \sum_{d \in C} \sum_{o, s} R(d, h, o, s)$$
  Contiguous 2-hour peak windows maximize $\bar{R}_C(h) + \bar{R}_C(h+1)$ over morning (`05:00`–`11:59` start) and evening (`15:00`–`22:59` start):
  - **Weekday Single Peak Hour:** `08:00–09:00` (**3,894.4** avg trips/day; All days: `08:00–09:00` at **3,107.2** trips/day).
  - **Weekday Morning 2h Peak (`7 – 9 AM`):** `07:00–09:00` (**7,560.1** avg trips/day, **24.4%** of weekday Komuter volume; All days: **5,971.8**, **21.2%**).
  - **Weekday Evening 2h Peak:** **`18:00–20:00`** (**7,174.2** avg trips/day, **23.2%** of weekday Komuter volume; All days: **`18:00–20:00`** at **5,956.4**, **21.2%**). Together, weekday `07:00–09:00` and `18:00–20:00` account for **47.6%** (`14,734.3 / 30,962.0`) of average weekday KTM Komuter trips. *(Empirical data refutes the prior hardcoded `17:00–19:00` assumption: weekday `19:00–20:00` carries `3,670.1` avg trips vs `1,802.7` during `17:00–18:00`.)*
  - **Weekend Single Peak Hour:** `18:00–19:00` (**1,588.3** trips/day), closely matched by midday `11:00–12:00` (`1,571.8`).
- **Missing Hourly Data Rule:** Prasarana Rapid Rail OD (`rapidrail_2026_daily.csv`) is daily-resolution only; Module 1 attributes peak hours & the Card 3 24-hour Mini Bar Chart strictly to **KTM Komuter** rather than generalizing Komuter timing nationwide.

### B. Dynamic YTD, Route Aliasing & Station Growth/Ranking
- **Ridership Trend YTD Growth:** Computed dynamically for selected line & playback month `(year, month)` as $[(\text{YTD}_{Y, 1..M} - \text{YTD}_{Y-1, 1..M}) / \text{YTD}_{Y-1, 1..M}] \times 100$. Missing historical months (`line_days == 0`) or partial launch months with uneven coverage are never treated as zero (`YTD N/A` shown when prior-year equivalent baseline is unavailable).
- **Combined-Service & Geographical Route Mapping (`lineMapping.ts`, `railCorridors.ts`, `networkMapData.ts`):**
  - Combined `LRT Ampang–Sri Petaling` highlights both `LRT Ampang` (`shp_AG_0`) and `LRT Sri Petaling` (`shp_PH_0`) routes simultaneously and evaluates percentiles strictly once per unique station (`36` unique stations; zero duplicate counting of `11` shared trunk stops). Selecting individual `LRT Ampang` (`18` stations) or `LRT Sri Petaling` (`29` stations) explores that branch geometrically while labeling headline statistics unmistakably as `Combined LRT Ampang–Sri Petaling` without dividing combined ridership artificially.
  - Equivalent combined handling applies to `KTM Komuter` (`Seremban` + `Port Klang`), `KTM Komuter Utara` (`Ipoh` + `Padang Besar`), and `KTM Intercity` (`Shuttle`, `Ekspres Rakyat Timuran`, `Shuttle Selatan`), while `KTM Shuttle Tebrau` normalizes 1-to-1 to official `KTM Tebrau Shuttle`. Unmeasured corridors (`ERL`, `Sabah State Railway`, `Penang Hill Railway`) retain `No data`.
- **Station Ranking & Average Daily Growth (`module1_station_ridership.py`, `networkMapData.ts`):**
  - Station rank uses competition ranking (`1, 2, 2, 4`) across unique measured stations within scope; unmeasured (`null`) stations are never ranked.
  - All growth comparisons normalize by exact observed days per source-month (`observed_days_by_month`: e.g. `21` days in `2023-09`, `29` days in leap `2024-02`, `28` days in `2025-02`/`2026-02`, `20` days in `2026-11`).
  - **KTM Komuter** displays equivalent-month daily-rate YoY from `2024-09` onward. **Rapid Rail** & **Intercity** OD begin in `2026-01`, so `2026-02+` displays a clearly labelled **within-2026 daily-average comparison vs Jan 2026** (never mislabeled as YoY). Zero/missing baselines (e.g., pre-revenue `LRT Shah Alam` stations `2026-01..2026-07`) suppress percentage growth instead of dividing by zero.
- **MRT Kajang GTFS Registry Fix (`module1_station_registry.py`):** Replaced `'MRT'` with the official Rapid Rail GTFS `route_id` `'KGL'`, resolving all `23` previously unmatched `KG` stations (`311` existing joins total, `0` unmatched Rapid Rail records, `5` legacy non-GTFS Komuter entries preserved transparently).

---

## 4. Official Data Sources, Observation Periods & Licences

### A. Official Malaysian Government / Open Data Sources

| Dataset | Publisher & Source | Observation Period | Granularity & Coverage | Analytical Purpose | Known Limitations & Licence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Daily Headline Ridership (`ridership_headline.csv`) | Prasarana, KTMB & MOT via OpenDOSM ([data.gov.my/data-catalogue/ridership_headline](https://data.gov.my/data-catalogue/ridership_headline)) | `2019-01-01` to `2026-08-31` (`2,800` days) | Daily trips across 11 rail series (excluding bus columns) | Total trips, YoY (`2025` vs `2024`), dynamic YTD (`Jan–Aug` etc.), monthly trends, line share ranking, legacy 4-line 2019 baseline | Newer services (`MRT Putrajaya` Jun 2022+, `KTM Komuter` Sep 2023+, `LRT Shah Alam` Jun 2026+) have shorter spans. Licence: **CC BY 4.0**. |
| KTMB Daily Service Ridership (`ridership_ktmb_daily.csv`) | KTMB via data.gov.my (`ridership_ktmb_daily`) | `2020-10-15` to `2026-11-21` | Daily trips across 5 KTMB services (`ets`, `intercity`, `komuter_utara`, `shuttle_tebrau`, `komuter`) | KTMB service donut breakdown & service YoY (`2025` vs `2024`) | `shuttle_tebrau` begins `2022-06-19`; `komuter` begins `2023-09-10`. Cutoff differs from Headline (`Nov` vs `Aug 2026`). Licence: **CC BY 4.0**. |
| KTM Komuter Hourly OD (`komuter_2023..2026`) | KTMB & MOT via OpenDOSM ([data.gov.my/data-catalogue/ridership_od_komuter](https://data.gov.my/data-catalogue/ridership_od_komuter)) | `2023-09-10` to `2026-11-20` (`1,168` days) | Hourly (`00:00`–`23:00` MYT) station-to-station flows | Peak Hour KPI (`AM 07:00–09:00`, `PM 18:00–20:00`), Card 3 24h bar chart & Komuter station boardings | Covers KTM Komuter (Klang Valley) only; cannot establish Rapid Rail hourly demand. Licence: **CC BY 4.0**. |
| Rapid Rail Daily OD (`rapidrail_2026_daily.csv`) | Prasarana & MOT via OpenDOSM ([data.gov.my/data-catalogue/ridership_od_rapidrail_daily](https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily)) | `2026-01-01` to `2026-11-20` (`5,623,020` rows) | Daily station-origin flows (excludes `A0:` aggregate codes) | Monthly station boardings on Malaysia Rail Atlas (`2026-01`–`2026-08` within scrubber) | Daily resolution only (no hour column); no historical Rapid Rail station OD pre-2026. Licence: **CC BY 4.0**. |
| KTM Intercity & ETS OD (`intercity_2026.csv`) | KTMB via data.gov.my (`intercity` OD) | `2026-01-01` to `2026-11-20` (`177,155` rows) | Hourly station-to-station trips | Monthly station boardings on Rail Atlas (`ic_` prefix) | Foreign stop (`Hat Yai`) & non-Malaysian coordinates filtered out at map render. Licence: **CC BY 4.0**. |
| Prasarana Rapid Rail KL & KTMB Static GTFS | Prasarana & KTMB via data.gov.my Developer API ([developer.data.gov.my/realtime-api/gtfs-static](https://developer.data.gov.my/realtime-api/gtfs-static)) | Snapshot retrieved `2026-11-23` (Rapid Rail) & `2026-11-24` (KTMB) | Official `shapes.txt` (Rapid Rail), `stops.txt`, `trips.txt`, `stop_times.txt` | Official 7 Rapid Rail route shapes, 9 schematic KTMB stop sequences, `verified_station_registry.json` (`311` joins + `22` added stops) | KTMB GTFS omits `shapes.txt` (drawn as stop-to-stop reference lines); represents current routes across all playback dates. Licence: **CC BY 4.0**. |
| Malaysia National & State Geodata | DOSM ([github.com/dosm-malaysia/data-open](https://github.com/dosm-malaysia/data-open/tree/main/datasets/geodata)) | Latest open repository snapshot | `1` national MultiPolygon & `16` state/FT polygons | National map mask, boundary verification, state label anchoring | Simplified administrative polygons for thematic display (non-cadastral). Licence: **CC BY 4.0**. |

### B. Supplementary Non-Official Sources (Visual / Schematic Context Only)

- **OpenFreeMap / OpenStreetMap Vector Tiles** (`https://openfreemap.org/`, **ODbL**): White city building extrusions and base street context when zoomed in (2.5D mode).
- **Curated Reference Corridors & Landmark Massing (`nationalAtlas.ts`, `landmarkModels.ts`):** Approximate schematic corridors for `ERL KLIA Ekspres`, `ERL KLIA Transit`, `Sabah State Railway`, and `Penang Hill Railway` (all grey stations retain `No data` without invented demand), plus 38 stylized architectural landmark massing models (`Penang Bridge` via Wikipedia reference; `Mount Kinabalu` via Mapcarta reference).

---

## 5. Cross-Module Consistency & Observation Cutoffs (Modules 1–4)

Different datasets and precomputed module snapshots reflect legitimate upstream cutoff differences:
- **Module 1 (Network Overview):** Headline rail ridership covers `2019-01-01` to `2026-08-31` (`2,800` days via `ridership_headline.csv`); KTMB daily runs `2020-10-15` to `2026-11-21`; KTM Komuter hourly OD runs `2023-09-10` to `2026-11-20` using strict ISO weekday (`<= 5` Mon–Fri, `>= 6` Sat–Sun); Rapid Rail & Intercity station OD run `2026-01-01` to `2026-11-20`. Notice cross-dataset cutoff consistency: across overlapping dates (`<= 2026-08-31`), all 5 KTMB services in `ridership_ktmb_daily.csv` match `ridership_headline.csv` to **0 trips delta**.
- **Module 2 (OD Flow & Peak Hours — Separate Remediation Pending):** Consumes `network_overview.json`'s `monthly_trend` timeline scrubber cleanly, **but** its legacy pipeline (`backend/pipelines/module2_od_aggregation.py`) currently filters `weekday < 5` (accidentally excluding Friday from weekdays in Polars ISO numbering), mixes multi-year `2023–2026` Komuter pairs with `2026`-only Rapid Rail/Intercity pairs, and retains pre-remediation hardcoded KPI strings (`5:00 PM – 7:00 PM`) in `OdPeakHours.tsx`. Left untouched under Module 1 scope rules; documented for Module 2 remediation.
- **Module 3 (Demand Drivers & Forecasting):** Uses monthly aggregation of the same `ridership_headline.csv` through `2026-08-31` paired with fuel, vehicle registration, and labour-force series.
- **Module 4 (Service Planning & Accessibility — Frozen SP01–SP04 Bundle):** Uses precomputed offline assets extending headline series to `2026-10-31` (`asOf: 2026-11-24`), GTFS scheduled frequencies, LRT3 nominal places (`624`), and DOSM district income/poverty surveys. Module 1 links directly to Module 4 via compact tab navigation (`onNavigateTab('service_planning')`) without duplicating capacity/equity calculations or falsifying historical cutoff alignment.

---

## 6. Evidence-Based SDG Alignment & Applications (Module 1)

*Note: All figures below strictly reflect observed demand, timing, and open-data geometry; they do **not** claim verified reductions in congestion/CO₂, measured train overcrowding, employment causality, or institutional adoption.*

| SDG & Target | Supporting Dataset(s) | Verified Module 1 Metrics & Findings | Methodological Limitation & Honest Caveat |
|---|---|---|---|
| **SDG 9 — Industry, Innovation & Infrastructure** *(Target 9.1 / Conceptual link to Ind. 9.1.2 passenger volume)* | `ridership_headline.csv`, `ridership_ktmb_daily.csv`, `komuter_2023..2026`, `rapidrail_2026_daily.csv`, GTFS | National rail demand grew **+8.24% YoY** in 2025 (`354.9M`) and **+4.44% YTD** in Jan–Aug 2026 (`245.0M`). Crucially, even across the **4 continuous pre-COVID legacy lines**, daily demand is **+18.0% above 2019** (`763.6k` vs `647.4k`/day; **+20.34%** vs Jan–Aug 2019), led by `MRT Kajang` (`+53.4%`) and `LRT Kelana Jaya` (`29.63%` cumulative share). | Measures corridor and station-entry demand only; does not measure rolling stock consist sizes, delivered headways, or segment load factors (evaluated conditionally in Module 4 SP01). |
| **SDG 8 — Decent Work & Economic Growth** *(Commuter travel timing & weekday intensity relevance)* | `komuter_2023..2026` (`7,044,721` hourly OD records across `1,168` days MYT) | KTM Komuter exhibits **+47.0% higher weekday daily volume** (`835` Mon–Fri days mean **30,962.0**/day) compared with weekends (`333` Sat–Sun days mean **21,062.5**/day). Weekday travel concentrates **47.6%** of total daily trips into two bimodal windows: **`07:00–09:00`** (`24.4%`) and **`18:00–20:00`** (`23.2%`), consistent with peak-period commuting windows across Klang Valley. | **Non-causality caveat:** Anonymous tap-in OD data does not record trip purpose; **not all weekday or peak-hour riders are travelling to/from work** (also includes students, retail, personal, and airport transfers). Pair with Module 3 employment correlation (`u_rate`) and Module 4 SP04 income equity for economic context. |
| **SDG 16 — Peace, Justice & Strong Institutions** *(Targets 16.6 & 16.10: Transparent, reproducible public data)* | OpenDOSM (`CC BY 4.0`), GTFS Open API, `verified_station_registry.json`, `network-map.test.mjs`, `module1-kpis.test.mjs` | Zero-fabrication missing vs zero distinction (`20` pre-revenue Shah Alam zeros in Jan–Jul 2026), exact **`1,168/1,168` (`max_abs_delta = 0`)** daily reconciliation, `311` verified GTFS station mappings (`0` unmatched Rapid Rail records after `KGL` fix), explicit branch vs combined attribution, and automated verification checks. | Bounded by upstream agency publication cutoffs and missing Rapid Rail hourly timestamps. |
| **SDG 11 — Sustainable Cities & Communities** *(Target 11.2 Complementary: Spatial transit distribution)* | `rapid-rail-gtfs.zip`, `ktmb-gtfs.zip`, `ridership_od_rapidrail_daily`, DOSM boundaries | Maps spatial concentration across `351` stations and `20` national layers (`P50`/`P75`/`P90` tiers + within-2026 daily-rate momentum), distinguishing high-volume Klang Valley entry hubs from unmeasured reference networks (`Sabah`, `ERL`, `Penang Hill`). | Station origin counts do not measure walking catchment (`500m` UN Ind. 11.2.1 population coverage) or mode share; district accessibility metrics are handled in Module 4 SP04. |

### Potential Real-World Decision Support Applications
*(TransitPulse Malaysia is a competition & research prototype and has **not** been adopted or endorsed by any agency.)*
- **APAD / Ministry of Transport:** Benchmark post-COVID same-network load growth (`+18.0%` vs 2019 on legacy 4 lines) alongside system expansion and flag regional divergence (`Komuter Utara +9.22%` vs `KTM Komuter -17.55%` in 2025) for targeted audit follow-up in Module 4.
- **Prasarana (Rapid KL):** Monitor line concentration (`LRT Kelana Jaya 29.6%`, `MRT Putrajaya +15.68%` YoY), track `LRT Shah Alam` ramp-up (`2026-06-29` launch), and inspect monthly `P90` entry stations (`>347k` in Aug 2026) alongside within-2026 daily momentum.
- **KTMB:** Align weekday shift scheduling and feeder windows with empirically verified bimodal Komuter peaks (`07:00–09:00` AM and **`18:00–20:00`** PM rather than `17:00–19:00`) and contrast weekday peaks with flatter weekend profiles.
- **Urban & Transport Planners:** Contrast dense Klang Valley entry clusters against non-measured regional corridors before drilling into SP04 district socioeconomic equity in Module 4.
