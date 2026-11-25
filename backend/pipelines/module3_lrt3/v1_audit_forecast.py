"""Independent forecast, forecast-review metric and demand-pattern checks."""
from collections import defaultdict
from datetime import date, timedelta
from math import expm1, isfinite, pi, sin, cos, sqrt
from statistics import mean

from v1_audit import OUT, PIPE, asset, csv_rows, identical, iso, parquet, read_json


SHAH = "rail_lrt_shah_alam"
OD = "lrt3_station_origin_od"
NET = "rapid_rail_published_sum"
NAIVE = "seasonal_naive_7"
HOLT = "holt_winters_additive_damped"
RIDGE = "calendar_lag_ridge"
SETTINGS = PIPE / "forecast_settings.json"
META = OUT / "forecast_metadata.json"
DAY = timedelta(days=1)


def present(value):
    return value is not None and isfinite(value)


def chron(value):
    return date.fromisoformat(iso(value)) if not isinstance(value, str) else date.fromisoformat(value[:10])


def history():
    result = defaultdict(dict)
    for r in parquet(OUT / "network_service_history.parquet"):
        if r["in_model_calendar"]:
            result[r["series_id"]][chron(r["date"])] = r["actual_trips"] if present(r["actual_trips"]) else None
    for r in parquet(OUT / "lrt3_daily.parquet"):
        if r["in_observed_demand_window"]:
            result[OD][chron(r["date"])] = r["station_origin_trips"]
    return result


def forecasts():
    result = defaultdict(dict)
    for name in ("network_service_forecast.parquet", "lrt3_forecast_daily.parquet"):
        for row in parquet(OUT / name):
            result[row["series_id"]][chron(row["date"])] = row
    return result


def baseline(observed, days, cutoff=None, size=28):
    last = cutoff or max(observed)
    selected = [(when, value) for when, value in observed.items() if last - (size - 1) * DAY <= when <= last and present(value)]
    profile = {i: mean(x for when, x in selected if when.weekday() == i) for i in range(7)}
    return mean(profile[when.weekday()] for when in days)


def score_pairs(pairs):
    pairs = [(x, y) for x, y in pairs if present(x)]
    errors = [abs(y - x) for x, y in pairs]
    total = sum(abs(x) for x, y in pairs)
    ratios = [abs((y - x) / x) for x, y in pairs if x]
    return {"scored_predictions": len(pairs), "mape_excluded_zero_count": len(pairs) - len(ratios),
            "mae": mean(errors) if errors else None,
            "rmse": sqrt(mean([err * err for err in errors])) if errors else None,
            "mape_pct": 100 * mean(ratios) if ratios else None,
            "wape_pct": 100 * sum(errors) / total if total else None}


def holiday_sets(meta):
    records = meta["holidays"]["calendar"]
    confirmed = {chron(r["date"]) for r in records if not r["source_marks_date_tentative"]}
    all_dated = {chron(r["date"]) for r in records}
    return confirmed, all_dated - confirmed, set(meta["holidays"]["covered_years"])


