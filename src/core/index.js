import * as THREE from 'three';
import { parseOSM, projection } from '../osm.js';
import { buildCity } from '../city.js';
import { isNeedleCrown } from '../foliage.js';
import { validateProjectConfig } from './config.js';
import { GENERATOR_VERSION, STYLE_CONTRACT_VERSION, CityBuildError, canonicalStringify, checkCancelled, normalizeRaw, sha256 } from './contract.js';
import { decodeChunk, encodeChunk, sceneStats } from './scene-codec.js';
import { boundsOf, groundMesh, lowBuilding, mergeLowBuildings, partitionMesh } from './geometry.js';
export { validateProjectConfig, CityBuildError };

const slug=text=>text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const sourceId=f=>`${f.osmType||'way'}/${f.osmId??f.id}`;
const normalizeSourceId=id=>String(id).replace(/^w(\d+).*$/,'way/$1').replace(/^r(\d+).*$/,'relation/$1');
const materialRoles=['unknown','wall','glass','roof','structure','road','ground','water','foliage'];
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
  const city=buildCity(data,{...config.generation,landmarksEnabled:config.landmarks.enabled});
  const ownedGeometry=new Set(),ownedMaterial=new Set();
  const remember=group=>group.traverse(o=>{if(o.geometry)ownedGeometry.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])ownedMaterial.add(m);});
  remember(city.group);
  try {
    const featureIndex={},atomicGroups=new Map(),context={origin:config.origin,bounds:data.bounds,seed:config.seed};
    const add=(id,record)=>featureIndex[id]||=({featureId:id,sourceIds:[],kind:'generated',...record,chunkIds:[]});
    for(const b of data.buildings)add(b.id,{kind:'building',sourceIds:[sourceId(b)],provenance:{height:b.source,heightMeters:b.height,minHeightMeters:b.minHeight,tags:b.tags},anchor:[...b.center]});
    for(const r of data.roads)add(`w${r.id}`,{kind:'road',sourceIds:[`way/${r.id}`],provenance:{tags:r.tags,elevation:'rule-inferred',widthMeters:r.width}});
    for(const w of data.water)add(w.id,{kind:'water',sourceIds:w.sourceIds?.map(normalizeSourceId)||[sourceId(w)],provenance:{source:'osm',operation:'shared-region-union'}});
    const trees=city.streetlifePlan.trees;
    for(const t of trees){
      const green=t.key.match(/^green:((?:w\d+|r\d+-\d+))/),row=t.key.match(/^row:(\d+):/);
      const sourceIds=t.source==='osm'?[`node/${t.key.slice(4)}`]:t.roadId?[`way/${t.roadId}`]:green?[normalizeSourceId(green[1])]:row?[`way/${row[1]}`]:[];
      add(`tree:${t.key}`,{kind:'tree',sourceIds,anchor:[t.x,t.z],provenance:{source:t.source,seed:config.seed,ruleVersion:GENERATOR_VERSION,heightMeters:t.h,shape:t.shape,generatorKey:t.key}});}
    const registryObjects=new Set();
    if(config.landmarks.enabled && options.landmarkRegistry){
      let matches=[];const claimed=new Set();
      try {matches=await options.landmarkRegistry.match(data.buildings,context);if(!Array.isArray(matches))throw Error('Registry match must return an array.');}
      catch(error){diagnostics.push({code:'LANDMARK_MATCH_FAILED',stage:'plan',message:error.message,hint:'Retained default shapes; fix the registry matcher.'});matches=[];}
      for(const match of matches.filter(m=>{if(m&&typeof m==='object'&&typeof m.recipeId==='string')return true;diagnostics.push({code:'INVALID_LANDMARK_CLAIM',stage:'plan',message:'Ignored malformed registry match.'});return false;}).sort((a,b)=>`${a.recipeId}:${a.claimedFeatureIds}`.localeCompare(`${b.recipeId}:${b.claimedFeatureIds}`,'en'))){
        checkCancelled(signal);
        if(!Array.isArray(match.claimedFeatureIds)||!match.claimedFeatureIds.length||match.claimedFeatureIds.some(id=>!featureIndex[id]||claimed.has(id))){diagnostics.push({code:'INVALID_LANDMARK_CLAIM',stage:'plan',message:`Ignored invalid or overlapping claim for ${match.recipeId}.`});continue;}
        try {
          const generated=await options.landmarkRegistry.generate(match,context);
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
          const validated=await decodeChunk(encodeChunk(generated.group));
          remember(validated);
          if(sceneStats(validated).triangles<=0)throw new Error('Generator returned no drawn triangles.');
          const ids=[...match.claimedFeatureIds].sort(),groupId=`landmark:${match.recipeId}:${ids.join(',')}`;
          atomicGroups.set(groupId,ids);
          for(const id of ids){claimed.add(id);featureIndex[id].atomicGroupId=groupId;featureIndex[id].provenance.recipeId=match.recipeId;featureIndex[id].provenance.recipeVersion=match.recipeVersion;featureIndex[id].provenance.generator=generated.provenance||{};}
          for(const mesh of city.buildings)if(ids.includes(mesh.userData.feature.id))city.group.remove(mesh);
          generated.group.traverse(mesh=>{if(mesh.isMesh){registryObjects.add(mesh);mesh.userData.city={...mesh.userData.city,featureId:mesh.userData.city?.featureId&&ids.includes(mesh.userData.city.featureId)?mesh.userData.city.featureId:ids[0],featureIds:ids,sourceIds:ids.flatMap(id=>featureIndex[id].sourceIds),kind:'building',atomicGroupId:groupId,recipeId:match.recipeId,recipeVersion:match.recipeVersion,materialRole:mesh.userData.city?.materialRole||'structure'};}});
          city.group.add(generated.group);remember(generated.group);diagnostics.push(...(generated.diagnostics||[]),...(match.diagnostics||[]));
        }catch(error){diagnostics.push({code:'LANDMARK_GENERATION_FAILED',stage:'geometry',message:`${match.recipeId}: ${error.message}`,hint:'Retained the legacy/default shape; fix or disable the supplied recipe.'});}
      }
    }
    if(options.landmarkRegistry){
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
      mesh.userData.city={...original,featureId:ids[0],featureIds:[...new Set(ids)].sort(),sourceIds:[...new Set(ids.flatMap(id=>featureIndex[id].sourceIds))].sort(),kind,materialRole:role,lodRole};
      if(mesh.isInstancedMesh)mesh.userData.city.instanceFeatureIds=ids;
    }
    const ids=Object.keys(featureIndex).sort();ids.forEach((id,i)=>featureIndex[id].renderId=i+1);const renderIds=[null,...ids],instanceGeometries=new Map();
    for(const mesh of meshes){
      if(mesh.isInstancedMesh){const source=mesh.geometry,key=`${mesh.userData.city.kind}:${mesh.userData.city.materialRole}`;if(!instanceGeometries.has(source))instanceGeometries.set(source,new Map());const cached=instanceGeometries.get(source);if(!cached.has(key)){cached.set(key,source.clone());ownedGeometry.add(cached.get(key));}mesh.geometry=cached.get(key);}
      const n=mesh.geometry.attributes.position.count,values=new Uint32Array(n).fill(mesh.isInstancedMesh?0:featureIndex[mesh.userData.city.featureId].renderId);
      if(mesh===city.equipment&&mesh.geometry.attributes.objectId){
        const a=mesh.geometry.attributes.objectId;
        for(let i=0;i<n;i++){const pick=Math.round(a.getX(i)*255)+(Math.round(a.getY(i)*255)<<8)+(Math.round(a.getZ(i)*255)<<16);const b=data.buildings[pick-1];if(b)values[i]=featureIndex[b.id].renderId;}
      }
      mesh.geometry.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(values,1));
      const roles=new Uint8Array(n).fill(materialRoles.indexOf(mesh.userData.city.materialRole));
      if(mesh.userData.city.kind==='building'&&mesh.geometry.attributes.normal){const normal=mesh.geometry.attributes.normal;for(let i=0;i<n;i++)if(normal.getY(i)>.5)roles[i]=3;else if(normal.getY(i)<-.5)roles[i]=4;}
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
    const levels=[{id:'low',level:0,geometricError:12,maxScreenSpaceError:3,description:'Batched footprint/landmark silhouettes; 20-triangle crowns; exact shared roads and ground.'},{id:'medium',level:1,geometricError:1,maxScreenSpaceError:2,description:'Original building bodies and basic vegetation; exact shared roads and ground.'},{id:'high',level:2,geometricError:0,maxScreenSpaceError:0,description:'Original building geometry with roof equipment and inferred street furnishings.'}];
    const assets={},chunkMap=new Map(grid.cells.map(c=>[c.id,{id:c.id,bounds:[c.bounds[0],0,c.bounds[1],c.bounds[2],0,c.bounds[3]],contentBounds:null,transform:identity,lods:[]}])) ;
    const lowMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9});ownedMaterial.add(lowMaterial);
    const lowGeometries=new Map();
    for(const mesh of meshes)if(mesh.userData.city.kind==='building'&&!registryObjects.has(mesh)){
      const b=data.buildings.find(b=>b.id===mesh.userData.city.featureId);if(!b)continue;
      const low=lowBuilding(b,lowMaterial,config.landmarks.enabled),g=low.geometry,n=g.attributes.position.count;
      const color=mesh.geometry.attributes.color,c=new THREE.Color();if(color?.count)c.fromBufferAttribute(color,0);else c.copy(mesh.material.color||new THREE.Color('#c7c7be'));
      g.setAttribute('color',new THREE.Float32BufferAttribute(Array.from({length:n},()=>c.toArray()).flat(),3));g.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(n).fill(featureIndex[b.id].renderId),1));
      const roles=new Uint8Array(n).fill(materialRoles.indexOf(mesh.userData.city.materialRole));for(let i=0;i<n;i++)if(g.attributes.normal.getY(i)>.5)roles[i]=3;else if(g.attributes.normal.getY(i)<-.5)roles[i]=4;g.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute(roles,1));
      low.userData={...mesh.userData,generatedFacade:false,city:{...mesh.userData.city,lodRole:'far'}};lowGeometries.set(mesh,low);ownedGeometry.add(g);
    }
    const lowCrown=new THREE.IcosahedronGeometry(1,0),lowTrunk=new THREE.CylinderGeometry(1,1,1,4);ownedGeometry.add(lowCrown);ownedGeometry.add(lowTrunk);
    for(const level of levels){
      const groups=new Map(grid.cells.map(c=>[c.id,new THREE.Group()]));
      for(const original of meshes){
        checkCancelled(signal);
        if(level.level<2&&original.userData.city.lodRole==='detail')continue;
        let mesh=original;
        if(level.level===0){
          if(lowGeometries.has(original))mesh=lowGeometries.get(original);
          else if(original.userData.city.kind==='tree'){
            mesh=original.clone();mesh.geometry=(original.userData.city.materialRole==='foliage'?lowCrown:lowTrunk).clone();ownedGeometry.add(mesh.geometry);
            const n=mesh.geometry.attributes.position.count;mesh.geometry.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute(new Uint8Array(n).fill(materialRoles.indexOf(mesh.userData.city.materialRole)),1));mesh.geometry.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(n).fill(mesh.isInstancedMesh?0:featureIndex[mesh.userData.city.featureId].renderId),1));
          }
        }
        mesh.updateMatrixWorld(true);
        for(const [id,piece]of partitionMesh(mesh,grid,id=>owners.get(id),renderIds)){groups.get(id).add(piece);if(piece.geometry!==mesh.geometry)ownedGeometry.add(piece.geometry);}
      }
      for(const [id,group]of groups){
        if(!group.children.length)continue;
        if(level.level===0){mergeLowBuildings(group);remember(group);}
        group.userData={city:{schemaVersion:1,chunkId:id,lod:level.id,origin:config.origin,coordinateSystem:'x-east-y-up-z-south-meters',featureIndexVersion:1}};
        const chunk=chunkMap.get(id),bounds=boundsOf(group),stats=sceneStats(group),payload=encodeChunk(group),hash=await sha256(payload),uri=`chunks/${id}.${level.id}.${hash.slice(0,16)}.cink`;
        assets[uri]=payload;chunk.contentBounds=unionBounds(chunk.contentBounds,bounds);
        chunk.lods.push({...level,uri,hash,bytes:payload.byteLength,...stats,bounds,selection:{metric:'screen-space-error',geometricErrorMeters:level.geometricError,maxScreenSpaceError:level.maxScreenSpaceError}});
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
    const manifest={schemaVersion:1,generator:{id:'city-ink-core',version:GENERATOR_VERSION},origin:config.origin,coordinateSystem:{crs:'WGS84-local-equirectangular',axes:{x:'east',y:'up',z:'south'},units:'meters',projection:{eastMetersPerDegree:one[0],northMetersPerDegree:-two[1]}},bounds,area:config.area,sources:[{...config.source,hash:sourceHash,metadata:normalized.metadata}],attribution,styleContractVersion:STYLE_CONTRACT_VERSION,style:{...config.style,contractVersion:STYLE_CONTRACT_VERSION,attributes:['inkClass','objectId','cityFeature','cityMaterialRole','aFacade','aStyle','aLayout','aSurface'],materialRoles:['wall','glass','roof','structure','road','ground','water','foliage']},tiling:{...config.tiling,columns:grid.columns,rows:grid.rows,boundaryPolicy:'whole-feature-or-shared-triangle-centroid',contentBoundsRequired:true},chunks,featureIndex,hashes:{config:configHash,source:sourceHash,world:worldHash}};
    const validity=validateSceneManifest(manifest);if(!validity.valid)throw new CityBuildError('INVALID_SCENE_MANIFEST','Compiler produced invalid scene manifest.','validate',{diagnostics:validity.diagnostics});
    assets['attribution.json']=canonicalStringify(attribution);await progress('complete',1);
    return {manifest,assets,report:{schemaVersion:1,status:'succeeded',diagnostics,hashes:manifest.hashes,counts:{inputElements:normalized.elements.length,features:ids.length,buildings:data.buildings.length,trees:trees.length,chunks:chunks.length},road:city.roadStats,landscape:city.landscapeStats,determinism:{timestampsExcluded:true,uuidExcluded:true,worldHashExcludesTiling:true}}};
  }finally{for(const g of ownedGeometry)g.dispose();for(const m of ownedMaterial)m.dispose();}
}

