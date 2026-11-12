import assert from 'node:assert/strict';
import test from 'node:test';
import { PACKAGE_NAME, comic, line, color, white, cel, inkStyles } from '../dist/index.js';

test('package entry builds and exports its identity', () => {
  assert.equal(PACKAGE_NAME, '@city-ink/styles-ink');
});

test('the phase-one looks are tile-ready packs; post-processing ones are not host compatible', () => {
  for (const s of [comic, line, color, white]) {
    assert.equal(s.supportsTiles, true, s.id);
    assert.equal(s.hostCompatible, false, s.id);
    assert.equal(typeof s.createMaterial, 'function');
    assert.equal(typeof s.createPipeline, 'function');
  }
  assert.deepEqual(Object.keys(inkStyles), ['comic', 'line', 'color', 'white', 'cel']);
  assert.equal(cel.supportsTiles, true);
  assert.equal(cel.hostCompatible, true);
  assert.equal(cel.createPipeline, undefined);
});
