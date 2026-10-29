// Semantic ground-use classification, independent of scene meshes and geography.
// Source rules: OSM Wiki landcover, landuse, leisure, parking, location and level.
const value = (tags, key) => String(tags?.[key] ?? '').trim().toLowerCase();
const present = (tags, key) => !['', 'no', 'false', '0'].includes(value(tags, key));
const oneOf = (candidate, values) => values.includes(candidate);

function hasNonGroundLevel(input) {
  if (input == null || String(input).trim() === '') return false;
  // Includes semicolon lists and ranges: a multi-level area is not one ground plane.
  const levels = String(input).match(/[+-]?\d+(?:\.\d+)?/g);
  return levels?.some(level => Number(level) !== 0) ?? false;
}

/** Whether a tagged feature can occupy the engine's flat ground surface.
 * This is a conservative rendering policy, not a geometric height inference.
 * Nonzero layer only establishes ordering in OSM; we avoid flattening that area.
 */
export function isSurfaceLandscape(tags = {}) {
  if (present(tags, 'building') || present(tags, 'building:part')) return false;
  if (present(tags, 'indoor') || present(tags, 'bridge') || present(tags, 'tunnel')) return false;
  if (oneOf(value(tags, 'location'), ['underground', 'underwater', 'roof', 'rooftop', 'indoor', 'overground', 'elevated'])) return false;
  if (oneOf(value(tags, 'parking'), ['underground', 'multi-storey', 'rooftop'])) return false;
  if (hasNonGroundLevel(tags?.level) || hasNonGroundLevel(tags?.layer)) return false;
  if (Number.parseFloat(tags?.min_height) > 0 || Number.parseFloat(tags?.['building:min_level']) > 0) return false;
  return true;
}

/** Return a physical ground template, or null when the tags do not establish one.
 * Call only for polygon features: a footway line or POI node is not an area.
 * Retain original tags so sport, surface, access, bus and garden subtype can refine
 * the template without turning procedural decoration into claimed OSM detail.
 */
export function classifyLandscape(tags = {}) {
  if (!isSurfaceLandscape(tags)) return null;
  const landuse = value(tags, 'landuse'), landcover = value(tags, 'landcover');
  const leisure = value(tags, 'leisure'), natural = value(tags, 'natural');
  const amenity = value(tags, 'amenity'), highway = value(tags, 'highway');
  // These need water-specific rendering; a containing park/grass tag must not win.
  if (natural === 'water' || amenity === 'fountain' || leisure === 'swimming_pool'
      || value(tags, 'waterway') === 'riverbank' || natural === 'wetland') return null;
  if (landuse === 'construction') return 'construction';
  if (amenity === 'parking') return 'parking';
  if (leisure === 'pitch' || leisure === 'track') return 'sport';
  if (value(tags, 'place') === 'square'
      || (value(tags, 'area') === 'yes' && oneOf(highway, ['pedestrian', 'footway', 'path']))
      || oneOf(value(tags, 'area:highway'), ['pedestrian', 'footway'])) return 'plaza';
  if (amenity === 'marketplace') return 'plaza';
  if (landuse === 'forest' || natural === 'wood' || landcover === 'trees') return 'wood';
  if (oneOf(landuse, ['flowerbed', 'shrubbery']) || leisure === 'garden'
      || oneOf(natural, ['scrub', 'heath']) || oneOf(landcover, ['scrub', 'shrubs', 'shrubbery'])) return 'garden';
  if (oneOf(landuse, ['grass', 'meadow', 'village_green']) || natural === 'grassland'
      || landcover === 'grass') return 'lawn';
  if (leisure === 'park' || landuse === 'recreation_ground') return 'park';
  if (oneOf(natural, ['sand', 'bare_rock', 'mud'])
      || oneOf(landcover, ['bare_ground', 'sand', 'rock'])) return 'soil';
  // A bare surface area may be mapped without landuse. Do not convert a tagged
  // carriageway or parking area into a pedestrian plaza based on its surface.
  if (value(tags, 'area') === 'yes' && !highway && !value(tags, 'area:highway')) {
    const surface = value(tags, 'surface');
    if (oneOf(surface, ['grass', 'artificial_turf'])) return 'lawn';
    if (oneOf(surface, ['paving_stones', 'concrete:plates', 'sett', 'cobblestone'])) return 'plaza';
    if (oneOf(surface, ['ground', 'dirt', 'earth', 'sand', 'gravel', 'fine_gravel'])) return 'soil';
  }
  return null;
}

/** Land-use context chooses an inference profile; it is never a ground fill. */
export function classifyLandscapeContext(tags = {}) {
  if (!isSurfaceLandscape(tags)) return null;
  const landuse = value(tags, 'landuse');
  return oneOf(landuse, ['commercial', 'residential', 'retail', 'railway', 'industrial']) ? landuse : null;
}
