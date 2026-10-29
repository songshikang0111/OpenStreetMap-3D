import { chinaZunScale } from './building-rules.js';

function faceNormal(a,b,c){const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;return n.map(v=>v/l);}
function skin(writer,lower,upper,y0,y1,color,id,floor=4){
  let offset=0;const lengths=lower.map((p,i)=>Math.hypot(p[0]-lower[(i+1)%lower.length][0],p[1]-lower[(i+1)%lower.length][1])),perimeter=lengths.reduce((a,b)=>a+b,0);
  const sign=lower.reduce((s,p,i)=>s+p[0]*lower[(i+1)%lower.length][1]-lower[(i+1)%lower.length][0]*p[1],0)>0?-1:1;
  for(let i=0;i<lower.length;i++){
    const j=(i+1)%lower.length,a=[...lower[i]],b=[...lower[j]],c=[...upper[j]],d=[...upper[i]],len=lengths[i];
    const points=[[a[0],y0,a[1]],[b[0],y0,b[1]],[c[0],y1,c[1]],[d[0],y1,d[1]]];
    const n=faceNormal(points[0],points[1],points[3]).map(v=>v*sign);
    writer.quad(points,n,color,id,[[offset,y0,perimeter,floor],[offset+len,y0,perimeter,floor],[offset+len,y1,perimeter,floor],[offset,y1,perimeter,floor]]);
    offset+=len;
  }
}
function cap(writer,ring,y,color,id,up=true){
  const c=ring.reduce((a,p)=>[a[0]+p[0]/ring.length,a[1]+p[1]/ring.length],[0,0]);
  for(let i=0;i<ring.length;i++)writer.triangle([c[0],y,c[1]],[ring[i][0],y,ring[i][1]],[ring[(i+1)%ring.length][0],y,ring[(i+1)%ring.length][1]],[0,up?1:-1,0],color,id);
}
function roundedRing(building,scale){
  const xs=building.outer.map(p=>p[0]),zs=building.outer.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
  const x=(Math.max(...xs)-Math.min(...xs))*.5*scale,z=(Math.max(...zs)-Math.min(...zs))*.5*scale,r=Math.min(x,z)*.26,points=[];
  // Counter-clockwise in map coordinates so exterior walls face outward.
  for(let corner=0;corner<4;corner++){
    const signx=corner<2?1:-1,signz=corner===0||corner===3?1:-1;
    const center=[cx+signx*(x-r),cz+signz*(z-r)],start=Math.PI/2-corner*Math.PI/2;
    for(let j=0;j<8;j++){const a=start-j/8*Math.PI/2;points.push([center[0]+Math.cos(a)*r,center[1]+Math.sin(a)*r]);}
  }
  return points;
}

export function buildChinaZun(writer,b,id,addBeam){
  const oldStyle=writer.style;writer.style=6;
  const steps=44,levels=[];for(let i=0;i<=steps;i++)levels.push(roundedRing(b,chinaZunScale(i/steps)));
  for(let i=0;i<steps;i++)skin(writer,levels[i],levels[i+1],.45+b.height*i/steps,.45+b.height*(i+1)/steps,'#a8bcc6',id,4.8);
  // Continuous pale ribs follow the taper instead of becoming rectangular tower seams.
  for(let side=0;side<levels[0].length;side+=2)for(let i=0;i<steps;i++){
    const a=levels[i][side],c=levels[i+1][side];
    addBeam(writer,[a[0],.45+b.height*i/steps,a[1]],[c[0],.45+b.height*(i+1)/steps,c[1]],.48,'#cddade',id);
  }
  writer.style=0;
  const crown=levels.at(-1),inner=roundedRing(b,chinaZunScale(1)*.88);
  for(let i=0;i<crown.length;i++){
    const j=(i+1)%crown.length;
    writer.quad([[crown[i][0],b.height+.45,crown[i][1]],[crown[j][0],b.height+.45,crown[j][1]],[inner[j][0],b.height+.45,inner[j][1]],[inner[i][0],b.height+.45,inner[i][1]]],[0,1,0],'#dce4e4',id);
    const a=inner[i],c=inner[j],n=[-(c[1]-a[1]),0,c[0]-a[0]],length=Math.hypot(...n)||1;
    // Rounded ring winds clockwise, so the well wall faces towards its centre.
    writer.quad([[a[0],b.height-8,a[1]],[c[0],b.height-8,c[1]],[c[0],b.height+.45,c[1]],[a[0],b.height+.45,a[1]]],n.map(v=>-v/length),'#dce4e4',id);
  }
  cap(writer,inner,b.height-7.5,'#536874',id);
  writer.style=oldStyle;
  return {kind:'china-zun',name:'中国尊 · 参数化形体近似',note:'收腰、圆角和竖肋由独立地标规则生成；总高取 OSM 528 m。'};
}

const cctvShifts={548126516:[13,23],548126517:[-21,-11]};
export function cctvOffset(building,y){
  const shift=cctvShifts[building.osmId];return shift?shift.map(v=>v*Math.max(0,Math.min(1,y/building.height))):[0,0];
}
export function cctvRing(building,y){
  if(cctvShifts[building.osmId]){const s=cctvOffset(building,y);return building.outer.map(p=>[p[0]+s[0],p[1]+s[1]]);}
  if(building.osmId===547523487){
    // Connect the sloping legs at the cantilever. The six-point OSM L-shaped part
    // supplies the topology; this interpolation supplies the missing sloped form.
    return building.outer.map(p=>{const t=Math.max(0,Math.min(1,(p[0]-Math.min(...building.outer.map(p=>p[0])))/105));return[p[0]+13*(1-t)-21*t,p[1]+23*(1-t)-11*t];});
  }
  return building.outer;
}

export function buildCctv(writer,b,id,polygon,addBeam){
  writer.style=5;const base=.45+b.minHeight,top=.45+b.height;
  const a=cctvRing(b,b.minHeight),c=cctvRing(b,b.height);
  // Use horizontal rings for cap triangulation (including concave upper L).
  skin(writer,a,c,base,top,'#b0bcc1',id,4.2);
  writer.style=0;polygon(writer,{outer:c,holes:[]},top,'#d7dddc',id);
  if(b.minHeight>0){
    const start=writer.positions.length;polygon(writer,{outer:a,holes:[]},base,'#64767e',id);
    for(let i=start;i<writer.positions.length;i+=9){for(let j=0;j<3;j++)[writer.positions[i+3+j],writer.positions[i+6+j]]=[writer.positions[i+6+j],writer.positions[i+3+j]];for(let j=0;j<3;j++)writer.normals[i+j*3+1]=-1;}
  }
  for(let i=0;i<a.length;i++)addBeam(writer,[a[i][0],base,a[i][1]],[c[i][0],top,c[i][1]],.8,'#667b86',id);
  return {kind:'cctv',name:'央视总部 · 参数化形体近似',note:'基于四个 OSM 分部补充倾斜与连接；空中部件保留 min_height=161 m。'};
}
