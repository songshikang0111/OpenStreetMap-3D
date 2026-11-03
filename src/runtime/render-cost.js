import { DoubleSide, Frustum, Matrix4, Sphere } from 'three';

export function renderProfile(pipeline, shadows) {
  const ink = pipeline?.ink, ao = ink?.aoEnabled !== false;
  return { scenePasses: ink ? (ink.material.uniforms.mode.value === 0 ? 4 : 3) : 1,
    colorPasses: ink?.material.uniforms.mode.value === 3 ? 0 : 1,
    shadowPasses: shadows ? 1 : 0, fixedCalls: ink ? (ao ? 3 : 2) : 0,
    fixedTriangles: ink ? (ao ? 6 : 4) : 0 };
}

// Cache numbers and spheres, never renderer resources. The bounds match Three's
// object frustum test (including aggregate InstancedMesh bounding spheres).
export function collectDrawUnits(group) {
  const visible = group.visible; group.visible = true;
  group.updateMatrixWorld(true);
  const units = [];
  group.traverseVisible(object => {
    if (!object.isMesh || !object.geometry?.attributes.position) return;
    const geometry = object.geometry, instances = object.isInstancedMesh ? object.count : 1;
    if (!instances) return;
    if (object.boundingSphere !== undefined) { if (!object.boundingSphere) object.computeBoundingSphere(); }
    else if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = (object.boundingSphere || geometry.boundingSphere).clone().applyMatrix4(object.matrixWorld);
    const count = geometry.index?.count ?? geometry.attributes.position.count;
    const start = geometry.drawRange.start, end = Math.min(count, start + geometry.drawRange.count);
    const groups = Array.isArray(object.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    let triangles = 0, drawCalls = 0, colorExtraTriangles = 0, colorExtraCalls = 0;
    for (const range of groups) {
      const material = Array.isArray(object.material) ? object.material[range.materialIndex] : object.material;
      if (!material?.visible) continue;
      const vertices = Math.max(0, Math.min(end, range.start + range.count) - Math.max(start, range.start));
      if (!vertices) continue;
      const tris = vertices / 3 * instances;
      triangles += tris; drawCalls++;
      if (material.transparent && material.side === DoubleSide && !material.forceSinglePass) { colorExtraTriangles += tris; colorExtraCalls++; }
    }
    units.push({ sphere, triangles, drawCalls, colorExtraTriangles, colorExtraCalls, castShadow: object.castShadow, layers: object.layers.mask, frustumCulled: object.frustumCulled });
  });
  group.visible = visible; return units;
}

// Learn pass topology even for external pipelines while the empty scene loads.
// This counts render calls, never divides one geometry's cost by another's.
export function renderWithProfile(renderer, pipeline, scene, camera, shadows) {
  const original = renderer.render, profile = { scenePasses: 0, colorPasses: 0, shadowPasses: 0, fixedCalls: 0, fixedTriangles: 0 };
  renderer.render = function(object, view, ...args) {
    const city = object === scene && view === camera;
    if (city) {
      profile.scenePasses++;
      if (!scene.overrideMaterial) profile.colorPasses++;
      if (shadows && renderer.shadowMap.autoUpdate) profile.shadowPasses++;
    }
    const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
    const result = original.call(this, object, view, ...args);
    if (!city) { profile.fixedCalls += renderer.info.render.calls - calls; profile.fixedTriangles += renderer.info.render.triangles - triangles; }
    return result;
  };
  try { pipeline.render(); } finally { renderer.render = original; }
  return profile;
}

export function costContext(camera, profile, sun) {
  camera.updateMatrixWorld(true);
  const view = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  let shadow;
  if (profile.shadowPasses && sun) {
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false);
    sun.shadow.updateMatrices(sun); shadow = sun.shadow.getFrustum();
  }
  return { ...profile, view, shadow, layers: camera.layers.mask };
}

export function drawUnitCost(units, context) {
  let triangles = 0, drawCalls = 0, shadowTriangles = 0, shadowCalls = 0, extraTriangles = 0, extraCalls = 0;
  for (const unit of units) {
    if (unit.layers != null && !(unit.layers & context.layers)) continue;
    const sphere = unit.sphere?.isSphere ? unit.sphere : new Sphere();
    if (unit.frustumCulled === false || context.view.intersectsSphere(sphere)) {
      triangles += unit.triangles; drawCalls += unit.drawCalls;
      extraTriangles += unit.colorExtraTriangles || 0; extraCalls += unit.colorExtraCalls || 0;
    }
    // Unknown manifest units conservatively cast; decoded units refine this.
    if (context.shadowPasses && unit.castShadow !== false && (!context.shadow || unit.frustumCulled === false || context.shadow.intersectsSphere(sphere))) {
      shadowTriangles += unit.triangles; shadowCalls += unit.drawCalls;
    }
  }
  return { triangles, drawCalls, shadowTriangles, shadowCalls,
    frameTriangles: triangles * context.scenePasses + extraTriangles * context.colorPasses + shadowTriangles * context.shadowPasses,
    frameCalls: drawCalls * context.scenePasses + extraCalls * context.colorPasses + shadowCalls * context.shadowPasses };
}
