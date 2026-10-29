import test from 'node:test';
import assert from 'node:assert/strict';
import {writeLoftSkin} from '../src/facade-loft.js';

test('tapered and expanding loft rings share exact UV seams and stable bay count',()=>{
  const reference=[[-25,-20],[-25,20],[25,20],[25,-20]];
  const rings=[1,.7,.9,1.2].map(s=>reference.map(p=>p.map(v=>v*s)));
  const faces=[],writer={quad:(positions,normal,color,id,uv)=>faces.push({positions,normal,uv})};
  for(let k=0;k<3;k++)writeLoftSkin(writer,rings[k],rings[k+1],k*30,(k+1)*30,'#fff',1,4,reference);
  for(let k=0;k<2;k++)for(let side=0;side<4;side++){
    const a=faces[k*4+side],b=faces[(k+1)*4+side];
    assert.deepEqual(a.positions[3],b.positions[0]);
    assert.deepEqual(a.uv[3],b.uv[0],'same physical seam must have the same facade coordinate');
    assert.deepEqual(a.uv[2],b.uv[1]);
    assert.equal(a.uv[0][2],180);
    assert(Math.abs(Math.hypot(...a.normal)-1)<1e-12);
  }
  assert.throws(()=>writeLoftSkin(writer,reference,reference.slice(1),0,30,'#fff',1),/matching vertices/);
});
