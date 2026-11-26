// Shared shapes of phase-one planning data, used by the declaration files that the phase-two packages consume.
// Coordinates are local metres of the project projection: [x east, z south].

export type Point2 = [number, number];
export type Ring = Point2[];

export interface Phase1Building {
  id: string;
  osmType: 'way' | 'relation';
  osmId: number;
  outer: Ring;
  holes: Ring[];
  tags: Record<string, string>;
  center: Point2;
  area: number;
  height: number;
  minHeight: number;
  levels: number;
  source: 'height' | 'levels' | 'estimated';
  part: boolean;
  /** Sparse normalized-ring edge lengths from the source projection for L1 generation decisions. */
  wallLengths?: number[][];
  [key: string]: unknown;
}

export interface Phase1Polygon {
  id: string;
  outer: Ring;
  holes: Ring[];
  tags: Record<string, string>;
  kind?: string;
  source?: string;
  sourceIds?: string[];
  area?: number;
  [key: string]: unknown;
}

export interface Phase1Road {
  id: number;
  name: string;
  type: string;
  tags: Record<string, string>;
  nodes: number[];
  segments: [Point2, Point2][];
  segmentNodes: (number | null)[][];
  width: number;
  bridge: boolean;
  layer: number;
}

export interface Phase1Tree {
  point: Point2;
  id: number;
  height: number;
  tags: Record<string, string>;
}

export interface Phase1Data {
  buildings: Phase1Building[];
  roads: Phase1Road[];
  greens: Phase1Polygon[];
  water: Phase1Polygon[];
  landscapes: Phase1Polygon[];
  landscapeContexts: Phase1Polygon[];
  trees: Phase1Tree[];
  streetNodes: { id: number; point: Point2; kind: string; tags: Record<string, string> }[];
  treeRows: { id: number; points: Point2[]; tags: Record<string, string> }[];
  bounds: [number, number, number, number];
  project: { point(p: { lat: number; lon: number }): Point2; inverse(p: Point2): [lat: number, lon: number] };
  seed: number;
  metadata: Record<string, unknown>;
  stats: { invalidRings: number; incompleteRelations: number; suppressed: number; landscapePolygons: number };
}
