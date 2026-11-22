# TrafficPulse — Data Directory & Pipeline Guide
**MDIT: Global Challenge 2026 — TransitPulse Malaysia (Smarter Rail Mobility)**

This directory manages the data lifecycle between raw dataset ingestion, Python aggregation pipelines, and frontend consumption.

---

## 1. Directory Structure

```text
TrafficPulse/
├── backend/
│   ├── data/
│   │   ├── raw/                  <-- DROP ALL 17 RAW DATASETS HERE (*.csv, *.parquet)
│   │   │   ├── rapidrail_2026_daily.csv   (>333MB, NOT tracked by git)
│   │   │   ├── *.parquet                  (Hourly OD files, NOT tracked by git)
│   │   │   └── external/ or *.csv         (Fuel, labor force, vehicle registrations, etc.)
│   │   │
│   │   └── processed/            <-- INTERMEDIATE BACKEND OUTPUTS
│   │       └── *.parquet, *.pkl           (Cached features & heavy tables, NOT tracked by git)
│   │
│   └── pipelines/                <-- PYTHON ETL & ML SCRIPTS
│       ├── config.py             (Shared paths: RAW_DIR, PROCESSED_DIR, FRONTEND_DATA_DIR)
│       ├── module1_geospatial.py
│       ├── module2_od_aggregation.py
│       ├── module3_demand_forecast.py
│       ├── module4_simulator_baseline.py
│       └── shared_station_mapper.py
│
└── frontend/
    └── src/
        └── data/                 <-- LIGHTWEIGHT PROCESSED JSONs (TRACKED BY GIT)
            ├── stations.json
            ├── network_overview.json
            ├── od_summary.json
            ├── forecast_demand.json
            └── simulator_baseline.json
```

---

## 2. Where to Place Your Files

| File Type / Content | Destination Path | Tracked in Git? | Reason |
| :--- | :--- | :---: | :--- |
| **Large Raw File (1 file)**<br>• `rapidrail_2026_daily.csv` (333MB+) | `backend/data/raw/` | **NO** (`.gitignore`) | Exceeds GitHub's hard **100MB file limit**. |
| **Small/Medium Raw Datasets (16 files)**<br>• Hourly OD Parquet files (`komuter_2023..2025.parquet`, `population_district.parquet`, etc.)<br>• External drivers & KTMB tables (`fuelprice.csv`, `air_pollution.csv`, `komuter_2026.csv`, etc.) | `backend/data/raw/` | **YES** (Tracked in Git) | Under 100MB. Tracked so all team members have immediate access to raw drivers and OD samples without manual transfer. |
| **Intermediate Pipeline Cache**<br>• Temporary parquet tables & model checkpoints | `backend/data/processed/` | **NO** (`.gitignore`) | Heavy temporary files generated during Python execution. |
| **Final Lightweight Web Assets**<br>• Station lookups (`stations.json`)<br>• Summary metrics & chart data (`*.json`) | `frontend/src/data/` | **YES** (Tracked) | Allows UI developers (Members 1–4) to run `npm run dev` and work on the dashboard without needing Python! |

---

## 3. Team Collaboration Guidelines
1. **Never commit raw files:** Every member drops their own copy of the raw dataset into `backend/data/raw/`.
2. **Deterministic Outputs:** Run Python pipeline scripts (`python backend/pipelines/moduleX_...py`) to aggregate raw data and write compact JSONs directly to `frontend/src/data/`.
3. **Commit Processed JSONs:** When pipelines produce updated `frontend/src/data/*.json`, commit those so team members immediately have the latest figures for UI development.
