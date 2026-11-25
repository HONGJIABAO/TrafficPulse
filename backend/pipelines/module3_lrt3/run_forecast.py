"""Execute Step 2 from local inputs and publish validated forecast artifacts."""

import json
import os
import platform
from filecmp import cmp
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory

if __name__ == "__main__":
    for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "BLIS_NUM_THREADS"):
        os.environ[variable] = "2"

import numpy as np
import pandas as pd
import pyarrow as pa
from PIL import Image

from forecast_checkpoints import checkpointed_fit, context_fingerprint
from forecast_evaluation import HOLDOUT, VALIDATION, metrics_by_horizon, target_and_unit
from forecast_inputs import INTERVENTIONS, NETWORK, OD, SERVICES, SOURCES, file_details, load_headline, load_holidays, load_od
from forecast_reporting import render_charts, write_summary
from forecast_results import (
    BOTTOM_UP, NETWORK_UNIT, bottom_up_results, build_scenarios, conventional_history_row, demand_patterns,
    forecast_views, make_forecast,
)
from run_validation import json_value, require


MODULE = Path(__file__).resolve().parent
BACKEND = MODULE.parents[1]
OUTPUT = BACKEND / "data" / "processed" / "module3_lrt3"
SETTINGS = MODULE / "forecast_settings.json"
STEP_1_OUTPUTS = (
    "lrt3_daily.parquet", "lrt3_station_daily.parquet", "lrt3_headline_daily.parquet",
    "lrt3_source_comparison.csv", "komuter_hourly_profiles.parquet", "data_quality_report.json",
    "eda_summary.md", "lrt3_daily_eda.png",
)
PREDICTION_KEY = ["series_id", "phase", "training_policy", "model_id", "origin", "date"]
METRICS_KEY = ["series_id", "phase", "training_policy", "model_id", "horizon_days"]


def step_1_fingerprints():
    return {name: file_details(OUTPUT / name, BACKEND) for name in STEP_1_OUTPUTS}


def save_json(path, value):
    payload = json_value(value)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    require(json.loads(path.read_text(encoding="utf-8")) == payload, f"JSON round trip failed for {path.name}")


def validate_temporal(series, fits, forecasts, predictions, config):
    require((predictions["train_end"].eq(predictions["origin"])
             & predictions["date"].gt(predictions["origin"])).all(), "Backtest chronology violation")
    require(predictions["lead_day"].eq((predictions["date"] - predictions["origin"]).dt.days).all(),
            "Incorrect lead days")
    require(np.isfinite(predictions["forecast_trips"]).all() and predictions["forecast_trips"].ge(0).all(),
            "Invalid backtest prediction")
    for series_id, historical in series.items():
        part = predictions.loc[predictions["series_id"].eq(series_id)]
        target, unit = target_and_unit(series_id)
        if series_id == NETWORK:
            unit = NETWORK_UNIT
        np.testing.assert_allclose(
            part["actual_trips"].to_numpy(dtype=float), historical.reindex(part["date"]).to_numpy(dtype=float),
            rtol=0, atol=0, equal_nan=True,
        )
        forecast = forecasts[series_id]
        require(part["target_id"].eq(target).all() and forecast["target_id"].eq(target).all()
                and part["unit"].eq(unit).all() and forecast["unit"].eq(unit).all(),
                f"Inconsistent target definition or units for {series_id}")
        require(len(forecast) == config["forecast_days"], f"Wrong forecast length for {series_id}")
        expected = pd.date_range(historical.index[-1] + pd.Timedelta(days=1), periods=config["forecast_days"])
        require(pd.DatetimeIndex(forecast["date"]).equals(expected), f"Non-contiguous forecast for {series_id}")
        require(forecast["data_cutoff"].eq(historical.index[-1]).all()
                and forecast["lead_day"].tolist() == list(range(1, len(forecast) + 1)),
                f"Cutoff and lead mismatch for {series_id}")
        require(np.isfinite(forecast["forecast_trips"]).all() and forecast["forecast_trips"].ge(0).all(),
                f"Invalid future point forecast for {series_id}")
        if series_id == NETWORK:
            continue
        fit = fits[series_id]
        main = part.loc[part["phase"].eq(VALIDATION)]
        for _, group in main.groupby("model_id"):
            require(set(group["origin"]) == set(fit["plan"]["origins"]), "Models use different fold origins")
            require(group.groupby("origin").size().eq(max(fit["plan"]["horizons"])).all(),
                    "Models use different fold horizons")
        if fit["plan"]["holdout_days"]:
            fitted_rows = fit["predictions"]
            selection_end = fitted_rows.loc[fitted_rows["phase"].ne(HOLDOUT), "date"].max()
            holdout_start = fitted_rows.loc[fitted_rows["phase"].eq(HOLDOUT), "date"].min()
            require(selection_end < holdout_start, f"Selection/holdout overlap for {series_id}")
        require(fit["future_actual_mutation_test_passed"], f"Leakage test missing for {series_id}")


