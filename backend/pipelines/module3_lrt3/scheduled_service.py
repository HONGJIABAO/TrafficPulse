"""Validate the local GTFS and count terminal departures by service day."""

from dataclasses import dataclass
from pathlib import PurePosixPath
from zipfile import ZipFile

import numpy as np
import pandas as pd

from gtfs import TABLES
from run_validation import require


HOUR = 3600
DAY = 24 * HOUR
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
DAY_GROUPS = {"weekday": WEEKDAYS[:5], "saturday": ("saturday",), "sunday": ("sunday",)}
DIRECTIONS = ("0", "1", "both")
SHAH_ROUTE = "SA"
ROUTE_TO_SERVICE = {
    "AG": "rail_lrt_ampang", "PH": "rail_lrt_ampang", "KJ": "rail_lrt_kj",
    "KGL": "rail_mrt_kajang", "PYL": "rail_mrt_pjy", "MR": "rail_monorail",
    "SA": "rail_lrt_shah_alam", "BRT": None,
}
SHARED_REASON = ("Ampang and Sri Petaling use 11 shared stops on a common trunk. "
                 "The feed does not establish whether the published headways are branch-specific "
                 "or shared, so a combined service denominator is withheld.")
REQUIRED = {"agency", "routes", "trips", "stops", "stop_times", "calendar"}


@dataclass(frozen=True)
class Pattern:
    trip_id: str
    route_id: str
    direction: str
    service_id: str
    stops: tuple
    origin_departure: int
    terminal_arrival: int
    intervals: tuple

    @property
    def exact(self):
        if not self.intervals:
            return (self.origin_departure,)
        return tuple(
            departure for start, end, headway, exact_times in self.intervals if exact_times
            for departure in range(start, end, headway)
        )

    @property
    def implied(self):
        return tuple((start, end, headway) for start, end, headway, exact in self.intervals if not exact)


def clock(seconds):
    hour, remainder = divmod(seconds, HOUR)
    minute, second = divmod(remainder, 60)
    return f"{hour:02d}:{minute:02d}:{second:02d}"


def parse_time(value):
    hours, minutes, seconds = map(int, value.split(":"))
    require(hours >= 0 and 0 <= minutes < 60 and 0 <= seconds < 60, f"Invalid GTFS time {value}")
    return hours * HOUR + minutes * 60 + seconds


def read_feed(raw):
    feeds = []
    for path in sorted(raw.rglob("*.zip")):
        with ZipFile(path) as archive:
            entries = [name for name in archive.namelist() if not name.startswith("__MACOSX/")
                       and not PurePosixPath(name).name.startswith("._") and not name.endswith("/")]
            members = {PurePosixPath(name).name: name for name in entries}
            if "routes.txt" not in members:
                continue

            def read(name):
                with archive.open(members[name + ".txt"]) as handle:
                    return pd.read_csv(handle, dtype="string", keep_default_na=False, encoding="utf-8-sig")

            routes = read("routes")
            if not routes["route_id"].eq(SHAH_ROUTE).any():
                continue
            require(len(members) == len(entries) and archive.testzip() is None, "Duplicate members or damaged GTFS")
            tables = {name: read(name) for name in TABLES if name + ".txt" in members}
            feeds.append((path, tables, sorted(entries), len(archive.namelist()) - len(entries)))
    require(len(feeds) == 1, f"Expected one GTFS archive with Shah Alam, found {len(feeds)}")
    path, tables, entries, ignored = feeds[0]
    require(REQUIRED.issubset(tables), f"Required GTFS tables missing: {REQUIRED - set(tables)}")
    return path, tables, entries, ignored


def unique(frame, keys):
    require(frame[keys].ne("").all().all() and not frame.duplicated(keys).any(), f"Invalid GTFS key {keys}")


def validate_coordinates(frame, lat, lon):
    require(pd.to_numeric(frame[lat]).between(-90, 90).all() and pd.to_numeric(frame[lon]).between(-180, 180).all(),
            "Invalid GTFS coordinates")


