import * as THREE from 'three';
import {buildChinaZun, buildCctv} from '../landmarks.js';
import {MeshWriter, polygon, addBeam} from './mesh-tools.js';

function generate(kind, match, context) {
  const group = new THREE.Group(); group.name = `Landmark: ${match.recipeId}`;
  const provenance = {...match.provenance, recipeId: match.recipeId, recipeVersion: match.recipeVersion, generatorId: match.generatorId, sources: []};
  for (const feature of context.features) {
    const writer = new MeshWriter(), objectId = context.objectIds?.get(feature.id) || 1;
    const profile = kind==='china-zun'
      ? buildChinaZun(writer, feature, objectId, addBeam, match.parameters)
      : buildCctv(writer, feature, objectId, polygon, addBeam, match.parameters);
    const mesh=writer.mesh(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.76,metalness:.04}), feature.tags?.name||feature.id,{groupRoles:true});
    mesh.userData = {feature: JSON.parse(JSON.stringify(feature)), landmark: profile, generatedFacade: true, inkClass: 1,
      city: {schemaVersion:1,featureId:String(feature.id),sourceIds:[`${feature.osmType}/${feature.osmId}`],kind:'landmark',materialRole:'glass',lodRole:'body',shader:'facade-v6',inkClass:1,
        materialRoles: ['glass','roof','structure'], objectId, recipeId: match.recipeId, recipeVersion: match.recipeVersion, height:feature.height,minHeight:feature.minHeight,heightSource:feature.source}};
    group.add(mesh);
    provenance.sources.push({featureId:feature.id,osmType:feature.osmType,osmId:feature.osmId,height:feature.height,minHeight:feature.minHeight,heightSource:feature.source});
  }
  group.userData.city={schemaVersion:1,featureId:`landmark:${match.recipeId}`,sourceIds:provenance.sources.map(s=>`${s.osmType}/${s.osmId}`),kind:'landmark-group',materialRole:'structure',lodRole:'body',claimedFeatureIds:[...match.claimedFeatureIds],provenance};
  return {group, claimedFeatureIds:[...match.claimedFeatureIds], provenance, diagnostics:[]};
}
export const officialGenerators = {
  'city-ink/china-zun': (match,context)=>generate('china-zun',match,context),
  'city-ink/cctv': (match,context)=>generate('cctv',match,context),
};
