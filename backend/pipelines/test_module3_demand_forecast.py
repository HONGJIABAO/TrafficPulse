from __future__ import annotations

import datetime
import json
import math
import sys
import unittest
from pathlib import Path

import numpy as np
import polars as pl

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
RAW_DIR = REPO_ROOT / "backend" / "data" / "raw"
FRONTEND_DATA_DIR = REPO_ROOT / "frontend" / "src" / "data"
FORECAST_JSON_PATH = FRONTEND_DATA_DIR / "forecast_demand.json"
NETWORK_JSON_PATH = FRONTEND_DATA_DIR / "network_overview.json"

if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import module3_demand_forecast as m3  # noqa: E402

RAW_M3_AVAILABLE = (
    (RAW_DIR / "ridership_headline.csv").exists()
    and (RAW_DIR / "fuelprice.csv").exists()
    and (RAW_DIR / "registrations_type_fuel.csv").exists()
    and (RAW_DIR / "force labour_monthly.csv").exists()
)


class Module3UnitTestSuite(unittest.TestCase):
    """Lightweight deterministic unit tests (no raw CSV dependencies)."""

    def test_01_employment_unit_conversion(self) -> None:
        self.assertEqual(m3.convert_lf_employed_to_millions(16874.4, decimals=4), 16.8744)
        self.assertEqual(m3.convert_lf_employed_to_millions(16874.4, decimals=1), 16.9)
        self.assertIsNone(m3.convert_lf_employed_to_millions(None))

    def test_02_direct_lgbm_target_alignment_and_anti_leakage(self) -> None:
        # Synthetic deterministic series of 40 months where future values change dramatically
        n = 40
        months = np.array([(i % 12) + 1 for i in range(n)], dtype=int)
        y = np.arange(1, n + 1, dtype=float) * 1_000_000.0
        ext = np.column_stack([
            np.linspace(2.0, 4.0, n),
            np.linspace(2.1, 4.5, n),
            np.arange(n, dtype=float) * 1000.0 + 100_000.0,
            np.arange(n, dtype=float) * 10.0 + 15_000.0,
            np.full(n, 3.2),
        ])

        # Verify exact target alignment for step_h = 3 and pub_lag = 1
        X_3, y_3 = m3.build_direct_lgbm_training_pairs(y, ext, months, step_h=3, pub_lag_macro=1)
        # Valid origins o in [12 .. 40 - 3 - 1] = [12 .. 36] -> 25 samples
        self.assertEqual(len(X_3), 25)
        # First sample (o=12) should predict y[12 + 3] = y[15] = 16.0M
        self.assertAlmostEqual(float(y_3[0]), 16.0, places=6)
        # Last sample (o=36) should predict y[36 + 3] = y[39] = 40.0M (no off-by-one omission!)
        self.assertAlmostEqual(float(y_3[-1]), 40.0, places=6)
        # Feature lag 0 = y[o]/1e6, fuel = ext[o], reg/lf = ext[o-1] (lagged 1 month)
        self.assertAlmostEqual(float(X_3[-1, 0]), y[36] / 1e6, places=6)
        self.assertAlmostEqual(float(X_3[-1, 7]), ext[36, 0], places=6)  # ron95 at o
        self.assertAlmostEqual(float(X_3[-1, 9]), ext[35, 2] / 1e3, places=6)  # registrations lagged o-1

        # Anti-leakage test: corrupting ext after training cutoff index 29 must NOT alter features or forecast at origin 29
        ext_corrupted = ext.copy()
        ext_corrupted[30:, :] = 999999.0
        fc_clean, _ = m3.forecast_lgbm_direct(y[:30], ext[:30], months[:30], horizon=6, pub_lag_macro=1)
        fc_corr, _ = m3.forecast_lgbm_direct(y[:30], ext_corrupted[:30], months[:30], horizon=6, pub_lag_macro=1)
        np.testing.assert_allclose(fc_clean, fc_corr, rtol=0.0, atol=1e-9)

    def test_03_holtwinters_and_fallback_handling(self) -> None:
        # Clean synthetic seasonal linear signal
        t = np.arange(48, dtype=float)
        seasonal = 2_000_000.0 * np.sin(2 * np.pi * t / 12.0)
        y_clean = 20_000_000.0 + 200_000.0 * t + seasonal
        fc, warns, fb = m3.forecast_holtwinters(y_clean, horizon=6, damped_trend=False)
        self.assertEqual(len(fc), 6)
        self.assertEqual(fb, 0)
        self.assertEqual(warns, 0)
        self.assertTrue(np.all(np.isfinite(fc)))

        # Pathological short input (< 2 seasonal cycles) must gracefully fall back to Seasonal Naive
        y_short = np.array([10_000_000.0 + i * 100_000.0 for i in range(15)])
        fc_fb, _, fb_flag = m3.forecast_holtwinters(y_short, horizon=4)
        self.assertEqual(fb_flag, 1)
        expected_sn = m3.forecast_seasonal_naive(y_short, 4)
        np.testing.assert_allclose(fc_fb, expected_sn)

    def test_04_accuracy_metrics_and_correlation_math(self) -> None:
        trues = np.array([100.0, 200.0, 300.0])
        preds = np.array([110.0, 190.0, 330.0])
        m = m3.compute_accuracy_metrics(trues, preds)
        # Abs errors: 10, 10, 30 -> MAE = 50/3 = 16.67 -> 17
        # WAPE = 50 / 600 * 100 = 8.33%
        # MAPE = (10/100 + 10/200 + 30/300)/3 * 100 = 8.33%
        # Bias = (10 - 10 + 30)/3 = +10
        self.assertEqual(m["wape_pct"], 8.33)
        self.assertEqual(m["mape_pct"], 8.33)
        self.assertEqual(m["bias"], 10.0)

        df = pl.DataFrame({
            "date": [datetime.date(2025, i, 1) for i in range(1, 7)],
            "rail_total": [10.0, 20.0, 30.0, 40.0, 50.0, 60.0],
            "u_rate": [5.0, 4.0, 3.0, 2.0, 1.0, 0.0],
            "ron95_avg": [2.0, 2.1, None, 2.3, 2.4, 2.5],
        })
        corr = m3.compute_correlations(df, "rail_total", ["u_rate", "ron95_avg"])
        by_feat = {c["feature"]: c for c in corr}
        self.assertEqual(by_feat["u_rate"]["correlation"], -1.0)
        self.assertEqual(by_feat["u_rate"]["n_obs"], 6)
        self.assertEqual(by_feat["ron95_avg"]["n_obs"], 5)
        self.assertEqual(by_feat["ron95_avg"]["missing_values_dropped"], 1)


