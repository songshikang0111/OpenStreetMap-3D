export const OFFICIAL_STYLE_IDS=Object.freeze(['comic','line','color','white']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function projectStylePath(value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.includes('\0')||value.startsWith('/')||value.split('/').some(s=>!s||s==='.'||s==='..'))throw new TypeError('Style paths must be slash-separated project-relative paths without traversal.');
  return value;
}
/** Declarative project configuration; module code remains trusted local JavaScript. */
export function validateProjectStyleConfig(style){
  if(!object(style)||typeof style.id!=='string'||!style.id.trim())throw new TypeError('Style requires a nonempty id.');
  for(const key of Object.keys(style))if(!['id','parameters','entry','dependencies','assets'].includes(key))throw new TypeError(`Unknown project style field: ${key}`);
  if(style.parameters!==undefined&&!object(style.parameters))throw new TypeError('Style parameters must be an object.');
  if(style.entry!==undefined){projectStylePath(style.entry);if(!/\.(m?js|ts)$/.test(style.entry))throw new TypeError('Style entry must be an ESM .js, .mjs or .ts module.');}
  if(style.dependencies!==undefined){
    if(!object(style.dependencies))throw new TypeError('Style dependencies must map import specifiers to project-relative module files.');
    for(const [name,file] of Object.entries(style.dependencies)){
      if(!/^(?:@[\w-]+\/)?[\w-]+(?:\/[\w.-]+)*$/.test(name)||name.split('/').some(s=>s==='.'||s==='..')||name==='three'||name.startsWith('three/')||name==='beijing-city-ink'||name.startsWith('beijing-city-ink/'))throw new TypeError(`Invalid or engine-owned style dependency: ${name}`);
      projectStylePath(file);
    }
  }
  if(style.assets!==undefined&&(!Array.isArray(style.assets)||new Set(style.assets).size!==style.assets.length))throw new TypeError('Style assets must be a unique array of project-relative files.');
  for(const file of style.assets||[])projectStylePath(file);
  if(!style.entry&&(style.dependencies!==undefined||style.assets!==undefined))throw new TypeError('Style dependencies/assets require entry.');
  return {...style,parameters:style.parameters||{}};
}
