"""Classify the archived holiday evidence and correct only its derived presentation."""

from collections import defaultdict
from datetime import date, timedelta
from statistics import mean

REVISION = "module3-v1-step6b.1"
CORRECTION_ARTIFACT = "v1_calendar_corrections_6b.json"
VERIFIED = "verified_holiday"
TENTATIVE = "tentative_holiday"
ORDINARY = "known_non_holiday"
UNKNOWN = "unknown_calendar"
AVAILABLE_SUPPLY = {"ordinary_day_GTFS_reference", "reference_held_beyond_GTFS_validity"}


def archived_calendar(metadata):
    by_date = defaultdict(list)
    regions_by_year = defaultdict(set)
    for row in metadata["calendar"]:
        day = date.fromisoformat(row["date"])
        by_date[day.isoformat()].append(row)
        regions_by_year[day.year].add(row["region"])
    regions = set().union(*regions_by_year.values())
    years = [year for year in metadata["covered_years"] if regions and regions_by_year[year] == regions]
    dates = {}
    for day, records in sorted(by_date.items()):
        dates[day] = {
            "status": VERIFIED if any(not row["source_marks_date_tentative"] for row in records) else TENTATIVE,
            "evidence": records,
        }
    return {"regions": sorted(regions), "coveredYears": sorted(years), "dates": dates}


def holiday_status(calendar, day):
    entry = calendar["dates"].get(day.isoformat())
    if entry:
        return entry["status"]
    return ORDINARY if day.year in calendar["coveredYears"] else UNKNOWN


def corrected_supply(calendar, day, archived_status, within_calendar):
    classification = holiday_status(calendar, day)
    if classification == VERIFIED or archived_status == "unavailable_no_holiday_timetable":
        if classification == TENTATIVE:
            return "unavailable_tentative_holiday_timetable"
        return "unavailable_no_holiday_timetable"
    if classification == TENTATIVE:
        return "unavailable_tentative_holiday_timetable"
    if classification == UNKNOWN or archived_status not in AVAILABLE_SUPPLY:
        return "unavailable_unknown_holiday_calendar"
    return "ordinary_day_GTFS_reference" if within_calendar else "reference_held_beyond_GTFS_validity"


def holiday_contrasts(history, original_rows, calendar):
    """Hold all matching rules constant and vary only the calendar qualification."""
    output, comparisons = [], []
    for original in original_rows:
        series = history[original["series_id"]]
        lower = series[-1][0] - timedelta(days=364)
        recent = [(when.date(), value) for when, value, _ in series if when >= lower and value is not None]
        ordinary = defaultdict(list)
        holidays = []
        for day, value in recent:
            classification = holiday_status(calendar, day)
            if classification == ORDINARY:
                ordinary[day.weekday()].append((day, value))
            if classification == VERIFIED:
                holidays.append((day, value))
        paired = []
        for day, value in holidays:
            matches = [v for when, v in ordinary[day.weekday()] if abs((when - day).days) <= 28]
            if matches:
                paired.append((day, value, mean(matches), len(matches)))
        observed = mean(row[1] for row in paired) if paired else None
        reference = mean(row[2] for row in paired) if paired else None
        control_uses = sum(row[3] for row in paired)
        corrected = {
            **original, "group": "Verified holidays matched to known non-holidays",
            "period_start": paired[0][0] if paired else None, "period_end": paired[-1][0] if paired else None,
            "observed_days": len(paired), "mean_daily_trips": observed, "reference_mean_daily_trips": reference,
            "reference_observations": len(paired), "matched_control_date_uses": control_uses,
            "difference_pct": 100 * (observed / reference - 1) if reference else None,
        }
        output.append(corrected)
        comparisons.append({
            "series_id": original["series_id"],
            "archived_days": original["observed_days"], "archived_difference_pct": original["difference_pct"],
            "corrected_days": len(paired), "corrected_difference_pct": corrected["difference_pct"],
            "verified_dates": [row[0] for row in paired], "matched_control_date_uses": control_uses,
        })
    return output, comparisons
