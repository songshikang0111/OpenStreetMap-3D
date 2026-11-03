import type { Group } from 'three';
import type {LandmarkFeature,LandmarkContext} from '../landmark-registry.js';
import type {DataSourceOptions} from '../data/index.js';

export interface Diagnostic { code: string; stage: string; message: string; path?: string; featureId?: string; tileId?: string; hint?: string }
export interface Area { south: number; west: number; north: number; east: number }
export interface ProjectConfig {
  schemaVersion: 1; name: string; area: Area; origin?: {lat: number; lon: number}; seed?: number;
  source: DataSourceOptions & {kind: 'overpass' | 'osm-map' | 'local' | 'import' | 'sample'; file: string; [key:string]:unknown};
  generation?: {landscapeEnabled?: boolean; inferRoofs?: boolean};
  tiling?: {sizeMeters?: number; /** Fixed-area comparison: N×N cells. */ divisions?: number};
  quality?: 'draft' | 'low' | 'balanced' | 'high'; style?: import('../styles/project-contract.js').ProjectStyleConfig;
  landmarks?: {enabled?: boolean; policy?:'strict'|'degraded'; packages?: Array<string|{path:string;hash?:string;recipes?:Array<{id:string;version:string}>}>};
  camera?: {position?:number[];target?:number[];fov?:number;near?:number};
}
export interface ValidationResult<T> { valid: boolean; diagnostics: Diagnostic[]; value?: T; config?: T }
/** [minX,minY,minZ,maxX,maxY,maxZ], meters in the project origin. */
export type Bounds3 = [number,number,number,number,number,number];
export interface LODDescriptor {
  id: 'low' | 'medium' | 'high'; level: 0 | 1 | 2; uri: string; hash: string; bytes: number;
  residentBytes: number; triangles: number; drawCalls: number; instances: number; geometries: number; materials: number;
  bounds: Bounds3; geometricError: number; maxScreenSpaceError: number; description: string;
  /** Conservative per-mesh submission costs for runtime frustum budgets. */
  drawUnits?: {bounds:Bounds3;triangles:number;drawCalls:number}[];
  selection: {metric:'screen-space-error'; geometricErrorMeters:number; maxScreenSpaceError:number};
}
export interface FeatureRecord {
  featureId:string; renderId:number; sourceIds:string[]; kind:string; provenance:Record<string,unknown>;
  bounds?:Bounds3; anchor?:[number,number]; chunkIds:string[]; ownerChunk?:string; atomicGroupId?:string;
}
export interface SceneManifest {
  schemaVersion:1; generator:{id:string;version:string}; origin:{lat:number;lon:number};
  coordinateSystem:{crs:string;axes:{x:'east';y:'up';z:'south'};units:'meters';projection:{eastMetersPerDegree:number;northMetersPerDegree:number}};
  area:Area; bounds:Bounds3; sources:Record<string,unknown>[]; attribution:{text:string;url:string;license:string;dataSource:string};
  styleContractVersion:1; style:{id:string;parameters?:Record<string,unknown>;contractVersion:1;attributes:string[];materialRoles:string[]};
  tiling:{sizeMeters:number;divisions?:number;columns:number;rows:number;boundaryPolicy:string;contentBoundsRequired:true};
  chunks:{id:string;bounds:Bounds3;contentBounds:Bounds3;transform:number[];lods:LODDescriptor[]}[];
  featureIndex:Record<string,FeatureRecord>; hashes:{config:string;source:string;world:string};
}
export interface LandmarkMatch {recipeId:string;recipeVersion:string;generatorId:string;claimedFeatureIds:string[];parameters?:Record<string,unknown>;diagnostics?:Diagnostic[]}
export interface CompileOptions {
  signal?:AbortSignal; onProgress?:(progress:{stage:string;progress:number})=>void;
  landmarkRegistry?:{
    match(features:LandmarkFeature[],context:LandmarkContext):LandmarkMatch[]|Promise<LandmarkMatch[]>;
    generate(match:LandmarkMatch,context:Record<string,unknown>):{group:Group;claimedFeatureIds:string[];provenance?:Record<string,unknown>|null;diagnostics?:Diagnostic[]}|Promise<{group:Group;claimedFeatureIds:string[];provenance?:Record<string,unknown>|null;diagnostics?:Diagnostic[]}>;
  };
}
export class CityBuildError extends Error {
  constructor(code:string,message:string,stage?:string,details?:Record<string,unknown>);
  code:string;stage:string;diagnostics:Diagnostic[];
}
export function validateProjectConfig(config:unknown):ValidationResult<ProjectConfig>;
export function validateSceneManifest(manifest:unknown):ValidationResult<SceneManifest>;
export function compileScene(raw:{elements:Record<string,unknown>[];metadata?:Record<string,unknown>},config:ProjectConfig,options?:CompileOptions):Promise<{
  manifest:SceneManifest;assets:Record<string,Uint8Array|string>;
  report:{schemaVersion:1;status:'succeeded';diagnostics:Diagnostic[];hashes:SceneManifest['hashes'];counts:Record<string,number>;road:Record<string,unknown>;landscape:Record<string,unknown>;roof:Record<string,number>;determinism:Record<string,boolean>};
}>;
