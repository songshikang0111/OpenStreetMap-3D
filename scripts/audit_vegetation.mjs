import fs from 'node:fs';
import { parseOSM, mergeOSMOverlay } from '../src/osm.js';
import { planRoadSurface } from '../src/road-surface.js';
import { planLandscape } from '../src/landscape-plan.js';
import { planStreetLife } from '../src/streetlife.js';
import { isNeedleCrown, crownGeometry } from '../src/foliage.js';
import { VEGETATION_MIX } from '../src/vegetation-rules.js';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/data/${name}.json`,import.meta.url)));
const raw=read('beijing-cbd');for(const name of ['street-details','landscape-details'])mergeOSMOverlay(raw,read(name),name);
const data=parseOSM(raw),roadPlan=planRoadSurface(data),landscape=planLandscape(data,{roadPlan,profile:read('landscape-profile')});
const plan=planStreetLife(data,{roadPlan,landscapeTrees:landscape.trees}),byContext={},byEvidence={},taggedAreas=[];
for(const green of data.greens)if(green.tags.leaf_type||green.tags.genus||green.tags.species)taggedAreas.push({id:green.id,tags:green.tags});
for(const tree of plan.trees){
  const context=tree.plantingContext||tree.source;
  byContext[context]??={trees:0,cypress:0,conifer:0};byContext[context].trees++;
  if(isNeedleCrown(tree.shape))byContext[context][tree.shape]++;
  byEvidence[tree.habitSource]=(byEvidence[tree.habitSource]||0)+1;
}
let farCrownTriangles=0;const geometryTriangles={};
for(const shape of ['spreading','cypress','conifer']){const g=crownGeometry(false,shape);geometryTriangles[shape]=g.attributes.position.count/3;g.dispose();}
for(const tree of plan.trees)farCrownTriangles+=geometryTriangles[isNeedleCrown(tree.shape)?tree.shape:'spreading'];
const examples={};for(const shape of ['cypress','conifer'])examples[shape]=plan.trees.filter(t=>t.shape===shape).sort((a,b)=>Math.hypot(a.x+20,a.z-35)-Math.hypot(b.x+20,b.z-35)).slice(0,4).map(({key,x,z,h,plantingContext,habitSource})=>({key,x,z,h,plantingContext,habitSource}));
console.log(JSON.stringify({trees:plan.trees.length,needleTrees:plan.trees.filter(t=>isNeedleCrown(t.shape)).length,byContext,byEvidence,taggedAreas,defaultMix:VEGETATION_MIX,geometryTriangles,farCrownTriangles,nearTreeBudget:96,examples},null,2));
