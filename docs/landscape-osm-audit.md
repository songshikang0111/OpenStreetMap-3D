# Landscape data audit — Beijing CBD

Audit date: 2026-10-30 (Asia/Shanghai). Extract bbox: south 39.9015, west 116.4490, north 39.9175, east 116.4720, WGS84. This is an audit of mapped OSM features, not proof that unmapped land is vacant or green.

## What the previous pipeline missed

`scripts/fetch_osm.py` fetched all highway ways, building ways/relations, water ways/relations, grass/forest/recreation-ground ways and park/garden ways. The landscape omissions were both acquisition and classification:

| Data already present | Count | Previous effect |
| --- | ---: | --- |
| `landuse=grass` | 32 | Classified as green |
| `leisure=park` | 9 | Classified as green |
| `highway=pedestrian + area=yes` | 4 | Skipped by road parsing and not classified as any surface |
| `amenity=parking` | 2 | Both are `building=yes + parking=multi-storey`; must remain buildings |
| `landuse=residential` | 3 | All three are dormitory buildings; not open residential land |

The base has 1,376 objects (1,367 ways and 9 relations). The street overlay has 215 nodes and no landscape areas. The original query did not request green-area relations, other landuse, landcover, wood/scrub, sports areas, surface parking, fountains, or construction sites. The original parser only recognized buildings, water, grass/forest/recreation grounds and parks/gardens as polygons.

## Supplemental snapshot

Reproduce with `python scripts/fetch_landscape_details.py`. The script reads the base bbox and supports `--base`, `--bbox`, `--exclude`, `--endpoint` and `--output`. It rejects oversized/inverted bbox requests, incomplete geometry, and Overpass partial-result remarks before replacing the output.

Source: `https://overpass-api.de/api/interpreter`; retrieved **2026-10-29T20:51:14.749460+00:00** (2026-10-30 04:51 Beijing time). OSM base timestamp: **2026-10-29T20:49:36Z**.

The bounded query returned **103 objects**. **55** were already in the existing base/street snapshots and were excluded by `type:id`. The overlay contains **48 new objects**: **46 closed ways and 2 multipolygon relations**. Both new relations have complete outer members and no inner members. The fetched water relation has two inner members and was deduplicated because the original base already includes its complete member geometry.

| New mapped semantic area | Objects | Engine use |
| --- | ---: | --- |
| Surface/default-surface parking | 8 | Parking surface; preserve access, bus and operator tags |
| Sports pitches | 8 | 3 basketball, 2 soccer, 1 tennis, 1 running, 1 unspecified |
| `natural=wood` | 1 | Woodland surface and clustered canopy |
| `landuse=flowerbed` | 1 | Low garden/planting-bed template |
| Park multipolygon | 1 | Qingfeng Park; stitch full geometry before clipping |
| Construction land | 4 | Construction/soil reservation; do not infer a public park |
| Fountain | 1 | Water feature reservation; separate water rendering |
| Commercial context | 17 | Courtyard/forecourt context only |
| Residential context | 4 | Courtyard context only |
| Retail context | 2 | Retail forecourt context only |
| Railway context | 1 | Reserve depot ground; do not turn it into an urban garden |

There are **no `landcover`, `area:highway`, hedge or tree-row objects** in this query result. Absence in OSM does not establish their absence on the ground. All 48 new objects lack `surface=*`; exact paving colors/materials are therefore procedural choices. Eight parking polygons have no underground/building/roof tags; seven omit the parking subtype, whose documented default is surface parking. The remaining polygon explicitly says `parking=surface`.

Selected traceable objects:

