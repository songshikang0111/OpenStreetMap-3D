export class MeshWriter {
  materialRuns: { start: number; count: number; role: string }[];
  positions: number[];
  normals: number[];
  colors: number[];
  facades: number[];
  ids: number[];
  styles: number[];
  layouts: number[];
  surfaces: number[];
  materialRole?: string | null;
  style: number;
  variant: number;
  triangle(
    a: number[],
    b: number[],
    c: number[],
    normal: number[],
    color: unknown,
    id?: number,
    uv?: number[][] | null,
  ): void;
  quad(points: number[][], normal: number[], color: unknown, id?: number, uv?: number[][] | null): void;
}
export function normalizedRing(ring: [number, number][], clockwise?: boolean): [number, number][];
export function polygon(
  writer: MeshWriter,
  feature: { outer: [number, number][]; holes: [number, number][][] },
  y: number,
  color: unknown,
  id?: number,
): void;
export function addBox(
  writer: MeshWriter,
  center: number[],
  dimensions: number[],
  color: unknown,
  id?: number,
  angle?: number,
): void;
