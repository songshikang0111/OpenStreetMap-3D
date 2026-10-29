import clipping from 'polygon-clipping';
import { area } from './osm.js';

/** Illustrative internal layouts inside observed parking/pitch boundaries. */
export function planLandscapeMarkings(data, plan, { maxStrips = 1800 } = {}) {
  const marks=[];
  for(const feature of data.landscapes || []) {
    if(!['parking','sport'].includes(feature.kind))continue;
    const supported=plan.surfaces.filter(p=>p.id===`osm:${feature.id}`).map(p=>[p.outer,...(p.holes||[])]);
    if(!supported.length)continue;
    const ring=feature.outer;
    let a=ring[0],b=ring[1],length=0;
    ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d>length){a=p;b=q;length=d;}});
    if(length<5)continue;
    const u=[(b[0]-a[0])/length,(b[1]-a[1])/length],v=[-u[1],u[0]];
    const local=ring.map(p=>[(p[0]-a[0])*u[0]+(p[1]-a[1])*u[1],(p[0]-a[0])*v[0]+(p[1]-a[1])*v[1]]);
    const x0=Math.min(...local.map(p=>p[0]))+2,x1=Math.max(...local.map(p=>p[0]))-2,z0=Math.min(...local.map(p=>p[1]))+2,z1=Math.max(...local.map(p=>p[1]))-2;
    const point=(x,z)=>[a[0]+u[0]*x+v[0]*z,a[1]+u[1]*x+v[1]*z];
    const line=(x,z,xx,zz,width=.14)=>{
      if(marks.length>=maxStrips)return;
      const l=Math.hypot(xx-x,zz-z);if(l<.1)return;
      const dx=-(zz-z)/l*width/2,dz=(xx-x)/l*width/2;
      const p=[[point(x+dx,z+dz),point(xx+dx,zz+dz),point(xx-dx,zz-dz),point(x-dx,z-dz)]];
      for(const [outer,...holes]of clipping.intersection(p,supported)){
        if(marks.length>=maxStrips)break;
        if(area(outer)>.015)marks.push({outer,holes,source:'inferred-layout',featureId:`osm:${feature.id}`,osmId:feature.osmId,kind:feature.kind});
      }
    };
    if(feature.kind==='parking') {
      const bus=feature.tags?.bus==='yes',bayWidth=bus?3.8:2.7,bayDepth=bus?12:5;
      if(z1-z0<bayDepth+4||x1-x0<bayWidth*2)continue;
      const rows=[[z0,z0+bayDepth]];
      if(z1-z0>=bayDepth*2+6)rows.push([z1-bayDepth,z1]);
      for(const [start,end]of rows) {
        line(x0,start,x1,start);
        for(let x=x0;x<x1;x+=bayWidth)line(x,start,x,end);
      }
    } else {
      if(x1-x0<10||z1-z0<7)continue;
      // Do not claim regulation dimensions from a general pitch polygon.
      line(x0,z0,x1,z0);line(x1,z0,x1,z1);line(x1,z1,x0,z1);line(x0,z1,x0,z0);
      const cx=(x0+x1)/2,cz=(z0+z1)/2,r=Math.min(5,(z1-z0)*.19);
      line(cx,z0,cx,z1);
      for(let i=0;i<24;i++){const t=i*Math.PI/12,tt=(i+1)*Math.PI/12;line(cx+Math.cos(t)*r,cz+Math.sin(t)*r,cx+Math.cos(tt)*r,cz+Math.sin(tt)*r);}
    }
  }
  return marks;
}
