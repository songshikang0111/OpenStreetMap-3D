import {loadProjectStyle,type LoadedProjectStyle,type ProjectStyleConfig,type PublishedStyleModule} from '../../../../src/styles/index.js';
import {bundleProjectStyle} from '../../../../src/styles/project-bundle.js';
import type {ProjectConfig} from '../../../../src/core/index.js';
import {createCityViewer} from '../../../../src/sdk/index.js';
const style:ProjectStyleConfig={id:'project-sepia',entry:'styles/sepia.js',dependencies:{palette:'styles/vendor.js'},assets:['styles/paper.svg'],parameters:{warmth:.23}};
const config:ProjectConfig={schemaVersion:1,name:'style module consumer',area:{south:39.9,west:116.4,north:39.901,east:116.401},source:{kind:'sample',file:'data/source.json'},style};
async function preview(root:string,container:HTMLElement){
  const result=await bundleProjectStyle(root,config.style);
  const descriptor:PublishedStyleModule|null=result.module;
  const loaded:LoadedProjectStyle=await loadProjectStyle(result.style,{module:descriptor,baseUrl:document.baseURI});
  const viewer=await createCityViewer({container,manifestUrl:'scene/manifest.json',style:loaded});
  await viewer.exportPNG();await viewer.exportGLB({scope:'complete'});await viewer.dispose();loaded.dispose();
}
void preview;
