// Closed-ring RDP. Retained source vertices are never moved, and every omitted
// source vertex stays within tolerance of its replacement segment.
import {inside} from '../osm.js';

/** A simplification may change triangulation, never polygon topology. */
export function preservePolygonTopology(original,candidate) {
  const edges=r=>r.map((p,i)=>[p,r[(i+1)%r.length]]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const intersects=(a,b,c,d)=>{
    if(Math.max(a[0],b[0])<Math.min(c[0],d[0])-1e-9||Math.max(c[0],d[0])<Math.min(a[0],b[0])-1e-9||Math.max(a[1],b[1])<Math.min(c[1],d[1])-1e-9||Math.max(c[1],d[1])<Math.min(a[1],b[1])-1e-9)return false;
    return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
  };
  const ringsCross=(a,b)=>edges(a).some(([p,q])=>edges(b).some(([r,s])=>intersects(p,q,r,s))),selfCross=r=>edges(r).some(([a,b],i)=>edges(r).some(([c,d],j)=>j>i+1&&!(i===0&&j===r.length-1)&&intersects(a,b,c,d)));
  const area=r=>r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
  const [outer,...holes]=candidate;
  const invalid=candidate.some((r,i)=>r.length<3||selfCross(r)||Math.abs(area(r))<1e-10||area(r)*area(original[i])<=0)||holes.some(h=>h.some(p=>!inside(p,outer))||ringsCross(h,outer))||holes.some((h,i)=>holes.some((other,j)=>j>i&&(inside(h[0],other)||inside(other[0],h)||ringsCross(h,other))));
  return invalid?original.map(r=>r.map(p=>p.slice())):candidate;
}

export function simplifyClosedRing(points,tolerance) {
  if(points.length>1&&points[0].every((v,i)=>v===points.at(-1)[i]))points=points.slice(0,-1);
  if(points.length<=3)return points.map(p=>p.slice());
  const dist=(p,a,b)=>{const d=b.map((v,i)=>v-a[i]),s=d.reduce((n,v)=>n+v*v,0),t=Math.max(0,Math.min(1,d.reduce((n,v,i)=>n+(p[i]-a[i])*v,0)/(s||1)));return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));};
  let opposite=1;for(let i=2;i<points.length;i++)if(Math.hypot(...points[i].map((v,k)=>v-points[0][k]))>Math.hypot(...points[opposite].map((v,k)=>v-points[0][k])))opposite=i;
  const open=[...points,points[0]],keep=new Set([0,opposite,points.length]),stack=[[0,opposite],[opposite,points.length]];
  while(stack.length){const [a,b]=stack.pop();let maximum=tolerance,index=-1;for(let i=a+1;i<b;i++){const d=dist(open[i],open[a],open[b]);if(d>maximum){maximum=d;index=i;}}if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}
  const result=[...keep].sort((a,b)=>a-b).slice(0,-1).map(i=>points[i].slice());return result.length>=3?result:points.map(p=>p.slice());
}
