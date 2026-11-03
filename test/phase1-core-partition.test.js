import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compileScene,validateSceneManifest} from '../src/core/index.js';
import {decodeChunk} from '../src/core/scene-codec.js';
import {farDeckGeometry} from '../src/core/lod-surfaces.js';
import {lowBuilding,partitionMesh} from '../src/core/geometry.js';
import {continuityFixture} from './phase1-core-fixture.js';

const contains=(triangle,p)=>{const s=triangle.map((a,i)=>{const b=triangle[(i+1)%3];return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);});return s.every(v=>v>1e-7)||s.every(v=>v< -1e-7);};
const patterns=ids=>{
  const all=level=>Object.fromEntries(ids.map(id=>[id,level])),result=[['all-low',all('low')],['all-medium',all('medium')],['all-high',all('high')]];
  for(const id of ids)result.push([`upgrade-medium-${id}`,{[id]:'medium'}],[`upgrade-high-${id}`,{[id]:'high'}],[`downgrade-${id}`,{...all('high'),[id]:'low'}]);
  result.push(['checker',Object.fromEntries(ids.map(id=>[id,id.split('_').reduce((s,n)=>s+Number(n),0)%2?'high':'low']))],['stripes',Object.fromEntries(ids.map(id=>[id,['low','medium','high'][Number(id.split('_')[0])%3]]))]);return result;
};
async function triangles(result,predicate,project=([x,,z])=>[x,z]){
  const output={};for(const chunk of result.manifest.chunks){output[chunk.id]={};for(const d of chunk.lods){
    const g=await decodeChunk(result.assets[d.uri],d),found=[];
    g.traverse(o=>{if(!o.isMesh||o.isInstancedMesh)return;const geometry=o.geometry,p=geometry.attributes.position,f=geometry.attributes.cityFeature,index=geometry.index?.array;for(let i=0;i<(index?.length??p.count);i+=3){const ix=[0,1,2].map(k=>index?index[i+k]:i+k),world=ix.map(i=>new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).toArray());if(predicate(o,f?.getX(ix[0]),world))found.push(world.map(project));}});
    output[chunk.id][d.id]=found;
  }}return output;
}
function sweep(sets,points){
  const ids=Object.keys(sets),full=level=>Object.values(sets).flatMap(s=>s[level]),common=points.filter(p=>['low','medium','high'].every(l=>full(l).filter(t=>contains(t,p)).length===1));assert.ok(common.length>=Math.min(300,points.length),`only ${common.length} common samples`);
  for(const [name,levels]of patterns(ids)){const selected=ids.flatMap(id=>sets[id][levels[id]||'low']);for(const p of common)assert.equal(selected.filter(t=>contains(t,p)).length,1,`${name}: ${p}`);}
  return common.length;
}

test('mixed LOD ground and water: 53 pure, single-swap, checkerboard and striped patterns preserve complete coverage',async()=>{
  const {raw,config}=continuityFixture(),result=await compileScene(raw,{...config,tiling:{divisions:4}}),ground=result.manifest.featureIndex.ground.renderId;
  const sets=await triangles(result,(_o,id)=>id===ground),points=[];for(let x=0;x<30;x++)for(let z=0;z<30;z++)points.push([-300+(x+.37)*20,-300+(z+.61)*20]);assert.equal(sweep(sets,points),900);
  for(const [name,levels]of patterns(Object.keys(sets))){const ts=Object.entries(sets).flatMap(([id,s])=>s[levels[id]||'low']);const area=ts.reduce((s,[a,b,c])=>s+Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2,0);assert.ok(Math.abs(area-360000)<.02,`${name} area ${area}`);}
  const water=await triangles(result,o=>o.userData.city.kind==='water');assert.equal(sweep(water,Array.from({length:300},(_,i)=>[-289+(i+.37)*578/300,40.123])),300);
});

test('mixed LOD road tops: every cell owns its physical domain for all 53 level patterns',async()=>{
  const {raw,config}=continuityFixture();raw.elements=raw.elements.filter(e=>e.type==='node'&&e.id>=1000||e.type==='way'&&e.id===60);
  const result=await compileScene(raw,{...config,tiling:{divisions:4}}),sets=await triangles(result,(o,_id,v)=>o.userData.city.kind==='road'&&v.every(p=>Math.abs(p[1]-.32)<.03));
  assert.equal(sweep(sets,Array.from({length:300},(_,i)=>[-289.123+i*1.927,-88.78+(i%7)*1.01])),300);
  for(const chunk of result.manifest.chunks)for(const d of chunk.lods){const group=await decodeChunk(result.assets[d.uri],d);group.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||o.userData.city.kind!=='road')return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);assert.ok(v.x>=chunk.bounds[0]-.001&&v.x<=chunk.bounds[3]+.001&&v.z>=chunk.bounds[2]-.001&&v.z<=chunk.bounds[5]+.001);}});}
});

