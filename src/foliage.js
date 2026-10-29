import * as THREE from 'three';

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
  const geometry=new THREE.IcosahedronGeometry(1,detailed?4:2),p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const broad=Math.sin(x*6.7+z*3.4)*Math.sin(y*7.8-z*4.8);
    const medium=Math.sin(x*19+y*13)*Math.cos(z*17-y*11);
    const fine=Math.cos(x*37-z*29)*Math.sin(y*41+x*23);
    const radius=1+.12*broad+.075*medium+(detailed?.035*fine:0);
    p.setXYZ(i,x*radius,y*radius,z*radius);
    // Rounded leaf masses with a coherent silhouette instead of faceted normals.
    const normal=new THREE.Vector3(x+medium*.12,y+broad*.1,z+fine*.06).normalize();n.setXYZ(i,normal.x,normal.y,normal.z);
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
