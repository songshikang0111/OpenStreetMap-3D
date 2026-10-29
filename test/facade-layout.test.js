import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { facadeGrammar, facadeLayout, facadeWindows } from '../src/facade-layout.js';
import { buildingStyle } from '../src/building-rules.js';
import { buildCity } from '../src/city.js';

test('facade grammars are stable and place glass inside wall and floor boundaries', () => {
  const names=new Set();
  for(const family of ['curtain','residential','ribbon','lowrise'])for(const variant of [0,.4,.9]){
    const style={family,variant,floor:3.8};
    assert.deepEqual(facadeGrammar(family,variant),facadeGrammar(family,variant));
    const layout=facadeLayout(27.2,38,style);names.add(layout.name);
    assert.equal(layout.attributes[0],Math.floor(27.2/layout.bay));
    for(const w of facadeWindows(layout)){
      assert(w.x-w.width/2>0&&w.x+w.width/2<27.2);
      assert(w.y-w.height/2>w.level*3.8&&w.y+w.height/2<(w.level+1)*3.8);
      // CPU positions correspond to the centre of the exact shader cell.
      assert(Math.abs(w.x/27.2*layout.attributes[0]-(w.bay+.5))<1e-10);
      assert(Math.abs(w.y/3.8-(w.level+.5))<1e-10);
      assert(Math.abs(w.width/2/(27.2/layout.attributes[0])-layout.attributes[1])<1e-10);
      assert(Math.abs(w.height/2/3.8-layout.attributes[2])<1e-10);
      if(w.split===2)assert(.16+.018<layout.attributes[2]);
    }
  }
  assert.equal(names.size,12);
});

test('solid nearby sills follow GPU layout at arbitrary wall length, including paired grammars', () => {
  const feature={id:'layout-test',osmId:42,osmType:'way',tags:{building:'office'},outer:[[0,0],[13.7,0],[13.7,10],[0,10]],holes:[],height:24,minHeight:0,levels:6,area:137,center:[6.85,5],source:'height'};
  const data={bounds:[-30,-30,40,40],buildings:[feature],roads:[],greens:[],water:[],trees:[],streetNodes:[],treeRows:[]};
  const city=buildCity(data),g=city.buildings[0].geometry;
  const p=g.attributes.position,f=g.attributes.aFacade,l=g.attributes.aLayout;
  let i=-1;
  for(let k=0;k<p.count;k++)if(Math.abs(p.getZ(k))<1e-6&&Math.abs(g.attributes.normal.getZ(k)+1)<1e-6&&f.getZ(k)>13){i=k;break;}
  assert(i>=0);
  const bays=l.getX(i),halfWidth=l.getY(i),halfHeight=l.getZ(i),floor=f.getW(i);
  city.updateLOD({position:new THREE.Vector3(6.85,8,-20)});
  const frames=city.detailGroup.children[0],matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();
  const firstRow=[];
  for(let k=0;k<frames.count;k++){
    frames.getMatrixAt(k,matrix);matrix.decompose(position,rotation,scale);
    if(Math.abs(position.z+.1)<1e-5&&Math.abs(scale.y-.13)<1e-5&&Math.abs(position.y-(.45+(1.5-halfHeight)*floor))<1e-4){
      firstRow.push(position.x);assert(Math.abs(scale.x-(13.7/bays)*halfWidth*2)<1e-5);
    }
  }
  assert.equal(firstRow.length,bays);
  for(const x of firstRow)assert(Math.abs(x/13.7*bays%1-.5)<1e-5);
  assert.equal(Object.values(city.grammarCounts).reduce((a,b)=>a+b,0),1);
  assert.equal(buildingStyle(feature).bay,facadeGrammar(buildingStyle(feature).family,buildingStyle(feature).variant).bay);
});
