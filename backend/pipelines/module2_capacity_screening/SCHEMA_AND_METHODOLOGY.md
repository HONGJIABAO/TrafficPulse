# Module 2 Capacity & Service Bottlenecks — Schema & Methodology

## Pipeline Architecture & Scientific Refinements
1. `protection_audit.py`: Verifies line-ending normalized SHA-256 baseline hashes of all 105 protected repository files outside Module 2 Capacity Screening ownership (explicitly validating commit `7b1935b` authorized `OdPeakHours.tsx` integration).
2. `fetch_official_sources.py`: Downloads official KTMB & Prasarana 2026 datasets, GTFS feeds, and KTMB official PDFs into `backend/data/module2_capacity_screening/raw/` with SHA-256 provenance manifest (`source_manifest.json`).
3. `build_references.py`: Builds `train_capacity_reference.csv` and `scheduled_service_reference.csv`.
4. `network_topology.py` (Backend A): Reconstructs **156 verified symmetric directed physical segments** across **80 Komuter stations** strictly from `stop_sequence`, expanding the GTFS southbound stop omission edge `15200 Tanjong Malim -> 16500 Batang Kali` proportionally across `16100 Kuala Kubu Bharu -> 16300 Rasa` (`1,260s` span).
5. `od_path_assignment.py` (Backend B): Audits 100% of rows in `komuter_2026.csv` and `komuter_utara_2026.csv` (bounded `<= 2026-11-26`), cleanly isolating `Penalty`/`Unknown`, `Segambut Utara`/`Segambut 2`, and Shuttle Selatan tickets.
6. `temporal_demand.py` (Backend C): Projects `transaction_hour_cohort`, `schedule_traversal_base`, and `schedule_traversal_tight_0m` across `2026-08-18..2026-11-26` — using arrival-aligned AFC matching (`<=90m` + bounded forward fallback) for Klang Valley, and **symmetric 50/50 bounded mixed matching (`<=120m`)** for Komuter Utara while exporting complete 6-scenario sensitivity envelopes (`utara_temporal_sensitivity.json`).
7. `scheduled_capacity.py` (Backend D): Computes date-compatible `scheduled_trains_n` and nominal capacity `S`, flagging **2026-11-09 Deepavali Replacement Holiday** (`unverified_kv_holiday` excluded from KV matched comparisons and normal weekdays) and disclosing KV's November 2026 Reference-Timetable scope vs Utara's continuous 24 Jul 2026 daily schedule.
8. `capacity_gap_engine.py` (Backends E & F): Produces per-date-hour segment deficits and station boarding screening enforcing `D_in - A + B == D_out` (`max_abs_err <= 1e-6`) on non-junctions and `fallback_downstream_segment` at `Putra`, `KL Sentral`, and `Bukit Mertajam`.
9. `run_pipeline.py`: Exports all `5 periods x 3 dayProfiles` (`2,340` profiles) with deduplicated single-day schedules (`sched_catalog`), coherent representative nearest-rank `P90` observations, and complete holiday/temporal sensitivity disclosures.

## Exported Frontend File Sizes
- `capacity_screening_summary.json`: 3,034,128 bytes
- `capacity_hourly_profiles.json`: 3,272,952 bytes
- `capacity_coverage.json`: 75,742 bytes
- `capacity_methodology.json`: 2,994 bytes
