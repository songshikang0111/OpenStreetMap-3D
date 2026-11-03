/// <reference types="node" />
import type {Server} from 'node:http';
import type {Candidate,DataSourceOptions,ResolvedDataSource} from '../data/index.js';
export interface LocalServerOptions {workspaceRoot?:string;projectRoot?:string;port?:number;host?:'127.0.0.1'|'localhost'|'::1';concurrency?:number;sample?:boolean;offline?:boolean;dataSource?:DataSourceOptions;studioRoot?:string;runner?:Function;search?:(query:string,options:unknown)=>Promise<Candidate[]>}
export function createLocalServer(options?:LocalServerOptions):Promise<{server:Server;jobs:unknown;projects:Map<string,{id:string;relativePath:string}>;workspaceRoot:string;dataSource:ResolvedDataSource;url:string;close:()=>Promise<void>}>;
