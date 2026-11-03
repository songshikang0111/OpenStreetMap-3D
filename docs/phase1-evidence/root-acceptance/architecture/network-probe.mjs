import {fetchArea} from '../../../../src/data/overpass.js';
import {searchPlaces} from '../../../../src/data/search.js';
import {writeFile} from 'node:fs/promises';
await (await import('node:fs/promises')).mkdir('work/root-acceptance-architecture',{recursive:true});
const area={south:39.9111,west:116.4596,north:39.9119,east:116.4609};
const probes=[['photon',()=>searchPlaces('北京 中国尊',{requestOptions:{timeoutMs:15000,retries:0,minIntervalMs:0}})],['overpass-product-timeout',()=>fetchArea({area,cacheDir:'work/root-acceptance-architecture/live-cache',requestOptions:{retries:0,minIntervalMs:0}})]];
const results=await Promise.all(probes.map(async([name,fn])=>{const t=Date.now();try{const result=await fn();return {name,status:'succeeded',elapsedMs:Date.now()-t,count:Array.isArray(result)?result.length:result.raw.elements.length};}catch(e){return {name,status:'failed',elapsedMs:Date.now()-t,code:e.code,message:e.message,cause:e.cause?.code};}}));
await writeFile(new URL('../../../../work/root-acceptance-architecture/network-results.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),area,results},null,2));console.log(JSON.stringify(results));
