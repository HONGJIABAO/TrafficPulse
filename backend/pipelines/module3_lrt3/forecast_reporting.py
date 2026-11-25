"""Create human-readable tables and charts from the evaluated forecasts."""

import os

import numpy as np
import pandas as pd

from forecast_evaluation import FULL, HOLDOUT, VALIDATION
from forecast_inputs import NAMES, NETWORK, OD, SERVICES, stamp
from forecast_models import MODEL_NAMES, NAIVE
from forecast_results import BOTTOM_UP


def display(value, precision=0):
    return f"{value:,.{precision}f}" if pd.notna(value) else "—"


def table(headers, rows):
    return [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
        *["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows],
        "",
    ]


def render_charts(directory, cache, series, forecasts, scenarios):
    os.environ["MPLCONFIGDIR"] = str(cache)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt
    from matplotlib.ticker import StrMethodFormatter

    directory.mkdir()
    history_color, forecast_color = "#254153", "#087b84"

    def axes_style(axis):
        axis.xaxis.set_major_locator(mdates.MonthLocator())
        axis.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
        axis.yaxis.set_major_formatter(StrMethodFormatter("{x:,.0f}"))
        axis.spines[["top", "right"]].set_visible(False)
        axis.grid(axis="y", alpha=0.24)
        axis.set_axisbelow(True)
        axis.set_ylabel("Trips per day")

    def plot_series(axis, series_id, future):
        observed = series[series_id].iloc[-84:]
        axis.plot(observed.index, observed, color=history_color, linewidth=1.45, label="Observed")
        axis.plot(future["date"], future["forecast_trips"], color=forecast_color, linewidth=1.55,
                  label="Point forecast")
        axis.axvline(future["data_cutoff"].iat[0], color="#75838c", linestyle=":", linewidth=1)
        axes_style(axis)

    ids = [series_id for series_id in SERVICES if series_id in forecasts]
    if ids:
        fig, axes = plt.subplots((len(ids) + 1) // 2, 2, figsize=(13, 9), squeeze=False, layout="constrained")
        fig.suptitle("Rapid Rail headline service forecasts", fontsize=16, fontweight="bold")
        for axis, series_id in zip(axes.flat, ids):
            plot_series(axis, series_id, forecasts[series_id])
            axis.set_title(NAMES[series_id], loc="left")
        for axis in list(axes.flat)[len(ids):]:
            axis.set_visible(False)
        axes.flat[0].legend(frameon=False, loc="upper left", ncol=2, fontsize=8)
        fig.savefig(directory / "headline_services.png", dpi=145, facecolor="white")
        plt.close(fig)

    if NETWORK in forecasts:
        fig, axis = plt.subplots(figsize=(11, 4.4), layout="constrained")
        plot_series(axis, NETWORK, forecasts[NETWORK])
        axis.set_title("Rapid Rail forecast | sum of six headline service series", loc="left", fontweight="bold")
        axis.legend(frameon=False, loc="upper left", ncol=2)
        fig.savefig(directory / "rapid_rail_network.png", dpi=145, facecolor="white")
        plt.close(fig)

    if OD in forecasts:
        od = forecasts[OD]
        fig, (top, bottom) = plt.subplots(2, 1, figsize=(11.8, 7.4), sharex=True, layout="constrained")
        plot_series(top, OD, od)
        top.fill_between(scenarios["date"], scenarios["low_trips"], scenarios["high_trips"],
                         color="#a6d4d5", alpha=0.5, label="Low to High planning assumptions")
        top.set_title("LRT3 station-origin trips | planning scenarios", loc="left", fontweight="bold")
        top.legend(frameon=False, loc="upper left", ncol=3, fontsize=9)
        plot_series(bottom, OD, od)
        band = od.dropna(subset=["empirical_lower_trips", "empirical_upper_trips"])
        if not band.empty:
            bottom.fill_between(band["date"], band["empirical_lower_trips"], band["empirical_upper_trips"],
                                color="#ffd0a5", alpha=0.7, label="Rolling error quantiles")
        bottom.set_title("Empirical uncertainty for leads with backtest evidence", loc="left", fontweight="bold")
        bottom.legend(frameon=False, loc="upper left", ncol=3, fontsize=9)
        fig.savefig(directory / "lrt3_od_forecast.png", dpi=145, facecolor="white")
        plt.close(fig)


def write_summary(path, metadata, summaries, metrics, patterns, scenarios):
    info = metadata["headline"]
    source = info["selected"]
    od = metadata["od"]
    nominal = metadata["network"]
    services = metadata["models"]
    sources = metadata["sources"]
    windows = summaries.loc[summaries["view_days"].eq(90)]
    full = metrics.loc[metrics["phase"].eq(VALIDATION) & metrics["training_policy"].eq(FULL)]
    score = full.groupby(["series_id", "model_id"])["wape_pct"].mean()

    def selected_value(series_id, phase, model_id, policy, horizon):
        selected = metrics.loc[
            metrics["series_id"].eq(series_id) & metrics["phase"].eq(phase)
            & metrics["model_id"].eq(model_id) & metrics["training_policy"].eq(policy)
            & metrics["horizon_days"].eq(horizon), "wape_pct"
        ]
        return display(selected.iat[0], 2) if len(selected) else "—"

    lines = [
        "# Module 3 Step 2 demand forecasts", "",
        f"The headline snapshot is {source['path']}, with {source['source_rows']:,} date rows from "
        f"{source['date_min']} through {source['date_max']}. The most recent supported positive observation "
        f"is {source['latest_positive_supported_date']}. The snapshot is "
        f"{info['days_after_latest_observation_at_evaluation']} days behind the analysis reference date "
        f"of {metadata['evaluation_as_of_date']}. "
        f"[Headline catalogue]({sources['headline']})", "",
        info["ampang_definition"] + f" [Operator reporting]({sources['ampang_reporting']})", "",
        *table(["Published service", "First numeric", "Last numeric", "First positive", "Last positive",
                "Zeros", "Nulls", "Absent date rows"],
               [[NAMES[series_id], row["first_numeric_date"], row["last_numeric_date"], row["first_positive_date"],
                 row["last_positive_date"], row["zero_days"], row["null_days"], row["missing_days"]]
                for series_id, row in source["services"].items() if series_id in SERVICES]),
        "Counts of source zeros and nulls apply to the full snapshot calendar. Model eligibility starts "
        "at each series' first positive observation. Trailing unknown dates cannot advance the forecast cutoff.", "",
    ]
    for filename, change in info["comparison_with_selected"].items():
        revisions = change["revisions_on_shared_dates"]
        lines.extend([
            f"Compared with {filename}, the selected snapshot adds {change['selected_extra_dates']} dates "
            f"and changes {sum(value['changed_days'] for value in revisions.values())} values on "
            "shared dates. The JSON identifies all changed columns and dates.", "",
        ])
    lines.extend([
        "## Forecast targets and periods", "",
        "Headline targets are the official published Rapid Rail service series. The network forecast "
        "sums the six aligned service forecasts exactly. The network unit is published service trips. "
        "A transfer-deduplicated journeys total would require different data.", "",
        f"LRT3 OD measures station-origin trips. The Step 1 series supplies {od['observed_days']} observed "
        f"days and {od['trips']:,} total trips from {od['window_start']} through {od['data_cutoff']}. "
        "Earlier OD zeros remain outside the modelling window. The headline and OD targets have "
        "independent cutoffs and forecasts. [OD catalogue](" + sources["rapid_rail_od"] + ")", "",
        "The Parquets contain 90 consecutive daily point forecasts for each modelled series. "
        "The 30- and 60-day summaries use prefixes of the same forecast. Change compares the forecast "
        "mean with the last 28 observed calendar days reweighted to match the forecast's weekday mix. "
        "This is a demand-level comparison from each cutoff.", "",
        *table(["Series","Model","Cutoff","Forecast starts","Forecast ends","Recent mean",
                "Forecast mean","Forecast total","Change vs matched recent (%)"],
               [[row.service_name, MODEL_NAMES.get(row.model_id, "Bottom-up component forecasts"),
                 stamp(row.data_cutoff), stamp(row.forecast_start), stamp(row.forecast_end),
                 display(row.recent_observed_daily_mean), display(row.forecast_daily_mean),
                 display(row.forecast_total_trips), display(row.change_vs_weekday_matched_recent_pct, 2)]
                for row in windows.itertuples()]),
        "## Rolling-origin results", "",
        "The candidates are a seven-day seasonal naive baseline, additive weekly Holt–Winters with "
        "a damped trend and calendar/lag ridge regression. Ridge uses known calendar indicators, "
        "training-only standardization, recursive 7- and 14-day lags, and an annual harmonic only "
        "when the fit contains two years. The dated local public-holiday PDFs cover 2026 and 2027. "
        "The JSON records jurisdiction, pages, checksums and the Sunday substitution rule. "
        f"[Public holiday schedules]({sources['holidays']})", "",
        "Model selection minimizes mean WAPE across available 7-, 14- and 28-day horizons on the same "
        "origins. Predictions in different horizon columns reuse points from identical origins. "
        "Short histories have overlapping validation horizons. Terminal holdout rows were scored "
        "after choosing models and before refitting through the cutoff. No 90-day accuracy estimate "
        "is supported by these tests.", "",
        *table(["Series","Naive mean WAPE","Holt–Winters mean WAPE","Ridge mean WAPE",
                "Selected model","Selected 7d","14d","28d","Holdout WAPE"],
               [[NAMES[series_id], display(score.get((series_id, NAIVE), np.nan), 2),
                 display(score.get((series_id, "holt_winters_additive_damped"), np.nan), 2),
                 display(score.get((series_id, "calendar_lag_ridge"), np.nan), 2),
                 MODEL_NAMES[fit["model"]],
                 *[selected_value(series_id, VALIDATION if fit["policy"] == FULL else "intervention_matched",
                                  fit["model"], fit["policy"], horizon) for horizon in (7,14,28)],
                 selected_value(series_id, HOLDOUT, fit["model"], fit["policy"], fit["plan"]["holdout_days"])]
                for series_id, fit in services.items()]),
        "WAPE columns are percentages. The backtesting CSV gives MAE, RMSE, MAPE with zero exclusions, "
        "prediction counts, fold ranges and differences from the same-origin baseline. The prediction "
        "Parquet carries per-origin training and observation dates.", "",
    ])
    if nominal["available"]:
        network_hold = metrics.loc[metrics["series_id"].eq(NETWORK) & metrics["phase"].eq(HOLDOUT)
                                   & metrics["model_id"].eq(BOTTOM_UP)]
        if len(network_hold):
            row = network_hold.sort_values("horizon_days").iloc[-1]
            lines.extend([
                f"The selected network ensemble recorded {display(row['wape_pct'], 2)}% WAPE "
                f"over its common {row['horizon_days']}-day holdout, against "
                f"{display(row['seasonal_naive_wape_pct'], 2)}% for the coherent seasonal naive baseline.", "",
            ])
    lines.extend(["## Shah Alam intervention sensitivity", ""])
    for item in metadata["interventions"]:
        lines.extend([f"- {item['date']} {item['event'].replace('_', ' ')}. "
                      f"{item['verification']} [Source]({item['source']})"])
    lines.extend(["", "The opening date adds no observations to either eligible history. The "
                  "free-ride end maps to a training start on August 15. Both window policies use the "
                  "same forecast origins for comparison.", ""])
    for series_id, fit in services.items():
        result = fit["intervention"]
        if not result:
            continue
        lines.extend([
            f"- {NAMES[series_id]} has {result['baseline_training_days']} full-window days and "
            f"{result['post_training_days']} post-boundary days. Matched origin count "
            f"{len(result['matched_origins'])}. Post-window best minus full-window best mean WAPE "
            f"{display(result.get('post_minus_full_wape_score_pp'), 2)} percentage points. "
            f"Selected training policy {fit['policy'].replace('_', ' ')}.",
        ])
    limits = metadata["od_scenarios"]
    lines.extend([
        "", "## LRT3 planning and empirical uncertainty", "",
        limits["planning_scenarios"]["formula"], "",
        *table(["Scenario","90-day total","Mean per day","Day-90 offset from Base"],
               [[label, display(scenarios[column].sum()), display(scenarios[column].mean()), display(offset, 0) + "%"]
                for label, column, offset in (
                   ("Low", "low_trips", 100 * limits["planning_scenarios"]["low_offset_at_day_90"]),
                   ("Base", "base_trips", 0), ("High", "high_trips", 100 * limits["planning_scenarios"]["high_offset_at_day_90"]))]),
        limits["empirical_residual_bands"]["method"] + " " + limits["empirical_residual_bands"]["limitation"], "",
        *table(["Lead band","Residuals","Origins","Unique dates","Holdout inside","Holdout points"],
               [[f"{band['lead_start']}–{band['lead_end']}", band["count"], band["origins"],
                 band["unique_actual_dates"], band.get("holdout_inside", "—"), band.get("holdout_points", "—")]
                for band in limits["empirical_residual_bands"]["bands"]]),
        "## Observed demand patterns", "",
        "Weekday averages use up to 365 recent days. Holiday differences use same-weekday non-holidays "
        "within 28 days of each holiday in a covered year. The recent change compares two adjacent "
        "28-day windows. These estimates are descriptive and can reflect events or structural changes.", "",
        *table(["Series", "Weekend vs weekday (%)", "Holiday difference (%)",
                "Matched holidays", "Recent vs prior 28 days (%)"],
              [[NAMES[series_id], *pattern_values(patterns.loc[patterns["series_id"].eq(series_id)])]
               for series_id in windows["series_id"]]),
        "External fuel price, labour and registration features were deferred. Their publication timing, "
        "future covariates and per-service validation would require a separate analysis.", "",
        "## Reproduction", "",
        "From the repository root, run the module environment's Python with "
        "-B backend/pipelines/module3_lrt3/run_forecast.py. No network requests are made during the run. "
        "Forecast metadata records input checksums and Step 1 preservation checks.", "",
    ])
    path.write_text("\n".join(lines), encoding="utf-8")


def pattern_values(pattern):
    weekend = pattern.loc[pattern["group"].eq("Weekend vs weekday")]
    holiday = pattern.loc[pattern["pattern"].eq("holiday_vs_comparable_nonholiday")]
    recent = pattern.loc[pattern["pattern"].eq("recent_vs_prior_28d")]
    return [
        display(weekend["difference_pct"].iat[0], 2) if len(weekend) else "—",
        display(holiday["difference_pct"].iat[0], 2) if len(holiday) else "—",
        holiday["observed_days"].iat[0] if len(holiday) else 0,
        display(recent["difference_pct"].iat[0], 2) if len(recent) else "—",
    ]
