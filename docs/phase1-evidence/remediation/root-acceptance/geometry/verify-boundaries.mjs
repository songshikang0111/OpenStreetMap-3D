import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import * as THREE from 'three';
import {compileScene} from '../../src/core/index.js';
import {decodeChunk} from '../../src/core/scene-codec.js';
import {lowBuilding} from '../../src/core/geometry.js';
import {continuityFixture} from '../../test/phase1-core-fixture.js';
import {farDeckGeometry} from '../../src/core/lod-surfaces.js';
const cwd='C:\\Users\\宋世康\\.codex\\worktrees\\phase1-integration\\beijing-city-ink';
const report={commit:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),date:new Date().toISOString(),command:'node work/root-remediation-geometry/verify-boundaries.mjs',cases:[]};
const {raw,config}=continuityFixture();raw.elements=raw.elements.filter(e=>e.type==='way'&&[1,2].includes(e.id));
const match={recipeId:'audit/external',recipeVersion:'1.0.0',generatorId:'audit/custom',claimedFeatureIds:['w1','w2']};
let sources;
const registry={recipes:[{}],match:()=>[match],generate:()=>{
 const group=new THREE.Group();group.position.set(33,4,-17);group.rotation.y=.3;
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,5,0,0,0,5,0,5,0,0,5,5,0,0,5,0],3));g.computeVertexNormals();g.setAttribute('aParcel',new THREE.Uint8BufferAttribute([11,12,13,14,15,16],1,true));g.addGroup(0,3,1);g.addGroup(3,3,0);g.userData.city={materialRoles:['glass','structure']};
 const colors=['#ff0000','#0000ff'];const multi=new THREE.Mesh(g,colors.map(color=>new THREE.MeshStandardMaterial({color})));multi.name='reverse-material-groups';multi.userData.city={featureId:'w1',materialRole:'structure'};group.add(multi);
 const single=new THREE.Mesh(new THREE.BoxGeometry(3,8,4),new THREE.MeshStandardMaterial({color:'#00ff00'}));single.name='negative-scale';single.scale.set(-1,1,1);single.position.set(-20,5,7);single.userData.city={featureId:'w2',materialRole:'wall'};group.add(single);
 const instanceGeo=new THREE.BoxGeometry(1,2,3);instanceGeo.setAttribute('aVariant',new THREE.InstancedBufferAttribute(new Float32Array([11,22]),1,false,2));
 const instances=new THREE.InstancedMesh(instanceGeo,new THREE.MeshStandardMaterial(),3);instances.name='external-instances';instances.userData.city={instanceFeatureIds:['w1','w2','w1'],materialRole:'structure'};
 for(let i=0;i<3;i++){instances.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i*40-40,10,0));instances.setColorAt(i,new THREE.Color(colors[i%2]));}group.add(instances);group.updateMatrixWorld(true);
 sources={multi:multi.matrixWorld.toArray(),single:single.matrixWorld.toArray(),instances:instances.matrixWorld.toArray()};return {group,claimedFeatureIds:match.claimedFeatureIds,provenance:{source:'explicit synthetic review recipe'}};
}};
if(!process.argv.includes('--shapes-only')){
const result=await compileScene(raw,{...config,tiling:{divisions:4}},{landmarkRegistry:registry});
assert.equal(new Set(['w1','w2'].map(id=>result.manifest.featureIndex[id].ownerChunk)).size,1);const owner=result.manifest.featureIndex.w1.ownerChunk;
for(const level of ['low','medium','high']){
 const chunk=result.manifest.chunks.find(c=>c.id===owner),d=chunk.lods.find(l=>l.id===level),g=await decodeChunk(result.assets[d.uri],d);const ms=g.children.filter(m=>m.userData.city.recipeId===match.recipeId);assert.equal(ms.length,3);for(const mesh of ms)assert.deepEqual(mesh.userData.city.featureIds,['w1','w2']);
 const multi=ms.find(m=>m.name==='reverse-material-groups');assert.deepEqual(multi.material.map(m=>m.color.getHexString()),['ff0000','0000ff']);assert.deepEqual(multi.geometry.groups,[{start:0,count:3,materialIndex:1},{start:3,count:3,materialIndex:0}]);assert.deepEqual(Array.from(multi.geometry.attributes.aParcel.array),[11,12,13,14,15,16]);assert.equal(multi.geometry.attributes.aParcel.normalized,true);assert.deepEqual(multi.matrix.toArray(),sources.multi);
 const table=multi.userData.city.materialRoleTable;assert.deepEqual(Array.from(multi.geometry.attributes.cityMaterialRole.array),[...Array(3).fill(table.indexOf('structure')),...Array(3).fill(table.indexOf('glass'))]);
 const single=ms.find(m=>m.name==='negative-scale');assert.ok(single.matrix.determinant()<0);assert.deepEqual(single.matrix.toArray(),sources.single);
 const instances=ms.find(m=>m.name==='external-instances');assert.deepEqual(instances.userData.city.instanceFeatureIds,['w1','w2','w1']);assert.deepEqual(Array.from(instances.geometry.attributes.aVariant.array),[11,11,22]);assert.equal(instances.geometry.attributes.aVariant.meshPerAttribute,1);assert.deepEqual(Array.from(instances.instanceColor.array),[1,0,0,0,0,1,1,0,0]);assert.deepEqual(instances.matrix.toArray(),sources.instances);assert.deepEqual(instances.userData.city.sourceIds,['way/1','way/2']);
 report.cases.push({name:`external multi-material / normalized attribute / reflected transform / repeated and divided instance attributes (${level})`,status:'pass'});
}
}
function roofArea(mesh){const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;let area=0;for(let i=0;i<p.count;i+=3)if(n.getY(i)>.5){const a=[p.getX(i),p.getZ(i)],b=[p.getX(i+1),p.getZ(i+1)],c=[p.getX(i+2),p.getZ(i+2)];area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}return area;}
const building={id:'courtyard',outer:[[0,0],[5,.12],[10,0],[10,10],[0,10]],holes:[[[4,.03],[6,.03],[6,.08],[4,.08]]],height:20,minHeight:0,tags:{building:'yes'}};
// Hole is deliberately in the shallow outward bay: removing its defining vertex would cover it.
const validBuilding={...building,outer:[[0,0],[5,-.12],[10,0],[10,10],[0,10]],holes:[[[4.5,-.08],[5.5,-.08],[5.5,-.03],[4.5,-.03]]]};
const low=lowBuilding(validBuilding,new THREE.MeshStandardMaterial(),false);const outerArea=100+.6,holeArea=.05;assert.ok(Math.abs(roofArea(low)-(outerArea-holeArea))<.0001);report.cases.push({name:'close courtyard survives rejected exterior simplification',status:'pass',roofArea:roofArea(low)});
const decks=[{roadId:1,level:'7',thickness:.65,polygon:[[0,0],[10,0],[10,8],[0,8]],a:[0,4],b:[10,4],yA:2,yB:7},{roadId:1,level:'7',thickness:.65,polygon:[[10,0],[20,0],[20,8],[10,8]],a:[10,4],b:[20,4],yA:7,yB:3}];
const deck=farDeckGeometry(decks),p=deck.attributes.position,n=deck.attributes.normal;let bottom=0,peakSeen=false;for(let i=0;i<p.count;i++){if(n.getY(i)<-.1){const x=p.getX(i),expected=(x<=10?2+x*.5:7-(x-10)*.4)-.65;assert.ok(Math.abs(p.getY(i)-expected)<.001);if(Math.abs(x-10)<1e-6)peakSeen=true;bottom++;}}assert.ok(peakSeen&&bottom>0);report.cases.push({name:'bridge non-planar underside retains the internal slope break',status:'pass'});
report.status='pass';report.endCommit=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();assert.equal(report.commit,report.endCommit);writeFileSync(new URL('./boundary-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));


