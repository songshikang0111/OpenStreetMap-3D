import * as THREE from 'three';

// Independent screen-space illustration renderer. Render targets remain linear.
export const INK_DEFAULTS = Object.freeze({
  lineWidth: 1, outlineWidth: 1.35, toneSize: 4.2, inkDensity: .85,
  blackPoint: .095, toneThreshold: .52, shadowStrength: 1,
  aoStrength: .65, haze: .3, treeInk: .8,
});

const vertexShader = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

const depthFunctions = `
vec4 sample0(sampler2D tex,vec2 uv){return textureLod(tex,uv,0.);}
float linearDepth(float d){return nearPlane*farPlane/(farPlane-d*(farPlane-nearPlane));}
float depthAt(vec2 p){return linearDepth(sample0(tDepth,p).r);}
vec3 viewPosition(vec2 p,float d){vec4 v=inverseProjection*vec4(p*2.-1.,d*2.-1.,1.);return v.xyz/v.w;}
vec3 normalAt(vec2 p){return normalize(sample0(tNormal,p).xyz*2.-1.);}
`;

// Eight samples at half resolution; a world-space radius restricts the shading
// to corners and contacts instead of drawing a dark halo around every tower.
const aoShader = `
varying vec2 vUv;
uniform sampler2D tDepth,tNormal;
uniform mat4 inverseProjection;
uniform vec2 resolution;
uniform float nearPlane,farPlane,projectionScale;
${depthFunctions}
void main(){
  float raw=sample0(tDepth,vUv).r,d=linearDepth(raw);
  if(raw>.999999){gl_FragColor=vec4(0.,d,0.,1.);return;}
  vec3 p=viewPosition(vUv,raw),n=normalAt(vUv);
  float worldRadius=3.6;
  float pixelRadius=clamp(worldRadius*projectionScale/max(d,.2),2.,28.);
  float occlusion=0.,weight=0.;
  for(int i=0;i<8;i++){
    float a=float(i)*2.399963;
    float radius=sqrt((float(i)+.5)/8.);
    vec2 uv=clamp(vUv+vec2(cos(a),sin(a))*pixelRadius*radius/resolution,vec2(.001),vec2(.999));
    float qd=sample0(tDepth,uv).r;
    vec3 delta=viewPosition(uv,qd)-p;
    float distanceToSample=length(delta);
    float horizon=max(0.,dot(n,delta)/max(distanceToSample,.001)-.12);
    float falloff=1.-smoothstep(.15,worldRadius,distanceToSample);
    occlusion+=horizon*falloff*(1.-step(.999999,qd));
    weight+=1.;
  }
  gl_FragColor=vec4(clamp(occlusion/max(weight,1.)*3.1,0.,.85),d,0.,1.);
}`;

