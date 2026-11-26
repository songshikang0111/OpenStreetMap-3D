// Worker input contains only the cell neighbourhood. The phase-one projection functions are recreated in the worker.
import { parentPort } from 'node:worker_threads';
import type { TileId } from '@city-ink/tiles';
import { projection } from '../../../src/osm.js';
import type { Phase1Data } from '../../../src/phase1-types.js';
import { planCellData } from './plan.js';
import type { PlanOptions } from './plan.js';

export interface PlanningTask {
  cell: TileId | null;
  data: Omit<Phase1Data, 'project'>;
  center: [number, number];
  options: PlanOptions;
}

parentPort!.on('message', async ({ cell, data, center, options }: PlanningTask) => {
  // Unhandled failures propagate to Worker.error, just as local planning rejects its promise.
  const plan = await planCellData({ ...data, project: projection(...center) }, cell, options);
  parentPort!.postMessage(plan);
});
