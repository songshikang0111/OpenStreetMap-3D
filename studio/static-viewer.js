// This module is copied verbatim beside the bundled SDK by city export web.
import {createCityViewer,loadProjectStyle} from './assets/city-ink.js';
const status=document.getElementById('status');
let loadedStyle,viewer;
try {
  const config=await fetch('./viewer-config.json').then(response=>response.json());
  const style=await loadProjectStyle(config.style,{module:config.styleModule,baseUrl:new URL('./viewer-config.json',import.meta.url)});
  loadedStyle=style;
  viewer=await createCityViewer({container:document.getElementById('city'),manifestUrl:'./scene/manifest.json',style,quality:config.quality,onDiagnostic:d=>{status.textContent=d.message || JSON.stringify(d);}});
  if(config.camera)viewer.setView(config.camera);
  const select=document.getElementById('style');
  if(![...select.options].some(option=>option.value===style.id))select.add(new Option(style.id,style.id));
  select.value=style.id;
  globalThis.cityViewer=viewer;
  document.getElementById('style').addEventListener('change',async event=>{try{await viewer.setStyle(event.target.value===style.id?style:event.target.value);}catch(error){status.textContent=error.message;}});
  const credit=document.createElement('a');credit.href='https://www.openstreetmap.org/copyright';credit.textContent='© OpenStreetMap contributors';credit.target='_blank';credit.rel='noopener';status.replaceChildren(credit,document.createTextNode(' · ODbL'));
  window.addEventListener('pagehide',async()=>{try{await viewer.dispose();}finally{style.dispose();}},{once:true});
}catch(error){
  try{await viewer?.dispose();}catch{}
  loadedStyle?.dispose();status.textContent=error.message;globalThis.cityViewerError=error.message;
}
