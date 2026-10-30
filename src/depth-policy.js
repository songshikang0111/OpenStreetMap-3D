import {Box3} from 'three';

export function collectDepthBounds(group){
  group.updateMatrixWorld(true);const result=[];
  group.traverse(o=>{
    if(!o.isMesh||!o.geometry?.attributes.position?.count||o.isInstancedMesh&&!o.count||o.userData.depthBoundsCoveredByBuildings)return;
    const box=new Box3().setFromObject(o);
    // Individual building boxes already cover their roof fittings. A merged
    // equipment box spans empty air across the whole city and gives distance 0.
    if(!box.isEmpty())result.push(box.expandByScalar(5));
  });
  return result;
}

/** Conservative distance to actual geometry, not altitude above an assumed
 * empty ground. A tall roof close to the camera must keep a small near plane.
 */
export function stableNearPlane(position,boxes){
  let nearest=Infinity;for(const box of boxes)nearest=Math.min(nearest,box.distanceToPoint(position));
  return Number.isFinite(nearest)?Math.max(.2,Math.min(200,nearest*.2)):.4;
}
