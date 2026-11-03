import path from 'node:path';
import {exportWeb} from './export.js';
import {openLocalBrowser} from './browser-session.js';
import {CityError,atomicWrite,safePath,checkAbort} from '../data/common.js';

export async function exportInBrowser(root,{format,output,signal,onProgress=()=>{},width=1280,height=720}={}) {
  if(!['png','glb'].includes(format))throw new CityError('EXPORT_FORMAT','export','Expected png, glb, or web.');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096)throw new CityError('EXPORT_SIZE','export','Export dimensions must be positive integers, at most 16 megapixels.');
  const relative=output || `exports/city.${format}`;
  if(!relative.startsWith('exports/')||!relative.endsWith(`.${format}`))throw new CityError('EXPORT_PATH','export',`Output must be exports/*.${format}.`);
  const destination=await safePath(root,relative,{allowMissing:true});
  await exportWeb(root,{signal,onProgress});checkAbort(signal);
  const browser=await openLocalBrowser({root:await safePath(root,'site'),signal,width,height});
  try {
    onProgress({stage:'browser-load',progress:.3});
    const result=await browser.evaluate(`(async()=>{
      const deadline=performance.now()+60000;
      while(!globalThis.cityViewer && performance.now()<deadline){if(globalThis.cityViewerError)throw new Error(globalThis.cityViewerError);await new Promise(r=>setTimeout(r,50));}
      if(!globalThis.cityViewer)throw new Error('Viewer initialization timed out');
      await cityViewer.whenIdle({timeoutMs:60000});
      const result=await cityViewer.${format==='png'?'exportPNG':'exportGLB'}(${format==='png' ? "{width:"+width+",height:"+height+"}" : "{scope:'complete'}"});
      const value=result?.blob || result?.data || result?.buffer || result;
      const blob=value instanceof Blob?value:new Blob([value]);
      return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
    })()`);
    checkAbort(signal);onProgress({stage:'save-export',progress:.95});
    const bytes=Buffer.from(result,'base64');
    if(format==='png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new CityError('EXPORT_INVALID','export','Browser did not return a PNG.');
    if(format==='glb'&&bytes.subarray(0,4).toString()!=='glTF')throw new CityError('EXPORT_INVALID','export','Browser did not return a GLB.');
    await atomicWrite(destination,bytes,{signal});
    return {schemaVersion:1,status:'succeeded',artifacts:[path.relative(root,destination).replaceAll('\\','/')],diagnostics:[],scope:format==='png'?'current-view':'complete-area',browser:browser.browser,limitations:format==='glb'?'Basic materials and geometry; procedural facade shaders and comic postprocessing are not portable.':undefined};
  }finally{await browser.close();}
}
