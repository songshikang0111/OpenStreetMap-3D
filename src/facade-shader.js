// Two independent illustration signals, using existing render targets:
// color.a = resolved architectural ink; light.a = unresolved material coverage.
// The latter is consumed only on procedural facades, never as a cast shadow.
export function installFacadeShader(shader, shared, lightOnly = false) {
  Object.assign(shader.uniforms, {
    uWindows: shared.windows, uProvenance: shared.provenance,
    uFacadeDetail: shared.facadeDetail, uGlassReflection: shared.glassReflection,
    uFacadeToneSize: shared.toneSize || {value:4.2},
  });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec4 aFacade; varying vec4 vFacade;
      attribute vec2 aStyle; varying vec2 vStyle;
      attribute vec4 aLayout; varying vec4 vLayout;
      attribute vec2 aSurface; varying vec2 vSurface;
      varying vec3 vGlassWorld; varying vec3 vGlassNormal;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vFacade=aFacade; vStyle=aStyle; vLayout=aLayout;vSurface=aSurface;
      vGlassWorld=(modelMatrix*vec4(position,1.)).xyz;
      vGlassNormal=normalize(mat3(modelMatrix)*normal);`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    varying vec4 vFacade; varying vec2 vStyle; varying vec4 vLayout; varying vec2 vSurface;
    varying vec3 vGlassWorld; varying vec3 vGlassNormal;
    uniform float uWindows,uProvenance,uFacadeDetail,uGlassReflection,uFacadeToneSize;
    float inkWindow=0.,inkTone=0.;
    float glassCoverage=0.;vec3 glassEnvironment=vec3(0.);
    // Exact box integration, including footprints spanning multiple periods.
    float stripeIntegral(float p,float width){return floor(p)*2.*width+clamp(fract(p)-(.5-width),0.,2.*width);}
    float stripe(float p,float width){float w=max(fwidth(p),.001);return clamp((stripeIntegral(p+w*.5,width)-stripeIntegral(p-w*.5,width))/w,0.,1.);}
    float finishIs(float code){return 1.-step(.2,abs(vSurface.x-code));}
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
      float paneWidth=mix(mix(.30,.485,isGlass),vLayout.y,hasLayout);
      float paneHeight=mix(mix(.30,.48,isGlass),vLayout.z,hasLayout);
      float splitU=(1.-step(.2,abs(vLayout.w-2.)))*hasLayout;
      float splitV=(1.-step(.2,abs(vLayout.w-3.)))*hasLayout;
      float mullion=mix(.018,.008,isGlass);
      float meanU=2.*paneWidth-2.*mullion*splitU,meanV=2.*paneHeight-.036*splitV;
      float footprintU=fwidth(u),footprintV=fwidth(v);
      // Each axis resolves independently: a grazing wall may lose its columns
      // while its horizontal floor bands remain several pixels high.
      float fineStart=mix(.12,.22,uFacadeDetail),fineEnd=mix(.36,.60,uFacadeDetail);
      float keepU=1.-smoothstep(fineStart,fineEnd,footprintU);
      float keepV=1.-smoothstep(fineStart,fineEnd,footprintV);
      float horizontalPane=mix(meanU,max(0.,stripe(u,paneWidth)-stripe(u,mullion)*splitU),keepU);
      float verticalPane=mix(meanV,max(0.,stripe(v,paneHeight)-stripe(v-.16,.018)*splitV),keepV);
      float mask=horizontalPane*verticalPane;
      float resolved=max(keepU,keepV);
      // A window can resolve in the color buffer and still be smaller than a
      // halftone cell. Never modulate dot density with that fine pane mask:
      // its multiplication by the screen's dot lattice creates moving moire.
      // Each axis transfers to its exact area mean before two tone cells.
      float toneStart=1./(max(uFacadeToneSize,1.7)*4.);
      float toneEnd=1./(max(uFacadeToneSize,1.7)*2.);
      float toneKeepU=1.-smoothstep(toneStart,toneEnd,footprintU);
      float toneKeepV=1.-smoothstep(toneStart,toneEnd,footprintV);
      float toneMask=mix(meanU,horizontalPane,toneKeepU)*mix(meanV,verticalPane,toneKeepV);
      // A stable bay-group rhythm is shared by the near and distant material.
      // It describes broad glazing strips, not a new camera-dependent texture.
      float group=mix(6.,8.,step(2.5,vLayout.w));
      float groupPane=mix(stripe(u/group,.38),stripe(v/3.,.35),ribbon);
      // Tone dots are larger than a pixel. A band at the dot-grid frequency
      // creates beating even when the band itself is correctly antialiased.
      // Hand it to the per-face mean before it drops below ~2 tone cells.
      float groupFootprint=mix(fwidth(u/group),fwidth(v/3.),ribbon);
      float macroKeep=1.-smoothstep(1./(max(uFacadeToneSize,1.7)*4.),1./(max(uFacadeToneSize,1.7)*2.),groupFootprint);
      float groupedGlass=mix(.24,1.,mix(mix(.76,.70,ribbon),groupPane,macroKeep));
      vec3 incident=normalize(vGlassWorld-cameraPosition),wallNormal=normalize(vGlassNormal);
      vec3 reflected=reflect(incident,wallNormal);
      // Analytic environment, not a photograph or a reflection of nearby OSM
      // buildings: bright sky, dark horizon masses, broad directional light.
      // Only reflected direction controls its image, so camera orbit changes
      // it continuously and opposite faces can carry different tonal masses.
      float azimuth=atan(reflected.z,reflected.x);
      float skyline=.055+.075*sin(azimuth*5.+.7)+.035*sin(azimuth*11.-.4);
      float sky=smoothstep(skyline-.08,skyline+.23,reflected.y);
      float cloud=.5+.5*sin(reflected.x*3.2+reflected.z*2.1+reflected.y*4.8);
      float lightSector=.5+.5*dot(normalize(reflected.xz+vec2(.0001)),normalize(vec2(-.72,.69)));
      float fresnel=pow(1.-clamp(dot(-incident,wallNormal),0.,1.),3.);
      float environment=clamp(.09+sky*.48+lightSector*.30+cloud*.08+fresnel*.12,0.,1.);
      float reflection=mix(.28,environment,clamp(uGlassReflection,0.,1.));
      float glassShade=clamp(1.-reflection+(vStyle.y-.5)*.10,0.,1.);
      float opacity=.91;
      // Map broad material reflectance BEFORE multiplying filtered coverage.
      // Thresholding an already filtered pane amplifies near-Nyquist weaving.
      float materialInk=smoothstep(.32,.82,opacity)*mix(1.,groupedGlass,ribbon);
      float detail=resolved;
      float windowInk=mask*materialInk;
      // Continuous glass is read as a broad reflection first. Light panes use
      // manga tone while the darkest reflected masses become black; thin
      // mullions remain paper. Ordinary windows retain their punched darks.
      float glassBlack=smoothstep(.67,.84,glassShade);
      float glassTone=smoothstep(.10,.88,glassShade)*.78;
      float brightMullions=(1.-mask)*smoothstep(.28,.62,reflection)*.58;
      inkWindow=mix(windowInk,max(mask*glassBlack,brightMullions),isGlass)*detail;
      // Preserve average glass area and broad reflection once panes disappear.
      // The material signal is separate from lighting/AO, so white wall and
      // glazed curtain wall cannot collapse to the same neutral shade.
      inkTone=mix(meanU*meanV*materialInk*(1.-detail)*.72,toneMask*glassTone,isGlass);
      // Wall finishes use metre-scale joints and broad articulation, never a
      // screen-space random texture. Tiny joints fade before a tone-cell beat.
      float stone=finishIs(2.),brick=finishIs(3.),precast=finishIs(4.),piers=finishIs(5.),tile=finishIs(6.);
      float unit=mix(.9,.32,brick)*vSurface.y;
      vec2 masonry=vec2(vFacade.x/(unit*2.),vFacade.y/unit);
      masonry.x+=mod(floor(masonry.y),2.)*.5*max(brick,stone);
      float joint=max(stripe(masonry.x+.5,.013),stripe(masonry.y+.5,.018));
      float jointKeep=1.-smoothstep(.10,.34,max(fwidth(masonry.x),fwidth(masonry.y)));
      float panelJoint=max(stripe(u/2.+.5,.016),stripe(v+.5,.025));
      float panelKeep=1.-smoothstep(.16,.48,max(fwidth(u/2.),fwidth(v)));
      float piersMask=stripe(u/3.+.5,.075),pierKeep=1.-smoothstep(.09,.28,fwidth(u/3.));
      float frameMask=max(0.,stripe(u,min(.49,paneWidth+.045))*stripe(v,min(.49,paneHeight+.045))-mask);
      float wallMask=(1.-mask)*(1.-isGlass);
      float finishInk=wallMask*(joint*jointKeep*(stone*.18+brick*.30+tile*.15)+panelJoint*panelKeep*precast*.28+piersMask*pierKeep*piers*.22);
      finishInk+=frameMask*detail*(stone*.20+precast*.28)*(1.-isGlass);
      inkWindow=max(inkWindow,finishInk);
      float wallTone=(1.-toneMask)*(1.-isGlass)*(brick*.14+stone*.045+precast*.035+tile*.08+piers*.03);
      inkTone=1.-(1.-inkTone)*(1.-wallTone);
      float d1=vFacade.x/14.+vFacade.y/20.,d2=vFacade.x/14.-vFacade.y/20.;
      float diagonalFade=1.-smoothstep(.22,.85,max(fwidth(d1),fwidth(d2)));
      float diagonals=max(stripe(d1,.035),stripe(d2,.035))*diagonalFade*diagrid;
      inkWindow=max(inkWindow*mix(1.,.65,diagrid),diagonals*.94);
      ${lightOnly ? '' : `
      float cell=fract(sin(dot(floor(vec2(u,v)),vec2(17.21,59.17)))*12345.31);
      vec3 glass=mix(vec3(.17,.24,.28),vec3(.31,.39,.44),cell*.06*resolved+vStyle.y*.4);
      glass=mix(glass,vec3(.21,.31,.37),zun*.55);
      glassEnvironment=mix(vec3(.085,.13,.16),vec3(.77,.85,.87),reflection);
      glassEnvironment=mix(glassEnvironment,vec3(.79,.86,.88),fresnel*.28);
      glass=mix(glass,glassEnvironment,isGlass);
      glass=mix(glass,vec3(.63,.67,.68),(1.-mix(.24,1.,mix(.70,groupPane,macroKeep)))*ribbon);
      diffuseColor.rgb=mix(diffuseColor.rgb,glass,mask*mix(.9,1.,isGlass));
      diffuseColor.rgb*=1.-finishInk*.65;
      glassCoverage=mask*isGlass;
      diffuseColor.rgb*=1.-stripe(v+.47,.025)*mix(.12,.26,ribbon)*keepV;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.49,.55,.57),diagonals*.85);`}
    }
  `);
  if(!lightOnly){
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.22,glassCoverage);')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,.18,glassCoverage);');
  }
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `${lightOnly?'':`outgoingLight=mix(outgoingLight,glassEnvironment,glassCoverage*.48*clamp(uGlassReflection,0.,1.));`}
    #include <opaque_fragment>
    gl_FragColor.a=${lightOnly ? '(abs(vFacadeClass-1.25)<.1 ? inkTone : 1.-getShadowMask())' : 'inkWindow'};`);
  if(lightOnly){
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float inkClass; varying float vFacadeClass;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFacadeClass=inkClass;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vFacadeClass;');
  }
}

export const facadeAttributeDefaults = { aFacade:[0,0,0,0],aStyle:[0,0],aLayout:[0,0,0,0],aSurface:[0,1],inkClass:[4] };
