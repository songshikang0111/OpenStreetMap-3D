import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import path from 'node:path';
import {createProject,patchProject} from '../../src/cli/project.js';
export async function projectFixture(root){
  await createProject(root,{sample:true});await mkdir(path.join(root,'styles'),{recursive:true});
  await cp(new URL('../../examples/quickstart/sepia-style.js',import.meta.url),path.join(root,'styles/sepia.js'));
  const source=await readFile(path.join(root,'styles/sepia.js'),'utf8');
  await writeFile(path.join(root,'styles/sepia.js'),"import {tint} from './palette.js';\nimport paperUrl from './paper.svg';\nimport {accent} from 'local-palette';\nimport './theme.css';\n"+source.replace("properties:{}","properties:{warmth:{type:'number',minimum:0,maximum:1,default:.4}}")
    .replace("createMaterial({role,sourceMaterial}) {return", "createMaterial({role,sourceMaterial,parameters}) {globalThis.styleAssetPromise ||= fetch(paperUrl).then(r=>{if(!r.ok)throw new Error('paper asset unavailable');return r.text();}).then(text=>globalThis.styleAssetOK=text.includes('svg'));globalThis.savedStyleParameters=parameters;return")
    .replace("color:colors[role] || colors.facility","color:role==='road'?accent:tint(colors[role] || colors.facility)"));
  await writeFile(path.join(root,'styles/palette.js'),'export const tint=value=>value;');
  await writeFile(path.join(root,'styles/vendor.js'),"export const accent='#897762';");
  await writeFile(path.join(root,'styles/paper.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#d7cfb5" d="M0 0h8v8H0z"/></svg>');
  await writeFile(path.join(root,'styles/theme.css'),':root{--project-style-loaded:yes;}');
  const style={id:'project-sepia',entry:'styles/sepia.js',dependencies:{'local-palette':'styles/vendor.js'},assets:['styles/paper.svg'],parameters:{warmth:.23}};
  await patchProject(root,{style});return style;
}
