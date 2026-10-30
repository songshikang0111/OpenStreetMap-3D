import * as THREE from 'three';
import clipping from 'polygon-clipping';
import { area, inside, stableRandom } from './osm.js';
import { buildingStyle, landmarkKind, roofEquipment } from './building-rules.js';
import { buildChinaZun, buildCctv } from './landmarks.js';
import { buildStreetLife } from './streetlife.js';
import { buildRoadSurface } from './road-surface.js';
import { facadeLayout, nearbyFacadeFrames } from './facade-layout.js';
import { installFacadeShader } from './facade-shader.js';
import { buildLandscape } from './landscape.js';
import { updateRoofDetails } from './distance-style.js';
import { planBuildingEnvelopes } from './building-envelope.js';

class MeshWriter {
  constructor() { this.positions = []; this.normals = []; this.colors = []; this.facades = []; this.ids = []; this.styles=[]; this.style=0; this.variant=0; this.layouts=[]; this.layout=[0,0,0,0]; this.surfaces=[];this.surface=[0,1]; }
  triangle(a, b, c, normal, color, id = 0, uv = null) {
    const ab = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a));
    const ac = new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a));
    if (ab.cross(ac).dot(new THREE.Vector3(...normal)) < 0) { [b, c] = [c, b]; if (uv) uv = [uv[0], uv[2], uv[1]]; }
    const col = color.isColor ? color : new THREE.Color(color);
    const code = [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255];
    [a, b, c].forEach((p, i) => {
      this.positions.push(...p); this.normals.push(...normal); this.colors.push(col.r, col.g, col.b);
      this.ids.push(...code); this.facades.push(...(uv ? uv[i] : [0, 0, 0, 0]));
      this.styles.push(this.style,this.variant);
      this.layouts.push(...this.layout);
      this.surfaces.push(...this.surface);
    });
  }
  quad(points, normal, color, id = 0, uv = null) {
    for (const ix of [[0, 1, 2], [0, 2, 3]]) this.triangle(...ix.map(i => points[i]), normal, color, id, uv && ix.map(i => uv[i]));
  }
  geometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.facades, 4));
    geo.setAttribute('objectId', new THREE.Float32BufferAttribute(this.ids, 3));
    geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.styles, 2));
    geo.setAttribute('aLayout', new THREE.Float32BufferAttribute(this.layouts, 4));
    geo.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.surfaces, 2));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
  mesh(material, name) {
    const mesh = new THREE.Mesh(this.geometry(), material); mesh.name = name;
    mesh.receiveShadow = true; mesh.castShadow = true; return mesh;
  }
}

function normalizedRing(ring, clockwise = false) {
  const points = ring.map(p => new THREE.Vector2(...p));
  if (THREE.ShapeUtils.isClockWise(points) !== clockwise) points.reverse();
  return points.map(p => p.toArray());
}

function polygon(writer, feature, y, color, id = 0) {
  const outer = feature.outer.map(p => new THREE.Vector2(...p));
  const holes = (feature.holes || []).map(h => h.map(p => new THREE.Vector2(...p)));
  // triangulateShape removes repeated closing vertices in-place. Build its
  // index lookup afterwards, including for closed boolean-clipping results.
  const triangles = THREE.ShapeUtils.triangulateShape(outer, holes);
  const all = [...outer, ...holes.flat()];
  for (const t of triangles) writer.triangle(...t.map(i => [all[i].x, y, all[i].y]), [0, 1, 0], color, id);
}

function orientedBox(writer,center,axes,dimensions,color,id=0){
  const old=writer.style;writer.style=0;
  const p=([x,y,z])=>center.map((v,k)=>v+axes[0][k]*x*dimensions[0]/2+axes[1][k]*y*dimensions[1]/2+axes[2][k]*z*dimensions[2]/2);
  const signs=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],points=signs.map(p);
  for(const [ix,axis,sign]of [[[0,1,2,3],2,-1],[[4,7,6,5],2,1],[[0,4,5,1],1,-1],[[3,2,6,7],1,1],[[0,3,7,4],0,-1],[[1,5,6,2],0,1]])writer.quad(ix.map(i=>points[i]),axes[axis].map(v=>v*sign),color,id);
  writer.style=old;
}
function addBox(writer,center,dimensions,color,id=0,angle=0){const c=Math.cos(angle),s=Math.sin(angle);orientedBox(writer,center,[[c,0,-s],[0,1,0],[s,0,c]],dimensions,color,id);}
function addBeam(writer,a,b,width,color,id=0){
  const y=new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a)),length=y.length();if(length<.001)return;y.normalize();
  const ref=Math.abs(y.z)<.9?new THREE.Vector3(0,0,1):new THREE.Vector3(1,0,0),x=new THREE.Vector3().crossVectors(y,ref).normalize(),z=new THREE.Vector3().crossVectors(x,y).normalize();
  orientedBox(writer,a.map((v,i)=>(v+b[i])/2),[x.toArray(),y.toArray(),z.toArray()],[width,length,width],color,id);
}

