"""Complete only renderable multipolygon areas returned by the bbox Map API."""
import datetime
import json
import urllib.request


def complete_areas(data):
    elements = {(e['type'], e['id']): e for e in data['elements']}
    records = []
    candidates = [e for e in data['elements'] if e['type'] == 'relation'
                  and e.get('tags', {}).get('type') == 'multipolygon'
                  and any(k in e.get('tags', {}) for k in
                          ('building', 'building:part', 'natural', 'waterway', 'landuse', 'landcover', 'leisure', 'amenity', 'area:highway'))]
    for relation in candidates:
        missing = [m for m in relation.get('members', []) if m['type'] == 'way'
                   and (m['type'], m['ref']) not in elements]
        if not missing:
            continue
        url = f'https://api.openstreetmap.org/api/0.6/relation/{relation["id"]}/full.json'
        print('Completing area', relation['id'], relation.get('tags', {}).get('name', ''), flush=True)
        request = urllib.request.Request(url, headers={'User-Agent': 'CityInk/0.9 (small local OSM prototype)'})
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        for e in result['elements']:
            elements[(e['type'], e['id'])] = e
        records.append({'relation': relation['id'], 'endpoint': url,
                        'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    data['elements'] = list(elements.values())
    data.setdefault('metadata', {}).setdefault('completedAreas', []).extend(records)
    return data


if __name__ == '__main__':
    import pathlib
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    for name in sys.argv[1:]:
        path = pathlib.Path(name)
        data = complete_areas(json.loads(path.read_text(encoding='utf-8')))
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print('Saved', path, len(data['elements']), 'elements', flush=True)
