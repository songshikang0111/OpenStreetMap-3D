import * as THREE from 'three';
import {officialStyles} from '../../packages/styles/index.js';
import {installFacadeShader,facadeAttributeDefaults} from '../facade-shader.js';
import {InkRenderer} from '../ink-renderer.js';
import {foliageMaterial} from '../foliage.js';
import {satisfies,versionTuple} from '../generators/compatibility.js';

export const STYLE_CONTRACT_VERSION=1;
const styles=new Map();
const bindings=new WeakMap(),styleReferences=new WeakMap();
function acquireStyle(style){styleReferences.set(style,(styleReferences.get(style)||0)+1);let released=false;return ()=>{if(released)return;released=true;const count=styleReferences.get(style)-1;styleReferences.set(style,count);if(count===0)style.dispose();};}
export function validateStyle(style) {
  if(style?.schemaVersion!==1||style.styleContractVersion!==1)throw new TypeError('Unsupported style schema/contract version');
  if(typeof style.id!=='string'||!style.id)throw new TypeError('Style id is required');
  versionTuple(style.version);
  if(!satisfies('1.0.0',style.engineCompatibility))throw new TypeError(`Style ${style.id} is incompatible`);
  if(typeof style.createMaterial!=='function'||typeof style.createPipeline!=='function'||typeof style.dispose!=='function')throw new TypeError('Style requires createMaterial/createPipeline/dispose');
  if(!Array.isArray(style.materialRoles)||style.materialRoles.some(r=>typeof r!=='string'||!r)||!style.materialRoles.includes(style.fallbackRole)||!Array.isArray(style.rebuildParameters)||style.rebuildParameters.some(r=>typeof r!=='string')||!style.qualityHints||typeof style.qualityHints!=='object'||Array.isArray(style.qualityHints))throw new TypeError('Style roles, fallbackRole, rebuildParameters and qualityHints required');
  if(style.parametersSchema?.type!=='object'||style.parametersSchema.additionalProperties!==false||!style.parametersSchema.properties||typeof style.parametersSchema.properties!=='object'||Array.isArray(style.parametersSchema.properties))throw new TypeError('Style parametersSchema must be a closed object with properties');
  return style;
}
export function registerStyle(style){validateStyle(style);styles.set(style.id,style);return style;}
for(const style of officialStyles)registerStyle(style);
export function getStyle(id='comic'){const style=typeof id==='string'?styles.get(id):validateStyle(id);if(!style)throw new TypeError(`Unknown style: ${id}`);return style;}
function resolveStyle(selection) {
  const style=getStyle(selection&&typeof selection==='object'&&typeof selection.createMaterial!=='function'?selection.id:selection||'comic');
  const given=selection?.parameters||{},parameters={};
  for(const key of Object.keys(given))if(!Object.hasOwn(style.parametersSchema.properties||{},key))throw new TypeError(`Unknown style parameter: ${key}`);
  for(const [key,rule] of Object.entries(style.parametersSchema.properties||{})){
    const value=given[key]??rule.default;
    if(value===undefined)continue;
    if((rule.type==='number'&&(!Number.isFinite(value)||value< (rule.minimum??-Infinity)||value>(rule.maximum??Infinity)))||(rule.type==='boolean'&&typeof value!=='boolean')||(rule.type==='string'&&typeof value!=='string')||(rule.enum&&!rule.enum.includes(value)))throw new TypeError(`Invalid style parameter ${key}`);
    parameters[key]=value;
  }
  return {style,parameters};
}
export function createStyleShared(values={}) {
  const defaults={windows:1,provenance:0,facadeDetail:.5,glassReflection:.65,toneSize:4.2,sunDirection:new THREE.Vector3(.5,.707,-.5),projectionScale:1000};
  return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,values[key]&&Object.hasOwn(values[key],'value')?values[key]:{value:values[key]??value}]));
}
export function createFacadeMaterial(shared,source) {
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.76,metalness:.04,side:source?.side??THREE.FrontSide});
  material.defaultAttributeValues={...material.defaultAttributeValues,...facadeAttributeDefaults};
  material.onBeforeCompile=shader=>installFacadeShader(shader,shared);
  material.customProgramCacheKey=()=> 'city-ink-facade-v6-materials';
  return material;
}
export function createFoliageMaterial(source) {
  const material=foliageMaterial(source?.color?.isColor?source.color:'#ffffff');
  if(source?.isMeshStandardMaterial){const compile=material.onBeforeCompile,key=material.customProgramCacheKey;material.copy(source);material.onBeforeCompile=compile;material.customProgramCacheKey=key;}
  else if(source)for(const key of ['side','transparent','opacity','alphaTest','depthWrite','depthTest','map'])if(source[key]!==undefined)material[key]=source[key];
  delete material.userData.cityOwnedTextures;
  return material;
}
/** Adapt legacy objects once. Core codecs should preserve this data, not infer it on load. */
export function annotateSceneSemantics(group) {
  group.traverse(o=>{
    if(!o.isMesh||o.userData.city)return;
    const f=o.userData.feature;
    let node=o, inkClass;
    while(node&&!Number.isFinite(inkClass)){inkClass=node.userData.inkClass;node=node.parent;}
    const kind=Math.floor(inkClass||4),role=f?'wall':kind===2?'foliage':kind===3?'road':kind===6?'water':kind===5?'ground':'facility';
    o.userData.city={schemaVersion:1,featureId:f?String(f.id):`generated:${o.name}`,sourceIds:f?[`${f.osmType}/${f.osmId}`]:[],kind:f?'building':role,materialRole:role,lodRole:'body',inkClass:inkClass??4,
      ...(o.userData.generatedFacade?{shader:'facade-v6'}:role==='foliage'?{shader:'foliage-v1'}:{}),...(f?{height:f.height,minHeight:f.minHeight,heightSource:f.source}:{})};
  });
  return group;
}
const services={createFacadeMaterial,createFoliageMaterial,createInkPipeline({renderer,scene,camera,shared,mode,parameters}){
  const ink=new InkRenderer(renderer,scene,camera,shared);ink.material.uniforms.mode.value=mode;
  for(const [key,value] of Object.entries(parameters))if(ink.material.uniforms[key])ink.material.uniforms[key].value=value;
  return {render:()=>ink.render(),resize:(w,h)=>ink.resize(w,h),dispose:()=>ink.dispose(),ink};
}};
function disposeMaterial(material) {
  for(const key of material.userData.cityOwnedTextures||[])material[key]?.dispose();
  material.dispose();
}
/** Restores procedural shaders after decoding. Owns only materials it creates, never geometry. */
export function bindSceneStyle(group,{style:selection='comic',shared:createShared}={}) {
  const {style,parameters}=resolveStyle(selection),shared=createStyleShared(createShared);
  const previous=bindings.get(group);previous?.dispose();
  const changes=[],owned=new Set(),diagnostics=[];
  try {
    for(const [key,value] of Object.entries(parameters))if(shared[key])shared[key].value=value;
    group.traverse(object=>{
      if(!object.isMesh)return;
      const semantic=object.userData.city;
      if(!semantic?.materialRole)throw new TypeError(`Missing userData.city.materialRole on ${object.name}`);
      if(semantic.schemaVersion!==1)throw new TypeError('Unsupported city material semantic version');
      if(semantic.shader&&!['facade-v6','foliage-v1'].includes(semantic.shader))throw new TypeError(`Unsupported procedural shader ${semantic.shader}`);
      if(semantic.shader==='facade-v6') {
        for(const [name,size] of Object.entries({aFacade:4,aStyle:2,aLayout:4,aSurface:2,objectId:3})){
          const attr=object.geometry.attributes[name];
          if(!attr)throw new TypeError(`Missing procedural attribute ${name} on ${object.name}`);
          if(attr.itemSize!==size||attr.count!==object.geometry.attributes.position?.count)throw new TypeError(`Invalid procedural attribute ${name} on ${object.name}`);
        }
        object.userData.generatedFacade=true;
      }
      object.userData.inkClass=semantic.inkClass??object.userData.inkClass;
      const original=object.material;
      // Role groups are optional: a single semantic role is sufficient for unbatched meshes.
      const roles=object.geometry.userData.city?.materialRoles;
      if(roles!==undefined){
        const groups=object.geometry.groups,total=object.geometry.index?.count??object.geometry.attributes.position?.count;
        if(!Array.isArray(roles)||!roles.length||roles.some(r=>typeof r!=='string'||!r)||!groups.length)throw new TypeError(`Invalid material role table on ${object.name}`);
        let end=0;
        for(const part of [...groups].sort((a,b)=>a.start-b.start)){
          if(!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.count)||part.count<=0||part.start!==end||!Number.isSafeInteger(part.materialIndex)||part.materialIndex<0||part.materialIndex>=roles.length)throw new TypeError(`Invalid material role group on ${object.name}`);
          end=part.start+part.count;
        }
        if(end!==total)throw new TypeError(`Material role groups do not cover geometry on ${object.name}`);
      }
      const multi=roles?.length && object.geometry.groups.length;
      const create=(role,index)=>{
        if(!style.materialRoles.includes(role)){diagnostics.push({code:'STYLE_ROLE_FALLBACK',stage:'style',featureId:semantic.featureId,message:`${role} uses ${style.fallbackRole}`});role=style.fallbackRole;}
        const sourceMaterial=Array.isArray(original)?original[index]||original[0]:original;
        const material=style.createMaterial({object,role,semantic,shared,parameters,sourceMaterial,services});
        if(!material?.isMaterial||material===sourceMaterial)throw new TypeError('Style createMaterial must return an owned Three.js Material');
        owned.add(material);return material;
      };
      changes.push({object,original});object.material=multi?roles.map(create):create(semantic.materialRole,0);
    });
  }catch(e){for(const c of changes)c.object.material=c.original;owned.forEach(disposeMaterial);throw e;}
  let disposed=false;const release=acquireStyle(style);
  const binding={style,shared,parameters,diagnostics,dispose(){if(disposed)return;disposed=true;for(const c of changes)c.object.material=c.original;owned.forEach(disposeMaterial);release();if(bindings.get(group)===binding)bindings.delete(group);}};
  bindings.set(group,binding);return binding;
}
export function createStylePipeline({renderer,scene,camera,style:selection='comic',shared:createShared}={}) {
  const {style,parameters}=resolveStyle(selection),shared=createStyleShared(createShared);
  for(const [key,value] of Object.entries(parameters))if(shared[key])shared[key].value=value;
  const pipeline=style.createPipeline({renderer,scene,camera,style,shared,parameters,services});
  if(!pipeline||['render','resize','dispose'].some(key=>typeof pipeline[key]!=='function'))throw new TypeError('Style pipeline requires render/resize/dispose');
  let disposed=false;const release=acquireStyle(style);
  return {...pipeline,style,shared,render(){if(!disposed)pipeline.render();},resize(w,h){if(!disposed)pipeline.resize(w,h);},dispose(){if(disposed)return;disposed=true;try{pipeline.dispose();}finally{release();}}};
}
