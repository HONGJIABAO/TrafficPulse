"""Read and document the local headline, validated OD and holiday inputs."""

import hashlib
import re
import csv
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from ridership import valid_counts


HEADLINE = "rapid_rail_headline"
OD = "lrt3_station_origin_od"
NETWORK = "rapid_rail_published_sum"
SHAH = "rail_lrt_shah_alam"
SOURCES = {
    "headline": "https://data.gov.my/data-catalogue/ridership_headline",
    "rapid_rail_operator": "https://www.prasarana.com.my/rapid-rail/",
    "ampang_reporting": "https://myrapid.com.my/wp-content/uploads/2025/01/KENYATAAN-MEDIA-RAPID-KL-BUKA-LEMBARAN-BAHARU-CATAT-REKOD-PENUMPANG-TERTINGGI.pdf",
    "ampang_monthly_crosscheck": "https://www.mot.gov.my/en/Statistik%20Rel/2026%202%20-%20SUKU%20II%202026/JADUAL%202.5%20BILANGAN%20PENUMPANG%20BULANAN%20BAGI%20PERKHIDMATAN%20REL%2C%202026.pdf",
    "rapid_rail_od": "https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily",
    "holidays": "https://www.kabinet.gov.my/hari-kelepasan-am/",
    "holiday_substitution": "https://www.kabinet.gov.my/?id=67&option=com_content&view=article",
    "holiday_overlap": "https://www.kabinet.gov.my/storage/2025/12/JTK_251231_153535.pdf",
}
SERVICES = {
    "rail_lrt_ampang": "LRT Ampang / Sri Petaling",
    "rail_lrt_kj": "LRT Kelana Jaya",
    "rail_mrt_kajang": "MRT Kajang",
    "rail_mrt_pjy": "MRT Putrajaya",
    "rail_monorail": "KL Monorail",
    SHAH: "LRT Shah Alam (headline)",
}
NAMES = SERVICES | {OD: "LRT3 Shah Alam (station-origin OD)", NETWORK: "Rapid Rail published service sum"}
INTERVENTIONS = [
    {"event": "public_operations_start", "date": "2026-06-29",
     "verification": "Transport Minister's statement in Parliament. The launch ceremony was June 28.",
     "source": "https://hansard.parlimen.gov.my/hansard/dewan-rakyat/2026-06-29"},
    {"event": "free_rides_last_day", "date": "2026-08-14",
     "verification": "Bernama reported Rapid KL's July 31 extension announcement.",
     "source": "https://web26.bernama.com/bm/am/news.php?id=2588569"},
    {"event": "paid_service_first_day", "date": "2026-08-15",
     "verification": "Bernama reported Rapid KL's August 14 announcement of fares from the next day.",
     "source": "https://www.bernama.com/radio/news.php?id=2594522"},
]
PAID_START = pd.Timestamp(INTERVENTIONS[-1]["date"])
OPENING = pd.Timestamp(INTERVENTIONS[0]["date"])


def stamp(value):
    return value.date().isoformat() if pd.notna(value) else None


def file_details(path, backend):
    with path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    return {"path": path.relative_to(backend.parent).as_posix(), "sha256": digest,
            "bytes": path.stat().st_size}


def source_series_stats(series, present):
    positive = series.gt(0).fillna(False)
    zero = series.eq(0).fillna(False)
    numeric = series.notna()
    return {
        "first_numeric_date": stamp(series.index[numeric].min()),
        "last_numeric_date": stamp(series.index[numeric].max()),
        "first_positive_date": stamp(series.index[positive].min()),
        "last_positive_date": stamp(series.index[positive].max()),
        "positive_days": int(positive.sum()), "zero_days": int(zero.sum()),
        "null_days": int((present & ~numeric).sum()), "missing_days": int((~present).sum()),
        "zero_dates": series.index[zero].strftime("%Y-%m-%d").tolist(),
    }


