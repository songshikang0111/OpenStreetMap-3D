"""Optional OSM street detail overlay; keeps the original building extract unchanged."""
import json
import pathlib
import urllib.parse
import urllib.request
from datetime import datetime, timezone

root = pathlib.Path(__file__).resolve().parents[1]
base = json.loads((root / 'public/data/beijing-cbd.json').read_text(encoding='utf-8'))
box = ','.join(map(str, base['metadata']['bbox']))
query = f'''[out:json][timeout:40];(
node["highway"~"^(crossing|traffic_signals|street_lamp|bus_stop)$"]({box});
way["natural"="tree_row"]({box});
);out body geom;'''
for endpoint in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
    try:
        request = urllib.request.Request(endpoint, data=urllib.parse.urlencode({'data': query}).encode(), headers={'User-Agent': 'BeijingCityInk/0.2 OSM local prototype'})
        with urllib.request.urlopen(request, timeout=55) as response:
            result = json.load(response)
        if result.get('remark') or 'elements' not in result:
            raise ValueError(result.get('remark', 'Invalid response'))
        result['metadata'] = {'retrievedAt': datetime.now(timezone.utc).isoformat(), 'bbox': base['metadata']['bbox'], 'endpoint': endpoint, 'query': query, 'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors'}
        output = root / 'public/data/street-details.json'
        output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print(f'{len(result["elements"])} street detail objects saved')
        break
    except Exception as error:
        print(type(error).__name__, str(error))
else:
    raise SystemExit('Street overlay fetch failed; existing data unchanged')
