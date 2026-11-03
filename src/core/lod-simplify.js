// Closed-ring RDP. Retained source vertices are never moved, and every omitted
// source vertex stays within tolerance of its replacement segment.
export function simplifyClosedRing(points,tolerance) {
  if(points.length<=3)return points.map(p=>p.slice());
  const dist=(p,a,b)=>{const d=b.map((v,i)=>v-a[i]),s=d.reduce((n,v)=>n+v*v,0),t=Math.max(0,Math.min(1,d.reduce((n,v,i)=>n+(p[i]-a[i])*v,0)/(s||1)));return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));};
  let opposite=1;for(let i=2;i<points.length;i++)if(Math.hypot(...points[i].map((v,k)=>v-points[0][k]))>Math.hypot(...points[opposite].map((v,k)=>v-points[0][k])))opposite=i;
  const open=[...points,points[0]],keep=new Set([0,opposite,points.length]),stack=[[0,opposite],[opposite,points.length]];
  while(stack.length){const [a,b]=stack.pop();let maximum=tolerance,index=-1;for(let i=a+1;i<b;i++){const d=dist(open[i],open[a],open[b]);if(d>maximum){maximum=d;index=i;}}if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}
  const result=[...keep].sort((a,b)=>a-b).slice(0,-1).map(i=>points[i].slice());return result.length>=3?result:points.map(p=>p.slice());
}
