/** Installs the phase-one procedural facade shader (windows, finishes, glass) into a MeshStandardMaterial shader. */
export function installFacadeShader(
  shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string },
  shared: Record<string, { value: unknown }>,
  lightOnly?: boolean,
): void;
/** Tile-mode additions: contact darkening, night lights, no ink alpha. */
export function extendFacadeShader<T extends { uniforms: Record<string, unknown>; fragmentShader: string }>(
  shader: T,
  uniforms: Record<string, { value: unknown }>,
): T;
export const facadeAttributeDefaults: Record<string, number[]>;
