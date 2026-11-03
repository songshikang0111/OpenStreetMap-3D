import { validateSceneManifest } from './scene-manifest.js';
export { validateSceneManifest } from './scene-manifest.js';
import * as THREE from 'three';
import { parseOSM, projection } from '../osm.js';
import { buildCity } from '../city.js';
import { createLandmarkRegistry } from '../landmark-registry.js';
import { planBuildingEnvelopes } from '../building-envelope.js';
import { landmarkKind } from '../building-rules.js';
import { isNeedleCrown } from '../foliage.js';
import { validateProjectConfig } from './config.js';
import { GENERATOR_VERSION, STYLE_CONTRACT_VERSION, CityBuildError, canonicalStringify, checkCancelled, normalizeRaw, sha256 } from './contract.js';
import { decodeChunk, encodeChunk, sceneStats } from './scene-codec.js';
import { boundsOf, groundMesh, lowBuilding, partitionMesh } from './geometry.js';
import { coarseRoadGeometries } from './lod-surfaces.js';
import { batchStaticMeshes, batchTreeInstances, trunkGeometry, farCrownGeometry } from './lod-batching.js';
export { validateProjectConfig, CityBuildError };

const slug=text=>text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const sourceId=f=>`${f.osmType||'way'}/${f.osmId??f.id}`;
const normalizeSourceId=id=>String(id).replace(/^w(\d+).*$/,'way/$1').replace(/^r(\d+).*$/,'relation/$1');
const baseMaterialRoles=['unknown','wall','glass','roof','structure','road','ground','water','foliage','facility','landmark'];
const unionBounds=(a,b)=>a?[...a.slice(0,3).map((v,i)=>Math.min(v,b[i])),...a.slice(3).map((v,i)=>Math.max(v,b[i+3]))]:[...b];
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

function createGrid(bounds, tiling) {
  const [x0,z0,x1,z1]=bounds,n=tiling.divisions;
  const width=n?(x1-x0)/n:tiling.sizeMeters,depth=n?(z1-z0)/n:tiling.sizeMeters;
  const columns=n||Math.ceil((x1-x0-1e-6)/width),rows=n||Math.ceil((z1-z0-1e-6)/depth);
  if(columns*rows>4096)throw new CityBuildError('TILE_LIMIT','Project grid exceeds 4096 cells. Increase tile size.','plan');
  const cells=[];for(let z=0;z<rows;z++)for(let x=0;x<columns;x++)cells.push({id:`${x}_${z}`,bounds:[x0+x*width,z0+z*depth,Math.min(x1,x0+(x+1)*width),Math.min(z1,z0+(z+1)*depth)]});
  return {cells,columns,rows,at:(x,z)=>`${Math.max(0,Math.min(columns-1,Math.floor((x-x0)/width)))}_${Math.max(0,Math.min(rows-1,Math.floor((z-z0)/depth)))}`};
}

function cleanUserData(mesh) {
  const keep=['inkClass','generatedFacade','facadeFamily','facadeSurface','facadeGrammar','landmark','procedural','roadSurface','roadStructure','roadStairs','source','depthBoundsCoveredByBuildings','city'];
  return Object.fromEntries(keep.filter(k=>mesh.userData[k]!==undefined).map(k=>[k,mesh.userData[k]]));
}

