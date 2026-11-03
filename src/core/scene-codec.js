import * as THREE from 'three';
import { canonicalStringify, CityBuildError, sha256 } from './contract.js';

const MAGIC = [67,73,78,75]; // CINK, little-endian lengths, protocol v1
const TYPES = {Float32Array,Float64Array,Uint32Array,Uint16Array,Uint8Array,Int32Array,Int16Array,Int8Array};
const fail = message => { throw new CityBuildError('INVALID_CHUNK',message,'decode'); };
const finite = values => values.every(Number.isFinite);
const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;

export function sceneStats(group) {
  const geometries=new Set(),materials=new Set(); let residentBytes=0,triangles=0,drawCalls=0,instances=0;
  group.traverseVisible(o=>{
    if(!o.isMesh || !o.visible) return;
    if(!geometries.has(o.geometry)) {
      geometries.add(o.geometry);
      for(const a of Object.values(o.geometry.attributes)) residentBytes+=a.array.byteLength;
      residentBytes+=o.geometry.index?.array.byteLength||0;
    }
    for(const m of (Array.isArray(o.material)?o.material:[o.material])) materials.add(m);
    if(o.isInstancedMesh){residentBytes+=o.count*64+(o.instanceColor?o.count*12:0);instances+=o.count;}
    const total=o.geometry.index?.count??o.geometry.attributes.position.count,start=o.geometry.drawRange.start,end=Math.min(total,start+o.geometry.drawRange.count),copies=o.isInstancedMesh?o.count:1;
    const ranges=Array.isArray(o.material)?o.geometry.groups.filter(g=>o.material[g.materialIndex]).map(g=>[Math.max(start,g.start),Math.min(end,g.start+g.count)]):[[start,end]];
    for(const [lo,hi]of ranges){const count=Math.max(0,Math.floor((hi-lo)/3));triangles+=count*copies;if(count>0&&copies>0)drawCalls++;}
  });
  return {residentBytes,triangles,drawCalls,instances,geometries:geometries.size,materials:materials.size};
}

/** Binary typed arrays + deterministic JSON metadata. No Three UUIDs or code. */
export function encodeChunk(group) {
  const parts=[], geometries=[], materials=[],nodes=[],geoIds=new Map(),matIds=new Map();let offset=0;
  const pack=array=>{
    if(!finite(array))throw new CityBuildError('NON_FINITE_GEOMETRY','Binary attributes and matrices must be finite.','encode');
    const pad=(4-offset%4)%4;if(pad){parts.push(new Uint8Array(pad));offset+=pad;}
    const entry={type:array.constructor.name,offset,length:array.length};
    if(!TYPES[entry.type]) throw new CityBuildError('UNSUPPORTED_ATTRIBUTE',`Unsupported array ${entry.type}.`,'encode');
    const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);parts.push(bytes);offset+=bytes.byteLength;return entry;
  };
  const attribute=a=>{
    if(a.isInterleavedBufferAttribute)throw new CityBuildError('UNSUPPORTED_ATTRIBUTE','Interleaved attributes require explicit deinterleaving.','encode');
    if(!finite(a.array))throw new CityBuildError('NON_FINITE_GEOMETRY','Geometry must contain finite numbers.','encode');
    return {...pack(a.array),itemSize:a.itemSize,normalized:a.normalized,instanced:!!a.isInstancedBufferAttribute,meshPerAttribute:a.meshPerAttribute||1};
  };
  group.updateMatrixWorld(true);
  group.traverseVisible(o=>{
    if(!o.isMesh || !o.visible || (o.isInstancedMesh && !o.count) || !o.geometry.attributes.position?.count)return;
    let gid=geoIds.get(o.geometry);
    if(gid===undefined){
      gid=geometries.length;geoIds.set(o.geometry,gid);
      geometries.push({attributes:Object.fromEntries(Object.keys(o.geometry.attributes).sort().map(k=>[k,attribute(o.geometry.attributes[k])])),index:o.geometry.index?attribute(o.geometry.index):null,groups:o.geometry.groups,drawRange:{start:o.geometry.drawRange.start,count:Number.isFinite(o.geometry.drawRange.count)?o.geometry.drawRange.count:null},userData:o.geometry.userData});
    }
    const mids=(Array.isArray(o.material)?o.material:[o.material]).map(m=>{
      const spec={type:'standard',color:m.color?.toArray()||[1,1,1],roughness:m.roughness??1,metalness:m.metalness??0,vertexColors:!!m.vertexColors,side:m.side,transparent:m.transparent,opacity:m.opacity,depthWrite:m.depthWrite,polygonOffset:m.polygonOffset,polygonOffsetFactor:m.polygonOffsetFactor,polygonOffsetUnits:m.polygonOffsetUnits,userData:m.userData||{}};
      const key=canonicalStringify(spec);let id=matIds.get(key);if(id===undefined){id=materials.length;matIds.set(key,id);materials.push(spec);}return id;
    });
    nodes.push({name:o.name,geometry:gid,materials:mids,matrix:o.matrixWorld.toArray(),castShadow:o.castShadow,receiveShadow:o.receiveShadow,userData:o.userData,instances:o.isInstancedMesh?{count:o.count,matrix:pack(o.instanceMatrix.array.slice(0,o.count*16)),color:o.instanceColor?pack(o.instanceColor.array.slice(0,o.count*3)):null}:null});
  });
  const header=new TextEncoder().encode(canonicalStringify({schemaVersion:1,geometries,materials,nodes,userData:group.userData}));
  const start=12+header.length,aligned=(start+3)&~3,result=new Uint8Array(aligned+offset),view=new DataView(result.buffer);
  result.set(MAGIC);view.setUint32(4,1,true);view.setUint32(8,header.length,true);result.set(header,12);
  let cursor=aligned;for(const bytes of parts){result.set(bytes,cursor);cursor+=bytes.length;}return result;
}

