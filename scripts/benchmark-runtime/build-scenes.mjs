import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compileScene } from '../../src/core/index.js';
import { projection } from '../../src/osm.js';
import { continuityFixture } from '../../test/phase1-core-fixture.js';
const root=path.resolve(process.argv[2]||'work/runtime-fixtures'),only=process.argv.slice(3),hash=b=>createHash('sha256').update(b).digest('hex');
async function save(name,raw,config,sourceHash) {
  if(only.length&&!only.includes(name))return;
  globalThis.gc?.();const before=process.memoryUsage(),start=performance.now(),{manifest,assets,report}=await compileScene(raw,config),buildMs=performance.now()-start;
  const directory=path.join(root,name);await fs.mkdir(directory,{recursive:true});let packageBytes=0;
  for(const [uri,bytes]of Object.entries(assets)){const file=path.join(directory,uri);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);packageBytes+=typeof bytes==='string'?Buffer.byteLength(bytes):bytes.length;}
  const p=projection(config.origin.lat,config.origin.lon),nw=p.point({lat:config.area.north,lon:config.area.west}),se=p.point({lat:config.area.south,lon:config.area.east}),bounds=[nw[0],nw[1],se[0],se[1]];
  manifest.fixture={codec:'CINK-v1',kind:'core-CINK-official-styles',coverageBounds:bounds,tileSizeMeters:config.tiling.sizeMeters||[(bounds[2]-bounds[0])/config.tiling.divisions,(bounds[3]-bounds[1])/config.tiling.divisions],sourceHash,sourceElements:raw.elements.length};
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest));
  const result={name,sourceHash,inputElements:raw.elements.length,inputFeatures:report.counts.features,selectedFeatures:report.counts.buildings,chunks:manifest.chunks.length,packageBytes,buildMs,memoryBefore:before,memoryAfter:process.memoryUsage(),manifestHash:hash(JSON.stringify(manifest)),worldHash:manifest.hashes.world,coverageBounds:bounds,tileSizeMeters:manifest.fixture.tileSizeMeters,counts:report.counts,lods:Object.fromEntries(['low','medium','high'].map(id=>[id,manifest.chunks.reduce((s,c)=>{const d=c.lods.find(l=>l.id===id);for(const k of ['triangles','bytes','residentBytes','drawCalls'])s[k]+=d[k];return s;},{triangles:0,bytes:0,residentBytes:0,drawCalls:0})])),diagnostics:report.diagnostics};
  await fs.writeFile(path.join(directory,'build-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({name,buildMs,counts:report.counts,packageBytes,lods:result.lods}));
}
const synthetic=continuityFixture();for(const divisions of [1,2,4])await save(`core-synthetic-fixed-${divisions*divisions}`,synthetic.raw,{...synthetic.config,tiling:{divisions}},hash(JSON.stringify(synthetic.raw)));
for(const [name,size]of [['beijing-cbd',500],['kyoto-gion',300]]) {
  const text=await fs.readFile(`public/data/${name}.json`,'utf8'),raw=JSON.parse(text),origin={lat:raw.metadata.center[0],lon:raw.metadata.center[1]},p=projection(origin.lat,origin.lon),base={schemaVersion:1,name,origin,seed:1,source:{kind:'local',file:`public/data/${name}.json`}};
  for(const side of [1,2,3]){const half=side*size/2,[south,west]=p.inverse([-half,half]),[north,east]=p.inverse([half,-half]);await save(`core-${name}-grow-${side*side}`,raw,{...base,area:{south,west,north,east},tiling:{sizeMeters:size}},hash(text));}
  const [south,west,north,east]=raw.metadata.bbox;for(const divisions of [1,2,4])await save(`core-${name}-fixed-${divisions*divisions}`,raw,{...base,area:{south,west,north,east},tiling:{divisions}},hash(text));
}
