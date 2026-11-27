# Module 1: Network Overview — Methodology, Official Sources & MDIT 2026 Evidence Reference

## 1. Alignment with Central Research Question & RO1

- **Central Research Question:** *“Can Malaysia's railway network keep up with growing passenger demand?”*
- **Research Objective 1 (RO1):** *Analyse historical railway ridership trends and geographical passenger demand distribution across Malaysia.*

Module 1 establishes the **descriptive empirical demand baseline** for the platform:
- Quantifies cumulative national headline passenger rail demand (**1,781,070,919** trips from **1 Jan 2019 to 31 Aug 2026**, 2,800 days across 11 rail series), full-year growth (**+8.24% YoY** in **2025** vs **2024**; **354,935,387** vs **327,900,590**), and equivalent-period partial-year growth (**+4.44% YTD**, Jan–Aug 2026 vs Jan–Aug 2025: **244,973,460** vs **234,566,924**).
- Identifies line-level demand concentration (e.g., **LRT Kelana Jaya** leads cumulative headline volume with **527,722,321** trips / **29.63%** share across 2019–Aug 2026; **MRT Kajang** **469,366,127** / **26.35%**; **LRT Ampang–Sri Petaling** **400,272,303** / **22.47%**).
- Maps station-level monthly boardings across Malaysia across **20 railway service layers** (`7` official Rapid Rail GTFS shapes, `9` KTMB schematic stop-to-stop corridors, and `4` supplementary approximate corridors: ERL Ekspres, ERL Transit, Sabah State Railway, Penang Hill Railway).
- Quantifies observed hourly passenger peaking strictly where hourly data exists (**KTM Komuter**).

**Scope Boundary:** Historical ridership and station boardings measure *observed passenger demand*, not train capacity, occupancy, crowding, or service adequacy. Supply readiness and equity screening are evaluated separately in Module 4 (SP01–SP04).

---

## 2. Peak-Hour Calculation Formula & Verified Methodology

Previously, `module1_geospatial.py` and `NetworkOverview.tsx` hardcoded `07:00–09:00 & 17:00–19:00`. Peak-hour metrics are now **reproducibly calculated** inside `backend/pipelines/module1_geospatial.py` (`compute_komuter_peak_analysis`) directly from official KTM Komuter hourly OD files:

- **Input Files:** `komuter_2023.parquet`, `komuter_2024.parquet`, `komuter_2025.parquet`, and `komuter_2026.csv` (`7,044,721` hourly OD records).
- **Observation Window:** `2023-09-10` to `2026-11-20` (`1,168` continuous calendar days; `0` missing dates; `0` null timestamps or ridership rows).
- **Time Definition:** Hourly buckets `00:00`–`23:00` in local Malaysian operating time (**Asia/Kuala_Lumpur, MYT, UTC+8**).
- **Daily Audit Reconciliation:** OD sums match `ridership_ktmb_daily.csv` (`service == "komuter"`) across all **1,168 / 1,168** overlapping dates with **`max_abs_delta = 0`** trips (sum = `32,867,113` trips over the OD window; `ridership_ktmb_daily.csv` continues 1 day further to `2026-11-21`).
- **Day-Type Classification (ISO 8601):** Using Polars `.dt.weekday()`:
  - Weekdays (`Mon–Fri`, `iso_weekday <= 5`): **835** observed days (mean **30,962.0** trips/day).
  - Weekends (`Sat–Sun`, `iso_weekday >= 6`): **333** observed days (mean **21,062.5** trips/day).
