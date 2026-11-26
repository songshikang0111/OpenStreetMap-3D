// Runnable counterparts of docs/extensions.md "添加画风 · 瓦片模式". Compiled by `npm run test:types`.
import { createMap, validateStyleSpec } from '@city-ink/map';
import type { CityMap, StyleSpec } from '@city-ink/map';
import { comic, cel } from '@city-ink/styles-ink';
import * as THREE from 'three';
import toonPack from './toon-pack.mjs';

const tiles = './tiles/beijing-cbd-grow-9/tileset.json';

/** 1. A StyleSpec file: only colours, light and rules; no shader code. */
export async function withSpec(container: HTMLElement): Promise<CityMap> {
  const spec = (await fetch('./brand.json').then((r) => r.json())) as StyleSpec;
  const check = validateStyleSpec(spec);
  if (!check.valid) throw new Error(check.errors.map((e) => `${e.path} ${e.message}`).join('\n'));
  const map = await createMap({ container, tiles, style: spec });
  await map.setStyle('dark'); // built-in ids: plain, light, dark
  map.setFilter({ buildings: { minHeightProvenance: 'observed' }, details: false });
  return map;
}

/** 2. The phase-one ink looks, imported explicitly (not part of the default createMap bundle). */
export async function withInk(container: HTMLElement): Promise<CityMap> {
  const map = await createMap({ container, tiles, style: comic });
  await map.setStyle(cel);
  return map;
}

/** 3. A custom code pack with streaming hooks. */
export async function withPack(container: HTMLElement): Promise<CityMap> {
  const pack = toonPack(THREE);
  const map = await createMap({ container, tiles, style: pack });
  await map.whenIdle();
  console.log('tiles drawn by the pack', pack.loaded.size);
  return map;
}
