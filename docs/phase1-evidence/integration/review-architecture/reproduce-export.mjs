import * as THREE from 'three';
import {writeFile} from 'node:fs/promises';
import {encodeChunk,decodeChunk,sceneStats} from '../../src/core/scene-codec.js';
import {sha256} from '../../src/core/contract.js';
import {exportViewerGLB} from '../../src/sdk/exports.js';
import {bindSceneStyle} from '../../src/styles/index.js';

// A synthetic two-color instance scene, carried through the real CINK and GLB codecs.
const source=new THREE.Group();
const inst=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:new THREE.Color(.5,1,.5)}),2);
inst.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-2,0,0));
inst.setMatrixAt(1,new THREE.Matrix4().makeTranslation(2,0,0));
inst.setColorAt(0,new THREE.Color(1,0,0));inst.setColorAt(1,new THREE.Color(0,0,1));
inst.userData.city={schemaVersion:1,featureId:'a',featureIds:['a','b'],instanceFeatureIds:['a','b'],sourceIds:['node/1','node/2'],kind:'tree',materialRole:'foliage'};
source.add(inst);
const payload=encodeChunk(source),descriptor={id:'high',url:'https://example.test/review/instances.cink',bytes:payload.byteLength,hash:await sha256(payload),...sceneStats(source)};
const manifest={schemaVersion:1,attribution:{text:'Synthetic review fixture'},origin:{lat:0,lon:0},coordinateSystem:{},featureIndex:{a:{featureId:'a',sourceIds:['node/1'],kind:'tree'},b:{featureId:'b',sourceIds:['node/2'],kind:'tree'}},chunks:[{id:'0',matrix:new THREE.Matrix4(),lods:[descriptor]}]};
const decoded=await decodeChunk(payload,descriptor);
const ctx={isDisposed:()=>false,manifest,budget:{residentBytes:1e7},streamer:{current:new Map([['0',{group:decoded}]])},readAsset:async()=>payload.buffer.slice(payload.byteOffset,payload.byteOffset+payload.byteLength),decodeChunk,bindGroup:g=>bindSceneStyle(g,{style:'color'})};
let controller,encodingStarted=false;
const previousReader=globalThis.FileReader;
// Node has Blob but no browser FileReader. This compatibility layer performs real async Blob reads.
class Reader {readAsArrayBuffer(blob){encodingStarted=true;blob.arrayBuffer().then(result=>{this.result=result;setTimeout(()=>{controller?.abort();this.onloadend?.({target:this});},25);});}}
globalThis.FileReader=Reader;
const results={date:new Date().toISOString(),sourceInstanceColors:[...decoded.children[0].instanceColor.array],sourceMaterialColor:decoded.children[0].material.color.toArray(),exports:{}};
try {
 for(const scope of ['loaded','complete']){
  const result=await exportViewerGLB(ctx,{scope}),bytes=new Uint8Array(await result.blob.arrayBuffer()),view=new DataView(bytes.buffer);
  const json=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+view.getUint32(12,true))).trim());
  results.exports[scope]={bytes:bytes.byteLength,materials:json.materials?.map(m=>m.pbrMetallicRoughness?.baseColorFactor||[1,1,1,1]),nodes:json.nodes?.filter(n=>n.mesh!==undefined).map(n=>({mesh:n.mesh,city:n.extras?.city}))};
 }
 controller=new AbortController();encodingStarted=false;
 try{const result=await exportViewerGLB(ctx,{scope:'loaded',signal:controller.signal});results.cancellation={encodingStarted,aborted:controller.signal.aborted,status:'fulfilled',bytes:result.blob.size};}
 catch(error){results.cancellation={encodingStarted,aborted:controller.signal.aborted,status:'rejected',name:error.name,code:error.code};}
 console.log(JSON.stringify(results));
 await writeFile(new URL('./export-reproduction-results.json',import.meta.url),JSON.stringify(results,null,2));
}finally{globalThis.FileReader=previousReader;for(const g of [source,decoded])g.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])m.dispose();});}