def methodology(a):
    backtests = list(parquet(OUT / "backtest_predictions.parquet"))
    config = read_json(SETTINGS)
    metadata = read_json(META)
    unique = {(r["series_id"], r["model_id"], r["training_policy"], r["phase"], r["origin"], r["date"]) for r in backtests}
    chronological = all(r["train_start"] <= r["train_end"] == r["origin"] < r["date"] and
                        (r["date"] - r["origin"]).days == r["lead_day"] and r["forecast_trips"] >= 0 for r in backtests)
    last_selection = defaultdict(lambda: date.min)
    first_holdout = {}
    for r in backtests:
        target, phase = r["series_id"], r["phase"]
        if phase in ("rolling_validation", "intervention_matched"):
            last_selection[target] = max(chron(r["date"]), last_selection[target])
        elif phase == "terminal_holdout":
            first_holdout[target] = min(chron(r["date"]), first_holdout.get(target, date.max))
    separated = all(last_selection[key] < when for key, when in first_holdout.items())
    network_origin = min(chron(r["origin"]) for r in backtests if r["series_id"] == NET and r["phase"] == "terminal_holdout")
    network_k = metadata["network"]["components"]
    overlapping = sum((r["phase"] in ("rolling_validation", "intervention_matched") and r["series_id"] in network_k
                       and chron(r["date"]) > network_origin) for r in backtests)
    a.check("Stored temporal keys, origin cutoffs and nonnegative forecasts", len(unique) == len(backtests) and chronological,
            "All model, policy, origin and date keys are unique. Every scored lead matches its calendar difference and follows its training endpoint.",
            source="backtest_predictions.parquet", actual=f"{len(backtests):,} records")
    a.check("Selection and original terminal windows are disjoint", separated and not overlapping and len(first_holdout) == 8,
            "Checked each target and required all six original component selections to end by the network holdout origin.",
            source="backtest_predictions.parquet; forecast_evaluation.py:46–65,149–199; forecast_results.py:84–107", actual=f"Network holdout origin {network_origin}; {overlapping} overlapping component rows")
    meta_choice = []
    evaluation = list(csv_rows(OUT / "model_backtesting.csv"))
    for key, model in metadata["models"].items():
        scores = {candidate: mean(r["wape_pct"] for r in evaluation if r["series_id"] == key
                                  and r["model_id"] == candidate and r["phase"] == "rolling_validation" and r["training_policy"] == "full_eligible_history")
                  for candidate in (NAIVE, HOLT, RIDGE)}
        meta_choice.append(all(identical(value, model["rolling_full_scores"][candidate]) for candidate, value in scores.items())
                           and model["model"] == min(scores, key=scores.get) and model["policy"] == "full_eligible_history")
    a.check("Model-selection score and hyperparameter scope", all(meta_choice),
            "Recomputed the unweighted mean of horizon WAPEs and selection for each individual target. Inspected training-only Holt grid loss and Ridge centering, scaling and fixed penalty.",
            source="model_backtesting.csv; forecast_models.py:31–56,79–110; forecast_evaluation.py:140–149", actual=f"{sum(meta_choice)}/{len(meta_choice)}")
    import numpy as np
    import pandas as pd
    from forecast_evaluation import predict_at
    from forecast_inputs import HolidayCalendar
    from forecast_models import causal_fill

    # Call the public predictor on two crafted time-series inputs. Fit just three models once per input.
    index = pd.date_range("2025-01-06", periods=88)
    values = pd.Series(240 + (np.arange(88) % 7) * 6 + np.arange(88) / 4, index=index)
    values.iloc[19] = np.nan
    origin = index[62]
    changed = values.copy()
    changed.loc[changed.index > origin] = -5e8
    calendar = HolidayCalendar(frozenset(), frozenset(), [], [])
    equal = {}
    for model in (NAIVE, HOLT, RIDGE):
        result, _, _, model_params = predict_at(values, model, origin, 28, "full_eligible_history", False, calendar, config)
        mutated = predict_at(changed, model, origin, 28, "full_eligible_history", False, calendar, config)[0]
        equal[model] = bool(np.array_equal(result, mutated) and np.all(result >= 0))
        if model == RIDGE:
            equal[model] &= model_params["features"][-2:] == ["lag_7_days", "lag_14_days"]
        if model == NAIVE:
            equal[model] &= bool(np.array_equal(result, np.tile(values.loc[:origin].to_numpy()[-7:], 4)))
    filled, number = causal_fill(values.loc[:origin])
    a.check("Targeted post-origin mutation, causal fill and recursive lags", all(equal.values()) and number == 1 and filled[19] == values.iloc[12],
            "Executed three 28-lead forecasts with a synthetic series, mutated every post-origin observation, and confirmed identical predictions. Inspected closed recursive lag indexing.",
            source="forecast_evaluation.py:24–44; forecast_models.py:17–28,79–110", actual=str(equal))
    confirmed, tentative, _ = holiday_sets(metadata)
    code = (PIPE / "forecast_results.py").read_text(encoding="utf-8")
    forecast = forecasts()
    tentative_in_served = sorted({when.isoformat() for key in forecast for when in tentative.intersection(forecast[key]) if forecast[key][when]["verified_holiday"]})
    a.check("Tentative calendar dates retain evidence status", not tentative_in_served and "verified_holiday=future.isin(holidays.dates)" not in code,
            "Tentative-only schedule dates are included in the base calendar and flagged as verified by Step 2. Step 2B ablation correctly treats tentative-only dates as unknown.",
            source="forecast_inputs.py:298–331; forecast_models.py:72–75; forecast_results.py:31–39; innovation_experiments.py:315–337",
            actual=f"{len(tentative)} tentative-only dates in archived calendar; flagged forecast dates {tentative_in_served}", issues="M3-02")
    a.add("Historical point-in-time feature and demand vintages", "NOT VERIFIED",
          "The available archive is a retrospectively assembled snapshot. Historical revisions and holiday announcement timing by origin are unverified. The synthetic test concerns post-origin observed demand only.",
          source="forecast_metadata.json; Methodology.tsx:23–30")
    a.details.update(backtest_rows=len(backtests), network_holdout_origin=network_origin.isoformat(),
                     first_holdout_dates={k:v.isoformat() for k,v in first_holdout.items()}, mutation_test=equal,
                     confirmed_holiday_dates=len(confirmed), tentative_only_dates=sorted(x.isoformat() for x in tentative))