/** Callers may await; descriptor hash/bytes are verified before allocation. */
export async function decodeChunk(payload, descriptor = {}) {
  let bytes;
  if(payload instanceof ArrayBuffer)bytes=new Uint8Array(payload);
  else if(ArrayBuffer.isView(payload))bytes=new Uint8Array(payload.buffer,payload.byteOffset,payload.byteLength);
  else fail('Chunk payload must be ArrayBuffer or Uint8Array.');
  if(bytes.length<12 || bytes.length>MAX_PAYLOAD_BYTES || !MAGIC.every((n,i)=>bytes[i]===n))fail('Invalid chunk magic or size.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(4,true)!==1)throw new CityBuildError('UNSUPPORTED_CHUNK_VERSION','Only CINK chunk version 1 is supported.','decode');
  if(descriptor.bytes!==undefined && descriptor.bytes!==bytes.length)fail('Chunk byte length does not match manifest.');
  if(descriptor.hash && await sha256(bytes)!==descriptor.hash.replace(/^sha256:/,''))fail('Chunk SHA-256 does not match manifest.');
  const length=view.getUint32(8,true),start=(12+length+3)&~3;if(length>bytes.length-12||start>bytes.length)fail('Truncated chunk header.');
  let doc;try{doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+length)));}catch{fail('Invalid chunk JSON header.');}
  if(!doc||typeof doc!=='object'||Array.isArray(doc))fail('Chunk metadata must be an object.');
  if(doc.schemaVersion!==1)throw new CityBuildError('UNSUPPORTED_CHUNK_VERSION','Unsupported chunk metadata schema.','decode');
  if(!Array.isArray(doc.geometries)||!Array.isArray(doc.materials)||!Array.isArray(doc.nodes))fail('Missing chunk tables.');
  if(doc.nodes.length>100000 || doc.geometries.length>100000)fail('Chunk table limits exceeded.');
  const unpack=spec=>{
    const Type=spec&&Object.hasOwn(TYPES,spec.type)?TYPES[spec.type]:null;
    if(!Type||!Number.isSafeInteger(spec.offset)||!Number.isSafeInteger(spec.length)||spec.offset<0||spec.length<0||spec.length*Type.BYTES_PER_ELEMENT>bytes.length-start-spec.offset)fail('Invalid typed array range.');
    const array=new Type(spec.length);new Uint8Array(array.buffer).set(bytes.subarray(start+spec.offset,start+spec.offset+array.byteLength));
    if(!finite(array))fail('Non-finite attribute value.');return array;
  };
  const attribute=spec=>{
    if(!Number.isInteger(spec?.itemSize)||spec.itemSize<1||spec.itemSize>16||spec.length%spec.itemSize)fail('Invalid attribute itemSize.');
    if(spec.instanced&&(!Number.isSafeInteger(spec.meshPerAttribute)||spec.meshPerAttribute<1))fail('Invalid instance attribute divisor.');
    const a=unpack(spec);return spec.instanced?new THREE.InstancedBufferAttribute(a,spec.itemSize,!!spec.normalized,spec.meshPerAttribute):new THREE.BufferAttribute(a,spec.itemSize,!!spec.normalized);
  };
  const allocatedGeometries=[],allocatedMaterials=[];
  try {
    const geometries=doc.geometries.map(spec=>{
      const g=new THREE.BufferGeometry();allocatedGeometries.push(g);
      for(const [name,a]of Object.entries(spec.attributes||{})){if(['__proto__','constructor','prototype'].includes(name))fail('Invalid attribute name.');g.setAttribute(name,attribute(a));}
      if(g.attributes.position?.itemSize!==3)fail('Geometry requires position vec3.');
      for(const a of Object.values(g.attributes))if(!a.isInstancedBufferAttribute&&a.count!==g.attributes.position.count)fail('Vertex attribute count mismatch.');
      if(spec.index){g.setIndex(attribute(spec.index));if(g.index.itemSize!==1||!['Uint8Array','Uint16Array','Uint32Array'].includes(spec.index.type)||g.index.array.some(i=>i>=g.attributes.position.count))fail('Invalid geometry index.');}
      const count=g.index?.count??g.attributes.position.count;if(count%3)fail('Triangle geometry count must be divisible by three.');
      if(!Array.isArray(spec.groups))fail('Invalid geometry groups.');
      for(const item of spec.groups){if(!Number.isInteger(item.start)||!Number.isInteger(item.count)||item.start<0||item.count<0||item.start+item.count>count||!Number.isInteger(item.materialIndex)||item.materialIndex<0)fail('Invalid geometry material group.');g.addGroup(item.start,item.count,item.materialIndex);}
      const range=spec.drawRange;if(!Number.isInteger(range?.start)||range.start<0||range.start>count||range.count!==null&&(!Number.isInteger(range.count)||range.count<0||range.start+range.count>count))fail('Invalid draw range.');
      g.setDrawRange(range.start,range.count??Infinity);g.userData=spec.userData||{};g.computeBoundingBox();g.computeBoundingSphere();return g;
    });
    const materials=doc.materials.map(spec=>{
      if(!Array.isArray(spec.color)||spec.color.length!==3||!finite(spec.color))fail('Invalid material color.');
      const {type,color,userData,...props}=spec;const m=new THREE.MeshStandardMaterial({...props,color:new THREE.Color().fromArray(color)});m.userData=userData||{};allocatedMaterials.push(m);return m;
    });
    const group=new THREE.Group();group.name=descriptor.id||'City Ink chunk';group.userData=doc.userData||{};
    for(const spec of doc.nodes){
      const g=geometries[spec.geometry];if(!g||!Array.isArray(spec.materials)||!spec.materials.length||spec.materials.some(id=>!Number.isInteger(id)||!materials[id]))fail('Invalid geometry/material reference.');
      if(spec.materials.length>1&&g.groups.some(item=>item.materialIndex>=spec.materials.length))fail('Material group reference out of range.');
      const mats=spec.materials.map(id=>materials[id]);let mesh;
      if(spec.instances){
        const i=spec.instances;if(!Number.isSafeInteger(i.count)||i.count<1||i.count>1000000||i.matrix?.length!==i.count*16||i.matrix.type!=='Float32Array'||i.color&&(i.color.length!==i.count*3||i.color.type!=='Float32Array'))fail('Invalid instance table.');
        for(const a of Object.values(g.attributes))if(a.isInstancedBufferAttribute&&a.count*a.meshPerAttribute<i.count)fail('Instance attribute count mismatch.');
        const matrices=unpack(i.matrix),colors=i.color?unpack(i.color):null;
        mesh=new THREE.InstancedMesh(g,mats.length===1?mats[0]:mats,i.count);mesh.instanceMatrix.array.set(matrices);
        if(colors)mesh.instanceColor=new THREE.InstancedBufferAttribute(colors,3);
        mesh.computeBoundingBox();mesh.computeBoundingSphere();
      }else mesh=new THREE.Mesh(g,mats.length===1?mats[0]:mats);
      if(!Array.isArray(spec.matrix)||spec.matrix.length!==16||!finite(spec.matrix))fail('Invalid object transform.');
      mesh.matrix.fromArray(spec.matrix);mesh.matrixAutoUpdate=false;mesh.name=spec.name||'';mesh.userData=spec.userData||{};mesh.castShadow=!!spec.castShadow;mesh.receiveShadow=!!spec.receiveShadow;group.add(mesh);
    }
    if(descriptor.triangles!==undefined&&sceneStats(group).triangles!==descriptor.triangles)fail('Triangle count does not match manifest.');
    return group;
  }catch(error){for(const g of allocatedGeometries)g.dispose();for(const m of allocatedMaterials)m.dispose();if(error instanceof CityBuildError)throw error;fail(`Malformed chunk: ${error.message}`);}
}
