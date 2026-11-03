import { InkRenderer } from '../../src/ink-renderer.js';
import { installFacadeShader, facadeAttributeDefaults } from '../../src/facade-shader.js';
const modes = ['comic', 'line', 'color', 'white'];
export const fixtureStyleApi = {
  getStyle(id) { return modes.includes(id) ? { id } : null; },
  bindSceneStyle(group, { shared }) {
    group.traverse(object => {
      if (object.userData.generatedFacade) for (const material of [object.material].flat().filter(Boolean)) {
        material.defaultAttributeValues = { ...material.defaultAttributeValues, ...facadeAttributeDefaults };
        material.onBeforeCompile = shader => installFacadeShader(shader, shared);
        material.customProgramCacheKey = () => 'runtime-fixture-facade-v1'; material.needsUpdate = true;
      }
    });
    return { dispose() {} };
  },
  createStylePipeline({ renderer, scene, camera, style, shared, quality }) {
    const ink = new InkRenderer(renderer, scene, camera, shared); ink.material.uniforms.mode.value = modes.indexOf(style.id);
    ink.material.uniforms.aoStrength.value = quality.aoQuality > 0 ? .65 : 0;
    // The original illustration renderer remains the fixture's multipass path.
    return ink;
  },
};
