import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import official from '../../packages/landmarks/index.js';
const directory=path.resolve(process.argv[2] || 'work/my-landmarks');
const recipe=structuredClone(official.recipes[0]);recipe.version='1.0.1';recipe.parameters.ribWidth=.7;
await mkdir(directory,{recursive:true});
await writeFile(path.join(directory,'recipes.json'),JSON.stringify({schemaVersion:1,id:'my-city/landmarks',version:'1.0.1',engineCompatibility:'>=1.0.0 <2.0.0',recipes:[recipe]},null,2),{flag:'wx'});
console.log(`Editable local recipe package: ${directory}`);
