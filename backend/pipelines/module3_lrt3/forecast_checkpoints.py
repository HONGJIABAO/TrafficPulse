"""Save each completed service evaluation so an interrupted run can resume."""

import hashlib
import json
import platform
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from forecast_evaluation import fit_series
from run_validation import json_value


CHECKPOINT_METADATA = b"trafficpulse_forecast_checkpoint"
FIT_SOURCES = (
    "forecast_checkpoints.py", "forecast_evaluation.py", "forecast_inputs.py", "forecast_models.py",
    "ridership.py", "run_forecast.py",
)


def context_fingerprint(module, config, holidays):
    context = {
        "config": config,
        "holiday_dates": sorted(date.isoformat() for date in holidays.dates),
        "environment": [platform.python_version(), *map(version, ("numpy", "pandas", "pyarrow"))],
        "sources": {name: hashlib.sha256((module / name).read_bytes()).hexdigest() for name in FIT_SOURCES},
    }
    return hashlib.sha256(json.dumps(context, sort_keys=True).encode("utf-8")).hexdigest()


def checkpointed_fit(directory, context, series_id, observed, holidays, config):
    path = directory / f"{series_id}.parquet"
    observations = pd.util.hash_pandas_object(observed, index=True).to_numpy().tobytes()
    fingerprint = hashlib.sha256(context.encode("ascii") + observations).hexdigest()
    if path.is_file():
        try:
            table = pq.read_table(path, page_checksum_verification=True)
            payload = json.loads(table.schema.metadata[CHECKPOINT_METADATA])
            if payload["fingerprint"] == fingerprint:
                fit = payload["fit"]
                fit["predictions"] = table.to_pandas()
                if (fit["series_id"] != series_id or fit["predictions"].empty
                        or not fit["predictions"]["series_id"].eq(series_id).all()):
                    raise ValueError("Checkpoint series ID mismatch")
                plan = fit["plan"]
                plan["origins"] = list(map(pd.Timestamp, plan["origins"]))
                if plan["holdout_origin"] is not None:
                    plan["holdout_origin"] = pd.Timestamp(plan["holdout_origin"])
                print(f"Resumed {series_id} from checkpoint", flush=True)
                return fit
        except (OSError, ValueError, TypeError, KeyError, pa.ArrowException) as error:
            print(f"Refitting {series_id} after unreadable checkpoint: {error}", flush=True)

    print(f"Evaluating {series_id}", flush=True)
    fit = fit_series(series_id, observed, holidays, config)
    if fit is not None:
        payload = {"fingerprint": fingerprint, "fit": {k: v for k, v in fit.items() if k != "predictions"}}
        table = pa.Table.from_pandas(fit["predictions"], preserve_index=False)
        table = table.replace_schema_metadata(dict(table.schema.metadata) | {
            CHECKPOINT_METADATA: json.dumps(json_value(payload), allow_nan=False).encode("utf-8"),
        })
        directory.mkdir(exist_ok=True)
        with TemporaryDirectory(dir=directory, prefix="fit-") as temp:
            staged = Path(temp) / path.name
            pq.write_table(table, staged, write_page_checksum=True)
            staged.replace(path)
    return fit
