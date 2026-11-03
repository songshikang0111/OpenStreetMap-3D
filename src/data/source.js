import { CityError } from './errors.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const DATA_SOURCE_FIELDS = ['provider','endpoint','transport','fallbackEndpoints','fallbackPolicy'];
export const DATA_SOURCE_DEFAULTS = Object.freeze({provider:'overpass-main',endpoint:OVERPASS_URL,transport:'post',fallbackEndpoints:[],fallbackPolicy:'none'});
export const DATA_SOURCE_PROVIDERS = [
  {id:'overpass-main',name:'FOSSGIS Overpass',endpoint:OVERPASS_URL,transport:'post',coverage:'global',documentation:'https://dev.overpass-api.de/overpass-doc/en/preface/commons.html'},
  {id:'private-coffee',name:'Private.coffee Overpass',endpoint:'https://overpass.private.coffee/api/interpreter',transport:'post',coverage:'global',documentation:'https://overpass.private.coffee/'},
  {id:'vk-maps',name:'VK Maps Overpass',endpoint:'https://maps.mail.ru/osm/tools/overpass/api/interpreter',transport:'get',coverage:'global',documentation:'https://maps.mail.ru/osm/tools/overpass/'},
  {id:'dresel-europe',name:'Overpass Europe (Dresel)',endpoint:'https://ovp.dresel.systems/api/interpreter',transport:'get',coverage:'Europe only; daily regional extract. Do not use for locations outside Europe.',documentation:'https://wiki.openstreetmap.org/wiki/Overpass_API#Instances_with_data_only_for_a_specific_region'}
];
export function validateEndpoint(value){
  let url;
  try{if(typeof value!=='string'||value.length>2048||value.trim()!==value||!/^https?:\/\//.test(value))throw 0;url=new URL(value);}
  catch{throw new CityError('INVALID_ENDPOINT','source','Expected an absolute HTTP(S) Overpass interpreter URL.','Set source.endpoint, --endpoint or the fetch job endpoint to a full interpreter URL.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)
    throw new CityError('INVALID_ENDPOINT','source','Endpoint must use HTTP(S), without credentials, query or fragment.','Use a self-hosted interpreter or reverse proxy URL; secrets must not be stored in project snapshots.');
  return url.href;
}
export function dataSourceOverrides(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new CityError('INVALID_SOURCE','source','Data source must be an object.');
  return Object.fromEntries(DATA_SOURCE_FIELDS.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
}
export function resolveDataSource(...values){
  let config={...DATA_SOURCE_DEFAULTS};
  for(const value of values){
    const override=dataSourceOverrides(value);
    if(override.provider!==undefined){
      const preset=DATA_SOURCE_PROVIDERS.find(p=>p.id===override.provider);
      if(preset)config={...config,provider:preset.id,endpoint:preset.endpoint,transport:preset.transport};
      else if(override.provider!=='custom'||!override.endpoint)throw new CityError('INVALID_PROVIDER','source','Unknown provider, or custom provider without an endpoint.','Run city data providers for supported presets; self-hosted services use --endpoint URL.');
    }
    config={...config,...override};
  }
  config.endpoint=validateEndpoint(config.endpoint);
  config.provider=DATA_SOURCE_PROVIDERS.find(p=>p.endpoint===config.endpoint)?.id||'custom';
  if(!['post','get'].includes(config.transport))throw new CityError('INVALID_SOURCE','source','source.transport must be post or get.');
  if(!['none','unavailable'].includes(config.fallbackPolicy))throw new CityError('INVALID_SOURCE','source','source.fallbackPolicy must be none or unavailable.');
  if(!Array.isArray(config.fallbackEndpoints)||config.fallbackEndpoints.length>2)throw new CityError('INVALID_SOURCE','source','Use at most two explicit fallback endpoints.');
  config.fallbackEndpoints=config.fallbackEndpoints.map(validateEndpoint);
  if(new Set([config.endpoint,...config.fallbackEndpoints]).size!==config.fallbackEndpoints.length+1)throw new CityError('INVALID_SOURCE','source','Primary and fallback endpoints must be distinct.');
  return config;
}
export function canFallback(error){
  return ['TIMEOUT','NETWORK_ERROR'].includes(error.code)||error.code==='HTTP_ERROR'&&[502,503,504].includes(error.httpStatus);
}
export function overpassRequest(endpoint,query,transport='post'){
  if(transport==='get'){
    const url=new URL(endpoint);url.searchParams.set('data',query);
    return {url:url.href,init:{method:'GET'}};
  }
  return {url:endpoint,init:{method:'POST',body:new URLSearchParams({data:query}),headers:{'Content-Type':'application/x-www-form-urlencoded'}}};
}
