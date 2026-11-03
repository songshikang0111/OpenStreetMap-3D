import type {Diagnostic} from '../data/index.js';
export interface CLIResult {schemaVersion:1;status:'succeeded'|'failed'|'partial'|'cancelled';artifacts:string[];diagnostics:Diagnostic[];[key:string]:unknown}
export function runCLI(args:string[],options?:{cwd?:string;stdout?:{write:(value:string)=>unknown};stderr?:{write:(value:string)=>unknown};signal?:AbortSignal;runner?:(job:unknown,onProgress:(value:unknown)=>void,signal:AbortSignal)=>Promise<unknown>}):Promise<CLIResult>;
export function runBatch(file:string,options?:{concurrency?:number;resume?:boolean;signal?:AbortSignal;runner?:Function}):Promise<CLIResult>;
export function exitCode(result:CLIResult):0|1|2|130;
export const HELP:string;