def metrics(a):
    backtests = list(parquet(OUT / "backtest_predictions.parquet"))
    groups = defaultdict(list)
    fields = ("series_id", "phase", "model_id", "training_policy")
    for row in backtests:
        groups[tuple(row[key] for key in fields)].append(row)
    metrics_rows = list(csv_rows(OUT / "model_backtesting.csv"))
    mismatches = []
    distinct_examples = {}
    mismatched_baselines = 0
    for r in metrics_rows:
        ids = tuple(r[key] for key in fields)
        rows = [item for item in groups[ids] if item["lead_day"] <= r["horizon_days"]]
        independent = score_pairs((x["actual_trips"], x["forecast_trips"]) for x in rows)
        independent["folds"] = len({x["origin"] for x in rows})
        independent["missing_actual_count"] = len(rows) - independent["scored_predictions"]
        if not all(identical(independent[key], r[key]) for key in independent):
            mismatches.append((*ids, r["horizon_days"]))
        if r["phase"] == "rolling_validation" and r["horizon_days"] == 28 and r["series_id"] in (OD, SHAH, NET):
            distinct_examples[r["series_id"]] = {"scored_predictions": independent["scored_predictions"],
                                                "distinct_actual_dates": len({x["date"] for x in rows if present(x["actual_trips"])})}
        baseline = r["seasonal_naive_wape_pct"]
        if baseline is not None:
            other = next(x for x in metrics_rows if x["series_id"] == r["series_id"] and x["phase"] == r["phase"]
                         and x["horizon_days"] == r["horizon_days"] and x["training_policy"] == "full_eligible_history"
                         and x["model_id"] in (NAIVE, f"bottom_up_{NAIVE}"))
            mismatched_baselines += not identical(other["wape_pct"], baseline) or not identical(baseline - r["wape_pct"], r["wape_improvement_pp_vs_seasonal_naive"])
    a.check("Independent WAPE, MAE, RMSE, MAPE and fold aggregation", not mismatches and not mismatched_baselines,
            "Pooled scored origin/lead pairs at each cumulative horizon. WAPE uses total absolute actuals, MAE/RMSE retain observed zeros, MAPE excludes zeros; missing actuals are excluded.",
            source="backtest_predictions.parquet; model_backtesting.csv", actual=f"{len(metrics_rows)-len(mismatches)}/{len(metrics_rows)} rows; baseline mismatches {mismatched_baselines}", tolerance="1e-8 absolute; 1e-11 relative")
    from forecast_evaluation import error_metrics
    zero = error_metrics([0, float("nan"), 0], [4, 100, 0])
    a.check("Zero and missing metric behavior", zero["mae"] == 2 and not isfinite(zero["wape_pct"]) and not isfinite(zero["mape_pct"])
            and zero["scored_predictions"] == 2 and zero["mape_excluded_zero_count"] == 2,
            "Executed the metric implementation on two observed zeros plus one missing actual.", source="forecast_evaluation.py:87–103")
    metadata = read_json(META)
    mature = {r["series_id"]: r["wape_pct"] for r in metrics_rows if r["series_id"] in metadata["models"]
              and metadata["models"][r["series_id"]]["mature"] and r["phase"] == "rolling_validation" and r["horizon_days"] == 28
              and r["model_id"] == metadata["models"][r["series_id"]]["model"]
              and r["training_policy"] == metadata["models"][r["series_id"]]["policy"]}
    net = {r["model_id"]: r["wape_pct"] for r in metrics_rows if r["series_id"] == NET and r["phase"] == "terminal_holdout" and r["horizon_days"] == 14}
    a.check("Network terminal holdout and mature 28-day metrics", len(mature) == 5 and
            round(net["bottom_up_selected_components"], 2) == 3.73 and round(net["bottom_up_seasonal_naive_7"], 2) == 2.54,
            "Monthly or mean-across-horizons scores were excluded. The selected ensemble loses the 14-day comparison and the UI discloses it.",
            source="model_backtesting.csv; Methodology.tsx:31–36; tabs/DemandForecast.tsx:86–89", actual=f"mature {mature}; network {net}")
    a.check("Rendered score count labels preserve dependence", all(x["scored_predictions"] == x["distinct_actual_dates"] for x in distinct_examples.values()),
            "Rolling folds are valid and intentionally overlapping. The frontend column says Scored days, even where scored origin/date predictions exceed distinct days.",
            source="tabs/DemandForecast.tsx:68–73,106–117; tabs/DemandDrivers.tsx:111–116",
            actual=str(distinct_examples), issues="M3-05")
    a.add("Direct 90-day accuracy", "NOT VERIFIED", "The archive evaluates lead times 7, 14 and 28 where available. Dashboard text avoids a direct 90-day accuracy claim.",
          source="forecast_evaluation.py:46–65; Methodology.tsx")
    a.details.update(metric_rows=len(metrics_rows), mismatches=mismatches, mature_28_day_wape=mature,
                     network_holdout_14_day_wape=net, repeated_actual_comparisons=distinct_examples)