def validate_network(forecasts, predictions):
    if NETWORK not in forecasts:
        return False
    ids = list(SERVICES)
    component_matrix = pd.concat([forecasts[key].set_index("date")["forecast_trips"].rename(key)
                                  for key in ids], axis=1)
    pd.testing.assert_series_equal(
        forecasts[NETWORK].set_index("date")["forecast_trips"], component_matrix.sum(axis=1).rename("forecast_trips"),
    )
    network = predictions.loc[predictions["series_id"].eq(NETWORK)]
    for (phase, model), group in network.groupby(["phase", "model_id"]):
        if phase == VALIDATION:
            components = predictions.loc[predictions["phase"].eq("network_component_validation")
                                         & predictions["model_id"].eq(model.removeprefix("bottom_up_"))]
        else:
            component_phase = "network_component_holdout_selected" if model == BOTTOM_UP else "network_component_holdout"
            components = predictions.loc[predictions["phase"].eq(component_phase)]
        total = components.groupby(["origin", "date"])["forecast_trips"].sum()
        actual = group.set_index(["origin", "date"])["forecast_trips"].sort_index()
        pd.testing.assert_series_equal(actual, total)
    return True


def validate_scenarios(od_forecast, scenarios):
    ordered = scenarios["low_trips"].le(scenarios["base_trips"]) & scenarios["base_trips"].le(scenarios["high_trips"])
    require(ordered.all() and scenarios["low_trips"].ge(0).all(), "Invalid planning scenario bounds")
    np.testing.assert_array_equal(scenarios["base_trips"], od_forecast["forecast_trips"])
    finite = od_forecast[["empirical_lower_trips", "empirical_upper_trips"]].notna()
    require(finite["empirical_lower_trips"].eq(finite["empirical_upper_trips"]).all(),
            "Incomplete empirical error band")
    present = od_forecast.loc[finite["empirical_lower_trips"]]
    require(present["empirical_lower_trips"].le(present["empirical_upper_trips"]).all()
            and np.isfinite(present[["empirical_lower_trips", "empirical_upper_trips"]]).all().all(),
            "Invalid empirical error band")


def validate_dashboard_views(summaries, forecasts, config):
    for series_id, frame in summaries.groupby("series_id"):
        require(frame["view_days"].tolist() == config["dashboard_windows"], "Incorrect view lengths")
        forecast = forecasts[series_id]
        for row in frame.itertuples():
            period = forecast.iloc[:row.view_days]
            require(len(period) == row.view_days and period["date"].iat[-1] == row.forecast_end
                    and period["date"].iat[0] == row.forecast_start
                    and period["forecast_trips"].sum() == row.forecast_total_trips,
                    f"Dashboard window differs from point forecast for {series_id}")


def write_tables(stage, tables):
    reports = {}
    for name, (frame, key) in tables.items():
        require(not frame.duplicated(key).any(), f"Duplicate output keys in {name}")
        if name.endswith(".parquet"):
            frame.to_parquet(stage / name, index=False)
            reopened = pd.read_parquet(stage / name)
        else:
            frame.to_csv(stage / name, index=False, date_format="%Y-%m-%d")
            dates = [col for col in frame if pd.api.types.is_datetime64_any_dtype(frame[col])]
            types = frame.drop(columns=dates).dtypes.to_dict()
            reopened = pd.read_csv(stage / name, dtype=types, parse_dates=dates,
                                   keep_default_na=False, na_values=[""])
            for date in dates:
                reopened[date] = pd.to_datetime(reopened[date]).astype(frame[date].dtype)
        pd.testing.assert_frame_equal(reopened, frame.reset_index(drop=True), rtol=1e-11, atol=1e-10)
        require(not reopened.duplicated(key).any(), f"Duplicate reopened keys in {name}")
        reports[name] = {"rows": len(frame), "columns": list(frame), "unique_key": key, "round_trip": True}
    return reports


