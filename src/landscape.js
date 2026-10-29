import * as THREE from 'three';
import clipping from 'polygon-clipping';
import { planLandscape } from './landscape-plan.js';
import { planLandscapeMarkings } from './landscape-markings.js';

// Quiet, large-scale ground values remain legible in both colour and ink.
const styles = {
  paving: ['#d2cdbf', .09, 5], plaza: ['#c9c5b9', .10, 5],
  lawn: ['#a6b789', .16, 5.20], park: ['#a9b992', .16, 5.20],
  wood: ['#8fa17e', .16, 5.25], garden: ['#96aa7c', .20, 5.22],
  shrub: ['#788e63', .62, 5.28], parking: ['#929893', .10, 5.08],
  sport: ['#9eaf9b', .12, 5.16], construction: ['#c0b09a', .10, 5.10], soil: ['#baaf94', .10, 5.10],
};

class Writer {
  constructor() { this.positions=[]; this.normals=[]; this.colors=[]; this.ids=[]; }
  triangle(a,b,c,color,id) {
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),cv=new THREE.Vector3(...c);
    const n=bv.sub(av).cross(cv.sub(av)).normalize();
    for (const p of [a,b,c]) { this.positions.push(...p); this.normals.push(n.x,n.y,n.z); this.colors.push(color.r,color.g,color.b); this.ids.push((id&255)/255,((id>>8)&255)/255,((id>>16)&255)/255); }
  }
  polygon(feature,y,color,id) {
    const rings=[feature.outer,...(feature.holes||[])].map(r=>r.map(p=>new THREE.Vector2(...p)));
    const triangles=THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1)),vertices=rings.flat();
    for (const t of triangles) {
      let [a,b,c]=t.map(i=>[vertices[i].x,y,vertices[i].y]);
      if ((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<0) [b,c]=[c,b];
      this.triangle(a,b,c,color,id);
    }
    if (y<.25) return;
    // Low hedge volume, not just a painted rectangle. Hole walls face inward.
    rings.forEach((ring,hole)=>{
      const r=ring.map(v=>v.toArray());
      if (THREE.ShapeUtils.isClockWise(ring)!==Boolean(hole)) r.reverse();
      for(let i=0;i<r.length;i++) {
        const a=r[i],b=r[(i+1)%r.length],bottomA=[a[0],.10,a[1]],bottomB=[b[0],.10,b[1]],topA=[a[0],y,a[1]],topB=[b[0],y,b[1]];
        this.triangle(bottomA,topA,topB,color,id);this.triangle(bottomA,topB,bottomB,color,id);
      }
    });
  }
  mesh(material,name,inkClass) {
    const geometry=new THREE.BufferGeometry();
    for(const [key,values]of [['position',this.positions],['normal',this.normals],['color',this.colors],['objectId',this.ids]]) geometry.setAttribute(key,new THREE.Float32BufferAttribute(values,3));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=inkClass===5.28;
    mesh.userData.inkClass=inkClass;mesh.userData.procedural=true;return mesh;
  }
}

export function buildLandscape(data,options={}) {
  const plan=planLandscape(data,options),group=new THREE.Group(),details=new THREE.Group();
  group.name='Ground uses and inferred landscape courts';details.name='Landscape seating';
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.98});
  const markings=options.profile?.enabled===false?[]:planLandscapeMarkings(data,plan);
  const paintByFeature=new Map();
  for(const mark of markings){if(!paintByFeature.has(mark.featureId))paintByFeature.set(mark.featureId,[]);paintByFeature.get(mark.featureId).push([mark.outer,...mark.holes]);}
  const batches=new Map();
  for(const surface of plan.surfaces) {
    const key=`${surface.source}:${surface.kind}`;
    if(!batches.has(key))batches.set(key,{writer:new Writer(),kind:surface.kind,source:surface.source});
    const [hex,y]=styles[surface.kind]||styles.soil;
    // Inlay paint into its support instead of stacking nearly coplanar planes.
    // This keeps every colour/depth/normal/ID pass identical at distant views.
    const paint=paintByFeature.get(surface.id);
    const pieces=paint?clipping.difference([surface.outer,...(surface.holes||[])],...paint):[[surface.outer,...(surface.holes||[])]];
    for(const [outer,...holes]of pieces)batches.get(key).writer.polygon({outer,holes},y,new THREE.Color(hex),61000+Object.keys(styles).indexOf(surface.kind));
  }
  for(const [name,{writer,kind,source}]of batches) {
    const mesh=writer.mesh(material,name,(styles[kind]||styles.soil)[2]);mesh.userData.source=source;group.add(mesh);
  }
  if(markings.length){
    // Paint shares its host's object identity: thin stripes are surface colour,
    // not tiny standalone objects that need two black outline borders.
    const writer=new Writer();for(const mark of markings)writer.polygon(mark,styles[mark.kind][1],new THREE.Color('#e9e6d7'),61000+Object.keys(styles).indexOf(mark.kind));
    const mesh=writer.mesh(material,'Illustrative parking bays and court lines',3.5);mesh.userData.source='inferred-layout';group.add(mesh);
  }
  plan.stats.markingStrips=markings.length;
  const benches=plan.props.filter(p=>p.kind==='bench');
  if(benches.length) {
    const geometry=new THREE.BoxGeometry(1,1,1),dummy=new THREE.Object3D();
    const seat=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color:'#9a8b72',roughness:.9}),benches.length*2);
    seat.name='Inferred courtyard benches';seat.userData.inkClass=4;seat.userData.procedural=true;seat.castShadow=true;seat.receiveShadow=true;
    benches.forEach((b,i)=>{
      for(const [part,y,w,h]of [[0,.48,.65,.15],[1,.25,.42,.4]]){
        dummy.position.set(b.point[0],y,b.point[1]);dummy.rotation.set(0,b.angle,0);dummy.scale.set(w,h,2);dummy.updateMatrix();seat.setMatrixAt(i*2+part,dummy.matrix);
      }
    });seat.computeBoundingSphere();details.add(seat);
  }
  plan.stats.renderedTriangles=group.children.reduce((sum,o)=>sum+o.geometry.attributes.position.count/3,0)+benches.length*24;
  plan.stats.drawMeshes=group.children.length+details.children.length;
  return {group,details,plan,stats:plan.stats};
}
