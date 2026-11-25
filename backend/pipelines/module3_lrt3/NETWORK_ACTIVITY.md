# Step 4B network district activity

From the repository root, use the existing module environment.

```powershell
& backend/pipelines/module3_lrt3/.venv/Scripts/python.exe -B backend/pipelines/module3_lrt3/run_network_equity.py
```

The script verifies the raw file's Step 1 SHA-256 and uses one 512 KiB PyArrow CSV reader. It filters to 1 August–20 November 2026 before aggregating OD rows into origin-day and destination-day totals. It retains compact OD pair presence flags to detect duplicate keys. Thread limits and the 768 MiB available-memory safeguard come from the Step 4 runner.

Step 4B writes only new supplemental files. The recovery baseline protects Step 1–4 output and source checksums and the Git working-tree state outside Module 3. `network_activity_progress.jsonl` records validated stages, timing and peak working set. The three stages checkpoint the raw scan, station reconciliation and district outputs under `network_activity_checkpoints/`. A restart reuses matching checkpoints. A file already published with a different checksum is preserved and reported as a publication conflict.

Run this read-only check to recompute all six outputs from the scan checkpoint and compare the results with the published files. It rechecks the raw file hash and prior output hashes.

```powershell
& backend/pipelines/module3_lrt3/.venv/Scripts/python.exe -B backend/pipelines/module3_lrt3/run_network_equity.py --verify
```

## Dashboard tables

| Artifact | Grain and interpretation |
| --- | --- |
| `network_station_origin_daily.parquet` | One row per `date` and `canonical_origin_code`. It retains the raw code, A0 subtotal, detail sum, published destination-roster coverage and reconciliation status. |
| `network_station_origin_crosswalk.csv` | One row per `crosswalk_id`. It includes each published station code and GTFS records that lack their own OD origin. Use `physical_station_id` for physical infrastructure counts. |
| `network_district_demand_activity.csv` | One row per `district_id`. Period totals, daily averages, shares, population and physical-station denominators, and coverage status. |
| `network_district_equity_comparison.csv` | One row per `district_id`. Includes observed OD activity, socioeconomic reference years and the original Step 4 screen fields. |
| `network_district_activity_metadata.json` | Source and input fingerprints, audits, schemas, units and limitations. |
| `network_district_activity_summary.md` | Source findings, district comparisons and missing evidence. |

`NA` denotes an unavailable CSV field. The observed network share uses reconciled published station-origin trips as its denominator. The published data provide origin coverage across the mapped physical network with an asymmetric destination roster. Interpret district totals within that published snapshot. Trips per resident or station are descriptive ratios. Separate origin codes can belong to one physical facility, and the two keys answer different questions.
