import type { ResolvedStyleSpec, StyleSpec } from './spec.js';
export const plain: StyleSpec;
export const light: StyleSpec;
export const dark: StyleSpec;
export const BUILTIN_STYLE_SPECS: { plain: StyleSpec; light: StyleSpec; dark: StyleSpec };
export function builtinStyle(id: string): ResolvedStyleSpec | null;
