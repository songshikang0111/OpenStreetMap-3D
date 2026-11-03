import * as THREE from 'three';
import { chinaZunScale, landmarkKind } from '../building-rules.js';
import { cctvRing } from '../landmarks.js';
import { simplifyClosedRing, preservePolygonTopology } from './lod-simplify.js';

function safeFootprint(building) {
  const rings=[building.outer,...building.holes],safe=preservePolygonTopology(rings,rings.map(r=>simplifyClosedRing(r,.15)));
  return {outer:safe[0],holes:safe.slice(1)};
}

export function boundsOf(object) {
  const b=new THREE.Box3().setFromObject(object,true);
  return b.isEmpty()?[0,0,0,0,0,0]:[...b.min.toArray(),...b.max.toArray()];
}

export function lowBuilding(building, material, enabled=true,parameters={},envelope) {
  const kind=enabled?landmarkKind(building):null;
  let geometry;
  if(!kind&&envelope?.neighbors){
    const positions=[],triangle=(a,b,c)=>positions.push(...a,...b,...c);
    for(const [i,source]of [building.outer,...building.holes].entries()){
      const points=source.map(p=>new THREE.Vector2(...p));if(THREE.ShapeUtils.isClockWise(points)!==!!i)points.reverse();const ring=points.map(p=>p.toArray());
      for(let j=0;j<ring.length;j++){
        const a=ring[j],b=ring[(j+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<1e-6)continue;
        for(const span of envelope.wall(a,b,[dz/length,0,-dx/length])){
          const p=[a[0]+dx*span.t0,a[1]+dz*span.t0],q=[a[0]+dx*span.t1,a[1]+dz*span.t1],lo=.45+span.lo,hi=.45+span.hi;
          triangle([p[0],lo,p[1]],[p[0],hi,p[1]],[q[0],hi,q[1]]);triangle([p[0],lo,p[1]],[q[0],hi,q[1]],[q[0],lo,q[1]]);
        }
      }
    }
    for(const [polygons,y,up]of [[envelope.roof,.45+building.height,true],...(building.minHeight>0?[[envelope.bottom,.45+building.minHeight,false]]:[])])for(const rings of polygons){
      const vectors=rings.map(r=>r.map(p=>new THREE.Vector2(...p))),faces=THREE.ShapeUtils.triangulateShape(vectors[0],vectors.slice(1)),all=vectors.flat();
      for(const face of faces){const v=face.map(i=>[all[i].x,y,all[i].y]),signed=(v[1][2]-v[0][2])*(v[2][0]-v[0][0])-(v[1][0]-v[0][0])*(v[2][2]-v[0][2]);if((signed>0)!==up)[v[1],v[2]]=[v[2],v[1]];triangle(...v);}
    }
    geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  }else if(!kind){
    const footprint=safeFootprint(building),shape=new THREE.Shape(footprint.outer.map(([x,z])=>new THREE.Vector2(x,-z)));
    for(const h of footprint.holes)shape.holes.push(new THREE.Path(h.map(([x,z])=>new THREE.Vector2(x,-z))));
    geometry=new THREE.ExtrudeGeometry(shape,{depth:building.height-building.minHeight,bevelEnabled:false,steps:1});
    geometry.rotateX(-Math.PI/2);geometry.translate(0,.45+building.minHeight,0);geometry.clearGroups();
    if(building.minHeight===0){
      const keep=[];for(let i=0;i<geometry.attributes.position.count;i+=3)if(geometry.attributes.normal.getY(i)>-.5)keep.push(i,i+1,i+2);
      const result=new THREE.BufferGeometry();for(const [name,a]of Object.entries(geometry.attributes)){const values=new a.array.constructor(keep.length*a.itemSize);for(let j=0;j<keep.length;j++)for(let k=0;k<a.itemSize;k++)values[j*a.itemSize+k]=a.array[keep[j]*a.itemSize+k];result.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize,a.normalized));}geometry.dispose();geometry=result;
    }
  }else{
    const positions=[];
    const triangle=(a,b,c)=>positions.push(...a,...b,...c);
    const cap=(ring,y,up)=>{
      const points=ring.map(p=>new THREE.Vector2(...p));
      for(const t of THREE.ShapeUtils.triangulateShape(points,[])){
        const v=t.map(i=>[points[i].x,y,points[i].y]);
        const n=new THREE.Vector3().subVectors(new THREE.Vector3(...v[1]),new THREE.Vector3(...v[0])).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...v[2]),new THREE.Vector3(...v[0])));
        if((n.y>0)!==up)[v[1],v[2]]=[v[2],v[1]];triangle(...v);
      }
    };
    const skin=(a,b,lo,hi)=>{
      const clockwise=THREE.ShapeUtils.isClockWise(a.map(p=>new THREE.Vector2(...p)));
      for(let i=0;i<a.length;i++){
        const j=(i+1)%a.length,v=[[a[i][0],lo,a[i][1]],[a[j][0],lo,a[j][1]],[b[j][0],hi,b[j][1]],[b[i][0],hi,b[i][1]]];
        if(clockwise)v.reverse();triangle(v[0],v[2],v[1]);triangle(v[0],v[3],v[2]);
      }
    };
    if(kind==='cctv'){
      const a=cctvRing(building,building.minHeight,parameters.legShifts),b=cctvRing(building,building.height,parameters.legShifts);
      skin(a,b,.45+building.minHeight,.45+building.height);cap(a,.45+building.minHeight,false);cap(b,.45+building.height,true);
    }else{
      const xs=building.outer.map(p=>p[0]),zs=building.outer.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
      const ring=t=>{
        const scale=chinaZunScale(t),x=(Math.max(...xs)-Math.min(...xs))*.5*scale,z=(Math.max(...zs)-Math.min(...zs))*.5*scale,r=Math.min(x,z)*.26,points=[];
        for(let corner=0;corner<4;corner++)for(let j=0;j<3;j++){
          const sx=corner<2?1:-1,sz=corner===0||corner===3?1:-1,a=Math.PI/2-corner*Math.PI/2-j/3*Math.PI/2;
          points.push([cx+sx*(x-r)+Math.cos(a)*r,cz+sz*(z-r)+Math.sin(a)*r]);
        }return points;
      };
      for(let i=0;i<10;i++)skin(ring(i/10),ring((i+1)/10),.45+building.height*i/10,.45+building.height*(i+1)/10);
      cap(ring(0),.45,false);cap(ring(1),.45+building.height,true);
    }
    geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  }
  const mesh=new THREE.Mesh(geometry,material);mesh.name=building.tags.name||building.id;mesh.castShadow=true;mesh.receiveShadow=true;
  return mesh;
}

