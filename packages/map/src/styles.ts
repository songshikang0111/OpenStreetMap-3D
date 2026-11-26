// Style resolution for createMap (05): a built-in id, a StyleSpec object (validated strictly) or a code style pack
// that declares `supportsTiles: true`.
import { BUILTIN_STYLE_SPECS } from '@city-ink/styles/defaults';
import { resolveStyleSpec, validateStyleSpec } from '@city-ink/styles/spec';
import type { ResolvedStyleSpec, StyleSpec as SpecData } from '@city-ink/styles/spec';
import type { StylePack, StyleSpec } from './types.js';
import type { TileStylePack } from './tile-object.js';

/** The built-in StyleSpec documents, by id (plain, light, dark). */
export const BUILTIN_STYLES: Record<string, SpecData> = BUILTIN_STYLE_SPECS;

export interface StyleResolution {
  spec: ResolvedStyleSpec;
  pack: TileStylePack | null;
}

export class StyleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint: string,
    readonly errors: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

function isStylePack(style: StyleSpec | StylePack): style is StylePack {
  return Boolean(style && 'createMaterial' in style && typeof style.createMaterial === 'function');
}

export function resolveStyle(style: string | StyleSpec | StylePack, hosted = false): StyleResolution {
  if (typeof style === 'string') {
    const s = BUILTIN_STYLES[style];
    if (!s)
      throw new StyleError(
        'STYLE_UNKNOWN',
        `Unknown style "${style}".`,
        `Use one of ${Object.keys(BUILTIN_STYLES).join(', ')}, a StyleSpec object or an imported style pack.`,
      );
    return { spec: resolveStyleSpec(s, BUILTIN_STYLES), pack: null };
  }
  if (isStylePack(style)) {
    const pack = style;
    if (pack.supportsTiles !== true)
      throw new StyleError(
        'STYLE_UNSUPPORTED',
        `Style pack "${pack.id}" does not declare supportsTiles and cannot be used with createMap.`,
        'Use a tile-ready pack (for example from @city-ink/styles-ink) or createCityViewer for scene packages.',
      );
    if (hosted && pack.hostCompatible === false)
      throw new StyleError(
        'STYLE_NOT_HOST_COMPATIBLE',
        `Style pack "${pack.id}" needs its own post-processing and cannot draw inside a MapLibre layer.`,
        'Use plain, light, dark or another pack with hostCompatible: true in MapLibre layer mode.',
      );
    return { spec: resolveStyleSpec(BUILTIN_STYLES.light!, BUILTIN_STYLES), pack };
  }
  const result = validateStyleSpec(style);
  if (!result.valid) {
    const first = result.errors[0]!;
    throw new StyleError(
      'STYLE_INVALID',
      `Invalid style: ${first.path} ${first.message}${result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : ''}.`,
      'See schemas/style-spec.schema.json and docs/phase2/05-style-contract.md section 4.',
      result.errors,
    );
  }
  const spec = resolveStyleSpec(style, BUILTIN_STYLES);
  if (hosted && !spec.hostCompatible)
    throw new StyleError(
      'STYLE_NOT_HOST_COMPATIBLE',
      `Style "${spec.id}" declares hostCompatible: false.`,
      'Use a style with hostCompatible: true in MapLibre layer mode.',
    );
  return { spec, pack: null };
}
