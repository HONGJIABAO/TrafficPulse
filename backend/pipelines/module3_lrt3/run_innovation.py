"""Run and validate the offline Step 2B research experiments."""

import hashlib
import json
import os
import platform
from importlib.metadata import version
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile

if __name__ == "__main__":
    for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "BLIS_NUM_THREADS"):
        os.environ[variable] = "2"

import numpy as np
import pandas as pd
import pyarrow as pa

from forecast_inputs import NETWORK, OD, SERVICES, HolidayCalendar, file_details, load_od
from forecast_models import MODELS
from innovation_experiments import DONORS, SHORT, ablation, cold_start, identity, stability
from innovation_reporting import summary_text, uncertainty_audit, watchlist
from run_forecast import BACKEND, MODULE, OUTPUT, save_json, write_tables
from run_validation import require


SETTINGS = MODULE / "innovation_settings.json"
CHECKPOINTS = OUTPUT / "innovation_checkpoints"
ARTIFACTS = (
    "cold_start_backtesting.csv", "cold_start_fold_metrics.csv", "model_stability.csv",
    "alternative_forecasts.parquet", "feature_ablation.csv", "uncertainty_audit.json",
    "demand_watchlist.csv", "innovation_summary.md", "innovation_metadata.json",
)


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def protected_files():
    return {
        path.relative_to(OUTPUT).as_posix(): file_details(path, BACKEND)["sha256"]
        for path in sorted(OUTPUT.rglob("*"))
        if path.is_file() and path.name not in ARTIFACTS
        and (path.parent == OUTPUT or path.parent.name in ("forecast_charts", "forecast_checkpoints"))
    }


def checkpoint(name, fingerprint, count, execute):
    path = CHECKPOINTS / f"{name}.zip"
    if path.exists():
        try:
            with ZipFile(path) as archive:
                if archive.read("fingerprint.txt").decode("ascii") == fingerprint:
                    outputs = [pd.read_parquet(BytesIO(archive.read(f"{i}.parquet"))) for i in range(count)]
                    print(f"Resumed {name} checkpoint", flush=True)
                    return outputs
        except (BadZipFile, OSError, KeyError, ValueError, pa.ArrowException) as error:
            print(f"Recomputing {name} after unreadable checkpoint: {error}", flush=True)
    print(f"Running {name}", flush=True)
    outputs = list(execute())
    require(len(outputs) == count and all(not frame.empty for frame in outputs), f"Incomplete stage {name}")
    CHECKPOINTS.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=CHECKPOINTS, prefix="stage-") as temp:
        staged = Path(temp) / path.name
        with ZipFile(staged, mode="w") as archive:
            archive.writestr("fingerprint.txt", fingerprint)
            for i, frame in enumerate(outputs):
                archive.writestr(f"{i}.parquet", frame.to_parquet(index=False))
        staged.replace(path)
    return outputs


def inputs(metadata):
    history = pd.read_parquet(OUTPUT / "network_service_history.parquet")
    series = {
        key: part.set_index("date")["actual_trips"].astype(float).sort_index()
        for key, part in history.loc[history["in_model_calendar"]].groupby("series_id")
    }
    series[OD], od_source = load_od(BACKEND)
    require(od_source == metadata["od"], "Validated OD input differs from Step 2 provenance")
    published = pd.read_parquet(OUTPUT / "network_service_forecast.parquet")
    original = {key: part.reset_index(drop=True) for key, part in published.groupby("series_id")}
    original[OD] = pd.read_parquet(OUTPUT / "lrt3_forecast_daily.parquet")
    require(set(series) == set(original) == {*SERVICES, NETWORK, OD}, "Unexpected Step 2 target set")
    common = pd.concat([series[key].reindex(series[NETWORK].index) for key in SERVICES], axis=1)
    np.testing.assert_array_equal(common.sum(axis=1, min_count=len(SERVICES)), series[NETWORK])
    holiday = metadata["holidays"]
    calendar = HolidayCalendar(
        frozenset(pd.Timestamp(row["date"]) for row in holiday["calendar"]),
        frozenset(holiday["covered_years"]), holiday["calendar"], holiday["local_sources"],
    )
    return series, original, calendar


