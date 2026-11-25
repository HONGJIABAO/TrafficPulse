"""Describe the observed LRT3 demand window and render the EDA chart."""

import numpy as np
import pandas as pd

from ridership import summarize_series


TARGET = "station_origin_trips"
RAPIDRAIL_DOC = "https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily"
HEADLINE_DOC = "https://data.gov.my/data-catalogue/ridership_headline"
KOMUTER_DOC = "https://data.gov.my/data-catalogue/ridership_od_komuter"


def describe_daily(daily):
    series = summarize_series(daily, TARGET, "station_origin_status")
    first_positive = series["first_positive_date"]
    daily["day_type"] = daily["date"].dt.dayofweek.ge(5).map({False: "weekday", True: "weekend"})
    daily["in_observed_demand_window"] = daily["date"].ge(first_positive)
    daily["od_definitions_agree_for_all_stations"] = (
        daily["comparable_stations"].eq(daily["expected_stations"])
        & daily["mismatching_stations"].eq(0)
    )
    window = daily.loc[daily["in_observed_demand_window"]]
    daily["anomaly_flag"] = pd.Series(pd.NA, index=daily.index, dtype="string")
    daily["robust_day_type_z"] = pd.Series(pd.NA, index=daily.index, dtype="Float64")
    for _, group in window.groupby("day_type"):
        values = group[TARGET].dropna()
        median = values.median()
        mad = (values - median).abs().median()
        if len(values) >= 7 and mad > 0:
            z = (values - median) / (1.4826 * mad)
            daily.loc[z.index, "robust_day_type_z"] = z
            daily.loc[z[z.lt(-3.5)].index, "anomaly_flag"] = "low_for_day_type"
            daily.loc[z[z.gt(3.5)].index, "anomaly_flag"] = "high_for_day_type"
    daily.loc[window.index[window[TARGET].eq(0).fillna(False)], "anomaly_flag"] = "zero_after_start"
    daily.loc[window.index[~window["od_definitions_agree_for_all_stations"]], "anomaly_flag"] = (
        "incomplete_or_unreconciled_od"
    )
    latest = window.loc[
        window["od_definitions_agree_for_all_stations"] & window[TARGET].notna(), "date"
    ].max()
    numeric = window.dropna(subset=[TARGET])
    day_types = numeric.groupby("day_type")[TARGET].agg(days="size", mean="mean", total="sum")
    series.update({
        "latest_structurally_reconciled_observation": latest,
        "observed_window_days": len(numeric), "observed_window_total": numeric[TARGET].sum(),
        "observed_window_mean": numeric[TARGET].mean(), "observed_window_median": numeric[TARGET].median(),
        "by_day_type": day_types.to_dict("index"),
        "pre_positive_zero_days": (daily["date"].lt(first_positive) & daily[TARGET].eq(0)).sum(),
        "anomaly_rule": "Within the positive-era calendar window, flag |z| > 3.5 using each "
        "day type's median and 1.4826 times its median absolute deviation. Flag post-start zeros "
        "and incomplete or unreconciled OD dates separately. Retain all observations.",
        "anomalies": daily.loc[daily["anomaly_flag"].notna(), [
            "date", "day_type", TARGET, "anomaly_flag", "robust_day_type_z",
        ]].to_dict("records"),
        "weekly": period_summary(window, "W-SUN"),
        "monthly": period_summary(window, "M"),
    })
    if not numeric.empty:
        series["minimum"] = numeric.loc[numeric[TARGET].idxmin(), ["date", TARGET]].to_dict()
        series["maximum"] = numeric.loc[numeric[TARGET].idxmax(), ["date", TARGET]].to_dict()
    return series


def period_summary(window, frequency):
    periods = []
    for period, group in window.groupby(window["date"].dt.to_period(frequency)):
        days = (period.end_time.normalize() - period.start_time).days + 1
        observed = group[TARGET].notna().sum()
        periods.append({
            "period_start": period.start_time, "period_end": period.end_time.normalize(),
            "calendar_days": days, "days_in_observed_window": len(group), "days_with_values": observed,
            "complete": days == len(group) == observed,
            "trip_sum_observed_days": group[TARGET].sum(min_count=1),
            "mean_per_observed_day": group[TARGET].mean(),
        })
    return periods


def plot_daily(path, daily, headline, report, cache):
    import os

    os.environ["MPLCONFIGDIR"] = str(cache)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.dates as mdates
    import matplotlib.pyplot as plt
    from matplotlib.ticker import StrMethodFormatter

    start = report["first_positive_date"]
    headline_start = headline.loc[headline["headline_trips"].gt(0).fillna(False), "date"].min()
    left = min(start, headline_start) - pd.Timedelta(days=7)
    figure, (top, bottom) = plt.subplots(2, 1, figsize=(12, 7), sharex=True, layout="constrained")
    top.plot(daily["date"], daily[TARGET].to_numpy(dtype=float, na_value=np.nan),
             label="Rapid Rail SA station-origin trips", color="#176b8f", linewidth=1.8)
    top.plot(headline["date"], headline["headline_trips"].to_numpy(dtype=float, na_value=np.nan),
             label="Published Shah Alam headline trips", color="#b55f28", linewidth=1.6)
    top.set_title("Shah Alam Line ridership by source", loc="left", fontweight="bold")
    top.legend(loc="upper right", frameon=False)
    for date, color in [(headline_start, "#b55f28"), (start, "#176b8f")]:
        top.axvline(date, color=color, linewidth=1, linestyle=":", alpha=.7)
    window = daily.loc[daily["in_observed_demand_window"]]
    bottom.plot(window["date"], window[TARGET].rolling(7, min_periods=7).mean(),
                label="7-day mean", linewidth=2.2, color="#176b8f")
    for day_type, color in [("weekday", "#639bb1"), ("weekend", "#7c729f")]:
        rows = window.loc[window["day_type"].eq(day_type)]
        bottom.scatter(rows["date"], rows[TARGET].to_numpy(dtype=float, na_value=np.nan),
                       color=color, s=13, label=day_type.capitalize(), alpha=.8)
    flagged = window.loc[window["anomaly_flag"].notna()]
    if not flagged.empty:
        bottom.scatter(flagged["date"], flagged[TARGET].to_numpy(dtype=float, na_value=np.nan),
                       marker="x", s=40, color="#b23a3a", label="Flagged")
    bottom.set_title("Daily OD trips after the first positive observation", loc="left", fontweight="bold")
    bottom.legend(loc="upper left", frameon=False, ncols=4)
    bottom.set_xlim(left, daily["date"].max() + pd.Timedelta(days=3))
    bottom.xaxis.set_major_locator(mdates.WeekdayLocator(interval=3))
    bottom.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    for axis in (top, bottom):
        axis.set_ylabel("Trips")
        axis.yaxis.set_major_formatter(StrMethodFormatter("{x:,.0f}"))
        axis.grid(axis="y", alpha=.22)
        axis.spines[["top", "right"]].set_visible(False)
    figure.savefig(path, dpi=160, facecolor="white")
    plt.close(figure)