export function validateSceneManifest(manifest) {
  const diagnostics=[],error=(path,message)=>diagnostics.push({code:'INVALID_SCENE_MANIFEST',stage:'manifest',path,message});
  if(!manifest||typeof manifest!=='object')return {valid:false,diagnostics:[{code:'INVALID_SCENE_MANIFEST',stage:'manifest',message:'Manifest must be an object.'}]};
  if(manifest.schemaVersion!==1)error('schemaVersion','Only scene schemaVersion 1 is supported.');
  if(typeof manifest.generator?.id!=='string'||!manifest.generator.id||typeof manifest.generator?.version!=='string'||!manifest.generator.version)error('generator','Generator id/version required.');
  if(!Number.isFinite(manifest.origin?.lat)||!Number.isFinite(manifest.origin?.lon))error('origin','Finite origin required.');
  const box=b=>Array.isArray(b)&&b.length===6&&b.every(Number.isFinite)&&[0,1,2].every(i=>b[i]<=b[i+3]);
  if(!box(manifest.bounds))error('bounds','Expected ordered 3D bounds.');
  if(manifest.coordinateSystem?.units!=='meters'||manifest.coordinateSystem?.axes?.x!=='east'||manifest.coordinateSystem?.axes?.y!=='up'||manifest.coordinateSystem?.axes?.z!=='south'||!Number.isFinite(manifest.coordinateSystem?.projection?.eastMetersPerDegree)||!Number.isFinite(manifest.coordinateSystem?.projection?.northMetersPerDegree))error('coordinateSystem','Expected local x-east/y-up/z-south meters.');
  if(!Array.isArray(manifest.sources)||typeof manifest.attribution?.text!=='string'||!manifest.attribution.text||typeof manifest.attribution?.license!=='string')error('sources','Sources and attribution required.');
  if(manifest.styleContractVersion!==1)error('styleContractVersion','Unsupported style contract.');
  if(!manifest.featureIndex||typeof manifest.featureIndex!=='object'||Array.isArray(manifest.featureIndex))error('featureIndex','Feature table required.');
  const seen=new Set(),uris=new Set();
  if(!Array.isArray(manifest.chunks)||!manifest.chunks.length)error('chunks','Non-empty chunks required.');
  else for(const [i,c]of manifest.chunks.entries()){
    const path=`chunks.${i}`;if(!c||typeof c!=='object'){error(path,'Chunk must be an object.');continue;}if(typeof c.id!=='string'||seen.has(c.id))error(`${path}.id`,'Unique chunk id required.');seen.add(c.id);
    if(!box(c.contentBounds))error(`${path}.contentBounds`,'Ordered content bounds required.');
    if(!Array.isArray(c.transform)||c.transform.length!==16||!c.transform.every(Number.isFinite))error(`${path}.transform`,'Finite matrix4 required.');
    if(!Array.isArray(c.lods)||c.lods.length<2)error(`${path}.lods`,'At least two real resource levels required.');
    else {const levels=new Set();for(const [j,l]of c.lods.entries()){
      const lp=`${path}.lods.${j}`;
      if(!l||typeof l!=='object'){error(lp,'LOD must be an object.');continue;}
      if(![0,1,2].includes(l.level)||!['low','medium','high'].includes(l.id)||levels.has(l.level)||['low','medium','high'][l.level]!==l.id)error(lp,'Unique matching LOD level/id required.');levels.add(l.level);
      if(typeof l.uri!=='string'||!/^chunks\/[a-zA-Z0-9_.-]+\.cink$/.test(l.uri)||uris.has(l.uri))error(`${lp}.uri`,'Unique relative chunk resource path required.');uris.add(l.uri);
      if(!/^[0-9a-f]{64}$/.test(l.hash)||!Number.isSafeInteger(l.bytes)||l.bytes<=0||!Number.isSafeInteger(l.triangles)||l.triangles<0||!Number.isSafeInteger(l.residentBytes)||l.residentBytes<0)error(lp,'Valid hash, bytes, triangles and residentBytes required.');
      if(!box(l.bounds)||!Number.isFinite(l.geometricError)||l.geometricError<0||l.selection?.metric!=='screen-space-error'||!Number.isFinite(l.selection?.geometricErrorMeters)||l.selection.geometricErrorMeters<0||!Number.isFinite(l.selection?.maxScreenSpaceError)||l.selection.maxScreenSpaceError<0)error(lp,'LOD bounds and selection error required.');
      if(!Number.isSafeInteger(l.drawCalls)||l.drawCalls<0)error(lp,'Non-negative integer drawCalls required.');
    }}
  }
  const renderIds=new Set();for(const [id,f]of Object.entries(manifest.featureIndex||{})){
    if(!f||typeof f!=='object'){error(`featureIndex.${id}`,'Feature record must be an object.');continue;}
    if(f.featureId!==id||typeof f.kind!=='string'||!f.kind||!f.provenance||typeof f.provenance!=='object'||Array.isArray(f.provenance)||!Array.isArray(f.sourceIds)||f.sourceIds.some(id=>typeof id!=='string')||f.bounds!==undefined&&!box(f.bounds)||f.ownerChunk!==undefined&&!seen.has(f.ownerChunk)||!Array.isArray(f.chunkIds)||f.chunkIds.some(id=>!seen.has(id))||!Number.isSafeInteger(f.renderId)||f.renderId<1||renderIds.has(f.renderId))error(`featureIndex.${id}`,'Invalid feature identity, sources, renderId or chunk references.');renderIds.add(f.renderId);
  }
  return {valid:diagnostics.length===0,diagnostics};
}