- [CBD sports square soccer pitch — way 337899975](https://www.openstreetmap.org/way/337899975)
- [Jianwai SOHO basketball court — way 828231018](https://www.openstreetmap.org/way/828231018)
- [Flowerbed — way 1147872445](https://www.openstreetmap.org/way/1147872445)
- [Wooded area — way 948916945](https://www.openstreetmap.org/way/948916945)
- [Qingfeng Park — relation 15507174](https://www.openstreetmap.org/relation/15507174)
- [Xiaozhuang bus depot — way 1293621427](https://www.openstreetmap.org/way/1293621427): parking with `bus=yes`; avoid a small-car lot template.
- [Whole Beijing CBD commercial context — way 1197842042](https://www.openstreetmap.org/way/1197842042): about 3.6 km² full polygon, spanning the tile. This is a context boundary, not one enormous forecourt.

## Data and classifier contract

`public/data/landscape-details.json` retains standard Overpass `elements`: `type`, `id`, `tags`, `nodes`, `geometry`, and relation `members` with `role` and full geometry. Tags are not rewritten, shapes are not synthesized, and geometry is not clipped to the query bbox. Metadata records the exact query/endpoint/time, attribution/license, source snapshot SHA-256 hashes, deduplication policy and before/after statistics. Merge it with existing extracts by `type:id`.

`src/landscape-tags.js` exports:

- `isSurfaceLandscape(tags)`: conservative policy for this engine's flat ground; rejects buildings/parts, underground, roof, indoor, bridge/tunnel, multi-storey parking, nonzero level/layer, and explicit elevated starts. Nonzero layer is a rendering exclusion, not an inferred physical height.
- `classifyLandscape(tags)`: returns `lawn`, `wood`, `garden`, `park`, `plaza`, `parking`, `sport`, `construction`, `soil`, or `null`. It applies `isSurfaceLandscape` first. Call it only for polygon features.
- `classifyLandscapeContext(tags)`: returns `commercial`, `residential`, `retail`, `railway`, `industrial`, or `null`. Context does not create a physical ground fill.

Tag precedence reserves water/fountains/wetlands, construction, parking and pitches before generic green tags. Flowerbed/shrubbery/scrub use the low garden template; wood/forest/tree landcover use woodland. A lawn does not imply trees. A park is a venue boundary that can contain pitches, water and paths, not homogeneous lawn. Greenfield/brownfield tags alone do not establish a surface material, and the classifier leaves them unresolved.

The 48 new objects classify into **23 explicit ground templates + 24 context areas + 1 fountain reserved for water rendering** before bbox clipping. The base additionally contributes the previously ignored four plazas. The renderer must subtract building footprints, road/sidewalk corridors, water, and higher-priority mapped surfaces before placing inferred greenery. Public-access inference must not overwrite `access=private`.

## Primary tag references

OSM [landcover](https://wiki.openstreetmap.org/wiki/Key:landcover) describes physical ground coverage; [commercial landuse](https://wiki.openstreetmap.org/wiki/Tag:landuse=commercial) describes office/service use. These serve different purposes.

The [grass documentation](https://wiki.openstreetmap.org/wiki/Tag:landuse=grass) describes managed grass and distinguishes it from woodland, gardens and sports areas. [Scrub](https://wiki.openstreetmap.org/wiki/Tag:natural=scrub) and [flowerbed](https://wiki.openstreetmap.org/wiki/Tag:landuse=flowerbed) support low vegetation rather than automatically adding tall trees.

[Pedestrian areas](https://wiki.openstreetmap.org/wiki/Tag:highway=pedestrian) use `area=yes` for plazas. [Parking](https://wiki.openstreetmap.org/wiki/Tag:amenity=parking) documents surface as the unspecified default and distinguishes multi-storey/underground forms. [Pitches](https://wiki.openstreetmap.org/wiki/Tag:leisure=pitch) use sport and surface tags and can also be indoors. [Construction](https://wiki.openstreetmap.org/wiki/Tag:landuse=construction) identifies land under construction, which may later need rechecking.

[Multipolygon relations](https://wiki.openstreetmap.org/wiki/Relation:multipolygon) define complex boundaries with outer and inner member rings. Preserving members/roles prevents filling courtyards and water holes. [Location](https://wiki.openstreetmap.org/wiki/Key:location) and [level](https://wiki.openstreetmap.org/wiki/Key:level) supply vertical context.

## Validation performed

- `python -m py_compile scripts/fetch_landscape_details.py` and CLI `--help` passed.
- Actual network fetch completed successfully with validated complete geometry.
- Checked source hashes, unique `type:id`, exact query reproduction, bounded bbox guards, and rejection of missing inner-member geometry.
- `node --test test/landscape-tags.test.js`: 4/4 passed, including actual CBD plazas, multi-storey parking buildings, sports areas, flowerbed/wood, and the large CBD context boundary.
