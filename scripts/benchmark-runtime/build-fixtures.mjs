import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { parseOSM, clipSegment } from '../../src/osm.js';
import { buildCity } from '../../src/city.js';
import { encodeFixture } from '../../examples/embed/fixture-codec.js';
import { measureGroup, ResourceRegistry } from '../../src/runtime/resources.js';

const root = path.resolve(process.argv[2] || 'work/runtime-fixtures');
const only = process.argv.slice(3), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const registry = new ResourceRegistry();
const material = color => new THREE.MeshStandardMaterial({ color, roughness: .85 });
const owns = (point, bounds) => point[0] >= bounds[0] && point[0] < bounds[2] && point[1] >= bounds[1] && point[1] < bounds[3];
const centerOf = b => b.outer.reduce((p, q) => [p[0] + q[0] / b.outer.length, p[1] + q[1] / b.outer.length], [0, 0]);
function base(bounds) {
  const group = new THREE.Group(), [x0,z0,x1,z1] = bounds;
  const ground = new THREE.Mesh(new THREE.BoxGeometry(x1-x0,.5,z1-z0), material('#dfdfd2')); ground.position.set((x0+x1)/2,-.25,(z0+z1)/2); ground.userData.city = { kind:'ground',materialRole:'ground' }; ground.userData.inkClass=5; group.add(ground); return group;
}
function semantic(mesh, featureId, role = 'wall') {
  mesh.userData.city = { featureId, sourceIds: [featureId], kind: 'building', materialRole: role, lodRole: 'body' }; mesh.userData.inkClass=1; return mesh;
}
function syntheticFeatures() {
  const features=[];
  for(let iz=0;iz<15;iz++)for(let ix=0;ix<15;ix++) {
    const id=iz*15+ix, x=-750+ix*100+50,z=-750+iz*100+50;
    features.push({id:`synthetic:${id}`, x,z,width:35+(id*7%20),depth:35+(id*11%20),height:20+(id*19%160)});
  }
  return features;
}
function syntheticGroup(features,bounds,index) {
  const group=base(bounds), geometry=[]; let triangle=0; const ranges=[];
  for(const b of features) {
    const body=new THREE.BoxGeometry(b.width,b.height,b.depth,index===0?3:index===1?2:1,index===0?5:index===1?2:1,index===0?3:index===1?2:1);
    body.translate(b.x,b.height/2,b.z);
    if(index===2) {const count=body.index.count/3; ranges.push({start:triangle,count,featureId:b.id,sourceIds:[b.id]});triangle+=count;geometry.push(body);}
    else {
      const mesh=semantic(new THREE.Mesh(body,material('#a8b5af')),b.id);mesh.castShadow=true;group.add(mesh);
      if(index===0) {
        const frames=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material('#cad1cd'),60); frames.userData.city={featureId:b.id,materialRole:'structure',lodRole:'detail'};
        const dummy=new THREE.Object3D();for(let i=0;i<60;i++){dummy.position.set(b.x-b.width/2+(i%10+.5)*b.width/10,3+Math.floor(i/10)*b.height/6,b.z+b.depth/2+.25);dummy.scale.set(.25,b.height/6-.5,.4);dummy.updateMatrix();frames.setMatrixAt(i,dummy.matrix);} frames.computeBoundingSphere();group.add(frames);
        const roof=semantic(new THREE.Mesh(new THREE.BoxGeometry(b.width*.35,4,b.depth*.35),material('#7e8e8a')),b.id,'roof');roof.position.set(b.x,b.height+2,b.z);roof.userData.city.lodRole='detail';group.add(roof);
      }
    }
  }
  if(geometry.length) {const mesh=new THREE.Mesh(mergeGeometries(geometry),material('#a8b5af'));mesh.userData.city={kind:'building',materialRole:'wall',lodRole:'body'};mesh.userData.cityFeatureRanges=ranges;mesh.userData.inkClass=1;group.add(mesh);for(const g of geometry)g.dispose();}
  return group;
}
function simpleOSMGroup(buildings,bounds,index) {
  const group=base(bounds), geometries=[], ranges=[];let triangle=0;
  for(const b of buildings) {
    const id=`${b.osmType}:${b.osmId}`; let geometry;
    if(index===2) {
      const box=new THREE.Box2().setFromPoints(b.outer.map(p=>new THREE.Vector2(...p))),c=box.getCenter(new THREE.Vector2()),s=box.getSize(new THREE.Vector2());
      geometry=new THREE.BoxGeometry(Math.max(.1,s.x),Math.max(.5,b.height-b.minHeight),Math.max(.1,s.y)).toNonIndexed();geometry.translate(c.x,b.minHeight+(b.height-b.minHeight)/2,c.y);
    } else {
      const shape=new THREE.Shape(b.outer.map(p=>new THREE.Vector2(p[0],-p[1])));
      for(const hole of b.holes||[])shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(p[0],-p[1]))));
      geometry=new THREE.ExtrudeGeometry(shape,{depth:Math.max(.5,b.height-b.minHeight),bevelEnabled:false});geometry.rotateX(-Math.PI/2);geometry.translate(0,b.minHeight,0);
    }
    // Extrude has UVs; use the same attributes on both simplified body levels.
    geometry.deleteAttribute('uv');const count=geometry.attributes.position.count/3;ranges.push({start:triangle,count,featureId:id,sourceIds:[id]});triangle+=count;geometries.push(geometry);
  }
  if(geometries.length){const mesh=new THREE.Mesh(mergeGeometries(geometries),material('#a8b5af'));mesh.userData.city={materialRole:'wall',kind:'building',lodRole:'body'};mesh.userData.cityFeatureRanges=ranges;mesh.userData.inkClass=1;group.add(mesh);for(const g of geometries)g.dispose();}
  return group;
}
function legacyOSMGroup(data,buildings,bounds) {
  const subset={...data,buildings:structuredClone(buildings),bounds,landscapes:[],landscapeContexts:[],greens:[],water:[],trees:data.trees.filter(t=>owns(t.point,bounds)),streetNodes:data.streetNodes.filter(t=>owns(t.point,bounds)),treeRows:[],roads:data.roads.map(r=>({...r,segments:r.segments.map(([a,b])=>clipSegment(a,b,bounds)).filter(Boolean),segmentNodes:[]})).filter(r=>r.segments.length)};
  const city=buildCity(subset);const c=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];
  city.updateLOD({position:{x:c[0],y:15,z:c[1]}},720);
  city.group.traverse(o=>{if(o.userData.feature){const b=o.userData.feature;semantic(o,`${b.osmType}:${b.osmId}`);delete o.userData.originalColors;delete o.userData.sourceColor;delete o.userData.feature;}if(/Near|frames|equipment/i.test(o.name))o.userData.city={...o.userData.city,lodRole:'detail'};});
  return city.group;
}
async function build(name, {bounds,side,kind,features,data,sourceHash,tileSize}) {
  if(only.length&&!only.includes(name))return;
  const started=performance.now(),memoryBefore=process.memoryUsage().rss;
  const directory=path.join(root,name);await fs.mkdir(path.join(directory,'chunks'),{recursive:true});
  const chunks=[],featureIndex={},sourceCount=features?.length??data.buildings.length;let packageBytes=0,selectedCount=0;
  for(let iz=0;iz<side;iz++)for(let ix=0;ix<side;ix++){
    const dx=(bounds[2]-bounds[0])/side,dz=(bounds[3]-bounds[1])/side,b=[bounds[0]+ix*dx,bounds[1]+iz*dz,bounds[0]+(ix+1)*dx,bounds[1]+(iz+1)*dz];
    const selected=features?features.filter(f=>owns([f.x,f.z],b)):data.buildings.filter(f=>owns(centerOf(f),b));selectedCount+=selected.length;
    for(const f of selected){const id=f.id&&features?f.id:`${f.osmType}:${f.osmId}`;featureIndex[id]={featureId:id,sourceIds:[id],chunkId:`${ix}-${iz}`,kind:'building'};}
    const lods=[];let contentBounds=new THREE.Box3(new THREE.Vector3(b[0],0,b[1]),new THREE.Vector3(b[2],1,b[3]));
    for(let index=0;index<3;index++) {
      const group=features?syntheticGroup(selected,b,index):index===0?legacyOSMGroup(data,selected,b):simpleOSMGroup(selected,b,index);
      group.updateMatrixWorld(true);contentBounds.union(new THREE.Box3().setFromObject(group));
      const metrics=measureGroup(group),binary=encodeFixture(group),uri=`chunks/${ix}-${iz}-${index}.bin`;packageBytes+=binary.length;
      await fs.writeFile(path.join(directory,uri),binary);const resources=registry.retain(group),resident=registry.stats().geometryArrayBytes;
      lods.push({level:['near','mid','far'][index],uri,hash:hash(binary),bytes:binary.length,residentBytes:resident,triangles:metrics.triangles,drawCalls:metrics.drawCalls,nearDetails:metrics.nearDetails,minScreenPixels:index===0?950:240,content:index===0?'Legacy geometry and near attachments (snapshot)' : index===1?'Footprint extrusions / simplified body':'Merged silhouette boxes'});
      registry.release(resources);
    }
    chunks.push({id:`${ix}-${iz}`,contentBounds:{min:contentBounds.min.toArray(),max:contentBounds.max.toArray()},transform:{translation:[0,0,0]},lods});
  }
  const manifest={schemaVersion:1,generator:{id:'runtime-fixture-builder',version:'1'},origin:{lat:0,lon:0},coordinateSystem:'x-east,y-up,z-south;meters',bounds:[bounds[0],0,bounds[1],bounds[2],550,bounds[3]],sources:[{kind,hash:sourceHash,attribution:kind==='synthetic'?'Synthetic stress geometry · not OSM':'© OpenStreetMap contributors · ODbL-1.0'}],attribution:kind==='synthetic'?'City Ink synthetic runtime fixture':'© OpenStreetMap contributors · openstreetmap.org/copyright',style:{contractVersion:1},chunks,featureIndex,fixture:{codec:'runtime-fixture-v1',kind,sourceCount,selectedCount,coverageBounds:bounds,tileSizeMeters:tileSize||[(bounds[2]-bounds[0])/side,(bounds[3]-bounds[1])/side],note:'Runtime adapter evidence; not the phase-one A compiler or C style integration.'}};
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  const report={name,kind,sourceHash,inputFeatures:sourceCount,selectedFeatures:selectedCount,chunks:chunks.length,packageBytes,buildMs:performance.now()-started,rssBefore:memoryBefore,rssAfter:process.memoryUsage().rss,manifestHash:hash(JSON.stringify(manifest)),nearTriangles:chunks.reduce((s,c)=>s+c.lods[0].triangles,0),farTriangles:chunks.reduce((s,c)=>s+c.lods[2].triangles,0),coverageBounds:bounds,tileSizeMeters:manifest.fixture.tileSizeMeters};
  await fs.writeFile(path.join(directory,'build-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
const features=syntheticFeatures();
for(const side of [1,2,4])await build(`synthetic-fixed-${side*side}`,{bounds:[-750,-750,750,750],side,kind:'synthetic',features,sourceHash:hash(JSON.stringify(features))});
for(const side of [1,2,3])await build(`synthetic-grow-${side*side}`,{bounds:[-750,-750,-750+side*500,-750+side*500],side,kind:'synthetic',features,sourceHash:hash(JSON.stringify(features)),tileSize:500});
for(const [name,size] of [['beijing-cbd',500],['kyoto-gion',300]]) {
  const raw=await fs.readFile(`public/data/${name}.json`),data=parseOSM(JSON.parse(raw));
  // Physical size stays fixed within each source snapshot. No repeated cities.
  for(const side of [1,2,3])await build(`${name}-grow-${side*side}`,{bounds:[-size*1.5,-size*1.5,-size*1.5+side*size,-size*1.5+side*size],side,kind:'OSM-legacy-adapter',data,sourceHash:hash(raw),tileSize:size});
}