@unittest.skipUnless(RAW_M3_AVAILABLE and FORECAST_JSON_PATH.exists(), "Raw CSVs or forecast_demand.json unavailable")
class Module3IntegrationTestSuite(unittest.TestCase):
    """Full-data verification against official raw CSVs and committed forecast_demand.json."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = m3.build_forecast_payload(RAW_DIR)
        cls.committed = json.loads(FORECAST_JSON_PATH.read_text(encoding="utf-8"))

    def test_01_historical_aggregation_matches_module1(self) -> None:
        self.assertEqual(self.committed["historical_observation_count"], 92)
        self.assertEqual(self.committed["daily_source_records"], 2800)
        trend = self.committed["monthly_driver_trend"]
        self.assertEqual(trend[0]["month_start"], "2019-01-01")
        self.assertEqual(trend[-1]["month_start"], "2026-08-01")
        self.assertEqual(int(trend[-1]["rail_total"]), 32569085)

        if NETWORK_JSON_PATH.exists():
            no = json.loads(NETWORK_JSON_PATH.read_text(encoding="utf-8"))
            m1_map = {m["year_month"]: m["total"] for m in no["monthly_trend"]}
            for row in trend:
                self.assertAlmostEqual(row["rail_total"], m1_map[row["month_start"][:7]], places=2)

    def test_02_information_cutoff_and_no_post_cutoff_leakage(self) -> None:
        self.assertEqual(self.committed["forecast_origin_month"], "2026-08-01")
        self.assertEqual(self.committed["information_cutoff"], "2026-08-31")
        freshness = self.committed["data_freshness"]
        self.assertTrue(freshness["post_cutoff_drivers_excluded_from_forecast"])
        self.assertEqual(freshness["ridership_latest_month"], "2026-08-01")
        self.assertGreater(freshness["fuelprice_latest_raw_date"], "2026-08-31")
        self.assertNotIn("air_pollution_data_cutoff", self.committed)

    def test_03_employment_conversion_and_fuel_disclosure(self) -> None:
        last_row = self.committed["monthly_driver_trend"][-1]
        self.assertAlmostEqual(last_row["lf_employed"], 16874.4, places=1)
        kpi = self.committed["kpi_summary"]
        self.assertEqual(kpi["latest_lf_employed_m"], 16.9)
        self.assertAlmostEqual(kpi["latest_lf_employed_m_exact"], 16.8744, places=4)
        self.assertIn("Unsubsidised", kpi["fuel_price_basis"])

    def test_04_horizon_consistency_and_distinct_horizon_metrics(self) -> None:
        fcs = {f["horizon"]: f for f in self.committed["forecasts"]}
        self.assertEqual(set(fcs.keys()), {"3_months", "6_months", "12_months"})

        p3 = fcs["3_months"]["forecasts"]
        p6 = fcs["6_months"]["forecasts"]
        p12 = fcs["12_months"]["forecasts"]
        self.assertEqual(len(p3), 3)
        self.assertEqual(len(p6), 6)
        self.assertEqual(len(p12), 12)
        self.assertEqual(p3, p12[:3])
        self.assertEqual(p6, p12[:6])

        # Accuracy metrics MUST be horizon-specific, NOT copied 1-step metrics
        self.assertNotEqual(fcs["3_months"]["n_cv_folds"], fcs["12_months"]["n_cv_folds"])
        self.assertNotEqual(fcs["3_months"]["mape_pct"], fcs["12_months"]["mape_pct"])
        self.assertEqual(fcs["3_months"]["uncertainty_label"], "Indicative Prediction Range")
        self.assertFalse(fcs["3_months"]["is_calibrated_95_ci"])

        # Check all bounds valid & non-negative, no NaN/Inf
        for h_obj in self.committed["forecasts"]:
            for pt in h_obj["forecasts"]:
                self.assertTrue(math.isfinite(pt["predicted"]))
                self.assertTrue(math.isfinite(pt["lower_ci"]))
                self.assertTrue(math.isfinite(pt["upper_ci"]))
                self.assertGreaterEqual(pt["lower_ci"], 0.0)
                self.assertLessEqual(pt["lower_ci"], pt["predicted"])
                self.assertLessEqual(pt["predicted"], pt["upper_ci"])

    def test_05_chronological_splits_and_hw_convergence(self) -> None:
        ev = self.committed["model_evaluation"]
        audit = ev["chronological_boundary_audit"]
        self.assertTrue(audit["selection_targets_strictly_pre_holdout"])
        first_holdout_target = ev["holdout_eval"]["1_month"]["target_start"]
        for h_key in ["1_month", "3_months", "6_months", "12_months"]:
            sel_h = ev["selection_window"][h_key]
            hold_h = ev["holdout_eval"][h_key]
            # Selection origins AND targets must strictly precede holdout origins and earliest holdout target
            self.assertLess(sel_h["origin_end"], hold_h["origin_start"])
            self.assertLessEqual(sel_h["target_end"], audit["selection_max_target_cutoff"])
            self.assertLess(sel_h["target_end"], first_holdout_target)

        # Purged selection baseline for prediction range calibration must also shrink with step_h (18 -> 7)
        step_diags = {s["step_h"]: s for s in self.committed["prediction_range_methodology"]["step_diagnostics"]}
        self.assertEqual(step_diags[1]["selection_split_n"], 18)
        self.assertEqual(step_diags[3]["selection_split_n"], 16)
        self.assertEqual(step_diags[6]["selection_split_n"], 13)
        self.assertEqual(step_diags[12]["selection_split_n"], 7)

        self.assertEqual(sum(ev["hw_convergence_warnings_total"].values()), 0)
        self.assertEqual(self.committed["selected_forecast_model"]["final_fit_convergence_warnings"], 0)
        self.assertFalse(self.committed["selected_forecast_model"]["final_fit_fallback_used"])

    def test_06_correlations_by_period_and_reproducibility(self) -> None:
        cbp = self.committed["correlations_by_period"]
        self.assertEqual(set(cbp.keys()), {"all", "24m", "12m", "post_covid", "post_covid_diff"})
        c_all = {r["feature"]: r["correlation"] for r in cbp["all"]["correlations"]}
        c_12m = {r["feature"]: r["correlation"] for r in cbp["12m"]["correlations"]}
        self.assertAlmostEqual(c_all["u_rate"], -0.9251, places=3)
        self.assertAlmostEqual(c_12m["u_rate"], 0.1422, places=3)
        self.assertAlmostEqual(c_12m["registrations"], 0.8554, places=3)

        # Verify committed JSON forecasts & KPIs match fresh deterministic build verbatim
        self.assertEqual(self.committed["forecasts"], self.payload["forecasts"])
        self.assertEqual(self.committed["kpi_summary"], self.payload["kpi_summary"])
        self.assertEqual(self.committed["driver_correlations"], self.payload["driver_correlations"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
