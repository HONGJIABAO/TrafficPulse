"""Audit empirical coverage and build the as-of planning watchlist."""

import numpy as np
import pandas as pd

from forecast_evaluation import FULL, HOLDOUT, VALIDATION
from forecast_inputs import NAMES, NETWORK, OD, SERVICES, SHAH
from forecast_models import ETS, NAIVE
from innovation_experiments import SHORT, identity, recent_mean
from run_validation import require


def uncertainty_audit(saved, original, metadata, config):
    fit = metadata["models"][OD]
    selected = saved.loc[saved["series_id"].eq(OD) & saved["model_id"].eq(fit["model"])
                         & saved["training_policy"].eq(fit["policy"])]
    residuals = selected.loc[selected["phase"].eq(VALIDATION if fit["policy"] == FULL else "intervention_matched")]
    holdout = selected.loc[selected["phase"].eq(HOLDOUT)].dropna(subset=["actual_trips"])
    reported = metadata["od_scenarios"]["empirical_residual_bands"]["bands"]
    audit = []
    for (lower, upper), recorded in zip(config["uncertainty"]["lead_bands"], reported, strict=True):
        band = residuals.loc[residuals["lead_day"].between(lower, upper)].dropna(subset=["actual_trips"])
        tests = holdout.loc[holdout["lead_day"].between(lower, upper)]
        errors = band["actual_trips"] - band["forecast_trips"]
        bounds = errors.quantile(config["uncertainty"]["quantiles"]).to_numpy()
        require(len(errors) == recorded["count"] and np.allclose(
            bounds, [recorded["residual_lower_quantile"], recorded["residual_upper_quantile"]],
        ), "Empirical residual provenance mismatch")
        published = original.loc[original["lead_day"].between(lower, upper)]
        for index, name in enumerate(("empirical_lower_trips", "empirical_upper_trips")):
            np.testing.assert_allclose(published[name], (published["forecast_trips"] + bounds[index]).clip(lower=0))
        tested_error = tests["actual_trips"] - tests["forecast_trips"]
        inside = int(tested_error.between(*bounds).sum())
        require(inside == recorded["holdout_inside"] and len(tests) == recorded["holdout_points"],
                "Holdout coverage mismatch")
        audit.append({
            "lead_start": lower, "lead_end": upper, "selection_residuals": len(errors),
            "distinct_residual_dates": band["date"].nunique(), "rolling_origins": band["origin"].nunique(),
            "holdout_dates": tests["date"].dt.strftime("%Y-%m-%d").tolist(),
            "holdout_points": len(tests), "inside": inside,
            "coverage_pct": 100 * inside / len(tests) if len(tests) else None,
            "lower_error_quantile_trips": float(bounds[0]), "upper_error_quantile_trips": float(bounds[1]),
        })
    points, inside = sum(x["holdout_points"] for x in audit), sum(x["inside"] for x in audit)
    require(original.loc[original["lead_day"].gt(max(x["lead_end"] for x in audit)),
                         ["empirical_lower_trips", "empirical_upper_trips"]].isna().all().all(),
            "Unexpected long-lead bands")
    return identity(OD) | {
        "nominal_residual_quantiles": config["uncertainty"]["quantiles"], "bands": audit,
        "unique_terminal_origins": holdout["origin"].nunique(), "holdout_points": points,
        "holdout_inside": inside, "holdout_coverage_pct": 100 * inside / points,
        "evaluation_status": "retrospective_empirical_audit",
        "limitations": "A single short terminal holdout and overlapping rolling residual dates cannot establish "
                       "calibration. Leads 15–28 have no holdout points and no band extends past day 28.",
        "dashboard_recommendation": "Show Low/Base/High as transparent planning assumptions. "
                                    "Keep the empirical bands in the methodology discussion.",
    }