/** Fixed world lattice, built once, shared by all levels and all tiling schemes. */
export function groundMesh(bounds,spacing=50) {
  const [x0,z0,x1,z1]=bounds,positions=[];
  for(let z=z0;z<z1;z+=spacing)for(let x=x0;x<x1;x+=spacing){
    const b=Math.min(x+spacing,x1),d=Math.min(z+spacing,z1);
    positions.push(x,0,z,x,0,d,b,0,d,x,0,z,b,0,d,b,0,z);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:'#d8d4c7',roughness:1}));mesh.name='Shared flat ground / no DEM';mesh.receiveShadow=true;mesh.userData.inkClass=5;return mesh;
}

/** Keep exact shared surface triangles. Ownership uses a centroid, not a new
 * clipping endpoint or a new independently solved grade. Content bounds include
 * overhang; SDKs must cull/load by contentBounds rather than nominal cells. */
export function partitionMesh(mesh, grid, ownerFor, featureIds) {
  const output=new Map(),g=mesh.geometry;
  if(mesh.isInstancedMesh){
    const matrix=new THREE.Matrix4();
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);const id=mesh.userData.city.instanceFeatureIds[i],point=new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);
      const tile=ownerFor(id)||grid.at(point.x,point.z);if(!output.has(tile))output.set(tile,[]);output.get(tile).push(i);
    }
    return [...output].map(([tile,indices])=>{
      let geometry=g;
      if(Object.values(g.attributes).some(a=>a.isInstancedBufferAttribute)){
        geometry=g.clone();
        for(const [name,a]of Object.entries(g.attributes))if(a.isInstancedBufferAttribute){
          const values=new a.array.constructor(indices.length*a.itemSize);
          for(let j=0;j<indices.length;j++)for(let k=0;k<a.itemSize;k++)values[j*a.itemSize+k]=a.array[Math.floor(indices[j]/a.meshPerAttribute)*a.itemSize+k];
          geometry.setAttribute(name,new THREE.InstancedBufferAttribute(values,a.itemSize,a.normalized,1));
        }
      }
      const copy=new THREE.InstancedMesh(geometry,mesh.material,indices.length);
      for(let j=0;j<indices.length;j++){
        mesh.getMatrixAt(indices[j],matrix);copy.setMatrixAt(j,matrix);
        if(mesh.instanceColor)copy.setColorAt(j,new THREE.Color().fromBufferAttribute(mesh.instanceColor,indices[j]));
      }
      copy.name=mesh.name;copy.matrix.copy(mesh.matrixWorld);copy.matrixAutoUpdate=false;copy.castShadow=mesh.castShadow;copy.receiveShadow=mesh.receiveShadow;
      const ids=indices.map(i=>mesh.userData.city.instanceFeatureIds[i]);copy.userData={...mesh.userData,city:{...mesh.userData.city,featureIds:[...new Set(ids)].sort(),instanceFeatureIds:ids}};
      copy.computeBoundingBox();copy.computeBoundingSphere();return [tile,copy];
    });
  }
  const index=g.index?.array,total=index?.length??g.attributes.position.count,feature=g.attributes.cityFeature;
  const point=new THREE.Vector3();
  const start=g.drawRange.start,end=Math.min(total,start+g.drawRange.count),multi=Array.isArray(mesh.material);
  for(let t=start;t+2<end;t+=3){
    if(multi&&!g.groups.some(s=>t>=s.start&&t+2<s.start+s.count&&mesh.material[s.materialIndex]))continue;
    const ix=[0,1,2].map(k=>index?index[t+k]:t+k),id=featureIds[feature.getX(ix[0])];
    let tile=ownerFor(id);
    if(!tile){let x=0,z=0;for(const i of ix){point.fromBufferAttribute(g.attributes.position,i).applyMatrix4(mesh.matrixWorld);x+=point.x/3;z+=point.z/3;}tile=grid.at(x,z);}
    if(!output.has(tile)){const indices=[];indices.sourceTriangles=[];output.set(tile,indices);}output.get(tile).push(...ix);output.get(tile).sourceTriangles.push(t);
  }
  return [...output].map(([tile,indices])=>{
    const geometry=new THREE.BufferGeometry();
    geometry.userData=structuredClone(g.userData);
    for(const [name,a]of Object.entries(g.attributes)){
      if(a.isInstancedBufferAttribute)continue;
      const values=new a.array.constructor(indices.length*a.itemSize);
      for(let j=0;j<indices.length;j++)for(let k=0;k<a.itemSize;k++)values[j*a.itemSize+k]=a.array[indices[j]*a.itemSize+k];
      geometry.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize,a.normalized));
    }
    // Preserve multi-role materials on generator geometries when de-indexing.
    if(multi||Array.isArray(g.userData.city?.materialRoles)){
      for(const source of g.groups){
        let run=null;
        for(let i=0;i<indices.sourceTriangles.length;i++){
          const t=indices.sourceTriangles[i];if(t<source.start||t+2>=source.start+source.count){run=null;continue;}
          if(run&&run.start+run.count===i*3)run.count+=3;
          else {run={start:i*3,count:3,materialIndex:source.materialIndex};geometry.groups.push(run);}
        }
      }
    }
    const copy=new THREE.Mesh(geometry,mesh.material);copy.name=mesh.name;copy.matrix.copy(mesh.matrixWorld);copy.matrixAutoUpdate=false;copy.castShadow=mesh.castShadow;copy.receiveShadow=mesh.receiveShadow;
    const ids=[...new Set(indices.map(i=>featureIds[feature.getX(i)]))].sort();copy.userData={...mesh.userData,city:{...mesh.userData.city,featureIds:ids}};return [tile,copy];
  });
}