def forecast_logic(a):
    pub = forecasts()
    past = history()
    ui = asset("network")
    cut = date.fromisoformat(ui["asOf"])
    components = [key for key in pub if key not in (NET, OD)]
    coherence = all(identical(r["forecast_trips"], sum(pub[key][day]["forecast_trips"] for key in components)) for day, r in pub[NET].items())
    history_ok = all(identical(x, sum(past[key][when] for key in components)) for when, x in past[NET].items())
    a.check("Published network coherence and source target distinction", len(components) == 6 and set(components) == set(ui["components"]) and coherence and history_ok
            and ui["targets"]["rail_lrt_ampang"]["service_name"] == "LRT Ampang / Sri Petaling",
            "Reconstructed daily bottom-up network forecast and common history from six headline services. LRT3 station origins are separate.",
            source="network_service_forecast/history.parquet; network.json")
    network_windows, od_windows = {}, {}
    checked = 0
    for key, points in pub.items():
        dates = sorted(points)
        captured = chron(points[dates[0]]["data_cutoff"])
        assert dates == [captured + i * DAY for i in range(1, 91)]
        assert max(past[key]) == captured
        for n in (30,60,90):
            for scope in ("full", "future"):
                view = [d for d in dates[:n] if scope == "full" or d > cut]
                values = [points[d]["forecast_trips"] for d in view]
                matched = baseline(past[key], view)
                expected = {"total": sum(values), "average": mean(values), "baseline": matched, "delta": mean(values) - matched,
                            "change_pct": 100 * (mean(values) - matched) / matched, "days": len(view),
                            "start": min(view).isoformat(), "end": max(view).isoformat()}
                stored = next(r for r in ui["outlook"] if (r["series_id"], r["horizon"], r["scope"]) == (key, n, scope))
                checked += all(identical(value, stored[field]) for field, value in expected.items())
                if key == NET:
                    network_windows[f"{n}_{scope}"] = expected
                if key == OD:
                    od_windows[f"{n}_{scope}"] = expected
    a.check("All cutoff-horizon/view combinations reproduce displayed KPIs", checked == 48 and str(cut) == "2026-11-24"
            and network_windows["90_future"]["days"] == 66 and network_windows["30_future"]["days"] == 6
            and od_windows["90_future"]["days"] == 86
            and (network_windows["90_full"]["start"], network_windows["90_full"]["end"], od_windows["90_full"]["start"], od_windows["90_full"]["end"]) ==
                  ("2026-11-01", "2027-01-29", "2026-11-21", "2027-02-18"),
            "Independently sliced ordered leads before applying the strict analysis-date filter and rebuilt recent 28-day weekday-level means.",
            source="network_service_forecast/history.parquet; lrt3_forecast_daily.parquet; network.json", actual=f"{checked}/48; 90-day future network {network_windows['90_future']}")
    kpi = network_windows["90_future"]
    a.check("Future Outlook screenshot references", (round(kpi["total"]), round(kpi["average"]), round(kpi["change_pct"],2), kpi["days"]) == (63776402,966309,-1.88,66),
            "Recalculated from daily forecast and historical rows; whole trips and two decimal percentage points.",
            source="network_service_forecast/history.parquet; analytics.ts:54–56; FutureOutlook.tsx:41–49", actual=str(kpi))
    watches = list(csv_rows(OUT / "demand_watchlist.csv"))
    watch_checks = sum(identical(next(r for r in ui["outlook"] if r["series_id"] == w["series_id"] and
          r["horizon"] == 90 and r["scope"] == ("full" if w["view"] == "full_90_day" else "future"))["total"], w["forecast_total_trips"]) for w in watches)
    a.check("Saved 90-day watchlist scope", watch_checks == len(watches) == 12,
            "Saved materiality is aligned with its fixed 90-day comparison, which is labeled in the panel.", source="demand_watchlist.csv; FutureOutlook.tsx:74–81")
    a.add("Watchlist and horizon control consistency", "FAIL",
          "The 30-/60-day controls recalculate cards and rankings while retaining the window-dependent watchlist in a separate 90-day panel. Row reliability cells use flags that include 90-day candidate spread and link text gives no target horizon.",
          source="tabs/FutureOutlook.tsx:25–34,68–81", expected="Horizon-independent warning or explicitly scoped 90-day diagnostic in ranking",
          actual="30-day future KPI: 6 dates; 90-day watchlist: 66 dates", issues="M3-03")
    a.add("Reference-day display excludes anchor from future evidence", "FAIL",
          "Both chart implementations include the reference-date data point in both elapsed and future lines in the full time series. The future-only KPI correctly uses a strict greater-than test.",
          source="tabs/FutureOutlook.tsx:53–58; tabs/DemandForecast.tsx:47–54", expected="Future evidence dated from 25 November", actual="Future-labeled trace also starts 24 November", issues="M3-04")
    a.details.update(network_windows=network_windows, lrt3_windows=od_windows, calculated_combinations=checked, verified_watchlist_rows=watch_checks)


