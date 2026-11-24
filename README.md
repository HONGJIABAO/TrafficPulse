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
Malaysia (including Sabah and Sarawak); **Kuala Lumpur 2.5D** opens the city-scale
building view. Buildings depend on internet access and WebGL; heights can be
estimated where OSM does not have measured heights. Local station and route
data remains available when the tile service fails.

Rapid Rail geometry and station positions come from the official
[data.gov.my GTFS API](https://developer.data.gov.my/realtime-api/gtfs-static)
(Prasarana, CC BY 4.0). The checked-in `rapid_rail_geometry.json` is a compact
snapshot, not a realtime train feed. Refresh from the repository root with:

```powershell
python backend/pipelines/module1_rail_geometry.py --refresh
```

Without `--refresh`, the pipeline uses `backend/data/raw/rapid-rail-gtfs.zip`
when available. It validates the feed before replacing the previous snapshot.
KTM/ETS corridors retain the previous approximate reference geometry and are
marked with an asterisk in the map legend. Route geometry represents the current
snapshot at every timeline date, not historical service availability.

Small red station circles identify the top 10% of positive monthly boardings
within the selected line (90th percentile, including ties). Grey means missing
observations; hollow circles mean recorded zero. These are origin-trip totals,
not capacity, occupancy, unique people, or realtime crowding. `Unknown`,
`Penalty`, foreign stops and invalid positions are excluded from the map and
its station filter. Rail data currently covers Peninsular Malaysia only.

Run the map's geographic, missing-data and style checks with Node 24+:

```powershell
cd frontend
node --test tests/network-map.test.mjs
npm run build
```
