/** Optional per-mesh costs must preserve the resource's complete cost. */
export function drawUnitsError(lod) {
  if (lod.drawUnits === undefined) return null;
  if (!Array.isArray(lod.drawUnits)) return 'drawUnits must be an array.';
  let triangles = 0, drawCalls = 0;
  for (const unit of lod.drawUnits) {
    const b = unit?.bounds;
    if (!Array.isArray(b) || b.length !== 6 || !b.every(Number.isFinite) || [0,1,2].some(i => b[i] > b[i+3]) || !Number.isSafeInteger(unit.triangles) || unit.triangles < 0 || !Number.isSafeInteger(unit.drawCalls) || unit.drawCalls < 0) return 'drawUnits require ordered finite bounds and non-negative safe integer costs.';
    if (Array.isArray(lod.bounds) && lod.bounds.length === 6 && [0,1,2].some(i => b[i] < lod.bounds[i] - 1e-6 || b[i+3] > lod.bounds[i+3] + 1e-6)) return 'drawUnits bounds must remain inside LOD bounds.';
    triangles += unit.triangles; drawCalls += unit.drawCalls;
  }
  if (!Number.isSafeInteger(triangles) || !Number.isSafeInteger(drawCalls) || triangles !== lod.triangles || drawCalls !== lod.drawCalls) return 'drawUnits costs must sum to the complete LOD triangles and drawCalls.';
  for(const name of ['shadowTriangles','shadowDrawCalls'])if(lod[name]!==undefined){let sum=0;for(const unit of lod.drawUnits){if(!Number.isSafeInteger(unit[name])||unit[name]<0||unit[name]>unit[name==='shadowTriangles'?'triangles':'drawCalls'])return 'Invalid drawUnits caster cost.';sum+=unit[name];}if(sum!==lod[name])return 'drawUnits caster costs must sum to the complete caster cost.';}
  return null;
}