def load_patterns(tables, reference_date):
    agency, routes, stops = [tables[name] for name in ("agency", "routes", "stops")]
    trips, times, calendar = [tables[name].copy() for name in ("trips", "stop_times", "calendar")]
    for frame, key in [(agency, "agency_id"), (routes, "route_id"), (trips, "trip_id"),
                       (stops, "stop_id"), (calendar, "service_id")]:
        unique(frame, [key])
    require(set(routes["route_id"]) == set(ROUTE_TO_SERVICE)
            and routes["agency_id"].isin(agency["agency_id"]).all()
            and agency["agency_timezone"].eq("Asia/Kuala_Lumpur").all(), "Unexpected route IDs or agency")
    require(trips["route_id"].isin(routes["route_id"]).all()
            and trips["service_id"].isin(calendar["service_id"]).all()
            and set(trips["direction_id"]) == {"0", "1"}
            and set(trips["trip_id"]) == set(times["trip_id"])
            and times["stop_id"].isin(stops["stop_id"]).all(), "Broken GTFS trip or stop references")
    validate_coordinates(stops, "stop_lat", "stop_lon")
    if "shapes" in tables:
        shapes = tables["shapes"].copy()
        shapes["shape_pt_sequence"] = shapes["shape_pt_sequence"].astype(int)
        unique(shapes, ["shape_id", "shape_pt_sequence"])
        validate_coordinates(shapes, "shape_pt_lat", "shape_pt_lon")
        require(shapes["shape_pt_sequence"].ge(0).all() and trips["shape_id"].isin(shapes["shape_id"]).all(),
                "Invalid shapes or unlinked trip shape")
    require(calendar[list(WEEKDAYS)].isin(["0", "1"]).all().all()
            and calendar[list(WEEKDAYS)].eq("1").any(axis=1).all(), "Invalid weekly calendar")
    for field in ("start_date", "end_date"):
        calendar[field] = pd.to_datetime(calendar[field], format="%Y%m%d")
    require(calendar["start_date"].le(calendar["end_date"]).all(), "Invalid calendar range")
    calendar = calendar.set_index("service_id")
    exceptions = []
    if "calendar_dates" in tables:
        frame = tables["calendar_dates"].copy()
        unique(frame, ["service_id", "date"])
        frame["date"] = pd.to_datetime(frame["date"], format="%Y%m%d")
        require(frame["exception_type"].isin(["1", "2"]).all(), "Invalid calendar exception type")
        exceptions = frame.to_dict("records")

    times["stop_sequence"] = times["stop_sequence"].astype(int)
    unique(times, ["trip_id", "stop_sequence"])
    require(times["stop_sequence"].ge(0).all(), "Invalid stop sequence")
    for field in ("arrival_time", "departure_time"):
        times[field] = times[field].map(parse_time)
    require(times["departure_time"].ge(times["arrival_time"]).all(), "Negative scheduled dwell")
    times = times.sort_values(["trip_id", "stop_sequence"])
    previous_departure = times.groupby("trip_id")["departure_time"].shift()
    require(times["arrival_time"].ge(previous_departure).loc[previous_departure.notna()].all(),
            "Nonmonotone trip stop times")

    intervals = {}
    if "frequencies" in tables:
        freq = tables["frequencies"].copy()
        if "exact_times" not in freq:
            freq["exact_times"] = "0"
        freq["exact_times"] = freq["exact_times"].replace("", "0").astype(int)
        freq["start_time"] = freq["start_time"].map(parse_time)
        freq["end_time"] = freq["end_time"].map(parse_time)
        freq["headway_secs"] = freq["headway_secs"].astype(int)
        unique(freq, ["trip_id", "start_time"])
        require(freq["trip_id"].isin(trips["trip_id"]).all() and freq["exact_times"].isin([0, 1]).all()
                and freq["headway_secs"].gt(0).all() and freq["end_time"].gt(freq["start_time"]).all(),
                "Invalid frequency rows")
        freq = freq.sort_values(["trip_id", "start_time"])
        previous_end = freq.groupby("trip_id")["end_time"].shift()
        require(freq["start_time"].ge(previous_end).loc[previous_end.notna()].all(),
                "Overlapping headway intervals for the same trip")
        fields = ["start_time", "end_time", "headway_secs", "exact_times"]
        intervals = {key: tuple(group[fields].itertuples(index=False, name=None))
                     for key, group in freq.groupby("trip_id")}
    details = routes.set_index("route_id")
    by_trip = {key: group for key, group in times.groupby("trip_id")}
    patterns, route_aliases = [], set()
    for trip in trips.itertuples():
        stops_on_trip = by_trip[trip.trip_id]
        require(len(stops_on_trip) >= 2, f"Trip {trip.trip_id} has no terminal pair")
        if "direction_id" in stops_on_trip:
            require(stops_on_trip["direction_id"].eq(trip.direction_id).all(), "Conflicting stop-time directions")
        if "route_id" in stops_on_trip:
            alias = details.at[trip.route_id, "route_short_name"]
            require(stops_on_trip["route_id"].isin([trip.route_id, alias]).all(), "Conflicting stop-time route alias")
            route_aliases.update(stops_on_trip.loc[stops_on_trip["route_id"].ne(trip.route_id), "route_id"])
        patterns.append(Pattern(
            trip.trip_id, trip.route_id, trip.direction_id, trip.service_id, tuple(stops_on_trip["stop_id"]),
            int(stops_on_trip["departure_time"].iat[0]), int(stops_on_trip["arrival_time"].iat[-1]),
            intervals.get(trip.trip_id, ()),
        ))
    used = calendar.loc[sorted(set(trips["service_id"]))]
    pattern_date = min(reference_date, used["end_date"].min())
    require(used["start_date"].le(pattern_date).all(), "No common reference calendar for the requested date")
    true_clock = [
        value for pattern in patterns for value in (*pattern.exact, *(a for a, _, _ in pattern.implied))
    ]
    audit = {
        "declared_valid_from": used["start_date"].max(), "declared_valid_to": used["end_date"].min(),
        "pattern_reference_date": pattern_date,
        "all_calendars": calendar.reset_index().to_dict("records"),
        "used_service_ids": list(used.index), "unused_service_ids": sorted(set(calendar.index) - set(used.index)),
        "calendar_date_exceptions": exceptions, "stop_time_route_aliases": sorted(route_aliases),
        "frequency_templates": sum(bool(p.intervals) for p in patterns),
        "fixed_stop_time_trips": sum(not p.intervals for p in patterns),
        "exact_times_field_present": "frequencies" in tables and "exact_times" in tables["frequencies"],
        "frequency_modes": {"implied": sum(row[3] == 0 for rows in intervals.values() for row in rows),
                            "exact": sum(row[3] == 1 for rows in intervals.values() for row in rows)},
        "frequency_intervals": [
            {"trip_id": p.trip_id, "start_time": clock(a), "end_time_exclusive": clock(b),
             "headway_seconds": h, "exact_times": exact, "midnight_boundary": b == DAY}
            for p in patterns for a, b, h, exact in p.intervals
        ],
        "intervals_ending_at_24": sum(b == DAY for rows in intervals.values() for _, b, _, _ in rows),
        "intervals_ending_after_24": sum(b > DAY for rows in intervals.values() for _, b, _, _ in rows),
        "start_times_at_or_after_24": sum(value >= DAY for value in true_clock),
        "stop_template_times_after_24": int(times[["arrival_time", "departure_time"]].gt(DAY).sum().sum()),
        "templates_with_possible_arrival_after_24": [
            p.trip_id for p in patterns
            if any(time + p.terminal_arrival - p.origin_departure > DAY for time in p.exact)
            or any(end + p.terminal_arrival - p.origin_departure > DAY for _, end, _ in p.implied)
        ],
        "template_paths": [
            {"trip_id": p.trip_id, "route_id": p.route_id, "direction_id": p.direction, "service_id": p.service_id,
             "first_stop_id": p.stops[0], "last_stop_id": p.stops[-1], "stop_count": len(p.stops),
             "template_origin_departure": clock(p.origin_departure), "template_terminal_arrival": clock(p.terminal_arrival)}
            for p in patterns
        ],
    }
    return patterns, calendar, audit