def weekday_shape(series, end, days):
    rows = {when: value for when, value in series.items() if end - (days - 1) * DAY <= when <= end and present(value)}
    week = [mean(value for when, value in rows.items() if when.weekday() == wd) for wd in range(7)]
    level = mean(week)
    return [value / level for value in week], level, max(rows)


def quantile(values, probability):
    ordered = sorted(values)
    rank = probability * (len(ordered) - 1)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] * (1 - (rank - low)) + ordered[high] * (rank - low)


def research(a):
    config = read_json(PIPE / "innovation_settings.json")
    mc = read_json(SETTINGS)
    meta = read_json(META)
    past = history()
    backtests = list(parquet(OUT / "backtest_predictions.parquet"))
    donors = [k for k in meta["network"]["components"] if k != SHAH]
    saved = {(row["series_id"], chron(row["origin"]), row["model_id"], row["lead_day"]): row for row in backtests if row["phase"] == "rolling_validation"}
    fold_csv = list(csv_rows(OUT / "cold_start_fold_metrics.csv"))
    cold_csv = list(csv_rows(OUT / "cold_start_backtesting.csv"))
    pools = defaultdict(list)
    cold_ok = 0
    for row in fold_csv:
        key, arm, width = row["series_id"], row["arm"], row["horizon_days"]
        origin = chron(row["origin"])
        lead = [origin + i * DAY for i in range(1, width + 1)]
        profile, _, last = weekday_shape(past[key], origin, config["profile_lookback_days"])
        _, level, _ = weekday_shape(past[key], origin, config["recent_baseline_days"])
        d = [weekday_shape(past[donor], origin, config["profile_lookback_days"]) for donor in donors]
        weight = row["donor_weight"]
        donor_shape = [mean(r[0][i] for r in d) for i in range(7)]
        if arm in ("seasonal_naive", "step2_selected"):
            baseline_id = NAIVE if arm == "seasonal_naive" else meta["models"][key]["model"]
            pred = [saved[key, origin, baseline_id, i]["forecast_trips"] for i in range(1, width + 1)]
            provenance = row["last_donor_observation"] is None
        else:
            pred = [level * ((1 - weight) * profile[x.weekday()] + weight * donor_shape[x.weekday()]) for x in lead]
            provenance = identical(level, row["target_level"]) and str(last) == row["last_target_observation"] and (
                row["last_donor_observation"] == str(max(item[2] for item in d)) if weight else row["last_donor_observation"] is None)
        pairs = list(zip([past[key][day] for day in lead], pred))
        pools[key, arm, width].extend(pairs)
        cold_ok += provenance and all(identical(value, row[field]) for field, value in score_pairs(pairs).items())
    agg = 0
    for row in cold_csv:
        key = row["series_id"], row["arm"], row["horizon_days"]
        agg += all(identical(value, row[field]) for field, value in score_pairs(pools[key]).items())
    negatives = {}
    for key in (SHAH, OD):
        arms = {arm: mean(r["wape_pct"] for r in cold_csv if r["series_id"] == key and r["arm"] == arm)
                for arm in ("seasonal_naive", "target_profile", "transfer_25", "transfer_50", "transfer_75")}
        negatives[key] = arms
    a.check("Cold-start origins, donors, weights and pooled scores", cold_ok == len(fold_csv) == 198 and agg == len(cold_csv) == 36 and
            all(negatives[target][arm] > negatives[target]["seasonal_naive"] for target in negatives for arm in ("transfer_25","transfer_50","transfer_75")),
            "Reconstructed date-bounded donor shapes separately and target-only level, matched actual dates, and recalculated all pooled and per-fold scores. No folds trained after their origin.",
            source="cold_start_fold_metrics.csv; cold_start_backtesting.csv; archived histories; innovation_experiments.py:73–156",
            actual=f"folds {cold_ok}/198; pooled {agg}/36; {negatives}")
    alternatives = defaultdict(dict)
    for r in parquet(OUT / "alternative_forecasts.parquet"):
        alternatives[r["series_id"], r["variant"], r["model_id"]][chron(r["date"])] = r["forecast_trips"]
    stability = {(r["series_id"], r["variant"], r["model_id"]): r for r in csv_rows(OUT / "model_stability.csv") if r["phase"] == "forecast_sensitivity"}
    derived = {}
    for label, key, window, model in (
        ("Shah full Holt–Winters", SHAH, "full_eligible_history", HOLT), ("Shah Seasonal Naive", SHAH, "full_eligible_history", NAIVE),
        ("Shah zero drift", SHAH, "holt_without_drift", HOLT), ("Shah 56-day Holt–Winters", SHAH, "recent_window", HOLT),
        ("LRT3 origins repeated weekly profile", OD, "full_eligible_history", NAIVE),
    ):
        points = alternatives[key, window, model]
        matched = baseline(past[key], points)
        change = 100 * (mean(points.values()) / matched - 1)
        derived[label] = {"mean": mean(points.values()), "delta_pct": change, "matches": identical(stability[key, window, model]["change_vs_recent_pct"], change)}
    fit = meta["models"][SHAH]["final_fit"]
    phi = fit["damp"]
    x = alternatives[SHAH, "full_eligible_history", HOLT]
    z = list(x.values())
    coef = [sum(phi**i for i in range(1, lead + 1)) for lead in range(1,91)]
    trend = (z[7] - z[0]) / (coef[7] - coef[0]) * mean(coef)
    decomp = stability[SHAH, "full_eligible_history", HOLT]
    a.check("Shah Alam training-window and trend sensitivity, plus LRT3 repeated-week baseline", all(r["matches"] for r in derived.values()) and
            [round(r["delta_pct"],2) for r in derived.values()] == [-21.40,-2.71,1.81,3.46,2.97] and identical(trend, decomp["holt_mean_damped_trend_per_day"]),
            "Rebuilt 28-day weekday benchmarks and Shah Alam damped trend from saved same-weekday alternative predictions.",
            source="alternative_forecasts.parquet; model_stability.csv; forecast_metadata.json; innovation_experiments.py:161–195", actual=str(derived))
    a.add("Intervention boundary and direct-versus-bottom-up caveats are visible at point of use", "FAIL",
          "Paid-service date is shown as an operator milestone, while the sensitivity selector presents its window without explaining its provisional modelling role, two matched headline folds, and no policy switch. The network panel does not state mature components have longer histories or that the reused Step 2B terminal comparison is retrospective.",
          source="tabs/DemandForecast.tsx:123–152,198–202; Methodology.tsx:39–46; innovation_summary.md:28,54",
          issues="M3-06")
    scenarios = list(csv_rows(OUT / "lrt3_scenarios.csv"))
    base = forecasts()[OD]
    scenario_ok = 0
    ui = asset("network")
    for r, exported in zip(scenarios, ui["scenarios"], strict=True):
        day, lead, low, middle, high = exported
        expected = base[chron(day)]["forecast_trips"]
        scenario_ok += low <= middle <= high and r["date"] == day and r["lead_day"] == lead and all(identical(x, y) for x,y in (
            (r["base_trips"], expected), (middle, expected), (low, expected * (1 + mc["scenarios"]["low_day_90_offset_from_base"] * lead / 90)),
            (high, expected * (1 + mc["scenarios"]["high_day_90_offset_from_base"] * lead / 90))))
    totals = {n: {name: sum(r[name + "_trips"] for r in scenarios[:n]) for name in ("low","base","high")} for n in (30,60,90)}
    a.check("Planning scenario formula, ordering and cumulative totals", scenario_ok == 90 and all(v["low"] <= v["base"] <= v["high"] for v in totals.values()),
            "Applied the linear 20% end-of-horizon offsets to published OD daily values. Frontend labels scenarios as assumptions, without calibrated intervals.",
            source="lrt3_scenarios.csv; network.json; tabs/DemandForecast.tsx:27–64", actual=str(totals))
    scores = [r for r in backtests if r["series_id"] == OD and r["model_id"] == meta["models"][OD]["model"]
              and r["training_policy"] == meta["models"][OD]["policy"] and present(r["actual_trips"])]
    interval = read_json(OUT / "uncertainty_audit.json")
    contained = counted = 0
    interval_ok = True
    for band in interval["bands"]:
        candidate = [r for r in scores if band["lead_start"] <= r["lead_day"] <= band["lead_end"]]
        residuals = [r["actual_trips"] - r["forecast_trips"] for r in candidate if r["phase"] == "rolling_validation"]
        low, high = [quantile(residuals,p) for p in interval["nominal_residual_quantiles"]]
        holdout = [r for r in candidate if r["phase"] == "terminal_holdout"]
        inside = sum(low <= r["actual_trips"] - r["forecast_trips"] <= high for r in holdout)
        interval_ok &= identical(low, band["lower_error_quantile_trips"]) and identical(high, band["upper_error_quantile_trips"]) and inside == band["inside"]
        contained += inside
        counted += len(holdout)
    a.check("Empirical residual bands and held-out coverage", interval_ok and (contained,counted) == (6,14),
            "Recomputed residual quantiles and containment from prediction records. One origin and no held-out leads past day 14.",
            source="backtest_predictions.parquet; uncertainty_audit.json; tabs/DemandForecast.tsx:166–173", actual=f"{contained}/{counted}")
    a.details.update(cold_start_mean_wape=negatives, shah_illustrative_outlooks=derived, shah_trend_trips_per_day=trend,
                     shah_matched_intervention_folds=len(meta["models"][SHAH]["intervention"]["matched_origins"]),
                     planning_horizon_totals=totals, empirical_coverage=[contained,counted])