const fragmentShader = `
varying vec2 vUv;
uniform sampler2D tColor,tNormal,tDepth,tId,tAO;
uniform vec2 resolution,aoResolution;
uniform mat4 inverseProjection,inverseView;
uniform float nearPlane,farPlane,lineWidth,outlineWidth,toneSize,inkDensity,blackPoint,mode;
uniform float aoStrength,toneThreshold,shadowStrength,haze,treeInk;
uniform vec3 paper,ink;
${depthFunctions}
float classAt(vec4 id){return floor(id.a+.01);}
float isClass(float kind,float test){return 1.-step(.4,abs(kind-test));}
float filteredAO(float depth){
  float sum=0.,total=0.;
  for(int i=0;i<4;i++){
    vec2 off=vec2(float(i-i/2*2)-.5,float(i/2)-.5)/aoResolution;
    vec2 sampleAO=sample0(tAO,clamp(vUv+off,vec2(.001),vec2(.999))).rg;
    float weight=1./(1.+abs(sampleAO.y-depth)*2.5);
    sum+=sampleAO.x*weight;total+=weight;
  }
  return sum/max(total,.001);
}
vec2 boundary(vec2 offset,float depth,vec3 normal,vec4 id){
  vec2 p=clamp(vUv+offset/resolution,vec2(.0001),vec2(.9999));
  float raw=sample0(tDepth,p).r;
  float otherDepth=linearDepth(raw);
  vec4 otherId=sample0(tId,p);
  float tree=isClass(classAt(id),2.);
  float otherTree=isClass(classAt(otherId),2.);
  float difference=abs(otherDepth-depth);
  float tolerance=max(.45,depth*.012);
  tolerance=mix(tolerance,max(4.2,depth*.025),tree*otherTree);
  float jump=smoothstep(tolerance,tolerance*2.1,difference);
  float foreground=step(depth,otherDepth+.05);
  float silhouette=max(jump*foreground,step(.999999,raw));
  float crease=smoothstep(.27,.65,1.-dot(normal,normalAt(p)));
  float separate=step(.004,length(otherId.rgb-id.rgb));
  // Thin fins can alternate foreground normals below one pixel even though the
  // color target resolves them correctly with MSAA. At district-view distances
  // use the building's silhouette and ID boundary instead of each micro-crease.
  float sameBuilding=isClass(classAt(id),1.)*isClass(classAt(otherId),1.)*(1.-separate);
  crease*=1.-sameBuilding*smoothstep(500.,1500.,depth);
  float adjacent=1.-smoothstep(tolerance*.7,tolerance*2.2,difference);
  float inner=max(crease,separate*.96)*adjacent;
  inner*=1.-tree;
  return vec2(silhouette,inner);
}
float screentone(float density){
  density=clamp(density,0.,.88);
  vec2 grid=mat2(.866025,-.5,.5,.866025)*gl_FragCoord.xy/max(toneSize,1.7);
  vec2 cell=fract(grid)-.5;
  float inverseTone=step(.5,density),coverage=mix(density,1.-density,inverseTone);
  float radius=sqrt(coverage/3.14159265);
  float distanceToCenter=length(cell);
  // Analytic pixel footprint avoids derivatives under varying control flow.
  float aa=clamp(.45/max(toneSize,1.7),.018,.20);
  float dotMask=1.-smoothstep(radius-aa,radius+aa,distanceToCenter);
  return mix(dotMask,1.-dotMask,inverseTone)*step(.025,density);
}
float windowAt(vec2 p){
  vec4 id=sample0(tId,p);
  float capable=step(.1,fract(id.a));
  return sample0(tColor,p).a*isClass(classAt(id),1.)*capable;
}
void main(){
  float rawDepth=sample0(tDepth,vUv).r;
  if(rawDepth>.999999){gl_FragColor=vec4(paper,1.);}
  else{
    vec3 color=sample0(tColor,vUv).rgb;
    vec3 normal=normalAt(vUv);
    vec4 id=sample0(tId,vUv);
    float kind=classAt(id),depth=linearDepth(rawDepth);
    float tree=isClass(kind,2.),ground=max(isClass(kind,3.),isClass(kind,5.));
    float distanceFade=1.-smoothstep(850.,6500.,depth);
    float innerWidth=lineWidth*mix(.82,1.,distanceFade);
    float outerWidth=innerWidth*outlineWidth*mix(1.,1.25,tree);
    vec2 directions[4];directions[0]=vec2(1.,0.);directions[1]=vec2(0.,1.);directions[2]=vec2(.707,.707);directions[3]=vec2(-.707,.707);
    float outer=0.,inner=0.;
    for(int i=0;i<4;i++){
      vec2 a=boundary(directions[i]*innerWidth,depth,normal,id);
      vec2 b=boundary(-directions[i]*innerWidth,depth,normal,id);
      inner=max(inner,max(a.y,b.y));
      outer=max(outer,max(boundary(directions[i]*outerWidth,depth,normal,id).x,boundary(-directions[i]*outerWidth,depth,normal,id).x));
    }
    // Preserve ink opacity in a whole-district view. Distance reduces detail
    // width, not the contrast of structural contours against the white paper.
    float edge=max(outer*mix(.98,1.,distanceFade),inner*mix(.94,1.,distanceFade));
    float ao=filteredAO(depth)*aoStrength;
    float lum=dot(color,vec3(.2126,.7152,.0722));
    float windowMask=windowAt(vUv);
    // Ground planes retain white areas; glass and tree crowns carry the darks.
    float threshold=toneThreshold*mix(1.,.42,ground);
    float shade=clamp((threshold-lum)/max(threshold,.08),0.,1.);
    float density=(shade*.50*shadowStrength+ao*.48)*inkDensity;
    float solid=1.-smoothstep(blackPoint*.65,blackPoint*1.15+.015,lum);
    solid*=1.-ground*.88;
    vec3 worldNormal=normalize(mat3(inverseView)*normal);
    if(tree>.5){
      float lower=1.-smoothstep(-.22,.35,worldNormal.y);
      float canopyShade=clamp((.5-lum)/.5,0.,1.);
      density=mix(density,.10+canopyShade*.27+ao*.12,treeInk);
      solid=mix(solid,smoothstep(.52,.80,lower*.60+canopyShade*.20+ao*.16),treeInk);
    }
    density*=mix(.82,1.,distanceFade);
    density=clamp(density,0.,.82);
    density=floor(density*12.+.25)/12.;
    float glassInk=smoothstep(.42,.78,windowMask)*mix(.86,.98,distanceFade);
    float dx=max(innerWidth,.85)/resolution.x,dy=max(innerWidth,.85)/resolution.y;
    float glassEdge=max(max(abs(windowMask-windowAt(vUv+vec2(dx,0.))),abs(windowMask-windowAt(vUv-vec2(dx,0.)))),max(abs(windowMask-windowAt(vUv+vec2(0.,dy))),abs(windowMask-windowAt(vUv-vec2(0.,dy)))));
    glassEdge=smoothstep(.17,.6,glassEdge)*mix(.80,.95,distanceFade);
    vec3 result;
    if(mode<.5){
      float coverage=max(edge,max(screentone(density),max(solid,glassInk)));
      result=mix(paper,ink,coverage);
    }else if(mode<1.5){
      result=mix(paper,ink,max(edge,max(glassEdge,glassInk*.075)));
    }else if(mode<2.5){
      vec3 lit=color*(1.-ao*.48);
      float air=(1.-exp(-depth/2500.))*haze;
      lit=mix(lit,vec3(.84,.9,.94),air);
      result=mix(lit,ink,edge*.24);
    }else if(mode<3.5){result=color*(1.-ao*.5);}
    else{result=mix(color,ink,edge*.32);}
    gl_FragColor=vec4(result,1.);
  }
  #include <colorspace_fragment>
}`;