function facadeMaterial(shared) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .76, metalness: .04 });
  material.onBeforeCompile = shader => installFacadeShader(shader,shared);
  material.customProgramCacheKey = () => 'city-ink-facade-v6-materials';
  return material;
}

export function buildCity(data, { landscapeEnabled = true } = {}) {
  const group = new THREE.Group(); group.name = 'Beijing CBD — OpenStreetMap';
  const shared = { windows: { value: 1 }, provenance: { value: 0 }, facadeDetail: {value:.5}, glassReflection: {value:.65}, toneSize:{value:4.2}, sunDirection:{value:new THREE.Vector3(.5,.707,-.5)}, projectionScale:{value:1000} };
  const material = facadeMaterial(shared);
  const baseMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98 });
  const [x0,z0,x1,z1] = data.bounds;
  const base = new THREE.Mesh(new THREE.BoxGeometry(x1-x0+34,14,z1-z0+34), new THREE.MeshStandardMaterial({color:'#d8d4c7',roughness:1}));
  base.position.set((x0+x1)/2,-7,(z0+z1)/2); base.receiveShadow = true; base.name = 'Flat ground / no DEM'; base.userData.inkClass=5; group.add(base);
  const groundWriter = new MeshWriter();
  const groundFrame=[[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]];
  for (const feature of data.water) for(const [outer,...holes] of clipping.intersection([feature.outer,...(feature.holes||[])],groundFrame)) polygon(groundWriter, {outer,holes}, .22, '#8dacae', 60001);
  const landCover=groundWriter.mesh(baseMaterial,'Land cover');landCover.userData.inkClass=5;group.add(landCover);
  const roadSurface=buildRoadSurface(data);group.add(roadSurface.group);
  const landscape=buildLandscape(data,{roadPlan:roadSurface.plan,seed:data.seed||1,profile:{...data.metadata?.landscapeProfile,enabled:landscapeEnabled}});
  group.add(landscape.group);

  const buildings=[],nearWalls=[],landmarks=[],familyCounts={},grammarCounts={},surfaceCounts={};
  const sourceColors={height:'#60988e',levels:'#86a8c3',estimated:'#daab73'};
  const roofWriter=new MeshWriter(),roofDetails=[];
  const envelopes=planBuildingEnvelopes(data.buildings,{exclude:landmarkKind});
  data.buildings.forEach((building,index)=>{
    const writer=new MeshWriter(),id=index+1,style=buildingStyle(building,data.seed||1),landmark=landmarkKind(building);
    writer.style=style.code;writer.variant=style.variant;familyCounts[style.family]=(familyCounts[style.family]||0)+1;
    writer.surface=[style.surface,style.surfaceScale];surfaceCounts[style.surfaceName]=(surfaceCounts[style.surfaceName]||0)+1;
    const wall=new THREE.Color(style.color),floorHeight=style.floor,baseY=.45+building.minHeight,topY=.45+building.height;
    const trim=style.family==='curtain'?'#c9d5d7':'#e5e1d6';
    let profile=null;
    if(landmark==='china-zun')profile=buildChinaZun(writer,building,id,addBeam);
    else if(landmark==='cctv')profile=buildCctv(writer,building,id,polygon,addBeam);
    else{
      const envelope=envelopes.get(building.id);
      const rings=[normalizedRing(building.outer),...building.holes.map(h=>normalizedRing(h,true))];
      let longest=null,grammarName=null;
      for(const [ringIndex,ring]of rings.entries())for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.03)continue;
        const normal=[dz/len,0,-dx/len],angle=Math.atan2(-dz,dx),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
        const layout=facadeLayout(len,topY-baseY,style);writer.layout=layout.attributes;grammarName=layout.name;
        const spans=envelope.wall(a,b,normal);
        for(const span of spans){
          const sa=[a[0]+dx*span.t0,a[1]+dz*span.t0],sb=[a[0]+dx*span.t1,a[1]+dz*span.t1];
          const low=.45+span.lo,high=.45+span.hi,spanLen=len*(span.t1-span.t0),sm=[(sa[0]+sb[0])/2,(sa[1]+sb[1])/2];
          writer.quad([[sa[0],low,sa[1]],[sb[0],low,sb[1]],[sb[0],high,sb[1]],[sa[0],high,sa[1]]],normal,wall,id,
            [[len*span.t0,low-baseY,len,floorHeight],[len*span.t1,low-baseY,len,floorHeight],[len*span.t1,high-baseY,len,floorHeight],[len*span.t0,high-baseY,len,floorHeight]]);
          if(!ringIndex&&span.lo===0&&(!longest||spanLen>longest.len))longest={a:sa,b:sb,len:spanLen,normal,angle,mid:sm,dx:sb[0]-sa[0],dz:sb[1]-sa[1]};
          // Trim follows the exposed wall, never a buried podium/tower seam.
          if(spanLen>2&&building.height>6){
            if(span.hi===building.height){
              addBox(writer,[sm[0]-normal[0]*.35,topY+.32,sm[1]-normal[2]*.35],[spanLen,.65,.5],trim,id,angle);
              if(style.family==='curtain'&&building.height>60&&topY-4>low)addBox(writer,[sm[0]+normal[0]*.12,topY-4,sm[1]+normal[2]*.12],[spanLen,.24,.25],trim,id,angle);
            }
            if(style.family==='curtain'&&building.height>60&&len>12)for(let column=layout.group;column<layout.bays;column+=layout.group){
              const u=column/layout.bays;if(u<=span.t0||u>=span.t1)continue;
              addBox(writer,[a[0]+dx*u+normal[0]*.20,(low+high)/2,a[1]+dz*u+normal[2]*.20],[.30,high-low,.8],trim,id,angle);
            }
            if(style.family==='ribbon')for(let y=baseY+floorHeight;y<high-.5;y+=floorHeight)if(y>low+.2){
              addBox(writer,[sm[0]+normal[0]*.22,y,sm[1]+normal[2]*.22],[spanLen,.3,.7],trim,id,angle);
            }
          }
        }
        // Fine frame grammar is valid on a complete original wall only.
        // Clipped partial walls keep the same shader panes without stray frames.
        if(!ringIndex&&len>7&&spans.length===1&&spans[0].t0===0&&spans[0].t1===1&&spans[0].lo===building.minHeight&&spans[0].hi===building.height)nearWalls.push({key:`${building.id}:${i}`,a,dx,dz,len,normal,angle,layout,baseY,style});
      }
      grammarCounts[grammarName]=(grammarCounts[grammarName]||0)+1;
      writer.style=0;
      for(const [outer,...holes]of envelope.roof)polygon(writer,{outer,holes},topY,'#e1e3dd',id);
      if(building.minHeight>0){
        const start=writer.positions.length;for(const [outer,...holes]of envelope.bottom)polygon(writer,{outer,holes},baseY,wall,id);
        for(let i=start;i<writer.positions.length;i+=9){for(let c=0;c<3;c++)[writer.positions[i+3+c],writer.positions[i+6+c]]=[writer.positions[i+6+c],writer.positions[i+3+c]];for(let c=0;c<3;c++)writer.normals[i+c*3+1]=-1;}
      }
      if(longest&&building.minHeight===0&&building.height>10&&longest.len>12){
        const {mid,normal,angle,len}=longest,w=Math.min(len*.28,11),x=mid[0]+normal[0]*.32,z=mid[1]+normal[2]*.32;
        addBox(writer,[x,baseY+2.15,z],[w,4.3,.35],'#637b86',id,angle);
        addBox(writer,[x+normal[0]*1,baseY+4.4,z+normal[2]*1],[w+2,.28,2.6],trim,id,angle);
        addBox(writer,[x,baseY+2.15,z],[.16,4.3,.48],trim,id,angle);
      }
      for(const box of roofEquipment(building)){
        if(!envelope.roof.some(([outer,...holes])=>inside([box.x,box.z],outer)&&!holes.some(h=>inside([box.x,box.z],h))))continue;
        const start=roofWriter.positions.length;
        addBox(roofWriter,[box.x,topY+box.h/2,box.z],[box.w,box.h,box.d],'#aeb7b4',id);
        addBox(roofWriter,[box.x,topY+box.h+.1,box.z],[box.w+.3,.2,box.d+.3],'#d6dbd8',id);
        for(let j=0;j<3;j++)addBox(roofWriter,[box.x-box.w*.3+j*box.w*.3,topY+box.h+.23,box.z],[.18,.14,box.d*.8],'#6b7e7c',id);
        roofDetails.push({start,end:roofWriter.positions.length,anchor:[box.x,topY,box.z],size:Math.max(box.w,box.d),weight:1});
      }
    }
    const mesh=writer.mesh(material,building.tags.name||building.id);mesh.userData.feature=building;mesh.userData.generatedFacade=true;mesh.userData.inkClass=1;
    mesh.userData.facadeFamily=style.family;mesh.userData.landmark=profile;
    mesh.userData.facadeSurface=style.surfaceName;mesh.userData.facadeGrammar=style.grammar;
    if(profile){landmarks.push({...profile,osmId:building.osmId});building.generatedShape=profile.name;building.generatedShapeNote=profile.note;}
    mesh.userData.originalColors=mesh.geometry.attributes.color.array.slice();mesh.userData.sourceColor=new THREE.Color(sourceColors[building.source]);
    group.add(mesh);buildings.push(mesh);
  });
  const equipment=roofWriter.mesh(baseMaterial,'Procedural roof equipment groups');equipment.userData.inkClass=4;group.add(equipment);
  const roofOriginal=equipment.geometry.attributes.position.array.slice();equipment.userData.lod={total:roofDetails.length,visible:roofDetails.length};
  const dummy=new THREE.Object3D();
  const frameMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#dadbd4',roughness:.83}),nearWalls.length?18000:0);
  frameMesh.name='Nearby frames, sills and balconies (inferred)';frameMesh.userData.inkClass=4;frameMesh.castShadow=true;frameMesh.receiveShadow=true;frameMesh.count=0;
  const detailGroup=new THREE.Group();detailGroup.name='Near building details';detailGroup.add(frameMesh);group.add(detailGroup);
  let lodKey='';
  function updateLOD(camera,viewportHeight=900){
    if(camera.isCamera)equipment.userData.lod=updateRoofDetails(equipment.geometry,roofDetails,roofOriginal,camera,viewportHeight);
    const key=`${Math.round(camera.position.x/25)},${Math.round(camera.position.z/25)},${Math.round(camera.position.y/25)}`;
    if(key!==lodKey){lodKey=key;let count=0;
      for(const d of nearbyFacadeFrames(nearWalls,camera.position)){
        dummy.position.set(d.x,d.y,d.z);dummy.rotation.set(0,d.angle,0);dummy.scale.set(d.w,d.h,d.d);dummy.updateMatrix();frameMesh.setMatrixAt(count++,dummy.matrix);
      }
      frameMesh.count=count;frameMesh.instanceMatrix.needsUpdate=true;frameMesh.computeBoundingSphere();
    }
    streetlife.updateLOD(camera);
  }

  const streetlife=buildStreetLife(data,{roadPlan:roadSurface.plan,seed:data.seed||1,landscapeTrees:landscape.plan.trees});
  const {treeGroup,streetGroup}=streetlife;group.add(treeGroup,streetGroup);
  streetGroup.add(landscape.details);
  function setProvenance(on) {
    shared.provenance.value=on?1:0;
    for(const mesh of buildings){const colors=mesh.geometry.attributes.color;if(on){const c=mesh.userData.sourceColor;for(let i=0;i<colors.count;i++)colors.setXYZ(i,c.r,c.g,c.b);}else colors.array.set(mesh.userData.originalColors);colors.needsUpdate=true;}
  }
  return {group,buildings,treeGroup,detailGroup,equipment,shared,updateLOD,setProvenance,treeCount:streetlife.treeCount,generatedTrees:streetlife.generatedTrees,streetGroup,streetStats:streetlife.stats,roadStats:roadSurface.stats,landscapeStats:landscape.stats,sourceColors,landmarks,familyCounts,grammarCounts,surfaceCounts,facadeStats:{candidateWalls:nearWalls.length,maxInstances:18000}};
}