def watchlist(series, original, alternatives, metrics, metadata, settings):
    as_of = pd.Timestamp(settings["as_of_date"])
    rules = settings["watchlist"]
    rows = []
    for key, label in SERVICES.items():
        forecast = original[key]
        target = metadata["models"][key]
        selected = metrics.loc[metrics["series_id"].eq(key) & metrics["model_id"].eq(target["model"])
                               & metrics["training_policy"].eq(target["policy"])]
        selection_phase = VALIDATION if target["policy"] == FULL else "intervention_matched"
        metric = selected.loc[selected["phase"].eq(selection_phase) & selected["horizon_days"].eq(28)].iloc[0]
        last_28 = series[key].iloc[-settings["recent_baseline_days"]:]
        history_cv = 100 * last_28.std(ddof=0) / last_28.mean()
        alternatives_for_key = alternatives.loc[alternatives["series_id"].eq(key)
                                                & alternatives["variant"].eq(FULL)]
        elapsed = int(forecast["date"].lt(as_of).sum())
        same_date = int(forecast["date"].eq(as_of).sum())
        for view, dates in [("full_90_day", forecast), ("future_only_after_as_of", forecast.loc[forecast["date"].gt(as_of)])]:
            if dates.empty:
                continue
            recent = recent_mean(series[key], pd.DatetimeIndex(dates["date"]), settings["recent_baseline_days"])
            average = float(dates["forecast_trips"].mean())
            delta = average - recent
            pct = 100 * delta / recent
            spread = alternatives_for_key.loc[alternatives_for_key["date"].isin(dates["date"])].groupby(
                "model_id",
            )["forecast_trips"].mean()
            require(len(spread) == 3, "Incomplete model spread")
            model_spread = 100 * (spread.max() - spread.min()) / recent
            loss = -metric["wape_improvement_pp_vs_seasonal_naive"]
            flags = [
                reason for reason, triggered in [
                    ("rolling_28d_wape", metric["wape_pct"] >= rules["rolling_28d_wape_pct"]),
                    ("rolling_28d_naive_deficit", loss >= rules["rolling_28d_naive_deficit_pp"]),
                    ("candidate_forecast_spread", model_spread >= rules["candidate_mean_spread_pct"]),
                ] if triggered
            ]
            material_threshold = rules["material_change_pct"]
            material = "increase" if pct >= material_threshold else "decrease" if pct <= -material_threshold else "within_threshold"
            rows.append(identity(key) | {
                "service_name": label, "view": view, "as_of_date": as_of,
                "data_cutoff": forecast["data_cutoff"].iat[0],
                "forecast_start": dates["date"].min(), "forecast_end": dates["date"].max(),
                "forecast_days": len(dates), "elapsed_forecast_days": int(dates["date"].lt(as_of).sum()),
                "as_of_date_forecast_days": int(dates["date"].eq(as_of).sum()),
                "strictly_future_days": int(dates["date"].gt(as_of).sum()),
                "original_window_elapsed_days": elapsed, "original_window_as_of_days": same_date,
                "weekday_matched_recent_mean": recent, "forecast_mean_daily_trips": average,
                "forecast_total_trips": float(dates["forecast_trips"].sum()),
                "signed_change_trips_per_day": delta, "absolute_change_trips_per_day": abs(delta),
                "change_pct": pct, "direction": "increase" if delta > 0 else "decrease" if delta < 0 else "flat",
                "material_change": material, "recent_28d_daily_cv_pct": history_cv,
                "selected_model": target["model"], "rolling_28d_wape_pct": metric["wape_pct"],
                "rolling_28d_deficit_vs_naive_pp": loss, "candidate_mean_spread_pct_of_recent": model_spread,
                "watch_uncertainty": bool(flags), "uncertainty_reasons": "|".join(flags) or "none",
            })
    watch = pd.DataFrame(rows)
    future = watch.loc[watch["view"].eq("future_only_after_as_of")]
    require(future["forecast_start"].gt(as_of).all(), "Future-only watchlist includes elapsed projections")
    for _, view in watch.groupby("view"):
        require(set(view["series_id"]) == set(SERVICES) and view["forecast_start"].nunique() == 1
                and view["forecast_end"].nunique() == 1 and view["data_cutoff"].nunique() == 1,
                "Watchlist views contain incomparable service forecast dates")
    return watch


def markdown_table(headers, rows):
    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *("| " + " | ".join(map(str, row)) + " |" for row in rows),
    ])


