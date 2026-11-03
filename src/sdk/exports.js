import { Group, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ResourceRegistry } from '../runtime/resources.js';
import { runtimeError } from '../runtime/manifest.js';

const check = ctx => { if (ctx.isDisposed()) throw runtimeError('VIEWER_DISPOSED', 'export', 'Viewer is disposed.'); if (!ctx.manifest) throw runtimeError('NO_SCENE', 'export', 'Load a scene before exporting.'); };
function attributionText(manifest) {
  const value = manifest.attribution;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(x => typeof x === 'string' ? x : x.text || x.attribution || x.name).filter(Boolean).join(' · ');
  if (value?.text) return value.text;
  return (manifest.sources || []).map(x => x.attribution).filter(Boolean).join(' · ') || '© OpenStreetMap contributors · openstreetmap.org/copyright';
}

/** Captures the current camera and loaded LODs, with an attribution footer. */
export async function exportViewerPNG(ctx, { width = ctx.width, height = ctx.height, maxPixels = 16000000 } = {}) {
  check(ctx);
  if (![width, height].every(x => Number.isInteger(x) && x > 0) || width * height > Math.min(maxPixels, 16000000)) throw runtimeError('EXPORT_PIXEL_BUDGET', 'export', 'PNG dimensions exceed the 16 megapixel export budget.');
  const previous = { width: ctx.width, height: ctx.height, ratio: ctx.renderer.getPixelRatio(), paused: ctx.paused };
  ctx.paused = true;
  try {
    ctx.renderer.setPixelRatio(1); ctx.resize(width, height); ctx.render();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const drawing = canvas.getContext('2d'); drawing.drawImage(ctx.renderer.domElement, 0, 0);
    const credit = attributionText(ctx.manifest), font = Math.max(11, Math.round(width / 130));
    drawing.font = `${font}px sans-serif`;
    const text = drawing.measureText(credit).width;
    drawing.fillStyle = 'rgba(255,255,255,.95)'; drawing.fillRect(0, height - font - 18, width, font + 18);
    drawing.fillStyle = '#28352f'; drawing.fillText(credit, Math.max(7, width - text - 10), height - 9, width - 14);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(runtimeError('PNG_ENCODING_FAILED', 'export', 'Browser could not encode PNG.')), 'image/png'));
    return { blob, scope: 'current-view-loaded-lods', width, height, attribution: credit, loadedChunkIds: [...ctx.streamer.current.keys()] };
  } finally { if (!ctx.isDisposed()) { ctx.renderer.setPixelRatio(previous.ratio); ctx.resize(previous.width, previous.height); ctx.paused = previous.paused; } }
}

function portableClone(group, ownedMaterials) {
  const clone = group.clone(true), instances = [];
  clone.traverse(o => {
    if (o.isInstancedMesh) instances.push(o);
    if (o.material) {
      const convert = material => {
        const fallback = new MeshStandardMaterial({ color: material.color?.clone() || 0xaaaaaa, roughness: material.roughness ?? .8, metalness: material.metalness ?? 0, opacity: material.opacity ?? 1, transparent: !!material.transparent, vertexColors: !!material.vertexColors, side: material.side });
        ownedMaterials.add(fallback); return fallback;
      };
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    }
  });
  for (const inst of instances) {
    const replacement = new Group(); replacement.name = inst.name; replacement.matrix.copy(inst.matrix); replacement.matrixAutoUpdate = false; replacement.userData = { ...inst.userData };
    for (let i = 0; i < inst.count; i++) {
      const mesh = new Mesh(inst.geometry, inst.material); inst.getMatrixAt(i, mesh.matrix); mesh.matrixAutoUpdate = false;
      mesh.userData = { city: inst.userData.cityInstances?.[i] || inst.userData.city || {} }; replacement.add(mesh);
    }
    inst.parent.add(replacement); inst.removeFromParent();
  }
  return clone;
}

/** scope is mandatory so unloaded chunks can never be silently omitted. */
export async function exportViewerGLB(ctx, { scope, lod = 0, signal, maxBytes = ctx.budget.residentBytes } = {}) {
  check(ctx);
  if (!['loaded', 'complete'].includes(scope)) throw runtimeError('EXPORT_SCOPE_REQUIRED', 'export', 'Specify GLB scope: "loaded" for current loaded LODs, or "complete" for every manifest chunk.');
  const group = new Group(), registry = new ResourceRegistry(), retained = [], materials = new Set(), bindings = [];
  const chunkIds = [], limitations = 'Standard colors and geometry only. Procedural windows, glass shaders, ink and postprocessing are not portable GLB effects.';
  const aborted = () => { check(ctx); if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError'); };
  try {
    if (scope === 'complete') {
      if (!Number.isInteger(lod) || lod < 0) throw new TypeError('GLB lod must be a nonnegative integer index.');
      const estimates = ctx.manifest.chunks.map(chunk => chunk.lods[Math.min(lod, chunk.lods.length - 1)]);
      const estimated = estimates.reduce((sum, item) => sum + (item.residentBytes ?? item.bytes), 0);
      if (estimated > maxBytes) throw runtimeError('EXPORT_RESOURCE_BUDGET', 'export', `Complete GLB needs an estimated ${estimated} bytes; export budget is ${maxBytes}. No partial file was produced.`);
      for (let i = 0; i < ctx.manifest.chunks.length; i++) {
        aborted(); const chunk = ctx.manifest.chunks[i], descriptor = estimates[i];
        let payload;
        try { payload = await ctx.readAsset(descriptor.url, { signal, responseType: 'arrayBuffer' }); }
        catch (cause) { throw runtimeError('EXPORT_ASSET_FAILED', 'export', `Unable to read ${descriptor.url}: ${cause.message}`, { url: descriptor.url, tileId: chunk.id }); }
        const decoded = await ctx.decodeChunk(payload, { ...descriptor, chunk, signal });
        decoded.matrix.copy(chunk.matrix); decoded.matrixAutoUpdate = false;
        const original = registry.retain(decoded);
        try { bindings.push(await ctx.bindGroup(decoded)); }
        finally { retained.push(registry.retain(decoded)); registry.release(original); }
        aborted(); group.add(portableClone(decoded, materials)); chunkIds.push(chunk.id);
      }
    } else {
      // A clone shares geometry; no mutation or disposal of live scene assets.
      for (const [id, entry] of ctx.streamer.current) { group.add(portableClone(entry.group, materials)); chunkIds.push(id); }
    }
    aborted();
    group.userData = { attribution: attributionText(ctx.manifest), license: 'See source manifest', scope, chunkIds, limitations, origin: ctx.manifest.origin, coordinateSystem: ctx.manifest.coordinateSystem };
    group.updateMatrixWorld(true);
    const buffer = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: false });
    return { blob: new Blob([buffer], { type: 'model/gltf-binary' }), scope, chunkIds, limitations, attribution: attributionText(ctx.manifest) };
  } finally { for (const binding of bindings) binding?.dispose?.(); for (const resources of retained) registry.release(resources); for (const material of materials) material.dispose(); group.clear(); }
}
