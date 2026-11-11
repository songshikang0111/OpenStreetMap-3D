import * as THREE from 'three';
import clipping from 'polygon-clipping';
import { area, inside, stableRandom } from './osm.js';
import { buildingStyle, roofEquipment } from './building-rules.js';
import { createLandmarkRegistry } from './landmark-registry.js';
import { MeshWriter, normalizedRing, polygon, addBox } from './generators/mesh-tools.js';
import { bindSceneStyle, createStyleShared, annotateSceneSemantics } from './styles/index.js';
import { buildStreetLife } from './streetlife.js';
import { buildRoadSurface } from './road-surface.js';
import { facadeLayout, nearbyFacadeFrames } from './facade-layout.js';
import { installFacadeShader } from './facade-shader.js';
import { buildLandscape } from './landscape.js';
import { updateRoofDetails } from './distance-style.js';
import { planBuildingEnvelopes } from './building-envelope.js';
import { planRoof } from './roofs.js';
import { writeBuildingBody } from './building-mesh.js';

function facadeMaterial(shared) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.76, metalness: 0.04 });
  material.onBeforeCompile = (shader) => installFacadeShader(shader, shared);
  material.customProgramCacheKey = () => 'city-ink-facade-v6-materials';
  return material;
}

export function buildCity(
  data,
  {
    landscapeEnabled = false,
    inferRoofs = false,
    landmarksEnabled = true,
    registry,
    landmarkRegistry,
    landmarks: landmarkOptions = { enabled: landmarksEnabled },
    style: styleSelection,
    quality,
  } = {},
) {
  const group = new THREE.Group();
  group.name = 'Beijing CBD — OpenStreetMap';
  const shared = createStyleShared();
  const material = facadeMaterial(shared);
  const baseMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98 });
  const [x0, z0, x1, z1] = data.bounds;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(x1 - x0 + 34, 14, z1 - z0 + 34),
    new THREE.MeshStandardMaterial({ color: '#d8d4c7', roughness: 1 }),
  );
  base.position.set((x0 + x1) / 2, -7, (z0 + z1) / 2);
  base.receiveShadow = true;
  base.name = 'Flat ground / no DEM';
  base.userData.inkClass = 5;
  group.add(base);
  const groundWriter = new MeshWriter();
  const groundFrame = [
    [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
  ];
  for (const feature of data.water)
    for (const [outer, ...holes] of clipping.intersection([feature.outer, ...(feature.holes || [])], groundFrame))
      polygon(groundWriter, { outer, holes }, 0.22, '#82aac4', 60001);
  const landCover = groundWriter.mesh(baseMaterial, 'Land cover');
  landCover.userData.inkClass = 6;
  group.add(landCover);
  const roadSurface = buildRoadSurface(data);
  group.add(roadSurface.group);
  const landscape = buildLandscape(data, {
    roadPlan: roadSurface.plan,
    seed: data.seed || 1,
    profile: { ...data.metadata?.landscapeProfile, enabled: landscapeEnabled },
  });
  group.add(landscape.group);

  const activeRegistry = landmarkRegistry || registry || createLandmarkRegistry();
  const landmarkContext = {
    origin: data.origin || data.metadata?.center,
    bounds: data.bounds,
    seed: data.seed || 1,
    project: data.project,
    features: data.buildings,
    policy: landmarkOptions.policy || 'degraded',
    objectIds: new Map(data.buildings.map((b, i) => [b.id, i + 1])),
  };
  const landmarkResults =
    landmarkOptions.enabled === false
      ? []
      : activeRegistry
          .match(data.buildings, landmarkContext)
          .map((match) => activeRegistry.generate(match, landmarkContext));
  const claimed = new Map(),
    claimedIds = new Set(),
    generatedMeshes = [];
  for (const result of landmarkResults)
    if (result.claimedFeatureIds.length) {
      // Only successful generation takes ownership; failures retain the original source building.
      group.add(result.group);
      result.claimedFeatureIds.forEach((id) => claimedIds.add(String(id)));
      result.group.traverse((mesh) => {
        if (mesh.isMesh) {
          generatedMeshes.push(mesh);
          if (mesh.userData.city?.shader === 'facade-v6') {
            for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) old.dispose();
            mesh.material = material;
          }
          if (mesh.userData.city?.featureId) claimed.set(mesh.userData.city.featureId, mesh);
        }
      });
    }
  const buildings = [],
    nearWalls = [],
    landmarks = [],
    familyCounts = {},
    grammarCounts = {},
    surfaceCounts = {};
  const sourceColors = { height: '#60988e', levels: '#86a8c3', estimated: '#daab73' };
  const roofWriter = new MeshWriter(),
    roofDetails = [];
  const roofPlans = new Map(data.buildings.map((b) => [b.id, planRoof(b, { inferRoofs })]));
  const roofStats = { tagged: 0, inferred: 0, unsupported: 0 };
  const envelopes = planBuildingEnvelopes(
    data.buildings.map((b) => (roofPlans.get(b.id).supported ? { ...b, height: roofPlans.get(b.id).eave - 0.45 } : b)),
    { exclude: (b) => claimedIds.has(String(b.id)) },
  );
  data.buildings.forEach((building, index) => {
    const claimedMesh = claimed.get(String(building.id));
    if (claimedIds.has(String(building.id))) {
      if (!claimedMesh) return;
      const profile = claimedMesh.userData.landmark || { kind: 'external', name: claimedMesh.name };
      if (claimedMesh.userData.facadeFamily)
        familyCounts[claimedMesh.userData.facadeFamily] = (familyCounts[claimedMesh.userData.facadeFamily] || 0) + 1;
      if (claimedMesh.userData.facadeSurface)
        surfaceCounts[claimedMesh.userData.facadeSurface] =
          (surfaceCounts[claimedMesh.userData.facadeSurface] || 0) + 1;
      claimedMesh.userData.originalColors = claimedMesh.geometry.attributes.color?.array.slice();
      claimedMesh.userData.sourceColor = new THREE.Color(sourceColors[building.source] || sourceColors.estimated);
      buildings.push(claimedMesh);
      landmarks.push({ ...profile, osmId: building.osmId });
      return;
    }
    const { writer, style, profile } = writeBuildingBody(building, {
      renderId: index + 1,
      seed: data.seed || 1,
      roofPlan: roofPlans.get(building.id),
      envelopePlan: envelopes.get(building.id),
      roofWriter,
      counts: { familyCounts, surfaceCounts, grammarCounts, roofStats, nearWalls, roofDetails },
    });
    const mesh = writer.mesh(material, building.tags.name || building.id, { groupRoles: true });
    mesh.userData.feature = building;
    mesh.userData.generatedFacade = true;
    mesh.userData.inkClass = 1;
    mesh.userData.facadeFamily = style.family;
    mesh.userData.landmark = profile;
    mesh.userData.facadeSurface = style.surfaceName;
    mesh.userData.facadeGrammar = style.grammar;
    if (profile) {
      landmarks.push({ ...profile, osmId: building.osmId });
      building.generatedShape = profile.name;
      building.generatedShapeNote = profile.note;
    }
    mesh.userData.originalColors = mesh.geometry.attributes.color.array.slice();
    mesh.userData.sourceColor = new THREE.Color(sourceColors[building.source] || sourceColors.estimated);
    group.add(mesh);
    buildings.push(mesh);
  });
  for (const mesh of generatedMeshes)
    if (!buildings.includes(mesh)) {
      mesh.userData.originalColors = mesh.geometry.attributes.color?.array.slice();
      mesh.userData.sourceColor = new THREE.Color(sourceColors.estimated);
      buildings.push(mesh);
    }
  const equipment = roofWriter.mesh(baseMaterial, 'Procedural roof equipment groups');
  equipment.userData.inkClass = 4;
  equipment.userData.depthBoundsCoveredByBuildings = true;
  group.add(equipment);
  const roofOriginal = equipment.geometry.attributes.position.array.slice();
  equipment.userData.lod = { total: roofDetails.length, visible: roofDetails.length };
  const dummy = new THREE.Object3D();
  const frameMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#dadbd4', roughness: 0.83 }),
    nearWalls.length ? 18000 : 0,
  );
  frameMesh.name = 'Nearby frames, sills and balconies (inferred)';
  frameMesh.userData.inkClass = 4;
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  frameMesh.count = 0;
  const detailGroup = new THREE.Group();
  detailGroup.name = 'Near building details';
  detailGroup.add(frameMesh);
  group.add(detailGroup);
  let lodKey = '';
  function updateLOD(camera, viewportHeight = 900) {
    if (camera.isCamera)
      equipment.userData.lod = updateRoofDetails(equipment.geometry, roofDetails, roofOriginal, camera, viewportHeight);
    const key = `${Math.round(camera.position.x / 25)},${Math.round(camera.position.z / 25)},${Math.round(camera.position.y / 25)}`;
    if (key !== lodKey) {
      lodKey = key;
      let count = 0;
      for (const d of nearbyFacadeFrames(nearWalls, camera.position)) {
        dummy.position.set(d.x, d.y, d.z);
        dummy.rotation.set(0, d.angle, 0);
        dummy.scale.set(d.w, d.h, d.d);
        dummy.updateMatrix();
        frameMesh.setMatrixAt(count++, dummy.matrix);
      }
      frameMesh.count = count;
      frameMesh.instanceMatrix.needsUpdate = true;
      frameMesh.computeBoundingSphere();
    }
    streetlife.updateLOD(camera);
  }

  const streetlife = buildStreetLife(data, {
    roadPlan: roadSurface.plan,
    seed: data.seed || 1,
    landscapeTrees: landscape.plan.trees,
  });
  const { treeGroup, streetGroup } = streetlife;
  group.add(treeGroup, streetGroup);
  streetGroup.add(landscape.details);
  function setProvenance(on) {
    shared.provenance.value = on ? 1 : 0;
    for (const mesh of buildings) {
      const colors = mesh.geometry.attributes.color;
      if (!colors) continue;
      if (on) {
        const c = mesh.userData.sourceColor;
        for (let i = 0; i < colors.count; i++) colors.setXYZ(i, c.r, c.g, c.b);
      } else colors.array.set(mesh.userData.originalColors);
      colors.needsUpdate = true;
    }
  }
  annotateSceneSemantics(group);
  const styleBinding = styleSelection ? bindSceneStyle(group, { style: styleSelection, shared }) : null;
  return {
    group,
    runtimeDetails: { facadeWalls: nearWalls, trees: streetlife.plan.trees },
    styleBinding,
    landmarkGroups: landmarkResults.filter((r) => r.claimedFeatureIds.length).map((r) => r.group),
    landmarkDiagnostics: landmarkOptions.enabled === false ? [] : activeRegistry.diagnostics,
    buildings,
    treeGroup,
    detailGroup,
    equipment,
    shared,
    roadPlan: roadSurface.plan,
    streetlifePlan: streetlife.plan,
    updateLOD,
    setProvenance,
    treeCount: streetlife.treeCount,
    generatedTrees: streetlife.generatedTrees,
    streetGroup,
    streetStats: streetlife.stats,
    roadStats: roadSurface.stats,
    landscapeStats: landscape.stats,
    roofStats,
    sourceColors,
    landmarks,
    familyCounts,
    grammarCounts,
    surfaceCounts,
    facadeStats: { candidateWalls: nearWalls.length, maxInstances: 18000 },
  };
}
