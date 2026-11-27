# TrafficPulse Monorepo

TrafficPulse is an intelligent transit and urban mobility analytics platform cleanly structured for 4 team members to collaborate in parallel without merge conflicts.

## Project Structure

```text
TrafficPulse/
├── frontend/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── module1_network_overview/   # Member 1: Network Overview & Spatial Map
│   │   │   ├── module2_od_peak_hours/      # Member 2: OD Flow & Peak-Hour Analytics
│   │   │   ├── module3_drivers_forecast/   # Member 3: Demand Drivers & Forecasting
│   │   │   ├── module4_service_planning/   # Member 4: Service Planning & Accessibility
│   │   │   ├── module4_whatif_simulator/   # Legacy simulator placeholder (outside navigation)
│   │   │   └── shared/                     # Shared types, Navbar shell, theme, Master Station lookup
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/
│   ├── data/
│   │   ├── raw/                            # Raw data inputs (gitignored)
│   │   └── processed/                      # Cleaned and aggregated outputs (gitignored)
│   ├── pipelines/
│   │   ├── module1_geospatial.py           # Member 1: Geospatial network processing
│   │   ├── module2_od_aggregation.py       # Member 2: Origin-Destination matrix aggregation
│   │   ├── module3_demand_forecast.py      # Member 3: Demand driver feature engineering & forecasting
│   │   ├── module4_simulator_baseline.py   # Member 4: What-if simulation baseline computation
│   │   └── shared_station_mapper.py        # Shared: Master station lookup & ID normalization
│   └── requirements.txt
└── .gitignore                              # Prevents committing large CSV/Parquet files
```

## Getting Started

### Frontend (React + TypeScript)
```bash
cd frontend
npm install
npm run dev
```

### Backend (Python Pipelines)
```bash
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\activate
pip install -r requirements.txt
```

## Malaysia 2.5D Overview map

The Overview uses MapLibre GL with OpenFreeMap/OpenStreetMap vector tiles and
extruded building footprints. No API key is required. The country mask isolates
Malaysia, including Sabah and Sarawak. One **2D / 2.5D** switch applies nationwide;
there are no region-view tabs. In 2D, both landmark models and building
footprints are hidden. In 2.5D, 38 grey landmark models use distinctive architectural silhouettes,
with white OSM blocks around them at city scale. The national atlas places East
Malaysia closer at 70% scale (explicitly labelled, with its distance scale hidden).
Station, route, state and landmark layers share this display-only transform;
zooming to level 9 or selecting a destination restores geographic coordinates. Select a
model to zoom in; city scale adds small white building blocks automatically.
All 20 railway layers retain their checked-in geometry and colours at every zoom,
including the published KTMB shuttle stop sequences. No rail geometry is rerouted
to accommodate decorative landmarks, and no Sarawak railway is invented.
The default national models use 0.8 times the original dimensions (applied once), with
a lighter monochrome palette and land-constrained placement. The default selection
contains 13 landmarks; additional assets remain available in detailed views. Minor
state-label overlap is allowed without shrinking or hiding miniatures. Railway and
station clearance has much greater placement priority than decorative labels. The original
36 detailed models retain identical geometry, materials and scale. Penang Bridge
and Mount Kinabalu add two monochrome models at verified geographic anchors.
Their location references are [Penang Bridge](https://en.wikipedia.org/wiki/Penang_Bridge)
and [Mount Kinabalu](https://mapcarta.com/15859528).
Nearby landmarks appear progressively as the map zooms in, and models expose
their names on hover and in the destination selector. Landmark dimensions are exaggerated at country scale and settle to architectural
massing at city scale; these are not surveyed models. The initial camera fits
both halves of Malaysia to the available panel and refits on resize/fullscreen
until the user pans, zooms or selects a destination. Buildings depend on
internet access, OSM coverage and WebGL. Local station and route data remains
available when the tile service fails. Fullscreen preserves the map controls,
landmarks, route overlays and selected station details.

Rapid Rail geometry and station positions come from the official
[data.gov.my GTFS API](https://developer.data.gov.my/realtime-api/gtfs-static)
(Prasarana, CC BY 4.0). The checked-in `rapid_rail_geometry.json` is a compact
snapshot, not a realtime train feed. Refresh from the repository root with:

```powershell
python backend/pipelines/module1_rail_geometry.py --refresh
```

Without `--refresh`, the pipeline uses `backend/data/raw/rapid-rail-gtfs.zip`
when available. It validates the feed before replacing the previous snapshot.
The atlas displays 20 route/service layers: seven Rapid Rail routes, nine KTMB
services, ERL Ekspres and Transit, Sabah State Railway, and Penang Hill Railway.
KTMB's official feed has no track shapes, so its longest published stop sequence
per service is drawn as a schematic corridor. ERL, Sabah and Penang Hill use
approximate reference corridors, with no invented ridership. All reference
geometry is marked with an asterisk in the map legend. Route geometry represents
the current snapshot at every timeline date, not historical service availability.

Country/state outlines come from [DOSM geodata](https://github.com/dosm-malaysia/data-open/tree/main/datasets/geodata).
Refresh the outlines and KTMB services with:

```powershell
python backend/pipelines/module1_national_context.py --refresh
```

Omit `--refresh` to rebuild from the public-data cache in `backend/data/raw`.
Landmark locations and supplementary corridors are maintained in
`frontend/src/modules/module1_network_overview/nationalAtlas.ts`; grey architectural
massing geometry is in `landmarkModels.ts` in the same directory.

Fixed-size station circles use six categories: teal below P50, yellow from P50,
orange from P75, and red from P90 of positive monthly station boardings within
the selected line. Nearest-rank percentiles include ties; camera changes do not
recalculate the cohort. Hollow circles are recorded zero and grey is missing.
These are origin-trip totals, not occupancy, capacity or realtime crowding.
`Unknown`, `Penalty`, foreign stops and invalid positions are excluded.

The nationwide Klang Valley point represents the **highest observed category**,
not a regional sum. Its tooltip reports measured/eligible station coverage.
Only complete all-zero coverage produces a hollow point. The operational rail
catchment (101.25–102.25 E, 2.45–3.75 N) includes outer commuter terminals and the
airport; it is not an administrative boundary. Clicking it fits the complete
supported catchment in the geographic map. Zoom thresholds 9/8 prevent flicker;
zooming out restores the representative, and direct station selection bypasses it.

High/top stations breathe, top stations have a coordinated expanding ring and
subtle double heartbeat, and hovered/selected routes have a decorative energy
trail along their existing geometry. A shared loop pauses during camera movement,
when the page is hidden, and for reduced-motion preferences. Missing/zero stations
have no demand effects. These effects never represent live train positions.

The station registry joins cached official GTFS `stop_times` to `trips` and matches
existing station identifiers or normalised names, independently of demand data:

```powershell
python backend/pipelines/module1_station_registry.py
```

The checked-in audit has 288 existing-record route mappings and 22 added official
stop records. It retains 28 unmatched legacy records without inventing GTFS route
membership. These counts precede the map's invalid/foreign-stop exclusions.
Unmatched entries are listed in `frontend/src/data/verified_station_registry.json`.
KTMB stations added without a verified ridership join remain **No data**. This
registry does not move existing stations, infer missing observations, or turn
stop-to-stop schematic corridors into surveyed track geometry.

Run the map's geographic, missing-data and style checks with Node 24+:

```powershell
cd frontend
node --test tests/network-map.test.mjs
npm run build
```
