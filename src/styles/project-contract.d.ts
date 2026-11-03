export interface ProjectStyleConfig {id:string;parameters?:Record<string,unknown>;entry?:string;dependencies?:Record<string,string>;assets?:string[]}
export interface PublishedStyleModule {schemaVersion:1;id:string;version:string;entry:string;stylesheets:string[];assets:Record<string,string>;hash:string}
export const OFFICIAL_STYLE_IDS:readonly string[];
export function projectStylePath(value:unknown):string;
export function validateProjectStyleConfig(style:unknown):ProjectStyleConfig & {parameters:Record<string,unknown>};
