// Temporary built-in looks (WP-D task D6) until the StyleSpec interpreter of WP-G. Role colours tint the generator's
// vertex colours (white keeps them), so buildings keep the phase-one facade palette.
import type { StylePack, StyleSpec } from './types.js';

export interface ResolvedStyle {
  id: string;
  background: string;
  ground: string;
  sun: number;
  ambient: number;
  foliage: string;
  roles: Record<string, { color?: string; roughness?: number; metalness?: number; opacity?: number }>;
}

export const BUILTIN_STYLES: Record<string, ResolvedStyle> = {
  light: {
    id: 'light',
    background: '#eef1f4',
    ground: '#f3f2ee',
    sun: 1.2,
    ambient: 0.9,
    foliage: '#9cc48a',
    roles: {
      wall: { color: '#ffffff' },
      glass: { color: '#dfe8f0' },
      roof: { color: '#f4f2ee' },
      water: { color: '#ffffff' },
      road: { color: '#ffffff' },
    },
  },
  plain: {
    id: 'plain',
    background: '#f2f2f2',
    ground: '#f5f5f5',
    sun: 1.1,
    ambient: 1.0,
    foliage: '#cfd8c8',
    roles: {
      wall: { color: '#ffffff' },
      glass: { color: '#ffffff' },
      roof: { color: '#ffffff' },
      structure: { color: '#ffffff' },
      facility: { color: '#ffffff' },
      landmark: { color: '#ffffff' },
      road: { color: '#e9e9e9' },
      ground: { color: '#f0f0f0' },
      water: { color: '#dde6ee' },
    },
  },
  dark: {
    id: 'dark',
    background: '#0f141a',
    ground: '#151b22',
    sun: 0.45,
    ambient: 0.45,
    foliage: '#2f4a33',
    roles: {
      wall: { color: '#59626e' },
      glass: { color: '#3e4f63' },
      roof: { color: '#4a525c' },
      structure: { color: '#4a4f57' },
      facility: { color: '#4a4f57' },
      landmark: { color: '#6a7480' },
      road: { color: '#2a3038' },
      ground: { color: '#252a31' },
      water: { color: '#1b3550' },
    },
  },
};

export function resolveStyle(style: string | StyleSpec | StylePack): ResolvedStyle {
  if (typeof style === 'string') {
    const s = BUILTIN_STYLES[style];
    if (!s)
      throw Object.assign(new Error(`Unknown style "${style}".`), {
        code: 'STYLE_UNKNOWN',
        hint: `Use one of ${Object.keys(BUILTIN_STYLES).join(', ')}.`,
      });
    return s;
  }
  const base = BUILTIN_STYLES[String((style as { extends?: unknown }).extends ?? 'light')] ?? BUILTIN_STYLES.light!;
  return { ...base, id: String(style.id) };
}
