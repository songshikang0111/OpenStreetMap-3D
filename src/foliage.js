import * as THREE from 'three';
import { stableRandom } from './osm.js';

// One persistent base + 18 branch-associated lobes, rather than swapping two
// unrelated crowns. The hard triangle budget is unchanged by camera history.
export const TREE_LOD = Object.freeze({ distance: 110, nearDistance: 38, maxTrees: 96, clusters: 18, branches: 6 });
const smoothstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

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

export function crownBase(tree) {
  const width = tree.h * (tree.shape === 'columnar' ? .145 : .24);
  return { position: [tree.x, tree.h * .76 + .35, tree.z], scale: [width, tree.h * .29, width * .92], angle: tree.rotation };
}

/** Reproducible illustrative branching; this is not a botanical species model. */
export function crownProfile(tree) {
  const rng = stableRandom(`branch-crown:${tree.key}`), base = crownBase(tree), width = base.scale[0];
  const clusters = [], branches = [], columnar = tree.shape === 'columnar';
  for (let branch = 0; branch < TREE_LOD.branches; branch++) {
    const angle = tree.rotation + branch * 2.399963 + (rng() - .5) * .62;
    const spread = .83 + rng() * .24, lift = (rng() - .5) * .055;
    let tip;
    for (let leaf = 0; leaf < 3; leaf++) {
      const t = (leaf + .15 + rng() * .5) / 3, azimuth = angle + (rng() - .5) * .5;
      const radial = width * spread * (.54 + .22 * Math.sin(t * Math.PI));
      const y = tree.h * ((columnar ? .55 : .60) + t * (columnar ? .45 : .36) + lift) + .35;
      const size = .32 + rng() * .12;
      const position = [tree.x + Math.cos(azimuth) * radial, y, tree.z + Math.sin(azimuth) * radial];
      clusters.push({ position, scale: [width * size, tree.h * (.083 + rng() * .034), width * size * (.75 + rng() * .28)], angle: azimuth, tint: .97 + rng() * .06 });
      if (leaf === 1) tip = position;
    }
    branches.push({ a: [tree.x, tree.h * (.38 + rng() * .08) + .35, tree.z], b: tip, radius: tree.h * (.0065 + rng() * .0025) });
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

export function crownGeometry(detailed=false) {
  const geometry=new THREE.IcosahedronGeometry(1,detailed?3:2),p=geometry.attributes.position,n=geometry.attributes.normal;
  const radial = (x,y,z) => 1 + .095*Math.sin(x*5.3+z*2.7)*Math.sin(y*6.1-z*3.2)
    + .04*Math.sin(x*12+y*8)*Math.cos(z*11-y*6) + (detailed ? .012*Math.cos(x*25-z*19)*Math.sin(y*27+x*17) : 0);
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
    normal.copy(direction).addScaledVector(gradient,-.36/radius).normalize();n.setXYZ(i,normal.x,normal.y,normal.z);
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
