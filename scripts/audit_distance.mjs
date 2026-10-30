import fs from 'node:fs';
import * as THREE from 'three';
import { parseOSM,mergeOSMOverlay } from '../src/osm.js';
import { buildCity } from '../src/city.js';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/data/${name}.json`,import.meta.url)));
const raw=read('beijing-cbd');for(const name of ['street-details','landscape-details'])mergeOSMOverlay(raw,read(name),name);
raw.metadata.landscapeProfile=read('landscape-profile');
const city=buildCity(parseOSM(raw)),views=JSON.parse(fs.readFileSync('docs/evidence-distance-v07/views.json','utf8'));
const results={};
for(const [name,view]of Object.entries(views)){
  const camera=new THREE.PerspectiveCamera(view.parameters.lens,1600/767,.8,7000);
  camera.position.fromArray(view.position);camera.lookAt(...view.target);city.updateLOD(camera,767);
  const {visible,total}=city.equipment.userData.lod;
  results[name]={retainedGroups:visible,totalGroups:total};
}
console.log(JSON.stringify({scope:'CPU audit of retained projected roof equipment groups; not screen visibility or GPU FPS',cssViewportHeight:767,views:results},null,2));
