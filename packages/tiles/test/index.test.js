import assert from 'node:assert/strict';
import test from 'node:test';
import { PACKAGE_NAME } from '../dist/index.js';

test('package entry builds and exports its identity', () => {
  assert.equal(PACKAGE_NAME, '@city-ink/tiles');
});
