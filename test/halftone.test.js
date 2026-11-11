import test from 'node:test';
import assert from 'node:assert/strict';
import { halftoneCoverage } from '../src/halftone.js';

test('increasing material darkness never turns an existing black dot into a white hole', () => {
  for (const size of [1.7, 2, 4.2, 7, 10])
    for (let x = -0.5; x <= 0.5; x += 0.025)
      for (let y = -0.5; y <= 0.5; y += 0.025) {
        let previous = 0;
        for (let d = 0; d <= 0.88; d += 0.01) {
          const value = halftoneCoverage(d, x, y, size);
          assert(value >= previous - 1e-10, 'coverage must be monotonic at every pixel, especially across .5');
          assert(value >= 0 && value <= 1);
          previous = value;
        }
      }
});

test('half-density perturbations are continuous and preserve the dot lattice phase', () => {
  let largest = 0;
  for (let x = -0.5; x <= 0.5; x += 0.01)
    for (let y = -0.5; y <= 0.5; y += 0.01) {
      const a = halftoneCoverage(0.4999, x, y),
        b = halftoneCoverage(0.5001, x, y);
      largest = Math.max(largest, Math.abs(a - b));
    }
  assert(largest < 0.001, 'subtle facade-lighting changes cannot flip a whole pixel');
  assert.equal(halftoneCoverage(0.49, 0, 0), 1);
  assert.equal(halftoneCoverage(0.51, 0, 0), 1);
  assert.equal(halftoneCoverage(0, 0, 0), 0);
});
