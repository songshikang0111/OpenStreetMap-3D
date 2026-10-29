import * as THREE from 'three';
import { area, inside, stableRandom } from '../osm.js';

class MeshWriter {
  constructor() { this.positions = []; this.normals = []; this.colors = []; this.facades = []; this.ids = []; }
  triangle(a, b, c, normal, color, id = 0, uv = null) {
    const ab = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a));
    const ac = new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a));
    if (ab.cross(ac).dot(new THREE.Vector3(...normal)) < 0) { [b, c] = [c, b]; if (uv) uv = [uv[0], uv[2], uv[1]]; }
    const col = color.isColor ? color : new THREE.Color(color);
    const code = [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255];
    [a, b, c].forEach((p, i) => {
      this.positions.push(...p); this.normals.push(...normal); this.colors.push(col.r, col.g, col.b);
      this.ids.push(...code); this.facades.push(...(uv ? uv[i] : [0, 0, 0, 0]));
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

function ribbon(writer, a, b, width, y, color, id = 0) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  if (len < .01) return;
  const nx = -dz / len * width / 2, nz = dx / len * width / 2;
  writer.quad([[a[0]+nx,y,a[1]+nz], [b[0]+nx,y,b[1]+nz], [b[0]-nx,y,b[1]-nz], [a[0]-nx,y,a[1]-nz]], [0,1,0], color, id);
}

function disc(writer, p, radius, y, color, id = 0) {
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, b = (i + 1) / 12 * Math.PI * 2;
    writer.triangle([p[0],y,p[1]], [p[0]+Math.cos(a)*radius,y,p[1]+Math.sin(a)*radius], [p[0]+Math.cos(b)*radius,y,p[1]+Math.sin(b)*radius], [0,1,0],color,id);
  }
}

function facadeMaterial(shared) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: .04 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uWindows = shared.windows;
    shader.uniforms.uProvenance = shared.provenance;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aFacade; varying vec4 vFacade;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec4 vFacade;
      uniform float uWindows;
      uniform float uProvenance;
      float inkWindow=0.0;
      float stripe(float p, float width) { float d = abs(fract(p)-0.5); float aa = max(fwidth(p), .002); return 1.0 - smoothstep(width-aa, width+aa, d); }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (vFacade.z > 0.5 && uWindows > 0.5 && uProvenance < 0.5) {
        float bays = max(1.0, floor(vFacade.z / 3.3));
        float u = vFacade.x / vFacade.z * bays;
        float v = vFacade.y / max(2.8, vFacade.w);
        float mask = stripe(u, .32) * stripe(v, .31);
        float fade = 1.0 - smoothstep(.45, 1.8, max(fwidth(u),fwidth(v)));
        inkWindow=mask*fade;
        float cell = fract(sin(dot(floor(vec2(u,v)),vec2(17.21,59.17))) * 12345.31);
        vec3 glass = mix(vec3(.095,.135,.155),vec3(.31,.36,.38), cell);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, mask * fade * .9);
        float seam = stripe(v+.47,.025) * .12 * fade;
        diffuseColor.rgb *= 1.0-seam;
      }
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','#include <opaque_fragment>\ngl_FragColor.a=inkWindow;');
  };
  material.customProgramCacheKey = () => 'city-ink-facade-v1';
  return material;
}