test('mixed LOD bridge slab side shells: all 53 patterns keep common physical coverage',async()=>{
  const {raw,config}=continuityFixture();raw.elements=raw.elements.filter(e=>e.type==='node'&&e.id>=1000||e.type==='way'&&[62,63,64].includes(e.id));
  const result=await compileScene(raw,{...config,tiling:{divisions:4}}),id=result.manifest.featureIndex['generated:bridge-deck-thickness-and-soffits'].renderId,sets=await triangles(result,(_o,f,world)=>f===id&&world.every(p=>Math.abs(p[0]-104)<.002),([,y,z])=>[z,y]),points=[];
  for(let i=0;i<100;i++)for(let j=0;j<40;j++)points.push([-280+(i+.37)*5.6,.25+(j+.61)*.2]);assert.ok(sweep(sets,points)>=400);
});

test('parent transforms, reflections, material arrays and instances have matching world bounds at 1/4/16 cells',async()=>{
  const {raw,config}=continuityFixture();raw.elements=raw.elements.filter(e=>e.type==='way'&&e.id===1);
  for(const variant of ['mesh','reflected','materials','instances']){
    let expected;
    const registry={recipes:[],match:()=>[{recipeId:`bounds/${variant}`,recipeVersion:'1',generatorId:'custom',claimedFeatureIds:['w1']}],generate:()=>{
      const group=new THREE.Group();group.matrixAutoUpdate=false;group.matrix.makeRotationY(.3);group.matrix.setPosition(33,4,-17);
      const geometry=new THREE.BoxGeometry(3,8,4),material=new THREE.MeshStandardMaterial();let mesh;
      if(variant==='instances'){mesh=new THREE.InstancedMesh(geometry,material,3);for(let i=0;i<3;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i*40-40,10,0));mesh.userData.city={instanceFeatureIds:['w1','w1','w1']};}
      else{mesh=new THREE.Mesh(geometry,variant==='materials'?Array.from({length:6},()=>new THREE.MeshStandardMaterial()):material);if(variant==='reflected')mesh.scale.x=-1;}
      group.add(mesh);group.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(group,true);expected=[...box.min.toArray(),...box.max.toArray()];return {group,claimedFeatureIds:['w1']};
    }};
    for(const divisions of [1,2,4]){const result=await compileScene(raw,{...config,tiling:{divisions}},{landmarkRegistry:registry});assert.equal(validateSceneManifest(result.manifest).valid,true);const owner=result.manifest.featureIndex.w1.ownerChunk,chunk=result.manifest.chunks.find(c=>c.id===owner);
      for(const d of chunk.lods){const group=await decodeChunk(result.assets[d.uri],d),box=new THREE.Box3();group.traverse(o=>{if(o.isMesh&&o.userData.city.recipeId===`bounds/${variant}`)box.union(new THREE.Box3().setFromObject(o,true));});const actual=[...box.min.toArray(),...box.max.toArray()];for(let i=0;i<6;i++)assert.ok(Math.abs(actual[i]-expected[i])<1e-5,`${variant}/${divisions}/${d.id}: ${actual}`);}
    }
  }
});

test('independent repair review: collinear simplification falls back and bridge caps share the side boundary',()=>{
  const outer=[[0,0],[10,.05],[20,0],[10,-.05],[-10,0],[-5,.05]],mesh=lowBuilding({id:'thin',outer,holes:[],height:5,minHeight:0,tags:{}},new THREE.MeshStandardMaterial(),false);let roof=0;
  const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;for(let i=0;i<p.count;i+=3)if(n.getY(i)>.5){const [a,b,c]=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,i+k));roof+=b.sub(a).cross(c.sub(a)).length()/2;}assert.ok(Math.abs(roof-1.5)<1e-6);
  const g=farDeckGeometry([{roadId:1,level:'7',thickness:.65,polygon:[[0,0],[100,0],[100,8],[50,8.005],[0,8]],y:7}]),pos=g.attributes.position,normal=g.attributes.normal;
  const caps=[],sides=[];for(let i=0;i<pos.count;i++){const point=[pos.getX(i),pos.getY(i),pos.getZ(i)];if(Math.abs(normal.getY(i))>.9)caps.push(point);else sides.push(point);}
  assert.ok(caps.some(p=>p[0]===50&&Math.abs(p[2]-8.005)<1e-5));assert.ok(sides.some(p=>p[0]===50&&Math.abs(p[2]-8.005)<1e-5));
});

