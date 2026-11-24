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
│   │   │   ├── module4_whatif_simulator/   # Member 4: What-If Service Simulator
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
footprints are hidden. In 2.5D, 36 grey landmark models use distinctive architectural silhouettes,
with white OSM blocks around them at city scale. The national atlas places East
Malaysia closer at 70% scale (explicitly labelled, with its distance scale hidden).
Station, route, state and landmark layers share this display-only transform;
zooming to level 9 or selecting a destination restores geographic coordinates. Select a
model to zoom in; city scale adds small white building blocks automatically.
At national scale, KTMB Shuttle and ERT share the express reference corridor to
avoid zigzags caused by inconsistent published shuttle-stop coordinates; detailed
views retain the source stop sequences.
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

Small red station circles identify the top 10% of positive monthly boardings
within the selected line (90th percentile, including ties). Grey means missing
observations; hollow circles mean recorded zero. These are origin-trip totals,
not capacity, occupancy, unique people, or realtime crowding. `Unknown`,
`Penalty`, foreign stops and invalid positions are excluded from the map and
its station filter. Sabah and other reference-only stations show **No data**.

Run the map's geographic, missing-data and style checks with Node 24+:

```powershell
cd frontend
node --test tests/network-map.test.mjs
npm run build
```
