export interface GpuTimeSnapshot {
  available: boolean;
  reason: string | null;
  samples: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  rawSamples?: { time: number | null; ms: number }[];
}
export class GpuFrameTimer {
  constructor(
    gl: WebGL2RenderingContext | WebGLRenderingContext,
    options?: { maxPending?: number; maxSamples?: number },
  );
  begin(time: number): boolean;
  end(): boolean;
  poll(): number;
  reset(): void;
  dispose(): void;
  snapshot(options?: { raw?: boolean }): GpuTimeSnapshot;
}
