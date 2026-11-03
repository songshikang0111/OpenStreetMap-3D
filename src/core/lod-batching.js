import * as THREE from 'three';
import { canonicalStringify } from './contract.js';

/** A closed four-face tapered trunk; the tip remains inside its crown. */
export function trunkGeometry() {
  const g=new THREE.BufferGeometry(),points=[];
  for(let i=0;i<3;i++){const a=i/3*Math.PI*2;points.push(Math.cos(a),-.5,Math.sin(a));}points.push(0,.5,0);
  g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setIndex([0,1,2,0,3,1,1,3,2,2,3,0]);
  const result=g.toNonIndexed();g.dispose();result.computeVertexNormals();return result;
}

/** Closed six-face crown with unchanged centre, height and radial envelope. */
export function farCrownGeometry() {
  const g=new THREE.BufferGeometry(),points=[];for(let i=0;i<3;i++){const a=i/3*Math.PI*2;points.push(Math.cos(a),0,Math.sin(a));}points.push(0,1,0,0,-1,0);
  g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));const indices=[];for(let i=0;i<3;i++){const j=(i+1)%3;indices.push(i,3,j,i,j,4);}g.setIndex(indices);const result=g.toNonIndexed();g.dispose();result.computeVertexNormals();return result;
}

function materialKey(material) {
  const materials=Array.isArray(material)?material:[material];
  return canonicalStringify(materials.map(m=>({color:m.color?.toArray(),vertexColors:m.vertexColors,roughness:m.roughness,metalness:m.metalness,side:m.side,opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite})));
}

/** Merge compatible draw units, retaining every vertex attribute, role and ID.
 * No mesh is hidden; only the draw containers change. Geometry is indexed by
 * exact attribute equality, so close but distinct seam points never collapse. */
