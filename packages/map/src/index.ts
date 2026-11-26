/** Package identity, used by diagnostics and tooling. */
export const PACKAGE_NAME = '@city-ink/map';

export { createMap, RUNTIME_VERSION, QUALITY_BUDGETS } from './map.js';
export { Transform, DEFAULT_FOV, TILE_SIZE } from './transform.js';
export { selectTiles } from './selection.js';
export { BUILTIN_STYLES } from './styles.js';
export { validateStyleSpec } from '@city-ink/styles/spec';
export type { StyleSpec as StyleSpecDocument, ResolvedStyleSpec, StyleRule } from '@city-ink/styles/spec';
export type * from './types.js';
export { openTileArchive } from './archive.js';
