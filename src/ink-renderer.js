import * as THREE from 'three';
import { foliageGLSL } from './foliage.js';
import { halftoneGLSL } from './halftone.js';
import { installFacadeShader, facadeAttributeDefaults } from './facade-shader.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

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
uniform sampler2D tColor,tLight,tNormal,tDepth,tId,tAO;
uniform vec2 resolution,aoResolution;
uniform mat4 inverseProjection,inverseView;
uniform float nearPlane,farPlane,lineWidth,outlineWidth,toneSize,inkDensity,blackPoint,mode;
uniform float aoStrength,toneThreshold,shadowStrength,haze,treeInk;
uniform float projectionScale;
uniform vec3 paper,ink;
${depthFunctions}
${foliageGLSL}
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
  // IDs differ by 1/255; a .004 threshold misses consecutive objects.
  float separate=step(.0018,length(otherId.rgb-id.rgb));
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
${halftoneGLSL}
float windowAt(vec2 p){
  vec4 id=sample0(tId,p);
  float capable=1.-step(.10,abs(id.a-1.25));
  return sample0(tColor,p).a*isClass(classAt(id),1.)*capable;
}
float pavingIntegral(float p,float width){return floor(p)*2.*width+clamp(fract(p)-(.5-width),0.,2.*width);}
float pavingStripe(float p,float width){float footprint=max(fwidth(p),.001);return clamp((pavingIntegral(p+footprint*.5,width)-pavingIntegral(p-footprint*.5,width))/footprint,0.,1.);}
void main(){
  float rawDepth=sample0(tDepth,vUv).r;
  if(rawDepth>.999999){gl_FragColor=vec4(paper,0.);}
  else{
    vec3 color=sample0(tColor,vUv).rgb;
    vec3 normal=normalAt(vUv);
    vec4 id=sample0(tId,vUv);
    float kind=classAt(id),depth=linearDepth(rawDepth);
    float tree=isClass(kind,2.),ground=max(isClass(kind,3.),isClass(kind,5.));
    // Do not use fract here: interpolation just below an integral class wraps
    // to nearly 1 and would misclassify whole road triangles as white paint.
    float roadPaint=1.-step(.12,abs(id.a-3.5));
    float walkway=1.-step(.07,abs(id.a-3.2));
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
    float air=clamp((1.-exp(-max(depth-180.,0.)/2400.))*haze,0.,.65);
    float edge=max(outer*(1.-air*.45),inner*(1.-air*.8));
    float ao=filteredAO(depth)*aoStrength;
    float lum=dot(color,vec3(.2126,.7152,.0722));
    vec4 lighting=sample0(tLight,vUv);
    float illumination=dot(lighting.rgb,vec3(.2126,.7152,.0722));
    float castShadow=clamp(lighting.a,0.,1.);
    float windowMask=windowAt(vUv);
    // Ground planes retain white areas; glass and tree crowns carry the darks.
    float threshold=mix(.32,.95,toneThreshold);
    float shade=clamp((threshold-illumination)/max(threshold,.08),0.,1.);
    float density=(shade*.58*shadowStrength+ao*.48)*inkDensity;
    // On generated facades light.a carries unresolved material ink; elsewhere
    // it remains the cast-shadow mask. Never use it as an edge or black fill.
    float facade=1.-step(.10,abs(id.a-1.25));
    float materialTone=clamp(lighting.a,0.,.72)*facade;
    // Leave paper between resolved panes. Dense neutral-light dots competing
    // with the window grid were reading as a second, unrelated wall texture.
    density*=1.-facade*.48;
    density=1.-(1.-density)*(1.-materialTone*inkDensity);
    // Unshadowed paving reads as paper, even when its neutral diffuse lighting
    // is below the facade tone threshold. Keep cast shadows and contact AO as
    // separate signals instead of spreading one gray tone across the street.
    float groundDensity=(castShadow*.46*shadowStrength+ao*.34)*inkDensity;
    // Ground-use subclasses encode broad material values, not micro textures.
    // Paving stays paper; lawn and hedge retain a quiet tone in full sunlight.
    float siteTone=isClass(kind,5.)*clamp(id.a-5.,0.,.3);
    groundDensity=1.-(1.-groundDensity)*(1.-siteTone*.65*inkDensity);
    groundDensity*=mix(1.,.68,walkway);
    density=mix(density,groundDensity,ground);
    density*=1.-roadPaint;
    float solid=1.-smoothstep(blackPoint*.65,blackPoint*1.15+.015,lum);
    solid*=1.-ground*.88;
    solid*=1.-isClass(kind,1.);
    solid*=1.-roadPaint;
    vec3 worldNormal=normalize(mat3(inverseView)*normal);
    vec3 worldPoint=(inverseView*vec4(viewPosition(vUv,rawDepth),1.)).xyz;
    float worldPixel=length(fwidth(worldPoint));
    // Illustrative metre-scale paver joints. Analytic coverage and a pixel-size
    // fade prevent a far sidewalk becoming a noisy checkerboard. Asphalt and
    // painted crossings never receive this pattern.
    vec2 pavingUV=worldPoint.xz/vec2(1.2,.75);
    float pavingInk=max(pavingStripe(pavingUV.x+.5,.012/1.2),pavingStripe(pavingUV.y+.5,.012/.75));
    pavingInk*=walkway*.32*(1.-smoothstep(.025,.16,worldPixel));
    float leafLine=0.;
    if(tree>.5){
      float lower=1.-smoothstep(-.22,.35,worldNormal.y);
      float canopyShade=clamp((threshold-illumination)/max(threshold,.08),0.,1.);
      float leaf=leafTexture(worldPoint,worldPixel);
      float leafShadow=lower*.52+canopyShade*.34+ao*.12+(leaf-.5)*.9;
      leafLine=(1.-smoothstep(.012,.05,abs(leaf-.54)))*(1.-smoothstep(.04,.2,worldPixel))*.65;
      density=mix(density,.10+canopyShade*.28+ao*.12,treeInk);
      solid=mix(solid,smoothstep(.40,.62,leafShadow),treeInk);
    }
    density*=1.-air;
    density=clamp(density,0.,.82);
    // Keep coverage continuous: a hard density bucket amplifies tiny lighting
    // differences between coplanar road triangles into visible white patches.
    float glassInk=windowMask*(1.-air*.65);
    float dx=max(innerWidth,.85)/resolution.x,dy=max(innerWidth,.85)/resolution.y;
    float glassEdge=max(max(abs(windowMask-windowAt(vUv+vec2(dx,0.))),abs(windowMask-windowAt(vUv-vec2(dx,0.)))),max(abs(windowMask-windowAt(vUv+vec2(0.,dy))),abs(windowMask-windowAt(vUv-vec2(0.,dy)))));
    glassEdge=smoothstep(.17,.6,glassEdge)*(1.-air*.8);
    vec3 result;
    if(mode<.5){
      // District views are read as silhouettes and large value masses. A wall
      // covered in a handful of fixed-size dots looks like mosaic even if its
      // windows are correctly filtered. Transfer facade tone to a quiet wash
      // continuously by projected metre size, leaving nearby screentone intact.
      float farFacade=facade*smoothstep(.35,1.25,depth/max(projectionScale,1.));
      float wash=smoothstep(.035,.72,density)*.62;
      float facadeTone=mix(screentone(density),wash,farFacade);
      float coverage=max(max(edge,pavingInk),max(facadeTone,max(solid,glassInk)));
      result=mix(paper,ink,coverage);
    }else if(mode<1.5){
      result=mix(paper,ink,max(max(edge,pavingInk),max(leafLine,max(glassEdge,glassInk*.075))));
    }else if(mode<2.5){
      vec3 lit=color*(1.-ao*.48)*(1.-pavingInk*.5);
      float air=(1.-exp(-depth/2500.))*haze;
      lit=mix(lit,vec3(.84,.9,.94),air);
      result=mix(lit,ink,edge*.24);
    }else if(mode<3.5){result=color*(1.-ao*.5);}
    else{result=mix(color,ink,edge*.32);}
    // Alpha is a structural-edge mask for the final AA resolve. It is not
    // transparency: screentone and broad facade washes stay untouched.
    gl_FragColor=vec4(result,clamp(edge,0.,1.));
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
  constructor(renderer,scene,camera,facadeShared={windows:{value:1},provenance:{value:0},facadeDetail:{value:.5},glassReflection:{value:.65}}){
    this.renderer=renderer;this.scene=scene;this.camera=camera;
    this.facadeSource=facadeShared;
    this.facadeUniforms=Object.fromEntries(Object.entries(facadeShared).map(([key,u])=>[key,{value:u.value}]));
    const makeTarget=(filter=THREE.LinearFilter)=>new THREE.WebGLRenderTarget(1,1,{minFilter:filter,magFilter:filter,type:THREE.HalfFloatType,depthBuffer:true});
    this.color=makeTarget();this.light=makeTarget();this.normal=makeTarget(THREE.NearestFilter);this.ids=makeTarget(THREE.NearestFilter);this.ao=makeTarget();this.composite=makeTarget();
    // The renderer's canvas antialias flag does not cover offscreen targets.
    // Resolve subpixel facade ribs before the color buffer reaches post effects.
    this.color.samples=4;
    this.light.samples=4;
    this.normal.samples=4;
    // ID values are discrete labels. Never average IDs with MSAA: mixtures
    // would fabricate building/road identities at an otherwise smooth edge.
    // A neutral reflectance pass separates lighting/cast shadows from glass,
    // asphalt and paint. These dark materials must not all become black ink.
    this.lightMaterial=new THREE.MeshStandardMaterial({color:new THREE.Color(.6,.6,.6),roughness:1,side:THREE.DoubleSide});
    this.lightMaterial.defaultAttributeValues={...this.lightMaterial.defaultAttributeValues,...facadeAttributeDefaults};
    this.lightMaterial.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <shadowmap_pars_fragment>','#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
      installFacadeShader(shader,this.facadeUniforms,true);
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','');
    };
    this.lightMaterial.customProgramCacheKey=()=> 'neutral-light-facade-tone-v3';
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
      ...common,tColor:{value:this.color.texture},tLight:{value:this.light.texture},tId:{value:this.ids.texture},tAO:{value:this.ao.texture},
      resolution:{value:new THREE.Vector2(1,1)},aoResolution:{value:new THREE.Vector2(1,1)},inverseView:{value:this.inverseView},projectionScale:{value:1000},
      ...Object.fromEntries(Object.entries(INK_DEFAULTS).map(([key,value])=>[key,{value}])),mode:{value:0},
      paper:{value:new THREE.Color('#ffffff')},ink:{value:new THREE.Color('#17191b')},
    }});
    this.aoMaterial=new THREE.ShaderMaterial({vertexShader,fragmentShader:aoShader,depthTest:false,depthWrite:false,uniforms:{
      ...common,resolution:{value:new THREE.Vector2(1,1)},projectionScale:{value:1},
    }});
    this.screenGeometry=new THREE.PlaneGeometry(2,2);this.screenMesh=new THREE.Mesh(this.screenGeometry,this.material);
    this.screen=new THREE.Scene();this.screen.add(this.screenMesh);this.screenCamera=new THREE.Camera();
    this.resolveMaterial=new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,vertexShader,
      uniforms:{tDiffuse:{value:this.composite.texture},resolution:{value:new THREE.Vector2(1,1)}},
      fragmentShader:FXAAShader.fragmentShader
      .replace('texture( tex2D, uv )','textureLod( tex2D, uv, 0. )')
      // A single return avoids ANGLE's false uninitialized return warning on
      // the vendor shader's early-return branch; the algorithm is unchanged.
      .replace(/if \( ShouldSkipPixel\( luminance \) \) \{[\s\S]*?\n\s*\}/,'vec4 resolved=Sample(tex2D,uv);\n if (!ShouldSkipPixel(luminance)) {')
      .replace('return Sample( tex2D, uv );\n\n\t\t}\n\n\t\tvoid main()', 'resolved=Sample(tex2D,uv);\n }\n return resolved;\n }\n void main()')
      .replace('gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );',`
        vec4 original=texture2D(tDiffuse,vUv);
        float edge=original.a;
        edge=max(edge,texture2D(tDiffuse,vUv+vec2(resolution.x,0.)).a);
        edge=max(edge,texture2D(tDiffuse,vUv-vec2(resolution.x,0.)).a);
        edge=max(edge,texture2D(tDiffuse,vUv+vec2(0.,resolution.y)).a);
        edge=max(edge,texture2D(tDiffuse,vUv-vec2(0.,resolution.y)).a);
        gl_FragColor=vec4(mix(original.rgb,ApplyFXAA(tDiffuse,resolution,vUv).rgb,smoothstep(.08,.7,edge)),1.);
        #include <colorspace_fragment>
      `),
    });
    this.clayMaterial=new THREE.MeshStandardMaterial({color:'#e5e5df',roughness:1});
    this.clayMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','');};
    this.clayMaterial.customProgramCacheKey=()=> 'neutral-clay-no-instance-color-v1';
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
    for(const target of [this.color,this.light,this.normal,this.ids,this.composite])target.setSize(width,height);
    this.resolveMaterial.uniforms.resolution.value.set(1/width,1/height);
    const aw=Math.max(1,Math.ceil(width/2)),ah=Math.max(1,Math.ceil(height/2));this.ao.setSize(aw,ah);
    this.material.uniforms.resolution.value.set(width,height);this.material.uniforms.aoResolution.value.set(aw,ah);
    this.aoMaterial.uniforms.resolution.value.set(width,height);
  }

  setFacadeShared(shared){this.facadeSource=shared;}

  render(){
    // Use displayed pixels for the illustration LOD: devicePixelRatio must
    // not turn a distant facade back into a dense dot texture on a HiDPI screen.
    const scale=this.color.height*this.camera.projectionMatrix.elements[5]*.5/(this.renderer.getPixelRatio?.()||1);
    if(this.facadeSource.projectionScale)this.facadeSource.projectionScale.value=scale;
    this.material.uniforms.projectionScale.value=scale;
    for(const [key,u] of Object.entries(this.facadeUniforms))u.value=this.facadeSource[key].value;
    const r=this.renderer,s=this.scene,c=this.camera,background=s.background,override=s.overrideMaterial,autoUpdate=r.shadowMap.autoUpdate;
    const clear=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();
    this.prepareScene();c.updateMatrixWorld();this.inverseProjection.copy(c.projectionMatrixInverse);this.inverseView.copy(c.matrixWorld);
    this.material.uniforms.nearPlane.value=c.near;this.material.uniforms.farPlane.value=c.far;
    this.aoMaterial.uniforms.nearPlane.value=c.near;this.aoMaterial.uniforms.farPlane.value=c.far;
    this.aoMaterial.uniforms.projectionScale.value=this.color.height*c.projectionMatrix.elements[5]*.5;
    try{
      s.overrideMaterial=this.material.uniforms.mode.value===3?this.clayMaterial:null;
      r.setRenderTarget(this.color);r.clear();r.render(s,c);
      r.shadowMap.autoUpdate=false;s.background=null;r.setClearColor(0x000000,0);
      if(this.material.uniforms.mode.value===0){s.overrideMaterial=this.lightMaterial;r.setRenderTarget(this.light);r.clear();r.render(s,c);}
      s.overrideMaterial=this.normalMaterial;r.setRenderTarget(this.normal);r.clear();r.render(s,c);
      s.overrideMaterial=this.idMaterial;r.setRenderTarget(this.ids);r.clear();r.render(s,c);
      this.screenMesh.material=this.aoMaterial;r.setRenderTarget(this.ao);r.clear();r.render(this.screen,this.screenCamera);
      this.screenMesh.material=this.material;r.setRenderTarget(this.composite);r.clear();r.render(this.screen,this.screenCamera);
      this.screenMesh.material=this.resolveMaterial;r.setRenderTarget(null);r.render(this.screen,this.screenCamera);
    }finally{
      s.overrideMaterial=override;s.background=background;r.shadowMap.autoUpdate=autoUpdate;r.setClearColor(clear,alpha);r.setRenderTarget(null);this.screenMesh.material=this.material;
    }
  }

  dispose(){
    for(const target of [this.color,this.light,this.normal,this.ids,this.ao,this.composite])target.dispose();
    for(const m of [this.normalMaterial,this.idMaterial,this.material,this.aoMaterial,this.clayMaterial,this.lightMaterial,this.resolveMaterial])m.dispose();
    this.screenGeometry.dispose();
  }
}
