"""
Shared Configuration & Path Utilities for TrafficPulse Backend Pipelines
MDIT: Global Challenge 2026 — TransitPulse Malaysia
"""

from pathlib import Path
import json
from typing import Any

# Base Directory Resolvers
BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent

# Data Directories
RAW_DATA_DIR = BACKEND_DIR / "data" / "raw"
PROCESSED_DATA_DIR = BACKEND_DIR / "data" / "processed"
FRONTEND_DATA_DIR = ROOT_DIR / "frontend" / "src" / "data"

# Ensure directories exist
RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_raw_file(filename: str) -> Path:
    """Return the absolute path to a file in backend/data/raw/."""
    file_path = RAW_DATA_DIR / filename
    if not file_path.exists():
        print(f"[Warning] Raw data file not found at: {file_path}")
    return file_path


def get_processed_file(filename: str) -> Path:
    """Return the absolute path to a file in backend/data/processed/."""
    return PROCESSED_DATA_DIR / filename


def save_frontend_json(data: Any, filename: str, indent: int = 2) -> Path:
    """
    Save lightweight processed aggregate data directly into frontend/src/data/.
    Ensures JSON files can be imported directly in Vite React components.
    """
    out_path = FRONTEND_DATA_DIR / filename
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
    print(f"[Exported] Frontend JSON written successfully: {out_path} ({out_path.stat().st_size / 1024:.2f} KB)")
    return out_path


if __name__ == "__main__":
    print(f"ROOT_DIR:          {ROOT_DIR}")
    print(f"RAW_DATA_DIR:      {RAW_DATA_DIR}")
    print(f"PROCESSED_DATA_DIR:{PROCESSED_DATA_DIR}")
    print(f"FRONTEND_DATA_DIR: {FRONTEND_DATA_DIR}")
