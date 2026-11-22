"""
shared_station_mapper.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module: Shared Station Mapper
Output: frontend/src/data/stations.json

Extracts unique station names across rapidrail_2026_daily.csv (excluding A0),
komuter_2026.csv, komuter_2023-2025.parquet, and intercity_2026.csv,
mapped to their respective rail services/lines.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import polars as pl
from config import RAW_DATA_DIR, save_frontend_json

RAPID_RAIL_LINE_MAP = {
    "AG": "LRT Ampang–Sri Petaling",
    "KJ": "LRT Kelana Jaya",
    "MR": "Monorail",
    "MK": "MRT Kajang",
    "PY": "MRT Putrajaya",
    "SA": "LRT Shah Alam",
}


def parse_rapid_station(code_name: str) -> dict:
    """Parse 'XX01: Station Name' into {code, line, name}."""
    code_name = code_name.strip()
    if ": " in code_name:
        code, name = code_name.split(": ", 1)
        prefix = "".join(c for c in code if c.isalpha())
        line = RAPID_RAIL_LINE_MAP.get(prefix, "Rapid Rail")
        return {"code": code, "name": name.strip(), "line": line, "source": "rapidrail"}
    return {"code": code_name, "name": code_name, "line": "Rapid Rail", "source": "rapidrail"}


def main():
    stations = {}

    # 1. rapidrail_2026_daily.csv — exclude A0: All Stations
    print("[Station Mapper] Reading rapidrail_2026_daily.csv ...")
    rr = pl.scan_csv(RAW_DATA_DIR / "rapidrail_2026_daily.csv")
    rr_stations = (
        rr.select([
            pl.concat_str([pl.col("origin")]).alias("station"),
        ])
        .filter(~pl.col("station").str.starts_with("A0:"))
        .unique()
        .collect()
        .get_column("station").to_list()
    )
    rr_dest = (
        rr.select([pl.col("destination").alias("station")])
        .filter(~pl.col("station").str.starts_with("A0:"))
        .unique()
        .collect()
        .get_column("station").to_list()
    )
    for s in set(rr_stations + rr_dest):
        parsed = parse_rapid_station(s)
        stations[f"rr_{parsed['code']}"] = parsed

    # 2. komuter_2026.csv + komuter_2023-2025.parquet — unique origin/destination
    print("[Station Mapper] Reading Komuter files ...")
    komuter_dfs = []
    for fname in ["komuter_2026.csv"]:
        df = pl.read_csv(RAW_DATA_DIR / fname, columns=["origin", "destination"])
        komuter_dfs.append(df)
    for fname in ["komuter_2023.parquet", "komuter_2024.parquet", "komuter_2025.parquet"]:
        df = pl.read_parquet(RAW_DATA_DIR / fname, columns=["origin", "destination"])
        komuter_dfs.append(df)
    komuter_all = pl.concat(komuter_dfs)
    komuter_stations = set(
        komuter_all["origin"].unique().to_list() +
        komuter_all["destination"].unique().to_list()
    )
    for s in komuter_stations:
        if s and str(s).strip():
            key = f"ktm_{s}"
            if key not in stations:
                stations[key] = {"code": str(s), "name": str(s), "line": "KTM Komuter", "source": "komuter"}

    # 3. intercity_2026.csv
    print("[Station Mapper] Reading intercity_2026.csv ...")
    ic = pl.read_csv(RAW_DATA_DIR / "intercity_2026.csv", columns=["origin", "destination"])
    intercity_stations = set(
        ic["origin"].unique().to_list() + ic["destination"].unique().to_list()
    )
    for s in intercity_stations:
        if s and str(s).strip():
            key = f"ic_{s}"
            if key not in stations:
                stations[key] = {"code": str(s), "name": str(s), "line": "KTM Intercity", "source": "intercity"}

    # Build output
    station_list = sorted(stations.values(), key=lambda x: (x["line"], x["name"]))

    output = {
        "generated_at": "2026-11-22",
        "total_stations": len(station_list),
        "stations": station_list,
        "lines": sorted(set(s["line"] for s in station_list)),
    }

    save_frontend_json(output, "stations.json")
    print(f"[Station Mapper] Done — {len(station_list)} stations across {len(output['lines'])} lines.")


if __name__ == "__main__":
    main()
