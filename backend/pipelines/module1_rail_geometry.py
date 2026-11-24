"""Cache official Rapid Rail GTFS geometry for the Overview map (stdlib only).

Usage: python backend/pipelines/module1_rail_geometry.py [--refresh]
The browser uses the small, versioned GeoJSON snapshot; it never downloads or
parses the ZIP, and a temporary API outage does not remove the rail network.
"""
import argparse
import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
API_URL = "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl"
CACHE = ROOT / "backend/data/raw/rapid-rail-gtfs.zip"
OUTPUT = ROOT / "frontend/src/data/rapid_rail_geometry.json"
ROUTES = {
    "AG": "LRT Ampang", "PH": "LRT Sri Petaling", "KJ": "LRT Kelana Jaya",
    "KGL": "MRT Kajang", "PYL": "MRT Putrajaya", "MR": "KL Monorail",
    "SA": "LRT Shah Alam",
}


def station_code(value):
    # GTFS uses AG1 / MR1 / PY01; ridership uses AG01 / MR01 / PYL01.
    match = re.fullmatch(r"([A-Z]+)(\d+)", value)
    if not match:
        return value
    prefix, number = match.groups()
    return f"{'PYL' if prefix == 'PY' else prefix}{int(number):02d}"


def convert(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        def rows(name):
            return list(csv.DictReader(io.StringIO(archive.read(name).decode("utf-8-sig"))))
        routes, trips, shapes, stops = (rows(n + ".txt") for n in ("routes", "trips", "shapes", "stops"))
    grouped = {}
    for point in shapes:
        grouped.setdefault(point["shape_id"], []).append(point)
    features = []
    for route in routes:
        route_id = route["route_id"]
        if route_id not in ROUTES:
            continue  # BRT is not rail.
        shape_ids = sorted({t["shape_id"] for t in trips if t["route_id"] == route_id and t["direction_id"] == "0"})
        for shape_id in shape_ids:
            points = sorted(grouped[shape_id], key=lambda p: int(p["shape_pt_sequence"]))
            coords = [[float(p["shape_pt_lon"]), float(p["shape_pt_lat"])] for p in points]
            if len(coords) < 2 or not all(99 < x < 120 and 0.8 < y < 8 for x, y in coords):
                raise ValueError(f"Invalid Malaysian rail shape: {shape_id}")
            features.append({"type": "Feature", "properties": {
                "id": shape_id, "name": ROUTES[route_id], "category": "Rapid Rail",
                "color": "#" + route["route_color"], "geometrySource": "Official GTFS",
            }, "geometry": {"type": "LineString", "coordinates": coords}})
    if {f["properties"]["name"] for f in features} != set(ROUTES.values()):
        raise ValueError("The feed is missing expected rail routes; preserving the previous snapshot.")
    coordinates = {station_code(s["stop_id"]): [float(s["stop_lon"]), float(s["stop_lat"])]
                   for s in stops if s["category"] != "BRT"}
    return {"type": "FeatureCollection", "source": API_URL,
            "license": "CC BY 4.0 — Prasarana / data.gov.my",
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "note": "Current route geometry; not a historical service or operating-status record.",
            "features": features, "station_coordinates": coordinates}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if args.refresh or not CACHE.exists():
        request = urllib.request.Request(API_URL, headers={"User-Agent": "TransitPulse/1.0"})
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = response.read()
        output = convert(payload)  # Validate before replacing the previous files.
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_bytes(payload)
    else:
        output = convert(CACHE.read_bytes())
    OUTPUT.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(output['features'])} official rail shapes and {len(output['station_coordinates'])} station positions to {OUTPUT}")


if __name__ == "__main__":
    main()
