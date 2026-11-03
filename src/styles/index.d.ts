import type {Group,Material,Object3D,Scene,Camera,WebGLRenderer} from 'three';
import type {StylePack,StylePipeline,SharedUniforms} from '../../packages/styles/index.js';
export type {StylePack,StylePipeline,SharedUniforms};
export type StyleSelection=string|StylePack|{id:string;parameters?:Record<string,unknown>};
export interface StyleBinding {style:StylePack;shared:SharedUniforms;parameters:Record<string,unknown>;diagnostics:Array<{code:string;stage:string;featureId?:string;message:string}>;dispose():void}
export const STYLE_CONTRACT_VERSION:1;
export function getStyle(id?:string|StylePack):StylePack;
export function registerStyle(style:StylePack):StylePack;
export function validateStyle(style:unknown):StylePack;
export function createStyleShared(values?:Record<string,unknown>):SharedUniforms;
export function createFacadeMaterial(shared:SharedUniforms,source?:Material):Material;
export function createFoliageMaterial(source?:Material):Material;
export function annotateSceneSemantics<T extends Object3D>(group:T):T;
export function bindSceneStyle(group:Group,{style,shared}?:{style?:StyleSelection;shared?:SharedUniforms}):StyleBinding;
export function createStylePipeline(options:{renderer:WebGLRenderer;scene:Scene;camera:Camera;style?:StyleSelection;shared?:SharedUniforms}):StylePipeline & {style:StylePack;shared:SharedUniforms};

export type {ProjectStyleConfig,PublishedStyleModule} from './project-contract.js';
export {OFFICIAL_STYLE_IDS,validateProjectStyleConfig} from './project-contract.js';
export {loadProjectStyle} from './project-loader.js';
export type {LoadedProjectStyle} from './project-loader.js';
export function resolveStyleSelection(selection?:StyleSelection):{style:StylePack;parameters:Record<string,unknown>};
