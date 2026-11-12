// The three default looks (05 section 6), expressed only as StyleSpec data: no post-processing, usable on mobile and
// in a MapLibre layer. "multiply" keeps the generator's per-building palette and tints it by the role colour.
import { resolveStyleSpec } from './spec.js';

export const plain = {
  schemaVersion: 2,
  id: 'plain',
  name: 'Plain',
  extends: null,
  environment: {
    background: '#f2f2f0',
    fog: { start: 0.55, end: 1.0 },
    sun: { azimuth: 150, altitude: 48, color: '#ffffff', intensity: 1.15 },
    ambient: { color: '#ffffff', ground: '#e4e2dc', intensity: 0.95 },
    shadows: true,
    ambientOcclusion: 0.3,
  },
  roles: {
    wall: { color: '#f4f4f1', roughness: 0.95 },
    glass: { color: '#f4f4f1', roughness: 0.95 },
    roof: { color: '#fbfbf9', roughness: 0.95 },
    structure: { color: '#ececea' },
    facility: { color: '#e6e6e3' },
    landmark: { color: '#f4f4f1' },
    road: { color: '#e3e3e0' },
    'road.marking': { color: '#f6f6f4' },
    ground: { color: '#efefec' },
    'ground.green': { color: '#e4e9df' },
    water: { color: '#dfe5ea', roughness: 0.4 },
    foliage: { color: '#d9e0d2' },
    'foliage.trunk': { color: '#d6d2cc' },
  },
  facade: { windows: false, density: 1, nightLights: false },
  featureState: { highlight: { emissive: '#ff8a00', emissiveIntensity: 0.55 } },
  hostCompatible: true,
};

export const light = {
  schemaVersion: 2,
  id: 'light',
  name: 'Light',
  extends: null,
  environment: {
    background: '#e9eef3',
    fog: { start: 0.6, end: 1.0 },
    sun: { azimuth: 135, altitude: 42, color: '#fff6e8', intensity: 1.55 },
    ambient: { color: '#dfe9f5', ground: '#d9d3c4', intensity: 0.85 },
    shadows: true,
    ambientOcclusion: 0.38,
  },
  roles: {
    wall: { color: '#ffffff', blend: 'multiply', roughness: 0.8 },
    glass: { color: '#ffffff', blend: 'multiply', roughness: 0.76, metalness: 0.04 },
    roof: { color: '#ffffff', blend: 'multiply', roughness: 0.9 },
    structure: { color: '#ffffff', blend: 'multiply' },
    facility: { color: '#ffffff', blend: 'multiply' },
    landmark: { inherit: true },
    road: { color: '#c3c7cd', roughness: 0.95 },
    'road.marking': { color: '#fbfaf4' },
    ground: { color: '#ffffff', blend: 'multiply' },
    'ground.green': { color: '#c9dfb6' },
    water: { color: '#9ec3e4', roughness: 0.18, metalness: 0.1 },
    foliage: { color: '#8fbf7a', roughness: 0.9 },
    'foliage.trunk': { color: '#7a6450' },
  },
  facade: { windows: true, density: 1, nightLights: false },
  featureState: { highlight: { emissive: '#ffb300', emissiveIntensity: 0.6 }, hidden: { visible: false } },
  hostCompatible: true,
};

export const dark = {
  schemaVersion: 2,
  id: 'dark',
  name: 'Dark',
  extends: null,
  environment: {
    background: '#0e131a',
    fog: { start: 0.5, end: 1.0 },
    sun: { azimuth: 210, altitude: 35, color: '#9fb4d6', intensity: 0.55 },
    ambient: { color: '#3c4c66', ground: '#151a21', intensity: 0.75 },
    shadows: true,
    ambientOcclusion: 0.45,
  },
  roles: {
    wall: { color: '#5d6672', blend: 'multiply', roughness: 0.85 },
    glass: { color: '#4f5f73', blend: 'multiply', roughness: 0.6 },
    roof: { color: '#3f4650', roughness: 0.9 },
    structure: { color: '#4a4f57' },
    facility: { color: '#4a4f57' },
    landmark: { color: '#6a7480', blend: 'multiply' },
    road: { color: '#262c34' },
    'road.marking': { color: '#5a5f66' },
    ground: { color: '#1d2229' },
    'ground.green': { color: '#1f2a22' },
    water: { color: '#16304a', roughness: 0.2, metalness: 0.2 },
    foliage: { color: '#2c4632' },
    'foliage.trunk': { color: '#3a332d' },
  },
  facade: { windows: true, density: 1, nightLights: true },
  featureState: { highlight: { emissive: '#ffc04d', emissiveIntensity: 0.8 } },
  hostCompatible: true,
};

export const BUILTIN_STYLE_SPECS = { plain, light, dark };

/** A built-in style resolved with all defaults filled in. */
export function builtinStyle(id) {
  const spec = BUILTIN_STYLE_SPECS[id];
  return spec ? resolveStyleSpec(spec, BUILTIN_STYLE_SPECS) : null;
}
