"""Join the Rapid Rail feed to PLANMalaysia administrative districts."""

import csv
import io
import math
import re
from collections import Counter, defaultdict
from zipfile import ZipFile


SCOPE_SOURCE = "https://myplan.planmalaysia.gov.my/admin/uploads_publication/rancangan-fizikal-negara-keempat-rfn4-glosari-my-24112021.pdf"
TRANSIT_MAP = "https://www.ciast.gov.my/wp-content/uploads/2026/RII/MITCP/QUICK%20INFO%20TCTP%202026.pdf#page=27"
SHAH_ALAM_SOURCE = "https://www.prasarana.com.my/wp-content/uploads/2025/07/Prasarana-Sustainability-Blueprint.pdf"
SHAH_ALAM_CONNECTIONS = "https://iar.mrcb.com.my/downloads/LRT_SHAH_ALAM_LINE.pdf"
RAIL_OPERATOR = "https://www.prasarana.com.my/rapid-rail/"

# Whole administrative units referenced by the National Conurbation glossary.
DISTRICTS = {
    "1001": ("Selangor", "Klang"),
    "1002": ("Selangor", "Kuala Langat"),
    "1006": ("Selangor", "Hulu Langat"),
    "1008": ("Selangor", "Petaling"),
    "1009": ("Selangor", "Gombak"),
    "1010": ("Selangor", "Sepang"),
    "1400": ("W.P. Kuala Lumpur", "Kuala Lumpur"),
    "1601": ("W.P. Putrajaya", "Putrajaya"),
}

# Rapid KL map interchange symbols and shared passenger facilities. These are
# station IDs, with no automatic merge based on station names or proximity.
INTERCHANGES = {
    "chan_sow_lin": ("AG11", "SP11", "PY24"),
    "hang_tuah": ("AG9", "SP9", "MR4"),
    "maluri": ("AG13", "KG22"),
    "masjid_jamek": ("AG7", "SP7", "KJ13"),
    "pasar_seni": ("KJ14", "KG16"),
    "plaza_rakyat_merdeka": ("AG8", "SP8", "KG17"),
    "putra_heights": ("KJ37", "SP31"),
    "sungai_besi": ("SP16", "PY29"),
    "titiwangsa": ("AG3", "SP3", "MR11", "PY17"),
    "tun_razak_exchange": ("KG20", "PY23"),
    "kwasa_damansara": ("KG04", "PY01"),
}
# Retain separate station structures linked by a public transfer. Record the
# connection explicitly because the areas function as common transfer nodes.
CONNECTING = {
    "ampang_park": ("KJ9", "PY20"),
    "bukit_bintang": ("KG18A", "MR6"),
    "kl_sentral_muzium_negara": ("KJ15", "KG15", "MR1"),
    "bukit_nanas_dang_wangi": ("MR8", "KJ12"),
    "bandar_utama": ("SA1", "KG09"),
    "glenmarie": ("SA7", "KJ27"),
}
MODE = {"LRT": "LRT", "MRT": "MRT", "MRL": "Monorail"}
NEAR_BOUNDARY_METRES = 100


def district_key(state, district):
    """Apply explicit aliases across the DOSM and PLANMalaysia sources."""
    state = state.strip().casefold()
    district = district.strip().casefold()
    aliases = {
        "ulu langat": "hulu langat",
        "ulu selangor": "hulu selangor",
        "w.p. kuala lumpur": "kuala lumpur",
        "w.p. putrajaya": "putrajaya",
    }
    return state, aliases.get(district, district)


