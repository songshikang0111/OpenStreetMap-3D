import { Worker } from 'node:worker_threads';
import type { Phase1Data } from '../../../src/phase1-types.js';
import type { TileId } from '@city-ink/tiles';
import { planCellData } from './plan.js';
import type { PlanOptions, CellPlan } from './plan.js';
import type { PlanningTask } from './plan-worker.js';

export interface PlanningJob {
  cell: TileId | null;
  file: string;
}

/** Give each lane at most one buffered cell at a time. Completed jobs are persisted before it takes the next. */
export async function planQueuedCells(
  jobs: PlanningJob[],
  neighbourhood: (cell: TileId | null) => {
    data: Phase1Data;
    relationErrors?: CellPlan['relationErrors'];
    diagnostics?: CellPlan['diagnostics'];
  },
  options: PlanOptions,
  concurrency: number,
  save: (job: PlanningJob, plan: CellPlan) => Promise<void>,
  signal?: AbortSignal,
) {
  const workers: Worker[] = [];
  const lanes = Math.min(concurrency, jobs.length);
  let next = 0;
  let stopped = false;
  const run = async () => {
    const worker = lanes > 1 ? new Worker(new URL('./plan-worker.js', import.meta.url), { execArgv: [] }) : null;
    if (worker) workers.push(worker);
    while (!stopped && next < jobs.length) {
      signal?.throwIfAborted();
      const job = jobs[next++]!;
      const local = neighbourhood(job.cell);
      let plan: CellPlan;
      if (worker) {
        const { project, ...data } = local.data;
        const task: PlanningTask = { data, center: project.inverse([0, 0]), cell: job.cell, options };
        plan = await new Promise<CellPlan>((resolve, reject) => {
          const clean = () => {
            worker.off('error', fail);
            worker.off('exit', exit);
            worker.off('message', done);
            signal?.removeEventListener('abort', abort);
          };
          const done = (value: CellPlan) => {
            clean();
            resolve(value);
          };
          const fail = (error: Error) => {
            clean();
            reject(error);
          };
          const exit = (code: number) => fail(new Error(`Planning worker exited (${code}).`));
          const abort = () => {
            clean();
            reject(signal?.reason);
          };
          worker.once('message', done).once('error', fail).once('exit', exit);
          signal?.addEventListener('abort', abort, { once: true });
          try {
            worker.postMessage(task);
          } catch (error) {
            fail(error as Error);
          }
        });
      } else {
        plan = await planCellData(local.data, job.cell, options);
      }
      if (local.relationErrors?.length) plan.relationErrors = local.relationErrors;
      if (local.diagnostics?.length) plan.diagnostics = local.diagnostics;
      if (!stopped) await save(job, plan);
    }
  };
  const active = Array.from({ length: lanes }, run);
  try {
    await Promise.all(active);
  } finally {
    stopped = true;
    await Promise.all(workers.map((w) => w.terminate()));
    await Promise.allSettled(active);
  }
}
