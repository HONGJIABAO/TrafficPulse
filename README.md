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