def departure_counts(exact, implied, start, end):
    return (
        sum(start <= time < end for time in exact),
        sum(max(0, min(end, stop) - max(start, begin)) / headway for begin, stop, headway in implied),
    )


def count_fields(exact, implied, duration):
    total = exact + implied
    return {"exact_scheduled_departures": exact, "frequency_implied_departures": implied,
            "reference_departures": total, "departures_per_hour": total * HOUR / duration}


def make_schedule(tables, patterns, calendar, audit, config):
    # Test a floor/ceiling edge and the half-open midnight boundary irrespective of feed contents.
    require(departure_counts([7*HOUR, 8*HOUR, 9*HOUR], [(7*HOUR, 9*HOUR, 480)], 7*HOUR, 9*HOUR) == (2, 15),
            "Half-open departure arithmetic failed")
    require(departure_counts([DAY], [(DAY - 1800, DAY, 600)], DAY - HOUR, DAY) == (0, 3),
            "Service-day boundary arithmetic failed")
    require(departure_counts([DAY + 600], [(DAY, DAY + 1200, 600)], DAY, DAY + HOUR) == (1, 2),
            "Post-midnight services must remain on the departure service day")
    routes = tables["routes"].set_index("route_id")
    stop_names = tables["stops"].set_index("stop_id")["stop_name"].to_dict()
    frequency_end = [end for p in patterns for _, end, _, _ in p.intervals]
    exact_end = [t + 1 for p in patterns for t in p.exact]
    hours = (max([DAY, *frequency_end, *exact_end]) + HOUR - 1) // HOUR
    windows = {"all_day": (0, hours * HOUR)} | {
        label: (start * HOUR, stop * HOUR) for label, (start, stop) in config["windows_hours"].items()
    }
    hourly, summary, mapping = [], [], []
    for route_id, route in routes.iterrows():
        all_trips = [p for p in patterns if p.route_id == route_id]
        route_fields = {
            "route_id": route_id, "route_name": route["route_long_name"], "mode": route["category"],
            "is_rail": route_id != "BRT", "schedule_reference_date": audit["pattern_reference_date"],
            "calendar_valid_from": audit["declared_valid_from"], "calendar_valid_to": audit["declared_valid_to"],
            "evidence_class": "GTFS_reference_timetable", "departures_unit": "terminal_vehicle_departures",
        }
        mapping_row = route_fields | {
            "route_short_name": route["route_short_name"], "route_type_in_feed": route["route_type"],
            "headline_series_id": ROUTE_TO_SERVICE[route_id], "trip_templates": len(all_trips),
            "service_ids": "|".join(sorted({p.service_id for p in all_trips})),
            "intensity_status": (
                "unavailable_shared_trunk" if route_id in ("AG", "PH")
                else "excluded_nonrail" if route_id == "BRT" else "available_reference"
            ),
            "mapping_notes": (
                SHARED_REASON if route_id in ("AG", "PH")
                else "Sunway BRT is a bus service. The feed's route_type=0 is inconsistent with its BRT category."
                if route_id == "BRT"
                else "One GTFS rail route corresponds to one published service series."
            ),
        }
        for direction in DIRECTIONS[:2]:
            subset = [p for p in all_trips if p.direction == direction]
            paths = {p.stops for p in subset}
            pairs = {(path[0], path[-1]) for path in paths}
            mapping_row[f"direction_{direction}_terminal_pairs"] = "|".join(
                f"{stop_names[start]} → {stop_names[end]}" for start, end in sorted(pairs)
            )
            mapping_row[f"direction_{direction}_path_count"] = len(paths)
            mapping_row[f"direction_{direction}_terminal_pair_count"] = len(pairs)
        mapping.append(mapping_row)
        for day_type, days in DAY_GROUPS.items():
            selected = {}
            for direction in DIRECTIONS[:2]:
                matching = [[p for p in all_trips if p.direction == direction
                             and calendar.at[p.service_id, day] == "1"] for day in days]
                require(matching[0] and all(
                    [p.trip_id for p in group] == [p.trip_id for p in matching[0]] for group in matching
                ), f"Nonuniform or missing {day_type} schedule for {route_id}/{direction}")
                selected[direction] = matching[0]
                identities = [(p.stops, time) for p in matching[0] for time in p.exact]
                implied_by_path = {}
                for p in matching[0]:
                    implied_by_path.setdefault(p.stops, []).extend(p.implied)
                for intervals in implied_by_path.values():
                    ordered = sorted(intervals)
                    require(all(previous[1] <= following[0] for previous, following in zip(ordered, ordered[1:])),
                            f"Duplicate or overlapping active frequency templates for {route_id}/{direction}")
                require(len(identities) == len(set(identities)) and all(
                    all(not start <= time < stop for start, stop, _ in implied_by_path[path])
                    for path, time in identities
                ), "Duplicate active departures or overlap between exact and implied patterns")
            selected["both"] = selected["0"] + selected["1"]
            for direction, direction_trips in selected.items():
                exact = tuple(time for p in direction_trips for time in p.exact)
                implied = tuple(entry for p in direction_trips for entry in p.implied)
                start_of_service = min([*exact, *(a for a, _, _ in implied)])
                end_of_service = max([*exact, *(b for _, b, _ in implied)])
                end_basis = "frequency_window_end_exclusive" if end_of_service in {b for _, b, _ in implied} \
                    else "last_scheduled_exact_departure"
                tags = route_fields | {
                    "day_type": day_type, "direction_id": direction,
                    "direction_label": "Both directions summed" if direction == "both"
                    else mapping_row[f"direction_{direction}_terminal_pairs"],
                    "count_basis": "mixed_reference" if exact and implied else
                    "frequency_implied" if implied else "exact_stop_times_or_frequency",
                }
                for hour in range(hours):
                    lo, hi = hour * HOUR, (hour + 1) * HOUR
                    hourly.append(tags | {"service_hour": hour, "start_time": clock(lo), "end_time_exclusive": clock(hi)}
                                  | count_fields(*departure_counts(exact, implied, lo, hi), hi - lo))
                off_start, off_end = windows["off_peak"]
                off = sum(departure_counts(exact, implied, off_start, off_end)) * HOUR / (off_end - off_start)
                for period, (lo, hi) in windows.items():
                    fields = count_fields(*departure_counts(exact, implied, lo, hi), hi - lo)
                    rate = fields["departures_per_hour"]
                    summary.append(tags | fields | {
                        "period": period, "period_start": clock(lo), "period_end_exclusive": clock(hi),
                        "period_hours": (hi - lo) / HOUR, "reference_service_start": clock(start_of_service),
                        "reference_service_end": clock(end_of_service), "reference_service_end_basis": end_basis,
                        "terminal_service_span_hours": (end_of_service - start_of_service) / HOUR,
                        "effective_headway_minutes": 60 / rate if direction != "both" and rate else np.nan,
                        "peak_to_offpeak_rate_ratio": rate / off if period in ("am_peak", "pm_peak") and off else np.nan,
                    })
    ag = next(p for p in patterns if p.route_id == "AG" and p.direction == "0")
    ph = next(p for p in patterns if p.route_id == "PH" and p.direction == "0")
    shared = sorted({stop_names[s] for s in ag.stops} & {stop_names[s] for s in ph.stops})
    require(len(shared) == 11, "Ampang/Sri Petaling trunk mapping requires review")
    audit.update({"amp_sri_petaling_shared_stops": shared, "service_day_hour_bins": hours,
                  "no_duplicate_active_terminal_departures": True, "frequency_intervals_nonoverlapping": True})
    return pd.DataFrame(mapping), pd.DataFrame(hourly), pd.DataFrame(summary)
