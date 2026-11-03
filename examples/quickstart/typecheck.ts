import {createCityViewer, type CityViewer} from 'beijing-city-ink';
import {compileScene, validateProjectConfig, type ProjectConfig} from 'beijing-city-ink/core';
import {registerStyle, getStyle} from 'beijing-city-ink/styles';
import {bundleProjectStyle} from 'beijing-city-ink/styles/project-bundle';
import {createLandmarkRegistry} from 'beijing-city-ink/landmarks';
import {normalizeOSM} from 'beijing-city-ink/data';
import {createLocalServer} from 'beijing-city-ink/local-server';

const config:ProjectConfig={schemaVersion:1,name:'typed consumer',area:{south:39.908,west:116.459,north:39.910,east:116.462},source:{kind:'import',file:'data/source.json'},quality:'low',landmarks:{enabled:true,packages:[{path:'rules/packages/local.json',hash:'hash'}]}};
const validation=validateProjectConfig(config);
if(validation.valid&&validation.value) {
  const registry=createLandmarkRegistry();
  void compileScene({elements:[]},validation.value,{landmarkRegistry:registry,onProgress:p=>console.log(p.stage)});
}
registerStyle(getStyle('comic'));
async function start(container:HTMLElement):Promise<CityViewer>{
  const viewer=await createCityViewer({container,manifestUrl:'./scene/manifest.json',quality:'balanced',budget:{residentBytes:128*1024*1024,concurrentLoads:3},onDiagnostic:d=>console.warn(d.code,d.url),onSelect:feature=>console.log(feature?.featureId)});
  await viewer.whenIdle();viewer.setView({position:[100,150,200],target:[0,0,0],fov:45});
  const frame=viewer.getStats({raw:true}).rendering.frames?.[0];if(frame){const near:number=frame.bodyNearDetails+frame.nearAttachmentDetails;const bytes:number=frame.nearGeometryArrayBytes;void near;void bytes;}
  await viewer.setStyle('line');await viewer.exportGLB({scope:'complete'});await viewer.exportPNG({width:1280,height:720});
  return viewer;
}
void start;
const normalized=normalizeOSM({elements:[]},{area:config.area});
void normalized.contentHash;
async function localNodeServer(){const service=await createLocalServer({workspaceRoot:'work/studio',port:0});service.server.address();await service.close();}
void localNodeServer;
async function bundleLocalStyle(){const result=await bundleProjectStyle('.', {id:'project-sepia',entry:'styles/sepia.js',dependencies:{palette:'styles/palette.js'},assets:['styles/paper.svg'],parameters:{aoStrength:.12}});const files:string[]=result.report.files;const bytes:Uint8Array|undefined=result.assets.get(files[0]);return {module:result.module,bytes};}
void bundleLocalStyle;
