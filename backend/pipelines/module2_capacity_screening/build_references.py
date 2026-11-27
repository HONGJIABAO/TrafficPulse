from __future__ import annotations

import csv
import io
import json
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data" / "module2_capacity_screening"
RAW_DIR = DATA_DIR / "raw"


def read_gtfs_table(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline="")))


def build_train_capacity_reference() -> list[dict[str, str]]:
    rows = [
        {
            "service_code": "ktm_komuter_kv",
            "service_name": "KTM Komuter Klang Valley (Seremban & Port Klang Lines)",
            "trainset_label": "6-Car SCS (Class 92 EMU)",
            "capacity_basis": "seated_and_standing_total",
            "nominal_capacity_pax": "1118",
            "coaches_per_train": "6",
            "official_source": "ETS-REDCARD.pdf (p.3: SCS 6 coaches, 1118 pax Seated & Standing, 128 trips/day reference)",
            "screening_mode": "official_2023_nominal",
            "eligible_for_full_screening": "true",
            "notes": "2023 official KTMB reference nominal train capacity used as scenario baseline; KVDT2 single-track works from 2026-04-18 reduce active Seremban Line trips in 2026 GTFS.",
        },
        {
            "service_code": "ktm_komuter_kv_sensitivity_80pct",
            "service_name": "KTM Komuter Klang Valley — 80% Planning Comfort Sensitivity",
            "trainset_label": "6-Car SCS (80% Comfort Threshold)",
            "capacity_basis": "planning_sensitivity_80pct",
            "nominal_capacity_pax": "894",
            "coaches_per_train": "6",
            "official_source": "Derived sensitivity benchmark (round(0.80 * 1118) = 894)",
            "screening_mode": "planning_sensitivity_80pct",
            "eligible_for_full_screening": "sensitivity_only",
            "notes": "Sensitivity benchmark only; never labeled as physical measurement or official threshold.",
        },
        {
            "service_code": "ktm_komuter_utara",
            "service_name": "KTM Komuter Utara (Padang Besar & Ipoh Lines)",
            "trainset_label": "3-Car EMU",
            "capacity_basis": "seated_and_standing_total",
            "nominal_capacity_pax": "400",
            "coaches_per_train": "3",
            "official_source": "ETS-REDCARD.pdf (p.3: EMU Northern 3 coaches, 400 pax Seated & Standing, 38 trips/day reference)",
            "screening_mode": "official_2023_nominal",
            "eligible_for_full_screening": "true",
            "notes": "2023 official KTMB reference nominal capacity; 2026 GTFS operates 62 daily trips across Butterworth-Padang Besar (38) and Butterworth-Ipoh (24).",
        },
        {
            "service_code": "ktm_komuter_utara_sensitivity_80pct",
            "service_name": "KTM Komuter Utara — 80% Planning Comfort Sensitivity",
            "trainset_label": "3-Car EMU (80% Comfort Threshold)",
            "capacity_basis": "planning_sensitivity_80pct",
            "nominal_capacity_pax": "320",
            "coaches_per_train": "3",
            "official_source": "Derived sensitivity benchmark (round(0.80 * 400) = 320)",
            "screening_mode": "planning_sensitivity_80pct",
            "eligible_for_full_screening": "sensitivity_only",
            "notes": "Sensitivity benchmark only.",
        },
        {
            "service_code": "ktm_ets",
            "service_name": "KTM Electric Train Service (ETS)",
            "trainset_label": "6-Car ETS (ETS1 / ETS2)",
            "capacity_basis": "seated_only",
            "nominal_capacity_pax": "315",
            "coaches_per_train": "6",
            "official_source": "ETS-REDCARD.pdf (p.3: ETS 6 coaches, 315 pax Seated, 32 trips/day ref)",
            "screening_mode": "unavailable_seated_and_express_mismatch",
            "eligible_for_full_screening": "false",
            "notes": "Excluded from total segment/station capacity gap comparison because Red Card specifies seated-only (no standing/class formation assignment per GTFS trip) and OD rows lack train-number attribution across variable skip-stop express patterns.",
        },
        {
            "service_code": "ktm_intercity_sh",
            "service_name": "KTM Intercity Shuttle Timur (SH)",
            "trainset_label": "4-Car DMU",
            "capacity_basis": "seated_only",
            "nominal_capacity_pax": "198",
            "coaches_per_train": "4",
            "official_source": "ETS-REDCARD.pdf (p.3: DMU 4 coaches, 198 pax Seated, 14 trips/day ref; excludes ERT loco-hauled)",
            "screening_mode": "unavailable_seated_and_mixed_stock",
            "eligible_for_full_screening": "false",
            "notes": "intercity_2026.csv pools SH (DMU) and ERT (loco-hauled Ekspres Rakyat Timuran) without train_id, and DMU Red Card is seated-only.",
        },
        {
            "service_code": "ktm_shuttle_tebrau",
            "service_name": "KTM Shuttle Tebrau (JB Sentral - Woodlands CIQ)",
            "trainset_label": "Unverified in Red Card",
            "capacity_basis": "unverified",
            "nominal_capacity_pax": "",
            "coaches_per_train": "",
            "official_source": "Not documented in ETS-REDCARD.pdf",
            "screening_mode": "unavailable_no_capacity_reference",
            "eligible_for_full_screening": "false",
            "notes": "Hourly OD available (shuttle_tebrau_2026.csv), but capacity reference is missing; do not apply DMU 198.",
        },
        {
            "service_code": "rapid_rail",
            "service_name": "Prasarana Rapid Rail (LRT Kelana Jaya, Ampang/Sri Petaling, MRT Kajang/Putrajaya, KL Monorail)",
            "trainset_label": "Mixed Fleet (2-car / 4-car / 6-car)",
            "capacity_basis": "unavailable_hourly_and_fleet_unverified",
            "nominal_capacity_pax": "",
            "coaches_per_train": "",
            "official_source": "rapid_rail_gtfs.zip frequencies.txt + rapidrail_2026_daily.csv (daily-only)",
            "screening_mode": "unavailable_daily_od_only",
            "eligible_for_full_screening": "false",
            "notes": "rapidrail_2026_daily.csv lacks hourly timestamps and contains A0 aggregate summary rows; hourly demand and per-trip fleet capacity cannot be reconstructed without fabrication.",
        },
    ]

    out_path = DATA_DIR / "train_capacity_reference.csv"
    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return rows


