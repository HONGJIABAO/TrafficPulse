from __future__ import annotations

import csv
import datetime as dt
import io
import json
import math
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parents[1] / "data" / "module2_capacity_screening"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
REPO_ROOT = PIPELINE_DIR.parents[2]
FRONTEND_DATA_DIR = REPO_ROOT / "frontend" / "src" / "data" / "module2_capacity_screening"

if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import gtfs_utils  # noqa: E402
import network_topology  # noqa: E402
import od_path_assignment  # noqa: E402
from protection_audit import verify_baseline  # noqa: E402
import run_pipeline  # noqa: E402
import scheduled_capacity  # noqa: E402
import temporal_demand  # noqa: E402

FULL_PIPELINE_DATA_AVAILABLE = (
    (RAW_DIR / "ktmb_gtfs.zip").exists()
    and (RAW_DIR / "komuter_2026.csv").exists()
    and (PROCESSED_DIR / "potential_capacity_gap.csv").exists()
    and (PROCESSED_DIR / "station_boarding_capacity.csv").exists()
)


def _write_compact_gtfs_zip(zip_path: Path) -> None:
    """Create a tiny deterministic GTFS archive covering bypass expansion, midnight spillover, and holidays."""
    stops_csv = (
        "stop_id,stop_name,stop_lat,stop_lon\n"
        "15200,TANJONG MALIM,3.685,101.519\n"
        "16100,KUALA KUBU BHARU,3.562,101.653\n"
        "16300,RASA,3.502,101.634\n"
        "16500,BATANG KALI,3.467,101.640\n"
        "100,SUNGAI PETANI,5.647,100.487\n"
        "42400,GURUN,5.817,100.473\n"
    )
    routes_csv = (
        "route_id,route_short_name,route_long_name,route_type\n"
        "KA15_KD19,TM-PK,Tanjong Malim - Pelabuhan Klang,2\n"
        "100_47300,UTARA,Butterworth - Padang Besar,2\n"
    )
    calendar_csv = (
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        "komuter_weekday,1,1,1,1,1,0,0,20260818,20261212\n"
        "komuter_weekend,0,0,0,0,0,1,1,20260822,20261212\n"
        "komuter_utara,1,1,1,1,1,1,1,20260818,20261212\n"
    )
    calendar_dates_csv = (
        "service_id,date,exception_type\n"
        "komuter_weekday,20260825,2\n"
        "komuter_weekend,20260825,1\n"
        "komuter_weekday,20260831,2\n"
        "komuter_weekend,20260831,1\n"
        "komuter_weekday,20260916,2\n"
        "komuter_weekend,20260916,1\n"
    )
    trips_csv = (
        "route_id,service_id,trip_id,direction_id\n"
        "KA15_KD19,komuter_weekday,KV_NB,0\n"
        "KA15_KD19,komuter_weekday,KV_SB_OMIT,1\n"
        "KA15_KD19,komuter_weekend,KV_WE,0\n"
        "100_47300,komuter_utara,UT_SB,1\n"
        "100_47300,komuter_utara,UT_NB,0\n"
    )
    stop_times_csv = (
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
        "KV_NB,08:00:00,08:00:00,16500,1\n"
        "KV_NB,08:04:00,08:04:00,16300,2\n"
        "KV_NB,08:09:00,08:09:00,16100,3\n"
        "KV_NB,08:22:00,08:22:00,15200,4\n"
        "KV_SB_OMIT,23:55:00,23:55:00,15200,1\n"
        "KV_SB_OMIT,24:16:00,24:16:00,16500,2\n"
        "KV_WE,09:00:00,09:00:00,16500,1\n"
        "KV_WE,09:04:00,09:04:00,16300,2\n"
        "KV_WE,09:09:00,09:09:00,16100,3\n"
        "KV_WE,09:22:00,09:22:00,15200,4\n"
        "UT_SB,11:00:00,11:00:00,42400,1\n"
        "UT_SB,11:15:00,11:15:00,100,2\n"
        "UT_NB,13:00:00,13:00:00,100,1\n"
        "UT_NB,13:15:00,13:15:00,42400,2\n"
    )
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("stops.txt", stops_csv)
        zf.writestr("routes.txt", routes_csv)
        zf.writestr("calendar.txt", calendar_csv)
        zf.writestr("calendar_dates.txt", calendar_dates_csv)
        zf.writestr("trips.txt", trips_csv)
        zf.writestr("stop_times.txt", stop_times_csv)


