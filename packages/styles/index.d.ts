import type {Object3D,Material,Scene,Camera,WebGLRenderer} from 'three';
export type SharedUniforms=Record<string,{value:unknown}>;
export interface StylePipeline {render():void;resize(width:number,height:number):void;dispose():void}
export interface StyleContext {renderer:WebGLRenderer;scene:Scene;camera:Camera;shared:SharedUniforms;parameters:Record<string,unknown>;services:StyleServices}
export interface StyleServices {createFacadeMaterial(shared:SharedUniforms,source?:Material):Material;createFoliageMaterial(source?:Material):Material;createInkPipeline(context:StyleContext & {mode:number}):StylePipeline}
export interface StylePack {
  schemaVersion:1;id:string;version:string;engineCompatibility:string;styleContractVersion:1;
  parametersSchema:{type:'object';additionalProperties:false;properties:Record<string,{type:string;minimum?:number;maximum?:number;default?:unknown;enum?:unknown[]}>};
  materialRoles:string[];fallbackRole:string;rebuildParameters:string[];qualityHints:Record<string,unknown>;
  createMaterial(context:{object:Object3D;role:string;semantic:Record<string,unknown>;shared:SharedUniforms;parameters:Record<string,unknown>;sourceMaterial?:Material;services:StyleServices}):Material;
  createPipeline(context:StyleContext):StylePipeline;dispose():void;
}
export const version:string;
export const materialRoles:string[];
export const parametersSchema:StylePack['parametersSchema'];
export const officialStyles:StylePack[];
export function createOfficialStyle(id:string,mode:number):StylePack;
export default officialStyles;
