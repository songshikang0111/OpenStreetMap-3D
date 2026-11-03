import { createCityViewer } from '../../src/sdk/index.js';
import { decodeFixture } from './fixture-codec.js';
import { fixtureStyleApi } from './fixture-style.js';

const query = new URLSearchParams(location.search), status = document.querySelector('#status');
const fixture = query.get('fixture') || 'core-beijing-cbd-grow-4';
const diagnostics = []; globalThis.diagnostics = diagnostics;
async function start() {
globalThis.viewer = await createCityViewer({
  container: document.querySelector('#city'), manifestUrl: query.get('manifest') || `/work/runtime-fixtures/${fixture}/manifest.json`,
  style: query.get('style') || 'comic', quality: 'balanced',
  budget: { residentBytes: 96 * 1024 * 1024, visibleTriangles: 900000, drawCalls: 1500, concurrentLoads: 3, pixelRatio: 1, nearDetails: 18000, minResidenceMs: 700, unloadDelayMs: 350 },
  ...(query.get('adapter') === 'fixture' || !query.has('manifest') && !fixture.startsWith('core-') ? { adapters: { decodeChunk: decodeFixture, styleApi: fixtureStyleApi } } : {}),
  onProgress(progress) { if (progress.stage === 'stream') status.textContent = `${progress.loaded} resident · ${progress.pending} loading`; },
  onDiagnostic(diagnostic) { diagnostics.push(diagnostic); console.warn(diagnostic); },
  onSelect(feature) { globalThis.lastSelection = feature; status.textContent = feature?.featureId || 'No selection'; },
});
function save(result, filename) { const url = URL.createObjectURL(result.blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
document.querySelector('#style').onchange = event => viewer.setStyle(event.target.value);
document.querySelector('#png').onclick = async () => save(await viewer.exportPNG(), 'city-ink.png');
document.querySelector('#glb').onclick = async () => save(await viewer.exportGLB({ scope: 'complete' }), 'city-ink-complete.glb');
}
start().catch(error => { globalThis.startError = error.message; status.textContent = error.message; console.error(error); });