test('rounded near-boundary cell candidates preserve complete walls, attributes and one owner per surface point',()=>{
  for(const divisions of [1,2,4])for(const axis of [0,2])for(const tilt of [-1e-17,0,1e-17])for(const offset of [-1e-17,0,1e-17]){
    const cells=[],width=20/divisions;for(let z=0;z<divisions;z++)for(let x=0;x<divisions;x++)cells.push({id:`${x}_${z}`,bounds:[-10+x*width,-10+z*width,-10+(x+1)*width,-10+(z+1)*width]});
    const grid={cells,columns:divisions,at:(x,z)=>`${Math.max(0,Math.min(divisions-1,Math.floor((x+10)/width)))}_${Math.max(0,Math.min(divisions-1,Math.floor((z+10)/width)))}`};
    const points=[[-8,1],[-8,3],[8,3],[-8,1],[8,3],[8,1]],values=points.flatMap(([x,y])=>axis===2?[x,y,offset+x/8*tilt]:[offset+x/8*tilt,y,x]);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(values,3));g.computeVertexNormals();g.setAttribute('cityFeature',new THREE.Uint32BufferAttribute(new Uint32Array(6).fill(1),1));g.setAttribute('uv',new THREE.Float32BufferAttribute(points.flatMap(([x,y])=>[(x+8)/16,(y-1)/2]),2));g.setAttribute('cityMaterialRole',new THREE.Uint8BufferAttribute([0,0,0,1,1,1],1));g.addGroup(0,3,0);g.addGroup(3,3,1);g.userData.city={materialRoles:['road','structure']};
    const materials=[new THREE.MeshStandardMaterial(),new THREE.MeshStandardMaterial()],mesh=new THREE.Mesh(g,materials);mesh.userData.city={kind:'road',featureId:'road',featureIds:['road']};mesh.updateMatrixWorld(true);
    const pieces=partitionMesh(mesh,grid,()=>undefined,[null,'road']),projected=[];let area=0;
    for(const [id,piece]of pieces){assert.equal(piece.material,materials);const p=piece.geometry.attributes.position,uv=piece.geometry.attributes.uv,role=piece.geometry.attributes.cityMaterialRole,f=piece.geometry.attributes.cityFeature,cell=cells.find(c=>c.id===id);
      for(let i=0;i<p.count;i++){const x=p.getComponent(i,axis===2?0:2),y=p.getY(i);assert.ok(Math.abs(uv.getX(i)-(x+8)/16)<1e-6);assert.ok(Math.abs(uv.getY(i)-(y-1)/2)<1e-6);assert.equal(f.getX(i),1);assert.ok(p.getX(i)>=cell.bounds[0]&&p.getX(i)<=cell.bounds[2]&&p.getZ(i)>=cell.bounds[1]&&p.getZ(i)<=cell.bounds[3]);}
      for(let i=0;i<p.count;i+=3){const vertices=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,i+k));area+=new THREE.Triangle(...vertices).getArea();projected.push(vertices.map(v=>[axis===2?v.x:v.z,v.y]));const part=piece.geometry.groups.find(s=>i>=s.start&&i+2<s.start+s.count);assert.ok(part);for(let k=0;k<3;k++)assert.equal(role.getX(i+k),part.materialIndex);}
    }
    assert.ok(Math.abs(area-32)<1e-6,`divisions=${divisions} axis=${axis} tilt=${tilt} offset=${offset}: area ${area}`);
    for(const x of [-7.13,-4.37,-1.21,1.63,4.31,7.17])for(const y of [1.23,1.71,2.29,2.83])assert.equal(projected.filter(t=>contains(t,[x,y])).length,1,`wall ${x},${y} must be covered once`);
  }
});

test('high guardrail exterior area and every source face center survive fixed 1/4/16 cell partitioning',async()=>{
  const {raw,config}=continuityFixture();let baseline;
  for(const divisions of [1,2,4]){
    const result=await compileScene(raw,{...config,tiling:{divisions}}),id=result.manifest.featureIndex['generated:bridge-parapets-and-pedestrian-guardrails'].renderId,faces=[];
    for(const chunk of result.manifest.chunks){const d=chunk.lods.find(d=>d.id==='high'),group=await decodeChunk(result.assets[d.uri],d);group.updateMatrixWorld(true);group.traverse(o=>{if(!o.isMesh||o.isInstancedMesh)return;const g=o.geometry,p=g.attributes.position,f=g.attributes.cityFeature,ix=g.index?.array;for(let i=0;i<(ix?.length??p.count);i+=3)if(f.getX(ix?ix[i]:i)===id)faces.push(new THREE.Triangle(...[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,ix?ix[i+k]:i+k).applyMatrix4(o.matrixWorld))));});}
    const area=faces.reduce((sum,t)=>sum+t.getArea(),0);if(!baseline){baseline={area,faces};continue;}
    assert.ok(Math.abs(area-baseline.area)<.0001,`${divisions**2} cells: ${area} vs ${baseline.area}`);
    const buckets=new Map();for(const face of faces){const b=new THREE.Box3().setFromPoints([face.a,face.b,face.c]).expandByScalar(.00001);for(let x=Math.floor(b.min.x/10);x<=Math.floor(b.max.x/10);x++)for(let y=Math.floor(b.min.y/10);y<=Math.floor(b.max.y/10);y++)for(let z=Math.floor(b.min.z/10);z<=Math.floor(b.max.z/10);z++){const key=`${x},${y},${z}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(face);}}
    for(const source of baseline.faces){const center=source.getMidpoint(new THREE.Vector3()),normal=source.getNormal(new THREE.Vector3()),key=center.toArray().map(v=>Math.floor(v/10)).join(','),near=buckets.get(key)||[];assert.ok(near.some(t=>normal.dot(t.getNormal(new THREE.Vector3()))>.999&&t.closestPointToPoint(center,new THREE.Vector3()).distanceTo(center)<.00001),`missing oriented guardrail center ${center.toArray()}`);}
  }
});
