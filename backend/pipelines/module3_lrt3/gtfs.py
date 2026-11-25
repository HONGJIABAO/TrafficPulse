"""Inspect the local Rapid Rail feed and identify the Shah Alam schedule tables."""

from pathlib import PurePosixPath
from zipfile import ZipFile

import pandas as pd


TABLES = [
    "agency", "routes", "stops", "trips", "stop_times", "calendar", "calendar_dates",
    "frequencies", "shapes",
]


def inspect_gtfs(raw, od_stations):
    feeds = []
    for path in sorted(raw.rglob("*.zip")):
        with ZipFile(path) as archive:
            members = {
                PurePosixPath(name).name: name for name in archive.namelist()
                if not name.startswith("__MACOSX/") and not PurePosixPath(name).name.startswith("._")
            }
            if "routes.txt" not in members:
                continue
            with archive.open(members["routes.txt"]) as handle:
                routes = pd.read_csv(handle, dtype="string", encoding="utf-8-sig")
            if routes["route_id"].eq("SA").any():
                feeds.append((path, members, routes))
    if len(feeds) != 1:
        raise ValueError(f"Expected one GTFS ZIP with route SA, found {len(feeds)}")
    path, members, routes = feeds[0]
    with ZipFile(path) as archive:
        files = archive.namelist()
        tables = {}
        for table in TABLES:
            member = members.get(f"{table}.txt")
            if member:
                with archive.open(member) as handle:
                    tables[table] = pd.read_csv(handle, dtype="string", encoding="utf-8-sig")

    trips = tables["trips"].loc[tables["trips"]["route_id"].eq("SA")]
    trip_ids = set(trips["trip_id"])
    service_ids = sorted(trips["service_id"].unique())
    stop_times = tables["stop_times"].loc[tables["stop_times"]["trip_id"].isin(trip_ids)]
    stop_ids = sorted(stop_times["stop_id"].unique())
    stops = tables["stops"].loc[tables["stops"]["stop_id"].isin(stop_ids)]
    stops = stops.assign(station_code=stops["stop_id"].str.replace(r"^SA(\d)$", r"SA0\1", regex=True))
    crosswalk = pd.DataFrame(od_stations).merge(stops[["station_code", "stop_id", "stop_name"]],
                                               how="outer", on="station_code")
    label_differences = crosswalk.loc[
        crosswalk["station_name"].str.casefold().ne(crosswalk["stop_name"].str.casefold()).fillna(False)
    ]

    def linked(table, column, values):
        return tables[table].loc[tables[table][column].isin(values)] if table in tables else None

    def records(frame):
        return frame.to_dict("records") if frame is not None else None

    frequencies = linked("frequencies", "trip_id", trip_ids)
    calendar = linked("calendar", "service_id", service_ids)
    exceptions = linked("calendar_dates", "service_id", service_ids)
    report = {
        "file": path.relative_to(raw).as_posix(),
        "zip_members": files,
        "tables": {
            table: {"present": table in tables, "rows": len(tables[table]) if table in tables else None,
                    "columns": list(tables[table]) if table in tables else None}
            for table in TABLES
        },
        "routes": routes.to_dict("records"),
        "shah_alam": {
            "route": routes.loc[routes["route_id"].eq("SA")].to_dict("records"),
            "stops": stops[["stop_id", "stop_name", "stop_lat", "stop_lon"]].to_dict("records"),
            "trips": trips.to_dict("records"),
            "stop_times_rows": len(stop_times),
            "stop_times_rows_by_trip": stop_times.groupby("trip_id").size().to_dict(),
            "calendar": records(calendar), "calendar_dates": records(exceptions),
            "frequency_rows": len(frequencies) if frequencies is not None else None,
            "directions": sorted(trips["direction_id"].unique()),
            "service_ids": service_ids,
            "od_station_codes_absent_in_gtfs": crosswalk.loc[
                crosswalk["stop_id"].isna(), "station_code"
            ].tolist(),
            "gtfs_station_codes_absent_in_od": crosswalk.loc[
                crosswalk["station_name"].isna(), "station_code"
            ].tolist(),
            "station_name_differences": label_differences.to_dict("records"),
        },
    }
    return report