/** Low-level building batches keep a per-vertex render ID for selection. */
export function mergeLowBuildings(group) {
  const buckets=new Map();
  for(const mesh of [...group.children]){
    if(mesh.isInstancedMesh||mesh.userData.city.kind!=='building')continue;
    const key=mesh.userData.city.materialRole;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(mesh);
  }
  for(const [role,meshes]of buckets){
    const geometry=new THREE.BufferGeometry(),names=['position','normal','color','cityFeature','cityMaterialRole','objectId'];
    for(const name of names){
      const size=name==='cityFeature'||name==='cityMaterialRole'?1:3,values=[];
      for(const mesh of meshes){
        const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry,a=g.attributes[name];
        const point=new THREE.Vector3(),normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrix);
        for(let i=0;i<g.attributes.position.count;i++){
          if(name==='position')point.fromBufferAttribute(a,i).applyMatrix4(mesh.matrix);
          if(name==='normal')point.fromBufferAttribute(a,i).applyMatrix3(normalMatrix).normalize();
          for(let k=0;k<size;k++)values.push(name==='position'||name==='normal'?point.getComponent(k):a?a.array[i*size+k]:name==='color'?1:0);
        }
        if(g!==mesh.geometry)g.dispose();
      }
      geometry.setAttribute(name,name==='cityFeature'?new THREE.Uint32BufferAttribute(values,1):name==='cityMaterialRole'?new THREE.Uint8BufferAttribute(values,1):new THREE.Float32BufferAttribute(values,size));
    }
    // Batch by semantic role as well as building family. Re-indexing keeps
    // source vertices/IDs intact and costs one draw per role, not per facade.
    const roleIndices=new Map();let offset=0;
    for(const mesh of meshes){
      const g=mesh.geometry,index=g.index?.array,total=index?.length??g.attributes.position.count,table=g.userData.city?.materialRoles,attribute=g.attributes.cityMaterialRole;
      for(let t=0;t+2<total;t+=3){
        const part=table?g.groups.find(group=>t>=group.start&&t+2<group.start+group.count):null;
        const role=table?.[part?.materialIndex]||mesh.userData.city.materialRoleTable?.[attribute?.getX(index?index[t]:t)]||mesh.userData.city.materialRole;
        if(!roleIndices.has(role))roleIndices.set(role,[]);roleIndices.get(role).push(offset+t,offset+t+1,offset+t+2);
      }
      offset+=total;
    }
    const roles=[...roleIndices.keys()].sort(),indices=[];
    for(const [materialIndex,role]of roles.entries()){const entries=roleIndices.get(role),start=indices.length;for(const index of entries)indices.push(index);geometry.addGroup(start,entries.length,materialIndex);}
    geometry.setIndex(indices);geometry.userData.city={schemaVersion:1,materialRoles:roles};
    const merged=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9}));merged.name='Far building silhouettes';merged.receiveShadow=true;
    merged.userData={inkClass:1,city:{schemaVersion:1,kind:'building',materialRole:role,lodRole:'far',materialRoleTable:meshes[0].userData.city.materialRoleTable,materialRoleAttribute:'cityMaterialRole',featureIds:[...new Set(meshes.flatMap(m=>m.userData.city.featureIds))].sort(),sourceIds:[...new Set(meshes.flatMap(m=>m.userData.city.sourceIds))].sort()}};
    for(const mesh of meshes)group.remove(mesh);group.add(merged);
  }
}
