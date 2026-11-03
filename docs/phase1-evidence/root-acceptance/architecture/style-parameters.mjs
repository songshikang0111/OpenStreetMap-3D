import {Scene,PerspectiveCamera} from 'three';
import {createStylePipeline} from '../../../../src/styles/index.js';
const pipeline=createStylePipeline({renderer:{},scene:new Scene(),camera:new PerspectiveCamera(),style:{id:'comic',parameters:{aoStrength:.12}}});
console.log(JSON.stringify({requestedAoStrength:.12,actualStylePipelineAoStrength:pipeline.ink.material.uniforms.aoStrength.value,note:'No WebGL renderer created. SDK applyStyle subsequently overrides this uniform at src/sdk/index.js:79; this second step is source-confirmed only.'}));
pipeline.dispose();