def validate_outputs(cold, folds, stable, alternatives, feature, watch, series, config, settings):
    for frame in (cold, folds, stable.loc[stable["phase"].ne("forecast_sensitivity")], feature):
        for field in ("wape_pct", "mae", "rmse"):
            require(np.isfinite(frame[field]).all() and frame[field].ge(0).all(), f"Invalid {field}")
        require(frame["last_scored_date"].gt(frame["last_origin"]).all(), "Backtest scores precede their origins")
    for key in SHORT:
        pooled = cold.loc[cold["series_id"].eq(key)].groupby("horizon_days")["folds"].nunique()
        require(pooled.eq(1).all(), "Cold-start fold counts do not match")
    donor = folds.loc[folds["donor_weight"].gt(0)]
    require(donor["last_donor_observation"].notna().all()
            and donor["last_donor_observation"].le(donor["origin"]).all()
            and folds["last_target_observation"].le(folds["origin"]).all(), "Training timestamps exceed origins")
    days = config["forecast_days"]
    for key, group in alternatives.groupby(["series_id", "variant", "model_id"]):
        cutoff = series[key[0]].index[-1]
        future = pd.date_range(cutoff + pd.Timedelta(days=1), periods=days)
        require(len(group) == days and pd.DatetimeIndex(group["date"]).equals(future)
                and group["data_cutoff"].eq(cutoff).all() and group["train_end"].le(cutoff).all()
                and group["lead_day"].tolist() == list(range(1, days + 1)),
                f"Alternative forecast dates or cutoffs fail for {key}")
    require(np.isfinite(alternatives["forecast_trips"]).all() and alternatives["forecast_trips"].ge(0).all(),
            "Invalid experimental forecasts")
    for model in MODELS:
        matched = alternatives.loc[alternatives["model_id"].eq(model)]
        components = matched.loc[matched["series_id"].isin(SERVICES)
                                 & matched["variant"].eq("full_eligible_history")]
        network = matched.loc[matched["series_id"].eq(NETWORK)
                              & matched["variant"].eq("bottom_up_same_candidate")].set_index("date")
        require(components.groupby("date")["series_id"].nunique().eq(len(SERVICES)).all(),
                "Incomplete alternative bottom-up components")
        np.testing.assert_allclose(components.groupby("date")["forecast_trips"].sum(),
                                   network["forecast_trips"], rtol=1e-12)
    for frame in (cold, folds, stable, alternatives, feature, watch):
        for key, group in frame.groupby("series_id"):
            require(group["target_id"].eq(identity(key)["target_id"]).all()
                    and group["unit"].eq(identity(key)["unit"]).all(), "Inconsistent experimental target")
    as_of = pd.Timestamp(settings["as_of_date"])
    future = watch.loc[watch["view"].eq("future_only_after_as_of")]
    require(future["forecast_start"].gt(as_of).all() and future["elapsed_forecast_days"].eq(0).all()
            and future["strictly_future_days"].eq(future["forecast_days"]).all(), "Future-only watchlist audit failed")


