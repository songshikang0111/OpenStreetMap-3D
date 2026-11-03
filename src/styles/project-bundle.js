import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {CityError,safePath,checkAbort,hash} from '../data/common.js';
import {OFFICIAL_STYLE_IDS,validateProjectStyleConfig} from './project-contract.js';
import {validateStyle,resolveStyleSelection} from './index.js';

const engineRoot=fileURLToPath(new URL('../../',import.meta.url));
const viewerEntry=fileURLToPath(new URL('./viewer-entry.js',import.meta.url));
const sourceLoaders={'.js':'js','.mjs':'js','.ts':'ts','.json':'json','.css':'css'};
const urlPath=value=>value.split('/').map(segment=>segment==='.'||segment==='..'?segment:encodeURIComponent(segment)).join('/');
/** Offline, explicit import graph. Returns assets; caller owns atomic publication. */
export async function bundleProjectStyle(root,selection,{signal}={}){
  let config;try{config=validateProjectStyleConfig(selection||{id:'comic'});}catch(error){throw new CityError('STYLE_CONFIG','style',error.message);}
  if(!config.entry&&!OFFICIAL_STYLE_IDS.includes(config.id))throw new CityError('STYLE_ENTRY_REQUIRED','style',`Unknown project style ${config.id}: declare style.entry.`, 'Add the local ESM entry to city.config.json before exporting.');
  let build;try{({build}=await import('esbuild'));}catch{throw new CityError('STYLE_BUNDLER_MISSING','style','The local esbuild dependency is missing.','Install the toolchain production dependencies; no CDN fallback is used.');}
  const assets=new Map(),declared=new Map(),inputs=new Map(),assetTokens=new Map();
  const inputPath=async file=>{try{return await safePath(root,file);}catch(error){if(error instanceof CityError)throw error;throw new CityError('STYLE_INPUT_MISSING','style',`Project style input is unavailable: ${file}`,'Check style.entry, dependencies and assets before exporting.');}};
  for(const file of config.assets||[])declared.set(await inputPath(file),file);
  const dependencies=new Map();for(const [name,file] of Object.entries(config.dependencies||{}))dependencies.set(name,await inputPath(file));
  const entry=config.entry?await inputPath(config.entry):null;
  const output=await safePath(root,`.city-cache/style-validate-${randomUUID()}`,{allowMissing:true});
  const outdir=path.join(output,'assets');
  try{
    checkAbort(signal);
    const result=await build({absWorkingDir:engineRoot,entryPoints:{'city-ink':viewerEntry,...(entry?{'project-style':'city-project-entry'}:{})},outdir,bundle:true,splitting:true,minify:true,format:'esm',platform:'browser',target:'es2022',write:false,metafile:true,logLevel:'silent',logOverride:{'unsupported-dynamic-import':'warning','unsupported-require-call':'warning'},chunkNames:'chunks/[name]-[hash]',assetNames:'resources/[hash]',plugins:[{
      name:'explicit-project-style',setup(builder){
        builder.onResolve({filter:/^city-project-entry$/},()=>({path:entry,namespace:'city-project'}));
        builder.onResolve({filter:/.*/,namespace:'city-project'},async args=>{
          checkAbort(signal);
          if(args.path==='three'||args.path.startsWith('three/')||args.path==='beijing-city-ink/styles')return builder.resolve(args.path==='beijing-city-ink/styles'?fileURLToPath(new URL('./index.js',import.meta.url)):args.path,{resolveDir:engineRoot,kind:args.kind});
          let resolved;
          if(args.path.startsWith('./')||args.path.startsWith('../'))resolved=await builder.resolve(args.path,{resolveDir:args.resolveDir,kind:args.kind});
          else if(dependencies.has(args.path))resolved=await builder.resolve(dependencies.get(args.path),{resolveDir:root,kind:args.kind});
          else throw new CityError('STYLE_DEPENDENCY','style',`Undeclared or nonlocal style import: ${args.path}`,'Declare bare imports in style.dependencies; remote and Node imports are not bundled.');
          if(resolved.errors.length)return {errors:resolved.errors};
          const relative=path.relative(root,resolved.path).replaceAll('\\','/');
          const checked=await safePath(root,relative);
          return {path:checked,namespace:args.kind==='url-token'?'city-css-asset':'city-project'};
        });
        builder.onLoad({filter:/.*/,namespace:'city-css-asset'},async args=>{
          if(!declared.has(args.path))throw new CityError('STYLE_ASSET','style',`Undeclared CSS asset: ${args.path}`);
          const contents=await readFile(args.path);inputs.set(declared.get(args.path),hash(contents));return {contents,loader:'file'};
        });
        builder.onLoad({filter:/.*/,namespace:'city-project'},async args=>{
          checkAbort(signal);const contents=await readFile(args.path),extension=path.extname(args.path),loader=sourceLoaders[extension]||'file';
          if(loader==='file'&&!declared.has(args.path))throw new CityError('STYLE_ASSET','style',`Undeclared style asset: ${path.relative(root,args.path)}`,'List imported binary/font/image files in style.assets.');
          if(['js','ts'].includes(loader)&&/new\s+URL\s*\(\s*['"]\.{1,2}\//.test(contents.toString()))throw new CityError('STYLE_ASSET_URL','style','Use a static asset import instead of a literal project-relative new URL.','Import the declared asset and use its bundled absolute URL inside factories.');
          inputs.set(path.relative(root,args.path).replaceAll('\\','/'),hash(contents));
          if(loader==='file'){
            const token=`__CITY_STYLE_ASSET_${hash(contents)}__`,target=`assets/resources/${hash(contents).slice(0,16)}-${path.basename(args.path)}`;
            assetTokens.set(token,target);assets.set(target,contents);
            return {contents:`export default ${JSON.stringify(token)};`,loader:'js',resolveDir:path.dirname(args.path)};
          }
          return {contents,loader,resolveDir:path.dirname(args.path)};
        });
      }
    }]});
    checkAbort(signal);
    // Esbuild cannot bundle variable dynamic imports/requires. Reject these
    // warnings instead of shipping unresolved project-relative code.
    const warnings=result.warnings.filter(w=>w.location?.namespace==='city-project'||w.location?.file?.startsWith('city-project:'));
    if(warnings.length)throw new CityError('STYLE_BUNDLE_WARNING','style',warnings.map(w=>w.text).join('; '));
    for(const file of result.outputFiles){
      const relative=`assets/${path.relative(outdir,file.path).replaceAll('\\','/')}`;
      let bytes=file.contents;
      if(relative.endsWith('.js')){
        let code=file.text;
        for(const [token,target] of assetTokens){let url=path.posix.relative(path.posix.dirname(relative),target);if(!url.startsWith('.'))url=`./${url}`;code=code.replaceAll(JSON.stringify(token),`new URL(${JSON.stringify(urlPath(url))},import.meta.url).href`);}
        bytes=new TextEncoder().encode(code);
      }
      assets.set(relative,bytes);
    }
    const declaredUrls={};
    for(const [file,relative] of declared){const contents=await readFile(file);inputs.set(relative,hash(contents));const target=`assets/style-files/${relative}`;assets.set(target,contents);declaredUrls[relative]=`./${urlPath(target)}`;}
    await mkdir(outdir,{recursive:true});await writeFile(path.join(output,'package.json'),' {"type":"module"}');
    for(const [relative,bytes] of assets){const destination=path.join(output,relative);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);}
    let pack,parameters;
    try{
      if(entry){pack=(await import(pathToFileURL(path.join(outdir,'project-style.js')).href)).default;validateStyle(pack);if(pack.id!==config.id)throw new Error(`Expected ${config.id}; module exports ${pack.id}.`);parameters=resolveStyleSelection({...pack,parameters:config.parameters}).parameters;}
      else parameters=resolveStyleSelection(config).parameters;
    }catch(error){throw new CityError('STYLE_MODULE_INVALID','style',error.message,'The entry must export a Node/browser-compatible StylePack with matching id and valid saved parameters; put DOM work inside factories.');}
    checkAbort(signal);
    const module=entry?{schemaVersion:1,id:pack.id,version:pack.version,entry:'./assets/project-style.js',stylesheets:result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>`./assets/${urlPath(path.relative(outdir,f.path).replaceAll('\\','/'))}`),assets:declaredUrls,hash:hash([...assets].map(([name,bytes])=>[name,hash(bytes)]))}:null;
    return {style:{id:config.id,parameters},module,assets,report:{schemaVersion:1,inputs:Object.fromEntries([...inputs].sort()),files:[...assets.keys()],hash:hash([...assets].map(([name,bytes])=>[name,hash(bytes)]))}};
  }catch(error){if(error instanceof CityError||signal?.aborted)throw error;throw new CityError('STYLE_BUNDLE_FAILED','style',error.message,'Check local entry/imports/assets and explicit dependency mappings.');}
  finally{await rm(output,{recursive:true,force:true});}
}
