import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyLandscape, classifyLandscapeContext, isSurfaceLandscape } from '../src/landscape-tags.js';

test('surface parking is distinguished from underground, roof and multi-storey facilities', () => {
  assert.equal(classifyLandscape({ amenity: 'parking' }), 'parking');
  assert.equal(classifyLandscape({ amenity: 'parking', parking: 'surface', access: 'private' }), 'parking');
  for (const detail of [
    { parking: 'underground' }, { parking: 'multi-storey' }, { parking: 'rooftop' },
    { location: 'underground' }, { building: 'yes' }, { 'building:part': 'yes' },
    { level: '-1' }, { level: '2' }, { level: '0;1' }, { level: '0-3' }, { layer: '-1' },
    { indoor: 'yes' }, { min_height: '4' }, { bridge: 'yes' },
  ]) {
    assert.equal(isSurfaceLandscape({ amenity: 'parking', ...detail }), false, JSON.stringify(detail));
    assert.equal(classifyLandscape({ amenity: 'parking', ...detail }), null);
  }
  assert.equal(isSurfaceLandscape({ level: '0', layer: '0', building: 'no', indoor: 'no' }), true);
});

test('pedestrian polygons are plazas while linear roads and large commercial zones are not', () => {
  assert.equal(classifyLandscape({ highway: 'pedestrian', area: 'yes' }), 'plaza');
  assert.equal(classifyLandscape({ 'area:highway': 'footway' }), 'plaza');
  assert.equal(classifyLandscape({ place: 'square' }), 'plaza');
  assert.equal(classifyLandscape({ highway: 'pedestrian' }), null);
  assert.equal(classifyLandscape({ highway: 'service', area: 'yes', surface: 'paving_stones' }), null);
  for (const landuse of ['commercial', 'residential', 'retail', 'railway', 'industrial']) {
    assert.equal(classifyLandscape({ landuse }), null);
    assert.equal(classifyLandscapeContext({ landuse }), landuse);
  }
  assert.equal(classifyLandscapeContext({ landuse: 'residential', building: 'apartments' }), null);
});

test('landcover remains distinct from sports, water, construction and garden vegetation', () => {
  assert.equal(classifyLandscape({ leisure: 'pitch', landuse: 'grass', sport: 'soccer' }), 'sport');
  assert.equal(classifyLandscape({ natural: 'water', leisure: 'park' }), null);
  assert.equal(classifyLandscape({ amenity: 'fountain', leisure: 'garden' }), null);
  assert.equal(classifyLandscape({ landuse: 'construction', landcover: 'grass' }), 'construction');
  assert.equal(classifyLandscape({ natural: 'wood', leisure: 'park' }), 'wood');
  assert.equal(classifyLandscape({ landuse: 'flowerbed' }), 'garden');
  assert.equal(classifyLandscape({ natural: 'scrub' }), 'garden');
  assert.equal(classifyLandscape({ landcover: 'grass' }), 'lawn');
  assert.equal(classifyLandscape({ leisure: 'park' }), 'park');
  assert.equal(classifyLandscape({ natural: 'sand' }), 'soil');
  assert.equal(classifyLandscape({ landuse: 'greenfield' }), null);
  assert.equal(classifyLandscape({ leisure: 'garden', location: 'rooftop' }), null);
});

test('CBD snapshot recovers actual plazas and facilities without repainting existing parking buildings', () => {
  const read = file => JSON.parse(fs.readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8'));
  const base = read('beijing-cbd.json'), overlay = read('landscape-details.json');
  const find = id => [...base.elements, ...overlay.elements].find(e => e.id === id)?.tags;
  assert.equal(classifyLandscape(find(169560965)), null); // Actual multi-storey building.
  assert.equal(classifyLandscape(find(1022407217)), null);
  assert.equal(classifyLandscape(find(1466401953)), 'plaza');
  assert.equal(classifyLandscape(find(1559046202)), 'plaza');
  assert.equal(classifyLandscape(find(856632038)), 'parking');
  assert.equal(classifyLandscape(find(337899975)), 'sport');
  assert.equal(classifyLandscape(find(1147872445)), 'garden');
  assert.equal(classifyLandscape(find(948916945)), 'wood');
  assert.equal(classifyLandscape(find(1197842042)), null); // Whole CBD commercial boundary.
  assert.equal(classifyLandscapeContext(find(1197842042)), 'commercial');
  const baseIds = new Set(base.elements.map(e => `${e.type}:${e.id}`));
  assert.ok(overlay.elements.every(e => !baseIds.has(`${e.type}:${e.id}`)));
  assert.equal(overlay.elements.filter(e => classifyLandscape(e.tags) === 'sport').length, 8);
});
