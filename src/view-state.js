// View links contain only camera and presentation parameters, never application code.
export const parameterRanges={
  'line-width':[.5,2.5], 'tone-size':[2,8], density:[20,150],
  'outline-width':[1,2.5], 'tone-threshold':[25,85], 'ao-strength':[0,200],
  'shadow-strength':[0,200], haze:[0,100], 'tree-ink':[0,100],
  'black-point':[2,35], 'sun-angle':[0,360], 'sun-height':[10,85], lens:[18,100],
  'facade-detail':[0,100], 'glass-reflection':[0,100],
};
export function decodeView(hash){
  try{
    const value=new URLSearchParams(hash.replace(/^#/, '')).get('v');
    if(!value || value.length>12000)return null;
    const raw=JSON.parse(value), result={version:2};
    if(raw.version!==2)return null;
    result.mode=Math.max(0,Math.min(3,Math.round(Number(raw.mode)||0)));
    result.seed=Math.max(1,Math.min(100000,Math.round(Number(raw.seed)||1)));
    if(['overview','skyline','street','top','citic','cctv','roof','crossing','facade'].includes(raw.view))result.view=raw.view;
    result.parameters={};
    for(const [name,[lo,hi]]of Object.entries(parameterRanges))if(Number.isFinite(raw.parameters?.[name]))result.parameters[name]=Math.max(lo,Math.min(hi,raw.parameters[name]));
    result.toggles={};
    for(const name of ['windows-toggle','trees-toggle','props-toggle','shadows-toggle','landscape-toggle'])if(typeof raw.toggles?.[name]==='boolean')result.toggles[name]=raw.toggles[name];
    for(const name of ['position','target'])if(Array.isArray(raw[name]) && raw[name].length===3 && raw[name].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))result[name]=raw[name];
    return result;
  }catch{return null;}
}
export function encodeView(view){return '#v='+encodeURIComponent(JSON.stringify(view));}
