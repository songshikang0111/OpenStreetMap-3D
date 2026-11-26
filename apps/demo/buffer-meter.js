// Three's WebGLAttributes creates a buffer store with bufferData and updates it with bufferSubData.
// Time only the CPU-side WebGL submissions. GPU timer queries separately measure rendering.
export function measureBufferCreation(gl) {
  const original = gl.bufferData;
  let ms = 0,
    bytes = 0,
    calls = 0;
  const samples = [];
  gl.bufferData = function (target, data, usage, ...range) {
    const t = performance.now();
    const result = original.call(this, target, data, usage, ...range);
    const end = performance.now();
    const duration = end - t;
    ms += duration;
    samples.push([end, duration]);
    calls++;
    const stride = data?.BYTES_PER_ELEMENT ?? 1;
    bytes +=
      typeof data === 'number'
        ? data
        : range[1]
          ? range[1] * stride
          : (data?.byteLength ?? 0) - (range[0] ?? 0) * stride;
    return result;
  };
  return {
    take(uploadEnd = 0) {
      const insideSliceMs = samples.reduce((n, [end, duration]) => n + (end <= uploadEnd ? duration : 0), 0);
      const result = { firstBufferMs: ms, firstBufferBytes: bytes, firstBufferCalls: calls, insideSliceMs };
      samples.length = 0;
      ms = bytes = calls = 0;
      return result;
    },
    dispose() {
      gl.bufferData = original;
    },
  };
}
