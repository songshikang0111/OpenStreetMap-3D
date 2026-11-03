import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,cp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {continuityFixture} from './phase1-core-fixture.js';

test('official recipe package content and version invalidate an existing lock across processes',async()=>{
  const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(path.join(os.tmpdir(),'city-engine-lock-'));
  try{
    for(const name of ['src','packages','package.json'])await cp(path.join(repository,name),path.join(temporary,name),{recursive:true});
    await symlink(path.join(repository,'node_modules'),path.join(temporary,'node_modules'),process.platform==='win32'?'junction':'dir');
    await writeFile(path.join(temporary,'fixture.json'),JSON.stringify(continuityFixture()));
    const run=code=>{const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:temporary,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
    const before=run(`import fs from 'node:fs/promises';import {createProject} from './src/cli/project.js';import {buildProject} from './src/cli/tasks.js';const {raw,config}=JSON.parse(await fs.readFile('fixture.json'));await createProject('city',{...config,tiling:{sizeMeters:500,...config.tiling},source:{kind:'local',file:'data/source.json'}});await fs.writeFile('city/data/source.json',JSON.stringify(raw));await buildProject('city');console.log(await fs.readFile('city/city.lock.json','utf8'));`);
    const file=path.join(temporary,'packages/landmarks/index.js'),source=await readFile(file,'utf8');
    await writeFile(file,source.replace("version = '1.0.0'","version = '1.0.1'").replace('ribWidth: 0.48','ribWidth: 1.1'));
    const after=run(`import fs from 'node:fs/promises';import {validateProject,buildProject} from './src/cli/tasks.js';let code;try{await validateProject('city');}catch(error){code=error.code;}if(code!=='STALE_ENGINE')throw new Error('Expected STALE_ENGINE, got '+code);await buildProject('city');console.log(await fs.readFile('city/city.lock.json','utf8'));`);
    assert.notEqual(before.inputs.engineHash,after.inputs.engineHash);assert.notEqual(before.contentHash,after.contentHash);assert.equal(before.inputs.sourceFileHash,after.inputs.sourceFileHash);
  }finally{await rm(temporary,{recursive:true,force:true});}
});
