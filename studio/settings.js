export function jsonObject(text,label='参数') {
  let value;try {value=JSON.parse(text||'{}');} catch {throw new Error(`${label}须为有效 JSON。`);}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label}须为 JSON 对象。`);
  const pending=[value];
  while(pending.length){
    const item=pending.pop();
    if(typeof item==='number'&&!Number.isFinite(item))throw new Error(`${label}中的数值必须有限，不能在保存时变成 null。`);
    if(item&&typeof item==='object')for(const child of Object.values(item))pending.push(child);
  }
  return value;
}
const endpoint=value=>{
  let url;try {url=new URL(value.trim());} catch {throw new Error('数据端点须为完整 HTTP(S) URL。');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('数据端点须为 HTTP(S) URL，不含凭据、查询或片段。');
  return url.href;
};
/** Preserve source kind/file while explicitly saving the chosen service policy. */
export function sourceFromForm(previous,form,defaults) {
  const primary=endpoint(form.endpoint.trim()||defaults?.endpoint||'');
  const fallbackEndpoints=(form.fallbackEndpoints||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean).map(endpoint);
  if(fallbackEndpoints.length>2||new Set([primary,...fallbackEndpoints]).size!==fallbackEndpoints.length+1)throw new Error('最多两个明确且互不重复的备用端点。');
  if(!['get','post'].includes(form.transport)||!['none','unavailable'].includes(form.fallbackPolicy))throw new Error('请选择有效的传输方式与故障回退策略。');
  return {...previous,endpoint:primary,transport:form.transport,fallbackEndpoints,fallbackPolicy:form.fallbackPolicy};
}
/** A project declares its one selected external entry; no filename scanning. */
export function styleFromForm(form) {
  const external=form.option==='external',id=(external?form.id:form.option).trim();
  if(!id)throw new Error('画风 ID 不能为空。');
  const style={id,parameters:jsonObject(form.parameters,'画风参数')};
  if(!external)return style;
  if(!form.entry.trim())throw new Error('请填写项目相对的外部画风入口。');
  const dependencies=jsonObject(form.dependencies,'画风依赖');let assets;
  try {assets=JSON.parse(form.assets||'[]');} catch {throw new Error('画风资产须为有效 JSON 数组。');}
  if(!Array.isArray(assets)||assets.some(value=>typeof value!=='string')||Object.values(dependencies).some(value=>typeof value!=='string'))throw new Error('依赖映射和资产数组中的文件路径须为字符串。');
  return {...style,entry:form.entry.trim(),dependencies,assets};
}
