export interface LandmarkRecipe {
  schemaVersion:1; id:string; version:string; generator:string; engineCompatibility:string; priority?:number;
  match:{osm:Array<{type:'node'|'way'|'relation';id:number}>;bounds?:{south:number;west:number;north:number;east:number}};
  anchor:{kind:'source-footprint'};orientation:{kind:'source';radians:0};parameters:Record<string,unknown>;
  materialRoles:string[];source:Record<string,unknown>;provenance:Record<string,unknown>;
}
export interface LandmarkPackage {schemaVersion:1;id:string;version:string;engineCompatibility:string;recipes:LandmarkRecipe[]}
export const version:string;
export const engineCompatibility:string;
export const recipes:LandmarkRecipe[];
declare const pack:LandmarkPackage;
export default pack;
