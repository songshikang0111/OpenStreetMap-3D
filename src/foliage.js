import * as THREE from 'three';
import { stableRandom } from './osm.js';

// A shared opaque envelope + 18 overlapping leaf masses, rather than 3
// vertically stacked tiers. Instance transforms carry all per-tree variety;
// broadleaf envelopes and near leaf masses are shared across instances.
// Needle crowns use two additional shared envelopes, never one mesh per tree.
export const TREE_LOD = Object.freeze({ distance: 110, nearDistance: 38, maxTrees: 96, clusters: 18, branches: 6 });
const smoothstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// Preserve the near silhouette through the useful middle of the LOD band.
// The raw selection weight still reaches zero smoothly at both budget/distance
// boundaries; only the geometric deployment is accelerated.
export const crownMorphWeight = weight => 1 - (1 - Math.max(0, Math.min(1, weight))) ** 6;
export const isNeedleCrown = shape => shape === 'cypress' || shape === 'conifer';

/** Camera-position-only LOD: continuous across distance and nearest-N boundaries. */
export function treeLODWeights(trees, position, settings = TREE_LOD) {
  const ranked = trees.map((tree, index) => ({ index, distance: Math.hypot(tree.x - position.x, tree.h * .76 + .35 - position.y, tree.z - position.z) }));
  ranked.sort((a, b) => a.distance - b.distance || a.index - b.index);
  // The (N+1)th tree defines a zero-weight boundary. A tree never loses a
  // nonzero crown just because another tree becomes slightly closer to camera.
  const radius = Math.min(settings.distance, ranked[settings.maxTrees]?.distance ?? settings.distance);
  const fullDistance = Math.min(settings.nearDistance, radius * .55);
  const weights = new Float32Array(trees.length), active = [];
  for (const item of ranked) {
    if (item.distance >= radius || active.length >= settings.maxTrees) break;
    const weight = 1 - smoothstep((item.distance - fullDistance) / Math.max(radius - fullDistance, 1e-6));
    if (weight <= 1e-7) continue; // Sub-micrometre lobes carry no visible surface.
    weights[item.index] = weight; active.push({ ...item, weight });
  }
  // Buffer packing follows source order, but selection and weights do not.
  active.sort((a, b) => a.index - b.index);
  return { weights, active, radius, fullDistance };
}

function crownForm(tree) {
  const rng = stableRandom(`canopy-form:${tree.key}:${tree.seed ?? 1}:${tree.variation ?? 0}`);
  // These are illustrative growth habits, not species inferred from OSM.
  const shape = tree.shape || 'spreading', columnar = shape === 'columnar';
  if (isNeedleCrown(shape)) {
    const width = tree.h * (shape === 'cypress' ? .135 + rng() * .035 : .255 + rng() * .045);
    const height = tree.h * (shape === 'cypress' ? .59 + rng() * .07 : .46 + rng() * .065);
    return { shape, needle: true, columnar: false, width, depth: width * (.82 + rng() * .2), height,
      center: height + tree.h * .12 + .35, lean: width * (.025 + rng() * .05), leanAngle: rng() * Math.PI * 2 };
  }
  const width = tree.h * (columnar ? .175 + rng() * .025 : shape === 'round' ? .335 + rng() * .035 : .405 + rng() * .065);
  const depth = width * (columnar || shape === 'round' ? .78 + rng() * .25 : .90 + rng() * .17);
  // Keep this diversity in the persistent far mesh as well. A flat shared
  // envelope would make every tree read as the same umbrella after near LOD.
  const height = tree.h * (columnar ? .285 + rng() * .025 : shape === 'round' ? .30 + rng() * .07 : shape === 'vase' ? .32 + rng() * .065 : .27 + rng() * .10);
  const center = tree.h * (columnar ? .76 : (shape === 'vase' ? .75 : shape === 'round' ? .69 : .70) + (rng() - .5) * .06) + .35;
  const lean = width * (.035 + rng() * .065), leanAngle = rng() * Math.PI * 2;
  return { shape, columnar, width, depth, height, center, lean, leanAngle };
}

export function crownBase(tree) {
  const form = crownForm(tree);
  return { position: [tree.x + Math.cos(form.leanAngle) * form.lean, form.center, tree.z + Math.sin(form.leanAngle) * form.lean],
    scale: [form.width, form.height, form.depth], angle: tree.rotation };
}

