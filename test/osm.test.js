import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projection, heightInfo, clipSegment, stitchRings, parseOSM, area, inside } from '../src/osm.js';
import { buildCity } from '../src/city.js';

test('WGS84 projection preserves coordinates and east/north orientation',()=>{
  const p=projection(39.91,116.46),point=p.point({lat:39.911,lon:116.461});
  assert.ok(point[0]>80&&point[0]<90);assert.ok(point[1]<-110&&point[1]>-112);
  const ll=p.inverse(point);assert.ok(Math.abs(ll[0]-39.911)<1e-8);assert.ok(Math.abs(ll[1]-116.461)<1e-8);
});
test('explicit height takes priority, feet convert, floors are inferred separately',()=>{
  assert.equal(heightInfo({height:'100', 'building:levels':'8'},100,'x').height,100);
  assert.equal(heightInfo({height:'100 ft'},100,'x').height,30.48);
  assert.equal(heightInfo({'building:levels':'6',building:'apartments'},100,'x').source,'levels');
  assert.equal(heightInfo({height:'234',min_height:'161'},100,'x').minHeight,161);
  assert.deepEqual(heightInfo({},100,'same'),heightInfo({},100,'same'));
  assert.equal(heightInfo({},100,'same').source,'estimated');
});
test('road clipping handles crossings, outside parallel segments, and degenerate points',()=>{
  assert.deepEqual(clipSegment([-3,0],[3,0],[-1,-1,1,1]),[[-1,0],[1,0]]);
  assert.equal(clipSegment([-3,3],[3,3],[-1,-1,1,1]),null);
  assert.deepEqual(clipSegment([0,0],[0,0],[-1,-1,1,1]),[[0,0],[0,0]]);
});
test('relation rings stitch reversed fragments without closing incomplete rings',()=>{
  const a={lat:0,lon:0},b={lat:0,lon:1},c={lat:1,lon:1},d={lat:1,lon:0};
  assert.equal(stitchRings([[a,b],[c,b],[c,d],[a,d]])[0].length,4);
  assert.equal(stitchRings([[a,b],[c,b]]).length,0);
});
test('multipolygon courtyard survives parsing and tagged member ways are not duplicated',()=>{
  const g=arr=>arr.map(([lon,lat])=>({lat,lon}));
  const outer=g([[0,0],[.002,0],[.002,.002],[0,.002],[0,0]]);
  const inner=g([[.0005,.0005],[.0015,.0005],[.0015,.0015],[.0005,.0015],[.0005,.0005]]);
  const result=parseOSM({metadata:{bbox:[-.01,-.01,.01,.01]},elements:[
    {type:'way',id:1,tags:{building:'yes'},geometry:outer},
    {type:'relation',id:2,tags:{type:'multipolygon',building:'yes',height:'12'},members:[{type:'way',ref:1,role:'outer',geometry:outer},{type:'way',ref:3,role:'inner',geometry:inner}]}]});
  assert.equal(result.buildings.length,1);assert.equal(result.buildings[0].holes.length,1);
  assert.ok(result.buildings[0].area<area(result.buildings[0].outer));
});
test('Beijing extract produces finite meshes, preserves real heights and elevated CCTV parts',()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('../public/data/beijing-cbd.json',import.meta.url),'utf8'));
  const data=parseOSM(raw);assert.ok(data.buildings.length>200);assert.ok(data.roads.length>200);assert.equal(data.stats.invalidRings,0);
  const zun=data.buildings.find(b=>b.tags.name==='中国尊');assert.ok(zun);assert.equal(zun.height,528);assert.equal(zun.source,'height');
  assert.ok(data.buildings.some(b=>b.minHeight===161&&b.height===234));
  for(const road of data.roads)for(const segment of road.segments)for(const [x,z]of segment){assert.ok(x>=data.bounds[0]-.001&&x<=data.bounds[2]+.001);assert.ok(z>=data.bounds[1]-.001&&z<=data.bounds[3]+.001);}
  const city=buildCity(data);let triangleVertices=0;
  for(const mesh of city.buildings){const g=mesh.geometry;assert.equal(g.attributes.position.count,g.attributes.normal.count);assert.equal(g.attributes.position.count,g.attributes.objectId.count);
    for(const value of g.attributes.position.array)assert.ok(Number.isFinite(value));triangleVertices+=g.attributes.position.count;
  }
  assert.ok(triangleVertices>3000);assert.equal(city.buildings.length,data.buildings.length);
  const first=city.buildings[0],original=first.geometry.attributes.color.array.slice();city.setProvenance(true);assert.notDeepEqual(first.geometry.attributes.color.array,original);city.setProvenance(false);assert.deepEqual(first.geometry.attributes.color.array,original);
  console.log(JSON.stringify({buildings:data.buildings.length,roads:data.roads.length,trees:city.treeCount,triangleVertices,heights:data.buildings.reduce((c,b)=>(c[b.source]=(c[b.source]||0)+1,c),{})}));
});