export function validateSceneManifest(manifest) {
  const diagnostics=[],error=(path,message)=>diagnostics.push({code:'INVALID_SCENE_MANIFEST',stage:'manifest',path,message});
  if(!manifest||typeof manifest!=='object')return {valid:false,diagnostics:[{code:'INVALID_SCENE_MANIFEST',stage:'manifest',message:'Manifest must be an object.'}]};
  if(manifest.schemaVersion!==1)error('schemaVersion','Only scene schemaVersion 1 is supported.');
  if(typeof manifest.generator?.id!=='string'||!manifest.generator.id||typeof manifest.generator?.version!=='string'||!manifest.generator.version)error('generator','Generator id/version required.');
  if(!Number.isFinite(manifest.origin?.lat)||!Number.isFinite(manifest.origin?.lon))error('origin','Finite origin required.');
  const box=b=>Array.isArray(b)&&b.length===6&&b.every(Number.isFinite)&&[0,1,2].every(i=>b[i]<=b[i+3]);
  if(!box(manifest.bounds))error('bounds','Expected ordered 3D bounds.');
  if(manifest.coordinateSystem?.units!=='meters'||manifest.coordinateSystem?.axes?.x!=='east'||manifest.coordinateSystem?.axes?.y!=='up'||manifest.coordinateSystem?.axes?.z!=='south'||!Number.isFinite(manifest.coordinateSystem?.projection?.eastMetersPerDegree)||!Number.isFinite(manifest.coordinateSystem?.projection?.northMetersPerDegree))error('coordinateSystem','Expected local x-east/y-up/z-south meters.');
  if(!Array.isArray(manifest.sources)||typeof manifest.attribution?.text!=='string'||!manifest.attribution.text||typeof manifest.attribution?.license!=='string')error('sources','Sources and attribution required.');
  if(manifest.styleContractVersion!==1)error('styleContractVersion','Unsupported style contract.');
  if(!manifest.featureIndex||typeof manifest.featureIndex!=='object'||Array.isArray(manifest.featureIndex))error('featureIndex','Feature table required.');
  const seen=new Set(),uris=new Set();
  if(!Array.isArray(manifest.chunks)||!manifest.chunks.length)error('chunks','Non-empty chunks required.');
  else for(const [i,c]of manifest.chunks.entries()){
    const path=`chunks.${i}`;if(!c||typeof c!=='object'){error(path,'Chunk must be an object.');continue;}if(typeof c.id!=='string'||seen.has(c.id))error(`${path}.id`,'Unique chunk id required.');seen.add(c.id);
    if(!box(c.contentBounds))error(`${path}.contentBounds`,'Ordered content bounds required.');
    if(!Array.isArray(c.transform)||c.transform.length!==16||!c.transform.every(Number.isFinite))error(`${path}.transform`,'Finite matrix4 required.');
    if(!Array.isArray(c.lods)||c.lods.length<2)error(`${path}.lods`,'At least two real resource levels required.');
    else {const levels=new Set();for(const [j,l]of c.lods.entries()){
      const lp=`${path}.lods.${j}`;
      if(!l||typeof l!=='object'){error(lp,'LOD must be an object.');continue;}
      if(![0,1,2].includes(l.level)||!['low','medium','high'].includes(l.id)||levels.has(l.level)||['low','medium','high'][l.level]!==l.id)error(lp,'Unique matching LOD level/id required.');levels.add(l.level);
      if(typeof l.uri!=='string'||!/^chunks\/[a-zA-Z0-9_.-]+\.cink$/.test(l.uri)||uris.has(l.uri))error(`${lp}.uri`,'Unique relative chunk resource path required.');uris.add(l.uri);
      if(!/^[0-9a-f]{64}$/.test(l.hash)||!Number.isSafeInteger(l.bytes)||l.bytes<=0||!Number.isSafeInteger(l.triangles)||l.triangles<0||!Number.isSafeInteger(l.residentBytes)||l.residentBytes<0)error(lp,'Valid hash, bytes, triangles and residentBytes required.');
      if(!box(l.bounds)||!Number.isFinite(l.geometricError)||l.geometricError<0||l.selection?.metric!=='screen-space-error'||!Number.isFinite(l.selection?.geometricErrorMeters)||l.selection.geometricErrorMeters<0||!Number.isFinite(l.selection?.maxScreenSpaceError)||l.selection.maxScreenSpaceError<0)error(lp,'LOD bounds and selection error required.');
      if(!Number.isSafeInteger(l.drawCalls)||l.drawCalls<0)error(lp,'Non-negative integer drawCalls required.');
      for(const [name,total]of [['shadowTriangles',l.triangles],['shadowDrawCalls',l.drawCalls]])if(l[name]!==undefined&&(!Number.isSafeInteger(l[name])||l[name]<0||l[name]>total))error(`${lp}.${name}`,'Caster cost must be a non-negative integer within the complete resource cost.');
      const unitsError=drawUnitsError(l);if(unitsError)error(`${lp}.drawUnits`,unitsError);
    }}
  }
  const renderIds=new Set();for(const [id,f]of Object.entries(manifest.featureIndex||{})){
    if(!f||typeof f!=='object'){error(`featureIndex.${id}`,'Feature record must be an object.');continue;}
    if(f.featureId!==id||typeof f.kind!=='string'||!f.kind||!f.provenance||typeof f.provenance!=='object'||Array.isArray(f.provenance)||!Array.isArray(f.sourceIds)||f.sourceIds.some(id=>typeof id!=='string')||f.bounds!==undefined&&!box(f.bounds)||f.ownerChunk!==undefined&&!seen.has(f.ownerChunk)||!Array.isArray(f.chunkIds)||f.chunkIds.some(id=>!seen.has(id))||!Number.isSafeInteger(f.renderId)||f.renderId<1||renderIds.has(f.renderId))error(`featureIndex.${id}`,'Invalid feature identity, sources, renderId or chunk references.');renderIds.add(f.renderId);
  }
  return {valid:diagnostics.length===0,diagnostics};
}
