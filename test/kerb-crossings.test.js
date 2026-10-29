import test from 'node:test';
import assert from 'node:assert/strict';
import {clipKerbsAtCrossings} from '../src/streetlife.js';

test('crosswalk approaches cut both roadside kerbs while keeping remote sections and input intact',()=>{
  const curbs=[-6.12,6.12].map(x=>({point:[x,0],angle:0,length:40}));
  curbs.push({point:[30,0],angle:0,length:40});
  const original=structuredClone(curbs);
  const result=clipKerbsAtCrossings(curbs,[{point:[0,0],angle:0,width:11}]);
  assert.deepEqual(curbs,original);assert.equal(result.cutSegments,2);assert.equal(result.curbs.length,5);
  assert(Math.abs(result.droppedLength-9.6)<1e-6);
  assert.deepEqual(result.curbs.at(-1),curbs.at(-1));
  for(const curb of result.curbs.slice(0,-1))assert(Math.abs(curb.point[1])-curb.length/2>=2.4-1e-6);
});

test('kerb clearance follows rotated crossings and is stable under translated map coordinates',()=>{
  const angle=.71,d=[Math.sin(angle),Math.cos(angle)],s=[-d[1],d[0]],origin=[123,-237];
  const curbs=[{point:origin.map((v,i)=>v+s[i]*6.12),angle,length:25}];
  const crossing={point:origin,angle,width:11};
  const result=clipKerbsAtCrossings(curbs,[crossing]);assert.equal(result.curbs.length,2);
  assert(Math.abs(result.droppedLength-4.8)<1e-6);
  for(const curb of result.curbs){assert.equal(curb.angle,angle);assert(curb.length>9);assert(curb.point.every(Number.isFinite));}
  const repeated=clipKerbsAtCrossings(result.curbs,[crossing]);assert.equal(repeated.cutSegments,0);assert.equal(repeated.curbs.length,2);
});
