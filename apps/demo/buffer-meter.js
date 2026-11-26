// Three's WebGLAttributes creates a buffer store with bufferData and updates it with bufferSubData.
// Time only the CPU-side WebGL submissions. GPU timer queries separately measure rendering.
export function measureBufferCreation(gl) {
  const original = gl.bufferData;
  let ms = 0,
    bytes = 0,
    calls = 0;
  gl.bufferData = function (target, data, usage, ...range) {
    const t = performance.now();
    const result = original.call(this, target, data, usage, ...range);
    ms += performance.now() - t;
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
    take() {
      const result = { firstBufferMs: ms, firstBufferBytes: bytes, firstBufferCalls: calls };
      ms = bytes = calls = 0;
      return result;
    },
    dispose() {
      gl.bufferData = original;
    },
  };
}
