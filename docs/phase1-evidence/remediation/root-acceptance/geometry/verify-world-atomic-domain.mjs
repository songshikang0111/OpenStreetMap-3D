import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {compileScene, validateSceneManifest} from '../../src/core/index.js';
import {decodeChunk, sceneStats} from '../../src/core/scene-codec.js';
import {continuityFixture} from '../../test/phase1-core-fixture.js';
const cwd='C:\\Users\\宋世康\\.codex\\worktrees\\phase1-integration\\beijing-city-ink';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fixed=n=>Math.round(n*1e6)/1e6;
function material(mesh,t){const g=mesh.geometry,part=g.groups.find(x=>t>=x.start&&t+2<x.start+x.count),m=Array.isArray(mesh.material)?mesh.material[part?.materialIndex]:mesh.material;return {color:m.color.toArray(),side:m.side,vertexColors:m.vertexColors,transparent:m.transparent,opacity:m.opacity,depthWrite:m.depthWrite};}
function dispose(g){g.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])m.dispose();});}
async function audit(result,lod){
 const records=[],counts={},instanceCounts={},ground=[],surfaceAreas={},surfaceBounds={},casters={triangles:0,drawCalls:0};
 const ids=Object.fromEntries(Object.entries(result.manifest.featureIndex).map(([id,f])=>[f.renderId,id]));
 for(const c of result.manifest.chunks){
  const d=c.lods.find(x=>x.id===lod);if(!d)continue;const group=await decodeChunk(result.assets[d.uri],d);group.updateMatrixWorld(true);
  const stats=sceneStats(group);for(const k of ['triangles','drawCalls','residentBytes','shadowTriangles','shadowDrawCalls'])assert.equal(stats[k],d[k],`${lod}/${c.id}/${k}`);
  casters.triangles+=stats.shadowTriangles;casters.drawCalls+=stats.shadowDrawCalls;
  group.traverseVisible(mesh=>{if(!mesh.isMesh)return;const g=mesh.geometry;
   if(mesh.isInstancedMesh){
    const matrix=new THREE.Matrix4();const prototype=Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>[name,{itemSize:a.itemSize,normalized:a.normalized,array:Array.from(a.array)}]));
    for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);const id=mesh.userData.city.instanceFeatureIds[i];instanceCounts[id]=(instanceCounts[id]||0)+1;records.push(JSON.stringify({instance:id,matrix:matrix.toArray().map(fixed),color:mesh.instanceColor?Array.from(mesh.instanceColor.array.slice(i*3,i*3+3)):null,prototype}));}
    return;
   }
   const ix=g.index?.array,start=g.drawRange.start,end=Math.min(ix?.length??g.attributes.position.count,start+g.drawRange.count),nm=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
   for(let t=start;t+2<end;t+=3){
    if(Array.isArray(mesh.material)&&!g.groups.some(p=>t>=p.start&&t+2<p.start+p.count&&mesh.material[p.materialIndex]))continue;
    const vertices=[0,1,2].map(k=>{const i=ix?ix[t+k]:t+k,p=new THREE.Vector3(),v={};for(const [name,a]of Object.entries(g.attributes)){if(name==='position')v[name]=p.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld).toArray().map(fixed);else if(name==='normal')v[name]=p.fromBufferAttribute(a,i).applyMatrix3(nm).normalize().toArray().map(fixed);else v[name]=Array.from(a.array.slice(i*a.itemSize,(i+1)*a.itemSize));}return v;});
    const id=ids[g.attributes.cityFeature.getX(ix?ix[t]:t)];counts[id]=(counts[id]||0)+1;if(id==='ground')ground.push(vertices.map(v=>v.position));if(['road','ground','water'].includes(mesh.userData.city.kind)){const [a,b,c]=vertices.map(v=>new THREE.Vector3(...v.position));surfaceAreas[id]=(surfaceAreas[id]||0)+b.clone().sub(a).cross(c.clone().sub(a)).length()/2;const xyz=vertices.map(v=>v.position),bounds=[0,1,2].map(k=>Math.min(...xyz.map(p=>p[k]))).concat([0,1,2].map(k=>Math.max(...xyz.map(p=>p[k]))));surfaceBounds[id]=surfaceBounds[id]?surfaceBounds[id].map((v,k)=>k<3?Math.min(v,bounds[k]):Math.max(v,bounds[k])):bounds;}
    const cyclic=[vertices,[vertices[1],vertices[2],vertices[0]],[vertices[2],vertices[0],vertices[1]]].map(JSON.stringify).sort()[0];if(mesh.userData.city.kind==='building')records.push(JSON.stringify({id,vertices:cyclic,material:material(mesh,t),inkClass:mesh.userData.inkClass}));
   }
  });dispose(group);
 }
 records.sort();
 for(const [id,f]of Object.entries(result.manifest.featureIndex)){if(f.kind==='building')assert.ok(counts[id]>0,`${lod} missing building ${id}`);if(f.kind==='tree')assert.equal(instanceCounts[id],2,`${lod} tree crown/trunk count ${id}`);}
 let groundArea=0;for(const [a,b,c]of ground)groundArea+=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;
 if(lod==='low')assert.deepEqual(casters,{triangles:0,drawCalls:0});
 return {surfaceAreas,surfaceBounds,hash:hash(records.join('\n')),records:records.length,groundTriangles:ground.length,groundArea,buildingCount:Object.keys(counts).filter(id=>result.manifest.featureIndex[id]?.kind==='building').length,treeCount:Object.keys(instanceCounts).filter(id=>result.manifest.featureIndex[id]?.kind==='tree').length,casters};
}
const report={date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),command:'node work/root-remediation-geometry/verify-world-atomic-domain.mjs',input:'test/phase1-core-fixture.js (explicit synthetic continuity fixture)',seed:71,environment:{node:process.version,platform:process.platform,arch:process.arch},results:[]};
const {raw,config}=continuityFixture();let base;
for(const divisions of [1,2,4]){
 const result=await compileScene(raw,{...config,tiling:{divisions}});assert.equal(validateSceneManifest(result.manifest).valid,true);const row={tiles:divisions**2,worldHash:result.manifest.hashes.world,levels:{}};
 for(const level of ['low','medium','high'])row.levels[level]=await audit(result,level);
 if(base){assert.equal(row.worldHash,base.worldHash);for(const level of ['low','medium','high']){assert.equal(row.levels[level].hash,base.levels[level].hash,`atomic world data differs ${level}/${divisions}`);assert.deepEqual(Object.keys(row.levels[level].surfaceAreas).sort(),Object.keys(base.levels[level].surfaceAreas).sort());for(const [id,area]of Object.entries(base.levels[level].surfaceAreas)){assert.ok(Math.abs(row.levels[level].surfaceAreas[id]-area)<=Math.max(.01,area*1e-6),`surface area changed ${level}/${divisions}/${id}`);for(let k=0;k<6;k++)assert.ok(Math.abs(row.levels[level].surfaceBounds[id][k]-base.levels[level].surfaceBounds[id][k])<=.01,`surface extent changed ${level}/${divisions}/${id}/${k}`);}}}else base=row;
 report.results.push(row);console.log(JSON.stringify(row));
}
report.endCommit=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();assert.equal(report.endCommit,report.commit,'commit changed during geometry verification');report.status='pass';report.limits=['Small synthetic fixture only; CPU geometry/protocol review, no GPU or browser claim.','Atomic building/instance hash and shared-surface areas/extents are tested; changed surface tessellation is allowed. Local coverage and interpolation are independently tested by mixed-LOD and exact-grid cases.','Does not replace twelve formal real-snapshot performance cases or visual acceptance.'];writeFileSync(new URL('./world-atomic-domain-results.json',import.meta.url),JSON.stringify(report,null,2));


