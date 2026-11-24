"""Build state boundaries and schematic KTMB corridors from public cached data.

python backend/pipelines/module1_national_context.py [--refresh]
KTMB's GTFS has no shapes.txt. These are explicitly labelled stop-to-stop
reference lines, not measured track geometry. Rapid Rail retains its own shapes.
"""
import argparse
import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'backend/data/raw'
DEST = ROOT / 'frontend/src/data'
SOURCES = {
    'ktmb-gtfs.zip': 'https://api.data.gov.my/gtfs-static/ktmb',
    'malaysia-states.geojson': 'https://raw.githubusercontent.com/dosm-malaysia/data-open/main/datasets/geodata/administrative_1_state.geojson',
    'malaysia-country.geojson': 'https://raw.githubusercontent.com/dosm-malaysia/data-open/main/datasets/geodata/administrative_0_malaysia.geojson',
}
NAMES = {
    'KC05_KB18': 'KTM Komuter (Seremban Line)', 'KA15_KD19': 'KTM Komuter (Port Klang Line)',
    '100_47300': 'KTM Komuter Utara (Padang Besar)', '100_9000': 'KTM Komuter Utara (Ipoh)',
    'SS': 'KTM Komuter Shuttle Selatan', 'ETS': 'KTM ETS', 'SH': 'KTM Intercity Shuttle',
    'ERT': 'KTM Ekspres Rakyat Timuran', 'ST': 'KTM Shuttle Tebrau',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    for filename, url in SOURCES.items():
        if args.refresh or not (RAW / filename).exists():
            with urllib.request.urlopen(url, timeout=45) as response:
                (RAW / filename).write_bytes(response.read())
    states = json.loads((RAW / 'malaysia-states.geojson').read_text(encoding='utf-8'))
    if len(states['features']) != 16:
        raise ValueError('Expected 13 states and 3 federal territories')
    states.pop('crs', None)
    states['source'] = SOURCES['malaysia-states.geojson']
    (DEST / 'malaysia_states.json').write_text(json.dumps(states, separators=(',', ':')), encoding='utf-8')
    country = json.loads((RAW / 'malaysia-country.geojson').read_text(encoding='utf-8'))
    country.pop('crs', None)
    country['source'] = SOURCES['malaysia-country.geojson']
    if len(country['features']) != 1 or country['features'][0]['geometry']['type'] != 'MultiPolygon':
        raise ValueError('Expected one Malaysian MultiPolygon')
    (DEST / 'malaysia_country.json').write_text(json.dumps(country, separators=(',', ':')), encoding='utf-8')
    with zipfile.ZipFile(RAW / 'ktmb-gtfs.zip') as archive:
        def rows(name):
            return list(csv.DictReader(io.StringIO(archive.read(name + '.txt').decode('utf-8-sig'))))
        routes, trips, stops, times = (rows(name) for name in ('routes', 'trips', 'stops', 'stop_times'))
    stop_lookup = {stop['stop_id']: stop for stop in stops}
    sequences = {}
    for time in times:
        sequences.setdefault(time['trip_id'], []).append(time)
    features = []
    for route in routes:
        candidates = [sequences[t['trip_id']] for t in trips if t['route_id'] == route['route_id'] and t['trip_id'] in sequences]
        sequence = sorted(max(candidates, key=len), key=lambda p: int(p['stop_sequence']))
        positions = [[float(stop_lookup[p['stop_id']]['stop_lon']), float(stop_lookup[p['stop_id']]['stop_lat'])] for p in sequence]
        features.append({'type': 'Feature', 'properties': {'id': 'ktmb_' + route['route_id'],
            'name': NAMES[route['route_id']], 'category': 'KTMB', 'color': '#' + route['route_color'],
            'geometrySource': 'GTFS stop-to-stop reference', 'sourceUrl': SOURCES['ktmb-gtfs.zip']},
            'geometry': {'type': 'LineString', 'coordinates': positions}})
    result = {'type': 'FeatureCollection', 'source': SOURCES['ktmb-gtfs.zip'], 'license': 'CC BY 4.0',
        'retrieved_at': datetime.now(timezone.utc).isoformat(), 'features': features,
        'note': 'Longest published stop sequence per route; schematic, not surveyed track geometry.'}
    (DEST / 'ktmb_rail_geometry.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(f'Saved {len(states["features"])} state boundaries and {len(features)} KTMB reference routes.')


if __name__ == '__main__':
    main()
