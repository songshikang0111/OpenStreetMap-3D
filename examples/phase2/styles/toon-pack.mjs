// A custom code style pack for createMap, written outside the City Ink sources: it only uses the Three.js namespace
// it is given and the StylePack contract (05 section 8). Usage:
//   import * as THREE from 'three';
//   import toonPack from './toon-pack.mjs';
//   const pack = toonPack(THREE);
//   const map = await createMap({ container, tiles, style: pack });
export default function toonPack(THREE) {
  const ramp = new Uint8Array([70, 150, 225, 255]);
  const loaded = new Set();
  const colors = { water: '#7fb2d8', foliage: '#6fae5a', road: '#9aa0a6', ground: '#e9e4d8' };
  return {
    id: 'toon-example',
    version: '1.0.0',
    supportsTiles: true,
    hostCompatible: true,
    parametersSchema: { type: 'object', additionalProperties: false, properties: {} },
    /** Tiles currently loaded, maintained by the streaming hooks. */
    loaded,
    createMaterial({ role, object }) {
      const gradientMap = new THREE.DataTexture(ramp.slice(), 4, 1, THREE.RedFormat);
      gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
      gradientMap.needsUpdate = true;
      const base = role.split('.')[0];
      const material = new THREE.MeshToonMaterial({
        gradientMap,
        vertexColors: Boolean(object.geometry?.attributes?.color) && !colors[base],
        color: colors[base] ?? '#ffffff',
      });
      // The map releases these textures together with the material.
      material.userData.cityOwnedTextures = ['gradientMap'];
      return material;
    },
    onTileLoad({ tile }) {
      loaded.add(tile);
    },
    onTileUnload({ tile }) {
      loaded.delete(tile);
    },
  };
}
