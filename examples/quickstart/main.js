import {createCityViewer} from '../../src/sdk/index.js';
// A normal static manifest URL; this app never calls the studio API or old demo entry.
const manifestUrl=new URLSearchParams(location.search).get('manifest') || './scene/manifest.json';
try {
  const viewer=await createCityViewer({container:document.getElementById('city'),manifestUrl,onDiagnostic:d=>{document.getElementById('status').textContent=d.message || JSON.stringify(d);}});
  globalThis.cityViewer=viewer;
  document.getElementById('style').addEventListener('change',event=>viewer.setStyle(event.target.value));
  const credit=document.createElement('a');credit.href='https://www.openstreetmap.org/copyright';credit.textContent='© OpenStreetMap contributors';credit.target='_blank';credit.rel='noopener';document.getElementById('status').replaceChildren(credit,document.createTextNode(' · ODbL'));
  window.addEventListener('pagehide',()=>viewer.dispose(),{once:true});
}catch(error){document.getElementById('status').textContent=error.message;}
