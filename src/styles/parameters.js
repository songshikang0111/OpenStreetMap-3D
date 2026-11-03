const own=(object,key)=>Object.hasOwn(object,key);
const record=value=>value!==null&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const metadataKeys=new Set(['title','description']);
const numeric=type=>type==='number'||type==='integer';

function validValue(value,rule){
  if(rule.type==='number'&&!Number.isFinite(value))return false;
  if(rule.type==='integer'&&!Number.isSafeInteger(value))return false;
  if(rule.type==='boolean'&&typeof value!=='boolean')return false;
  if(rule.type==='string'&&typeof value!=='string')return false;
  if(numeric(rule.type)&&((own(rule,'minimum')&&value<rule.minimum)||(own(rule,'maximum')&&value>rule.maximum)))return false;
  return true;
}
const invalid=(path,message)=>{throw new TypeError(`Invalid style parameter schema ${path}: ${message}`);};

/** A small documented schema subset, shared by registration and selection. */
export function validateStyleParametersSchema(schema){
  if(!record(schema)||schema.type!=='object'||schema.additionalProperties!==false||!record(schema.properties))invalid('parametersSchema','Expected a closed object with properties.');
  for(const key of Object.keys(schema))if(!['type','properties','additionalProperties','title','description'].includes(key))invalid(key,'Unsupported schema keyword.');
  for(const key of metadataKeys)if(own(schema,key)&&typeof schema[key]!=='string')invalid(key,'Expected a string.');
  for(const [key,rule] of Object.entries(schema.properties)){
    if(!record(rule))invalid(key,'Expected a primitive rule object.');
    if(!['number','integer','boolean','string'].includes(rule.type))invalid(`${key}.type`,'Supported types: number, integer, boolean, string.');
    for(const field of Object.keys(rule))if(!['type','default','enum','minimum','maximum','title','description'].includes(field))invalid(`${key}.${field}`,'Unsupported rule keyword.');
    for(const field of metadataKeys)if(own(rule,field)&&typeof rule[field]!=='string')invalid(`${key}.${field}`,'Expected a string.');
    for(const field of ['minimum','maximum'])if(own(rule,field)&&(!numeric(rule.type)||!Number.isFinite(rule[field])))invalid(`${key}.${field}`,'Bounds require a numeric rule and a finite number.');
    if(own(rule,'minimum')&&own(rule,'maximum')&&rule.minimum>rule.maximum)invalid(key,'minimum exceeds maximum.');
    if(rule.type==='integer'&&Math.max(Number.MIN_SAFE_INTEGER,Math.ceil(rule.minimum??Number.MIN_SAFE_INTEGER))>Math.min(Number.MAX_SAFE_INTEGER,Math.floor(rule.maximum??Number.MAX_SAFE_INTEGER)))invalid(key,'Bounds contain no safe integer.');
    if(own(rule,'enum')){
      if(!Array.isArray(rule.enum)||!rule.enum.length||new Set(rule.enum).size!==rule.enum.length)invalid(`${key}.enum`,'Expected a nonempty unique primitive array.');
      if(rule.enum.some(value=>!validValue(value,rule)))invalid(`${key}.enum`,'Every value must match the type and bounds.');
    }
    if(own(rule,'default')&&(!validValue(rule.default,rule)||(own(rule,'enum')&&!rule.enum.includes(rule.default))))invalid(`${key}.default`,'Default must match the type, bounds and enum.');
  }
  return schema;
}

export function resolveStyleParameters(schema,given={}){
  validateStyleParametersSchema(schema);
  if(!record(given))throw new TypeError('Style parameters must be an object; null is not an omitted value.');
  for(const key of Object.keys(given))if(!own(schema.properties,key))throw new TypeError(`Unknown style parameter: ${key}`);
  const parameters={};
  for(const [key,rule] of Object.entries(schema.properties)){
    if(!own(given,key)&&!own(rule,'default'))continue;
    const value=own(given,key)?given[key]:rule.default;
    if(!validValue(value,rule)||(own(rule,'enum')&&!rule.enum.includes(value)))throw new TypeError(`Invalid style parameter ${key}: expected ${rule.type} within its bounds/enum.`);
    // Preserve even JSON keys such as __proto__ without invoking a setter.
    Object.defineProperty(parameters,key,{value,enumerable:true,writable:true,configurable:true});
  }
  return parameters;
}
