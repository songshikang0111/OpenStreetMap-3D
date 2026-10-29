import * as THREE from 'three';
import { area, inside, stableRandom } from './osm.js';
import { buildingStyle, landmarkKind, roofEquipment } from './building-rules.js';
import { buildChinaZun, buildCctv } from './landmarks.js';
import { buildStreetLife } from './streetlife.js';
import { buildRoadSurface } from './road-surface.js';

class MeshWriter {
  constructor() { this.positions = []; this.normals = []; this.colors = []; this.facades = []; this.ids = []; this.styles=[]; this.style=0; this.variant=0; }
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
  const all = [...outer, ...holes.flat()];
  for (const t of THREE.ShapeUtils.triangulateShape(outer, holes)) writer.triangle(...t.map(i => [all[i].x, y, all[i].y]), [0, 1, 0], color, id);
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
  material.onBeforeCompile = shader => {
    shader.uniforms.uWindows = shared.windows;
    shader.uniforms.uProvenance = shared.provenance;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aFacade; varying vec4 vFacade; attribute vec2 aStyle; varying vec2 vStyle;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade; vStyle=aStyle;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec4 vFacade;
      varying vec2 vStyle;
      uniform float uWindows;
      uniform float uProvenance;
      float inkWindow=0.0;
      // Integrate a periodic window over its pixel footprint. A smoothstep of
      // fract() aliases when a pixel spans more than one window cell.
      float stripeIntegral(float p,float width){return floor(p)*2.*width+clamp(fract(p)-(.5-width),0.,2.*width);}
      float stripe(float p,float width){float w=max(fwidth(p),.001);return clamp((stripeIntegral(p+w*.5,width)-stripeIntegral(p-w*.5,width))/w,0.,1.);}
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (vFacade.z > 0.5 && uWindows > 0.5 && uProvenance < 0.5) {
        float family=vStyle.x;
        float curtain=1.-step(.2,abs(family-1.));
        float residential=1.-step(.2,abs(family-2.));
        float ribbon=1.-step(.2,abs(family-3.));
        float diagrid=1.-step(.2,abs(family-5.));
        float zun=1.-step(.2,abs(family-6.));
        float isGlass=max(curtain,max(diagrid,zun));
        float bay=mix(3.5,2.4,isGlass);
        float bays = max(1.0, floor(vFacade.z / bay));
        float u = vFacade.x / vFacade.z * bays;
        float v = vFacade.y / max(2.8, vFacade.w);
        float mask = stripe(u, mix(.30,.46,isGlass)) * stripe(v, mix(.30,.44,isGlass));
        mask=mix(mask,stripe(u,.455)*stripe(v,.27),ribbon);
        float lower=1.-smoothstep(.95,1.15,v);
        mask=mix(mask,stripe(u*.5,.44)*stripe(v,.46),lower*(1.-residential));
        // Stop drawing individual panes before their frames become subpixel.
        // Color keeps the average glass coverage; ink drops fine pane outlines.
        float fade = 1.0 - smoothstep(.08, .30, max(fwidth(u),fwidth(v)));
        inkWindow=mask*fade*mix(.91,.72,isGlass);
        float cell = fract(sin(dot(floor(vec2(u,v)),vec2(17.21,59.17))) * 12345.31);
        vec3 glass = mix(vec3(.17,.24,.28),vec3(.31,.39,.44), cell*.06*fade+vStyle.y*.4);
        glass=mix(glass,vec3(.21,.31,.37),zun*.55);
        glass*=mix(.72,1.1,smoothstep(.08,.92,fract(u*.083+vStyle.y)));
        float meanMask=mix(.36,.81,isGlass);meanMask=mix(meanMask,.49,ribbon);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, mix(meanMask,mask,fade)*.9);
        float seam = stripe(v+.47,.025) * mix(.12,.26,ribbon) * fade;
        diffuseColor.rgb *= 1.0-seam;
        if(diagrid>.5){float diagonals=max(stripe(u*.47+v*.46,.035),stripe(u*.47-v*.46,.035))*fade;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.49,.55,.57),diagonals*.85);inkWindow*=1.-diagonals*.95;}
      }
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','#include <opaque_fragment>\ngl_FragColor.a=inkWindow;');
  };
  material.customProgramCacheKey = () => 'city-ink-facade-v3-filtered';
  return material;
}

