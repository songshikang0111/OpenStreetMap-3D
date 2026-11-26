// The OSM features the builder keeps (03 section 2: one place, easy to extend). Mirrors the phase-one Overpass query
// in src/data (buildings and parts, roads, water, land cover, leisure, parking and squares, trees and street nodes).

const LANDUSE_NATURAL = /^(wood|scrub|grassland|heath|wetland|sand|bare_rock)$/;
const AMENITY_AREA = /^(parking|bicycle_parking|fountain|marketplace)$/;
const STREET_NODE = /^(crossing|traffic_signals|street_lamp|bus_stop)$/;

/** Ways kept from a PBF (relation members are kept separately, whatever their tags). */
export function wantedWay(t: Record<string, string>): boolean {
  return Boolean(
    t.building ||
      t['building:part'] ||
      t.highway ||
      t.waterway ||
      t.natural === 'water' ||
      t.natural === 'tree_row' ||
      (t.natural && LANDUSE_NATURAL.test(t.natural)) ||
      t.landuse ||
      t.landcover ||
      t.leisure ||
      (t.amenity && AMENITY_AREA.test(t.amenity)) ||
      t['area:highway'] ||
      t.place === 'square' ||
      (t.surface && t.area === 'yes') ||
      t.barrier === 'hedge',
  );
}

/** Relations kept: multipolygons and buildings carrying one of the kept area tags. */
export function wantedRelation(t: Record<string, string>): boolean {
  if (t.type === 'building') return true;
  if (t.type !== 'multipolygon') return false;
  return Boolean(
    t.building ||
      t['building:part'] ||
      t.natural === 'water' ||
      (t.natural && LANDUSE_NATURAL.test(t.natural)) ||
      t.landuse ||
      t.landcover ||
      t.leisure ||
      (t.amenity && AMENITY_AREA.test(t.amenity)) ||
      t['area:highway'] ||
      t.place === 'square' ||
      (t.surface && t.area === 'yes'),
  );
}

/** Tagged nodes kept as point features. */
export function wantedNode(t: Record<string, string>): boolean {
  return t.natural === 'tree' || Boolean(t.highway && STREET_NODE.test(t.highway));
}
