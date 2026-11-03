import {validateProjectStyleConfig} from './project-contract.js';
import * as defaultStyleApi from './index.js';
const loaded=(id,parameters,links=[])=>Object.defineProperty({id,parameters},'dispose',{value(){links.forEach(link=>link.remove());},enumerable:false});

/** Register into the same style API used by the SDK before viewer creation/export. */
export async function loadProjectStyle(selection,{module:descriptor,baseUrl,importModule=url=>import(/* @vite-ignore */ url),styleApi}={}){
  const config=validateProjectStyleConfig(typeof selection==='string'?{id:selection}:selection);
  const api=styleApi||defaultStyleApi;
  if(descriptor){
    if(descriptor.schemaVersion!==1||descriptor.id!==config.id||typeof descriptor.entry!=='string')throw new TypeError('Invalid published project style module descriptor.');
    const base=new URL(baseUrl||globalThis.document?.baseURI||globalThis.location?.href);
    const localUrl=value=>{const url=new URL(value,base);if(!['http:','https:','file:'].includes(url.protocol)||url.origin!==base.origin)throw new TypeError('Published style modules/assets must share the site origin.');return url.href;};
    const urls=(descriptor.stylesheets||[]).map(localUrl);
    if(urls.length&&!globalThis.document)throw new TypeError('Style CSS loading requires a document.');
    const links=[];
    try{
      await Promise.all(urls.map(url=>new Promise((resolve,reject)=>{const link=document.createElement('link');links.push(link);link.rel='stylesheet';link.href=url;link.onload=resolve;link.onerror=()=>reject(new Error(`Style stylesheet failed: ${url}`));document.head.append(link);})));
      const exported=await importModule(localUrl(descriptor.entry)),pack=exported.default;
      api.validateStyle(pack);
      if(pack.id!==config.id||pack.version!==descriptor.version)throw new TypeError(`Project style module id/version mismatch: expected ${config.id}@${descriptor.version}.`);
      const resolved=api.resolveStyleSelection({...pack,parameters:config.parameters});
      api.registerStyle(pack);
      return loaded(config.id,resolved.parameters,links);
    }catch(error){links.forEach(link=>link.remove());throw error;}
  }
  if(config.entry)throw new TypeError('Project style entry requires a bundled module descriptor; run bundleProjectStyle before browser loading.');
  const resolved=api.resolveStyleSelection(config);
  return loaded(config.id,resolved.parameters);
}
