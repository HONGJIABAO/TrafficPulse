# Step 4 district equity analysis

Run from the repository root with the existing module environment.

```powershell
& backend/pipelines/module3_lrt3/.venv/Scripts/python.exe -B backend/pipelines/module3_lrt3/run_equity.py
```

The command resumes from validated checkpoints whose input fingerprints match. It runs one stage at a time with single-threaded numerical libraries. It monitors free physical RAM and stops below 768 MiB. The progress manifest records stage duration, available physical memory and the process peak working set. The pipeline uses the district survey and population Parquets, the recovered PLANMalaysia GeoJSON, the existing GTFS and validated Step 1 and Step 3 extracts. The raw Rapid Rail OD CSV is outside the run's inputs.

The recovery inventory is `backend/data/processed/module3_lrt3/equity_recovery_20261124_184842.json`. The append-only `equity_progress.jsonl` records validated checkpoints and publication events. Each checkpoint under `equity_checkpoints/` has a `stage.json` with the expected hashes. A folder without a valid stage manifest is retained for inspection. If an output becomes damaged after publication, the matching checkpoint can restore it after saving the current bytes under `equity_recovery_backups/`. A different existing output without matching recorded provenance requires inspection before it can be replaced.

Recompute the Step 4 results and compare them byte for byte with the published outputs using the read-only verification command.

```powershell
& backend/pipelines/module3_lrt3/.venv/Scripts/python.exe -B backend/pipelines/module3_lrt3/run_equity.py --verify
```

## Dashboard joins

| File | Grain and join key |
| --- | --- |
| `district_socioeconomic_summary.csv` | One row per `district_id`. Survey and population reference years are explicit. |
| `station_district_mapping.csv` | One row per `gtfs_stop_id`. Use `physical_station_id` to deduplicate and `lrt3_station_code` for LRT3 activity. |
| `district_rail_coverage.csv` | One row per `district_id` with scope and coverage status. |
| `district_demand_activity.csv` | One row per `district_id` for the inclusive observation period, with separate LRT3 and all-network availability fields. |
| `equity_priority_screening.csv` | One primary scenario row per `district_id`. |
| `equity_threshold_sensitivity.csv` | One row per `scenario_id` and `district_id`. |
| `district_boundaries.geojson` | One WGS84 polygon or multipolygon per `properties.district_id`. |
| `equity_metadata.json` | Input provenance, units, schemas, thresholds, station contribution, coverage and data gaps. |
| `equity_summary.md` | Results and interpretation for the district comparison. |

Treat `district_id` as a string. Parse `NA` as missing. The coverage status identifies zero station counts in the GTFS scope, and the activity status identifies districts with zero LRT3 stops in the snapshot. A positive count describes infrastructure or station-origin activity within the stated scope. Read the assessment limits in `equity_metadata.json` before displaying district comparisons.
