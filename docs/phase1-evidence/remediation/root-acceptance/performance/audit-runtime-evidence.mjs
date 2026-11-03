import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const filename=new URL('../../../../../docs/phase1-evidence/remediation/runtime/browser-after.json',import.meta.url),bytes=await fs.readFile(filename),raw=JSON.parse(bytes),results=[];
for(const c of raw.cases){
 const frames=c.frames.filter(f=>f.frame),firstGeometry=c.frames.findIndex(f=>f.current.length),afterFirst=c.frames.slice(firstGeometry),maxTriangles=Math.max(...frames.map(f=>f.frame.triangles)),maxCalls=Math.max(...frames.map(f=>f.frame.drawCalls)),missing=afterFirst.filter(f=>f.missing.length||!f.current.length).length,over=frames.filter(f=>f.frame.triangles>600000||f.frame.drawCalls>1200).length;
 assert.equal(maxTriangles,c.summary.maxTriangles);assert.equal(maxCalls,c.summary.maxDrawCalls);assert.equal(over,0);assert.equal(missing,0);assert.equal(c.final.runtime.swaps,1);assert.equal(c.final.runtime.cancelled,0);
 const urls={};for(const r of c.requests)urls[r.url]=(urls[r.url]||0)+1;assert.equal(Math.max(...Object.values(urls)),1);
 assert.equal(c.disposed.runtime.geometryArrayBytes,0);assert.equal(c.disposed.runtime.estimatedResidentBytes,0);assert.equal(c.disposed.runtime.standbyChunks,0);assert.equal(c.disposed.rendering.gpuTime.unreleased,0);
 if([13,19].includes(c.pose.t))assert(c.heldMs>=15000);
 results.push({targetTime:c.pose.t,heldMs:c.heldMs,recordedFrames:c.frames.length,renderedRecords:frames.length,initialLoadingSamples:firstGeometry,maxTriangles,maxCalls,over,missingAfterFirstGeometry:missing,swaps:c.final.runtime.swaps,cancelled:c.final.runtime.cancelled,estimatedResidentBytes:c.final.runtime.estimatedResidentBytes,nearDetails:c.final.runtime.nearDetails+c.final.nearAttachments.nearDetails,maxRequestsPerUrl:Math.max(...Object.values(urls)),gpuQueryErrors:c.final.rendering.gpuTime.errors,disposeResidency:c.disposed.runtime.estimatedResidentBytes});
}
for(const strength of raw.ao){assert.equal(strength.actual,strength.requested);assert.equal(strength.enabled,strength.quality==='balanced');}
const result={mode:'Independent recomputation of saved D browser evidence; no browser/GPU launched',productCommit:raw.productCommit,browserVersion:raw.browserVersion,rawSha256:createHash('sha256').update(bytes).digest('hex'),results};
const rerunDirectory=new URL('../../../../../work/root-remediation-performance-rerun/',import.meta.url);await fs.mkdir(rerunDirectory,{recursive:true});await fs.writeFile(new URL('runtime-evidence-audit.json',rerunDirectory),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
