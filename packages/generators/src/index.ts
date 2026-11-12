/** Package identity, used by diagnostics and tooling. */
export const PACKAGE_NAME = '@city-ink/generators';

export * from './batch.js';
export * from './ids.js';
export * from './building.js';
export * from './surfaces.js';
export * from './tile.js';
export { generateStructures, quad as windQuad } from './structures.js';
