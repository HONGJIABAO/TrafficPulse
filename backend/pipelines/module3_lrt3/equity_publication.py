"""Regenerate the V1 equity publication data without the historical spatial join."""

import csv
from datetime import date

import pyarrow.parquet as pq

from equity_analysis import POLICY, compute_activity, compute_coverage, compute_screen, compute_socioeconomic
from equity_geography import DISTRICTS, NEAR_BOUNDARY_METRES, map_stations
from equity_reporting import LIMITATIONS
from network_equity import crosswalk, district_activity, equity_comparison, reconcile
from network_reporting import SOURCE_LIMITS
from run_equity import OUTPUT, RAW, ROOT, check_memory, load, sha


PUBLICATION_REVISION = "module3-v1-equity-osm.1"
DISPLAY_REVISION = "module3-v1-geography-osm.1"
DISPLAY_GEOGRAPHY_NAME = "district-geography.json"
OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright"
ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/"
GTFS_CATALOGUE = "https://developer.data.gov.my/realtime-api/gtfs-static.en"
OD_CATALOGUE = "https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily"
HISTORICAL_LAYER = "https://gisdev.planmalaysia.gov.my/server/rest/services/Hosted/Data_Sempadan_Daerah/FeatureServer/0"
SCOPE_SOURCE = "https://myplan.planmalaysia.gov.my/admin/uploads_publication/rancangan-fizikal-negara-keempat-rfn4-glosari-my-24112021.pdf"
SCOPE_DEFINITION = (
    "Eight whole administrative units used as a district proxy for districts referenced in the "
    "PLANMalaysia National Conurbation glossary. The planning extent encompasses parts of Selangor; "
    "whole districts enable consistent joins and denominators."
)
PUBLICATION_NOTE = (
    "The historical Step 4 and 4B research used PLANMalaysia polygons. This publication independently "
    "assigns the GTFS points using the pinned OpenStreetMap polygons, then recomputes district activity, "
    "coverage and screening. Counts and classes agree with the archived results. Distance diagnostics "
    "are approximate and refer to the OpenStreetMap edges."
)
POINT_METHOD = "One unambiguous polygon interior contains the GTFS point; touching or overlapping matches are unresolved."
DEDUPLICATION = (
    "Shared trunk records and documented integrated interchange facilities are grouped. "
    "Separate structures connected by public walks retain separate station IDs."
)
SCREENING_METHOD = (
    "Use the latest common survey year for all eight units and repeat for the newest locally available "
    "survey cohort. Linear unweighted district quantiles use inclusive comparisons. A priority requires "
    "low station density and the specified either/both household vulnerability condition. "
    "Observed LRT3 activity is contextual evidence only."
)
OD_AGGREGATION = (
    "Select a single destination A0 for each published origin and day when its unique present detail "
    "records cover its entire published destination roster and sum exactly to that subtotal. A0 origin "
    "records serve as a separate incoming check; neither type of aggregate is added to detail records."
)
DISPLAY_PATH = ROOT / "frontend/src/modules/module3_drivers_forecast/data" / DISPLAY_GEOGRAPHY_NAME
GTFS_PATH = RAW / "gtfs_rapid_rail_kl (1).zip"
SCAN_PATH = OUTPUT / "network_activity_checkpoints/01_od_scan_20261124_190919_504859"
EQUITY_INPUTS = {
    DISPLAY_PATH: "62a3a95f15579ee3393289b7a7e134477f8af54a257425ffe23e0d561b424810",
    GTFS_PATH: "45c134f991b955eff801d35a45d9bdbeca83ae780bfc29dcac142665146c4533",
    RAW / "hh_income_district.parquet": "f43ee8dcf7ae13343483bb19abcdf63e4517126b2b149ea3456670ac75673104",
    RAW / "hh_poverty_district.parquet": "9e9269ad507395eb2bb0be58855641b45ca106fb5ae2dab91fc258a598f42e4e",
    RAW / "population_district.parquet": "456bca234306c740c523753c62630d409c8713c82cd94b596074a7ca3a024742",
    OUTPUT / "capacity_metadata.json": "3900acab916eaabca71871dd6d84c9f0b83698a9823a9d0b951201e7ad963e8f",
    OUTPUT / "gtfs_service_mapping.csv": "be2fd8c00e7b802bf3ed0d60bcab2114fc779f78e9349a7dc846a50455727919",
    OUTPUT / "lrt3_station_daily.parquet": "afce28f336d3f4ea1bbdd7c3c6f04e28f815e93b4e0ae1d41f5d962d221cc9d2",
    OUTPUT / "lrt3_daily.parquet": "c6db23d835dca8e163bafa68cb60fe2dc41f5d0a42023ab3f67216fc1ddf4221",
    SCAN_PATH / "checkpoint.json": "1966aa6438a7ed109a1fa1eb840f8c0fac965dfe9fe4fe60e603e016ebd7afbc",
    SCAN_PATH / "scan_audit.json": "19a8cd937b166cb14dda9b75214b4d7cd2cf4ca94f972852e33cb0af85d4e490",
    SCAN_PATH / "origin_audit.parquet": "7d1a4977a178fec4c2ccfff14e4d4a55546ffd3dd97ebeaca268aa839dcbee5e",
}
STATION_FIELDS = (
    "gtfs_stop_id", "station_name", "physical_station_id", "route_ids", "modes", "lrt3_station_code",
    "longitude", "latitude", "district_id", "mapping_status", "district_edge_distance_m_approx",
    "within_100m_of_district_edge", "station_identity_evidence", "connecting_station_group",
)


