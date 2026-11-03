/// <reference types="node" />
export interface Area { south:number; west:number; north:number; east:number }
export interface Origin { lat:number; lon:number }
export interface Diagnostic {code:string;stage:string;message:string;hint:string;featureId?:string;tileId?:string;endpoint?:string;httpStatus?:number;retryAfterMs?:number;sourceAttempts?:SourceAttempt[]}
export type DataSourceProvider = 'overpass-main'|'private-coffee'|'vk-maps'|'dresel-europe'|'custom';
export interface DataSourceOptions {provider?:DataSourceProvider;endpoint?:string;transport?:'get'|'post';fallbackEndpoints?:string[];fallbackPolicy?:'none'|'unavailable'}
export interface ResolvedDataSource {provider:DataSourceProvider;endpoint:string;transport:'get'|'post';fallbackEndpoints:string[];fallbackPolicy:'none'|'unavailable'}
export interface SourceAttempt {endpoint:string;transport:'get'|'post';status:'succeeded'|'failed';elapsedMs:number;code?:string;httpStatus?:number}
export interface Candidate extends Origin {id:string;displayName:string;source:string;bbox?:Area;endpoint?:string}
export interface OSMElement {type:'node'|'way'|'relation';id:number;lat?:number;lon?:number;nodes?:number[];geometry?:Origin[];members?:{type:'node'|'way'|'relation';ref:number;role?:string;geometry?:Origin[]}[];tags?:Record<string,string>;version?:number;timestamp?:string}
export interface RawOSM {elements:OSMElement[];metadata?:Record<string,unknown>;version?:string|number;generator?:string;remark?:string}
export interface Normalized {raw:RawOSM;diagnostics:Diagnostic[];missing:{type:string;id:number}[];contentHash:string}
export class CityError extends Error {code:string;stage:string;hint:string;constructor(code:string,stage:string,message:string,hint?:string,details?:Record<string,unknown>)}
export function diagnostic(error:Error,stage?:string):Diagnostic;
export function validateArea(area:Area,options?:{maxSideMeters?:number;maxAreaKm2?:number}):Area;
export function normalizeOSM(input:RawOSM,options?:{area?:Area;origin?:Origin;name?:string;source?:Record<string,unknown>}):Normalized;
export function searchPlaces(query:string,options?:DataSourceOptions&{source?:DataSourceOptions;cacheDir?:string;offline?:boolean;refresh?:boolean;photonUrl?:string;overpassUrl?:string;signal?:AbortSignal;request?:typeof requestJSON;requestOptions?:Record<string,unknown>}):Promise<Candidate[]>;
export function fetchArea(options:DataSourceOptions&{source?:DataSourceOptions;area:Area;origin?:Origin;name?:string;cacheDir:string;refresh?:boolean;offline?:boolean;signal?:AbortSignal;request?:typeof requestJSON;requestOptions?:Record<string,unknown>}):Promise<Normalized&{cacheHit:boolean;cacheKey:string;cacheFile:string;endpoint:string;transport:'get'|'post';sourceAttempts:SourceAttempt[]}>;
export function resolveDataSource(...values:(DataSourceOptions|undefined)[]):ResolvedDataSource;
export function validateEndpoint(value:unknown):string;
export const DATA_SOURCE_DEFAULTS:Readonly<ResolvedDataSource>;
export const DATA_SOURCE_PROVIDERS:{id:Exclude<DataSourceProvider,'custom'>;name:string;endpoint:string;transport:'get'|'post';coverage:string;documentation:string}[];
export function areaQuery(area:Area):string;
export function requestJSON(url:string,options?:RequestInit&{fetchImpl?:typeof fetch;timeoutMs?:number;maxBytes?:number;retries?:number;minIntervalMs?:number;sleep?:(milliseconds:number,signal?:AbortSignal)=>Promise<void>}):Promise<unknown>;
export const LANDMARK_LOCATIONS:Candidate[];
export const OVERPASS_URL:string;
export const QUERY_VERSION:number;
