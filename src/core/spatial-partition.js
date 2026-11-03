import * as THREE from 'three';

/** Cell-clipped shared surfaces keep the same ownership domain at every LOD.
 * Atomic features bypass clipping. All varyings follow the same edge parameter. */
export function clipPartition(mesh,grid,ownerFor,featureIds) {
  const g=mesh.geometry,index=g.index?.array,attributes=Object.entries(g.attributes),position=g.attributes.position,feature=g.attributes.cityFeature;
  const start=g.drawRange.start,end=Math.min(index?.length??position.count,start+g.drawRange.count),grouped=Array.isArray(mesh.material)||Array.isArray(g.userData.city?.materialRoles),output=new Map(),point=new THREE.Vector3();
  const vertex=i=>{point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);return {world:point.toArray(),values:Object.fromEntries(attributes.map(([name,a])=>[name,Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize))]))};};
  const lerp=(a,b,t,axis,bound)=>{
    const world=a.world.map((v,i)=>v+(b.world[i]-v)*t);world[axis]=bound;
    return {world,values:Object.fromEntries(attributes.map(([name])=>[name,a.values[name].map((v,i)=>v+(b.values[name][i]-v)*t)]))};
  };
  const clip=(polygon,axis,bound,sign)=>{
    const result=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],insideA=sign*(a.world[axis]-bound)>=0,insideB=sign*(b.world[axis]-bound)>=0;if(insideA)result.push(a);if(insideA!==insideB)result.push(lerp(a,b,(bound-a.world[axis])/(b.world[axis]-a.world[axis]),axis,bound));}return result;
  };
  const append=(tile,triangle,materialIndex)=>{
    const a=new THREE.Vector3(...triangle[0].world),b=new THREE.Vector3(...triangle[1].world),c=new THREE.Vector3(...triangle[2].world);if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-18)return;
    if(!output.has(tile))output.set(tile,{values:Object.fromEntries(attributes.map(([name])=>[name,[]])),groups:[],features:new Set()});const target=output.get(tile),offset=target.values.position.length/3;
    for(const v of triangle){for(const [name]of attributes)target.values[name].push(...v.values[name]);target.features.add(featureIds[Math.round(v.values.cityFeature[0])]);}
    if(grouped){const last=target.groups.at(-1);if(last?.materialIndex===materialIndex)last.count+=3;else target.groups.push({start:offset,count:3,materialIndex});}
  };
  for(let t=start;t+2<end;t+=3){
    const part=grouped?g.groups.find(s=>t>=s.start&&t+2<s.start+s.count):null;if(Array.isArray(mesh.material)&&(!part||!mesh.material[part.materialIndex]))continue;
    const ix=[0,1,2].map(k=>index?index[t+k]:t+k),triangle=ix.map(vertex),id=featureIds[feature.getX(ix[0])],owner=ownerFor(id),materialIndex=part?.materialIndex??0;
    if(owner){append(owner,triangle,materialIndex);continue;}
    const xs=triangle.map(v=>v.world[0]),zs=triangle.map(v=>v.world[2]),[left,top]=grid.at(Math.min(...xs),Math.min(...zs)).split('_').map(Number),[right,bottom]=grid.at(Math.max(...xs),Math.max(...zs)).split('_').map(Number);
    for(let z=top;z<=bottom;z++)for(let x=left;x<=right;x++){
      const cell=grid.cells[z*grid.columns+x],[x0,z0,x1,z1]=cell.bounds;
      let polygon=triangle;for(const [axis,bound,sign]of [[0,x0,1],[0,x1,-1],[2,z0,1],[2,z1,-1]]){polygon=clip(polygon,axis,bound,sign);if(polygon.length<3)break;}
      for(let i=1;i<polygon.length-1;i++)append(cell.id,[polygon[0],polygon[i],polygon[i+1]],materialIndex);
    }
  }
  return [...output].map(([tile,data])=>{
    const geometry=new THREE.BufferGeometry();geometry.userData=structuredClone(g.userData);
    for(const [name,a]of attributes)geometry.setAttribute(name,new THREE.BufferAttribute(new a.array.constructor(data.values[name]),a.itemSize,a.normalized));geometry.groups=data.groups;
    const copy=new THREE.Mesh(geometry,mesh.material);copy.name=mesh.name;copy.matrix.copy(mesh.matrixWorld);copy.matrixAutoUpdate=false;copy.matrixWorldNeedsUpdate=true;copy.castShadow=mesh.castShadow;copy.receiveShadow=mesh.receiveShadow;copy.userData={...mesh.userData,city:{...mesh.userData.city,featureIds:[...data.features].sort()}};return [tile,copy];
  });
}
