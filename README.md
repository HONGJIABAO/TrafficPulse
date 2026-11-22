# TrafficPulse Monorepo

## Project Structure

```text
TrafficPulse/
├── frontend/             # Vite + React + TypeScript frontend
│   ├── public/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
└── backend/              # Python data processing
    ├── data/
    │   ├── raw/          # Raw data inputs
    │   └── processed/    # Cleaned and processed outputs
    └── requirements.txt  # Python dependencies placeholder
```

## Getting Started

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
```
