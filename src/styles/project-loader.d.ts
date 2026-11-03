import type {ProjectStyleConfig,PublishedStyleModule} from './project-contract.js';
import type * as StyleAPI from './index.js';
export interface LoadedProjectStyle {id:string;parameters:Record<string,unknown>;/** Remove only the stylesheets created by this load, after viewer disposal. */dispose():void}
export function loadProjectStyle(selection:string|ProjectStyleConfig,options?:{module?:PublishedStyleModule|null;baseUrl?:string|URL;importModule?:(url:string)=>Promise<{default:unknown}>;styleApi?:typeof StyleAPI}):Promise<LoadedProjectStyle>;
