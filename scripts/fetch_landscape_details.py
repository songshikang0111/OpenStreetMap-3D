"""Fetch a bounded, semantic OSM landscape overlay without changing the base extract.

Usage: python scripts/fetch_landscape_details.py
The output retains standard Overpass geometry, tags and relation member roles.
Only top-level objects already in the base/street extracts are excluded; member
geometry (including inner rings) is never clipped, simplified or deduplicated.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import pathlib
import sys
import urllib.parse
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]
SEMANTIC_KEYS = ('landuse', 'landcover', 'leisure', 'natural', 'amenity',
                 'place', 'area:highway', 'surface', 'parking', 'barrier')


def validate_bbox(bbox):
    if len(bbox) != 4 or not (-90 <= bbox[0] < bbox[2] <= 90
                              and -180 <= bbox[1] < bbox[3] <= 180):
        raise ValueError('Invalid bbox: expected south,west,north,east in WGS84')
    if bbox[2] - bbox[0] > .04 or bbox[3] - bbox[1] > .05:
        raise ValueError('Use bounded tiles under approximately 4 km per side.')
    return bbox


def make_query(bbox):
    box = ','.join(map(str, validate_bbox(bbox)))
    selectors = [
        '["landuse"]',  # Includes context areas; not all landuse means vegetation.
        '["landcover"]',
        '["leisure"]',
        '["natural"~"^(wood|scrub|grassland|heath|wetland|sand|bare_rock|water)$"]',
        '["amenity"~"^(parking|bicycle_parking|fountain|marketplace)$"]',
        '["highway"~"^(pedestrian|footway|path)$"]["area"="yes"]',
        '["area:highway"]',
        '["place"="square"]',
        '["surface"]["area"="yes"]',
    ]
    clauses = [f'{kind}{selector}({box});'
               for selector in selectors for kind in ('way', 'relation')]
    clauses += [f'way["barrier"="hedge"]({box});',
                f'way["natural"="tree_row"]({box});']
    # No bbox on out: keep the full geometry of crossing ways and all ring members.
    return '[out:json][timeout:45];(\n' + '\n'.join(clauses) + '\n);out meta geom;'


def summarize(elements):
    types = Counter(e['type'] for e in elements)
    tags = {key: dict(sorted(Counter(e['tags'][key] for e in elements
                                    if key in e.get('tags', {})).items()))
            for key in SEMANTIC_KEYS}
    relations = [e for e in elements if e['type'] == 'relation']
    ways = [e for e in elements if e['type'] == 'way']
    return {
        'elements': len(elements), 'types': dict(sorted(types.items())),
        'tagValues': tags,
        'closedWays': sum(bool(e.get('nodes')) and e['nodes'][0] == e['nodes'][-1]
                          for e in ways),
        'multipolygons': sum(e.get('tags', {}).get('type') == 'multipolygon'
                             for e in relations),
        'innerMembers': sum(m.get('role') == 'inner' for e in relations
                            for m in e.get('members', [])),
    }


def check_geometry(elements):
    """Fail closed on truncated geometry rather than silently filling polygon holes."""
    for element in elements:
        if element['type'] == 'way':
            geometry = element.get('geometry', [])
            if len(geometry) != len(element.get('nodes', [])) or len(geometry) < 2:
                raise ValueError(f'Incomplete geometry on way {element["id"]}')
            if any(not p or 'lat' not in p or 'lon' not in p for p in geometry):
                raise ValueError(f'Missing coordinates on way {element["id"]}')
        elif element['type'] == 'relation':
            for member in element.get('members', []):
                if member['type'] == 'way' and member.get('role', '') in ('', 'outer', 'inner'):
                    geometry = member.get('geometry', [])
                    if len(geometry) < 2 or any(not p or 'lat' not in p or 'lon' not in p
                                                for p in geometry):
                        raise ValueError(f'Incomplete member {member["ref"]} in relation {element["id"]}')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=pathlib.Path, default=ROOT / 'public/data/beijing-cbd.json')
    parser.add_argument('--exclude', type=pathlib.Path, action='append',
                        help='Additional extract to deduplicate; default: street-details.json')
    parser.add_argument('--bbox', help='Optional south,west,north,east; defaults to base bbox')
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'public/data/landscape-details.json')
    parser.add_argument('--endpoint', action='append', help='Override Overpass endpoint(s)')
    args = parser.parse_args()
    base_bytes = args.base.read_bytes()
    base = json.loads(base_bytes)
    bbox = validate_bbox([float(v) for v in args.bbox.split(',')]
                         if args.bbox else base['metadata']['bbox'])
    known = {(e['type'], e['id']) for e in base['elements']}
    sources = [{'file': args.base.name, 'sha256': hashlib.sha256(base_bytes).hexdigest(),
                'elements': len(base['elements'])}]
    exclusions = args.exclude if args.exclude is not None else [args.base.with_name('street-details.json')]
    for path in exclusions:
        if not path.exists():
            if args.exclude is not None:
                raise FileNotFoundError(path)
            continue
        contents = path.read_bytes()
        data = json.loads(contents)
        known.update((e['type'], e['id']) for e in data['elements'])
        sources.append({'file': path.name, 'sha256': hashlib.sha256(contents).hexdigest(),
                        'elements': len(data['elements'])})
    query = make_query(bbox)
    for endpoint in args.endpoint or ENDPOINTS:
        try:
            print(f'Fetching landscape detail from {endpoint}: {bbox}', flush=True)
            request = urllib.request.Request(
                endpoint, data=urllib.parse.urlencode({'data': query}).encode(),
                headers={'User-Agent': 'BeijingCityInk/0.6 (bounded landscape OSM overlay)'})
            with urllib.request.urlopen(request, timeout=55) as response:
                result = json.load(response)
            if result.get('remark') or not isinstance(result.get('elements'), list):
                raise ValueError(result.get('remark', 'Invalid Overpass response'))
            check_geometry(result['elements'])
            all_elements = result['elements']
            elements = [e for e in all_elements if (e['type'], e['id']) not in known]
            # Keep all original semantic tags, OSM version/timestamp and geometry.
            result['elements'] = elements
            result['metadata'] = {
                'schemaVersion': 1,
                'name': 'OSM landscape detail supplement',
                'bbox': bbox, 'center': [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
                'retrievedAt': datetime.now(timezone.utc).isoformat(),
                'endpoint': endpoint, 'query': query,
                'source': 'OpenStreetMap / Overpass API',
                'attribution': '© OpenStreetMap contributors',
                'license': 'ODbL-1.0',
                'licenseUrl': 'https://www.openstreetmap.org/copyright',
                'coordinateSystem': 'WGS84 / EPSG:4326',
                'geometryPolicy': 'Full un-clipped way geometry and relation member roles/geometry; no inferred shapes.',
                'deduplication': {
                    'key': 'type:id', 'policy': 'Prefer existing base/street snapshots',
                    'sources': sources, 'excludedExisting': len(all_elements) - len(elements),
                },
                'fetchedStats': summarize(all_elements), 'overlayStats': summarize(elements),
                'interpretation': 'Landuse contexts do not imply vegetation; underground/indoor/building features require separate rendering policy.',
                'tagReferences': [
                    'https://wiki.openstreetmap.org/wiki/Key:landcover',
                    'https://wiki.openstreetmap.org/wiki/Tag:landuse=grass',
                    'https://wiki.openstreetmap.org/wiki/Tag:leisure=garden',
                    'https://wiki.openstreetmap.org/wiki/Tag:highway=pedestrian',
                    'https://wiki.openstreetmap.org/wiki/Tag:amenity=parking',
                    'https://wiki.openstreetmap.org/wiki/Tag:leisure=pitch',
                    'https://wiki.openstreetmap.org/wiki/Tag:landuse=construction',
                    'https://wiki.openstreetmap.org/wiki/Relation:multipolygon',
                ],
            }
            # Replace only after successful validation; leave previous snapshot on failure.
            args.output.parent.mkdir(parents=True, exist_ok=True)
            temporary = args.output.with_suffix(args.output.suffix + '.tmp')
            temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            temporary.replace(args.output)
            print(json.dumps(result['metadata']['overlayStats'], ensure_ascii=False), flush=True)
            print(f'Saved {len(elements)} new elements ({len(all_elements) - len(elements)} existing excluded), '
                  f'{args.output.stat().st_size:,} bytes: {args.output}', flush=True)
            return
        except Exception as error:
            print(f'{type(error).__name__}: {error}', flush=True)
    raise SystemExit('All landscape endpoints failed; existing snapshots were not changed.')


if __name__ == '__main__':
    main()
