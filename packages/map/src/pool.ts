// Worker pool with a priority queue, cancellation of queued jobs and transferable results.
import type { WorkerResponse } from './worker-core.js';

export interface PoolJob {
  job: number;
  priority: number;
  buffer: ArrayBuffer;
  options: { seed?: number; inferRoofs?: boolean };
  resolve(r: WorkerResponse): void;
  reject(e: Error): void;
  cancelled: boolean;
}

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export class WorkerPool {
  private readonly idle: WorkerLike[] = [];
  private readonly busy = new Map<WorkerLike, PoolJob>();
  private readonly queue: PoolJob[] = [];
  private nextJob = 1;
  readonly timings: number[] = [];
  readonly samples: { tile: string; profile: string; time: number; ms: number }[] = [];
  terminated = false;

  constructor(
    readonly size: number,
    factory: () => WorkerLike,
  ) {
    for (let i = 0; i < size; i++) {
      const w = factory();
      w.onmessage = (e) => this.done(w, e.data as WorkerResponse);
      w.onerror = (e) => this.failed(w, new Error(e.message || 'Worker error'));
      this.idle.push(w);
    }
  }

  get queued(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.busy.size;
  }

  run(
    buffer: ArrayBuffer,
    priority: number,
    options: PoolJob['options'],
  ): { promise: Promise<WorkerResponse>; cancel(): void } {
    let job!: PoolJob;
    const promise = new Promise<WorkerResponse>((resolve, reject) => {
      job = { job: this.nextJob++, priority, buffer, options, resolve, reject, cancelled: false };
    });
    if (this.terminated) job.reject(new Error('Worker pool terminated'));
    else if (this.dead === this.size) job.reject(this.unavailable());
    else {
      this.queue.push(job);
      this.queue.sort((a, b) => a.priority - b.priority);
      this.pump();
    }
    return {
      promise,
      cancel: () => {
        job.cancelled = true;
        const i = this.queue.indexOf(job);
        if (i >= 0) {
          this.queue.splice(i, 1);
          job.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
        }
      },
    };
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const job = this.queue.shift()!;
      const w = this.idle.pop()!;
      this.busy.set(w, job);
      w.postMessage({ type: 'generate', job: job.job, buffer: job.buffer, options: job.options }, [job.buffer]);
    }
  }

  private done(w: WorkerLike, response: WorkerResponse) {
    const job = this.busy.get(w);
    this.busy.delete(w);
    this.idle.push(w);
    if (job) {
      if (response.type === 'result') {
        const ms = response.decodeMs + response.generateMs;
        this.timings.push(ms);
        this.samples.push({ tile: response.tile, profile: response.profile, time: performance.now(), ms });
        if (this.timings.length > 2000) {
          this.timings.shift();
          this.samples.shift();
        }
      }
      if (job.cancelled) job.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
      else job.resolve(response);
    }
    this.pump();
  }

  /** A worker that raised an error (for example a module that failed to load) is retired, never reused. */
  private failed(w: WorkerLike, error: Error) {
    const job = this.busy.get(w);
    this.busy.delete(w);
    const i = this.idle.indexOf(w);
    if (i >= 0) this.idle.splice(i, 1);
    w.terminate();
    this.dead++;
    job?.reject(Object.assign(error, { permanent: false }));
    if (this.dead >= this.size) {
      // No worker left: fail everything still queued with a clear diagnostic instead of waiting forever.
      for (const queued of this.queue.splice(0)) queued.reject(this.unavailable());
    }
    this.pump();
  }

  private unavailable() {
    const message = 'All tile workers failed to start or crashed.';
    return Object.assign(new Error(message), {
      permanent: true,
      diagnostic: {
        code: 'WORKER_FAILED',
        stage: 'generate',
        message,
        hint: 'Check that the worker chunk is served next to the SDK and allowed by the Content-Security-Policy.',
      },
    });
  }

  private dead = 0;

  terminate() {
    this.terminated = true;
    for (const job of this.queue) job.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    this.queue.length = 0;
    for (const [w, job] of this.busy) {
      job.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
      w.terminate();
    }
    for (const w of this.idle) w.terminate();
    this.busy.clear();
    this.idle.length = 0;
  }
}
