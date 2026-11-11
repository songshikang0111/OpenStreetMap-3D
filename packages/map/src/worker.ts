// Worker entry: decode and generate tiles off the main thread (04 section 5.3).
import { handleRequest } from './worker-core.js';
import type { WorkerRequest } from './worker-core.js';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { response, transfer } = handleRequest(event.data);
  scope.postMessage(response, transfer);
};
