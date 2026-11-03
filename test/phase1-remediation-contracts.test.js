import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

test('published JSON schemas parse and project source/style declarations retain their own constraints',async()=>{
  const folder=new URL('../schemas/',import.meta.url);
  for(const name of await readdir(folder))if(name.endsWith('.json'))JSON.parse(await readFile(new URL(name,folder),'utf8'));
  const schema=JSON.parse(await readFile(new URL('project.schema.json',folder),'utf8'));
  assert.equal(schema.properties.source.properties.provider.enum.includes('custom'),true);
  assert.deepEqual(schema.properties.source.allOf[0].then.required,['endpoint']);
  assert.equal(schema.properties.source.allOf[0].if.properties.provider.const,'custom');
  assert.equal(schema.properties.allOf,undefined);
  assert.ok(schema.$defs.overpassEndpoint);
  assert.deepEqual(schema.properties.style.dependentRequired,{dependencies:['entry'],assets:['entry']});
});
