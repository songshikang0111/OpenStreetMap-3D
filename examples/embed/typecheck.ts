// Compile-only consumer: the SDK accepts A/C public adapters without casts.
import { createCityViewer, type ViewerOptions } from '../../src/sdk/index.js';
import { decodeChunk } from '../../src/core/scene-codec.js';
import * as styleApi from '../../src/styles/index.js';
const options: ViewerOptions = {
  container: document.createElement('div'), manifestUrl: './scene/manifest.json',
  quality: 'balanced', adapters: { decodeChunk, styleApi },
};
async function consume() {
  const viewer = await createCityViewer(options);
  viewer.setView({ position: [100, 50, 150], target: [0, 10, 0], fov: 45 });
  await viewer.setStyle({ id: 'comic', parameters: { windows: 1 } });
  await viewer.exportPNG({ width: 1280, height: 720 });
  await viewer.exportGLB({ scope: 'complete' });
  await viewer.dispose();
}
void consume;
