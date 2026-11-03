// A/C are developed in isolated worktrees. E replaces this loader with static
// imports when bundling the integrated package. An embedder may inject the same
// frozen APIs via adapters without relying on a local studio service.
export async function loadDefaultAdapters() {
  const codec = new URL('../core/scene-codec.js', import.meta.url).href;
  const styles = new URL('../styles/index.js', import.meta.url).href;
  try {
    const [core, styleApi] = await Promise.all([import(/* @vite-ignore */ codec), import(/* @vite-ignore */ styles)]);
    return { decodeChunk: core.decodeChunk, styleApi };
  } catch (cause) {
    throw Object.assign(new Error('Scene codec / style modules are unavailable. Integrate phase-one A/C modules or provide adapters: {decodeChunk, styleApi}.', { cause }), { code: 'RUNTIME_ADAPTER_UNAVAILABLE', stage: 'initialize' });
  }
}
