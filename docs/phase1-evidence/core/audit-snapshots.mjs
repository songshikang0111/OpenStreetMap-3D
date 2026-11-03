import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { compileScene } from '../../../src/core/index.js';
import { decodeChunk } from '../../../src/core/scene-codec.js';
import { projection } from '../../../src/osm.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const hash=x=>createHash('sha256').update(x).digest('hex');
const report={date:'2026-11-03',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,totalMemory:os.totalmem()},method:'CPU scene-package audit; this is not browser/GPU performance evidence.',samples:[]};
const signatures=async result=>{
  const records=[];
  for(const c of result.manifest.chunks){
    const d=c.lods.find(l=>l.id==='medium'),group=await decodeChunk(result.assets[d.uri],d);group.updateMatrixWorld(true);
    group.traverse(mesh=>{
      if(!mesh.isMesh)return;
      if(mesh.isInstancedMesh){for(let i=0;i<mesh.count;i++)records.push(hash(JSON.stringify([mesh.name,mesh.userData.city.instanceFeatureIds[i],Array.from(mesh.instanceMatrix.array.subarray(i*16,i*16+16))])));}
      else {const a=mesh.geometry.attributes.position,index=mesh.geometry.index?.array,v=new THREE.Vector3();for(let i=0;i<(index?.length??a.count);i+=3)records.push(hash(JSON.stringify([mesh.userData.city.materialRole,[0,1,2].map(k=>v.fromBufferAttribute(a,index?index[i+k]:i+k).applyMatrix4(mesh.matrixWorld).toArray())])));}
    });
    const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
  }
  return hash(records.sort().join('\n'));
};
for(const name of ['beijing-cbd','kyoto-gion']){
  const file=`public/data/${name}.json`,text=await fs.readFile(path.join(root,file),'utf8'),raw=JSON.parse(text),[south,west,north,east]=raw.metadata.bbox;
  const origin={lat:raw.metadata.center?.[0]??(south+north)/2,lon:raw.metadata.center?.[1]??(west+east)/2};
  const base={schemaVersion:1,name,area:{south,west,north,east},origin,seed:1,source:{kind:'local',file}};
  let firstHash,firstSignature;
  for(const divisions of [1,2,4]){
    globalThis.gc?.();const start=performance.now(),result=await compileScene(raw,{...base,tiling:{divisions}}),buildMs=performance.now()-start,geometrySignature=await signatures(result);
    firstHash??=result.manifest.hashes.world;firstSignature??=geometrySignature;
    if(result.manifest.hashes.world!==firstHash||geometrySignature!==firstSignature)throw Error(`${name}: fixed coverage changed across tiling.`);
    const lods=Object.fromEntries(['low','medium','high'].map(id=>[id,result.manifest.chunks.reduce((s,c)=>{const d=c.lods.find(d=>d.id===id);for(const k of ['triangles','bytes','residentBytes','drawCalls'])s[k]=(s[k]||0)+d[k];return s;},{})]));
    if(!(lods.low.triangles<lods.medium.triangles&&lods.low.residentBytes<lods.medium.residentBytes&&lods.low.drawCalls<lods.medium.drawCalls))throw Error(`${name}: LOD did not reduce resources.`);
    report.samples.push({name,experiment:'fixed-coverage',divisions,sourceFileSHA256:hash(text),inputElements:raw.elements.length,counts:result.report.counts,worldHash:firstHash,geometrySignature,buildMs,memory:process.memoryUsage(),lods});
    console.log(`${name} ${divisions**2} cells: ${Math.round(buildMs)} ms, low ${lods.low.triangles} / medium ${lods.medium.triangles} triangles`);
    if(process.argv.includes('--write-assets')&&divisions===2){
      const out=path.join(root,'work','phase1-core',name);await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(result.manifest));
      for(const [uri,bytes]of Object.entries(result.assets)){const destination=path.join(out,uri);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);}
    }
  }
  const p=projection(origin.lat,origin.lon);
  const cellSizeMeters=name==='kyoto-gion'?250:500;
  for(const cells of [1,2,3]){
    const half=cells*cellSizeMeters/2,[s,w]=p.inverse([-half,half]),[n,e]=p.inverse([half,-half]);
    if(s<south||w<west||n>north||e>east){report.samples.push({name,experiment:'fixed-physical-cells',cellSizeMeters,cells,status:'not-run',reason:'Requested coverage exceeds source snapshot.'});continue;}
    globalThis.gc?.();const start=performance.now(),result=await compileScene(raw,{...base,area:{south:s,west:w,north:n,east:e},tiling:{sizeMeters:cellSizeMeters}});
    report.samples.push({name,experiment:'fixed-physical-cells',cellSizeMeters,cells,counts:result.report.counts,sourceFileSHA256:hash(text),buildMs:performance.now()-start,lods:Object.fromEntries(['low','medium','high'].map(id=>[id,result.manifest.chunks.reduce((s,c)=>{const d=c.lods.find(d=>d.id===id);for(const k of ['triangles','bytes','residentBytes','drawCalls'])s[k]=(s[k]||0)+d[k];return s;},{})]))});
    console.log(`${name} expanded ${cells}×${cells} physical ${cellSizeMeters} m coverage: ${result.report.counts.buildings} buildings, ${result.report.counts.chunks} chunks`);
  }
}
await fs.writeFile(new URL('./snapshot-audit.json',import.meta.url),`${JSON.stringify(report,null,2)}\n`);
