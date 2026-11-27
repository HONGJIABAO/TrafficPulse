from __future__ import annotations

import csv
import json
import math
import subprocess
import sys
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parents[1] / "data" / "module2_capacity_screening"
PROCESSED_DIR = DATA_DIR / "processed"
REPO_ROOT = PIPELINE_DIR.parents[2]
FRONTEND_DATA_DIR = REPO_ROOT / "frontend" / "src" / "data" / "module2_capacity_screening"

if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from gtfs_utils import parse_gtfs_secs, resolve_active_services_by_date  # noqa: E402
from od_path_assignment import classify_station_pair  # noqa: E402
from protection_audit import verify_baseline  # noqa: E402


class CapacityScreeningTestSuite(unittest.TestCase):
    def test_01_source_manifest_and_references_exist(self) -> None:
        manifest = json.loads((DATA_DIR / "source_manifest.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(manifest.get("sources", [])), 20)
        with (DATA_DIR / "train_capacity_reference.csv").open(encoding="utf-8") as f:
            cap_rows = list(csv.DictReader(f))
        with (DATA_DIR / "scheduled_service_reference.csv").open(encoding="utf-8") as f:
            svc_rows = list(csv.DictReader(f))
        self.assertGreaterEqual(len(cap_rows), 6)
        self.assertGreaterEqual(len(svc_rows), 10)
        kv_nom = next(r for r in cap_rows if r["service_code"] == "ktm_komuter_kv")
        self.assertEqual(kv_nom["nominal_capacity_pax"], "1118")
        ets_row = next(r for r in cap_rows if r["service_code"] == "ktm_ets")
        self.assertEqual(ets_row["eligible_for_full_screening"], "false")

    def test_02_topology_symmetry_uniqueness_and_kkb_expansion(self) -> None:
        reg = json.loads((PROCESSED_DIR / "station_registry_local.json").read_text(encoding="utf-8"))
        with (PROCESSED_DIR / "verified_directed_segments.csv").open(encoding="utf-8") as f:
            segs = list(csv.DictReader(f))
        self.assertEqual(len(segs), 156)
        self.assertEqual(len(reg["stations"]), 80)

        seg_set = {(r["network_code"], r["from_stop_id"], r["to_stop_id"]) for r in segs}
        for net, u, v in seg_set:
            self.assertIn((net, v, u), seg_set, f"Missing symmetric reverse edge for {(net, u, v)}")

        self.assertIn("ktm_komuter_kv:15200->16500", reg["bypass_expansions"])
        chain = reg["bypass_expansions"]["ktm_komuter_kv:15200->16500"]["chain"]
        self.assertEqual(chain, ["15200", "16100", "16300", "16500"])
        self.assertIn(("ktm_komuter_kv", "15200", "16100"), seg_set)
        self.assertIn(("ktm_komuter_kv", "16100", "16300"), seg_set)
        self.assertIn(("ktm_komuter_kv", "16300", "16500"), seg_set)

        junctions = {k for k, v in reg["stations"].items() if v["is_junction"]}
        self.assertEqual(
            junctions,
            {"ktm_komuter_kv:18800", "ktm_komuter_kv:19100", "ktm_komuter_utara:600"},
        )

    def test_03_gtfs_midnight_and_calendar_dates_holiday_override(self) -> None:
        self.assertEqual(parse_gtfs_secs("24:05:00"), 86700)
        self.assertEqual((parse_gtfs_secs("24:05:00") // 3600) % 24, 0)
        active = resolve_active_services_by_date("2026-08-18", "2026-11-26")
        self.assertEqual(len(active), 101)
        self.assertEqual(active["2026-08-25"]["ktm_komuter_kv"], "komuter_weekend")
        self.assertEqual(active["2026-08-31"]["ktm_komuter_kv"], "komuter_weekend")
        self.assertEqual(active["2026-09-16"]["ktm_komuter_kv"], "komuter_weekend")
        self.assertEqual(active["2026-09-18"]["ktm_komuter_kv"], "komuter_weekday")
        self.assertEqual(active["2026-09-18"]["day_profile"], "weekday")

    def test_04_backend_b_path_assignment_and_daily_headline_reconciliation(self) -> None:
        audit = json.loads((PROCESSED_DIR / "od_path_assignment_audit.json").read_text(encoding="utf-8"))
        for net in ("ktm_komuter_kv", "ktm_komuter_utara"):
            self.assertEqual(audit[net]["max_daily_diff_vs_ridership_ktmb_daily"], 0)
            self.assertEqual(audit[net]["full_period"]["buckets_rows"].get("excluded_unresolved_station", 0), 0)
            self.assertEqual(audit[net]["full_period"]["buckets_rows"].get("excluded_ambiguous_path", 0), 0)
            fp = audit[net]["full_period"]
            self.assertEqual(sum(fp["buckets_pax"].values()), fp["total_pax"])
        reg = json.loads((PROCESSED_DIR / "station_registry_local.json").read_text(encoding="utf-8"))
        st, o_id, d_id = classify_station_pair(
            "ktm_komuter_kv",
            "Segambut Utara",
            "KL Sentral",
            reg["csv_to_stop_id"]["ktm_komuter_kv"],
            reg["excluded_station_buckets"],
            reg["stations"],
        )
        self.assertEqual(st, "excluded_unverified_gtfs_stop")
        self.assertIsNone(o_id)
        self.assertIsNone(d_id)

    def test_05_backend_c_temporal_mass_conservation(self) -> None:
        audit_c = json.loads((PROCESSED_DIR / "temporal_demand_audit.json").read_text(encoding="utf-8"))
        for net in ("ktm_komuter_kv", "ktm_komuter_utara"):
            tot = audit_c["total_assigned_window_pax"][net]
            matched_arr = audit_c["matched_arrival_aligned_base_pax"][net]
            matched_fwd = audit_c["matched_forward_aligned_base_pax"][net]
            unm = audit_c["unmatched_outside_schedule_base_pax"][net]
            self.assertLess(abs((matched_arr + matched_fwd + unm) - tot), 1.0)
            self.assertLess(audit_c["unmatched_share_base_pct"][net], 5.0)

    def test_06_backend_d_strict_date_window(self) -> None:
        with (PROCESSED_DIR / "scheduled_segment_capacity.csv").open(encoding="utf-8") as f:
            dates = {r["date"] for r in csv.DictReader(f)}
        self.assertTrue(all("2026-08-18" <= d <= "2026-11-26" for d in dates))
        self.assertEqual(len(dates), 101)

    def test_07_backend_e_extra_trains_identity_and_zero_division_safety(self) -> None:
        cap_map = {"ktm_komuter_kv": 1118, "ktm_komuter_utara": 400}
        checked = 0
        no_svc_null_ok = 0
        with (PROCESSED_DIR / "potential_capacity_gap.csv").open(encoding="utf-8") as f:
            for idx, r in enumerate(csv.DictReader(f)):
                if idx > 25000 and no_svc_null_ok > 20 and checked > 2000:
                    break
                s_nom = int(r["scheduled_capacity_nominal_s"])
                n_tr = int(r["scheduled_trains_n"])
                d_base = float(r["demand_sched_base"])
                c = cap_map[r["network_code"]]
                if s_nom > 0:
                    lr = float(r["load_ratio_nominal_base_pct"])
                    deficit = float(r["capacity_deficit_nominal_base"])
                    ext = int(r["extra_trains_nominal_base"])
                    expected_lr = round(d_base / s_nom * 100.0, 1)
                    self.assertLessEqual(abs(lr - expected_lr), 0.15)
                    self.assertLessEqual(abs(deficit - max(0.0, d_base - s_nom)), 0.05)
                    self.assertEqual(ext, max(0, math.ceil((d_base - 1e-9) / c) - n_tr) if deficit > 1e-6 else 0)
                    checked += 1
                else:
                    self.assertEqual(r["load_ratio_nominal_base_pct"], "")
                    self.assertEqual(r["capacity_deficit_nominal_base"], "")
                    no_svc_null_ok += 1
        self.assertGreater(checked, 1000)

    def test_08_backend_f_station_conservation_and_junction_fallback(self) -> None:
        audit_ef = json.loads((PROCESSED_DIR / "gap_and_boarding_audit.json").read_text(encoding="utf-8"))
        fb = audit_ef["backend_f_station_boarding"]
        self.assertLess(fb["max_conservation_abs_error"], 1e-4)
        self.assertGreater(fb["full_boarding_rows"], 100000)
        self.assertGreater(fb["upstream_already_full_rows"], 0)
        self.assertGreater(fb["boarding_deficit_rows_nominal"], 0)

        checked_full = 0
        checked_fallback = 0
        with (PROCESSED_DIR / "station_boarding_capacity.csv").open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["boarding_screening_mode"] == "fallback_downstream_segment":
                    self.assertEqual(r["available_boarding_capacity_nominal"], "")
                    self.assertEqual(r["boarding_capacity_gap_nominal"], "")
                    checked_fallback += 1
                else:
                    d_in = float(r["d_in_arriving"])
                    a = float(r["a_alighting"])
                    t = float(r["t_through_onboard"])
                    b = float(r["b_boarding_demand"])
                    d_out = float(r["d_out_segment_demand"])
                    self.assertLess(abs((d_in - a + b) - d_out), 0.05)
                    self.assertLess(abs((d_in - a) - t), 0.05)
                    checked_full += 1
                if checked_full > 1500 and checked_fallback > 100:
                    break
        self.assertGreater(checked_full, 1000)
        self.assertGreater(checked_fallback, 50)

    def test_09_frontend_exports_and_rapid_rail_a0_exclusion(self) -> None:
        summary = json.loads((FRONTEND_DATA_DIR / "capacity_screening_summary.json").read_text(encoding="utf-8"))
        coverage = json.loads((FRONTEND_DATA_DIR / "capacity_coverage.json").read_text(encoding="utf-8"))
        self.assertEqual(len(summary["stations"]), 80)
        self.assertEqual(len(summary["segments"]), 156)

        unavail_names = {u["station_name"] for u in summary["unavailable_stations"]}
        self.assertIn("Segambut Utara", unavail_names)
        self.assertNotIn("A0: All Stations", unavail_names)
        rr_stats = coverage["other_networks_summary"]["rapid_rail"]
        self.assertGreater(rr_stats["a0_aggregate_rows_excluded_pax"], 100000000)
        self.assertGreaterEqual(len(coverage["other_networks_summary"]["manifest_raw_files"]), 20)
        self.assertEqual(len(coverage["feasibility_matrix"]), 6)

    def test_10_protected_files_untouched_and_clean_git_diff(self) -> None:
        self.assertEqual(verify_baseline(), 0)
        diff_res = subprocess.run(
            ["git", "diff", "HEAD", "--stat"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(diff_res.stdout.strip(), "", f"Unexpected tracked file edits:\n{diff_res.stdout}")


if __name__ == "__main__":
    unittest.main()