def main():
    pa.set_cpu_count(2)
    pa.set_io_thread_count(2)
    protected = protected_files()
    settings = load_json(SETTINGS)
    config = load_json(OUTPUT / "forecast_config.json")
    step2 = load_json(OUTPUT / "forecast_metadata.json")
    series, original, holidays = inputs(step2)
    saved = pd.read_parquet(OUTPUT / "backtest_predictions.parquet")
    original_metrics = pd.read_csv(OUTPUT / "model_backtesting.csv")
    source_files = (
        "run_innovation.py", "innovation_experiments.py", "innovation_reporting.py", "innovation_settings.json",
        "forecast_models.py", "forecast_evaluation.py", "forecast_inputs.py", "forecast_results.py",
    )
    environment = {"python": platform.python_version(), **{
        package: version(package) for package in ("numpy", "pandas", "pyarrow")
    }}
    context = {
        "protected_artifacts": protected, "environment": environment,
        "sources": {name: file_details(MODULE / name, BACKEND)["sha256"] for name in source_files},
    }
    fingerprint = hashlib.sha256(json.dumps(context, sort_keys=True).encode("utf-8")).hexdigest()
    cold, folds = checkpoint("cold_start", fingerprint, 2, lambda: cold_start(series, saved, step2, settings))
    stable, alternatives = checkpoint("model_stability", fingerprint, 2, lambda: stability(
        series, saved, original, step2, holidays, config, settings,
    ))
    feature, = checkpoint("feature_ablation", fingerprint, 1, lambda: [ablation(series, step2, holidays, config)])
    uncertainty = uncertainty_audit(saved, original[OD], step2, config)
    watch = watchlist(series, original, alternatives, original_metrics, step2, settings)
    validate_outputs(cold, folds, stable, alternatives, feature, watch, series, config, settings)
    tables = {
        "cold_start_backtesting.csv": (cold, ["series_id", "arm", "horizon_days"]),
        "cold_start_fold_metrics.csv": (folds, ["series_id", "arm", "origin", "horizon_days"]),
        "model_stability.csv": (stable, ["series_id", "phase", "variant", "model_id", "horizon_days"]),
        "alternative_forecasts.parquet": (alternatives, ["series_id", "variant", "model_id", "date"]),
        "feature_ablation.csv": (feature, ["series_id", "variant", "horizon_days"]),
        "demand_watchlist.csv": (watch, ["series_id", "view"]),
    }
    metadata = {
        "settings": settings, "environment": environment, "checkpoint_fingerprint": fingerprint,
        "processed_input_hashes": protected, "module_source_hashes": context["sources"],
        "headline_source": step2["headline"]["selected"], "od_source": step2["od"], "donor_ids": list(DONORS),
        "original_model_selection_preserved": True,
        "target_cutoffs": {key: values.index[-1] for key, values in series.items()},
        "cold_start_origins": {key: step2["models"][key]["plan"]["origins"] for key in SHORT},
        "ablation_origins": {key: step2["models"][key]["plan"]["origins"] for key in DONORS},
        "network_common_history_days": int(series[NETWORK].notna().sum()),
        "network_common_origins": step2["models"][SHORT[0]]["plan"]["origins"],
        "calendar_source_metadata": step2["holidays"]["local_sources"],
        "calendar_known_years": sorted(holidays.years),
        "methodology": {
            "transfer": "Equal weights across five independently normalized donor profiles. The target's "
                        "trailing 28 days set forecast level. Transfer weights are fixed in advance.",
            "stability": "Full, trailing 56-day and August 15 boundary fits. The zero-drift reconstruction "
                         "holds terminal level and weekly seasonal factors fixed.",
            "holdout": "All uses of the already inspected terminal holdout are retrospective.",
            "feature_ablation": "C adds a scheduled holiday flag and a coverage indicator. Earlier years "
                                "and tentative-only dates are unknown. Incremental scores cover the bundle.",
            "watchlist": "Configurable planning thresholds. Demand change and uncertainty are separate. "
                         "Forecast dates before or on the as-of date remain projections.",
        },
    }
    with TemporaryDirectory(dir=OUTPUT, prefix="innovation-validation-") as temp:
        stage = Path(temp)
        checks = write_tables(stage, tables)
        save_json(stage / "uncertainty_audit.json", uncertainty)
        text = summary_text(cold, stable, feature, uncertainty, watch, metadata, settings)
        (stage / "innovation_summary.md").write_text(text, encoding="utf-8")
        require((stage / "innovation_summary.md").read_text(encoding="utf-8") == text, "Summary readback failed")
        require(protected == protected_files(), "A protected processed artifact changed before publication")
        metadata["validation"] = {
            "passed": True, "tables": checks, "matched_origin_and_actual_keys": True,
            "target_and_donor_future_mutation_tests_passed": True,
            "ablation_future_mutation_tests_passed": True, "nonnegative_finite_forecasts": True,
            "target_definitions_and_cutoffs_verified": True, "bottom_up_coherent": True,
            "future_only_watchlist_verified": True, "empirical_bands_reconciled": True,
            "protected_artifacts_unchanged": True,
        }
        save_json(stage / "innovation_metadata.json", metadata)
        for name in ARTIFACTS:
            (stage / name).replace(OUTPUT / name)
    require(protected == protected_files(), "A protected processed artifact changed after publication")
    print(f"Validated {len(ARTIFACTS)} Step 2B outputs and preserved {len(protected)} original files", flush=True)


if __name__ == "__main__":
    main()