export function batchStaticMeshes(group,{low=false}={}) {
  const buckets=new Map();
  for(const mesh of [...group.children]){
    if(!mesh.isMesh||mesh.isInstancedMesh)continue;
    const city=mesh.userData.city;
    // Arbitrary externally authored shaders/material arrays keep their own units.
    if(!low&&(city.kind!=='building'||city.recipeId&&!['city-ink/china-zun','city-ink/cctv'].includes(city.generatorId)))continue;
    const attributes=Object.keys(mesh.geometry.attributes).sort();
    if(attributes.some(k=>mesh.geometry.attributes[k].isInstancedBufferAttribute))continue;
    const key=canonicalStringify({kind:city.kind,inkClass:mesh.userData.inkClass,shader:low?undefined:city.shader,castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow,attributes:attributes.map(k=>[k,mesh.geometry.attributes[k].itemSize,mesh.geometry.attributes[k].array.constructor.name,mesh.geometry.attributes[k].normalized]),material:materialKey(mesh.material)});
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(mesh);
  }
  for(const meshes of buckets.values()){
    const first=meshes[0],names=Object.keys(first.geometry.attributes).sort(),values=Object.fromEntries(names.map(n=>[n,[]])),vertexIds=new Map(),byRole=new Map();
    const point=new THREE.Vector3(),normal=new THREE.Matrix3();
    for(const mesh of meshes){
      const g=mesh.geometry,p=g.attributes.position,index=g.index?.array,start=g.drawRange.start,end=Math.min(index?.length??p.count,start+g.drawRange.count),table=g.userData.city?.materialRoles;
      normal.getNormalMatrix(mesh.matrix);
      for(let t=start;t+2<end;t+=3){
        const source=[0,1,2].map(k=>index?index[t+k]:t+k),part=table?g.groups.find(s=>t>=s.start&&t+2<s.start+s.count):null;
        const role=table?.[part?.materialIndex]||mesh.userData.city.materialRoleTable?.[g.attributes.cityMaterialRole?.getX(source[0])]||mesh.userData.city.materialRole;
        if(!byRole.has(role))byRole.set(role,[]);
        for(const i of source){
          const vertex=[];
          for(const name of names){const a=g.attributes[name];if(name==='position')point.fromBufferAttribute(a,i).applyMatrix4(mesh.matrix);if(name==='normal')point.fromBufferAttribute(a,i).applyMatrix3(normal).normalize();for(let k=0;k<a.itemSize;k++)vertex.push(name==='position'||name==='normal'?Math.fround(point.getComponent(k)):a.array[i*a.itemSize+k]);}
          const key=vertex.join(','),existing=vertexIds.get(key);let id=existing;
          if(id===undefined){id=vertexIds.size;vertexIds.set(key,id);let cursor=0;for(const name of names){const a=g.attributes[name];for(let k=0;k<a.itemSize;k++)values[name].push(vertex[cursor++]);}}
          byRole.get(role).push(id);
        }
      }
    }
    const geometry=new THREE.BufferGeometry();for(const name of names){const a=first.geometry.attributes[name];geometry.setAttribute(name,new THREE.BufferAttribute(new a.array.constructor(values[name]),a.itemSize,a.normalized));}
    const roles=[...byRole.keys()].sort(),indices=[];for(const [materialIndex,role]of roles.entries()){const start=indices.length;for(const i of byRole.get(role))indices.push(i);geometry.addGroup(start,indices.length-start,materialIndex);}geometry.setIndex(indices);geometry.userData.city={schemaVersion:1,materialRoles:roles};
    const mesh=new THREE.Mesh(geometry,first.material);mesh.name=low?(first.userData.city.kind==='building'?'Far building silhouettes':`Far ${first.userData.city.kind} batch`):'Batched building bodies';
    mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;
    mesh.userData={...first.userData,generatedFacade:low?false:first.userData.generatedFacade,city:{...first.userData.city,materialRole:first.userData.city.kind==='building'?'wall':first.userData.city.materialRole,shader:low?undefined:first.userData.city.shader,lodRole:low?'far':first.userData.city.lodRole,featureIds:[...new Set(meshes.flatMap(m=>m.userData.city.featureIds))].sort(),sourceIds:[...new Set(meshes.flatMap(m=>m.userData.city.sourceIds))].sort()}};
    for(const m of meshes)group.remove(m);group.add(mesh);
  }
}

export function batchTreeInstances(group) {
  const buckets=new Map();
  for(const mesh of [...group.children]){
    if(!mesh.isInstancedMesh||mesh.userData.city.kind!=='tree')continue;
    const prototype=Object.fromEntries(Object.entries(mesh.geometry.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>[name,[a.itemSize,Array.from(a.array)]]));
    const key=`${mesh.userData.city.materialRole}:${materialKey(mesh.material)}:${canonicalStringify(prototype)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(mesh);
  }
  const matrix=new THREE.Matrix4();
  for(const meshes of buckets.values()){
    const first=meshes[0],ids=[],count=meshes.reduce((s,m)=>s+m.count,0),mesh=new THREE.InstancedMesh(first.geometry,first.material,count);let offset=0;
    for(const m of meshes)for(let i=0;i<m.count;i++){
      m.getMatrixAt(i,matrix);matrix.premultiply(m.matrix);mesh.setMatrixAt(offset,matrix);
      if(m.instanceColor)mesh.setColorAt(offset,new THREE.Color().fromBufferAttribute(m.instanceColor,i));
      ids.push(m.userData.city.instanceFeatureIds[i]);offset++;
    }
    mesh.name=first.name==='Trunks'?'Trunks':'Distant tree crowns';mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;
    mesh.userData={...first.userData,city:{...first.userData.city,featureId:ids[0],featureIds:[...new Set(ids)].sort(),instanceFeatureIds:ids,sourceIds:[...new Set(meshes.flatMap(m=>m.userData.city.sourceIds))].sort()}};
    mesh.computeBoundingBox();mesh.computeBoundingSphere();for(const m of meshes)group.remove(m);group.add(mesh);
  }
}
