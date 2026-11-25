# Run the Step 3 service readiness analysis

From the repository root, run the module’s existing Python environment in PowerShell.

```powershell
& 'backend/pipelines/module3_lrt3/.venv/Scripts/python.exe' -B backend/pipelines/module3_lrt3/run_capacity.py
```

The runner reads the local GTFS ZIP, the existing headline and station-origin
forecasts, Low/Base/High scenarios, and Step 1 Komuter shares. It caps numerical
threads at two and uses staged read-back validation and atomic replacement.
It does not load the raw OD CSV or fit any forecast models.

Edit the off-peak window or nominal places per train in `capacity_settings.json`
to test a different planning input. The AM and PM windows are half-open
07:00–09:00 and 18:00–20:00. The default off-peak comparison is 11:00–16:00.
Forecast comparisons use ordinary days strictly after the as-of date. The local
GTFS calendar ends on 31 December 2026, and later dates carry the same reference
patterns for planning. Forecast holiday flags identify dates with missing
paired supply because the archive has no holiday exception timetable.

Hourly departures count only the terminal start of each trip pattern. The archive
specifies headways, so fractional window totals are expected. Direction-specific
rows use the GTFS terminal labels. Rows labelled both directions sum the terminal
streams. The combined Ampang/Sri Petaling intensity is unavailable. Sunway BRT
is included as a separate nonrail schedule.

The sensitivity export contains 24 hourly bins and separate AM and PM two-hour
totals for every date, demand scenario, and Komuter profile. Filter by resolution
before summing. Station-origin trips and nominal places use separate units.
The source capacity is a documented design value, and supply estimates assume
three-car trains deliver the reference frequency.