/** Conservative near/far envelope for placement; crowns may overlap each other. */
export function crownEnvelope(tree) {
  const form = crownForm(tree), horizontal = Math.max(form.width, form.depth);
  if (form.needle) {
    const radius = form.lean + horizontal * 1.24;
    return { xRadius: radius, zRadius: radius, radius, bottom: form.center - form.height * 1.06, top: form.center + form.height * 1.04 };
  }
  // The outermost leaf centres are <= .81 of the ellipse radius, their
  // largest half-width <= .43, and the shared radial mesh stays below 1.17.
  const radius = form.lean + horizontal * 1.33;
  return { xRadius: radius, zRadius: radius, radius,
    bottom: form.center - (form.columnar ? Math.max(form.height * 1.17, tree.h * .35) : form.height * 1.29),
    top: form.center + (form.columnar ? Math.max(form.height * 1.17, tree.h * .35) : form.height * 1.29) };
}

/** Seeded branch fans with a dome-shaped envelope, no shared horizontal tiers. */
export function crownProfile(tree) {
  const rng = stableRandom(`branch-crown:${tree.key}:${tree.seed ?? 1}:${tree.variation ?? 0}`);
  const base = crownBase(tree), form = crownForm(tree), width = form.width;
  const clusters = [], branches = [], cos = Math.cos(tree.rotation), sin = Math.sin(tree.rotation);
  const world = (x, y, z) => [base.position[0] + x * cos + z * sin, y, base.position[2] - x * sin + z * cos];
  if (form.needle) {
    // Six ascending, rotated branch fans. Their radial reach narrows towards
    // the leader; the persistent pointed mesh is never morphed to a broad crown.
    for (let branch = 0; branch < TREE_LOD.branches; branch++) {
      const t = .13 + branch * .13, radius = needleRadius(t, form.shape), angle = branch * 2.399963 + rng() * .6;
      let tip;
      for (let leaf = 0; leaf < 3; leaf++) {
        const azimuth = angle + leaf * Math.PI * 2 / 3 + (rng() - .5) * .35;
        const y = form.center + form.height * (2 * t - 1 + (rng() - .5) * .05);
        const position = world(Math.cos(azimuth) * width * radius * .72, y, Math.sin(azimuth) * form.depth * radius * .72);
        clusters.push({ position, anchor: world(0, y, 0),
          scale: [width * radius * (.23 + rng() * .09), form.height * (form.shape === 'cypress' ? .115 : .065), form.depth * radius * (.23 + rng() * .07)],
          angle: azimuth + tree.rotation, tint: .83 + rng() * .2 });
        if (leaf === 0) tip = position;
      }
      branches.push({ a: [tree.x, tip[1] + tree.h * .035, tree.z], b: tip, radius: tree.h * .005 });
    }
    return { base, clusters, branches };
  }
  for (let branch = 0; branch < TREE_LOD.branches; branch++) {
    const angle = branch * 2.399963 + (rng() - .5) * .85;
    const lift = (rng() - .5) * .70, spread = .88 + rng() * .12;
    let tip;
    for (let leaf = 0; leaf < 3; leaf++) {
      // Inner/high, outer/main and side/fill lobes overlap along a branch fan.
      // Each branch has its own lift and length, so the silhouette does not
      // form the three repeated floors of the previous crown.
      const azimuth = angle + (leaf === 2 ? .30 + rng() * .55 : (rng() - .5) * .45);
      const radial = (leaf === 0 ? .28 + rng() * .20 : .62 + rng() * .19) * spread;
      const dome = .35 * (1 - radial * radial) - .18 + lift + (rng() - .5) * .28;
      const y = form.center + (form.columnar ? tree.h * (((branch % 3) - 1) * .11 + (rng() - .5) * .12) : form.height * Math.max(-.54, Math.min(.60, dome)));
      const size = leaf === 0 ? .36 + rng() * .07 : .34 + rng() * .09;
      const position = world(Math.cos(azimuth) * width * radial, y, Math.sin(azimuth) * form.depth * radial);
      const offset = position.map((v, axis) => v - base.position[axis]);
      // All zero-weight leaf masses are hidden inside the same opaque base.
      const normalizedRadius = Math.hypot(offset[0] / (Math.min(width, form.depth) * .9), offset[1] / form.height, offset[2] / (Math.min(width, form.depth) * .9));
      const anchorScale = Math.min(1, .57 / normalizedRadius);
      const anchor = offset.map((v, axis) => base.position[axis] + v * anchorScale);
      clusters.push({ position, anchor,
        scale: [width * size, form.columnar ? tree.h * (.125 + rng() * .025) : form.height * (.42 + rng() * .14), form.depth * size * (.83 + rng() * .17)],
        angle: azimuth + tree.rotation, tint: .93 + rng() * .12 });
      if (leaf === 1) tip = position;
    }
    branches.push({ a: [tree.x, tree.h * (.40 + rng() * .07) + .35, tree.z], b: tip, radius: tree.h * (.0065 + rng() * .0025) });
  }
  return { base, clusters, branches };
}

