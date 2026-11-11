# Notes on decoding C3T from spec section 9

Result: decoder works; 25 buildings decoded from the "building" layer.

## Ambiguities / gaps and how I resolved them

1. Section data start: spec says "8-byte header plus data, then pad to 4". I took the next section at `data + ceil4(byteLength)`. It worked (all 17 sections parsed, last is POSITIONS).
2. Layer `offset` is relative to file start (9.1 says all offsets are) and the layer header (16 bytes) begins there; first section follows at +16. Not stated explicitly for the layer, inferred.
3. Several layers could be named "building" with different encodings; I picked the one with encoding 1 (features). Not specified.
4. The order of fields in an ATTRIBUTE section: name u32, type u32, then n values (4 bytes each). I read it that way. Padding of the attribute section is covered by the byteLength rule.
5. Attribute `height` type: 9.7 says f32. I also handle i32/u32 missing sentinels as null, a guess for robustness. Missing f32 NaN -> null.
6. Height value is printed as the f32 widened to double (e.g. 165.69290161132812); the spec doesn't say to round. A comparison should use a tolerance or f32 rounding.
7. ID formatting: spec says `type/id#(k-1)`; type names for 0..3 were taken as node, way, relation, generated. Decimal 64-bit id from hi<<32|lo via BigInt (spec does not say decimal, assumed). The sample ids are large (e.g. node/515030852609#22); per spec this is correct, only odd-looking.
8. ID_SEQ section is optional? Not stated; I treat missing as "no sequence".
9. 9.6 formula `E/2` for odd E not an issue (E is a power of 2). `tx * E` uses the header x, y (not the tile coordinates from elsewhere).
10. Ring/part indexing is global (PART_START values index the global ring array, RING_START the global vertex array); inferred from the "[start, end)" wording. First ring of first part = `RING_START[PART_START[i]]`.
11. Polygon rings: whether the outline is closed (first point repeated) is not stated; I output the vertices as stored.
12. The header `headerBytes`, `directoryEntryBytes` are honoured; I did not verify `layerCount`/string-table padding because it was not needed.
13. Unspecified: whether `stringsLength` must be used (I ignored it, using offsets array only), and what to do with unknown extra sections (skipped).

## Guesses
- Decimal id string, optional-section behaviour (items 7, 8), non-f32 height fallback (item 5), picking the encoding-1 layer (item 3).
