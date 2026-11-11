import type { Phase1Building } from './phase1-types.js';

export const FACADE_SURFACES: readonly string[];
export function buildingStyle(
  building: Phase1Building,
  seed?: number,
): {
  family: string;
  code: number;
  color: string;
  surfaceName: string;
  grammar?: string;
  floor: number;
  [key: string]: unknown;
};
export function landmarkKind(building: Phase1Building): string | null;
export function roofEquipment(building: Phase1Building): { x: number; z: number; w: number; d: number; h: number }[];
