import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATIONS,resolveLocation,loadLocationData,coordinateLabel,genericViews } from '../src/locations.js';
import { mergeOSMOverlay } from '../src/osm.js';

test('new regions load their own extract without Beijing overlays or regional profile',async()=>{
  for(const site of LOCATIONS.slice(1)){
    const calls=[];
    const raw=await loadLocationData(site,async name=>{calls.push(name);return {metadata:{name},elements:[]};},mergeOSMOverlay);
    assert.deepEqual(calls,[site.file]);assert.equal(raw.metadata.landscapeProfile,undefined);
  }
});
test('the original region retains its two overlays and landscape profile',async()=>{
  const calls=[];
  const raw=await loadLocationData(LOCATIONS[0],async name=>{calls.push(name);return {metadata:{name},elements:[{type:'way',id:calls.length}]};},mergeOSMOverlay);
  assert.deepEqual(calls,['beijing-cbd','street-details','landscape-details','landscape-profile']);
  assert.equal(raw.elements.length,3);assert(raw.metadata.landscapeProfile);
});
test('location URLs are allowlisted and coordinate labels support all hemispheres',()=>{
  assert.equal(resolveLocation('').id,'beijing');assert.equal(resolveLocation('?site=kyoto').file,'kyoto-gion');
  assert.throws(()=>resolveLocation('?site=../../private'));
  assert.equal(coordinateLabel([-33.86,-151.21]),'33.86000° S · 151.21000° W');
});
test('generic camera framing uses district scale and actual building positions',()=>{
  const data={bounds:[-400,-300,400,300],buildings:[{center:[200,200],area:200,height:20},{center:[10,0],area:100,height:8}]};
  const views=genericViews(data);assert.deepEqual(views.facade.target,[10,3.6,0]);
  assert(views.overview.position[1]>500);assert(views.overview.target[1]<20);
  for(const view of Object.values(genericViews({bounds:[-200,-200,200,200],buildings:[]})))assert(view.position.every(Number.isFinite));
});