def publication_sources():
    return [
        {"label": "OpenStreetMap contributors", "url": OSM_ATTRIBUTION_URL, "license": "ODbL-1.0",
         "licenseUrl": ODBL_URL, "role": "District polygons, regenerated spatial assignment and edge diagnostics"},
        {"label": "Prasarana Malaysia / Malaysia's Official Open API", "url": GTFS_CATALOGUE, "license": "CC-BY-4.0",
         "licenseUrl": CC_BY_URL, "role": "Rapid Rail KL GTFS coordinates, route membership and stop names"},
        {"label": "Prasarana Malaysia and Ministry of Transport / data.gov.my", "url": OD_CATALOGUE,
         "license": "CC-BY-4.0", "licenseUrl": CC_BY_URL, "role": "Independent reconciled station-origin counts and source coverage"},
        *[{"label": f"Department of Statistics Malaysia, {label}", "url": f"https://data.gov.my/data-catalogue/{name}",
           "license": "CC-BY-4.0", "licenseUrl": CC_BY_URL, "role": "Independent district survey or population estimates"}
          for name, label in (("hh_income_district", "district household income"),
                              ("hh_poverty_district", "district absolute poverty"),
                              ("population_district", "district population"))],
    ]


def regenerate_equity():
    """Use the pre-spatial OD checkpoint and the pinned OSM, GTFS and DOSM inputs."""
    check_memory()
    for path, digest in EQUITY_INPUTS.items():
        if not path.is_file() or sha(path) != digest:
            raise ValueError(f"Missing or changed equity publication input: {path.relative_to(ROOT)}")

    display = load(DISPLAY_PATH)
    if (display["schemaVersion"], display["type"], display["displayRevision"], display["displaySource"]["license"]) != (
        1, "FeatureCollection", DISPLAY_REVISION, "ODbL-1.0"
    ):
        raise ValueError("Expected the pinned ODbL display geography")
    features = display["features"]
    if len(features) != len(DISTRICTS) or {
        f["properties"]["district_id"]: (f["properties"]["state"], f["properties"]["district"]) for f in features
    } != DISTRICTS:
        raise ValueError("Display geography has different district identities")
    # Adapt only field names for the existing spatial routine. Its historical
    # mapping-evidence prose is excluded from the published records below.
    boundary_input = {"type": "FeatureCollection", "features": [
        {**f, "properties": {"kod_daerah": f["properties"]["district_id"], "negeri": f["properties"]["state"],
                             "daerah": f["properties"]["district"]}} for f in features
    ]}
    with (OUTPUT / "gtfs_service_mapping.csv").open(encoding="utf-8-sig", newline="") as handle:
        services = list(csv.DictReader(handle, strict=True))
    mapping, _, mapping_audit = map_stations(
        GTFS_PATH, services, boundary_input,
        {"feature_count": len(features), "output_crs": "EPSG:4326", "layer_url": OSM_ATTRIBUTION_URL}, check_memory,
    )
    capacity = load(OUTPUT / "capacity_metadata.json")
    schedule_date = capacity["GTFS"]["pattern_reference_date"]
    reference = capacity["LRT3_OD_observed"]
    socioeconomic, social_audit = compute_socioeconomic(RAW, int(schedule_date[:4]), check_memory)
    coverage, coverage_audit = compute_coverage(socioeconomic, mapping, schedule_date)
    lrt3_district_activity, lrt3_audit = compute_activity(socioeconomic, mapping, OUTPUT, reference)
    common_year = social_audit["all_scope_common_survey_year"]
    latest_year = social_audit["latest_survey_year"]
    primary, screens = compute_screen(socioeconomic, coverage, lrt3_district_activity, common_year, latest_year)

    scan = load(SCAN_PATH / "scan_audit.json")
    first, last = (date.fromisoformat(scan[key]) for key in ("window_first_date", "window_last_date"))
    cross = crosswalk(mapping, scan)
    checkpoint = pq.read_table(SCAN_PATH / "origin_audit.parquet", use_threads=False)
    if set(checkpoint.column_names) & {"district_id", "district", "physical_station_id", "within_100m_of_district_edge"}:
        raise ValueError("Expected pre-spatial OD evidence")
    rows, origin_audit = reconcile(checkpoint.to_pylist(), cross, first, last, OUTPUT)
    district_rows, rollup = district_activity(rows, cross, coverage, lrt3_district_activity, first, last)
    districts = equity_comparison(district_rows, socioeconomic, coverage, primary)
    lrt3_stops = {row["lrt3_station_code"]: row for row in mapping if row["lrt3_station_code"]}
    contributions = []
    for row in lrt3_audit["station_contribution"]:
        stop = lrt3_stops[row["station_code"]]
        contributions.append({**row, **{key: stop[key] for key in ("longitude", "latitude", "physical_station_id")}})

    if (len(mapping), coverage_audit["mapped_physical_stations_in_scope"], len(lrt3_stops),
        lrt3_audit["line_station_origin_trips"], rollup["district_trips_allocated"],
        origin_audit["origin_day_rows"], len(screens)) != (180, 157, 20, 3_265_221, 71_714_309, 18_592, 48):
        raise ValueError("Independent equity results diverge from the V1 reference totals")
    provenance = {
        "revision": PUBLICATION_REVISION, "displayRevision": DISPLAY_REVISION,
        "databaseLicense": "ODbL-1.0", "databaseLicenseUrl": ODBL_URL,
        "attribution": "© OpenStreetMap contributors",
        "sourceContentRights": "Each independently sourced input retains its source terms and attribution.",
        "historicalResearch": "The original Step 4 and 4B spatial analysis used PLANMalaysia polygons.",
        "method": POINT_METHOD,
        "modifications": "Reassigned GTFS points with OSM boundaries, then recomputed district coverage, activity, screening and edge distances.",
        "sources": publication_sources(),
        "edgeDistance": {"approximate": True, "units": "metres", "reviewThreshold": NEAR_BOUNDARY_METRES},
    }
    payload = {
        "districts": districts, "socioeconomic": {r["district_id"]: r for r in socioeconomic},
        "coverage": {r["district_id"]: r for r in coverage}, "screens": screens,
        "primaryScenario": primary[0]["scenario_id"], "stationContributions": contributions,
        "physicalStations": mapping_audit["unique_physical_station_ids"], "lrt3Stations": len(lrt3_stops),
        "lrt3Trips": lrt3_audit["line_station_origin_trips"], "activityTotal": rollup["district_trips_allocated"],
        "observation": {"start": first.isoformat(), "end": last.isoformat(), "days": scan["window_days"],
                        "inclusive": True, "timezone": "Asia/Kuala_Lumpur"},
        "putrajayaOrigins": scan["origin_prefix_counts"]["PYL"], "putrajayaDestinations": scan["destination_prefix_counts"]["PYL"],
        "policy": POLICY, "limitations": [*SOURCE_LIMITS[:-1], PUBLICATION_NOTE, *LIMITATIONS],
        "physicalDeduplication": DEDUPLICATION,
        "scope": SCOPE_DEFINITION, "populationYear": social_audit["population_reference_year"],
        "publicationProvenance": provenance,
        "stationAssignments": [{key: row[key] for key in STATION_FIELDS} for row in mapping],
    }
    evidence = {
        "revision": PUBLICATION_REVISION,
        "inputSha256": {path.relative_to(ROOT).as_posix(): digest for path, digest in EQUITY_INPUTS.items()},
        "originDayRows": len(rows), "commonSurveyYear": common_year, "latestSurveyYear": latest_year,
        "originAudit": origin_audit, "districtRollup": rollup, "coverageDiagnostics": mapping_audit,
    }
    return payload, display, evidence
