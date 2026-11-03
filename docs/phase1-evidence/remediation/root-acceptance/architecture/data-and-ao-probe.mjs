import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {hash,readJSON} from '../../../../../src/data/common.js';
import {resolveDataSource} from '../../../../../src/data/source.js';
import {applyPipelineQuality} from '../../../../../src/runtime/style-quality.js';
import {createStylePipeline} from '../../../../../src/styles/index.js';
import {Scene,PerspectiveCamera} from 'three';
const component='C:/Users/宋世康/.codex/worktrees/phase1-data-cli/beijing-city-ink';
const report=await readJSON(path.join(component,'docs/phase1-evidence/remediation/data/formal-provider-results.json'));
const sourceFile=await readFile(path.join(report.project,'data/source.json')),raw=JSON.parse(sourceFile);
const config=await readJSON(path.join(report.project,'city.config.json'));
const lock=await readJSON(path.join(report.project,'city.lock.json'));
const result={recordedComponentCommit:report.commit,formalLiveRecords:report.records.map(r=>({command:r.args[0],action:r.args[1],status:r.status,cacheHit:r.result.job?.result?.cacheHit})),source:{elements:raw.elements.length,buildings:raw.elements.filter(e=>e.tags?.building).length,parts:raw.elements.filter(e=>e.tags?.['building:part']).length,sourceFileHash:hash(sourceFile),sourceFileMatches:hash(sourceFile)===report.source.sourceFileHash,elementHash:hash(raw.elements),elementHashMatches:hash(raw.elements)===report.source.contentHash,lockMatches:lock.inputs.sourceFileHash===hash(sourceFile),provider:resolveDataSource(config.source),metadataEndpoint:raw.metadata.endpoint,metadataRetrievedAt:raw.metadata.retrievedAt,upstreamSourceHash:raw.metadata.sourceHash},ao:[]};
for(const strength of [0,.12,1]){const pipeline=createStylePipeline({renderer:{},scene:new Scene(),camera:new PerspectiveCamera(),style:{id:'comic',parameters:{aoStrength:strength}}});for(const aoQuality of [0,1,2]){applyPipelineQuality(pipeline,{aoQuality});result.ao.push({strength,aoQuality,actual:pipeline.ink.material.uniforms.aoStrength.value,enabled:pipeline.ink.aoEnabled});}pipeline.dispose();}
await mkdir(path.resolve('work/root-remediation-architecture/replay'),{recursive:true});await writeFile('work/root-remediation-architecture/replay/data-and-ao-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