def audit_ridge(train, values, future, config, variant, confirmed, tentative, years):
    import numpy as np

    last = train[-1]
    damping = config["ridge_future_trend_damping_days"]
    annual = len(train) >= config["ridge_annual_min_training_days"]
    lag_max = max(config["ridge_lags_days"])
    use_holiday = variant == "C" and sum(day in confirmed for day in train[lag_max:]) >= 3
    dates = [*train, *future]
    calendar = []
    for day in dates:
        weekday = [float(day.weekday() == i) for i in range(6)] + [float(day.weekday() >= 5)]
        if variant != "A":
            e = (day-last).days
            weekday.append(e if e <= 0 else -damping * expm1(-e/damping))
            if annual:
                angle = 2*pi*(day-date(2000,1,1)).days/365.2425
                weekday.extend([sin(angle),cos(angle)])
        if use_holiday:
            available = day.year in years and day not in tentative
            weekday.extend([float(available),float(available and day in confirmed)])
        calendar.append(weekday)
    seq = list(values)
    lags = config["ridge_lags_days"]
    features = np.array([calendar[i] + [seq[i-lag] for lag in lags] for i in range(lag_max,len(train))])
    y = np.array(seq[lag_max:])
    centre, scale = features.mean(axis=0), features.std(axis=0)
    scale[scale < 1e-12] = 1
    X = (features-centre)/scale
    mu = y.mean()
    beta = np.linalg.solve(X.T@X + config["ridge_penalty"]*np.eye(len(centre)), X.T@(y-mu))
    for i in range(len(train),len(dates)):
        row = np.array(calendar[i] + [seq[i-lag] for lag in lags])
        seq.append(max(0,float(mu+(row-centre)/scale@beta)))
    return seq[len(train):]


