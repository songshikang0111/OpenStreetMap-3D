import {MeshStandardMaterial} from 'three';
// A project-owned style: no changes to city core, geometry or downloaded data.
const colors={wall:'#c0a77a',glass:'#8b9a95',roof:'#a78662',structure:'#777267',road:'#b5afa0',water:'#91aaa4',foliage:'#7d8e66',ground:'#d7cfb5',facility:'#82796a',landmark:'#b59e74'};
export default {
  schemaVersion:1,id:'project-sepia',version:'1.0.0',engineCompatibility:'>=1.0.0 <2.0.0',styleContractVersion:1,
  parametersSchema:{type:'object',additionalProperties:false,properties:{}},
  materialRoles:Object.keys(colors),fallbackRole:'facility',rebuildParameters:[],qualityHints:{pixelRatio:1,shadows:true,ao:'low'},
  createMaterial({role,sourceMaterial}) {return new MeshStandardMaterial({color:colors[role] || colors.facility,roughness:.92,side:sourceMaterial?.side});},
  createPipeline(context){return context.services.createInkPipeline({...context,mode:2,parameters:{}});},
  dispose(){},
};
