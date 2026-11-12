export type Provenance = 'observed' | 'derived' | 'inferred';
export type Color = string;
export type Expression = string | number | boolean | null | [string, ...unknown[]];

export interface RoleStyle {
  color?: Color;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  reflectivity?: number;
  emissive?: Color;
  emissiveIntensity?: number;
  /** "replace" (default): the role colour replaces generator colours; "multiply": it tints them. */
  blend?: 'replace' | 'multiply';
  /** Keep generator colours unchanged (same as blend "multiply" with white). */
  inherit?: boolean;
}

export interface StyleRule {
  layer: string;
  when: Expression;
  set: Record<string, { color?: Color; opacity?: number }>;
}

export interface StyleSpec {
  $schema?: string;
  schemaVersion: 2;
  id: string;
  name?: string;
  extends?: 'plain' | 'light' | 'dark' | null;
  environment?: {
    background?: Color;
    fog?: { color?: Color; start?: number; end?: number } | null;
    sun?: { azimuth?: number; altitude?: number; color?: Color; intensity?: number };
    ambient?: { color?: Color; ground?: Color; intensity?: number };
    shadows?: boolean;
    /** Contact darkening at the foot of walls, 0..1 (no post-processing). */
    ambientOcclusion?: number;
  };
  roles?: Record<string, RoleStyle>;
  facade?: { windows?: boolean; density?: number; nightLights?: boolean };
  rules?: StyleRule[];
  featureState?: {
    highlight?: { emissive?: Color; emissiveIntensity?: number };
    hidden?: { visible?: boolean };
  };
  hostCompatible?: boolean;
}

export interface ResolvedStyleSpec {
  schemaVersion: 2;
  id: string;
  name: string;
  extends: string | null;
  environment: {
    background: Color;
    fog: { color: Color | null; start: number; end: number } | null;
    sun: { azimuth: number; altitude: number; color: Color; intensity: number };
    ambient: { color: Color; ground: Color; intensity: number };
    shadows: boolean;
    ambientOcclusion: number;
  };
  roles: Record<string, RoleStyle>;
  facade: { windows: boolean; density: number; nightLights: boolean };
  rules: StyleRule[];
  featureState: {
    highlight: { emissive: Color; emissiveIntensity: number };
    hidden: { visible: boolean };
  };
  hostCompatible: boolean;
}

export interface StyleError {
  /** JSONPath-like location, e.g. "$.roles.wall.color". */
  path: string;
  message: string;
}

export const STYLE_SPEC_VERSION: 2;
export const ROLES: string[];
export const SUB_ROLES: string[];
export const PROVENANCE: Provenance[];
export const EXPRESSION_OPERATORS: string[];
export function isColor(value: unknown): boolean;
export function isRoleName(name: unknown): boolean;
export function validateStyleSpec(spec: unknown, options?: { builtins?: string[] }): { valid: boolean; errors: StyleError[] };
export function checkExpression(expr: unknown, path: string, errors: { add(path: string, message: string): void }): void;
export function evaluateExpression(
  expr: Expression,
  feature: { properties?: Record<string, unknown>; provenance?: Record<string, string> },
): unknown;
export function resolveStyleSpec(spec: StyleSpec, builtins: Record<string, StyleSpec>): ResolvedStyleSpec;
export function roleStyle(resolved: ResolvedStyleSpec, role: string): RoleStyle;
export function ruleRoleApplies(key: string, role: string): boolean;
