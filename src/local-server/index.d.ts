/// <reference types="node" />
import type {Server} from 'node:http';
import type {Candidate,DataSourceOptions,ResolvedDataSource} from '../data/index.js';
import type {ProjectStyleConfig,PublishedStyleModule} from '../styles/index.js';
/** POST /api/projects/:id/style-preview; compiled assets use the returned local URLs. */
export interface ProjectStylePreview {style:ProjectStyleConfig;styleModule:PublishedStyleModule|null;baseUrl:string;sdkUrl:string;report:{schemaVersion:1;inputs:Record<string,string>;files:string[];hash:string}}
export interface LocalServerOptions {workspaceRoot?:string;projectRoot?:string;port?:number;host?:'127.0.0.1'|'localhost'|'::1';concurrency?:number;sample?:boolean;offline?:boolean;dataSource?:DataSourceOptions;studioRoot?:string;runner?:Function;search?:(query:string,options:unknown)=>Promise<Candidate[]>}
export function createLocalServer(options?:LocalServerOptions):Promise<{server:Server;jobs:unknown;projects:Map<string,{id:string;relativePath:string}>;workspaceRoot:string;dataSource:ResolvedDataSource;url:string;close:()=>Promise<void>}>;
