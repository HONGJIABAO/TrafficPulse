# Run the Step 2B forecast experiments

From the repository root in PowerShell, use the existing module environment.

```powershell
& 'backend/pipelines/module3_lrt3/.venv/Scripts/python.exe' -B backend/pipelines/module3_lrt3/run_innovation.py
```

The command uses the saved Step 1 and Step 2 Parquets, backtests, configuration,
and metadata. It runs sequentially with a two-thread cap and requires no
downloads. It preserves the original artifacts and forecast checkpoints.
Three separate checkpoints in `innovation_checkpoints/` hold the completed
transfer, stability, and ablation stages. The same command resumes matching
checkpoints. Edit the experimental settings in `innovation_settings.json`.

The CSVs record pooled and fold-level cold-start errors, short-history and
network stability checks, and ridge feature ablations. The Parquet contains
alternative point forecasts with dates, cutoffs, windows, and target definitions.
The original model selections are preserved.

The watchlist includes the full forecast and dates strictly after the as-of
date. Its demand and uncertainty flags follow separate planning rules.
The uncertainty audit uses the already inspected terminal holdout. The
experimental summary and metadata document methods, inputs, and checks.
