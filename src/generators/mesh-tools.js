import * as THREE from 'three';

export class MeshWriter {
  constructor() { this.materialRuns = []; this.positions = []; this.normals = []; this.colors = []; this.facades = []; this.ids = []; this.styles=[]; this.style=0; this.variant=0; this.layouts=[]; this.layout=[0,0,0,0]; this.surfaces=[];this.surface=[0,1]; }
  triangle(a, b, c, normal, color, id = 0, uv = null) {
    const ab = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a));
    const ac = new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a));
    if (ab.cross(ac).dot(new THREE.Vector3(...normal)) < 0) { [b, c] = [c, b]; if (uv) uv = [uv[0], uv[2], uv[1]]; }
    const role=this.style>0 ? ([1,5,6].includes(this.style)?'glass':'wall') : normal[1]>.7?'roof':'structure';
    const run=this.materialRuns.at(-1);
    if(run?.role===role)run.count+=3;else this.materialRuns.push({start:this.positions.length/3,count:3,role});
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
  geometry({groupRoles=false}={}) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.facades, 4));
    geo.setAttribute('objectId', new THREE.Float32BufferAttribute(this.ids, 3));
    geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.styles, 2));
    geo.setAttribute('aLayout', new THREE.Float32BufferAttribute(this.layouts, 4));
    geo.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.surfaces, 2));
    geo.userData.city={schemaVersion:1,shaderAttributes:['aFacade','aStyle','aLayout','aSurface','objectId']};
    if(groupRoles){
      const roles=[...new Set(this.materialRuns.map(r=>r.role))];
      let cursor=0;
      const order=[];
      for(const role of roles){
        const start=cursor;
        for(const run of this.materialRuns)if(run.role===role)for(let v=run.start;v<run.start+run.count;v++){order.push(v);cursor++;}
        geo.addGroup(start,cursor-start,roles.indexOf(role));
      }
      for(const attr of Object.values(geo.attributes)){
        const sorted=new Float32Array(attr.array.length);
        for(let v=0;v<order.length;v++)for(let k=0;k<attr.itemSize;k++)sorted[v*attr.itemSize+k]=attr.array[order[v]*attr.itemSize+k];
        attr.array=sorted;
      }
      geo.userData.city.materialRoles=roles;
    }
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
  mesh(material, name, options) {
    const mesh = new THREE.Mesh(this.geometry(options), material); mesh.name = name;
    mesh.receiveShadow = true; mesh.castShadow = true; return mesh;
  }
}

export function normalizedRing(ring, clockwise = false) {
  const points = ring.map(p => new THREE.Vector2(...p));
  if (THREE.ShapeUtils.isClockWise(points) !== clockwise) points.reverse();
  return points.map(p => p.toArray());
}

export function polygon(writer, feature, y, color, id = 0) {
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
export function addBox(writer,center,dimensions,color,id=0,angle=0){const c=Math.cos(angle),s=Math.sin(angle);orientedBox(writer,center,[[c,0,-s],[0,1,0],[s,0,c]],dimensions,color,id);}
export function addBeam(writer,a,b,width,color,id=0){
  const y=new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a)),length=y.length();if(length<.001)return;y.normalize();
  const ref=Math.abs(y.z)<.9?new THREE.Vector3(0,0,1):new THREE.Vector3(1,0,0),x=new THREE.Vector3().crossVectors(y,ref).normalize(),z=new THREE.Vector3().crossVectors(x,y).normalize();
  orientedBox(writer,a.map((v,i)=>(v+b[i])/2),[x.toArray(),y.toArray(),z.toArray()],[width,length,width],color,id);
}
