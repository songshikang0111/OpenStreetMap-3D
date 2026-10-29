// All rings in a loft use one reference perimeter. Recomputing the integer
// bay count on each tapered ring makes vertical window groups drift sideways.
export function writeLoftSkin(writer, lower, upper, y0, y1, color, id, floor=4, reference=lower) {
  if(lower.length!==upper.length || lower.length!==reference.length)throw new Error('Loft rings must have matching vertices');
  const lengths=reference.map((p,i)=>Math.hypot(p[0]-reference[(i+1)%reference.length][0],p[1]-reference[(i+1)%reference.length][1]));
  const perimeter=lengths.reduce((a,b)=>a+b,0);
  const sign=lower.reduce((s,p,i)=>s+p[0]*lower[(i+1)%lower.length][1]-lower[(i+1)%lower.length][0]*p[1],0)>0?-1:1;
  let offset=0;
  for(let i=0;i<lower.length;i++){
    const j=(i+1)%lower.length,a=lower[i],b=lower[j],c=upper[j],d=upper[i],len=lengths[i];
    const points=[[a[0],y0,a[1]],[b[0],y0,b[1]],[c[0],y1,c[1]],[d[0],y1,d[1]]];
    const u=points[1].map((v,k)=>v-points[0][k]),v=points[3].map((n,k)=>n-points[0][k]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1;
    writer.quad(points,n.map(v=>v/length*sign),color,id,[[offset,y0,perimeter,floor],[offset+len,y0,perimeter,floor],[offset+len,y1,perimeter,floor],[offset,y1,perimeter,floor]]);
    offset+=len;
  }
}
