import {mkdir} from 'node:fs/promises';
import {bundleProjectStyle} from '../styles/project-bundle.js';
import {atomicWrite,safePath,CityError} from '../data/common.js';

export function projectStyleCachePath(hash,relative='') {
  if(!/^[a-f0-9]{64}$/.test(hash))throw new CityError('STYLE_PREVIEW_PATH','style','Invalid compiled style hash.');
  return `.city-cache/studio-styles/${hash}${relative?`/${relative}`:''}`;
}
/** The caller holds the project lock; no user code or registry is duplicated here. */
export async function prepareProjectStyle(root,projectId,style,{signal}={}) {
  const bundled=await bundleProjectStyle(root,style,{signal});
  const hash=bundled.report.hash,directory=await safePath(root,projectStyleCachePath(hash),{allowMissing:true});
  await mkdir(directory,{recursive:true});
  for(const [relative,bytes] of bundled.assets)await atomicWrite(await safePath(root,projectStyleCachePath(hash,relative),{allowMissing:true}),bytes,{signal});
  const baseUrl=`/projects/${encodeURIComponent(projectId)}/style-preview/${hash}/`;
  const result={style:bundled.style,styleModule:bundled.module,baseUrl,sdkUrl:`${baseUrl}assets/city-ink.js`,report:bundled.report};
  await atomicWrite(await safePath(root,projectStyleCachePath(hash,'preview.json'),{allowMissing:true}),result,{signal});
  return result;
}
