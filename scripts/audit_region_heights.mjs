import fs from 'node:fs';import {parseOSM} from '../src/osm.js';
for(const [id,file]of [['shanghai','shanghai-lujiazui'],['kyoto','kyoto-gion'],['amsterdam','amsterdam-canals']]){
 const d=parseOSM(JSON.parse(fs.readFileSync('public/data/'+file+'.json'))),known=d.buildings.filter(b=>b.source!=='estimated'),guessed=d.buildings.filter(b=>b.source==='estimated');
 const q=(arr,p)=>{const a=arr.map(b=>b.height).sort((a,b)=>a-b);return a[Math.floor((a.length-1)*p)]};
 const outliers=guessed.map(b=>{const n=known.filter(a=>Math.hypot(a.center[0]-b.center[0],a.center[1]-b.center[1])<150);return {id:b.id,name:b.tags.name,height:b.height,type:b.tags.building,neighbors:n.length,nearbyKnownMedian:q(n,.5)}}).filter(b=>b.neighbors>=5&&b.height>b.nearbyKnownMedian*2);
 fs.writeFileSync('docs/evidence-generalization/'+id+'-height-audit.json',JSON.stringify({known:{count:known.length,p50:q(known,.5),p90:q(known,.9)},estimated:{count:guessed.length,p50:q(guessed,.5),p90:q(guessed,.9)},estimatedOverTwiceLocalMedian:outliers.length,examples:outliers.sort((a,b)=>b.height-a.height).slice(0,10),interpretation:'Outlier heuristic against known-height neighbors within 150m, not proof of factual height error.'},null,2));
}
