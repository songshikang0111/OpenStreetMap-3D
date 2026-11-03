import * as THREE from 'three';
import { nearbyFacadeFrames, distanceToFacade } from '../facade-layout.js';
import { TREE_LOD, crownProfile, crownMorphWeight, crownGeometry, treeLODWeights } from '../foliage.js';
import { ResourceRegistry, measureGroup } from './resources.js';

/** Rehydrates the existing close-range grammar from inert core metadata.
 * Only high-LOD owners contribute, so no feature is repeated across chunks.
 * Buffers are allocated on demand and released after leaving the near range. */
export class NearDetails {
  constructor({ budget, bindGroup, releaseGroup = () => {} }) {
    Object.assign(this, { budget, bindGroup, releaseGroup });
    this.group = new THREE.Group(); this.group.name = 'Budgeted near attachments';
    this.registry = new ResourceRegistry(); this.profiles = new Map(); this.lastActive = 0;
    this.metrics = { triangles: 0, drawCalls: 0, nearDetails: 0 }; this.lastKey = '';
  }
  ensure(frameCapacity, treeCapacity) {
    if (this.resources && this.frameCapacity >= frameCapacity && this.treeCapacity >= treeCapacity) return;
    this.clear(); this.frameCapacity = frameCapacity; this.treeCapacity = treeCapacity;
    const make = (name, geometry, count, role, color, inkClass) => {
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1 }), Math.max(1, count));
      mesh.name = name; mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.city = { schemaVersion: 1, featureId: 'runtime-near-attachments', featureIds: [], sourceIds: [], materialRole: role, kind: role === 'foliage' ? 'tree' : 'facility', lodRole: 'detail', inkClass, instanceFeatureIds: [] };
      mesh.userData.inkClass = inkClass; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh); return mesh;
    };
    this.frames = make('Nearby frames, sills and balconies (inferred)', new THREE.BoxGeometry(1, 1, 1), frameCapacity, 'structure', '#dadbd4', 4);
    this.leaves = make('Nearby crown clusters', crownGeometry(true), treeCapacity * TREE_LOD.clusters, 'foliage', '#ffffff', 2);
    this.branches = make('Nearby branching', new THREE.CylinderGeometry(1, 1, 1, 7), treeCapacity * TREE_LOD.branches, 'structure', '#756650', 4);
    const original = this.registry.retain(this.group);
    try { this.binding = this.bindGroup(this.group); if (this.binding?.then) throw new TypeError('Near attachment style binding must be synchronous.'); }
    finally { this.resources = this.registry.retain(this.group); this.registry.release(original); }
  }
  update(entries, camera, time, availableTriangles, passMultiplier = 5, { residentBytes = Infinity, drawCalls = Infinity, nearDetails = Infinity } = {}) {
    const walls = [], treeMap = new Map(); let bodyDetails = 0;
    for (const entry of entries) if (entry.group.visible) {
      bodyDetails += entry.metrics?.nearDetails ?? measureGroup(entry.group).nearDetails;
      const details = entry.group.userData.city?.nearDetails;
      if (!details || details.schemaVersion !== 1) continue;
      walls.push(...details.facadeWalls);
      for (const tree of details.trees) treeMap.set(tree.featureId, tree);
    }
    // The caller's headroom is an additional cap, not another budget to spend.
    // Also enforce the global limit here for callers using the older signature.
    const maxAttachments = Math.max(0, Math.floor(Math.min(this.budget.nearDetails - bodyDetails, nearDetails)));
    if (!maxAttachments) { this.clear(); return; }
    const trees = [...treeMap.values()].sort((a, b) => a.featureId.localeCompare(b.featureId));
    const sceneTriangles = Math.max(0, availableTriangles) / Math.max(1, passMultiplier);
    const baseBytes = 40000, treeInstanceBytes = 18 * 76 + 6 * 64;
    const availableBytes = Math.max(0, residentBytes - baseBytes), availableCalls = Math.floor(drawCalls / Math.max(1, passMultiplier));
    if (residentBytes < baseBytes || availableCalls < 1 || this.resources && this.registry.stats().geometryArrayBytes > residentBytes) this.clear();
    if (residentBytes < baseBytes || availableCalls < 1) return;
    const candidates = camera.position.y < 180 ? walls.map(wall => ({ wall, distance: distanceToFacade(wall, camera.position) })).filter(c => c.distance <= 162).sort((a, b) => a.distance - b.distance || a.wall.key.localeCompare(b.wall.key)) : [];
    // Keep complete pane sets and complete branch profiles when budgets change.
    const frameByteLimit = Math.floor(availableBytes * (trees.length ? .65 : 1) / 64);
    const frameLimit = Math.min(18000, maxAttachments, frameByteLimit, Math.floor(sceneTriangles * .55 / 12));
    const frameData = [];
    for (const { wall } of candidates) {
      const frames = nearbyFacadeFrames([wall], camera.position, frameLimit - frameData.length);
      frameData.push(...frames.map(frame => ({ ...frame, featureId: wall.featureId })));
      if (frameData.length >= frameLimit) break;
    }
    const treeCost = 18 * 640 + 6 * 28;
    const capacity = Math.min(frameLimit, Math.ceil(Math.max(frameData.length, 1) / 256) * 256);
    const treeLimit = availableCalls - (frameData.length ? 1 : 0) < 2 ? 0 : Math.max(0, Math.min(TREE_LOD.maxTrees, Math.floor((availableBytes - capacity * 64) / treeInstanceBytes), Math.floor((maxAttachments - frameData.length) / 24), Math.floor((sceneTriangles - frameData.length * 12) / treeCost)));
    const selection = treeLODWeights(trees, camera.position, { ...TREE_LOD, maxTrees: treeLimit });
    if (!frameData.length && !selection.active.length) {
      if (this.frames) for (const mesh of [this.frames, this.leaves, this.branches]) mesh.count = 0;
      this.metrics = { triangles: 0, drawCalls: 0, nearDetails: 0 };
      if (this.resources && time - this.lastActive > this.budget.unloadDelayMs) this.clear();
      return;
    }
    this.lastActive = time;
    // A bounded capacity amortizes camera motion without allocating per frame.
    this.ensure(capacity, Math.min(treeLimit, Math.max(selection.active.length, 8)));
    const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color(), activeKeys = new Set();
    const write = (mesh, i, position, scale, angle, featureId, color) => {
      dummy.position.fromArray(position); dummy.scale.fromArray(scale); dummy.rotation.set(0, angle || 0, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      mesh.userData.city.instanceFeatureIds[i] = featureId; if (color) mesh.setColorAt(i, color);
    };
    for (let i = 0; i < frameData.length; i++) { const f = frameData[i]; write(this.frames, i, [f.x, f.y, f.z], [f.w, f.h, f.d], f.angle, f.featureId); }
    let leafCount = 0, branchCount = 0;
    const broadColors = ['#778865', '#8b9975', '#738568', '#94a079'], needleColors = ['#486b59', '#57735d', '#607a64', '#506957'];
    for (const { index, weight: selectedWeight } of selection.active) {
      const tree = trees[index], weight = crownMorphWeight(selectedWeight); activeKeys.add(tree.featureId);
      if (!this.profiles.has(tree.featureId)) this.profiles.set(tree.featureId, crownProfile(tree));
      const profile = this.profiles.get(tree.featureId), colors = ['cypress', 'conifer'].includes(tree.shape) ? needleColors : broadColors;
      const color = new THREE.Color(colors[Math.floor(tree.variation * 4)]);
      for (const cluster of profile.clusters) {
        const position = cluster.position.map((v, axis) => cluster.anchor[axis] + (v - cluster.anchor[axis]) * weight);
        write(this.leaves, leafCount++, position, cluster.scale.map(v => v * weight), cluster.angle, tree.featureId, tint.copy(color).multiplyScalar(cluster.tint));
      }
      for (const branch of profile.branches) {
        const a = new THREE.Vector3(...branch.a), b = new THREE.Vector3(...branch.b).sub(a).multiplyScalar(weight), length = b.length();
        dummy.position.copy(a).addScaledVector(b, .5); dummy.quaternion.setFromUnitVectors(up, b.normalize()); dummy.scale.set(branch.radius * weight, length, branch.radius * weight); dummy.updateMatrix();
        this.branches.setMatrixAt(branchCount, dummy.matrix); this.branches.userData.city.instanceFeatureIds[branchCount++] = tree.featureId;
      }
    }
    for (const [mesh, count] of [[this.frames, frameData.length], [this.leaves, leafCount], [this.branches, branchCount]]) {
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.city.instanceFeatureIds.length = count; mesh.computeBoundingSphere();
    }
    if (this.profiles.size > 192) for (const key of this.profiles.keys()) if (!activeKeys.has(key)) this.profiles.delete(key);
    this.metrics = measureGroup(this.group);
  }
  refreshResources() {
    if (!this.resources) return;
    const resources = this.registry.retain(this.group); this.registry.release(this.resources); this.resources = resources;
  }
  stats() { return { ...this.registry.stats(), ...this.metrics, frames: this.frames?.count || 0, crownClusters: this.leaves?.count || 0, branches: this.branches?.count || 0, profiles: this.profiles.size }; }
  rebind(bindGroup) {
    this.bindGroup = bindGroup;
    if (this.resources) { this.binding?.dispose?.(); this.binding = bindGroup(this.group); this.refreshResources(); }
  }
  clear() {
    this.releaseGroup(this.group); this.binding?.dispose?.(); if (this.resources) this.registry.release(this.resources);
    this.group.clear(); this.resources = null; this.frames = this.leaves = this.branches = null; this.binding = null;
    this.profiles.clear(); this.metrics = { triangles: 0, drawCalls: 0, nearDetails: 0 };
  }
  dispose() { this.clear(); this.group.removeFromParent(); }
}
