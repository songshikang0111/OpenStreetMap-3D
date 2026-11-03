// This module is copied verbatim beside the bundled SDK by city export web.
import {createCityViewer} from './assets/city-ink.js';
const status=document.getElementById('status');
try {
  const config=await fetch('./viewer-config.json').then(response=>response.json());
  const viewer=await createCityViewer({container:document.getElementById('city'),manifestUrl:'./scene/manifest.json',style:config.style,quality:config.quality,onDiagnostic:d=>{status.textContent=d.message || JSON.stringify(d);}});
  if(config.camera)viewer.setView(config.camera);
  document.getElementById('style').value=config.style?.id || 'comic';
  globalThis.cityViewer=viewer;
  document.getElementById('style').addEventListener('change',event=>viewer.setStyle(event.target.value));
  const credit=document.createElement('a');credit.href='https://www.openstreetmap.org/copyright';credit.textContent='© OpenStreetMap contributors';credit.target='_blank';credit.rel='noopener';status.replaceChildren(credit,document.createTextNode(' · ODbL'));
  window.addEventListener('pagehide',()=>viewer.dispose(),{once:true});
}catch(error){status.textContent=error.message;globalThis.cityViewerError=error.message;}