def read_headline_candidate(path, backend):
    raw = pd.read_csv(path, dtype="string", encoding="utf-8-sig")
    details = file_details(path, backend)
    details["columns"] = list(raw)
    rail_columns = [c for c in raw if c.startswith("rail_")]
    details["available_rail_columns"] = rail_columns
    if "date" not in raw or not any(column in raw for column in SERVICES):
        raise ValueError("Missing date or supported Rapid Rail columns")
    dates = pd.to_datetime(raw["date"], format="%Y-%m-%d", errors="coerce")
    if dates.isna().any() or dates.duplicated().any():
        raise ValueError("Invalid, missing or duplicate source dates")
    if raw.empty:
        raise ValueError("Empty headline source")
    observed = pd.DataFrame(index=pd.DatetimeIndex(dates, name="date"))
    for col in rail_columns:
        counts, _ = valid_counts(raw[col])
        if (counts.isna() & raw[col].notna()).any():
            raise ValueError(f"Invalid rail counts in {col}")
        observed[col] = counts.array
    calendar = pd.date_range(dates.min(), dates.max(), name="date")
    present = pd.Series(calendar.isin(observed.index), index=calendar)
    frame = observed.reindex(calendar)
    supported = {col: frame[col] for col in SERVICES if col in frame}
    daily_has_service = pd.DataFrame(supported).gt(0).fillna(False).any(axis=1)
    cutoff = calendar[daily_has_service].max()
    if pd.isna(cutoff):
        raise ValueError("No positive supported service observations")
    details.update({
        "source_rows": len(raw), "date_min": stamp(dates.min()), "date_max": stamp(dates.max()),
        "latest_positive_supported_date": stamp(cutoff),
        "available_supported_series": list(supported),
        "missing_calendar_dates": calendar[~present].strftime("%Y-%m-%d").tolist(),
        "services": {col: source_series_stats(frame[col], present) for col in rail_columns},
    })
    return frame, present, details


def load_headline(backend, as_of):
    raw = backend / "data" / "raw"
    reference = backend / "data" / "references" / "module3"
    original = raw / "ridership_headline.csv"
    # Include renamed downloads even if the basename no longer contains "headline".
    candidates = sorted(set(reference.rglob("*.csv")) | set(raw.rglob("*.csv")))
    valid, rejected = {}, []
    for path in candidates:
        if path == raw / "rapidrail_2026_daily.csv":
            continue
        try:
            with path.open(encoding="utf-8-sig", newline="") as handle:
                header = set(next(csv.reader(handle), []))
            if "headline" not in path.name.lower() and not (header & set(SERVICES)):
                continue
            valid[path] = read_headline_candidate(path, backend)
        except (ValueError, OSError, csv.Error) as error:
            rejected.append({"path": path.relative_to(backend.parent).as_posix(), "reason": str(error)})
    if not valid:
        raise ValueError("No valid local headline CSV")
    chosen = max(valid, key=lambda path: (
        valid[path][2]["latest_positive_supported_date"],
        len(valid[path][2]["available_supported_series"]),
        valid[path][2]["source_rows"], path == original,
    ))
    frame, present, selected = valid[chosen]
    runs = {}
    for path, (other, other_present, details) in valid.items():
        if path == chosen:
            continue
        shared = present.index[present].intersection(other_present.index[other_present])
        additions = present.index[present].difference(other_present.index[other_present])
        changed = {}
        for column in sorted(set(frame) & set(other)):
            new, old = frame.loc[shared, column], other.loc[shared, column]
            different = new.isna().ne(old.isna()) | new.ne(old).fillna(False)
            if different.any():
                changed[column] = {
                    "changed_days": int(different.sum()),
                    "old_null_to_new_zero": int((old.isna() & new.eq(0)).sum()),
                    "dates": shared[different].strftime("%Y-%m-%d").tolist(),
                }
        runs[details["path"]] = {
            "shared_source_dates": len(shared), "selected_extra_dates": len(additions),
            "first_selected_extra_date": stamp(additions.min()),
            "last_selected_extra_date": stamp(additions.max()),
            "revisions_on_shared_dates": changed,
        }
    counts = frame.get("rail_lrt_ampang")
    monthly_check = {}
    if counts is not None:
        observed = counts.resample("MS").sum(min_count=1)
        official = [6356549, 5384630, 6072461, 6326276, 6086516, 5862313]
        monthly_check = {
            date.strftime("%Y-%m"): {"headline": int(observed[date]) if pd.notna(observed.get(date)) else None,
                                     "ministry_ampang_series": expected}
            for date, expected in zip(pd.date_range("2026-01-01", periods=6, freq="MS"), official)
        }
    report = {
        "selected": selected, "candidates": [row[2] for row in valid.values()], "rejected": rejected,
        "comparison_with_selected": runs, "publisher": "Prasarana Malaysia and Ministry of Transport via data.gov.my",
        "source_url": SOURCES["headline"], "selection_rule": "Latest positive supported service date. "
        "Coverage and row count resolve ties. The canonical raw file resolves an exact tie.",
        "fallback_to_original": chosen == original,
        "days_after_latest_observation_at_evaluation": (as_of - pd.Timestamp(
            selected["latest_positive_supported_date"]
        )).days,
        "ampang_definition": "Single rail_lrt_ampang series, presented jointly as Ampang / Sri Petaling. "
        "The operator reports these lines jointly, and the local monthly sums cross-check the ministry's "
        "Ampang series. The headline CSV provides no independently separable Sri Petaling series.",
        "ampang_monthly_crosscheck": monthly_check,
        "excluded_rail_columns": [col for col in frame if col not in SERVICES],
        "excluded_bus_columns": [col for col in selected["columns"] if col.startswith("bus_")],
    }
    histories = []
    series = {}
    for col in SERVICES:
        if col not in frame:
            continue
        values = frame[col]
        start = values.index[values.gt(0).fillna(False)].min()
        end = values.index[values.notna()].max()
        status = pd.Series("observed_positive", index=frame.index)
        status.loc[values.eq(0).fillna(False)] = "observed_zero"
        status.loc[values.isna()] = "null"
        status.loc[~present] = "missing"
        eligible = (frame.index >= start) & (frame.index <= end)
        histories.append(pd.DataFrame({
            "date": frame.index, "series_id": col, "target_id": HEADLINE,
            "service_name": SERVICES[col], "unit": "headline_service_trips",
            "actual_trips": values.array, "source_status": status.array,
            "source_row_present": present.array, "in_model_calendar": eligible,
        }))
        if pd.notna(start):
            series[col] = values.loc[start:end].astype(float)
    return pd.concat(histories, ignore_index=True), series, report


