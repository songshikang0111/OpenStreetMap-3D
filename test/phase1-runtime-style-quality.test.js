import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera } from 'three';
import { createStylePipeline } from '../src/styles/index.js';
import { applyPipelineQuality } from '../src/runtime/style-quality.js';

test('SDK quality preserves validated AO strengths and disables only the AO pass', () => {
  for (const strength of [0, .12, .9]) {
    const pipeline = createStylePipeline({ renderer: {}, scene: new Scene(), camera: new PerspectiveCamera(), style: { id: 'comic', parameters: { aoStrength: strength } } });
    for (const aoQuality of [1, 0, 2]) {
      applyPipelineQuality(pipeline, { aoQuality });
      assert.equal(pipeline.ink.material.uniforms.aoStrength.value, strength);
      assert.equal(pipeline.ink.aoEnabled, aoQuality > 0);
    }
    pipeline.dispose();
  }
});
