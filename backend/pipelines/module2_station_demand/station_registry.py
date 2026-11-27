"""
Module 2 Verified Station Registry & Explicit Alias Resolver.
Builds canonical per-service station IDs, physical interchange groupings,
operator/line attribution, and verified coordinates strictly from:
- Module 2 official KTMB & Rapid Rail GTFS feeds (stops/trips/routes)
- Read-only frontend/src/data/stations.json & verified_station_registry.json
Never modifies shared station files, never assigns synthetic KL coordinates
to non-physical codes ('Penalty', 'Unknown'), and never merges distinct services.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import zipfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
DOWNLOADS_DIR = REPO_ROOT / "backend" / "data" / "module2_station_demand" / "downloads"
RAW_BASELINE_DIR = REPO_ROOT / "backend" / "data" / "raw"
FRONTEND_DATA_DIR = REPO_ROOT / "frontend" / "src" / "data"

NON_PHYSICAL_STATION_KEYS = {
    "penalty",
    "unknown",
    "a0",
    "a0: all stations",
    "all stations",
}

# Explicit documented KTMB OD name -> GTFS stop_name aliases
KTMB_OD_TO_GTFS_ALIAS: dict[str, str] = {
    "bandar tasek selatan": "BDR TASEK SELATAN",
    "bandar tasik selatan": "BDR TASEK SELATAN",
    "batu kentonmen": "BATU KENTOMENN",
    "jalan kastam": "JLN KASTAM",
    "kampung dato harun": "KG DATO HARUN",
    "kampung raja uda": "KG RAJA UDA",
    "midvalley": "PERHENTIAN MIDVALLEY",
    "pelabuhan klang selatan": "PEL KLANG SEL",
    "pulau sebang (tampin)": "PULAU SEBANG/TAMPIN",
    "kampung berkam": "KG BERKAM",
    "kampung kok pasir": "KG KOK PASIR",
    "kampung sirian": "KG. SIRIAN",
    "kampung baru bukit abu": "KG BARU BUKIT ABU",
    "layang-layang": "LAYANG LAYANG",
    "tanjong malim": "TANJUNG MALIM",
}

RR_LINE_MAP = {
    "AG": "LRT Ampang",
    "SP": "LRT Sri Petaling",
    "PH": "LRT Sri Petaling",
    "KJ": "LRT Kelana Jaya",
    "KGL": "MRT Kajang",
    "KG": "MRT Kajang",
    "PYL": "MRT Putrajaya",
    "PY": "MRT Putrajaya",
    "MR": "KL Monorail",
    "SA": "LRT Shah Alam",
    "BRT": "BRT Sunway",
}

KTMB_ROUTE_NAME_MAP = {
    "KC05_KB18": "Seremban Line",
    "KA15_KD19": "Port Klang Line",
    "100_47300": "Padang Besar Line",
    "100_9000": "Ipoh Line",
    "SS": "Shuttle Selatan",
    "ETS": "ETS (Padang Besar – JB Sentral)",
    "SH": "East Coast Shuttle (Tumpat – Gemas)",
    "ERT": "Ekspres Rakyat Timuran",
    "ST": "Shuttle Tebrau (JB Sentral – Woodlands CIQ)",
}

KTMB_SERVICE_LABEL = {
    "komuter": "KTM Komuter",
    "komuter_utara": "KTM Komuter Utara",
    "ets": "KTM ETS",
    "intercity": "KTM Intercity",
    "shuttle_tebrau": "Shuttle Tebrau",
}

# Physical interchange groupings (canonical normalized hub slug -> label)
INTERCHANGE_ALIASES: dict[str, str] = {
    "bandar tasek selatan": "Bandar Tasik Selatan Hub",
    "bandar tasik selatan": "Bandar Tasik Selatan Hub",
    "kl sentral": "KL Sentral Hub",
    "kuala lumpur": "Kuala Lumpur Station",
    "sungai buloh": "Sungai Buloh Hub",
    "kampung batu": "Kampung Batu Hub",
    "subang jaya": "Subang Jaya Hub",
    "setia jaya": "Setia Jaya / Sunway Hub",
    "sunway-setia jaya": "Setia Jaya / Sunway Hub",
    "usj 7": "USJ 7 Hub",
    "usj7": "USJ 7 Hub",
    "putra heights": "Putra Heights Hub",
    "masjid jamek": "Masjid Jamek Hub",
    "pasar seni": "Pasar Seni Hub",
    "dang wangi": "Dang Wangi / Bukit Nanas",
    "titiwangsa": "Titiwangsa Hub",
    "hang tuah": "Hang Tuah Hub",
    "chan sow lin": "Chan Sow Lin Hub",
    "maluri": "Maluri Hub",
    "sungai besi": "Sungai Besi Hub",
    "ampang park": "Ampang Park Hub",
    "tun razak exchange": "Tun Razak Exchange (TRX) Hub",
    "kwasa damansara": "Kwasa Damansara Hub",
    "abdullah hukum": "Abdullah Hukum Hub",
    "muzium negara": "KL Sentral / Muzium Negara Link",
    "kajang": "Kajang Hub",
    "putrajaya sentral": "Putrajaya Sentral Hub",
    "bandar utama": "Bandar Utama Hub",
    "glenmarie 2": "Glenmarie Hub",
    "cgc glenmarie": "Glenmarie Hub",
    "butterworth": "Butterworth Terminal",
    "jb sentral": "JB Sentral Hub",
    "gemas": "Gemas Junction",
    "padang besar": "Padang Besar Terminal",
}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")


def normalize_rr_code(code: str) -> str:
    """Normalize SA01 -> SA1, MR01 -> MR1, PYL03 -> PY03 for GTFS lookup."""
    c = code.strip().upper()
    m = re.match(r"^([A-Z]+)0*([0-9]+)$", c)
    if not m:
        return c
    pfx, num = m.group(1), int(m.group(2))
    if pfx == "PYL":
        pfx = "PY"
    return f"{pfx}{num}"


def normalize_ktmb_name(raw_name: str) -> str:
    s = raw_name.strip().lower()
    s = KTMB_OD_TO_GTFS_ALIAS.get(s, raw_name.strip()).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s/.-]", " ", s)).strip()


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return round(2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 1)


def load_station_lookup() -> dict[str, Any]:
    """Load read-only official GTFS & curated static station references."""
    with open(FRONTEND_DATA_DIR / "stations.json", "r", encoding="utf-8") as f:
        stations_json = json.load(f)["stations"]

    # Prefer freshly downloaded GTFS in downloads/, fallback to raw/
    ktmb_zip = DOWNLOADS_DIR / "ktmb_gtfs.zip"
    if not ktmb_zip.exists():
        ktmb_zip = RAW_BASELINE_DIR / "ktmb-gtfs.zip"
    rr_zip = DOWNLOADS_DIR / "rapidrail_gtfs.zip"
    if not rr_zip.exists():
        rr_zip = RAW_BASELINE_DIR / "rapid-rail-gtfs.zip"

    # 1. Rapid Rail GTFS stops
    rr_by_norm_code: dict[str, dict] = {}
    rr_by_exact_code: dict[str, dict] = {}
    with zipfile.ZipFile(rr_zip) as z:
        rr_stops = list(csv.DictReader(io.StringIO(z.read("stops.txt").decode("utf-8-sig"))))
        for row in rr_stops:
            sid = row["stop_id"].strip().upper()
            lat = float(row["stop_lat"])
            lon = float(row["stop_lon"])
            info = {
                "gtfs_stop_id": sid,
                "gtfs_stop_name": row["stop_name"].strip(),
                "route_id": row["route_id"].strip(),
                "category": row.get("category", "").strip(),
                "lat": lat,
                "lng": lon,
            }
            rr_by_exact_code[sid] = info
            rr_by_norm_code[normalize_rr_code(sid)] = info
            if sid.startswith("PY") and not sid.startswith("PYL"):
                # PYL03 -> PY3 ; PY03 -> PY3
                rr_by_norm_code[f"PY{int(sid[2:])}" if sid[2:].isdigit() else sid] = info
            if sid.startswith("SP"):
                # Note AG shared corridor AG01..AG11 vs SP stops
                rr_by_norm_code[normalize_rr_code(sid)] = info

    # 2. KTMB GTFS stops + route memberships via stop_times -> trips -> routes
    ktmb_by_norm_name: dict[str, dict] = {}
    ktmb_gtfs_list: list[dict] = []
    with zipfile.ZipFile(ktmb_zip) as z:
        k_stops = list(csv.DictReader(io.StringIO(z.read("stops.txt").decode("utf-8-sig"))))
        k_trips = {
            t["trip_id"]: t["route_id"]
            for t in csv.DictReader(io.StringIO(z.read("trips.txt").decode("utf-8-sig")))
        }
        stop_routes: dict[str, set[str]] = {}
        for st_row in csv.DictReader(io.StringIO(z.read("stop_times.txt").decode("utf-8-sig"))):
            rid = k_trips.get(st_row["trip_id"])
            if rid:
                stop_routes.setdefault(st_row["stop_id"].strip(), set()).add(rid)

        for row in k_stops:
            sid = row["stop_id"].strip()
            sname = row["stop_name"].strip()
            rids = sorted(stop_routes.get(sid, set()))
            info = {
                "gtfs_stop_id": sid,
                "gtfs_stop_name": sname,
                "route_ids": rids,
                "line_names": [KTMB_ROUTE_NAME_MAP.get(r, r) for r in rids],
                "lat": float(row["stop_lat"]),
                "lng": float(row["stop_lon"]),
            }
            ktmb_gtfs_list.append(info)
            ktmb_by_norm_name[re.sub(r"\s+", " ", sname.lower()).strip()] = info

    # 3. Clean physical entries from stations.json (STRICTLY EXCLUDING synthetic Penalty/Unknown)
    static_rr_by_code: dict[str, dict] = {}
    static_ktmb_by_name: dict[str, dict] = {}
    for st in stations_json:
        name = str(st.get("name", "")).strip()
        code = str(st.get("code", "")).strip()
        if name.lower() in NON_PHYSICAL_STATION_KEYS or code.lower() in NON_PHYSICAL_STATION_KEYS:
            continue
        lat = st.get("lat")
        lng = st.get("lng")
        if lat is None or lng is None:
            continue
        if st.get("source") == "rapidrail":
            static_rr_by_code[code.upper()] = st
        else:
            static_ktmb_by_name[name.lower()] = st

    return {
        "rr_by_exact_code": rr_by_exact_code,
        "rr_by_norm_code": rr_by_norm_code,
        "static_rr_by_code": static_rr_by_code,
        "ktmb_by_norm_name": ktmb_by_norm_name,
        "ktmb_gtfs_list": ktmb_gtfs_list,
        "static_ktmb_by_name": static_ktmb_by_name,
    }


def resolve_interchange(clean_name: str, fallback_slug: str) -> tuple[str, str]:
    key = clean_name.strip().lower()
    if key in INTERCHANGE_ALIASES:
        return f"ichg:{slugify(INTERCHANGE_ALIASES[key])}", INTERCHANGE_ALIASES[key]
    return f"ichg:{fallback_slug}", clean_name


def resolve_rapidrail_station(raw_origin: str, lookup: dict[str, Any]) -> dict[str, Any]:
    raw = raw_origin.strip()
    if raw.lower() in NON_PHYSICAL_STATION_KEYS or raw.upper().startswith("A0:"):
        return {
            "canonical_station_id": "rr:A0",
            "gtfs_stop_id": None,
            "station_name": raw,
            "raw_station_string": raw,
            "operator": "Prasarana (Rapid KL)",
            "service_type": "rapid_rail",
            "service_label": "Rapid Rail (LRT/MRT/Monorail)",
            "line_attribution": "Aggregate Subtotal (Excluded)",
            "physical_interchange_id": None,
            "physical_interchange_name": None,
            "lat": None,
            "lng": None,
            "coordinate_verified": False,
            "is_physical_station": False,
            "resolution_source": "excluded_aggregate",
        }

    if ": " in raw:
        code, clean_name = raw.split(": ", 1)
    else:
        code, clean_name = raw, raw
    code = code.strip().upper()
    clean_name = clean_name.strip()
    prefix = "".join(ch for ch in code if ch.isalpha())
    line_name = RR_LINE_MAP.get(prefix, "Rapid Rail")

    norm_code = normalize_rr_code(code)
    gtfs_hit = lookup["rr_by_exact_code"].get(code) or lookup["rr_by_norm_code"].get(norm_code)
    # Handle SP12..SP15 or shared AG/SP where GTFS might code differently
    static_hit = lookup["static_rr_by_code"].get(code)

    lat = None
    lng = None
    gtfs_id = None
    coord_verified = False
    res_src = "unverified"

    if gtfs_hit:
        lat = round(float(gtfs_hit["lat"]), 6)
        lng = round(float(gtfs_hit["lng"]), 6)
        gtfs_id = gtfs_hit["gtfs_stop_id"]
        coord_verified = True
        res_src = "rapidrail_gtfs"
    elif static_hit:
        lat = round(float(static_hit["lat"]), 6)
        lng = round(float(static_hit["lng"]), 6)
        coord_verified = True
        res_src = "stations_json_verified"

    ichg_id, ichg_name = resolve_interchange(clean_name, slugify(clean_name))
    return {
        "canonical_station_id": f"rr:{code}",
        "gtfs_stop_id": gtfs_id,
        "station_code": code,
        "station_name": clean_name,
        "raw_station_string": raw,
        "operator": "Prasarana (Rapid KL)",
        "service_type": "rapid_rail",
        "service_label": "Rapid Rail (LRT/MRT/Monorail)",
        "line_attribution": line_name,
        "physical_interchange_id": ichg_id,
        "physical_interchange_name": ichg_name,
        "lat": lat,
        "lng": lng,
        "coordinate_verified": coord_verified,
        "is_physical_station": True,
        "resolution_source": res_src,
    }


def resolve_ktmb_station(raw_name: str, service_type: str, lookup: dict[str, Any]) -> dict[str, Any]:
    name = raw_name.strip()
    low = name.lower()
    if not name or low in NON_PHYSICAL_STATION_KEYS:
        return {
            "canonical_station_id": f"ktmb:{service_type}:{slugify(name or 'unknown')}",
            "gtfs_stop_id": None,
            "station_code": None,
            "station_name": name or "Unknown",
            "raw_station_string": raw_name,
            "operator": "KTMB",
            "service_type": service_type,
            "service_label": KTMB_SERVICE_LABEL.get(service_type, service_type),
            "line_attribution": "Non-Physical / Administrative Transaction Code",
            "physical_interchange_id": None,
            "physical_interchange_name": None,
            "lat": None,
            "lng": None,
            "coordinate_verified": False,
            "is_physical_station": False,
            "resolution_source": "non_physical_transaction_category",
        }

    norm_gtfs_key = normalize_ktmb_name(name)
    gtfs_hit = lookup["ktmb_by_norm_name"].get(low) or lookup["ktmb_by_norm_name"].get(norm_gtfs_key)
    static_hit = lookup["static_ktmb_by_name"].get(low)

    lat = None
    lng = None
    gtfs_id = None
    coord_verified = False
    line_names: list[str] = []
    res_src = "unresolved"

    if gtfs_hit:
        lat = round(float(gtfs_hit["lat"]), 6)
        lng = round(float(gtfs_hit["lng"]), 6)
        gtfs_id = gtfs_hit["gtfs_stop_id"]
        line_names = gtfs_hit["line_names"]
        coord_verified = True
        res_src = "ktmb_gtfs_exact_or_alias"
    elif static_hit:
        lat = round(float(static_hit["lat"]), 6)
        lng = round(float(static_hit["lng"]), 6)
        coord_verified = True
        res_src = "stations_json_verified"

    # Determine appropriate service-scoped line attribution
    if service_type == "komuter":
        relevant = [ln for ln in line_names if ln in ("Seremban Line", "Port Klang Line")]
        line_attr = " & ".join(relevant) if relevant else "KTM Komuter (Central)"
    elif service_type == "komuter_utara":
        relevant = [ln for ln in line_names if ln in ("Padang Besar Line", "Ipoh Line")]
        line_attr = " & ".join(relevant) if relevant else "KTM Komuter Utara"
    elif service_type == "ets":
        line_attr = "ETS (Padang Besar – JB Sentral)"
    elif service_type == "shuttle_tebrau":
        line_attr = "Shuttle Tebrau (JB Sentral – Woodlands CIQ)"
    else:
        relevant = [ln for ln in line_names if "Shuttle" in ln or "Timuran" in ln]
        line_attr = " & ".join(relevant) if relevant else "KTM Intercity"

    ichg_id, ichg_name = resolve_interchange(name, slugify(name))
    return {
        "canonical_station_id": f"ktmb:{service_type}:{slugify(name)}",
        "gtfs_stop_id": gtfs_id,
        "station_code": gtfs_id or slugify(name).upper()[:12],
        "station_name": name,
        "raw_station_string": raw_name,
        "operator": "KTMB",
        "service_type": service_type,
        "service_label": KTMB_SERVICE_LABEL.get(service_type, service_type),
        "line_attribution": line_attr,
        "physical_interchange_id": ichg_id,
        "physical_interchange_name": ichg_name,
        "lat": lat,
        "lng": lng,
        "coordinate_verified": coord_verified,
        "is_physical_station": True,
        "resolution_source": res_src,
    }