def summary_text(cold, stability, ablation, uncertainty, watch, metadata, settings):
    primary = f"transfer_{round(100 * settings['primary_transfer_weight'])}"
    cold_scores = cold.groupby(["series_id", "arm"])["wape_pct"].mean().unstack()
    cold_rows = []
    for key in SHORT:
        target = cold.loc[cold["series_id"].eq(key)]
        for arm, part in target.groupby("arm", sort=False):
            cold_rows.append((NAMES[key], arm, int(part["folds"].iat[0]), *(
                f"{part.loc[part['horizon_days'].eq(h), 'wape_pct'].iat[0]:.2f}" for h in (7, 14, 28)
            )))
    changes = stability.loc[stability["phase"].eq("forecast_sensitivity") & stability["series_id"].isin(SHORT)]
    decomposition = changes.loc[changes["series_id"].eq(SHAH) & changes["variant"].eq(FULL)
                                & changes["model_id"].eq(ETS)].iloc[0]
    scores = ablation.groupby(["series_id", "variant"])["wape_pct"].mean().unstack()
    future = watch.loc[watch["view"].eq("future_only_after_as_of")]
    network = stability.loc[stability["phase"].eq("network_common_origins")
                            & stability["series_id"].eq(NETWORK) & stability["horizon_days"].eq(28)]
    rules = settings["watchlist"]
    return "\n\n".join([
        "# Module 3 Step 2B forecast experiments",
        "The analyses use saved Step 2 observations, forecasts and origins. They preserve the published "
        "forecasts. Shah Alam headline counts and LRT3 station-origin trips remain separate.",
        "## Cold-start transfer",
        f"The prespecified primary variant is {primary}. Five established service profiles are individually "
        "normalized and given equal weight. Only the target's trailing observations set the forecast level. "
        "The target-only profile tests whether donor information adds anything beyond smoothing. "
        "Station-origin transfer is exploratory across measurement types. WAPE values are percentages.",
        markdown_table(("Target", "Arm", "Folds", "7d", "14d", "28d"), cold_rows),
        f"The primary transfer arm has mean WAPE of {cold_scores.at[SHAH, primary]:.2f}% for headline and "
        f"{cold_scores.at[OD, primary]:.2f}% for station-origin trips. Their Seasonal Naive baselines are "
        f"{cold_scores.at[SHAH, 'seasonal_naive']:.2f}% and {cold_scores.at[OD, 'seasonal_naive']:.2f}%. "
        "Donor profiles improve on target-only smoothing for headline ridership, while the stronger benchmarks "
        "support retaining the original forecasts.",
        "## Forecast stability",
        f"On the headline's full-history Holt–Winters forecast, the 90-day change is "
        f"{decomposition.change_vs_recent_pct:+.2f}% against the recent weekday-matched level. "
        f"The mean contributions in trips/day are {decomposition.holt_level_gap_per_day:+,.0f} from "
        f"the fitted terminal level plus average seasonal effect, {decomposition.holt_mean_damped_trend_per_day:+,.0f} "
        f"from the damped trend, and {decomposition.holt_seasonal_mix_per_day:+,.0f} from the mix of weekdays. "
        "The files include a zero-drift reconstruction, recent-only training and an August 15 boundary "
        "sensitivity. The boundary is a modelling assumption. Seasonal Naive repeats a seven-day profile, "
        "so a change relative to the 28-day benchmark does not imply a growing or declining forecast trend.",
        markdown_table(("Target", "Window", "Model", "90-day mean", "Change vs recent (%)"), [
            (NAMES[row.series_id], row.variant, row.model_id, f"{row.forecast_mean_trips:,.0f}",
             f"{row.change_vs_recent_pct:+.2f}") for row in changes.itertuples()
        ]),
        f"The published service sum has {metadata['network_common_history_days']} complete aligned days. "
        "Direct and bottom-up candidates use the same six rolling origins. The established component models "
        "have longer training histories than the aggregate, so this comparison includes the benefit of "
        "that extra history. The existing terminal holdout is retrospective. The service-sum forecast stays coherent.",
        markdown_table(("Network approach", "Candidate", "28d WAPE"), [
            (row.variant, row.model_id, f"{row.wape_pct:.2f}%") for row in network.itertuples()
        ]),
        "## Ridge feature ablation",
        "A uses weekly features and lags. B adds trend and an annual harmonic. C adds the holiday flag "
        "with a coverage indicator and a minimum of three known holiday training dates. Dates in older "
        "years or marked tentative-only have unknown status. The C–B comparison measures the whole "
        "holiday-and-coverage bundle. Predictive differences do not establish causality.",
        markdown_table(("Service", "A mean WAPE", "B mean WAPE", "C mean WAPE", "B gain pp", "C gain pp"), [
            (NAMES[key], f"{row.A:.2f}%", f"{row.B:.2f}%", f"{row.C:.2f}%",
             f"{row.A-row.B:+.2f}", f"{row.B-row.C:+.2f}") for key, row in scores.iterrows()
        ]),
        "## Empirical uncertainty audit",
        markdown_table(("Lead", "Selection residuals", "Unique dates", "Holdout inside / total", "Coverage"), [
            (f"{row['lead_start']}–{row['lead_end']}", row["selection_residuals"], row["distinct_residual_dates"],
             f"{row['inside']}/{row['holdout_points']}",
             "Unmeasured" if row["coverage_pct"] is None else f"{row['coverage_pct']:.1f}%")
            for row in uncertainty["bands"]
        ]),
        uncertainty["dashboard_recommendation"],
        "## Demand watchlist",
        f"The as-of view uses dates strictly after {settings['as_of_date']}. Elapsed forecast dates and "
        "the as-of day remain labelled projections in the full view. Planning rules flag a demand "
        f"change of ±{rules['material_change_pct']:.0f}% and uncertainty when 28-day WAPE reaches "
        f"{rules['rolling_28d_wape_pct']:.0f}%, the naive deficit reaches "
        f"{rules['rolling_28d_naive_deficit_pp']:.0f} percentage points, or the range of candidate "
        f"daily means reaches {rules['candidate_mean_spread_pct']:.0f}% of the recent baseline. "
        "Uncertainty is a monitoring cue. The watchlist contains no capacity assessment.",
        markdown_table(("Service", "Future mean/day", "Change trips/day", "Change (%)", "Uncertainty"), [
            (row.service_name, f"{row.forecast_mean_daily_trips:,.0f}",
             f"{row.signed_change_trips_per_day:+,.0f}", f"{row.change_pct:+.2f}",
             "Watch" if row.watch_uncertainty else "No flag") for row in future.itertuples()
        ]),
        "Run reproducibly from the repository root using the command in the module's INNOVATION.md.",
    ]) + "\n"
