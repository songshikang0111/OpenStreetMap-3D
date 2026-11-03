import test from 'node:test';
import assert from 'node:assert/strict';
import {areaAround,validateArea,createStudioApi,ApiError,isTerminal} from '../studio/api.js';

test('studio retains named range precision and rejects reversed/invalid boundaries',()=>{
  const area=areaAround({lat:39.9095,lon:116.4605},250);
  assert.deepEqual(validateArea(JSON.parse(JSON.stringify(area))),area);
  assert.ok(Math.abs((area.south+area.north)/2-39.9095)<1e-10);
  assert.throws(()=>validateArea({...area,north:area.south}));
  assert.throws(()=>areaAround({lat:90,lon:0},250));
  assert.throws(()=>areaAround({lat:39,lon:116},2001));
});

test('studio API preserves failed/cancelled jobs instead of fabricating success or dropping status',async()=>{
  let call;
  const api=createStudioApi({fetchImpl:async(url,options)=>{call={url,options};return {ok:true,json:async()=>({job:{id:'j1',status:'failed',diagnostics:[{code:'BUILD_FAILED'}]}})};}});
  const response=await api.job('a/b');
  assert.equal(call.url,'/api/jobs/a%2Fb');assert.equal(response.job.status,'failed');assert.ok(isTerminal(response.job));
  await api.start('p1','build',{},'j1');
  assert.deepEqual(JSON.parse(call.options.body),{kind:'build',parameters:{},resume:'j1'});
  assert.equal(call.options.method,'POST');
});

test('studio displays structured service errors and rejects HTML fallback pages',async()=>{
  const api=createStudioApi({fetchImpl:async()=>({ok:false,status:400,json:async()=>({diagnostics:[{code:'AREA_INVALID',message:'area invalid',hint:'reduce area'}]})})});
  await assert.rejects(api.create({}),error=>error instanceof ApiError && error.diagnostics[0].code==='AREA_INVALID');
  const html=createStudioApi({fetchImpl:async()=>({ok:true,status:200,json:async()=>{throw new Error('HTML');}})});
  await assert.rejects(html.projects(),/city studio/);
});
