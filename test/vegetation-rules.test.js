import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTreeHabit } from '../src/vegetation-rules.js';
import { planStreetLife } from '../src/streetlife.js';
import { parseOSM } from '../src/osm.js';
const needle=t=>['cypress','conifer'].includes(t.shape);
const empty=()=>({bounds:[-400,-400,400,400],buildings:[],roads:[],trees:[],treeRows:[],greens:[],streetNodes:[]});
const rect=(x,z,size)=>[[x,z],[x+size,z],[x+size,z+size],[x,z+size]];

test('OSM leaf types and known taxa override decorative mixes without treating all evergreen trees as conifers',()=>{
  for(let seed=0;seed<20;seed++){
    const options={seed,context:'woodland',group:'test',patch:String(seed),mix:{woodland:1}};
    assert(!needle(chooseTreeHabit({...options,tags:{leaf_type:'broadleaved'}})));
    assert(needle(chooseTreeHabit({...options,mix:{woodland:0},tags:{leaf_type:'needleleaved'}})));
    assert.equal(chooseTreeHabit({...options,tags:{genus:'Platycladus'}}).shape,'cypress');
    assert.equal(chooseTreeHabit({...options,tags:{species:'Picea abies'}}).shape,'conifer');
    assert(!needle(chooseTreeHabit({...options,tags:{genus:'Quercus',leaf_cycle:'evergreen'}})));
    assert(!needle(chooseTreeHabit({tags:{leaf_cycle:'evergreen'}})));
  }
});

test('mixed planting is patch coherent, independent of iteration order, and profile configurable',()=>{
  const options={context:'park-belt',group:'park-A',seed:1};
  const shapes=Array.from({length:100},(_,i)=>chooseTreeHabit({...options,patch:String(i)}));
  assert(shapes.filter(needle).length>15&&shapes.filter(needle).length<50);
  assert(shapes.some(t=>t.shape==='conifer')&&shapes.some(t=>t.shape==='cypress'));
  for(let i=99;i>=0;i--)assert.deepEqual(shapes[i],chooseTreeHabit({...options,patch:String(i),key:'a different tree in same patch'}));
  assert(!needle(chooseTreeHabit({...options,mix:{'park-belt':0}})));
  assert(needle(chooseTreeHabit({...options,mix:{'park-belt':1}})));
  const courts=Array.from({length:100},(_,i)=>chooseTreeHabit({...options,context:'garden-court',patch:String(i)}));
  assert(courts.some(needle)&&courts.some(t=>!needle(t)),'landscape garden-court template receives a mix too');
});

test('OSM tree point, row and polygon tags reach rendered habits; untagged streets stay broadleaf',()=>{
  const data=empty();data.trees=[{id:1,point:[-300,-300],height:10,tags:{leaf_type:'needleleaved',genus:'Platycladus'}}];
  data.treeRows=[{id:2,points:[[-300,-240],[-100,-240]],tags:{leaf_type:'needleleaved'}}];
  data.greens=[{id:3,outer:rect(-100,-100,180),holes:[],tags:{natural:'wood',leaf_type:'needleleaved'}},{id:4,outer:rect(150,150,180),holes:[],tags:{natural:'wood',leaf_type:'broadleaved'}}];
  data.roads=[{id:5,type:'primary',width:12,layer:0,segments:[[[-300,100],[300,100]]]}];
  const trees=planStreetLife(data).trees;
  assert.equal(trees.find(t=>t.key==='osm:1').shape,'cypress');
  assert(trees.filter(t=>t.key.startsWith('row:2:')).every(needle));
  assert(trees.filter(t=>t.key.startsWith('green:3:')).every(needle));
  assert(trees.filter(t=>t.key.startsWith('green:4:')).every(t=>!needle(t)));
  assert(trees.filter(t=>t.source==='inferred-street').every(t=>!needle(t)));
});

test('OSM parsing retains tree species metadata for the planting stage',()=>{
  const raw={metadata:{bbox:[39.9,116.45,39.91,116.47]},elements:[{type:'node',id:1,lat:39.905,lon:116.46,tags:{natural:'tree',leaf_type:'needleleaved',genus:'Pinus',height:'9'}}]};
  const data=parseOSM(raw);assert.equal(data.trees[0].tags.genus,'Pinus');assert.equal(data.trees[0].tags.leaf_type,'needleleaved');
});
