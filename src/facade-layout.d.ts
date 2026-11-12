// Type boundary for the phase-two packages (decision E4); the implementation stays in facade-layout.js.
export function facadeGrammar(
  family: string,
  variant?: number,
): { name: string; bay: number; width: number; height: number; split: number; group: number; index: number };
export function facadeLayout(
  length: number,
  height: number,
  style: { family: string; variant?: unknown; floor: number; [key: string]: unknown },
): { name: string; bays: number; floor: number; levels: number; attributes: [number, number, number, number] };
export function nearbyFacadeFrames(
  walls: unknown[],
  position: { x: number; y: number; z: number },
  limit?: number,
): { x: number; y: number; z: number; angle: number; w: number; h: number; d: number }[];
