/// <reference types="node" />
import type {ProjectStyleConfig,PublishedStyleModule} from './project-contract.js';
export function bundleProjectStyle(root:string,selection?:ProjectStyleConfig,options?:{signal?:AbortSignal}):Promise<{style:{id:string;parameters:Record<string,unknown>};module:PublishedStyleModule|null;assets:Map<string,Uint8Array>;report:{schemaVersion:1;inputs:Record<string,string>;files:string[];hash:string}}>;