/** Whole-region planning precedes ownership. Returned assets never write files. */
export async function compileScene(raw, inputConfig, options = {}) {
  const validation=validateProjectConfig(inputConfig);
  if(!validation.valid)throw new CityBuildError('INVALID_PROJECT_CONFIG','Project configuration is invalid.','config',{diagnostics:validation.diagnostics});
  const config=validation.value,signal=options.signal,diagnostics=[];
  const progress=async(stage,progress)=>{checkCancelled(signal);options.onProgress?.({stage,progress});await yieldTask();checkCancelled(signal);};
  await progress('parse',0);
  const normalized=normalizeRaw(raw,config),data=parseOSM(normalized,config.seed);
  for(const key of ['buildings','roads','greens','water','landscapes','landscapeContexts','trees','streetNodes','treeRows'])data[key].sort((a,b)=>String(a.id).localeCompare(String(b.id),'en'));
  if(data.stats.incompleteRelations)diagnostics.push({code:'INCOMPLETE_RELATIONS',stage:'parse',message:`${data.stats.incompleteRelations} incomplete multipolygons were omitted; missing rings were not invented.`});
  if(data.stats.invalidRings)diagnostics.push({code:'INVALID_RINGS',stage:'parse',message:`${data.stats.invalidRings} polygon relations could not be constructed.`});
  const sourceHash=await sha256(canonicalStringify(normalized)),configHash=await sha256(canonicalStringify(config));
  await progress('plan',.12);
  // Core owns async claims and validates generated bodies before partitioning.
  const landmarkRegistry=config.landmarks.enabled?(options.landmarkRegistry||createLandmarkRegistry()):null;
  const city=buildCity(data,{...config.generation,landmarks:{enabled:false}});
  const ownedGeometry=new Set(),ownedMaterial=new Set();
  const remember=group=>group.traverse(o=>{if(o.geometry)ownedGeometry.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])ownedMaterial.add(m);});
  remember(city.group);
  try {
    const featureIndex={},atomicGroups=new Map(),context={origin:config.origin,bounds:data.bounds,seed:config.seed,policy:config.landmarks.policy||'degraded',features:data.buildings,objectIds:new Map(data.buildings.map((building,index)=>[building.id,index+1]))};
    const add=(id,record)=>featureIndex[id]||=({featureId:id,sourceIds:[],kind:'generated',...record,chunkIds:[]});
    for(const b of data.buildings)add(b.id,{kind:'building',sourceIds:[sourceId(b)],provenance:{height:b.source,heightMeters:b.height,minHeightMeters:b.minHeight,tags:b.tags},anchor:[...b.center]});
    for(const r of data.roads)add(`w${r.id}`,{kind:'road',sourceIds:[`way/${r.id}`],provenance:{tags:r.tags,elevation:'rule-inferred',widthMeters:r.width}});
    for(const w of data.water)add(w.id,{kind:'water',sourceIds:w.sourceIds?.map(normalizeSourceId)||[sourceId(w)],provenance:{source:'osm',operation:'shared-region-union'}});
    const trees=city.streetlifePlan.trees;
    for(const t of trees){
      const green=t.key.match(/^green:((?:w\d+|r\d+-\d+))/),row=t.key.match(/^row:(\d+):/);
      const sourceIds=t.source==='osm'?[`node/${t.key.slice(4)}`]:t.roadId?[`way/${t.roadId}`]:green?[normalizeSourceId(green[1])]:row?[`way/${row[1]}`]:[];
      add(`tree:${t.key}`,{kind:'tree',sourceIds,anchor:[t.x,t.z],provenance:{source:t.source,seed:config.seed,ruleVersion:GENERATOR_VERSION,heightMeters:t.h,shape:t.shape,generatorKey:t.key}});}
    const registryObjects=new Set(),usedRegistries=new Set();
    if(landmarkRegistry){
      let matches=[];const claimed=new Set();
      try {matches=await landmarkRegistry.match(data.buildings,context);if(!Array.isArray(matches))throw Error('Registry match must return an array.');}
      catch(error){if(context.policy==='strict')throw error;diagnostics.push({code:'LANDMARK_MATCH_FAILED',stage:'plan',message:error.message,hint:'Retained default shapes; fix the registry matcher.'});matches=[];}
      usedRegistries.add(landmarkRegistry);
      const matchRegistry=new Map(matches.map(match=>[match,landmarkRegistry]));
      // Legacy injected match/generate adapters add rules to the official set.
      // A full C registry declares recipes (including [] to disable defaults).
      if(options.landmarkRegistry&&!Array.isArray(landmarkRegistry.recipes)){
        const official=createLandmarkRegistry(),customClaims=new Set(matches.flatMap(match=>Array.isArray(match?.claimedFeatureIds)?match.claimedFeatureIds:[]));
        for(const match of official.match(data.buildings,context))if(!match.claimedFeatureIds.some(id=>customClaims.has(id))){matches.push(match);matchRegistry.set(match,official);}
        usedRegistries.add(official);
      }
      for(const match of matches.filter(m=>{if(m&&typeof m==='object'&&typeof m.recipeId==='string')return true;if(context.policy==='strict')throw new CityBuildError('INVALID_LANDMARK_CLAIM','Ignored malformed registry match.','plan');diagnostics.push({code:'INVALID_LANDMARK_CLAIM',stage:'plan',message:'Ignored malformed registry match.'});return false;}).sort((a,b)=>`${a.recipeId}:${a.claimedFeatureIds}`.localeCompare(`${b.recipeId}:${b.claimedFeatureIds}`,'en'))){
        checkCancelled(signal);
        if(!Array.isArray(match.claimedFeatureIds)||!match.claimedFeatureIds.length||new Set(match.claimedFeatureIds).size!==match.claimedFeatureIds.length||match.claimedFeatureIds.some(id=>!featureIndex[id]||claimed.has(id))){if(context.policy==='strict')throw new CityBuildError('INVALID_LANDMARK_CLAIM',`Invalid or overlapping claim for ${match.recipeId}.`,'plan');diagnostics.push({code:'INVALID_LANDMARK_CLAIM',stage:'plan',message:`Ignored invalid or overlapping claim for ${match.recipeId}.`});continue;}
        try {
          const generated=await matchRegistry.get(match).generate(match,context);
          if(!generated.group?.isGroup)throw new Error('Generator must return a Three.js Group.');
          remember(generated.group);
          const renderable=[];generated.group.traverseVisible(m=>{if(m.isMesh&&m.geometry?.attributes.position?.count&&(!m.isInstancedMesh||m.count>0))renderable.push(m);});
          if(!renderable.length)throw new Error('Generator returned no renderable geometry.');
          for(const mesh of renderable)if(mesh.isInstancedMesh){
            const mapped=mesh.userData.city?.instanceFeatureIds|| (match.claimedFeatureIds.length===1?Array(mesh.count).fill(match.claimedFeatureIds[0]):match.claimedFeatureIds.length===mesh.count?match.claimedFeatureIds:null);
            if(!mapped||mapped.length!==mesh.count||mapped.some(id=>!match.claimedFeatureIds.includes(id)))throw new Error('Instanced generators require one claimed feature ID per instance.');
            mesh.userData.city={...mesh.userData.city,instanceFeatureIds:[...mapped]};
          }
          if(canonicalStringify([...(generated.claimedFeatureIds||[])].sort())!==canonicalStringify([...match.claimedFeatureIds].sort()))throw new Error('Generator claims must equal match claims.');
          canonicalStringify(generated.provenance||{});
          const validated=await decodeChunk(encodeChunk(generated.group));
          remember(validated);
          if(sceneStats(validated).triangles<=0)throw new Error('Generator returned no drawn triangles.');
          const ids=[...match.claimedFeatureIds].sort(),groupId=`landmark:${match.recipeId}:${ids.join(',')}`;
          atomicGroups.set(groupId,ids);
          for(const id of ids){claimed.add(id);featureIndex[id].atomicGroupId=groupId;featureIndex[id].provenance.recipeId=match.recipeId;featureIndex[id].provenance.recipeVersion=match.recipeVersion;featureIndex[id].provenance.generator=generated.provenance||{};}
          for(const mesh of city.buildings)if(ids.includes(mesh.userData.feature.id))mesh.removeFromParent();
          generated.group.traverse(mesh=>{if(mesh.isMesh){registryObjects.add(mesh);mesh.userData.city={...mesh.userData.city,featureId:mesh.userData.city?.featureId&&ids.includes(mesh.userData.city.featureId)?mesh.userData.city.featureId:ids[0],featureIds:ids,sourceIds:ids.flatMap(id=>featureIndex[id].sourceIds),kind:'building',atomicGroupId:groupId,recipeId:match.recipeId,recipeVersion:match.recipeVersion,generatorId:match.generatorId,recipeParameters:match.parameters,materialRole:mesh.userData.city?.materialRole||'structure'};}});
          city.group.add(generated.group);remember(generated.group);diagnostics.push(...(generated.diagnostics||[]),...(match.diagnostics||[]));
        }catch(error){if(context.policy==='strict')throw error;diagnostics.push({code:'LANDMARK_GENERATION_FAILED',stage:'geometry',message:`${match.recipeId}: ${error.message}`,hint:'Retained the legacy/default shape; fix or disable the supplied recipe.'});}
      }
    }
    for(const registry of usedRegistries)diagnostics.push(...(registry.diagnostics||[]));
    if(landmarkRegistry){
      const accepted=new Set(Object.values(featureIndex).filter(f=>f.provenance.recipeId).map(f=>f.featureId)),g=city.equipment.geometry,a=g.attributes.objectId;
      if(accepted.size&&a){
        const keep=[];for(let i=0;i<a.count;i+=3){const pick=Math.round(a.getX(i)*255)+(Math.round(a.getY(i)*255)<<8)+(Math.round(a.getZ(i)*255)<<16);if(!accepted.has(data.buildings[pick-1]?.id))keep.push(i,i+1,i+2);}
        const geometry=new THREE.BufferGeometry();
        for(const [name,attribute]of Object.entries(g.attributes)){const values=new attribute.array.constructor(keep.length*attribute.itemSize);for(let j=0;j<keep.length;j++)for(let k=0;k<attribute.itemSize;k++)values[j*attribute.itemSize+k]=attribute.array[keep[j]*attribute.itemSize+k];geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize,attribute.normalized));}
        geometry.computeBoundingBox();geometry.computeBoundingSphere();city.equipment.geometry=geometry;ownedGeometry.add(geometry);
      }
    }
    // Legacy official multi-part CCTV is atomic even before C is integrated.
    const cctv=city.buildings.filter(m=>m.parent&&m.userData.landmark?.kind==='cctv').map(m=>m.userData.feature.id).sort();
    if(cctv.length){atomicGroups.set('landmark:official-cctv',cctv);for(const id of cctv)featureIndex[id].atomicGroupId='landmark:official-cctv';}
    const base=groundMesh(data.bounds);remember(base);city.group.remove(city.group.children.find(o=>o.name==='Flat ground / no DEM'));city.group.add(base);
    add('ground',{kind:'ground',provenance:{model:'flat-no-dem',source:'project-area'}});
    city.group.updateMatrixWorld(true);
    const meshes=[];city.group.traverseVisible(o=>{if(o.isMesh&&o.visible&&o.geometry.attributes.position?.count&&(!o.isInstancedMesh||o.count))meshes.push(o);});
    const materialRoles=[...baseMaterialRoles,...[...new Set(meshes.flatMap(mesh=>[mesh.userData.city?.materialRole,...(mesh.geometry.userData.city?.materialRoles||[])])).values()].filter(role=>typeof role==='string'&&!baseMaterialRoles.includes(role)).sort()];
    if(materialRoles.length>256)throw new CityBuildError('MATERIAL_ROLE_LIMIT','Scene protocol v1 supports at most 256 semantic roles.','geometry');
    for(const mesh of meshes){
      const building=mesh.userData.feature,original=mesh.userData.city;
      let ids,kind,role,lodRole='body';
      const isTree=mesh.parent===city.treeGroup;
      if(building){ids=[building.id];kind='building';role=mesh.userData.facadeFamily==='curtain'?'glass':'wall';}
      else if(registryObjects.has(mesh)){ids=mesh.isInstancedMesh?original.instanceFeatureIds:original.featureIds;kind='building';role=original.materialRole;}
      else if(isTree){
        const selected=mesh.name==='Trunks'?trees:mesh.name.includes('cypress')?trees.filter(t=>t.shape==='cypress'):mesh.name.includes('conifer')?trees.filter(t=>t.shape==='conifer'):trees.filter(t=>!isNeedleCrown(t.shape));
        if(selected.length!==mesh.count)throw new CityBuildError('TREE_INSTANCE_MISMATCH',`Cannot map ${mesh.name} to shared planting plan.`,'plan');
        ids=selected.map(t=>`tree:${t.key}`);kind='tree';role=mesh.userData.inkClass===2?'foliage':'structure';
      }else if(mesh===base){ids=['ground'];kind='ground';role='ground';}
      else{
        kind=mesh.userData.roadSurface||mesh.userData.roadStructure||(mesh.userData.inkClass>=3&&mesh.userData.inkClass<4)?'road':mesh.name==='Land cover'?'water':mesh.userData.inkClass>=5?'ground':'facility';
        role=kind==='road'?'road':kind==='water'?'water':kind==='ground'?'ground':'structure';
        if(kind==='facility'||mesh===city.equipment)lodRole='detail';
        const id=`generated:${slug(mesh.name)}`;
        const sources=kind==='road'?data.roads.filter(r=>!mesh.userData.roadStructure||r.bridge).map(r=>`way/${r.id}`):kind==='water'?data.water.flatMap(w=>w.sourceIds?.map(normalizeSourceId)||[]):kind==='ground'?data.landscapes.map(sourceId):[];
        if(mesh.isInstancedMesh){
          ids=[];const m=new THREE.Matrix4();for(let i=0;i<mesh.count;i++){
            mesh.getMatrixAt(i,m);const p=new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld),instanceId=`${id}:${p.toArray().map(n=>n.toFixed(4)).join(',')}:${i}`;
            ids.push(instanceId);add(instanceId,{kind,sourceIds:sources,provenance:{source:mesh.userData.source||'rule-inferred',ruleVersion:GENERATOR_VERSION}});
          }
        }else{ids=[id];add(id,{kind,sourceIds:[...new Set(sources)].sort(),provenance:{source:mesh.userData.source||'shared-region-geometry',ruleVersion:GENERATOR_VERSION}});}
      }
      mesh.userData=cleanUserData(mesh);
      mesh.userData.city={...original,schemaVersion:1,featureId:registryObjects.has(mesh)?original.featureId:ids[0],featureIds:[...new Set(ids)].sort(),sourceIds:[...new Set(ids.flatMap(id=>featureIndex[id].sourceIds))].sort(),kind,materialRole:role,lodRole};
      if(mesh.isInstancedMesh)mesh.userData.city.instanceFeatureIds=ids;
    }
    const ids=Object.keys(featureIndex).sort();ids.forEach((id,i)=>featureIndex[id].renderId=i+1);const renderIds=[null,...ids],instanceGeometries=new Map();
    for(const mesh of meshes){
      if(mesh.geometry.index&&Array.isArray(mesh.geometry.userData.city?.materialRoles)){
        const source=mesh.geometry;mesh.geometry=source.toNonIndexed();mesh.geometry.userData=structuredClone(source.userData);
        for(const [name,attribute]of Object.entries(source.attributes))if(attribute.isInstancedBufferAttribute)mesh.geometry.setAttribute(name,attribute.clone());
        ownedGeometry.add(mesh.geometry);
      }
      if(mesh.isInstancedMesh){const source=mesh.geometry,key=`${mesh.userData.city.kind}:${mesh.userData.city.materialRole}`;if(!instanceGeometries.has(source))instanceGeometries.set(source,new Map());const cached=instanceGeometries.get(source);if(!cached.has(key)){cached.set(key,source.clone());ownedGeometry.add(cached.get(key));}mesh.geometry=cached.get(key);}
      const n=mesh.geometry.attributes.position.count,values=new Uint32Array(n).fill(mesh.isInstancedMesh?0:featureIndex[mesh.userData.city.featureId].renderId);
      if(mesh===city.equipment&&mesh.geometry.attributes.objectId){
        const a=mesh.geometry.attributes.objectId;
        for(let i=0;i<n;i++){const pick=Math.round(a.getX(i)*255)+(Math.round(a.getY(i)*255)<<8)+(Math.round(a.getZ(i)*255)<<16);const b=data.buildings[pick-1];if(b)values[i]=featureIndex[b.id].renderId;}
      }
      mesh.geometry.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(values,1));
      const roles=new Uint8Array(n).fill(materialRoles.indexOf(mesh.userData.city.materialRole));
      const authoredRoles=mesh.geometry.userData.city?.materialRoles;
      if(Array.isArray(authoredRoles)){
        for(const part of mesh.geometry.groups){const role=materialRoles.indexOf(authoredRoles[part.materialIndex]);for(let i=part.start;i<Math.min(n,part.start+part.count);i++)roles[i]=role;}
      }else if(mesh.userData.city.kind==='building'&&mesh.geometry.attributes.normal){const normal=mesh.geometry.attributes.normal;for(let i=0;i<n;i++)if(normal.getY(i)>.5)roles[i]=3;else if(normal.getY(i)<-.5)roles[i]=4;}
      mesh.geometry.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute(roles,1));mesh.userData.city.materialRoleTable=materialRoles;mesh.userData.city.materialRoleAttribute='cityMaterialRole';
      if(mesh.isInstancedMesh){
        const box=new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position),matrix=new THREE.Matrix4();
        for(let i=0;i<mesh.count;i++){
          mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);const b=box.clone().applyMatrix4(matrix),id=mesh.userData.city.instanceFeatureIds[i];
          featureIndex[id].bounds=unionBounds(featureIndex[id].bounds,[...b.min.toArray(),...b.max.toArray()]);
        }
      }else for(const id of mesh.userData.city.featureIds)featureIndex[id].bounds=unionBounds(featureIndex[id].bounds,boundsOf(mesh));
    }
    const grid=createGrid(data.bounds,config.tiling),owners=new Map();
    for(const [id,f]of Object.entries(featureIndex))if(f.anchor)owners.set(id,grid.at(...f.anchor));
    for(const [groupId,members]of atomicGroups){
      let b;for(const id of members)if(featureIndex[id].bounds)b=unionBounds(b,featureIndex[id].bounds);
      if(!b)continue;const owner=grid.at((b[0]+b[3])/2,(b[2]+b[5])/2);
      for(const id of members){owners.set(id,owner);featureIndex[id].atomicGroupId=groupId;featureIndex[id].ownerChunk=owner;}
    }
    for(const [id,owner]of owners)featureIndex[id].ownerChunk=owner;
    await progress('geometry',.4);
    const levels=[{id:'low',level:0,geometricError:12,maxScreenSpaceError:3,description:'Batched silhouettes (footprint error <=0.15m), 4-face crowns/4-face trunks, continuous road/bridge envelopes. Inferred margins and lane paint remain in higher levels; far casters disabled.'},{id:'medium',level:1,geometricError:1,maxScreenSpaceError:2,description:'Batched original building bodies; 80-face crowns; continuous bridge/step envelopes, unchanged road/paint coverage.'},{id:'high',level:2,geometricError:0,maxScreenSpaceError:0,description:'Original building geometry with roof equipment and inferred street furnishings.'}];
    const assets={},chunkMap=new Map(grid.cells.map(c=>[c.id,{id:c.id,bounds:[c.bounds[0],0,c.bounds[1],c.bounds[2],0,c.bounds[3]],contentBounds:null,transform:identity,lods:[]}])) ;
    const lowMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9});ownedMaterial.add(lowMaterial);
    const lowGeometries=new Map(),envelopes=planBuildingEnvelopes(data.buildings,{exclude:b=>!!featureIndex[b.id].provenance.recipeId||config.landmarks.enabled&&!!landmarkKind(b)});
    for(const mesh of meshes)if(mesh.userData.city.kind==='building'&&(!registryObjects.has(mesh)||['city-ink/china-zun','city-ink/cctv'].includes(mesh.userData.city.generatorId))){
      const b=data.buildings.find(b=>b.id===mesh.userData.city.featureId);if(!b)continue;
      const low=lowBuilding(b,lowMaterial,!!mesh.userData.city.generatorId,mesh.userData.city.recipeParameters,envelopes.get(b.id)),g=low.geometry,n=g.attributes.position.count;
      g.deleteAttribute('uv');const encoded=mesh.geometry.attributes.objectId,objectCode=encoded?[encoded.getX(0),encoded.getY(0),encoded.getZ(0)]:[0,0,0];g.setAttribute('objectId',new THREE.Float32BufferAttribute(Array.from({length:n},()=>objectCode).flat(),3));
      const color=mesh.geometry.attributes.color,c=new THREE.Color();if(color?.count)c.fromBufferAttribute(color,0);else c.copy(mesh.material.color||new THREE.Color('#c7c7be'));
      g.setAttribute('color',new THREE.Float32BufferAttribute(Array.from({length:n},()=>c.toArray()).flat(),3));g.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(n).fill(featureIndex[b.id].renderId),1));
      const roles=new Uint8Array(n).fill(materialRoles.indexOf(mesh.userData.city.materialRole));for(let i=0;i<n;i++)if(g.attributes.normal.getY(i)>.5)roles[i]=3;else if(g.attributes.normal.getY(i)<-.5)roles[i]=4;g.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute(roles,1));
      low.userData={...mesh.userData,generatedFacade:false,city:{...mesh.userData.city,lodRole:'far'}};lowGeometries.set(mesh,low);ownedGeometry.add(g);
    }
    const lowCrown=farCrownGeometry(),lowTrunk=trunkGeometry(),mediumCrown=new THREE.IcosahedronGeometry(1,1),mediumNeedle=new THREE.ConeGeometry(1,2,8,3).toNonIndexed();
    for(const g of [lowCrown,lowTrunk,mediumCrown,mediumNeedle])ownedGeometry.add(g);
    const roadGeometries=coarseRoadGeometries(city.roadPlan);for(const g of roadGeometries.values())ownedGeometry.add(g);
    const coarseGeometries=new Map();
    for(const original of meshes)if(roadGeometries.has(original.name)){
      const mesh=original.clone(),g=roadGeometries.get(original.name),n=g.attributes.position.count;mesh.geometry=g;
      if(g.userData.lodDoubleSided){mesh.material=original.material.clone();mesh.material.side=THREE.DoubleSide;ownedMaterial.add(mesh.material);}
      const primary=featureIndex[mesh.userData.city.featureId].renderId;
      g.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(n).fill(primary),1));
      g.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute(new Uint8Array(n).fill(materialRoles.indexOf(mesh.userData.city.materialRole)),1));
      const a=original.geometry.attributes.objectId,code=a?[a.getX(0),a.getY(0),a.getZ(0)]:[0,0,0];g.setAttribute('objectId',new THREE.Float32BufferAttribute(Array.from({length:n},()=>code).flat(),3));
      coarseGeometries.set(original,mesh);
    }
    for(const level of levels){
      const groups=new Map(grid.cells.map(c=>[c.id,new THREE.Group()]));
      for(const original of meshes){
        checkCancelled(signal);
        if(level.level<2&&original.userData.city.lodRole==='detail')continue;
        let mesh=(original.name==='Bridge deck thickness and soffits'||level.level<2&&(!original.userData.roadSurface||level.level===0))&&coarseGeometries.has(original)?coarseGeometries.get(original):original;
        if(level.level===0&&['Junction-aware lane paint and inferred stop lines','Inferred zebra crossings','Inferred roadside margins clipped at buildings'].includes(original.name))continue;
        if(level.level===0){
          if(lowGeometries.has(original))mesh=lowGeometries.get(original);
          else if(original.userData.city.kind==='tree'){
            mesh=original.clone();mesh.geometry=(original.userData.city.materialRole==='foliage'?lowCrown:lowTrunk).clone();ownedGeometry.add(mesh.geometry);
            const n=mesh.geometry.attributes.position.count;mesh.geometry.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute(new Uint8Array(n).fill(materialRoles.indexOf(mesh.userData.city.materialRole)),1));mesh.geometry.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(n).fill(mesh.isInstancedMesh?0:featureIndex[mesh.userData.city.featureId].renderId),1));
          }
        }
        if(level.level===0&&original.userData.city.kind==='tree')mesh.castShadow=false;
        if(level.level===0&&original.name==='Inferred zebra crossings'){mesh=original.clone();mesh.geometry=new THREE.BufferGeometry();mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.5,.5,-.5,-.5,.5,.5,.5,.5,.5,-.5,.5,-.5,.5,.5,.5,.5,.5,-.5],3));mesh.geometry.computeVertexNormals();const n=6;mesh.geometry.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(n),1));mesh.geometry.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute(new Uint8Array(n).fill(materialRoles.indexOf('road')),1));ownedGeometry.add(mesh.geometry);}
        if(level.level===1&&original.userData.city.kind==='tree'&&original.userData.city.materialRole==='foliage'){
          mesh=original.clone();mesh.geometry=(original.name.includes('cypress')||original.name.includes('conifer')?mediumNeedle:mediumCrown).clone();ownedGeometry.add(mesh.geometry);const n=mesh.geometry.attributes.position.count;
          mesh.geometry.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(n),1));mesh.geometry.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute(new Uint8Array(n).fill(materialRoles.indexOf('foliage')),1));
        }
        if(level.level===0&&mesh.userData.city.kind==='ground'){mesh=mesh.clone();mesh.userData={...mesh.userData,inkClass:5,city:{...mesh.userData.city,inkClass:5}};}
        mesh.updateMatrixWorld(true);
        for(const [id,piece]of partitionMesh(mesh,grid,id=>owners.get(id),renderIds)){groups.get(id).add(piece);if(piece.geometry!==mesh.geometry)ownedGeometry.add(piece.geometry);}
      }
      for(const [id,group]of groups){
        if(!group.children.length&&level.level!==0)continue;
        if(level.level===0)group.traverse(o=>{if(o.isMesh)o.castShadow=false;});
        if(level.level<2){batchStaticMeshes(group,{low:level.level===0});batchTreeInstances(group);remember(group);}
        group.userData={city:{schemaVersion:1,chunkId:id,lod:level.id,origin:config.origin,coordinateSystem:'x-east-y-up-z-south-meters',featureIndexVersion:1}};
        if(level.level===2 && city.runtimeDetails){
          group.userData.city.nearDetails={schemaVersion:1,
            facadeWalls:city.runtimeDetails.facadeWalls.filter(w=>{const featureId=w.key.slice(0,w.key.lastIndexOf(':'));return owners.get(featureId)===id&&!featureIndex[featureId]?.provenance.recipeId;}).map(w=>({...w,featureId:w.key.slice(0,w.key.lastIndexOf(':'))})),
            trees:city.runtimeDetails.trees.filter(t=>owners.get(`tree:${t.key}`)===id).map(({key,x,z,h,seed,rotation,variation,shape})=>({key,x,z,h,seed,rotation,variation,shape,featureId:`tree:${key}`}))};
        }
        const chunk=chunkMap.get(id),bounds=boundsOf(group),stats=sceneStats(group),payload=encodeChunk(group),hash=await sha256(payload),uri=`chunks/${id}.${level.id}.${hash.slice(0,16)}.cink`;
        assets[uri]=payload;chunk.contentBounds=unionBounds(chunk.contentBounds,bounds);
        const drawUnits=group.children.filter(o=>o.isMesh&&o.visible&&(!o.isInstancedMesh||o.count)).map(object=>{const cost=sceneStats(object);return {bounds:boundsOf(object),triangles:cost.triangles,drawCalls:cost.drawCalls,shadowTriangles:cost.shadowTriangles,shadowDrawCalls:cost.shadowDrawCalls};});
        chunk.lods.push({...level,uri,hash,bytes:payload.byteLength,...stats,bounds,drawUnits,selection:{metric:'screen-space-error',geometricErrorMeters:level.geometricError,maxScreenSpaceError:level.maxScreenSpaceError}});
        group.traverse(o=>{for(const featureId of o.userData.city?.featureIds||[])if(!featureIndex[featureId].chunkIds.includes(id))featureIndex[featureId].chunkIds.push(id);});
      }
      await progress('encode',.45+level.level*.2);
    }
    const p=projection(config.origin.lat,config.origin.lon),one=p.point({lat:config.origin.lat,lon:config.origin.lon+1}),two=p.point({lat:config.origin.lat+1,lon:config.origin.lon});
    const sourceAttribution=normalized.metadata?.attribution;
    const attribution={text:typeof sourceAttribution==='string'?sourceAttribution:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright',license:normalized.metadata?.license||'ODbL-1.0',dataSource:config.source.kind,...(sourceAttribution&&typeof sourceAttribution==='object'?sourceAttribution:{})};
    const chunks=[...chunkMap.values()].filter(c=>c.lods.length);
    let bounds;for(const chunk of chunks)bounds=unionBounds(bounds,chunk.contentBounds);
    const worldHash=await sha256(canonicalStringify({sourceHash,origin:config.origin,seed:config.seed,generation:config.generation,landmarks:config.landmarks,generator:GENERATOR_VERSION,features:Object.fromEntries(Object.entries(featureIndex).map(([id,{chunkIds,ownerChunk,...f}])=>[id,f]))}));
    const manifest={schemaVersion:1,generator:{id:'city-ink-core',version:GENERATOR_VERSION},origin:config.origin,coordinateSystem:{crs:'WGS84-local-equirectangular',axes:{x:'east',y:'up',z:'south'},units:'meters',projection:{eastMetersPerDegree:one[0],northMetersPerDegree:-two[1]}},bounds,area:config.area,sources:[{...config.source,hash:sourceHash,metadata:normalized.metadata}],attribution,styleContractVersion:STYLE_CONTRACT_VERSION,style:{...config.style,contractVersion:STYLE_CONTRACT_VERSION,attributes:['inkClass','objectId','cityFeature','cityMaterialRole','aFacade','aStyle','aLayout','aSurface'],materialRoles:materialRoles.slice(1)},tiling:{...config.tiling,columns:grid.columns,rows:grid.rows,boundaryPolicy:'atomic-features-and-cell-clipped-shared-surfaces',contentBoundsRequired:true},chunks,featureIndex,hashes:{config:configHash,source:sourceHash,world:worldHash}};
    const validity=validateSceneManifest(manifest);if(!validity.valid)throw new CityBuildError('INVALID_SCENE_MANIFEST','Compiler produced invalid scene manifest.','validate',{diagnostics:validity.diagnostics});
    assets['attribution.json']=canonicalStringify(attribution);await progress('complete',1);
    return {manifest,assets,report:{schemaVersion:1,status:'succeeded',diagnostics,hashes:manifest.hashes,counts:{inputElements:normalized.elements.length,features:ids.length,buildings:data.buildings.length,trees:trees.length,chunks:chunks.length},road:city.roadStats,landscape:city.landscapeStats,roof:city.roofStats,determinism:{timestampsExcluded:true,uuidExcluded:true,worldHashExcludesTiling:true}}};
  }finally{for(const g of ownedGeometry)g.dispose();for(const m of ownedMaterial)m.dispose();}
}