export function buildCity(data) {
  const group = new THREE.Group(); group.name = 'Beijing CBD — OpenStreetMap';
  const shared = { windows: { value: 1 }, provenance: { value: 0 } };
  const material = facadeMaterial(shared);
  const baseMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98 });
  const [x0,z0,x1,z1] = data.bounds;
  const base = new THREE.Mesh(new THREE.BoxGeometry(x1-x0+34,14,z1-z0+34), new THREE.MeshStandardMaterial({color:'#d8d4c7',roughness:1}));
  base.position.set((x0+x1)/2,-7,(z0+z1)/2); base.receiveShadow = true; base.name = 'Flat ground / no DEM'; group.add(base);
  const groundWriter = new MeshWriter();
  for (const feature of data.greens) polygon(groundWriter, feature, .18, '#aebea0', 60000);
  for (const feature of data.water) polygon(groundWriter, feature, .22, '#8dacae', 60001);
  group.add(groundWriter.mesh(baseMaterial,'Land cover'));
  const roadWriter = new MeshWriter(), pavingWriter = new MeshWriter(), markingsWriter = new MeshWriter();
  for (const road of data.roads) {
    const walk = /footway|path|steps|pedestrian|cycleway/.test(road.type);
    const y = road.bridge ? 7 * Math.max(1, road.layer) : .32 + (walk ? .05 : 0);
    for (const [a,b] of road.segments) {
      if (!walk) { ribbon(pavingWriter,a,b,road.width+3.5,y-.09,'#eee9dc',60002); disc(pavingWriter,a,(road.width+3.5)/2,y-.09,'#eee9dc',60002); }
      ribbon(roadWriter,a,b,road.width,y,walk?'#cbc4b3':'#979b9a',60003);
      disc(roadWriter,a,road.width/2,y,walk?'#cbc4b3':'#979b9a',60003);
      if (!walk && road.width >= 7) {
        const length = Math.hypot(b[0]-a[0],b[1]-a[1]);
        const dx = (b[0]-a[0])/length,dz=(b[1]-a[1])/length;
        for(let t=4;t<length-2;t+=11) ribbon(markingsWriter,[a[0]+dx*t,a[1]+dz*t],[a[0]+dx*Math.min(t+4,length),a[1]+dz*Math.min(t+4,length)],.18,y+.025,'#f9f6e9');
      }
    }
  }
  for (const [writer,name] of [[pavingWriter,'Sidewalks'],[roadWriter,'Roads'],[markingsWriter,'Road markings']]) {
    const mesh = writer.mesh(baseMaterial,name); mesh.castShadow=false; group.add(mesh);
  }

  const buildings = [], roofBoxes = [], detailedWindows = [];
  const wallPalette = ['#d5d0c2','#bdc9ca','#bcc3c4','#d6c6af','#b7c1c1','#d7d9d4'];
  const sourceColors = { height: '#60988e', levels: '#86a8c3', estimated: '#daab73' };
  data.buildings.forEach((building,index) => {
    const writer = new MeshWriter(), id = index + 1, random = stableRandom(building.id);
    const wall = new THREE.Color(wallPalette[Math.floor(random()*wallPalette.length)]);
    const floorHeight = Math.max(2.8, Math.min(5.5, building.height/building.levels));
    const baseY = .45 + building.minHeight, topY = .45 + building.height;
    const rings = [normalizedRing(building.outer), ...building.holes.map(h=>normalizedRing(h,true))];
    for (const ring of rings) {
      for (let i=0;i<ring.length;i++) {
        const a = ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
        if(len<.03) continue;
        const normal=[dz/len,0,-dx/len];
        writer.quad([[a[0],baseY,a[1]],[b[0],baseY,b[1]],[b[0],topY,b[1]],[a[0],topY,a[1]]],normal,wall,id,
          [[0,baseY,len,floorHeight],[len,baseY,len,floorHeight],[len,topY,len,floorHeight],[0,topY,len,floorHeight]]);
        // A small real-geometry detail tier complements shader windows near the camera.
        const bays=Math.floor(len/3.3);
        if (building.height < 95 && bays>0 && len>5 && detailedWindows.length < 18000) {
          for(let level=1;level<Math.min(18,building.levels);level++) {
            const y=(level+.5)*floorHeight;
            if(y<=baseY || y>=topY-.8) continue;
            for(let bay=0;bay<bays;bay++) {
              const u=(bay+.5)/bays;
              detailedWindows.push({ position:[a[0]+dx*u+normal[0]*.1,y,a[1]+dz*u+normal[2]*.1], angle:Math.atan2(-dz,dx), width:len/bays*.7, building:index });
            }
          }
        }
      }
    }
    polygon(writer,building,topY,'#e2e1d6',id);
    if(building.minHeight>0) {
      const start=writer.positions.length; polygon(writer,building,baseY,wall,id);
      for(let i=start;i<writer.positions.length;i+=9) {
        for(let c=0;c<3;c++) [writer.positions[i+3+c],writer.positions[i+6+c]]=[writer.positions[i+6+c],writer.positions[i+3+c]];
        for(let c=0;c<3;c++) writer.normals[i+c*3+1]=-1;
      }
    }
    const mesh=writer.mesh(material,building.tags.name||building.id);
    mesh.userData.feature=building; mesh.userData.generatedFacade=true;
    mesh.userData.originalColors=mesh.geometry.attributes.color.array.slice();
    mesh.userData.sourceColor=new THREE.Color(sourceColors[building.source]);
    group.add(mesh); buildings.push(mesh);
    if(building.area>120 && !building.holes.length && inside(building.center,building.outer)) {
      roofBoxes.push({x:building.center[0],z:building.center[1],y:topY+1.4,w:Math.min(9,Math.sqrt(building.area)*.16),d:Math.min(7,Math.sqrt(building.area)*.12)});
    }
  });
  const equipment=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#c5c7bf',roughness:.9}),roofBoxes.length);
  const dummy=new THREE.Object3D();
  roofBoxes.forEach((b,i)=>{dummy.position.set(b.x,b.y,b.z);dummy.rotation.set(0,0,0);dummy.scale.set(b.w,2.8,b.d);dummy.updateMatrix();equipment.setMatrixAt(i,dummy.matrix);});
  equipment.castShadow=true;equipment.receiveShadow=true;equipment.name='Procedural roof equipment';group.add(equipment);

  const frameMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,.12,.34),new THREE.MeshStandardMaterial({color:'#dfdfd6',roughness:.8}),detailedWindows.length);
  frameMesh.name='Nearby window ledges (procedural)';
  const detailGroup=new THREE.Group(); detailGroup.add(frameMesh);group.add(detailGroup);
  let lodKey='';
  function updateLOD(camera) {
    const key=`${Math.round(camera.position.x/60)},${Math.round(camera.position.z/60)},${Math.round(camera.position.y/60)}`;
    if(key===lodKey)return;lodKey=key;
    let count=0;
    if(camera.position.y<260) for(const w of detailedWindows) {
      if(Math.hypot(w.position[0]-camera.position.x,w.position[2]-camera.position.z)>210)continue;
      dummy.position.set(...w.position);dummy.position.y-=.9;dummy.rotation.set(0,w.angle,0);dummy.scale.set(w.width,1,1);dummy.updateMatrix();frameMesh.setMatrixAt(count++,dummy.matrix);
    }
    frameMesh.count=count;frameMesh.instanceMatrix.needsUpdate=true;frameMesh.computeBoundingSphere();
  }

  const treeGroup=new THREE.Group();treeGroup.name='Trees';
  const trees=[...data.trees.map(t=>({x:t.point[0],z:t.point[1],h:Math.min(16,t.height)}))];
  // Only park/green polygons receive inferred trees. Their placement is not an OSM observation.
  for(const green of data.greens) {
    const rng=stableRandom(green.id),n=Math.min(80,Math.floor(green.area/160));
    const xs=green.outer.map(p=>p[0]),zs=green.outer.map(p=>p[1]);
    for(let attempt=0,placed=0;attempt<n*8 && placed<n;attempt++){
      const x=THREE.MathUtils.lerp(Math.min(...xs),Math.max(...xs),rng()),z=THREE.MathUtils.lerp(Math.min(...zs),Math.max(...zs),rng());
      if(!inside([x,z],green.outer)||green.holes.some(h=>inside([x,z],h))||data.buildings.some(b=>inside([x,z],b.outer)))continue;
      trees.push({x,z,h:5+rng()*5});placed++;
    }
  }
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.22,.32,1,5),new THREE.MeshStandardMaterial({color:'#777568',roughness:1}),trees.length);
  const leaves=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:'#87967c',roughness:1,flatShading:true}),trees.length*3);
  trees.forEach((t,i)=>{
    dummy.rotation.set(0,0,0);dummy.position.set(t.x,t.h*.33,t.z);dummy.scale.set(1,t.h*.66,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    for(let j=0;j<3;j++){
      dummy.position.set(t.x+Math.cos(j*2.1)*t.h*.15,t.h*(.64+j*.085),t.z+Math.sin(j*2.1)*t.h*.14);dummy.scale.set(t.h*.29,t.h*.31,t.h*.28);dummy.rotation.set(.1*i,j,0);dummy.updateMatrix();leaves.setMatrixAt(i*3+j,dummy.matrix);
    }
  });
  trunks.castShadow=leaves.castShadow=true;leaves.receiveShadow=true;treeGroup.add(trunks,leaves);group.add(treeGroup);
  function setProvenance(on) {
    shared.provenance.value=on?1:0;
    for(const mesh of buildings){const colors=mesh.geometry.attributes.color;if(on){const c=mesh.userData.sourceColor;for(let i=0;i<colors.count;i++)colors.setXYZ(i,c.r,c.g,c.b);}else colors.array.set(mesh.userData.originalColors);colors.needsUpdate=true;}
  }
  return {group,buildings,treeGroup,detailGroup,equipment,shared,updateLOD,setProvenance,treeCount:trees.length,generatedTrees:trees.length-data.trees.length,sourceColors};
}