def drivers(a):
    cfg, meta = read_json(SETTINGS), read_json(META)
    past = history()
    confirmed, tentative, years = holiday_sets(meta)
    known = confirmed | tentative
    pattern = list(csv_rows(OUT / "demand_patterns.csv", ("group",)))
    ui = asset("patterns")["patterns"]
    coverage_checks = 0
    mismatches = []
    holiday_changed = {}
    for r in pattern:
        group, key = r["group"], r["series_id"]
        end = max(past[key])
        observed = {d:v for d,v in past[key].items() if v is not None}
        in_year = {d:v for d,v in observed.items() if (end-d).days <=364}
        tag = r["pattern"]
        if tag == "day_of_week":
            values = [v for d,v in in_year.items() if d.strftime("%A") == group]
        elif tag == "day_type":
            values = [v for d,v in in_year.items() if (d.weekday() < 5) == (group == "Weekday")]
        elif tag == "calendar_month":
            values = [v for d,v in observed.items() if d.isoformat().startswith(group)]
            exported = next(row for row in ui if row["series_id"] == key and row["pattern"] == tag and row["group"] == group)
            coverage_checks += sum(values) == exported["observed_total_trips"] and len(values) <= r["expected_days"]
        elif tag == "holiday_vs_comparable_nonholiday":
            def contrast(holidays, allowed):
                entries = []
                for day,v in in_year.items():
                    if day not in holidays:
                        continue
                    x = [n for d,n in in_year.items() if d.year in years and allowed(d) and d.weekday() == day.weekday() and abs((d-day).days) <= 28]
                    if x:
                        entries.append((v,mean(x)))
                return entries
            same_calendar = contrast(known, lambda d: d not in known)
            evidence = contrast(confirmed, lambda d: d not in known)
            v1, audited = (100*(mean(x for x,y in entry)/mean(y for x,y in entry)-1) for entry in (same_calendar,evidence))
            if not identical(v1,r["difference_pct"]) or len(same_calendar) != r["reference_observations"]:
                mismatches.append((key,tag,group))
            holiday_changed[key] = {"v1_days":len(same_calendar), "confirmed_days":len(evidence), "v1_pct":v1, "confirmed_only_pct":audited}
            values = [v for v,_ in same_calendar]
        elif tag == "month_of_year_recent_730_days":
            values = [v for d,v in observed.items() if (end-d).days <730 and d.month == int(group)]
        else:
            values = [v for d,v in observed.items() if (end-d).days < 28]
        if not (len(values) == r["observed_days"] and identical(mean(values),r["mean_daily_trips"])):
            mismatches.append((key,tag,group))
    a.check("Weekly, monthly, holiday and seasonal pattern arithmetic", not mismatches and coverage_checks == sum(r["pattern"] == "calendar_month" for r in pattern),
            "Grouped published dates independently. Monthly totals and active days exclude missing values; incomplete months retain the full calendar denominator. Holiday controls use the mean of matched non-holiday days within ±28 days, then average across holiday dates.",
            source="demand_patterns.csv; patterns.json; forecast_results.py:229–284", actual=f"{len(pattern)} rows, {coverage_checks} monthly rows")
    a.check("Observed holiday comparison uses confirmed classifications", all(x["v1_days"]==x["confirmed_days"] for x in holiday_changed.values()),
            "Tentative date and substitution pairs affect historic demand contrasts. Removing tentative-only days also keeps them out of ordinary controls.",
            source="forecast_results.py:274–284; tabs/DemandDrivers.tsx:76–82", actual=str(holiday_changed), issues="M3-02")
    all_rows = list(csv_rows(OUT / "feature_ablation.csv"))
    mean_by_horizon = {lead:{k:mean(r["wape_pct"] for r in all_rows if r["variant"]==k and r["horizon_days"]==lead) for k in "ABC"} for lead in (7,14,28)}
    mean_all = {k:mean(r["wape_pct"] for r in all_rows if r["variant"]==k) for k in "ABC"}
    kj = "rail_lrt_kj"
    fold_pool = defaultdict(list)
    known_total = design_total = 0
    counts = []
    for origin in map(chron, meta["models"][kj]["plan"]["origins"]):
        train = [origin - j*DAY for j in range(729,-1,-1)]
        future = [origin+i*DAY for i in range(1,29)]
        values = [past[kj][day] for day in train]
        design = train[14:]
        design_total += len(design)
        known_total += sum(d.year in years and d not in tentative for d in design)
        counts.append(sum(d in confirmed for d in design))
        for variant in "ABC":
            pred = audit_ridge(train,values,future,cfg,variant,confirmed,tentative,years)
            fold_pool[variant].append(list(zip([past[kj][d] for d in future],pred)))
    checked = 0
    for row in all_rows:
        if row["series_id"] != kj:
            continue
        pairs = [pair for fold in fold_pool[row["variant"]] for pair in fold[:row["horizon_days"]]]
        checked += all(identical(value,row[field],1e-7) for field,value in score_pairs(pairs).items()) and identical(
            row["train_rows_with_known_holiday_status_pct"],100*known_total/design_total) and row["training_confirmed_holiday_rows_min"]==min(counts)
    matched_aggregate = [round(mean_by_horizon[28][k],2) for k in "ABC"] == [8.93,7.06,6.34]
    a.check("A/B/C ablation results and aggregation definition", len(all_rows)==45 and matched_aggregate and checked ==9,
            "Unweighted average of five service WAPEs at lead ≤28 reproduces the reference. Additionally rebuilt Ridge A/B/C forecasts for one mature route on all eight origins and verified nine metric rows and known holiday coverage.",
            source="feature_ablation.csv; innovation_experiments.py:315–407", actual=f"28-day {mean_by_horizon[28]}; all horizons {mean_all}; known coverage {known_total/design_total*100}%", tolerance="1e-7 absolute for representative re-fit")
    a.add("Ablation overview and experiment limitations", "FAIL",
          "The dashboard exposes per-target rows but defaults to a network target without an experiment. It omits the five-service aggregate, confirmed-versus-tentative date description and the caveat that C adds a feature bundle.",
          source="tabs/DemandDrivers.tsx:99–118; Methodology.tsx:38–40; innovation_summary.md:66–76", issues="M3-07")
    a.add("Calendar cell render and interactive behavior", "NOT VERIFIED", "Compared the heatmap inputs and missing-value path in source. Runtime verification is deferred by the audit brief.",
          source="tabs/DemandDrivers.tsx:14–35,61–72")
    a.details.update(pattern_rows=len(pattern), monthly_rows=coverage_checks, holiday_confirmed_only_comparisons=holiday_changed,
                     ablation_service_mean_by_horizon=mean_by_horizon, ablation_service_mean_all_horizons=mean_all,
                     kelana_jaya_ablation_rows_independently_refit=checked, holiday_known_training_pct=100*known_total/design_total)
