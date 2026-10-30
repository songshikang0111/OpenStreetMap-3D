import clipping from 'polygon-clipping';
import { area } from './osm.js';

const snap=(polygon,grid)=>{
  const rings=polygon.map(ring=>ring.map(p=>p.map(v=>Math.round(v/grid)*grid))
  .filter((p,i,a)=>!i||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]))
  const valid=ring=>ring?.length>=3&&area(ring)>.000001;
  return valid(rings[0])?[rings[0],...rings.slice(1).filter(valid)]:[];
};

/** Keep host and paint on the same precision grid. A decoration must never
 * prevent the source ground or the rest of a district from loading. */
export function inlayPaint(surface,paint) {
  if(!paint.length)return {pieces:[surface],paint,precision:0,omitted:0};
  for(const precision of [0,.001,.01]) {
    const host=precision?snap(surface,precision):surface;
    let strips=precision?paint.map(p=>snap(p,precision)).filter(p=>p.length):paint;
    if(!host.length)continue;
    try {
      if(precision)strips=strips.flatMap(p=>clipping.intersection(host,p));
      const pieces=clipping.difference(host,...strips);
      return {pieces,paint:strips,precision,omitted:0};
    }catch{/* Retry only this inlay, preserving the rest of the source geometry. */}
  }
  return {pieces:[surface],paint:[],precision:null,omitted:paint.length};
}