- **Formula:** For cohort $C$ with $N_C$ unique observed dates, mean demand in hour $h \in \{0, \dots, 23\}$ is:
  $$\bar{R}_C(h) = \frac{1}{N_C} \sum_{d \in C} \sum_{o, s} R(d, h, o, s)$$
  Contiguous 2-hour peak windows maximize $\bar{R}_C(h) + \bar{R}_C(h+1)$ over morning (`05:00`–`11:59` start) and evening (`15:00`–`22:59` start):
  - **Weekday Single Peak Hour:** `08:00–09:00` (**3,894.4** avg trips/day; All days: `08:00–09:00` at **3,107.2** trips/day).
  - **Weekday Morning 2h Peak (`7 – 9 AM`):** `07:00–09:00` (**7,560.1** avg trips/day, **24.4%** of weekday Komuter volume; All days: **5,971.8**, **21.2%**).
  - **Weekday Evening 2h Peak:** **`18:00–20:00`** (**7,174.2** avg trips/day, **23.2%** of weekday Komuter volume; All days: **`18:00–20:00`** at **5,956.4**, **21.2%**). *(Empirical data disproves the prior hardcoded `17:00–19:00` assumption: weekday `19:00–20:00` carries `3,670.1` avg trips vs `1,802.7` during `17:00–18:00`.)*
  - **Weekend Single Peak Hour:** `18:00–19:00` (**1,588.3** trips/day), closely matched by midday `11:00–12:00` (`1,571.8`).
- **Missing Hourly Data Rule:** Prasarana Rapid Rail OD (`rapidrail_2026_daily.csv`) is daily-resolution only; Module 1 explicitly attributes peak hours to **KTM Komuter** rather than generalizing Komuter timing to the entire Malaysian rail network.

---

## 3. Official Data Sources, Observation Periods & Licences

### A. Official Malaysian Government / Open Data Sources