def load_od(backend):
    path = backend / "data" / "processed" / "module3_lrt3" / "lrt3_daily.parquet"
    raw = pd.read_parquet(path).set_index("date").sort_index()
    if not raw.index.is_unique:
        raise ValueError("Step 1 OD dates must be unique")
    window = raw.loc[raw["in_observed_demand_window"]].copy()
    if window.empty or not window.index.equals(pd.date_range(window.index.min(), window.index.max(), name="date")):
        raise ValueError("Step 1 OD observation window has a calendar gap")
    trusted = window["od_definitions_agree_for_all_stations"] & window["station_origin_status"].isin(
        ["observed_positive", "observed_zero"]
    )
    counts = window["station_origin_trips"].where(trusted).astype(float)
    counts = counts.loc[:counts.last_valid_index()]
    return counts, file_details(path, backend) | {
        "window_start": stamp(counts.index.min()), "data_cutoff": stamp(counts.index.max()),
        "observed_days": int(counts.notna().sum()), "trips": int(counts.sum()),
        "unreconciled_or_missing_days": int(counts.isna().sum()),
        "excluded_pre_observation_days": int((~raw["in_observed_demand_window"]).sum()),
    }


MONTHS = ("Januari Februari Mac April Mei Jun Julai Ogos September Oktober November Disember").split()
WEEKDAYS = "Isnin Selasa Rabu Khamis Jumaat Sabtu Ahad".split()
DAY = re.compile("|".join(WEEKDAYS))
DATED = re.compile(r"(\d{1,2})\s+(" + "|".join(MONTHS) + r")\b")
REGIONS = ("Kuala Lumpur", "Selangor")
# The 2027 checked boxes are graphical. The extracted '-' glyphs are the negative
# marks. These columns are fixed for the supplied federal and two state layouts.
DASH_COLUMNS_2027 = [(221, 373), (258, 437), (251, 424)]


@dataclass
class HolidayCalendar:
    dates: frozenset
    years: frozenset
    records: list
    sources: list


