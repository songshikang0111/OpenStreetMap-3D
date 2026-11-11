// Single source of the working product names (decision D1 pending, see docs/phase2/naming.md).
// Change these together with the `name` fields of packages/*/package.json.

/** npm scope used by all phase-two packages. */
export const SCOPE = '@city-ink';

/** File extension of one encoded tile, without the dot. */
export const TILE_EXTENSION = 'c3t';

/** Four magic bytes at the start of every tile ("C3T" + 0x01 marker). */
export const TILE_MAGIC = new Uint8Array([0x43, 0x33, 0x54, 0x01]);
