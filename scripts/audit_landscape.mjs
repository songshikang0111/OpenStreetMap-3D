import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseOSM,mergeOSMOverlay } from '../src/osm.js';
import { buildCity } from '../src/city.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/data/${name}.json`,import.meta.url),'utf8'));
const raw=read('beijing-cbd');
for(const name of ['street-details','landscape-details'])mergeOSMOverlay(raw,read(name),name);
raw.metadata.landscapeProfile=read('landscape-profile');
const data=parseOSM(raw),start=performance.now(),city=buildCity(data);
const stats={generatedAt:new Date().toISOString(),scope:'CPU generation on this machine, not GPU FPS or exact pixel coverage',cpuBuildMs:Math.round(performance.now()-start),buildings:data.buildings.length,roads:data.roads.length,osmGroundUses:data.landscapes.reduce((n,p)=>(n[p.kind]=(n[p.kind]||0)+1,n),{}),landscape:city.landscapeStats,street:city.streetStats,profile:raw.metadata.landscapeProfile};
console.log(JSON.stringify(stats,null,2));