def main():
    pa.set_cpu_count(2)
    pa.set_io_thread_count(2)
    config = json.loads(SETTINGS.read_text(encoding="utf-8"))
    as_of = pd.Timestamp(config["evaluation_as_of_date"])
    fingerprints = step_1_fingerprints()
    history, series, headline_quality = load_headline(BACKEND, as_of)
    series[OD], od_quality = load_od(BACKEND)
    holidays = load_holidays(BACKEND)
    checkpoint_dir = OUTPUT / "forecast_checkpoints"
    context = context_fingerprint(MODULE, config, holidays)
    fits, forecasts, parameters, unavailable = {}, {}, {}, {}
    for series_id, observed in series.items():
        fit = checkpointed_fit(checkpoint_dir, context, series_id, observed, holidays, config)
        if fit is None:
            unavailable[series_id] = "Insufficient data for two chronological backtest folds."
            continue
        fits[series_id] = fit
        forecasts[series_id], parameters[series_id] = make_forecast(observed, fit, holidays, config)
    if OD not in fits:
        raise ValueError("Step 1 OD data is insufficient for the required case-study forecast")
    series = {series_id: series[series_id] for series_id in fits}
    parts = [fit["predictions"] for fit in fits.values()]
    print("Reconciling network, scenarios and forecast views", flush=True)
    network_forecast, network_history, network_test, network_quality = bottom_up_results(
        series, fits, forecasts, holidays, config,
    )
    if network_forecast is not None:
        forecasts[NETWORK] = network_forecast
        series[NETWORK] = network_history
        parts.append(network_test)
        history = pd.concat([history, conventional_history_row(network_history)], ignore_index=True)
    forecasts[OD], scenarios, uncertainty = build_scenarios(forecasts[OD], fits[OD], config)
    backtests = pd.concat(parts, ignore_index=True)
    metrics = metrics_by_horizon(backtests, config["validation_horizons"])
    summaries = pd.DataFrame([
        row for series_id, forecast in forecasts.items()
        for row in forecast_views(series_id, series[series_id], forecast, fits.get(series_id), metrics, config)
    ])
    patterns = demand_patterns(series, holidays, config)
    network_forecasts = pd.concat([
        forecast for series_id, forecast in forecasts.items() if series_id != OD
    ], ignore_index=True)
    tables = {
        "network_service_history.parquet": (history, ["series_id", "date"]),
        "network_service_forecast.parquet": (network_forecasts, ["series_id", "date"]),
        "network_service_summary.csv": (summaries.loc[summaries["series_id"].ne(OD)], ["series_id", "view_days"]),
        "lrt3_forecast_daily.parquet": (forecasts[OD], ["series_id", "date"]),
        "lrt3_scenarios.csv": (scenarios, ["series_id", "date"]),
        "model_backtesting.csv": (metrics, METRICS_KEY),
        "backtest_predictions.parquet": (backtests, PREDICTION_KEY),
        "demand_patterns.csv": (patterns, ["series_id", "pattern", "group"]),
    }
    metadata = {
        "evaluation_as_of_date": config["evaluation_as_of_date"], "headline": headline_quality,
        "od": od_quality, "network": network_quality, "sources": SOURCES, "interventions": INTERVENTIONS,
        "settings": file_details(SETTINGS, BACKEND),
        "holidays": {
            "covered_years": sorted(holidays.years), "local_sources": holidays.sources,
            "calendar": holidays.records, "unique_dates_in_feature": len(holidays.dates),
            "feature_definition": "Union of Kuala Lumpur and Selangor public holiday dates from the supplied "
            "schedule PDFs and statutory Sunday substitutes. Simultaneous holidays count once per date. "
            "Older years receive no holiday adjustment and are excluded from holiday comparisons.",
            "limitations": "Tentative PDF dates and later amendments can change. The supplied schedules "
            "do not cover ad hoc gazettes, school holidays or employer-specific substitutions.",
        },
        "models": {key: {k: v for k, v in fit.items() if k != "predictions"} | {
            "final_fit": parameters[key], "source_data_cutoff": series[key].index[-1],
        } for key, fit in fits.items()},
        "unavailable_models": unavailable, "od_scenarios": uncertainty,
        "dashboard_views": summaries.to_dict("records"),
        "definitions": {
            "score": "Model selection uses the arithmetic mean of horizon-specific WAPEs. "
            "Ties prefer the seasonal naive baseline.",
            "training": "Mature series use up to the most recent 730 days at each origin. Short series use "
            "available history since first positive observation. Sensitivity fits start August 15. "
            "Training-only gaps use prior same-weekday demand or the immediately prior value. "
            "Missing actuals are excluded from all metrics and zero actuals only from MAPE.",
            "weekly_and_annual": "Weekly seasonal period is 7 days. Ridge uses a fixed annual Fourier pair "
            "only with at least 730 training days, known holiday dates and recursive predicted lags.",
            "network_forecast_units": "Sum of headline service trips, with all six components at one cutoff.",
            "od_forecast_units": "Trips originating at Shah Alam stations. Step 1 validated A0 rollup.",
            "forecast_comparison": "Last 28 calendar days weighted by each forecast window's weekday mix.",
            "variables": "Lag and calendar predictors and observed demand patterns are non-causal. "
            "Fuel, labour and registration data were deferred from predictive modelling.",
            "near_term_accuracy": "Independent 14-day short-series and 28-day mature holdouts where feasible. "
            "Backtesting does not validate 90-day accuracy. Overlapping origins reduce independent evidence.",
            "revisions": "Backtests use the selected published snapshot's historical observations. "
            "Point-in-time snapshots for each fold are unavailable.",
        },
        "environment": {"python": platform.python_version(), "packages": {
            name: version(name) for name in ["numpy", "pandas", "pyarrow", "pypdf", "matplotlib", "pillow"]
        }},
    }
    validate_temporal(series, fits, forecasts, backtests, config)
    coherent = validate_network(forecasts, backtests)
    validate_scenarios(forecasts[OD], scenarios)
    validate_dashboard_views(summaries, forecasts, config)
    print("Writing and validating forecast outputs", flush=True)
    with TemporaryDirectory(prefix="forecast-validation-", dir=OUTPUT) as temp:
        stage = Path(temp)
        table_checks = write_tables(stage, tables)
        chart_dir = stage / "forecast_charts"
        render_charts(chart_dir, stage / "matplotlib", series, forecasts, scenarios)
        chart_checks = {}
        for chart in sorted(chart_dir.glob("*.png")):
            with Image.open(chart) as im:
                require(im.format == "PNG", f"Invalid chart {chart.name}")
                im.load()
                chart_checks[chart.name] = {"width": im.width, "height": im.height}
        save_json(stage / "forecast_config.json", config)
        require(fingerprints == step_1_fingerprints(), "A Step 1 output changed during the forecast run")
        metadata["validation"] = {
            "passed": True, "tables": table_checks, "charts": chart_checks, "step_1_unchanged": True,
            "step_1_fingerprints": fingerprints, "non_negative_finite_point_predictions": True,
            "future_observation_mutation_tests_passed": True, "disjoint_model_selection_and_holdout": True,
            "forecast_days_per_modelled_series": {key: len(frame) for key, frame in forecasts.items()},
            "network_exact_component_coherence": coherent, "scenario_order_valid": True,
            "target_units_and_dashboard_views_verified": True, "pipeline_requires_no_network": True,
        }
        write_summary(stage / "forecast_summary.md", metadata, summaries, metrics, patterns, scenarios)
        require((stage / "forecast_summary.md").read_text(encoding="utf-8").startswith("# Module 3 Step 2"),
                "Unable to reopen the summary")
        save_json(stage / "forecast_metadata.json", metadata)
        names = [*tables, "forecast_config.json", "forecast_summary.md",
                 *(Path("forecast_charts") / name for name in chart_checks), "forecast_metadata.json"]
        (OUTPUT / "forecast_charts").mkdir(exist_ok=True)
        reused = 0
        for name in names:
            destination = OUTPUT / name
            if destination.is_file() and cmp(stage / name, destination, shallow=False):
                reused += 1
            else:
                (stage / name).replace(destination)
        print(f"Retained {reused} identical outputs and published {len(names) - reused}", flush=True)
    print(f"Completed Step 2 for {len(fits)} independent targets and {int(coherent)} coherent network.", flush=True)


if __name__ == "__main__":
    main()
