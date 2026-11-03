import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStaticServer} from '../scripts/serve-static.mjs';

test('static helper serves non-root deployment with correct module MIME and bounds',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'city-static-'));
  await mkdir(path.join(root,'nested'));await writeFile(path.join(root,'nested/index.html'),'<script type="module" src="./main.js"></script>');await writeFile(path.join(root,'nested/main.js'),'export const local=true;');
  const service=await createStaticServer(root);
  try {
    assert.equal((await fetch(`${service.url}/nested/`)).status,200);
    const js=await fetch(`${service.url}/nested/main.js`);assert.match(js.headers.get('content-type'),/javascript/);
    assert.equal((await fetch(`${service.url}/%2e%2e%2fsecret`)).status,404);
    assert.equal((await fetch(`${service.url}/nested/`,{method:'POST'})).status,405);
  }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
