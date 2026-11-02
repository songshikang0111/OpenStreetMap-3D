import test from 'node:test';
import assert from 'node:assert/strict';
import { planRoof,writeRoof } from '../src/roofs.js';
import { heightInfo,inside } from '../src/osm.js';
import { buildCity } from '../src/city.js';
import { encodeView,decodeView } from '../src/view-state.js';
import fs from 'node:fs';
import { parseOSM } from '../src/osm.js';

const ring=[[0,0],[12,0],[12,8],[0,8]];
const sample=(tags={})=>({id:'roof-house',outer:ring,holes:[],area:96,center:[6,4],height:10,minHeight:0,levels:3,source:'height',tags:{building:'house',...tags}});

test('roof inference is opt-in, bounded and never overrides explicit flat or unsupported shapes',()=>{
  assert.equal(planRoof(sample()).supported,false);
  assert.equal(planRoof(sample(),{inferRoofs:true}).source,'inferred');
  for(const b of [sample({'roof:shape':'flat'}),sample({'roof:shape':'round'}),sample({building:'commercial'}),{...sample(),height:25},{...sample(),part:true}])assert.equal(planRoof(b,{inferRoofs:true}).supported,false);
  const known=planRoof(sample({'roof:shape':'gabled','roof:height':'3'}));
  assert.equal(known.rise,3);assert.equal(known.top,10.45);
  assert.equal(heightInfo({'building:levels':2,'roof:height':3},96,'a').height,9.2);
  assert.equal(heightInfo({height:10,'building:levels':2,'roof:height':3},96,'a').height,10);
  assert.equal(decodeView(encodeView({version:2,toggles:{'roof-inference-toggle':true}})).toggles['roof-inference-toggle'],true);
});

test('four slope types cover the actual concave footprint, retain courtyard holes and preserve the tagged apex',()=>{
  for(const shape of ['gabled','hipped','pyramidal','skillion']){
    const b={...sample({'roof:shape':shape,'roof:height':'3'}),outer:[[0,0],[12,0],[12,8],[8,8],[8,6],[0,6]],holes:[[[2,2],[4,2],[4,4],[2,4]]]};
    const plan=planRoof(b),triangles=[];
    const writer={triangle:(a,c,d,n)=>triangles.push({points:[a,c,d],n}),quad:()=>{}};
    writeRoof(writer,b,plan,'#888888',1,'#dddddd');
    let area=0,highest=0;
    for(const t of triangles){
      assert(t.n[1]>0);assert(t.points.flat().every(Number.isFinite));
      const [a,c,d]=t.points;area+=Math.abs((c[0]-a[0])*(d[2]-a[2])-(c[2]-a[2])*(d[0]-a[0]))/2;
      const p=[(a[0]+c[0]+d[0])/3,(a[2]+c[2]+d[2])/3];
      assert(inside(p,b.outer));assert(!inside(p,b.holes[0]));highest=Math.max(highest,...t.points.map(p=>p[1]));
    }
    assert(Math.abs(area-76)<.0001);assert(Math.abs(highest-plan.top)<.0001);
  }
});

test('city integration removes flat caps, parapets and roof equipment on pitched houses and preserves total height',()=>{
  const b=sample({'roof:shape':'gabled','roof:height':'3'}),data={bounds:[-20,-20,30,30],buildings:[b],roads:[],trees:[],treeRows:[],streetNodes:[],greens:[],water:[],landscapes:[]};
  const city=buildCity(data),mesh=city.buildings[0],p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
  assert.equal(city.roofStats.tagged,1);assert.equal(city.landscapeStats.inferredSites,0);
  let max=-Infinity,roofTriangles=0;
  for(let i=0;i<p.count;i++){max=Math.max(max,p.getY(i));if(p.getY(i)>7.45&&n.getY(i)>.1)roofTriangles++;}
  assert(Math.abs(max-10.45)<.0001);assert(roofTriangles>0);assert.equal(city.equipment.geometry.attributes.position.count,0);
  assert.equal(b.height,10);
});

test('actual Shuhe ridge/footprint coincidences cannot abort a district or lose roof area',()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('../public/data/lijiang-shuhe.json',import.meta.url)));
  for(const b of parseOSM(raw).buildings){
    const plan=planRoof(b,{inferRoofs:true});if(!plan.supported)continue;
    let projectedArea=0;
    writeRoof({triangle:(a,c,d)=>{assert([...a,...c,...d].every(Number.isFinite));projectedArea+=Math.abs((c[0]-a[0])*(d[2]-a[2])-(c[2]-a[2])*(d[0]-a[0]))/2;},quad:()=>{}},b,plan,'#888888',1,'#dddddd');
    assert(Math.abs(projectedArea-b.area)<.001,b.id);
  }
});
