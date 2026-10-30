"""Fetch a small, reproducible OSM extract directly from an Overpass instance."""
import argparse
import datetime
import json
import pathlib
import sys
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser()
parser.add_argument('--bbox', default='39.9015,116.4490,39.9175,116.4720', help='south,west,north,east, WGS84')
parser.add_argument('--name', default='北京 · 国贸 CBD')
parser.add_argument('--output', default='public/data/beijing-cbd.json')
parser.add_argument('--context', action='store_true', help='Include street nodes and landscape semantics in the same regional extract')
args = parser.parse_args()
bbox = [float(x) for x in args.bbox.split(',')]
if len(bbox) != 4 or not (-90 <= bbox[0] < bbox[2] <= 90 and -180 <= bbox[1] < bbox[3] <= 180):
    raise SystemExit('Invalid bbox')
if bbox[2] - bbox[0] > .04 or bbox[3] - bbox[1] > .05:
    raise SystemExit('Keep this prototype extract under approximately 4 km per side.')
box = ','.join(str(x) for x in bbox)
context = ''
if args.context:
    selectors = ['["landuse"]','["landcover"]','["leisure"]',
                 '["natural"~"^(wood|scrub|grassland|heath|wetland|sand|bare_rock)$"]',
                 '["amenity"~"^(parking|bicycle_parking|fountain|marketplace)$"]',
                 '["area:highway"]','["place"="square"]','["surface"]["area"="yes"]']
    context = '\n'.join(f'{kind}{selector}({box});' for selector in selectors for kind in ('way','relation'))
    context += f'\nnode["highway"~"^(crossing|traffic_signals|street_lamp|bus_stop)$"]({box});way["natural"="tree_row"]({box});way["barrier"="hedge"]({box});'
query = f'''[out:json][timeout:60];(
way["building"]({box});relation["building"]({box});
way["building:part"]({box});relation["building:part"]({box});
way["highway"]({box});way["waterway"]({box});
way["natural"="water"]({box});relation["natural"="water"]({box});
way["landuse"~"^(grass|forest|recreation_ground)$"]({box});
way["leisure"~"^(park|garden)$"]({box});
node["natural"="tree"]({box});
{context}
);out body geom;'''
endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
for endpoint in endpoints:
    try:
        print('Fetching', endpoint, args.bbox, flush=True)
        request = urllib.request.Request(endpoint, data=urllib.parse.urlencode({'data': query}).encode(), headers={'User-Agent': 'BeijingCityInk/0.1 (local OSM visualization prototype)'})
        with urllib.request.urlopen(request, timeout=75) as response:
            data = json.load(response)
        if data.get('remark') or not data.get('elements'):
            raise ValueError(data.get('remark', 'Empty response'))
        data['metadata'] = {
            'name': args.name, 'bbox': bbox,
            'center': [(bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2],
            'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'endpoint': endpoint, 'query': query,
            'attribution': '© OpenStreetMap contributors',
            'license': 'ODbL-1.0',
            'licenseUrl': 'https://www.openstreetmap.org/copyright',
            'coordinateSystem': 'WGS84 / EPSG:4326',
            'terrain': 'Flat local ground; no elevation dataset in this prototype.'
        }
        output = pathlib.Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print(f'Saved {len(data["elements"])} elements, {output.stat().st_size:,} bytes to {output}', flush=True)
        break
    except Exception as error:
        print(f'{type(error).__name__}: {error}', flush=True)
else:
    raise SystemExit('All Overpass endpoints failed; existing extract was not changed.')
