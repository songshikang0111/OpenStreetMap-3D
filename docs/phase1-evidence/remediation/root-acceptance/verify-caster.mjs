import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {validateSceneManifest} from '../../../../src/core/scene-manifest.js';
const file=process.argv[2]||'work/integration-scenes/beijing-cbd-fixed-1/manifest.json';
const original=JSON.parse(await fs.readFile(file,'utf8'));
assert.equal(validateSceneManifest(original).valid,true);
const results=[];
for(const [label,field,value] of [['negative','shadowTriangles',-1],['nonfinite','shadowTriangles',Infinity],['unsafe','shadowTriangles',Number.MAX_SAFE_INTEGER+1],['calls-negative','shadowDrawCalls',-1]]){
  const manifest=structuredClone(original),lod=manifest.chunks[0].lods[0];delete lod.shadowTriangles;delete lod.shadowDrawCalls;lod.drawUnits[0][field]=value;
  const result=validateSceneManifest(manifest);assert.equal(result.valid,false,`${label} optional caster accepted without aggregate`);results.push({label,rejected:true,diagnostics:result.diagnostics});
}
const legacy=structuredClone(original);for(const chunk of legacy.chunks)for(const lod of chunk.lods){delete lod.shadowTriangles;delete lod.shadowDrawCalls;for(const unit of lod.drawUnits||[]){delete unit.shadowTriangles;delete unit.shadowDrawCalls;}}
assert.equal(validateSceneManifest(legacy).valid,true);
await fs.writeFile('work/root-remediation-acceptance/caster-results.json',JSON.stringify({date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),file,status:'pass',results,legacyWithoutCasterFieldsValid:true},null,2));
console.log(JSON.stringify({status:'pass',rejected:results.length,legacyWithoutCasterFieldsValid:true}));
