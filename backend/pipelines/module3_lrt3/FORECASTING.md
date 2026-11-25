# Run the Step 2 demand forecasts

From the TrafficPulse repository root in PowerShell, use the existing module
environment.

```powershell
& 'backend/pipelines/module3_lrt3/.venv/Scripts/python.exe' -B backend/pipelines/module3_lrt3/run_forecast.py
```

The forecast run works offline. It reads the local headline CSVs, the two supplied
public holiday schedules and the validated Step 1 OD Parquet. It writes the
validated artifacts to `backend/data/processed/module3_lrt3/`. The eight Step 1
outputs are fingerprinted before and after the run.

Models run sequentially with a two-thread cap for numerical libraries and Arrow.
Each completed service evaluation is saved atomically in `forecast_checkpoints/`.
The same command resumes from matching checkpoints. Changes to a service's
observations, model settings, holiday dates, runtime versions or fitting code
invalidate its checkpoint. Final outputs are reopened and validated in staging
before publication. Identical files retain their existing copies.

Edit `forecast_settings.json` to set the planning scenario offsets. The run
copies the settings into `forecast_config.json` alongside its results.
`forecast_metadata.json` records source checksums, model parameters, fold
dates, scenario assumptions and reproducibility checks.

`network_service_forecast.parquet` contains the published headline forecasts
and their network sum. `lrt3_forecast_daily.parquet` contains the separately
modelled station-origin target. Each 30-day or 60-day view uses the corresponding
prefix of its 90-day forecast. Summary changes use a weekday-matched recent
baseline. The planning scenarios are in `lrt3_scenarios.csv` and the empirical
short-lead uncertainty columns are in the OD forecast Parquet.

Read `forecast_summary.md` for results and measurement definitions. The
backtest CSV gives horizon-level metrics and the prediction Parquet gives the
per-origin audit trail. The holdout stays outside model selection. The final
fits then include data through each selected local cutoff.