def polygon_rings(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError(f"Unsupported district geometry {geometry['type']}")


def ring_relation(x, y, ring):
    """Return inside (1), on edge (0), or outside (-1) by ray casting."""
    inside = False
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        if min(ax, bx) - 1e-10 <= x <= max(ax, bx) + 1e-10 and min(ay, by) - 1e-10 <= y <= max(ay, by) + 1e-10:
            cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
            if abs(cross) <= 1e-10 * math.hypot(bx - ax, by - ay):
                return 0
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            inside = not inside
    return 1 if inside else -1


def polygon_relation(x, y, polygon):
    exterior = ring_relation(x, y, polygon[0])
    if exterior != 1:
        return exterior
    for hole in polygon[1:]:
        relation = ring_relation(x, y, hole)
        if relation >= 0:
            return -relation
    return 1


def local_edge_distance(x, y, ring):
    """Approximate nearest ring distance in metres for coordinate QA only."""
    lon_metres = 111_320 * math.cos(math.radians(y))
    lat_metres = 110_574
    nearest = float("inf")
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        # Ignore segments outside the current search square.
        dx = nearest / lon_metres
        dy = nearest / lat_metres
        if x < min(ax, bx) - dx or x > max(ax, bx) + dx or y < min(ay, by) - dy or y > max(ay, by) + dy:
            continue
        ux = (ax - x) * lon_metres
        uy = (ay - y) * lat_metres
        vx = (bx - ax) * lon_metres
        vy = (by - ay) * lat_metres
        length_squared = vx * vx + vy * vy
        t = min(1, max(0, -(ux * vx + uy * vy) / length_squared)) if length_squared else 0
        nearest = min(nearest, math.hypot(ux + t * vx, uy + t * vy))
    return nearest


def index_boundaries(collection, provenance):
    if collection["type"] != "FeatureCollection" or len(collection["features"]) != provenance["feature_count"]:
        raise ValueError("Incomplete PLANMalaysia FeatureCollection")
    if provenance["output_crs"] != "EPSG:4326":
        raise ValueError("Expected EPSG:4326 district polygons")
    districts = {}
    scoped_features = []
    for feature in collection["features"]:
        properties = feature["properties"]
        district_id = properties["kod_daerah"]
        if district_id in districts:
            raise ValueError(f"Repeated boundary ID {district_id}")
        polygons = []
        for polygon in polygon_rings(feature["geometry"]):
            for ring in polygon:
                if len(ring) < 4 or ring[0] != ring[-1] or any(
                    not (100 < x < 104 and 1 < y < 5) for x, y in ring
                ):
                    raise ValueError(f"Invalid ring for {district_id}")
            xs, ys = zip(*polygon[0])
            polygons.append((min(xs), min(ys), max(xs), max(ys), polygon))
        districts[district_id] = polygons
        if district_id in DISTRICTS:
            state, district = DISTRICTS[district_id]
            if district_key(state, district) != district_key(properties["negeri"], properties["daerah"]):
                raise ValueError(f"Boundary and comparison scope disagree for {district_id}")
            scoped_features.append({**feature, "properties": {**properties, "district_id": district_id,
                                                               "state": state, "district": district}})
    if len(scoped_features) != len(DISTRICTS):
        raise ValueError("Boundary file is missing comparison districts")
    return districts, {"type": "FeatureCollection", "features": scoped_features}


def locate_station(x, y, districts):
    inside, touches = [], []
    for district_id, polygons in districts.items():
        for xmin, ymin, xmax, ymax, polygon in polygons:
            if not (xmin <= x <= xmax and ymin <= y <= ymax):
                continue
            relation = polygon_relation(x, y, polygon)
            if relation == 1:
                inside.append(district_id)
            elif relation == 0:
                touches.append(district_id)
    if len(inside) != 1 or touches:
        status = "ambiguous_polygon_match" if inside or touches else "outside_boundary_snapshot"
        return None, status, "|".join(sorted(set(inside + touches))), None

    district = inside[0]
    distance = min(local_edge_distance(x, y, ring) for *_, polygon in districts[district] for ring in polygon)
    status = "mapped" if district in DISTRICTS else "mapped_outside_comparison_scope"
    return district, status, district, round(distance, 1)


def station_membership(gtfs, service_rows):
    with ZipFile(gtfs) as archive:
        def read_table(name):
            with archive.open(name + ".txt") as source:
                return list(csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig"), strict=True))

        routes = {row["route_id"]: row for row in read_table("routes")}
        stops = {row["stop_id"]: row for row in read_table("stops")}
        trips = {row["trip_id"]: row["route_id"] for row in read_table("trips")}
        membership = defaultdict(set)
        for row in read_table("stop_times"):
            membership[row["stop_id"]].add(trips[row["trip_id"]])
    expected = {row["route_id"] for row in service_rows if row["is_rail"] == "True"}
    if expected != {route_id for route_id, row in routes.items() if row["category"] in MODE}:
        raise ValueError("GTFS rail routes disagree with the validated Step 3 route mapping")
    return stops, routes, membership, expected


def map_stations(gtfs, service_rows, collection, provenance, memory_guard):
    polygons, scoped_boundaries = index_boundaries(collection, provenance)
    stops, routes, membership, expected = station_membership(gtfs, service_rows)
    groups = {stop: group for group, ids in INTERCHANGES.items() for stop in ids}
    links = {stop: group for group, ids in CONNECTING.items() for stop in ids}
    if not (groups.keys() | links.keys()) <= stops.keys() or groups.keys() & links.keys():
        raise ValueError("Review the documented interchange register against this GTFS snapshot")

    rows = []
    for stop_id, route_ids in sorted(membership.items()):
        rail_routes = sorted(route_ids & expected)
        if not rail_routes:
            continue
        memory_guard()
        stop = stops[stop_id]
        lon, lat = float(stop["stop_lon"]), float(stop["stop_lat"])
        if not (100 < lon < 104 and 1 < lat < 5):
            raise ValueError(f"Unexpected WGS84 coordinates for {stop_id}")
        district, status, candidates, distance = locate_station(lon, lat, polygons)
        state, name = DISTRICTS.get(district, (None, None))
        group = groups.get(stop_id)
        route = rail_routes[0]
        lrt3 = f"SA{int(stop_id[2:]):02d}" if "SA" in rail_routes else None
        if group:
            physical_id, evidence = group, "documented_integrated_interchange"
        elif re.fullmatch(r"(?:AG|SP)(?:[1-9]|10|11)", stop_id):
            other = ("SP" if route == "AG" else "AG") + stop_id[2:]
            if (stop["stop_lat"], stop["stop_lon"], stop["stop_name"]) != (
                stops[other]["stop_lat"], stops[other]["stop_lon"], stops[other]["stop_name"]
            ):
                raise ValueError(f"Shared trunk stop evidence disagrees at {stop_id}")
            physical_id, evidence = "shared_AG_SP_" + stop_id[2:], "validated_shared_trunk_stop"
        else:
            physical_id, evidence = "stop_" + stop_id, "distinct_gtfs_stop"

        rows.append({"gtfs_stop_id": stop_id, "station_name": stop["stop_name"].strip(),
                     "physical_station_id": physical_id, "route_ids": "|".join(rail_routes),
                     "modes": "|".join(sorted({MODE[routes[r]["category"]] for r in rail_routes})),
                     "lrt3_station_code": lrt3, "longitude": lon, "latitude": lat,
                     "district_id": district, "state": state, "district": name,
                     "mapping_status": status, "candidate_district_ids": candidates or None,
                     "district_edge_distance_m_approx": distance,
                     "within_100m_of_district_edge": distance <= NEAR_BOUNDARY_METRES if distance is not None else None,
                     "mapping_evidence": "GTFS WGS84 point in PLANMalaysia administrative polygon" if district else None,
                     "station_identity_evidence": evidence, "connecting_station_group": links.get(stop_id),
                     "station_identity_source": TRANSIT_MAP if group or stop_id in links else gtfs.name,
                     "coordinate_source": gtfs.name, "boundary_source": provenance["layer_url"],
                     "in_comparison_scope": district in DISTRICTS if district else None})

    if len({row["lrt3_station_code"] for row in rows if row["lrt3_station_code"]}) != 20:
        raise ValueError("Expected 20 distinct Shah Alam line station codes")
    station_districts = defaultdict(set)
    for row in rows:
        station_districts[row["physical_station_id"]].add(row["district_id"])
    for row in rows:
        if len(station_districts[row["physical_station_id"]]) > 1:
            row["physical_station_mapping_status"] = "unresolved_interchange_district"
        else:
            row["physical_station_mapping_status"] = row["mapping_status"]
    audit = {
        "feed_rail_stop_records": len(rows), "unique_physical_station_ids": len(station_districts),
        "mapped_stop_records": dict(Counter(row["mapping_status"] for row in rows)),
        "route_stop_counts": dict(Counter(route for row in rows for route in row["route_ids"].split("|"))),
        "lrt3_station_codes": sorted(row["lrt3_station_code"] for row in rows if row["lrt3_station_code"]),
        "edge_review_threshold_metres": NEAR_BOUNDARY_METRES,
        "within_edge_threshold": [row["gtfs_stop_id"] for row in rows if row["within_100m_of_district_edge"]],
        "integrated_interchanges": INTERCHANGES, "separate_connected_stations": CONNECTING,
        "station_identity_sources": [TRANSIT_MAP, SHAH_ALAM_SOURCE, SHAH_ALAM_CONNECTIONS],
        "excluded_non_rail_stops": len(membership) - len(rows),
    }
    return rows, scoped_boundaries, audit
