import * as THREE from 'three';

const vertexShader = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

const fragmentShader = `
varying vec2 vUv;
uniform sampler2D tColor,tNormal,tDepth,tId;
uniform vec2 resolution;
uniform float nearPlane,farPlane,lineWidth,toneSize,inkDensity,blackPoint,mode;
uniform vec3 paper,ink;
float depthAt(vec2 uv){float d=texture2D(tDepth,uv).r;return nearPlane*farPlane/(farPlane-d*(farPlane-nearPlane));}
vec3 normalAt(vec2 uv){return texture2D(tNormal,uv).xyz*2.-1.;}
float boundary(vec2 offset,float centerDepth,vec3 centerNormal,vec3 centerId){
  vec2 p=vUv+offset/resolution;
  float otherDepth=depthAt(p);
  float difference=abs(otherDepth-centerDepth);
  float silhouette=smoothstep(max(.5,centerDepth*.008),max(1.,centerDepth*.025),difference);
  float crease=smoothstep(.15,.55,1.-dot(centerNormal,normalAt(p)));
  float separate=step(.002,length(texture2D(tId,p).rgb-centerId));
  float inFront=step(centerDepth,otherDepth+.2);
  return max(silhouette*inFront,max(crease*.9,separate*.95));
}
float screentone(float density){
  vec2 pixel=gl_FragCoord.xy/max(toneSize,1.5);
  vec2 grid=mat2(.866,-.5,.5,.866)*pixel;
  float radius=sqrt(clamp(density,0.,.78)/3.14159265);
  float distanceToCenter=length(fract(grid)-.5);
  float aa=max(fwidth(distanceToCenter)*.65,.025);
  return 1.-smoothstep(radius-aa,radius+aa,distanceToCenter);
}
void main(){
  float rawDepth=texture2D(tDepth,vUv).r;
  if(rawDepth>.999999){gl_FragColor=vec4(paper,1.);}
  else{
    vec3 color=texture2D(tColor,vUv).rgb;
    vec3 normal=normalAt(vUv),id=texture2D(tId,vUv).rgb;
    float depth=depthAt(vUv),edge=0.;
    vec2 directions[4];directions[0]=vec2(1.,0.);directions[1]=vec2(0.,1.);directions[2]=vec2(.707,.707);directions[3]=vec2(-.707,.707);
    for(int i=0;i<4;i++){
      edge=max(edge,boundary(directions[i]*lineWidth,depth,normal,id));
      edge=max(edge,boundary(-directions[i]*lineWidth,depth,normal,id));
    }
    float lum=dot(color,vec3(.2126,.7152,.0722));
    float darkness=1.-smoothstep(.09,.75,lum);
    float farFade=mix(1.,.48,smoothstep(650.,2200.,depth));
    float density=clamp(darkness*.34*inkDensity,0.,.65)*farFade;
    float building=step(.001,length(id))* (1.-step(.04,id.g));
    float windowMask=texture2D(tColor,vUv).a*building;
    float solid=(1.-smoothstep(blackPoint-.018,blackPoint+.018,lum))*(1.-building);
    float windowInk=smoothstep(.38,.72,windowMask)*.98;
    float dots=screentone(density);
    vec3 result;
    if(mode<.5){float coverage=max(edge,max(max(dots,solid*.98),windowInk));result=mix(paper,ink,coverage);}
    else if(mode<1.5){
      float adjacent=texture2D(tColor,vUv+vec2(1.,0.)/resolution).a;
      float adjacentY=texture2D(tColor,vUv+vec2(0.,1.)/resolution).a;
      float windowLine=smoothstep(.12,.7,max(abs(windowMask-adjacent),abs(windowMask-adjacentY)))*building;
      result=mix(paper,ink,max(edge,max(windowLine*.95,windowInk*.2)));
    }
    else if(mode<2.5){result=mix(color,ink,edge*.42);}
    else if(mode<3.5){result=color;}
    else{result=mix(color,ink,edge*.4);}
    gl_FragColor=vec4(result,1.);
  }
  #include <colorspace_fragment>
}`;

export class InkRenderer {
  constructor(renderer,scene,camera){
    this.renderer=renderer;this.scene=scene;this.camera=camera;
    const makeTarget=()=>new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,type:THREE.HalfFloatType});
    this.color=makeTarget();this.normal=makeTarget();this.ids=makeTarget();
    this.normal.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.normalMaterial=new THREE.MeshNormalMaterial();
    this.idMaterial=new THREE.ShaderMaterial({
      vertexShader:`attribute vec3 objectId; varying vec3 vId;
      void main(){vec4 p=vec4(position,1.);vId=objectId;
      #ifdef USE_INSTANCING
      p=instanceMatrix*p;
      vId=fract(abs(instanceMatrix[3].xyz)*vec3(.037,.11,.017));
      #endif
      gl_Position=projectionMatrix*modelViewMatrix*p;}`,
      fragmentShader:`varying vec3 vId;void main(){gl_FragColor=vec4(vId,1.);}`,
      defaultAttributeValues:{color:[1,1,1],uv:[0,0],objectId:[0,0,0]},
    });
    this.material=new THREE.ShaderMaterial({vertexShader,fragmentShader,depthTest:false,depthWrite:false,uniforms:{
      tColor:{value:this.color.texture},tNormal:{value:this.normal.texture},tDepth:{value:this.normal.depthTexture},tId:{value:this.ids.texture},
      resolution:{value:new THREE.Vector2(1,1)},nearPlane:{value:camera.near},farPlane:{value:camera.far},
      lineWidth:{value:1.05},toneSize:{value:4.2},inkDensity:{value:.85},blackPoint:{value:.095},mode:{value:0},
      paper:{value:new THREE.Color('#f7f5ed')},ink:{value:new THREE.Color('#242a2b')},
    }});
    this.screen=new THREE.Scene();this.screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));
    this.screenCamera=new THREE.Camera();
    this.clayMaterial=new THREE.MeshStandardMaterial({color:'#dddcd5',roughness:1});
  }
  resize(width,height){
    for(const target of [this.color,this.normal,this.ids])target.setSize(width,height);
    this.material.uniforms.resolution.value.set(width,height);
  }
  render(){
    const r=this.renderer,s=this.scene,background=s.background,autoUpdate=r.shadowMap.autoUpdate;
    s.overrideMaterial=this.material.uniforms.mode.value===3?this.clayMaterial:null;
    r.setRenderTarget(this.color);r.clear();r.render(s,this.camera);
    r.shadowMap.autoUpdate=false;s.background=null;
    s.overrideMaterial=this.normalMaterial;r.setRenderTarget(this.normal);r.setClearColor(0x000000,0);r.clear();r.render(s,this.camera);
    s.overrideMaterial=this.idMaterial;r.setRenderTarget(this.ids);r.clear();r.render(s,this.camera);
    s.overrideMaterial=null;s.background=background;r.shadowMap.autoUpdate=autoUpdate;
    r.setRenderTarget(null);r.render(this.screen,this.screenCamera);
  }
  dispose(){for(const target of [this.color,this.normal,this.ids])target.dispose();for(const m of [this.normalMaterial,this.idMaterial,this.material,this.clayMaterial])m.dispose();}
}
