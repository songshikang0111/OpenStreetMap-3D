// Run after scripts/phase1-build-cases.mjs. CPU package evidence, never GPU timing.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {decodeChunk,sceneStats} from '../../../../src/core/scene-codec.js';
import {validateSceneManifest} from '../../../../src/core/index.js';
import {bindSceneStyle} from '../../../../src/styles/index.js';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const directory=path.resolve(root,process.argv[2]||'work/core-repair-final');
const output=path.resolve(root,process.argv[3]||'docs/phase1-evidence/remediation/core/cost-summary.json');
const hash=x=>createHash('sha256').update(x).digest('hex');
const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const summary=await readJSON(path.join(directory,'build-summary.json'));
assert.equal(summary.cases.length,12,'Use all official 12 cases without coverage changes');
assert.equal(new Set(summary.cases.map(c=>c.compilerCommit)).size,1,'All cases must use one frozen compiler commit');
const fields=['triangles','drawCalls','shadowTriangles','shadowDrawCalls','nearDetails','instances','residentBytes'];
const report={date:new Date().toISOString(),auditCommit:commit,node:process.version,
  method:'CPU: decode every chunk/LOD, verify descriptor costs, bind comic materials and recount. No frustum culling, no runtime attachments. This is not measured whole-frame WebGL or AC18/20 acceptance.',
  frameAssumption:{triangles:'4 * main triangles + actual castShadow triangles + 6 fullscreen triangles',drawCalls:'4 * main draws + actual castShadow draws + 3 fullscreen draws',
    note:'Conservative comic pipeline submission bound before scene/light-frustum culling. A single-pass quantity must not be presented as an entire-frame measurement.'},
  budget:{triangles:600000,drawCalls:1200,residentBytes:128*1024*1024},cases:[]};
const fixed=new Map();
const round=n=>Number(n.toFixed(5));
function dispose(group){const gs=new Set(),ms=new Set();group.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])ms.add(m);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();}
for(const built of summary.cases){
  const folder=path.join(directory,built.name),manifest=await readJSON(path.join(folder,'manifest.json'));
  assert.equal(validateSceneManifest(manifest).valid,true,built.name);
  const renderIds=new Map(Object.values(manifest.featureIndex).map(f=>[f.renderId,f.featureId]));
  const identity=Object.values(manifest.featureIndex).map(({ownerChunk,chunkIds,...rest})=>rest).sort((a,b)=>a.featureId.localeCompare(b.featureId));
  const entry={name:built.name,compilerCommit:built.compilerCommit,source:built.source,sourceHash:built.sourceHash,seed:built.seed,config:built.config,
    inputElements:built.inputElements,chunks:built.chunks,features:built.features,counts:built.report.counts,worldHash:manifest.hashes.world,
    identitySHA256:hash(JSON.stringify(identity)),buildMs:built.buildMs,maxRssKiB:built.maxRssKiB,packageBytes:built.packageBytes,lods:{}};
  for(const level of ['low','medium','high']){
    const totals=Object.fromEntries([...fields,'bytes'].map(k=>[k,0])),records=[],present=new Set(),meshCosts=new Map();
    for(const chunk of manifest.chunks){
      const d=chunk.lods.find(d=>d.id===level);assert.ok(d,`${built.name}/${chunk.id}/${level}`);
      const group=await decodeChunk(await readFile(path.join(folder,d.uri)),d),actual=sceneStats(group);
      for(const k of fields){assert.equal(actual[k],d[k],`${built.name}/${chunk.id}/${level}/${k}`);totals[k]+=actual[k];}totals.bytes+=d.bytes;
      const binding=bindSceneStyle(group,{style:manifest.style});
      const styled=sceneStats(group);for(const k of ['triangles','drawCalls','shadowTriangles','shadowDrawCalls','nearDetails'])assert.equal(styled[k],actual[k],`comic ${k}`);
      group.updateMatrixWorld(true);
      group.traverse(o=>{
        if(!o.isMesh)return;
        const city=o.userData.city,cost=sceneStats(o),key=`${city.kind}/${o.name}`;
        meshCosts.set(key,(meshCosts.get(key)||0)+cost.triangles);
        if(!['building','tree'].includes(city.kind))return;
        for(const id of city.featureIds||[])present.add(id);
        if(o.isInstancedMesh){
          const prototype=hash(JSON.stringify(Object.fromEntries(Object.entries(o.geometry.attributes).map(([n,a])=>[n,[a.itemSize,Array.from(a.array)]]))));
          const matrix=new THREE.Matrix4();for(let i=0;i<o.count;i++){
            const id=city.instanceFeatureIds[i];present.add(id);o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);
            records.push(hash(JSON.stringify([id,city.materialRole,prototype,matrix.toArray().map(round),o.instanceColor?Array.from(o.instanceColor.array.subarray(i*3,i*3+3)):null])));
          }
        }else{
          const g=o.geometry,p=g.attributes.position,f=g.attributes.cityFeature,role=g.attributes.cityMaterialRole,ix=g.index?.array,v=new THREE.Vector3();
          for(let i=0;i<(ix?.length??p.count);i+=3){
            const ids=[0,1,2].map(k=>ix?ix[i+k]:i+k),id=renderIds.get(f.getX(ids[0]));
            present.add(id);records.push(hash(JSON.stringify([id,role?.getX(ids[0]),ids.map(j=>v.fromBufferAttribute(p,j).applyMatrix4(o.matrixWorld).toArray().map(round))])));
          }
        }
      });
      binding.dispose();dispose(group);
    }
    for(const f of Object.values(manifest.featureIndex))if(['building','tree'].includes(f.kind))assert.ok(present.has(f.featureId),`${built.name}/${level} missing ${f.featureId}`);
    const frameUpperBound={triangles:4*totals.triangles+totals.shadowTriangles+6,drawCalls:4*totals.drawCalls+totals.shadowDrawCalls+3};
    entry.lods[level]={...totals,comicFrameUpperBound:frameUpperBound,atomicWorldGeometrySHA256:hash(records.sort().join('\n')),meshTriangles:Object.fromEntries([...meshCosts].sort((a,b)=>b[1]-a[1]))};
    if(level==='low'){
      assert.equal(totals.shadowTriangles,0);assert.equal(totals.shadowDrawCalls,0);
      assert.ok(frameUpperBound.triangles<=report.budget.triangles,`${built.name} low frame triangles ${frameUpperBound.triangles}`);
      assert.ok(frameUpperBound.drawCalls<=report.budget.drawCalls,`${built.name} low frame draws ${frameUpperBound.drawCalls}`);
      assert.ok(totals.residentBytes<=report.budget.residentBytes,`${built.name} low resident bytes`);
    }
  }
  if(built.name.includes('-fixed-')){
    const location=built.name.split('-fixed-')[0],baseline=fixed.get(location);
    if(baseline){assert.equal(entry.worldHash,baseline.worldHash);assert.equal(entry.identitySHA256,baseline.identitySHA256);for(const level of ['low','medium','high'])assert.equal(entry.lods[level].atomicWorldGeometrySHA256,baseline.lods[level].atomicWorldGeometrySHA256,`${built.name}/${level} atomic geometry changed`);}
    else fixed.set(location,entry);
  }
  report.cases.push(entry);console.log(`${entry.name}: low ${entry.lods.low.triangles}/${entry.lods.low.drawCalls}; frame bound ${entry.lods.low.comicFrameUpperBound.triangles}/${entry.lods.low.comicFrameUpperBound.drawCalls}`);
}
await writeFile(output,JSON.stringify(report,null,2)+'\n');