export function buildCity(data) {
  const group = new THREE.Group(); group.name = 'Beijing CBD — OpenStreetMap';
  const shared = { windows: { value: 1 }, provenance: { value: 0 } };
  const material = facadeMaterial(shared);
  const baseMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98 });
  const [x0,z0,x1,z1] = data.bounds;
  const base = new THREE.Mesh(new THREE.BoxGeometry(x1-x0+34,14,z1-z0+34), new THREE.MeshStandardMaterial({color:'#d8d4c7',roughness:1}));
  base.position.set((x0+x1)/2,-7,(z0+z1)/2); base.receiveShadow = true; base.name = 'Flat ground / no DEM'; base.userData.inkClass=5; group.add(base);
  const groundWriter = new MeshWriter();
  for (const feature of data.greens) polygon(groundWriter, feature, .18, '#aebea0', 60000);
  for (const feature of data.water) polygon(groundWriter, feature, .22, '#8dacae', 60001);
  const landCover=groundWriter.mesh(baseMaterial,'Land cover');landCover.userData.inkClass=5;group.add(landCover);
  const roadSurface=buildRoadSurface(data);group.add(roadSurface.group);

  const buildings=[],nearDetails=[],landmarks=[],familyCounts={};
  const sourceColors={height:'#60988e',levels:'#86a8c3',estimated:'#daab73'};
  const roofWriter=new MeshWriter();
  data.buildings.forEach((building,index)=>{
    const writer=new MeshWriter(),id=index+1,style=buildingStyle(building),landmark=landmarkKind(building);
    writer.style=style.code;writer.variant=style.variant;familyCounts[style.family]=(familyCounts[style.family]||0)+1;
    const wall=new THREE.Color(style.color),floorHeight=style.floor,baseY=.45+building.minHeight,topY=.45+building.height;
    const trim=style.family==='curtain'?'#c9d5d7':'#e5e1d6';
    let profile=null;
    if(landmark==='china-zun')profile=buildChinaZun(writer,building,id,addBeam);
    else if(landmark==='cctv')profile=buildCctv(writer,building,id,polygon,addBeam);
    else{
      const rings=[normalizedRing(building.outer),...building.holes.map(h=>normalizedRing(h,true))];
      let longest=null;
      for(const [ringIndex,ring]of rings.entries())for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.03)continue;
        const normal=[dz/len,0,-dx/len],angle=Math.atan2(-dz,dx),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
        writer.quad([[a[0],baseY,a[1]],[b[0],baseY,b[1]],[b[0],topY,b[1]],[a[0],topY,a[1]]],normal,wall,id,
          [[0,0,len,floorHeight],[len,0,len,floorHeight],[len,topY-baseY,len,floorHeight],[0,topY-baseY,len,floorHeight]]);
        if(!ringIndex&&(!longest||len>longest.len))longest={a,b,len,normal,angle,mid,dx,dz};
        // Each wall ends with a parapet, not a featureless white cap.
        if(len>2&&building.height>6){
          // Recess the outer parapet face from the wall plane. Exactly coplanar
          // surfaces become unstable in a kilometre-wide perspective view.
          addBox(writer,[mid[0]-normal[0]*.35,topY+.32,mid[1]-normal[2]*.35],[len,.65,.5],trim,id,angle);
          if(style.family==='curtain'&&building.height>60){
            addBox(writer,[mid[0]+normal[0]*.22,topY-4,mid[1]+normal[2]*.22],[len,1.1,.7],trim,id,angle);
            if(len>12)for(let distance=0;distance<len;distance+=Math.max(6,style.bay*3)){
              const u=distance/len;addBox(writer,[a[0]+dx*u+normal[0]*.20,(baseY+topY)/2,a[1]+dz*u+normal[2]*.20],[.30,topY-baseY,.8],trim,id,angle);
            }
          }
          if(style.family==='ribbon')for(let y=baseY+floorHeight;y<topY-.5;y+=floorHeight){
            addBox(writer,[mid[0]+normal[0]*.22,y,mid[1]+normal[2]*.22],[len,.3,.7],trim,id,angle);
          }
        }
        const bays=Math.floor(len/style.bay),levels=Math.min(12,Math.floor((topY-baseY)/floorHeight));
        if(!ringIndex&&len>7&&bays&&nearDetails.length<42000){
          for(let level=1;level<levels;level++)for(let bay=0;bay<bays;bay++){
            const u=(bay+.5)/bays,y=baseY+(level+.5)*floorHeight,w=len/bays*(style.family==='curtain'?.88:.60),h=floorHeight*.60;
            const x=a[0]+dx*u+normal[0]*.10,z=a[1]+dz*u+normal[2]*.10;
            if(y+h/2>=topY)continue;
            nearDetails.push({x,y:y-h/2,z,angle,w,h:.13,d:.35});
            if(style.family==='residential'){
              nearDetails.push({x:x-dx/len*w/2,y,z:z-dz/len*w/2,angle,w:.12,h,d:.24});
              nearDetails.push({x:x+dx/len*w/2,y,z:z+dz/len*w/2,angle,w:.12,h,d:.24});
              if(style.balcony&&bay%3===1&&level%2===0){
                const bx=x+normal[0]*.55,bz=z+normal[2]*.55;
                nearDetails.push({x:bx,y:y-h/2-.15,z:bz,angle,w:w+1,h:.18,d:1.25});
                nearDetails.push({x:bx+normal[0]*.55,y:y-h/2+.42,z:bz+normal[2]*.55,angle,w:w+1,h:1,d:.13});
              }
            }
          }
        }
      }
      writer.style=0;polygon(writer,building,topY,'#e1e3dd',id);
      if(building.minHeight>0){
        const start=writer.positions.length;polygon(writer,building,baseY,wall,id);
        for(let i=start;i<writer.positions.length;i+=9){for(let c=0;c<3;c++)[writer.positions[i+3+c],writer.positions[i+6+c]]=[writer.positions[i+6+c],writer.positions[i+3+c]];for(let c=0;c<3;c++)writer.normals[i+c*3+1]=-1;}
      }
      if(longest&&building.minHeight===0&&building.height>10&&longest.len>12){
        const {mid,normal,angle,len}=longest,w=Math.min(len*.28,11),x=mid[0]+normal[0]*.32,z=mid[1]+normal[2]*.32;
        addBox(writer,[x,baseY+2.15,z],[w,4.3,.35],'#637b86',id,angle);
        addBox(writer,[x+normal[0]*1,baseY+4.4,z+normal[2]*1],[w+2,.28,2.6],trim,id,angle);
        addBox(writer,[x,baseY+2.15,z],[.16,4.3,.48],trim,id,angle);
      }
      for(const box of roofEquipment(building)){
        addBox(roofWriter,[box.x,topY+box.h/2,box.z],[box.w,box.h,box.d],'#aeb7b4',id);
        addBox(roofWriter,[box.x,topY+box.h+.1,box.z],[box.w+.3,.2,box.d+.3],'#d6dbd8',id);
        for(let j=0;j<3;j++)addBox(roofWriter,[box.x-box.w*.3+j*box.w*.3,topY+box.h+.23,box.z],[.18,.14,box.d*.8],'#6b7e7c',id);
      }
    }
    const mesh=writer.mesh(material,building.tags.name||building.id);mesh.userData.feature=building;mesh.userData.generatedFacade=true;mesh.userData.inkClass=1;
    mesh.userData.facadeFamily=style.family;mesh.userData.landmark=profile;
    if(profile){landmarks.push({...profile,osmId:building.osmId});building.generatedShape=profile.name;building.generatedShapeNote=profile.note;}
    mesh.userData.originalColors=mesh.geometry.attributes.color.array.slice();mesh.userData.sourceColor=new THREE.Color(sourceColors[building.source]);
    group.add(mesh);buildings.push(mesh);
  });
  const equipment=roofWriter.mesh(baseMaterial,'Procedural roof equipment groups');equipment.userData.inkClass=4;group.add(equipment);
  const dummy=new THREE.Object3D();
  const frameMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#dadbd4',roughness:.83}),Math.min(18000,nearDetails.length));
  frameMesh.name='Nearby frames, sills and balconies (inferred)';frameMesh.userData.inkClass=4;frameMesh.castShadow=true;frameMesh.receiveShadow=true;frameMesh.count=0;
  const detailGroup=new THREE.Group();detailGroup.name='Near building details';detailGroup.add(frameMesh);group.add(detailGroup);
  let lodKey='';
  function updateLOD(camera){
    const key=`${Math.round(camera.position.x/25)},${Math.round(camera.position.z/25)},${Math.round(camera.position.y/25)}`;
    if(key!==lodKey){lodKey=key;let count=0;
      if(camera.position.y<180)for(const d of nearDetails){
        if(count>=18000)break;if(Math.hypot(d.x-camera.position.x,d.z-camera.position.z)>160||Math.abs(d.y-camera.position.y)>90)continue;
        dummy.position.set(d.x,d.y,d.z);dummy.rotation.set(0,d.angle,0);dummy.scale.set(d.w,d.h,d.d);dummy.updateMatrix();frameMesh.setMatrixAt(count++,dummy.matrix);
      }
      frameMesh.count=count;frameMesh.instanceMatrix.needsUpdate=true;frameMesh.computeBoundingSphere();
    }
    streetlife.updateLOD(camera);
  }

  const streetlife=buildStreetLife(data);
  const {treeGroup,streetGroup}=streetlife;group.add(treeGroup,streetGroup);
  function setProvenance(on) {
    shared.provenance.value=on?1:0;
    for(const mesh of buildings){const colors=mesh.geometry.attributes.color;if(on){const c=mesh.userData.sourceColor;for(let i=0;i<colors.count;i++)colors.setXYZ(i,c.r,c.g,c.b);}else colors.array.set(mesh.userData.originalColors);colors.needsUpdate=true;}
  }
  return {group,buildings,treeGroup,detailGroup,equipment,shared,updateLOD,setProvenance,treeCount:streetlife.treeCount,generatedTrees:streetlife.generatedTrees,streetGroup,streetStats:streetlife.stats,roadStats:roadSurface.stats,sourceColors,landmarks,familyCounts};
}
