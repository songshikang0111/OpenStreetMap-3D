/** Package identity, used by diagnostics and tooling. */
export const PACKAGE_NAME = '@city-ink/map';

export { createMap, RUNTIME_VERSION, QUALITY_BUDGETS } from './map.js';
export { Transform, DEFAULT_FOV, TILE_SIZE } from './transform.js';
export { selectTiles } from './selection.js';
export { BUILTIN_STYLES } from './styles.js';
export type * from './types.js';
