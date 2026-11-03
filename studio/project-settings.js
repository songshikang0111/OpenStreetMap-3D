import {sourceFromForm,styleFromForm} from './settings.js';

const official=['comic','line','color','white'];
const format=value=>JSON.stringify(value,null,2);
/** Form state is separate from a live SDK registry and persists complete declarations. */
export function createProjectSettings($) {
  let sources={defaults:{},providers:[]},activeStyle='comic',drafts=new Map();
  const sourceForm=()=>({provider:$('source-provider').value,endpoint:$('source-endpoint').value,transport:$('source-transport').value,fallbackPolicy:$('source-fallback-policy').value,fallbackEndpoints:$('source-fallbacks').value});
  const styleForm=()=>({option:$('style').value,id:$('style-id').value,entry:$('style-entry').value,dependencies:$('style-dependencies').value,assets:$('style-assets').value,parameters:$('style-parameters').value});
  const coverage=()=>{
    const provider=sources.providers.find(item=>item.id===$('source-provider').value);
    $('source-coverage').textContent=provider?(provider.coverage==='global'?`${provider.name} · 全球数据；可用性以实际请求为准。`:`${provider.name} · ${provider.coverage}`):'自定义 / 自托管服务；请确认覆盖当前范围。';
  };
  const matchProvider=()=>{
    $('source-provider').value=sources.providers.find(item=>item.endpoint===$('source-endpoint').value)?.id||'custom';coverage();
  };
  const fillStyle=form=>{
    for(const [key,id] of Object.entries({id:'style-id',entry:'style-entry',dependencies:'style-dependencies',assets:'style-assets',parameters:'style-parameters'}))$(id).value=form[key];
    $('external-style-fields').hidden=activeStyle!=='external';
  };
  return {
    configureSources(value) {
      sources=value;
      $('source-provider').replaceChildren(new Option('自定义 / 自托管','custom'),...sources.providers.map(item=>new Option(`${item.name}${item.coverage==='global'?'':' · 区域服务'}`,item.id)));
      this.loadSource(sources.defaults);
    },
    loadSource(value={}) {
      const source={...sources.defaults,...value};
      $('source-endpoint').value=source.endpoint||'';$('source-transport').value=source.transport||'post';
      $('source-fallback-policy').value=source.fallbackPolicy||'none';$('source-fallbacks').value=(source.fallbackEndpoints||[]).join('\n');matchProvider();
    },
    chooseProvider() {
      const preset=sources.providers.find(item=>item.id===$('source-provider').value);
      if(preset){$('source-endpoint').value=preset.endpoint;$('source-transport').value=preset.transport;}
      coverage();
    },
    matchProvider,
    source(previous) {return sourceFromForm(previous,sourceForm(),sources.defaults);},
    loadStyle(style={id:'comic'}) {
      drafts=new Map();activeStyle=style.entry||!official.includes(style.id)?'external':style.id;
      $('style').value=activeStyle;
      fillStyle({id:activeStyle==='external'?style.id:'',entry:style.entry||'',dependencies:format(style.dependencies||{}),assets:format(style.assets||[]),parameters:format(style.parameters||{})});
      drafts.set(activeStyle,styleForm());
      if(activeStyle==='external')$('style-settings').open=true;
    },
    changeStyle() {
      drafts.set(activeStyle,{...styleForm(),option:activeStyle});activeStyle=$('style').value;
      fillStyle(drafts.get(activeStyle)||{id:'',entry:'',dependencies:'{}',assets:'[]',parameters:'{}'});
      if(activeStyle==='external')$('style-settings').open=true;
    },
    style() {return styleFromForm(styleForm());},
  };
}
