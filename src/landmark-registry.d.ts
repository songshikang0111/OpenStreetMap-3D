import type {Group} from 'three';
import type {LandmarkRecipe,LandmarkPackage} from '../packages/landmarks/index.js';
export type {LandmarkRecipe,LandmarkPackage};
export interface LandmarkFeature {id:string;osmType:'way'|'node'|'relation';osmId:number;outer:number[][];height:number;minHeight:number;center?:number[];lat?:number;lon?:number;source?:string;[key:string]:unknown}
export interface Diagnostic {code:string;stage:string;message:string;hint?:string;recipeId?:string;featureIds?:string[]}
export interface LandmarkContext {
  origin?:{lat:number;lon:number}|number[];bounds?:number[];seed?:number;features?:LandmarkFeature[];
  project?:{inverse:(point:number[])=>number[]};inverse?:(point:number[])=>number[];policy?:'strict'|'degraded';
  objectIds?:Map<string,number>;onDiagnostic?:(diagnostic:Diagnostic)=>void;
}
export interface LandmarkMatch {recipeId:string;recipeVersion:string;generatorId:string;claimedFeatureIds:string[];parameters:Record<string,unknown>;provenance:Record<string,unknown>;diagnostics:Diagnostic[]}
export interface LandmarkResult {group:Group;claimedFeatureIds:string[];provenance:Record<string,unknown>|null;diagnostics:Diagnostic[]}
export type LandmarkGenerator=(match:LandmarkMatch,context:LandmarkContext & {features:LandmarkFeature[]})=>LandmarkResult;
export interface LandmarkRegistry {readonly diagnostics:Diagnostic[];recipes:LandmarkRecipe[];match(features:LandmarkFeature[],context?:LandmarkContext):LandmarkMatch[];generate(match:LandmarkMatch,context?:LandmarkContext):LandmarkResult}
export const LANDMARK_ENGINE_VERSION:string;
export function createLandmarkRegistry(options?:{recipes?:LandmarkRecipe[];generators?:Record<string,LandmarkGenerator>;overrides?:Record<string,LandmarkRecipe|false|null>;engineVersion?:string}):LandmarkRegistry;
export function validateLandmarkRecipe(recipe:unknown):{valid:boolean;diagnostics:Diagnostic[]};
export function checkLandmarkPackage(pack:LandmarkPackage,options?:{engineVersion?:string}):{valid:boolean;diagnostics:Diagnostic[];lock:null|{id:string;version:string;engineCompatibility:string;recipes:Array<{id:string;version:string;generator:string}>}};
