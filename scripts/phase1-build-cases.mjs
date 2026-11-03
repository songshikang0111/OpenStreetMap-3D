import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {projection} from '../src/osm.js';

const repository=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(process.argv[2]==='--case') {
  const {compileScene}=await import('../src/core/index.js');
  const request=JSON.parse(await readFile(process.argv[3],'utf8'));
  const source=await readFile(path.join(repository,request.source)),raw=JSON.parse(source);
  const started=performance.now(),result=await compileScene(raw,request.config);
  await mkdir(request.directory,{recursive:true});let totalBytes=0;
  for(const [relative,bytes] of Object.entries(result.assets)) {const target=path.join(request.directory,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);totalBytes+=Buffer.byteLength(bytes);}
  const manifest=JSON.stringify(result.manifest,null,2);await writeFile(path.join(request.directory,'manifest.json'),manifest);totalBytes+=Buffer.byteLength(manifest);
  const report={name:request.name,source:request.source,sourceHash:hash(source),seed:request.config.seed,config:request.config,inputElements:raw.elements.length,buildMs:performance.now()-started,maxRssKiB:process.resourceUsage().maxRSS,packageBytes:totalBytes,manifestHash:hash(manifest),chunks:result.manifest.chunks.length,features:Object.keys(result.manifest.featureIndex).length,lods:result.manifest.chunks.map(c=>({id:c.id,lods:c.lods.map(l=>({id:l.id,bytes:l.bytes,residentBytes:l.residentBytes,triangles:l.triangles,drawCalls:l.drawCalls}))})),report:result.report};
  await writeFile(path.join(request.directory,'build-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({name:report.name,chunks:report.chunks,features:report.features,buildMs:report.buildMs,packageBytes:totalBytes}));
}else {
  const output=path.resolve(process.argv[2]||path.join(repository,'work/integration-scenes'));
  const selected=process.argv.slice(3),cases=[];
  for(const [location,size] of [['beijing-cbd',500],['kyoto-gion',300]]) {
    const raw=JSON.parse(await readFile(path.join(repository,`public/data/${location}.json`),'utf8'));
    const [south,west,north,east]=raw.metadata.bbox,origin={lat:(south+north)/2,lon:(west+east)/2},p=projection(origin.lat,origin.lon);
    const config={schemaVersion:1,name:location,origin,area:{south,west,north,east},seed:1,source:{kind:'overpass',file:'data/source.json'},generation:{landscapeEnabled:false,inferRoofs:false},tiling:{sizeMeters:size},quality:'balanced',style:{id:'comic',parameters:{}},landmarks:{enabled:true,packages:[]}};
    if(location==='beijing-cbd')for(const divisions of [1,2,4])cases.push({name:`${location}-fixed-${divisions**2}`,source:`public/data/${location}.json`,config:{...config,tiling:{divisions}}});
    for(const side of [1,2,3]) {
      const half=size*side/2,[s,w]=p.inverse([-half,half]),[n,e]=p.inverse([half,-half]);
      cases.push({name:`${location}-grow-${side**2}`,source:`public/data/${location}.json`,config:{...config,area:{south:s,west:w,north:n,east:e},tiling:{sizeMeters:size}}});
    }
  }
  await mkdir(output,{recursive:true});
  const manifest=[];
  for(const item of cases.filter(c=>!selected.length||selected.includes(c.name))) {
    item.directory=path.join(output,item.name);const request=path.join(output,`${item.name}.request.json`);await writeFile(request,JSON.stringify(item,null,2));
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--case',request],{cwd:repository,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${item.name} exited ${code}`)));});
    manifest.push(JSON.parse(await readFile(path.join(item.directory,'build-report.json'),'utf8')));
  }
  await writeFile(path.join(output,'build-summary.json'),JSON.stringify({date:new Date().toISOString(),node:process.version,cases:manifest},null,2));
}
