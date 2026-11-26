"""Generate independent building-only phase-one JSON for AC602 with pyosmium (optional test dependency).
Usage: python scripts/phase2-pbf-reference.py input.osm.pbf west,south,east,north output.json
"""
import json
import sys

import osmium

source, extent, target = sys.argv[1:]
west, south, east, north = map(float, extent.split(","))
elements = []
way_ids, relation_ids = set(), set()
# libosmium assembles complete multipolygons from its own location and relation indexes.
areas = osmium.FileProcessor(source).with_areas(osmium.filter.KeyFilter("building", "building:part"))
areas = areas.with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
for area in areas:
    if not (area.tags.get("building") or area.tags.get("building:part")):
        continue
    rings = []
    for outer in area.outer_rings():
        points = [{"lat": n.lat, "lon": n.lon} for n in outer]
        minx, maxx = min(p["lon"] for p in points), max(p["lon"] for p in points)
        miny, maxy = min(p["lat"] for p in points), max(p["lat"] for p in points)
        if maxx < west or minx > east or maxy < south or miny > north:
            continue
        rings.append(("outer", points))
        for inner in area.inner_rings(outer):
            rings.append(("inner", [{"lat": n.lat, "lon": n.lon} for n in inner]))
    if not rings:
        continue
    if area.from_way():
        way_ids.add(area.orig_id())
    else:
        relation_ids.add(area.orig_id())

# Restore the exact source IDs of all member ways. In particular a separately tagged inner building
# must still be recognisable as a member by the phase-one suppression rule.
relations = []
for relation in osmium.FileProcessor(source, osmium.osm.RELATION).with_filter(osmium.filter.IdFilter(relation_ids)):
    members = [{"type": "way", "ref": m.ref, "role": m.role} for m in relation.members if m.type == "w"]
    relations.append({"type": "relation", "id": relation.id, "tags": dict(relation.tags), "members": members})
members_needed = {m["ref"] for r in relations for m in r["members"]}
geometry = {}
ways = osmium.FileProcessor(source).with_locations().with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
for way in ways.with_filter(osmium.filter.IdFilter(way_ids | members_needed)):
    points = [{"lat": n.lat, "lon": n.lon} for n in way.nodes]
    if way.id in way_ids:
        elements.append({"type": "way", "id": way.id, "tags": dict(way.tags), "geometry": points,
                         "nodes": [n.ref for n in way.nodes]})
    if way.id in members_needed:
        geometry[way.id] = points
for relation in relations:
    for m in relation["members"]:
        if m["ref"] in geometry:
            m["geometry"] = geometry[m["ref"]]
    elements.append(relation)
with open(target, "w", encoding="utf-8") as output:
    json.dump({"metadata": {"bbox": [south, west, north, east], "center": [(south+north)/2, (west+east)/2],
                            "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors"},
               "elements": elements}, output)
print(len(elements), "OSM polygons")
