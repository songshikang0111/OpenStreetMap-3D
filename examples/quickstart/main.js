import {createCityViewer} from '../../src/sdk/index.js';
// A normal static manifest URL; this app never calls the studio API or old demo entry.
const manifestUrl=new URLSearchParams(location.search).get('manifest') || './scene/manifest.json';
try {
  const viewer=await createCityViewer({container:document.getElementById('city'),manifestUrl,onDiagnostic:d=>{document.getElementById('status').textContent=d.message || JSON.stringify(d);}});
  globalThis.cityViewer=viewer;
  document.getElementById('style').addEventListener('change',event=>viewer.setStyle(event.target.value));
  document.getElementById('status').textContent='© OpenStreetMap contributors · ODbL';
  window.addEventListener('pagehide',()=>viewer.dispose(),{once:true});
}catch(error){document.getElementById('status').textContent=error.message;}
