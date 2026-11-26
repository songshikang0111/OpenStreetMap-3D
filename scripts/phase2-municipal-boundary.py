"""Export a city boundary from the same dated OSM input used for the build.
Usage: python scripts/phase2-municipal-boundary.py file.osm.pbf relation_id boundary.geojson
Optional validation dependency: pyosmium 4.3.2.
"""
import json
import sys

import osmium

source, relation_id, target = sys.argv[1:]
relation_id = int(relation_id)
areas = osmium.FileProcessor(source).with_areas(osmium.filter.IdFilter({relation_id}))
areas = areas.with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
for area in areas:
    if area.from_way() or area.orig_id() != relation_id:
        continue
    polygons = []
    for outer in area.outer_rings():
        rings = [outer, *area.inner_rings(outer)]
        polygons.append([[[node.lon, node.lat] for node in ring] for ring in rings])
    if not polygons:
        continue
    with open(target, "w", encoding="utf-8") as output:
        json.dump({"type": "Feature", "id": f"relation/{relation_id}",
                   "properties": {"name": area.tags.get("name"), "source": "© OpenStreetMap contributors, ODbL-1.0"},
                   "geometry": {"type": "MultiPolygon", "coordinates": polygons}}, output)
    break
else:
    raise SystemExit(f"Missing or incomplete polygon for relation/{relation_id}")
