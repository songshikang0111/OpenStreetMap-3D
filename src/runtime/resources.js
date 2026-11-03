// Object identity refcounts also protect assets shared by an external style pack.
// Byte figures count CPU arrays / encoded payload estimates, never actual VRAM.
export class ResourceRegistry {
  constructor() { this.refs = new Map(); }
  resources(group) {
    const found = new Set();
    group.traverse(object => {
      if (object.geometry) found.add(object.geometry);
      for (const material of [object.material].flat().filter(Boolean)) {
        found.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) found.add(value);
        for (const uniform of Object.values(material.uniforms || {})) if (uniform?.value?.isTexture) found.add(uniform.value);
      }
      if (object.isInstancedMesh) found.add(object);
    });
    return found;
  }
  retain(group) {
    const resources = this.resources(group);
    for (const resource of resources) this.refs.set(resource, (this.refs.get(resource) || 0) + 1);
    return resources;
  }
  release(resources) {
    for (const resource of resources) {
      const count = this.refs.get(resource);
      if (count > 1) this.refs.set(resource, count - 1);
      else if (count === 1) {
        this.refs.delete(resource);
        resource.dispose?.();
        if (resource.isTexture && resource.userData?.cityOwnsImage) resource.source?.data?.close?.();
      }
    }
  }
  stats() {
    let geometries = 0, textures = 0, materials = 0, geometryArrayBytes = 0;
    const arrays = new Set();
    for (const resource of this.refs.keys()) {
      if (resource.isBufferGeometry) {
        geometries++;
        for (const attribute of [...Object.values(resource.attributes), resource.index].filter(Boolean)) arrays.add(attribute.array || attribute.data?.array);
      }
      if (resource.isTexture) textures++;
      if (resource.isMaterial) materials++;
      if (resource.isInstancedMesh) { arrays.add(resource.instanceMatrix.array); if (resource.instanceColor) arrays.add(resource.instanceColor.array); }
    }
    for (const array of arrays) geometryArrayBytes += array?.byteLength || 0;
    return { geometries, textures, materials, geometryArrayBytes };
  }
}

export function measureGroup(group) {
  let triangles = 0, drawCalls = 0, nearDetails = 0;
  group.traverseVisible(object => {
    if (!object.isMesh || !object.geometry?.attributes.position) return;
    const geometry = object.geometry, count = object.isInstancedMesh ? object.count : 1;
    const vertices = geometry.index?.count || geometry.attributes.position.count;
    triangles += Math.max(0, Math.min(geometry.drawRange.count, vertices - geometry.drawRange.start)) / 3 * count;
    if (count > 0) drawCalls += Array.isArray(object.material) ? geometry.groups.length : 1;
    if (object.userData.city?.lodRole === 'detail' || object.userData.city?.lodRole === 'near') nearDetails += count;
  });
  return { triangles, drawCalls, nearDetails };
}