function inferredClass(object) {
  let node = object;
  while (node) {
    if (Number.isFinite(node.userData?.inkClass)) return node.userData.inkClass;
    node = node.parent;
  }
  if (object.userData.feature || object.userData.generatedFacade) return 1;
  const name = object.name.toLowerCase();
  if (/leav|foliage|crown|canop/.test(name)) return 2;
  if (/road|sidewalk|paving|marking|curb|crossing/.test(name)) return 3;
  if (/water/.test(name)) return 6;
  if (/ground|land cover|terrain/.test(name)) return 5;
  if (object.parent?.name === 'Trees' && object.geometry?.type === 'IcosahedronGeometry') return 2;
  return 4;
}

export class InkRenderer {
  constructor(renderer,scene,camera){
    this.renderer=renderer;this.scene=scene;this.camera=camera;
    const makeTarget=(filter=THREE.LinearFilter)=>new THREE.WebGLRenderTarget(1,1,{minFilter:filter,magFilter:filter,type:THREE.HalfFloatType,depthBuffer:true});
    this.color=makeTarget();this.normal=makeTarget(THREE.NearestFilter);this.ids=makeTarget(THREE.NearestFilter);this.ao=makeTarget();
    // The renderer's canvas antialias flag does not cover offscreen targets.
    // Resolve subpixel facade ribs before the color buffer reaches post effects.
    this.color.samples=4;
    this.normal.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.normalMaterial=new THREE.MeshNormalMaterial();this.normalMaterial.side=THREE.DoubleSide;
    this.idMaterial=new THREE.ShaderMaterial({
      vertexShader:`attribute vec3 objectId; attribute float inkClass; varying vec3 vId; varying float vClass;
      void main(){vec4 p=vec4(position,1.);vId=objectId;vClass=inkClass;
      #ifdef USE_INSTANCING
      p=instanceMatrix*p;
      #endif
      gl_Position=projectionMatrix*modelViewMatrix*p;}`,
      fragmentShader:`varying vec3 vId;varying float vClass;void main(){gl_FragColor=vec4(vId,vClass);}`,
      defaultAttributeValues:{color:[1,1,1],uv:[0,0],objectId:[0,0,0],inkClass:[4]},side:THREE.DoubleSide,
    });
    this.inverseProjection=new THREE.Matrix4();this.inverseView=new THREE.Matrix4();
    const common={tNormal:{value:this.normal.texture},tDepth:{value:this.normal.depthTexture},nearPlane:{value:camera.near},farPlane:{value:camera.far},inverseProjection:{value:this.inverseProjection}};
    this.material=new THREE.ShaderMaterial({vertexShader,fragmentShader,depthTest:false,depthWrite:false,uniforms:{
      ...common,tColor:{value:this.color.texture},tId:{value:this.ids.texture},tAO:{value:this.ao.texture},
      resolution:{value:new THREE.Vector2(1,1)},aoResolution:{value:new THREE.Vector2(1,1)},inverseView:{value:this.inverseView},
      ...Object.fromEntries(Object.entries(INK_DEFAULTS).map(([key,value])=>[key,{value}])),mode:{value:0},
      paper:{value:new THREE.Color('#ffffff')},ink:{value:new THREE.Color('#17191b')},
    }});
    this.aoMaterial=new THREE.ShaderMaterial({vertexShader,fragmentShader:aoShader,depthTest:false,depthWrite:false,uniforms:{
      ...common,resolution:{value:new THREE.Vector2(1,1)},projectionScale:{value:1},
    }});
    this.screenGeometry=new THREE.PlaneGeometry(2,2);this.screenMesh=new THREE.Mesh(this.screenGeometry,this.material);
    this.screen=new THREE.Scene();this.screen.add(this.screenMesh);this.screenCamera=new THREE.Camera();
    this.clayMaterial=new THREE.MeshStandardMaterial({color:'#e5e5df',roughness:1});
    this._classification=new WeakMap();this.prepareScene();
  }

