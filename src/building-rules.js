import { stableRandom, inside } from './osm.js';

// These are repeatable design guesses, not recovered photographic facades.
export function buildingStyle(building) {
  const tags=building.tags||{}, type=`${tags.building||''} ${tags['building:part']||''} ${tags.office||''}`;
  const random=stableRandom(`${building.id}:facade-v2`);
  let family;
  if (/apartments|residential|dormitory/.test(type)) family='residential';
  else if (building.height>75 || /office|glass|mirror/.test(`${type} ${tags['building:material']||''}`)) family='curtain';
  else if (/commercial|retail|public|school|hospital|industrial/.test(type)||building.area>2200) family='ribbon';
  else family=building.height>19?'residential':'lowrise';
  const palette={curtain:['#aebfc3','#9eafb6','#bac7cc','#b6c4bd'],residential:['#dbd4c8','#d2c8b8','#d1d4cd','#d9cdc4'],ribbon:['#d6d6cd','#d7cbbb','#c9cecc'],lowrise:['#d9d0be','#d2c0ac','#c3c5bd']}[family];
  return {family,code:{curtain:1,residential:2,ribbon:3,lowrise:4}[family],color:palette[Math.floor(random()*palette.length)],variant:random(),
    bay:family==='curtain'?2.4:family==='residential'?3.4:3.9,
    floor:Math.max(2.8,Math.min(5.5,(building.height-building.minHeight)/Math.max(1,building.levels))),
    balcony:family==='residential'&&building.height<80&&random()>.34,
    roof:tags['roof:shape']||'flat'};
}

export function landmarkKind(building) {
  const tags=building.tags||{},name=`${tags.name||''} ${tags['name:en']||''} ${tags.alt_name||''}`;
  if (building.osmId===599547918 || /中国尊|CITIC Tower|China Zun/.test(name)) return 'china-zun';
  if ([547523486,547523487,548126516,548126517].includes(building.osmId)) return 'cctv';
  return null;
}

export function roofEquipment(building) {
  if (landmarkKind(building)||building.area<160||building.minHeight>0||/gabled|hipped|dome|pyramidal/.test(building.tags?.['roof:shape']||'')) return [];
  const rng=stableRandom(`${building.id}:roof`),xs=building.outer.map(p=>p[0]),zs=building.outer.map(p=>p[1]);
  const minx=Math.min(...xs),maxx=Math.max(...xs),minz=Math.min(...zs),maxz=Math.max(...zs),out=[];
  const count=Math.min(6,Math.max(1,Math.floor(building.area/1700)));
  for(let trial=0;trial<40&&out.length<count;trial++){
    const w=2+rng()*3.4,d=2+rng()*3.4,x=minx+(maxx-minx)*(.22+rng()*.56),z=minz+(maxz-minz)*(.22+rng()*.56);
    const points=[];for(const sx of [-1,0,1])for(const sz of [-1,0,1])points.push([x+sx*(w/2+1),z+sz*(d/2+1)]);
    const overlapsHole=building.holes.some(h=>h.some(p=>Math.abs(p[0]-x)<w/2+1&&Math.abs(p[1]-z)<d/2+1));
    if(!overlapsHole&&points.every(p=>inside(p,building.outer)&&!building.holes.some(h=>inside(p,h)))&&!out.some(b=>Math.hypot(x-b.x,z-b.z)<Math.max(w,d)+2))out.push({x,z,w,d,h:1.1+rng()*1.8});
  }
  return out;
}

export function chinaZunScale(t) {
  // Broad base, restrained waist, expanding crown; a shape approximation only.
  return t<.55 ? .71+.29*Math.pow((.55-t)/.55,2) : .71+.24*Math.pow((t-.55)/.45,1.8);
}