| Dataset | Publisher & Source | Observation Period | Granularity & Coverage | Analytical Purpose | Known Limitations & Licence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Daily Headline Ridership (`ridership_headline.csv`) | Prasarana, KTMB & MOT via OpenDOSM ([data.gov.my/data-catalogue/ridership_headline](https://data.gov.my/data-catalogue/ridership_headline)) | `2019-01-01` to `2026-08-31` (`2,800` days) | Daily trips across 11 rail series (excluding bus columns) | Total trips, YoY (`2025` vs `2024`), YTD (`Jan–Aug`), monthly trends, line share ranking | Newer services (`MRT Putrajaya` Jun 2022+, `KTM Komuter` Sep 2023+, `LRT Shah Alam` Jun 2026+) have shorter cumulative spans. Licence: **CC BY 4.0**. |
| KTMB Daily Service Ridership (`ridership_ktmb_daily.csv`) | KTMB via data.gov.my (`ridership_ktmb_daily`) | `2020-10-15` to `2026-11-21` | Daily trips across 5 KTMB services (`ets`, `intercity`, `komuter_utara`, `shuttle_tebrau`, `komuter`) | KTMB service donut breakdown & service YoY (`2025` vs `2024`) | `shuttle_tebrau` begins `2022-06-19`; `komuter` begins `2023-09-10`. Licence: **CC BY 4.0**. |
| KTM Komuter Hourly OD (`komuter_2023..2026`) | KTMB & MOT via OpenDOSM ([data.gov.my/data-catalogue/ridership_od_komuter](https://data.gov.my/data-catalogue/ridership_od_komuter)) | `2023-09-10` to `2026-11-20` (`1,168` days) | Hourly (`00:00`–`23:00` MYT) station-to-station flows | Peak Hour KPI (`AM 07:00–09:00`, `PM 18:00–20:00`) & Komuter station boardings | Covers KTM Komuter (Klang Valley) only; cannot establish Rapid Rail hourly demand. Licence: **CC BY 4.0**. |
| Rapid Rail Daily OD (`rapidrail_2026_daily.csv`) | Prasarana & MOT via OpenDOSM ([data.gov.my/data-catalogue/ridership_od_rapidrail_daily](https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily)) | `2026-01-01` to `2026-11-20` (`5,623,020` rows) | Daily station-origin flows (excludes `A0:` aggregate codes) | Monthly station boardings on Malaysia Rail Atlas (`2026-01`–`2026-08` within scrubber) | Daily resolution only (no hour column); no historical Rapid Rail station OD pre-2026. Licence: **CC BY 4.0**. |
| KTM Intercity & ETS OD (`intercity_2026.csv`) | KTMB via data.gov.my (`intercity` OD) | `2026-01-01` to `2026-11-20` (`177,155` rows) | Hourly station-to-station trips | Monthly station boardings on Rail Atlas (`ic_` prefix) | Foreign stop (`Hat Yai`) & non-Malaysian coordinates filtered out at map render. Licence: **CC BY 4.0**. |
| Prasarana Rapid Rail KL & KTMB Static GTFS | Prasarana & KTMB via data.gov.my Developer API ([developer.data.gov.my/realtime-api/gtfs-static](https://developer.data.gov.my/realtime-api/gtfs-static)) | Snapshot retrieved `2026-11-23` (Rapid Rail) & `2026-11-24` (KTMB) | Official `shapes.txt` (Rapid Rail), `stops.txt`, `trips.txt`, `stop_times.txt` | Official 7 Rapid Rail route shapes, 9 schematic KTMB stop sequences, `verified_station_registry.json` (`288` joins + `22` added stops) | KTMB GTFS omits `shapes.txt` (drawn as stop-to-stop reference lines); represents current routes across all playback dates. Licence: **CC BY 4.0**. |
| Malaysia National & State Geodata | DOSM ([github.com/dosm-malaysia/data-open](https://github.com/dosm-malaysia/data-open/tree/main/datasets/geodata)) | Latest open repository snapshot | `1` national MultiPolygon & `16` state/FT polygons | National map mask, boundary verification, state label anchoring | Simplified administrative polygons for thematic display (non-cadastral). Licence: **CC BY 4.0**. |

### B. Supplementary Non-Official Sources (Visual / Schematic Context Only)

- **OpenFreeMap / OpenStreetMap Vector Tiles** (`https://openfreemap.org/`, **ODbL**): White city building extrusions and base street context when zoomed in (2.5D mode).
- **Curated Reference Corridors & Landmark Massing (`nationalAtlas.ts`, `landmarkModels.ts`):** Approximate schematic corridors for `ERL Ekspres`, `ERL Transit`, `Sabah State Railway`, and `Penang Hill Railway` (all grey stations retain `No data` without invented demand), plus 38 stylized architectural landmark massing models (`Penang Bridge` via Wikipedia reference; `Mount Kinabalu` via Mapcarta reference).

---

## 4. Cross-Module Consistency Notes (Module 1 ↔ Module 2)

- **Shared Headline Source:** Module 1 (`network_overview.json`) and Module 2 (`OdPeakHours` timeline scrubber) both read monthly headline rail totals (`Jan 2019–Aug 2026`).
- **Peak Hour & ISO Weekday Fix Documented:** Module 1 now classifies weekday (`Mon–Fri`, `iso_weekday <= 5`, `835` days) vs weekend (`Sat–Sun`, `iso_weekday >= 6`, `333` days) strictly using ISO weekday numbering (`1=Mon..7=Sun`). During verification, it was noted that Module 2's legacy aggregator (`backend/pipelines/module2_od_aggregation.py`) currently filters `weekday < 5` (accidentally grouping Friday with Sat–Sun), mixes `2023–2026` Komuter totals with `2026`-only Rapid Rail OD in ranking lists, and leaves Time/Day filters inactive. Because Module 2 files are strictly out of scope for this task, **full cross-module reconciliation between Module 1 and Module 2 remains pending Module 2's separate remediation**.

---

## 5. Evidence-Based SDG Contributions (Module 1)

*Note: Figures below describe historical demand and infrastructure usage from open datasets; they do **not** claim verified reductions in CO₂, congestion, crowding, or official UN SDG indicator status.*

| SDG & Target | Supporting Dataset(s) | Verified Module 1 Metric | Observed Analytical Finding | Potential Policy Application | Methodological Limitation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SDG 9 — Target 9.1** *(Reliable, sustainable & resilient infrastructure; relates conceptually to Ind. 9.1.2 passenger volume)* | `ridership_headline.csv`, `ridership_ktmb_daily.csv`, `komuter_2023..2026`, `rapidrail_2026_daily.csv`, GTFS | Cumulative trips (`1.78B`), full-year YoY (`+8.24%` in `2025`), YTD YoY (`+4.44%` Jan–Aug `2026`), line shares (`LRT KJ 29.63%`), Komuter AM/PM peak windows (`07:00–09:00` `24.4%`, `18:00–20:00` `23.2%`) | National rail volume rose strongly through 2025 (`354.9M`) and continued positive growth in Jan–Aug 2026 (`245.0M`), with demand heavily concentrated on **LRT Kelana Jaya (`29.6%`)** and **MRT Kajang (`26.4%`)** and steep weekday peaks on **KTM Komuter**. | Guides APAD/Prasarana/KTMB prioritization of trunk corridor asset resilience and peak-period reliability investments. | Measures boardings and corridor volumes only; lacks train consist capacity, headway delivery logs, and segment load factors (evaluated conditionally in Module 4). |
| **SDG 11 — Target 11.2** *(Complementary: Accessible & sustainable urban transport systems)* | `rapid-rail-gtfs.zip`, `ktmb-gtfs.zip`, `ridership_od_rapidrail_daily`, `dosm` boundaries | Mapped station demand cohorts (`P50` / `P75` / `P90` nearest-rank percentiles), national `20`-layer corridor footprint, separation of `zero` vs `missing` stops (`180` Rapid Rail coordinates + `288` verified station-route joins) | Maps spatial concentration of Klang Valley CBD/suburban high-boarding nodes (`P90` top 10% tier) alongside regional corridor reach across Peninsular Malaysia & Sabah (`No data` preserved for Sabah/ERL/Penang Hill). | Helps urban planners visualize corridors of concentrated passenger reliance vs unmeasured regional corridors before conducting district accessibility screening (Module 4 SP04). | Station point clusters reflect station-origin tap-ins, not walking catchment (`500m` population buffer required by UN Indicator 11.2.1) or modal split. |
| **SDG 16 — Targets 16.6 & 16.10** *(Complementary: Transparent, accountable institutions & public access to information)* | OpenDOSM (`CC BY 4.0`), GTFS Open API, `verified_station_registry.json`, `network-map.test.mjs` | Zero-fabrication missing/zero taxonomy (`28` unmatched legacy records retained transparently, `1,168 / 1,168` Komuter daily reconciliation with `0` error, `17/17` automated atlas checks) | Replaces opaque/hardcoded dashboard statistics (`07:00–09:00 & 17:00–19:00` heuristic) with reproducible code-backed calculations, explicit dataset cutoffs, and machine-verified GTFS provenance. | Provides a reproducible open-data governance reference for public transport reporting agencies. | Bounded by upstream agency publication cutoffs (e.g., lack of hourly timestamps in Rapid Rail public OD feeds). |

---

## 6. Potential Real-World Applications

*(TransitPulse is an academic/competition prototype and has **not** been formally adopted or endorsed by any Malaysian agency.)*

- **APAD (Land Public Transport Agency):** Can monitor multi-year rail recovery (`+8.24%` in `2025`, `+4.44%` Jan–Aug `2026`), compare Rapid Rail vs KTMB regional growth divergence (`KTM Komuter Utara +9.22%` vs `KTM Komuter -17.55%` in `2025`), and flag corridors requiring follow-up timetable or capacity audits.
- **Prasarana (Rapid KL):** Can track cumulative line concentration (`LRT Kelana Jaya 29.6%`, `MRT Kajang 26.4%`, `MRT Putrajaya +15.68%` YoY in 2025, `LRT Shah Alam` post-Jun 2026 ramp-up) and identify `P90` top-decile boarding hubs dynamically by month as input to Module 4 service planning.
- **KTMB:** Can observe multi-service trajectory differences (`ETS`, `Komuter Utara`, `Komuter`, `Shuttle Tebrau`, `Intercity`) and verified MYT weekday bimodal peaks (`07:00–09:00` AM and `18:00–20:00` PM) vs flatter weekend profiles (`Sat–Sun` peak `18:00–19:00` & `11:00–12:00`).
- **Transport & Urban Planners:** Can examine geographic demand imbalances across Peninsular Malaysia and Klang Valley (contrasting high-volume Klang Valley stations against unmeasured regional networks) before drilling down into district socioeconomic equity in Module 4 SP04.
