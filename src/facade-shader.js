// Two independent illustration signals, using existing render targets:
// color.a = resolved architectural ink; light.a = unresolved material coverage.
// The latter is consumed only on procedural facades, never as a cast shadow.
export function installFacadeShader(shader, shared, lightOnly = false) {
  Object.assign(shader.uniforms, {
    uWindows: shared.windows, uProvenance: shared.provenance,
    uFacadeDetail: shared.facadeDetail, uGlassReflection: shared.glassReflection,
  });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec4 aFacade; varying vec4 vFacade;
      attribute vec2 aStyle; varying vec2 vStyle;
      attribute vec4 aLayout; varying vec4 vLayout;
      varying vec3 vGlassWorld; varying vec3 vGlassNormal;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vFacade=aFacade; vStyle=aStyle; vLayout=aLayout;
      vGlassWorld=(modelMatrix*vec4(position,1.)).xyz;
      vGlassNormal=normalize(mat3(modelMatrix)*normal);`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    varying vec4 vFacade; varying vec2 vStyle; varying vec4 vLayout;
    varying vec3 vGlassWorld; varying vec3 vGlassNormal;
    uniform float uWindows,uProvenance,uFacadeDetail,uGlassReflection;
    float inkWindow=0.,inkTone=0.;
    // Exact box integration, including footprints spanning multiple periods.
    float stripeIntegral(float p,float width){return floor(p)*2.*width+clamp(fract(p)-(.5-width),0.,2.*width);}
    float stripe(float p,float width){float w=max(fwidth(p),.001);return clamp((stripeIntegral(p+w*.5,width)-stripeIntegral(p-w*.5,width))/w,0.,1.);}
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    if(vFacade.z>.5 && uWindows>.5 && uProvenance<.5){
      float family=vStyle.x;
      float curtain=1.-step(.2,abs(family-1.)),ribbon=1.-step(.2,abs(family-3.));
      float diagrid=1.-step(.2,abs(family-5.)),zun=1.-step(.2,abs(family-6.));
      float isGlass=max(curtain,max(diagrid,zun));
      float hasLayout=step(.5,vLayout.w);
      float bays=mix(max(1.,floor(vFacade.z/mix(3.5,2.4,isGlass))),vLayout.x,hasLayout);
      float u=vFacade.x/vFacade.z*bays,v=vFacade.y/max(2.8,vFacade.w);
      float paneWidth=mix(mix(.30,.46,isGlass),vLayout.y,hasLayout);
      float paneHeight=mix(mix(.30,.44,isGlass),vLayout.z,hasLayout);
      float splitU=(1.-step(.2,abs(vLayout.w-2.)))*hasLayout;
      float splitV=(1.-step(.2,abs(vLayout.w-3.)))*hasLayout;
      float meanU=2.*paneWidth-.036*splitU,meanV=2.*paneHeight-.036*splitV;
      float footprintU=fwidth(u),footprintV=fwidth(v);
      // Each axis resolves independently: a grazing wall may lose its columns
      // while its horizontal floor bands remain several pixels high.
      float fineStart=mix(.12,.22,uFacadeDetail),fineEnd=mix(.36,.60,uFacadeDetail);
      float keepU=1.-smoothstep(fineStart,fineEnd,footprintU);
      float keepV=1.-smoothstep(fineStart,fineEnd,footprintV);
      float horizontalPane=mix(meanU,max(0.,stripe(u,paneWidth)-stripe(u,.018)*splitU),keepU);
      float verticalPane=mix(meanV,max(0.,stripe(v,paneHeight)-stripe(v-.16,.018)*splitV),keepV);
      float mask=horizontalPane*verticalPane;
      float resolved=max(keepU,keepV);
      // A stable bay-group rhythm is shared by the near and distant material.
      // It describes broad glazing strips, not a new camera-dependent texture.
      float group=mix(6.,8.,step(2.5,vLayout.w));
      float groupPane=mix(stripe(u/group,.38),stripe(v/3.,.35),ribbon);
      float groupedGlass=mix(.24,1.,groupPane);
      vec3 reflected=reflect(normalize(vGlassWorld-cameraPosition),normalize(vGlassNormal));
      float sky=smoothstep(-.16,.65,reflected.y);
      float cloud=.5+.5*sin(reflected.x*5.+reflected.z*3.+reflected.y*8.+vStyle.y*2.);
      float reflection=smoothstep(.14,.9,sky*.70+cloud*.30)*clamp(uGlassReflection,0.,1.);
      float glassDark=mix(.92,.36,reflection)*mix(.60,1.20,vStyle.y);
      float opacity=mix(.91,glassDark,isGlass);
      // Map broad material reflectance BEFORE multiplying filtered coverage.
      // Thresholding an already filtered pane amplifies near-Nyquist weaving.
      float materialInk=smoothstep(.32,.82,opacity)*mix(1.,groupedGlass,max(isGlass,ribbon));
      float detail=resolved;
      float windowInk=mask*materialInk;
      inkWindow=windowInk*detail;
      // Preserve average glass area and broad reflection once panes disappear.
      // The material signal is separate from lighting/AO, so white wall and
      // glazed curtain wall cannot collapse to the same neutral shade.
      inkTone=meanU*meanV*materialInk*(1.-detail)*mix(.72,1.,isGlass);
      float d1=vFacade.x/14.+vFacade.y/20.,d2=vFacade.x/14.-vFacade.y/20.;
      float diagonalFade=1.-smoothstep(.22,.85,max(fwidth(d1),fwidth(d2)));
      float diagonals=max(stripe(d1,.035),stripe(d2,.035))*diagonalFade*diagrid;
      inkWindow=max(inkWindow*mix(1.,.65,diagrid),diagonals*.94);
      ${lightOnly ? '' : `
      float cell=fract(sin(dot(floor(vec2(u,v)),vec2(17.21,59.17)))*12345.31);
      vec3 glass=mix(vec3(.17,.24,.28),vec3(.31,.39,.44),cell*.06*resolved+vStyle.y*.4);
      glass=mix(glass,vec3(.21,.31,.37),zun*.55);
      glass=mix(glass,vec3(.55,.65,.70),reflection*isGlass*.70);
      glass=mix(glass,vec3(.63,.67,.68),(1.-groupedGlass)*max(isGlass,ribbon));
      diffuseColor.rgb=mix(diffuseColor.rgb,glass,mask*.9);
      diffuseColor.rgb*=1.-stripe(v+.47,.025)*mix(.12,.26,ribbon)*keepV;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.49,.55,.57),diagonals*.85);`}
    }
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
    gl_FragColor.a=${lightOnly ? '(abs(vFacadeClass-1.25)<.1 ? inkTone : 1.-getShadowMask())' : 'inkWindow'};`);
  if(lightOnly){
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float inkClass; varying float vFacadeClass;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFacadeClass=inkClass;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vFacadeClass;');
  }
}

export const facadeAttributeDefaults = { aFacade:[0,0,0,0],aStyle:[0,0],aLayout:[0,0,0,0],inkClass:[4] };
