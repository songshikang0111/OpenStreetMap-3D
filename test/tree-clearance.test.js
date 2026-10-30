import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeStreetLife } from '../src/streetlife.js';
import { treeStructureClearance } from '../src/tree-clearance.js';

const bridge=(y=7)=>({a:[-20,0],b:[20,0],yA:y,yB:y,y,width:10,walk:false,road:{id:'viaduct',width:10,type:'primary',bridge:true}});
const tree=(key,x,z,extra={})=>({key,x,z,h:10,radius:4,crownBottom:4.5,crownTop:11.5,rotation:0,variation:.4,shape:'spreading',source:'inferred-street',...extra});
const fixture=trees=>({trees,curbs:[],crosswalks:[],cars:[],people:[],lamps:[],signals:[],stats:{trees:trees.length,streetTrees:trees.filter(t=>t.source==='inferred-street').length,generatedTrees:trees.filter(t=>t.source!=='osm').length}});

test('vehicle bridge slabs and parapets exclude crowns, while real OSM trees remain attributed',()=>{
  const roadPlan={segments:[bridge()]};
  const plan=fixture([tree('slab',0,8),tree('parapet',8,8,{crownBottom:7.5}),tree('clear',0,12),tree('observed',0,0,{source:'osm'})]);
  const result=gradeStreetLife(plan,roadPlan);
  assert.deepEqual(result.trees.map(t=>t.key),['clear','observed']);
  assert.equal(result.stats.vehicleStructureSuppressedTrees,2);assert.equal(result.stats.structureSuppressedTrees,2);
  assert.equal(result.stats.streetTrees,1);assert.equal(result.stats.generatedTrees,1);
  assert.equal(plan.trees.length,4,'filtering must not mutate the input plan');
});

test('vertical clearance preserves a high crown beside a low bridge and a short tree below a high bridge',()=>{
  const low=treeStructureClearance({segments:[bridge(2)]}),high=treeStructureClearance({segments:[bridge(20)]});
  assert.equal(low(tree('above-low-bridge',0,8)),null,'low rail stays below crown and root remains beside the deck');
  assert.equal(high(tree('under-high-bridge',0,0)),null,'high slab clears both trunk and crown');
  const trunk=tree('trunk-through-deck',0,0,{h:20,crownBottom:14,crownTop:23});
  const hit=treeStructureClearance({segments:[bridge(7)]})(trunk);
  assert.equal(hit.part,'trunk','a high crown must not hide a stem that passes through a bridge');
});

test('clearance uses actual joined deck footprint rather than an infinite centreline strip',()=>{
  const segment=bridge(),surface={roadId:'viaduct',kind:'drive',bridge:true,a:segment.a,b:segment.b,yA:7,yB:7,y:7,polygon:[[-20,-5],[20,-5],[20,12],[-20,12]]};
  const query=treeStructureClearance({segments:[segment],surfaces:[surface]});
  assert(query(tree('joined-corner',0,14,{radius:3})), 'the widened junction deck must be reserved too');
  assert.equal(query(tree('beyond-bridge-end',30,0,{radius:3})),null);
});

test('a long rising bridge uses local height across the tree crown instead of the whole bridge height range',()=>{
  const segment={...bridge(),a:[-100,0],b:[100,0],yA:2,yB:20,y:11};
  const query=treeStructureClearance({segments:[segment]});
  assert.equal(query(tree('below-high-end',90,8,{h:8,crownBottom:4,crownTop:9})),null);
  assert(query(tree('intersect-middle',0,8,{crownBottom:8,crownTop:14})));
  assert.equal(query(tree('above-low-end',-90,8,{crownBottom:5,crownTop:12})),null);
});
