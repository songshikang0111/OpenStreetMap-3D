import { CityBuildError, compileScene, validateProjectConfig, type ProjectConfig, type SceneManifest } from '../src/core/index.js';
import { decodeChunk } from '../src/core/scene-codec.js';

const error = new CityBuildError('EXAMPLE', 'Actionable message', 'config', {hint:'Use the schema.'});
const code:string = error.code;
const config:ProjectConfig = {schemaVersion:1,name:'typed',area:{south:0,west:0,north:.001,east:.001},source:{kind:'local',file:'data.json'}};
const valid:boolean = validateProjectConfig(config).valid;
async function consumer() {
  const result = await compileScene({elements:[]}, config, {onProgress:p=>{ const stage:string=p.stage; void stage; }});
  const manifest:SceneManifest=result.manifest;
  const descriptor=manifest.chunks[0].lods[0];
  const payload=result.assets[descriptor.uri];
  if(payload instanceof Uint8Array){const group=await decodeChunk(payload,descriptor);group.clear();}
}
void code;void valid;void consumer;