def dated_holiday_rows(path, year):
    reader = PdfReader(path)
    if len(reader.pages) < 3:
        raise ValueError("Expected federal and two state schedule pages")
    records = []
    seen = [0, 0, 0]
    for index in range(3):
        text = reader.pages[index].extract_text(extraction_mode="layout")
        if f"NEGERI {year}" not in text and f"PERSEKUTUAN {year}" not in text:
            raise ValueError(f"Missing expected {year} schedule heading")
        for line in text.splitlines():
            date_match, day = DATED.search(line), DAY.search(line)
            if not date_match or not day:
                continue
            seen[index] += 1
            date = pd.Timestamp(year, MONTHS.index(date_match[2]) + 1, int(date_match[1]))
            if date.dayofweek != WEEKDAYS.index(day[0]):
                raise ValueError(f"Date/weekday conflict on page {index + 1}: {date}")
            label = line[:min(date_match.start(), day.start())].strip()
            label = re.sub(r"^\d+\.?\s+|\d+$", "", label).strip()
            label = re.sub(r"\s+", " ", label).replace(f"{year}", "").strip()
            marks = {m.start(): m[0] for m in re.finditer(r"[√-]", line)
                     if m.start() > max(date_match.end(), day.end())}
            if year == 2027:
                applicable = [region for region, column in zip(REGIONS, DASH_COLUMNS_2027[index])
                              if marks.get(column) != "-"]
            elif index == 0:
                applicable = [region for region, column in zip(REGIONS, (157, 262))
                              if marks.get(column) == "√"]
            else:
                if len(marks) != 16:
                    raise ValueError(f"Unresolved 2026 state columns on page {index + 1}: {label}")
                ordered = list(marks.values())
                applicable = [region for region, value in zip(REGIONS, (ordered[0], ordered[14]))
                              if value == "√"]
            for region in applicable:
                records.append({"date": stamp(date), "region": region, "holiday": label.rstrip(" *"),
                                "source_file": path.name, "source_page": index + 1,
                                "source_marks_date_tentative": "*" in label, "kind": "pdf_scheduled"})
    if seen[0] != 15 or min(seen[1:]) < 12:
        raise ValueError(f"Unexpected dated row coverage {seen}")
    return records


def load_holidays(backend):
    reference = backend / "data" / "references" / "module3"
    records, details, years = [], [], set()
    for year, filename in [(2026, "HKA-2026.pdf"), (2027, "HKA_2027.pdf")]:
        path = reference / filename
        artifact = {"file": filename, "year": year, "official_index_url": SOURCES["holidays"]}
        try:
            artifact.update(file_details(path, backend))
            extracted = dated_holiday_rows(path, year)
            records.extend(extracted)
            years.add(year)
            artifact.update({"status": "extracted", "region_holiday_rows": len(extracted)})
        except (OSError, ValueError, PdfReadError) as error:
            artifact.update({"status": "omitted", "reason": str(error)})
        details.append(artifact)
    # Act 369 Sunday substitutions. Deduplicate simultaneous holidays before applying
    # the rule. A conditional employer-level second substitution is outside this feature.
    replacements = []
    for region in REGIONS:
        by_date = {}
        for row in records:
            if row["region"] == region:
                by_date.setdefault(pd.Timestamp(row["date"]), []).append(row)
        occupied = set(by_date)
        for date, items in sorted(by_date.items()):
            if date.dayofweek != 6:
                continue
            substitute = date + pd.Timedelta(days=1)
            while substitute in occupied:
                substitute += pd.Timedelta(days=1)
            if substitute.year not in years:
                continue
            occupied.add(substitute)
            replacements.append(items[0] | {"date": stamp(substitute), "kind": "sunday_substitution",
                                              "holiday": " / ".join(item["holiday"] for item in items),
                                              "observed_for_date": stamp(date),
                                              "rule_url": SOURCES["holiday_substitution"]})
    records.extend(replacements)
    unique = {(row["date"], row["region"], row["holiday"], row["kind"]): row for row in records}
    return HolidayCalendar(frozenset(pd.Timestamp(row["date"]) for row in records),
                           frozenset(years), list(unique.values()), details)