class CapacityScreeningUnitTestSuite(unittest.TestCase):
    """Self-contained deterministic unit tests runnable on a clean repository checkout (no raw/ required)."""

    def test_01_committed_references_and_frontend_bundles_present(self) -> None:
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

        summary = json.loads((FRONTEND_DATA_DIR / "capacity_screening_summary.json").read_text(encoding="utf-8"))
        hourly = json.loads((FRONTEND_DATA_DIR / "capacity_hourly_profiles.json").read_text(encoding="utf-8"))
        coverage = json.loads((FRONTEND_DATA_DIR / "capacity_coverage.json").read_text(encoding="utf-8"))
        self.assertEqual(len(summary["segments"]), 156)
        self.assertEqual(len(summary["stations"]), 80)
        # All 5 periods x 3 dayProfiles x 156 segments = 2,340 hourly profiles must be exported
        self.assertEqual(len(hourly["profiles"]), 156 * 5 * 3)
        self.assertIsInstance(hourly.get("sched_catalog"), list)
        self.assertGreater(len(hourly["sched_catalog"]), 0)
        self.assertIn("utara_temporal_sensitivity", coverage)
        self.assertIn("nov09_holiday_sensitivity", coverage)
        unavail_names = {u["station_name"] for u in summary["unavailable_stations"]}
        self.assertIn("Segambut Utara", unavail_names)
        self.assertNotIn("A0: All Stations", unavail_names)

    def test_02_gtfs_midnight_and_holiday_exclusion_on_compact_fixture(self) -> None:
        self.assertEqual(gtfs_utils.parse_gtfs_secs("24:16:00"), 87360)
        self.assertEqual((gtfs_utils.parse_gtfs_secs("24:16:00") // 3600) % 24, 0)

        with tempfile.TemporaryDirectory() as tmp:
            tmp_raw = Path(tmp) / "raw"
            tmp_raw.mkdir()
            _write_compact_gtfs_zip(tmp_raw / "ktmb_gtfs.zip")

            orig_raw = gtfs_utils.RAW_DIR
            try:
                gtfs_utils.RAW_DIR = tmp_raw
                active = gtfs_utils.resolve_active_services_by_date("2026-08-18", "2026-11-26")
            finally:
                gtfs_utils.RAW_DIR = orig_raw

            self.assertEqual(len(active), 101)
            self.assertEqual(active["2026-08-25"]["day_profile"], "weekend")
            self.assertEqual(active["2026-08-31"]["day_profile"], "weekend")
            self.assertEqual(active["2026-09-16"]["day_profile"], "weekend")
            self.assertEqual(active["2026-09-18"]["day_profile"], "weekday")

            # Verify 2026-11-09 Deepavali replacement holiday exclusion rules cleanly
            nov9 = active["2026-11-09"]
            self.assertEqual(nov9["day_profile"], "holiday_unverified")
            self.assertFalse(gtfs_utils.is_date_eligible_for_slice(nov9, "ktm_komuter_kv", "all"))
            self.assertFalse(gtfs_utils.is_date_eligible_for_slice(nov9, "ktm_komuter_kv", "weekday"))
            self.assertTrue(gtfs_utils.is_date_eligible_for_slice(nov9, "ktm_komuter_utara", "all"))
            self.assertFalse(gtfs_utils.is_date_eligible_for_slice(nov9, "ktm_komuter_utara", "weekday"))

    def test_03_compact_fixture_coherent_p90_and_zero_service_safety(self) -> None:
        summary = json.loads((FRONTEND_DATA_DIR / "capacity_screening_summary.json").read_text(encoding="utf-8"))
        for seg in summary["segments"]:
            c_nom = seg["train_capacity_nom"]
            for skey, m in seg["metrics"].items():
                if m["p90_peak_s_nom"] > 0:
                    exp_lr = round(m["p90_peak_d"] / m["p90_peak_s_nom"] * 100.0, 1)
                    self.assertLessEqual(abs(m["p90_peak_lr_nom"] - exp_lr), 0.11, f"P90 coherent LR mismatch on {seg['segment_id']} {skey}")
                    exp_def = round(max(0.0, m["p90_peak_d"] - m["p90_peak_s_nom"]), 1)
                    self.assertLessEqual(abs(m["p90_peak_def_nom"] - exp_def), 0.11)
                    exp_ext = math.ceil((m["p90_peak_def_nom"] - 1e-9) / c_nom) if m["p90_peak_def_nom"] > 1e-6 else 0
                    self.assertEqual(m["p90_peak_ext_nom"], exp_ext)
                    if seg["boarding_screening_mode"] == "full_station_boarding" and m["st_p90_t"] is not None:
                        self.assertLessEqual(abs((m["st_p90_t"] + m["st_p90_b"]) - m["p90_peak_d"]), 0.25)
                else:
                    self.assertIsNone(m["p90_peak_lr_nom"])

    def test_04_protection_audit_lf_crlf_and_authorized_7b1935b_verification(self) -> None:
        self.assertEqual(verify_baseline(), 0)


@unittest.skipUnless(
    FULL_PIPELINE_DATA_AVAILABLE,
    "Full raw & processed artifacts not built locally; run fetch_official_sources.py && run_pipeline.py to execute full-dataset integration checks.",
)
class CapacityScreeningIntegrationTestSuite(unittest.TestCase):
    """Full-dataset integration checks over all 101 days / 156 directed segments / 80 stations."""

    def test_05_topology_symmetry_and_kkb_expansion(self) -> None:
        reg = json.loads((PROCESSED_DIR / "station_registry_local.json").read_text(encoding="utf-8"))
        with (PROCESSED_DIR / "verified_directed_segments.csv").open(encoding="utf-8") as f:
            segs = list(csv.DictReader(f))
        self.assertEqual(len(segs), 156)
        self.assertEqual(len(reg["stations"]), 80)

        seg_set = {(r["network_code"], r["from_stop_id"], r["to_stop_id"]) for r in segs}
        for net, u, v in seg_set:
            self.assertIn((net, v, u), seg_set, f"Missing symmetric reverse edge for {(net, u, v)}")

        self.assertIn("ktm_komuter_kv:15200->16500", reg["bypass_expansions"])
        self.assertEqual(reg["bypass_expansions"]["ktm_komuter_kv:15200->16500"]["chain"], ["15200", "16100", "16300", "16500"])
        self.assertEqual(
            {k for k, v in reg["stations"].items() if v["is_junction"]},
            {"ktm_komuter_kv:18800", "ktm_komuter_kv:19100", "ktm_komuter_utara:600"},
        )

    def test_06_backend_b_path_assignment_and_daily_headline_reconciliation(self) -> None:
        audit = json.loads((PROCESSED_DIR / "od_path_assignment_audit.json").read_text(encoding="utf-8"))
        for net in ("ktm_komuter_kv", "ktm_komuter_utara"):
            self.assertEqual(audit[net]["max_daily_diff_vs_ridership_ktmb_daily"], 0)
            self.assertEqual(audit[net]["full_period"]["buckets_rows"].get("excluded_unresolved_station", 0), 0)
            self.assertEqual(audit[net]["full_period"]["buckets_rows"].get("excluded_ambiguous_path", 0), 0)
            fp = audit[net]["full_period"]
            self.assertEqual(sum(fp["buckets_pax"].values()), fp["total_pax"])

    def test_07_backend_c_temporal_mass_conservation(self) -> None:
        audit_c = json.loads((PROCESSED_DIR / "temporal_demand_audit.json").read_text(encoding="utf-8"))
        for net in ("ktm_komuter_kv", "ktm_komuter_utara"):
            assigned = audit_c["total_assigned_window_pax"][net]
            matched_arr = audit_c["matched_arrival_aligned_base_pax"][net]
            matched_fwd = audit_c["matched_forward_aligned_base_pax"][net]
            unmatched = audit_c["unmatched_outside_schedule_base_pax"][net]
            self.assertLess(abs((matched_arr + matched_fwd + unmatched) - assigned), 0.1)

    def test_08_backend_d_scheduled_capacity_bounds(self) -> None:
        audit_d = json.loads((PROCESSED_DIR / "scheduled_capacity_audit.json").read_text(encoding="utf-8"))
        self.assertEqual(audit_d["gtfs_window"], "2026-08-18..2026-11-26")
        self.assertEqual(audit_d["total_segment_train_crossings"]["ktm_komuter_kv"], 137280)
        self.assertEqual(audit_d["total_segment_train_crossings"]["ktm_komuter_utara"], 75144)

    def test_09_backend_ef_gap_and_station_conservation(self) -> None:
        audit_ef = json.loads((PROCESSED_DIR / "gap_and_boarding_audit.json").read_text(encoding="utf-8"))
        self.assertEqual(audit_ef["backend_e_segment_gap"]["no_service_with_demand_rows"], 0)
        self.assertGreater(audit_ef["backend_e_segment_gap"]["unverified_holiday_kv_excluded_rows"], 0)
        fb = audit_ef["backend_f_station_boarding"]
        self.assertLess(fb["max_conservation_abs_error"], 1e-4)

        checked_full = 0
        with (PROCESSED_DIR / "station_boarding_capacity.csv").open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["boarding_screening_mode"] == "fallback_downstream_segment":
                    self.assertEqual(r["available_boarding_capacity_nominal"], "")
                else:
                    d_in = float(r["d_in_arriving"])
                    a = float(r["a_alighting"])
                    b = float(r["b_boarding_demand"])
                    d_out = float(r["d_out_segment_demand"])
                    self.assertLess(abs((d_in - a + b) - d_out), 0.05)
                    checked_full += 1
                if checked_full > 1500:
                    break
        self.assertGreater(checked_full, 1000)


if __name__ == "__main__":
    unittest.main()
