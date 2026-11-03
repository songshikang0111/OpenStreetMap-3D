// Standalone external-style example. This module imports only Three.js, never core source.
import * as THREE from 'three';
const gradient=new Uint8Array([72,148,220,255]);
export default {
  schemaVersion:1,id:'external-cel',version:'1.0.0',engineCompatibility:'>=1.0.0 <2.0.0',styleContractVersion:1,
  parametersSchema:{type:'object',additionalProperties:false,properties:{waterOpacity:{type:'number',minimum:.2,maximum:1,default:.85}}},
  materialRoles:['wall','glass','roof','structure','road','water','foliage','ground','facility','landmark'],fallbackRole:'facility',
  rebuildParameters:[],qualityHints:{pixelRatio:1,shadows:true,ao:'off'},
  createMaterial({role,object,parameters,sourceMaterial}) {
    const map=new THREE.DataTexture(gradient.slice(),4,1,THREE.RedFormat);map.minFilter=map.magFilter=THREE.NearestFilter;map.needsUpdate=true;
    const material=new THREE.MeshToonMaterial({gradientMap:map,vertexColors:!!object.geometry.attributes.color,
      color:sourceMaterial?.color?.clone()||new THREE.Color('white'),side:sourceMaterial?.side??THREE.FrontSide,
      transparent:role==='water',opacity:role==='water'?parameters.waterOpacity:1});
    // The binding owns this per-material generated texture and releases it on switching.
    material.userData.cityOwnedTextures=['gradientMap'];
    return material;
  },
  createPipeline({renderer,scene,camera}) {
    const prior=scene.fog;const fog=new THREE.Fog('#c6d7df',1800,6000);scene.fog=fog;
    return {render(){renderer.render(scene,camera);},resize(){},dispose(){if(scene.fog===fog)scene.fog=prior;}};
  },
  dispose(){},
};