// Shared, world-anchored foliage texture. No photographs or downloaded assets.
export const foliageGLSL = `
float leafHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float leafNoise(vec3 p){
  vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(leafHash(i),leafHash(i+vec3(1,0,0)),f.x),mix(leafHash(i+vec3(0,1,0)),leafHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(leafHash(i+vec3(0,0,1)),leafHash(i+vec3(1,0,1)),f.x),mix(leafHash(i+vec3(0,1,1)),leafHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float leafTexture(vec3 p,float pixelSize){
  float coarse=leafNoise(p*3.2);
  float fine=leafNoise(p*vec3(13.,20.,13.));
  return mix(.5,coarse,.8*(1.-smoothstep(.12,.42,pixelSize)))+(.5-fine)*.35*(1.-smoothstep(.025,.12,pixelSize));
}`;

// Closed, ribbed crown envelopes. Unequal radial ridges and staggered whorls
// avoid perfect cones or separately stacked Christmas-tree discs.
function needleRadius(t, shape) {
  if (shape === 'cypress') return Math.pow(Math.sin(Math.PI * t), .50) * (1 - .55 * t);
  return Math.pow(1 - t, .85) * Math.min(1, .45 + t * 5) * (.79 + .16 * Math.cos(t * Math.PI * 12));
}
function needleGeometry(shape) {
  const radial = 14, rings = 28, positions = [0, -1, 0], indices = [];
  for (let row = 1; row < rings; row++) {
    const t = row / rings, y = 2 * t - 1;
    for (let side = 0; side < radial; side++) {
      const a = side / radial * Math.PI * 2;
      const flutter = 1 + .12 * Math.sin(a * 5 + t * 19) + .07 * Math.cos(a * 3 - t * 31);
      const r = needleRadius(t, shape) * flutter;
      positions.push(Math.cos(a) * r, y + .018 * Math.sin(a * 4 + t * 25) * Math.sin(Math.PI * t), Math.sin(a) * r);
    }
  }
  const top = positions.length / 3; positions.push(0, 1, 0);
  for (let side = 0; side < radial; side++) {
    const next = (side + 1) % radial;
    indices.push(0, 1 + side, 1 + next);
    for (let row = 0; row < rings - 2; row++) {
      const a = 1 + row * radial + side, b = 1 + row * radial + next;
      indices.push(a, a + radial, b, b, a + radial, b + radial);
    }
    const last = 1 + (rings - 2) * radial;
    indices.push(last + side, top, last + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); const result = geometry.toNonIndexed(); geometry.dispose(); result.computeBoundingSphere(); return result;
}

export function crownGeometry(detailed=false, shape='spreading') {
  if (isNeedleCrown(shape)) return needleGeometry(shape);
  const geometry=new THREE.IcosahedronGeometry(1,detailed?3:2),p=geometry.attributes.position,n=geometry.attributes.normal;
  const radial = (x,y,z) => 1 + .06*Math.sin(x*3.1+y*2.4)*Math.cos(z*3.8-x*1.4)
    + .075*Math.sin(x*5.8+z*2.7)*Math.sin(y*6.7-z*3.2)
    + .025*Math.sin(x*12+y*8)*Math.cos(z*11-y*6) + (detailed ? .008*Math.cos(x*25-z*19)*Math.sin(y*27+x*17) : 0);
  const direction=new THREE.Vector3(),gradient=new THREE.Vector3(),normal=new THREE.Vector3(),epsilon=.003;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const radius=radial(x,y,z);
    p.setXYZ(i,x*radius,y*radius,z*radius);
    // Smoothed radial-surface gradient follows the actual lobe shape. Duplicated
    // vertices receive identical normals, so no triangle seams enter ink/AO.
    direction.set(x,y,z).normalize();
    gradient.set(radial(x+epsilon,y,z)-radial(x-epsilon,y,z),radial(x,y+epsilon,z)-radial(x,y-epsilon,z),radial(x,y,z+epsilon)-radial(x,y,z-epsilon)).multiplyScalar(.5/epsilon);
    gradient.addScaledVector(direction,-gradient.dot(direction));
    normal.copy(direction).addScaledVector(gradient,-.46/radius).normalize();n.setXYZ(i,normal.x,normal.y,normal.z);
  }
  geometry.computeBoundingSphere();return geometry;
}

export function foliageMaterial(color) {
  const material=new THREE.MeshStandardMaterial({color,roughness:1});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLeafWorld;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vec4 leafPosition=vec4(position,1.);
      #ifdef USE_INSTANCING
        leafPosition=instanceMatrix*leafPosition;
      #endif
      vLeafWorld=(modelMatrix*leafPosition).xyz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vLeafWorld;\n${foliageGLSL}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float leaf=leafTexture(vLeafWorld,length(fwidth(vLeafWorld)));
      diffuseColor.rgb*=mix(.58,1.35,smoothstep(.24,.76,leaf));`);
  };
  material.customProgramCacheKey=()=> 'world-foliage-v1';return material;
}
