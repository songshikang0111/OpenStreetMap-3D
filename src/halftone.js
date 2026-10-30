// A single dot lattice grows continuously with material darkness. Switching
// between black dots and white holes at density=.5 flips its phase and turns
// tiny lighting variations into large salt-and-pepper changes on glass.
export const halftoneGLSL = `
float screentone(float density){
  density=clamp(density,0.,.88);
  vec2 grid=mat2(.866025,-.5,.5,.866025)*gl_FragCoord.xy/max(toneSize,1.7);
  vec2 cell=fract(grid)-.5;
  float radius=sqrt(density/3.14159265);
  float aa=clamp(.45/max(toneSize,1.7),.018,.20);
  return (1.-smoothstep(radius-aa,radius+aa,length(cell)))*step(.025,density);
}`;

// CPU reference for threshold/monotonicity checks, taking coordinates within
// the already rotated unit cell. High-density circles meet across cell edges
// naturally; no discrete inversion or screen-phase change is needed.
export function halftoneCoverage(density, cellX, cellY, toneSize=4.2){
  density=Math.max(0,Math.min(.88,density));
  if(density<.025)return 0;
  const radius=Math.sqrt(density/Math.PI),aa=Math.max(.018,Math.min(.2,.45/Math.max(toneSize,1.7)));
  const distance=Math.hypot(cellX,cellY),t=Math.max(0,Math.min(1,(distance-radius+aa)/(2*aa)));
  return 1-t*t*(3-2*t);
}