def build_scheduled_service_reference() -> list[dict[str, str]]:
    with zipfile.ZipFile(RAW_DIR / "ktmb_gtfs.zip") as zf:
        routes = {r["route_id"]: r for r in read_gtfs_table(zf, "routes.txt")}
        trips = read_gtfs_table(zf, "trips.txt")
        stop_times = read_gtfs_table(zf, "stop_times.txt")
        calendars = {c["service_id"]: c for c in read_gtfs_table(zf, "calendar.txt")}
        cal_dates = read_gtfs_table(zf, "calendar_dates.txt")

    st_by_trip = defaultdict(list)
    midnight_trips = Counter()
    for st in stop_times:
        st_by_trip[st["trip_id"]].append(st)
        hh = int(st["departure_time"].split(":")[0])
        if hh >= 24:
            midnight_trips[st["trip_id"]] += 1

    trip_counts = Counter((t["route_id"], t["service_id"]) for t in trips)
    overrides = [f"{cd['date']}:{cd['service_id']}=ex{cd['exception_type']}" for cd in cal_dates]

    out_rows: list[dict[str, str]] = []
    for (rid, sid), cnt in sorted(trip_counts.items()):
        cal = calendars.get(sid, {})
        route = routes.get(rid, {})
        route_midnight = sum(1 for t in trips if t["route_id"] == rid and t["service_id"] == sid and midnight_trips[t["trip_id"]] > 0)
        eligible = rid in {"KC05_KB18", "KA15_KD19", "100_47300", "100_9000"}
        pdf_note = ""
        if rid == "KC05_KB18" and sid == "komuter_weekday":
            pdf_note = "Matches BC-PS-BC_WEEKDAY_10112026.pdf (24 SB + 24 NB; 5 peak Pulau Sebang, 9 Midvalley/Salak Selatan, 10 KL Sentral; KVDT2 closure FAQ_KVDT_2.pdf)"
        elif rid == "KC05_KB18" and sid == "komuter_weekend":
            pdf_note = "Matches BC-PS-BC_WEEKEND_14112026.pdf (17 SB + 17 NB; 2 thru Pulau Sebang; KVDT2 closure)"
        elif rid == "KA15_KD19":
            pdf_note = "FAQ_KVDT_2.pdf Q11 confirms Tanjong Malim - Pelabuhan Klang timetable unchanged during KVDT2 phase"
        elif rid in {"100_47300", "100_9000"}:
            pdf_note = "GTFS active daily 2026-08-18..2026-12-12"

        out_rows.append(
            {
                "route_id": rid,
                "route_short_name": route.get("route_short_name", ""),
                "route_long_name": route.get("route_long_name", ""),
                "service_id": sid,
                "valid_start_date": cal.get("start_date", ""),
                "valid_end_date": cal.get("end_date", ""),
                "active_days_mask": "".join(cal.get(d, "0") for d in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
                "scheduled_trips_per_day": str(cnt),
                "trips_crossing_24h": str(route_midnight),
                "calendar_date_overrides": "; ".join(overrides) if sid.startswith("komuter_week") else "",
                "eligible_for_capacity_screening": str(eligible).lower(),
                "pdf_and_doc_reconciliation": pdf_note,
            }
        )

    out_path = DATA_DIR / "scheduled_service_reference.csv"
    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        writer.writeheader()
        writer.writerows(out_rows)
    return out_rows


def main() -> None:
    cap_rows = build_train_capacity_reference()
    svc_rows = build_scheduled_service_reference()
    print(f"Wrote {len(cap_rows)} rows to train_capacity_reference.csv")
    print(f"Wrote {len(svc_rows)} rows to scheduled_service_reference.csv")
    for r in svc_rows:
        print(f"  {r['route_id']} [{r['service_id']}]: {r['scheduled_trips_per_day']} trips/day, 24h_crossings={r['trips_crossing_24h']}, valid={r['valid_start_date']}..{r['valid_end_date']}")


if __name__ == "__main__":
    main()
