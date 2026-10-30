// Deterministic material inventory and camera suggestions for visual QA.
import fs from 'node:fs';
import {parseOSM,mergeOSMOverlay,inside} from '../src/osm.js';
import {buildingStyle} from '../src/building-rules.js';
const raw=JSON.parse(fs.readFileSync('public/data/beijing-cbd.json'));
for(const n of ['street-details','landscape-details'])mergeOSMOverlay(raw,JSON.parse(fs.readFileSync(`public/data/${n}.json`)),n);
const data=parseOSM(raw,1),counts={},grammars={},families={},examples=[];
for(const b of data.buildings){const s=buildingStyle(b,1);for(const [key,object]of [[s.surfaceName,counts],[s.grammar,grammars],[s.family,families]])object[key]=(object[key]||0)+1;}
for(const surface of ['warm-brick','cut-stone','precast-panels','smooth-render','vertical-piers','ceramic-tile']){
  const candidates=data.buildings.filter(b=>b.height>=12&&b.height<=50&&b.area>450&&b.area<3500&&buildingStyle(b).surfaceName===surface);
  let chosen;
  for(const b of candidates){
    const walls=b.outer.map((a,i)=>{const p=b.outer[(i+1)%b.outer.length],length=Math.hypot(p[0]-a[0],p[1]-a[1]);return {a,p,length};}).filter(w=>w.length>18).sort((a,b)=>b.length-a.length);
    for(const w of walls){
      const middle=[(w.a[0]+w.p[0])/2,(w.a[1]+w.p[1])/2],normal=[(w.p[1]-w.a[1])/w.length,-(w.p[0]-w.a[0])/w.length];
      if((middle[0]-b.center[0])*normal[0]+(middle[1]-b.center[1])*normal[1]<0){normal[0]*=-1;normal[1]*=-1;}
      const distance=Math.max(26,Math.min(46,w.length*.8)),camera=[middle[0]+normal[0]*distance+normal[1]*8,middle[1]+normal[1]*distance-normal[0]*8];
      const blocked=[.25,.5,.75,1].some(t=>data.buildings.some(other=>other!==b&&inside([middle[0]+(camera[0]-middle[0])*t,middle[1]+(camera[1]-middle[1])*t],other.outer)));
      if(blocked)continue;
      const y=Math.min(15,b.height*.42);chosen={surface,osmId:b.osmId,grammar:buildingStyle(b).grammar,position:[camera[0],y+2,camera[1]].map(x=>+x.toFixed(3)),target:[middle[0],y,middle[1]].map(x=>+x.toFixed(3))};break;
    }
    if(chosen)break;
  }
  if(chosen)examples.push(chosen);
}
console.log(JSON.stringify({buildings:data.buildings.length,seed:1,counts,grammars,families,examples,scope:'Illustrative inferred styles; explicit OSM material tags take precedence.'},null,2));
