import type { Group } from 'three';
import type { LODDescriptor } from './index.js';
export function encodeChunk(group:Group):Uint8Array;
export function decodeChunk(payload:ArrayBuffer|ArrayBufferView,descriptor?:Partial<LODDescriptor>):Promise<Group>;
export function sceneStats(group:Group):{residentBytes:number;triangles:number;drawCalls:number;shadowTriangles:number;shadowDrawCalls:number;nearDetails:number;instances:number;geometries:number;materials:number};
