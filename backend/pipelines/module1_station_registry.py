"""Join existing stations to cached official GTFS stop_times; never infer membership from proximity.
Run after the existing GTFS downloads: python backend/pipelines/module1_station_registry.py
Existing coordinates and observation keys are preserved. New KTMB stops have no invented ridership.
"""
import csv
import io
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'frontend/src/data'
existing = json.loads((DEST / 'stations.json').read_text(encoding='utf-8'))['stations']
def normal(name):
    # Published Malay abbreviations / station branding; no proximity matching.
    text = name.lower().replace(' - uob', '').replace('perhentian ', '')
    text = re.sub(r'\bkg\.?\s+', 'kampung ', text)
    text = re.sub(r'\bjln\b', 'jalan', text)
    text = re.sub(r'\bbdr\b', 'bandar', text)
    text = re.sub(r'\bpel\b', 'pelabuhan', text)
    text = re.sub(r'\bsel\b', 'selatan', text)
    return re.sub(r'[^a-z0-9]', '', text)
links, additions, unresolved = {}, [], []
rapid_names = {'AG': 'LRT Ampang–Sri Petaling', 'PH': 'LRT Ampang–Sri Petaling', 'KJ': 'LRT Kelana Jaya',
               'KGL': 'MRT Kajang', 'PYL': 'MRT Putrajaya', 'MR': 'KL Monorail', 'SA': 'LRT Shah Alam'}
route_names = {f['properties']['id']: f['properties']['name'] for f in json.loads((DEST/'ktmb_rail_geometry.json').read_text())['features']}
for operator, filename in [('rapidrail', 'rapid-rail-gtfs.zip'), ('ktmb', 'ktmb-gtfs.zip')]:
    with zipfile.ZipFile(ROOT / 'backend/data/raw' / filename) as archive:
        def rows(name):
            return list(csv.DictReader(io.StringIO(archive.read(name+'.txt').decode('utf-8-sig'))))
        stops, trips, times = rows('stops'), rows('trips'), rows('stop_times')
    trip_routes = {t['trip_id']: t['route_id'] for t in trips}
    memberships = {}
    for time in times:
        route = trip_routes[time['trip_id']]
        if operator == 'rapidrail' and route not in rapid_names:
            continue  # e.g. BRT is outside this rail atlas
        memberships.setdefault(time['stop_id'], set()).add(('shp_'+route+'_0') if operator == 'rapidrail' else 'ktmb_'+route)
    for stop in stops:
        route_ids = sorted(memberships.get(stop['stop_id'], []))
        if not route_ids:
            continue
        matches = [s for s in existing if (s['source']=='rapidrail') == (operator=='rapidrail') and
                   ((operator=='rapidrail' and s['code']==stop['stop_id']) or normal(s['name'])==normal(stop['stop_name']))]
        if matches:
            for station in matches:
                key = station['source']+':'+station['code']
                links[key] = sorted(set(links.get(key, [])) | set(route_ids))
            continue
        try:
            lng, lat = float(stop['stop_lon']), float(stop['stop_lat'])
        except (ValueError, KeyError):
            unresolved.append({'stop': stop['stop_id'], 'reason': 'Missing GTFS coordinates'})
            continue
        route_id = route_ids[0]
        line = rapid_names[route_id.removeprefix('shp_').removesuffix('_0')] if operator=='rapidrail' else route_names[route_id]
        additions.append({'name': stop['stop_name'].title(), 'code': stop['stop_id'], 'line': line,
                          'lng': lng, 'lat': lat, 'source': 'rapidrail' if operator=='rapidrail' else 'reference', 'routeIds': route_ids})
unmapped = [s['source']+':'+s['code']+':'+s['name'] for s in existing if s['source']+':'+s['code'] not in links]
result = {'source': 'https://api.data.gov.my/gtfs-static', 'method': 'GTFS trip/stop_times join; existing stations matched by exact stop ID or normalized name',
          'links': links, 'additions': additions, 'unresolved': unresolved, 'unmatchedExisting': unmapped}
(DEST/'verified_station_registry.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{len(links)} existing station mappings; {len(additions)} additional official stops; {len(unmapped)} unmatched legacy records (retained).')
