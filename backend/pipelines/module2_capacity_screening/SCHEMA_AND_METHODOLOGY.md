# Module 2 Capacity & Service Bottlenecks — Schema & Methodology

## Pipeline Architecture
1. `protection_audit.py`: Records and verifies SHA-256 baseline hashes of all 105 protected repository files outside Module 2 Capacity Screening ownership.
2. `fetch_official_sources.py`: Downloads official KTMB & Prasarana 2026 datasets, GTFS feeds (`ktmb_gtfs.zip`, `rapid_rail_gtfs.zip`), and KTMB official PDFs (`ETS-REDCARD.pdf`, `BC-PS-BC_WEEKDAY_10112026.pdf`, `BC-PS-BC_WEEKEND_14112026.pdf`, `FAQ_KVDT_2.pdf`) into `backend/data/module2_capacity_screening/raw/` with SHA-256 provenance manifest (`source_manifest.json`).
3. `build_references.py`: Builds `train_capacity_reference.csv` and `scheduled_service_reference.csv`.
4. `network_topology.py` (Backend A): Reconstructs **156 verified symmetric directed physical segments** across **80 Komuter stations** (`ktm_komuter_kv` + `ktm_komuter_utara`) strictly from `stop_sequence`, expanding the GTFS southbound stop omission edge `15200 Tanjong Malim -> 16500 Batang Kali` proportionally across `16100 Kuala Kubu Bharu -> 16300 Rasa` (`1,260s` total span). Verifies `0` disconnected and `0` ambiguous OD paths.
5. `od_path_assignment.py` (Backend B): Audits 100% of rows in `komuter_2026.csv` (`98.399%` full 2026 / `97.225%` GTFS window assigned) and `komuter_utara_2026.csv` (`99.823%` assigned), classifying `Penalty`/`Unknown`, `Segambut Utara`/`Segambut 2` (unverified GTFS stop), and out-of-scope Shuttle Selatan/ETS feeder stops with `0` daily diff vs `ridership_ktmb_daily.csv`.
6. `temporal_demand.py` (Backend C): Projects `transaction_hour_cohort`, `schedule_traversal_base` (+5m buffer), and `schedule_traversal_tight_0m` (0m buffer) across `2026-08-18..2026-11-26` (`101` days), honoring KTMB AFC tap-out timestamps in KV (`96.776%` matched, `3.224%` outside schedule) and origin ticket timestamps in Komuter Utara (`98.022%` matched, `1.978%` outside schedule).
7. `scheduled_capacity.py` (Backend D): Computes date-compatible `scheduled_trains_n` and nominal capacity `S` handling `>=24:00:00` midnight crossings and `calendar_dates.txt` weekend overrides (`2026-08-25`, `2026-08-31`, `2026-09-16`).
8. `capacity_gap_engine.py` (Backends E & F): Produces per-date-hour segment deficits (`potential_capacity_gap.csv`) and station boarding screening (`station_boarding_capacity.csv`) enforcing `D_in - A + B == D_out` (`max_abs_err <= 1e-6`) on all non-junction directions and `fallback_downstream_segment` at `Putra`, `KL Sentral`, and `Bukit Mertajam` Y-junctions.
9. `run_pipeline.py`: Generates 4 compact frontend JSON bundles in `frontend/src/data/module2_capacity_screening/`.

## Exported Frontend File Sizes
- `capacity_screening_summary.json`: 2,409,252 bytes
- `capacity_hourly_profiles.json`: 559,099 bytes
- `capacity_coverage.json`: 31,674 bytes
- `capacity_methodology.json`: 2,770 bytes
