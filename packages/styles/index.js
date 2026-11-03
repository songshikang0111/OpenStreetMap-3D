import * as THREE from 'three';
export const version='1.0.0';
export const materialRoles=['wall','glass','roof','structure','road','water','foliage','ground','facility','landmark'];
export const parametersSchema={type:'object',additionalProperties:false,properties:{
  windows:{type:'number',minimum:0,maximum:1,default:1},facadeDetail:{type:'number',minimum:0,maximum:1,default:.5},
  glassReflection:{type:'number',minimum:0,maximum:1,default:.65},lineWidth:{type:'number',minimum:.1,maximum:4,default:1},
  toneSize:{type:'number',minimum:1.7,maximum:12,default:4.2},aoStrength:{type:'number',minimum:0,maximum:1,default:.65},
}};
export function createOfficialStyle(id,mode) {
  return {
    schemaVersion:1,id,version,engineCompatibility:'>=1.0.0 <2.0.0',styleContractVersion:1,
    parametersSchema,materialRoles,fallbackRole:'facility',rebuildParameters:[],qualityHints:{pixelRatio:1,shadows:true,ao:mode===0?'balanced':'low'},
    createMaterial({object,role,sourceMaterial,services,shared}) {
      if(id==='white')return new THREE.MeshStandardMaterial({color:'#e5e5df',roughness:1,side:sourceMaterial?.side??THREE.FrontSide});
      if(object.userData.city?.shader==='facade-v6')return services.createFacadeMaterial(shared,sourceMaterial);
      if(object.userData.city?.shader==='foliage-v1'||role==='foliage')return services.createFoliageMaterial(sourceMaterial);
      // Preserve vertex/instance colours, transparency, and material-specific road/foliage settings.
      const material=sourceMaterial?.clone?.()||new THREE.MeshStandardMaterial({vertexColors:!!object.geometry.attributes.color,roughness:.98});
      // Cloned maps still belong to the source, even if its prior creator marked
      // them as owned. This new binding must not inherit that ownership claim.
      delete material.userData.cityOwnedTextures;
      if(role==='water'){material.roughness=.35;material.metalness=.12;}
      return material;
    },
    createPipeline(context){return context.services.createInkPipeline({...context,mode});},
    dispose(){},
  };
}
export const officialStyles=[createOfficialStyle('comic',0),createOfficialStyle('line',1),createOfficialStyle('color',2),createOfficialStyle('white',3)];
export default officialStyles;