  prepareScene(){
    this.scene.traverse(object=>{
      if(!object.isMesh||!object.geometry?.attributes.position)return;
      const kind=inferredClass(object)+(object.userData.generatedFacade ? .25 : 0);
      if(this._classification.get(object)===kind)return;
      if(object.geometry.userData.inkClass!==undefined && object.geometry.userData.inkClass!==kind)object.geometry=object.geometry.clone();
      const geometry=object.geometry,count=geometry.attributes.position.count;
      geometry.userData.inkClass=kind;
      geometry.setAttribute('inkClass',new THREE.Float32BufferAttribute(new Float32Array(count).fill(kind),1));
      this._classification.set(object,kind);
    });
  }

  resize(width,height){
    for(const target of [this.color,this.normal,this.ids])target.setSize(width,height);
    const aw=Math.max(1,Math.ceil(width/2)),ah=Math.max(1,Math.ceil(height/2));this.ao.setSize(aw,ah);
    this.material.uniforms.resolution.value.set(width,height);this.material.uniforms.aoResolution.value.set(aw,ah);
    this.aoMaterial.uniforms.resolution.value.set(width,height);
  }

  render(){
    const r=this.renderer,s=this.scene,c=this.camera,background=s.background,override=s.overrideMaterial,autoUpdate=r.shadowMap.autoUpdate;
    const clear=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();
    this.prepareScene();c.updateMatrixWorld();this.inverseProjection.copy(c.projectionMatrixInverse);this.inverseView.copy(c.matrixWorld);
    this.material.uniforms.nearPlane.value=c.near;this.material.uniforms.farPlane.value=c.far;
    this.aoMaterial.uniforms.projectionScale.value=this.color.height*c.projectionMatrix.elements[5]*.5;
    try{
      s.overrideMaterial=this.material.uniforms.mode.value===3?this.clayMaterial:null;
      r.setRenderTarget(this.color);r.clear();r.render(s,c);
      r.shadowMap.autoUpdate=false;s.background=null;r.setClearColor(0x000000,0);
      s.overrideMaterial=this.normalMaterial;r.setRenderTarget(this.normal);r.clear();r.render(s,c);
      s.overrideMaterial=this.idMaterial;r.setRenderTarget(this.ids);r.clear();r.render(s,c);
      this.screenMesh.material=this.aoMaterial;r.setRenderTarget(this.ao);r.clear();r.render(this.screen,this.screenCamera);
      this.screenMesh.material=this.material;r.setRenderTarget(null);r.render(this.screen,this.screenCamera);
    }finally{
      s.overrideMaterial=override;s.background=background;r.shadowMap.autoUpdate=autoUpdate;r.setClearColor(clear,alpha);r.setRenderTarget(null);this.screenMesh.material=this.material;
    }
  }

  dispose(){
    for(const target of [this.color,this.normal,this.ids,this.ao])target.dispose();
    for(const m of [this.normalMaterial,this.idMaterial,this.material,this.aoMaterial,this.clayMaterial])m.dispose();
    this.screenGeometry.dispose();
  }
}
