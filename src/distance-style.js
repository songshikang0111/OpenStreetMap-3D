const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** Screen-size LOD: a roof fitting smaller than four pixels contributes no geometry. */
export function roofDetailWeight(size,depth,projectionScale){
  return smoothstep(4,10,size*projectionScale/Math.max(depth,.1));
}

/** CPU deformation shared by color, shadow, depth, normal, ID and GLB export. */
export function updateRoofDetails(geometry,details,original,camera,viewportHeight=900){
  camera.updateMatrixWorld();
  const scale=viewportHeight*camera.projectionMatrix.elements[5]*.5;
  const positions=geometry.attributes.position;let changed=false,visible=0;
  for(const detail of details){
    // Radial distance also behaves sensibly behind the camera and keeps the
    // shadow geometry stable while orbiting at a fixed camera position.
    const [x,y,z]=detail.anchor,depth=Math.hypot(x-camera.position.x,y-camera.position.y,z-camera.position.z);
    const weight=roofDetailWeight(detail.size,depth,scale);if(weight>.001)visible++;
    if(detail.weight===weight)continue;
    detail.weight=weight;changed=true;
    for(let i=detail.start;i<detail.end;i++)positions.array[i]=detail.anchor[i%3]+(original[i]-detail.anchor[i%3])*weight;
  }
  if(changed)positions.needsUpdate=true;
  return {changed,visible,total:details.length};
}
