import fs from 'node:fs/promises';
import path from 'node:path';
import { distribution } from '../../src/runtime/statistics.js';
const root=path.resolve(process.argv[2]||'docs/phase1-evidence/runtime/browser'),summary=JSON.parse(await fs.readFile(path.join(root,'summary.json')));
const merge=process.argv.find(a=>a.startsWith('--merge='))?.slice(8);
if(merge){
  const replacement=JSON.parse(await fs.readFile(path.join(merge,'summary.json')));
  summary.reruns||=[];
  for(const row of replacement.results){
    const raw=JSON.parse(await fs.readFile(path.join(merge,`${row.name}.json`)));raw.runEnvironment=replacement.environment;await fs.writeFile(path.join(root,`${row.name}.json`),JSON.stringify(raw));
    const i=summary.results.findIndex(r=>r.name===row.name);if(i<0)summary.results.push(row);else summary.results[i]=row;
  }
  const key=`${replacement.environment.commit}:${replacement.environment.date}`;
  if(!summary.reruns.some(r=>r.key===key))summary.reruns.push({key,environment:replacement.environment,names:replacement.results.map(r=>r.name),reason:'Targeted final-code reproduction / expanded Resource Timing buffer to avoid missing network entries.'});
  await fs.writeFile(path.join(root,'summary.json'),JSON.stringify(summary,null,2));
}
if(summary.results.length!==15||summary.results.some(r=>r.error))throw new Error('The complete 15-case matrix has not finished successfully.');
const rows=[];for(const row of summary.results){const raw=JSON.parse(await fs.readFile(path.join(root,`${row.name}.json`)));if(!Object.values(raw.checks).every(Boolean))throw new Error(`Acceptance check failed for ${row.name}`);rows.push(raw);}
const fmt=(n,d=1)=>Number(n).toFixed(d),mb=n=>fmt(n/1048576),line=(...values)=>`| ${values.join(' | ')} |`;
const source=summary.environment,hardware=rows[0].hardware;
let cold;try{cold=JSON.parse(await fs.readFile(path.join(root,'../cold-start.json')));}catch{}
const output=[
'# Runtime 浏览器性能证据',
'',`日期：2026-11-03（Asia/Shanghai）。完整矩阵运行时基线：\`${source.commit}\`；定向最终代码复现见 summary.json 的 reruns。所有 core-* 样本使用真实 A CINK 资产和 C 官方风格；synthetic 明确是合成连续区域 fixture，beijing/kyoto 读取仓库中的原始 OSM 快照，没有重复平铺城市来冒充扩区。`,
'',`设备：${source.cpu}，${source.cpuLogicalCount} 逻辑核，${mb(source.totalMemory)} MiB RAM；${hardware.renderer}；${source.platform} ${source.release}；Chromium ${source.browserVersion}，${hardware.webgl}。1280×720 CSS，DPR 1，balanced，96 MiB streamed resident estimate，900000 全帧 triangles，1500 calls，3 concurrent loads，18000 near attachments。背景系统负载未隔离；不把该设备结果外推到其他 GPU/移动端。`,
'','全部15组各60秒，固定路径包含俯瞰、街道、跨块、FOV/快缩放、离开覆盖再返回。每组另做同机位 full/far/far 对照，以及5次资源往返。完整 shader/阴影/normal/ID/AO/composite/resolve 均计入 renderer.info；autoReset=false，每帧只在开头 reset。',
'','## 60秒预热路径',
'',line('样本','建筑数 / 块','p50 / p95 / p99 ms','>50ms帧','近景段 p95 / 远景段 p95','峰值驻留估计 MiB'),line('---','---:','---:','---:','---:','---:'),
];
for(const r of rows){const t0=r.samples[0].render.time-r.samples[0].second*1000,phase=f=>(f.time-t0)/1000;const near=distribution(r.measured.rendering.frames.filter(f=>phase(f)>=12&&phase(f)<=21).map(f=>f.intervalMs)),far=distribution(r.measured.rendering.frames.filter(f=>phase(f)<=7||phase(f)>=56).map(f=>f.intervalMs));output.push(line(`[${r.name}](./browser/${r.name}.json)`,`${r.selectedFeatures} / ${r.chunks}`,`${fmt(r.measured.rendering.intervalsMs.p50)} / ${fmt(r.measured.rendering.intervalsMs.p95)} / ${fmt(r.measured.rendering.intervalsMs.p99)}`,r.measured.rendering.longFrames50ms,`${fmt(near.p95)} / ${fmt(far.p95)}`,mb(r.measured.runtime.peakEstimatedResidentBytes)));}
output.push('','近景段为路径12–21秒，远景段为0–7及56–60秒；由原始RAF时间与路径起点对齐。p95目标33.3ms全部通过，但长帧仍存在，尤其首次上传、着色器与重载边界；没有删除这些帧或缩短指定路径。','', '## 实际全帧 LOD 对照与传输','',line('样本','full / far triangles p50','full / far calls p50','CPU geometry MiB full / far','实传 MiB / body MiB','5次往返'),line('---','---:','---:','---:','---:','---'));
for(const r of rows)output.push(line(r.name,`${r.comparisons.full.rendering.triangles.p50} / ${r.comparisons.far.rendering.triangles.p50}`,`${r.comparisons.full.rendering.drawCalls.p50} / ${r.comparisons.far.rendering.drawCalls.p50}`,`${mb(r.comparisons.full.runtime.geometryArrayBytes)} / ${mb(r.comparisons.far.runtime.geometryArrayBytes)}`,`${mb(r.network.transferBytes)} / ${mb(r.network.encodedBodyBytes)}`,'pass'));
output.push('','full/far 控制组在同一机位强制不同资产，明确绕过自动LOD降级；full控制可能超预算。geometry bytes 仅CPU数组，residentBytes为协议/准备后缓冲估计，均不是实际显存。Resource Timing 记录实际 transferSize/encodedBodySize（cache命中可为0 transfer），SDK fetchedBytes 则含缓存读取的解码payload，不能混称网络实传。16分块合成样本曾碰到默认250条资源时间线限制，已以10000条缓冲完整复跑并替换该条原始报告。','', '## 输入、构建与冷启动','',line('样本','物理块尺寸m','包体 MiB（含manifest）','build ms','构建RSS结束 MiB','首次含几何帧 / 完整目标加载 ms'),line('---','---:','---:','---:','---:','---:'));
for(const r of rows){const c=cold?.samples.find(s=>s.name===r.name)?.stats;output.push(line(r.name,Array.isArray(r.tileSizeMeters)?r.tileSizeMeters.map(n=>fmt(n)).join('×'):r.tileSizeMeters,mb(r.packageBytes),fmt(r.buildMs),mb(r.memoryAfter?.rss??r.rssAfter??0),c?`${fmt(c.firstRenderedMs)} / ${fmt(c.allLoadedMs)}`:'see cold-start.json'));}
output.push('','构建耗时覆盖compileScene，RSS为同进程结束值（不是峰值）；原始报告保留开始/结束memoryUsage、输入数量、快照SHA-256、world/manifest hash。北京固定块500m，京都固定块300m，后者9块900m×900m仍在同一快照内。固定覆盖1/4/16保持同一真实区域，固定物理块1/4/9增加真实建筑/植被数量，两个实验没有混用。','', '补充冷启动探针使用最终生产包、每例新browser context。firstRenderedMs从manifest请求到首个含几何整帧提交完成；firstRenderedAtMs使用navigation-origin，包含SDK启动前段；allLoadedMs从同一请求起点到当前目标完整加载。旧runtime.firstUsableMs是首挂载标记，不作为首画面报告。GPU/显示完成时间未测，GPU timer虽被设备支持但未采集，不将CPU/RAF时间称GPU时间。','', '## 支持边界与结论','', '本机15条60秒路径的p95全部达到33.3ms目标，远景实际triangles/驻留低于full对照，5次返回均回到稳定资源计数，实际并发不超过3。连续区域、近景与远景数据均保留原始统计。', '', '900000全帧triangle预算下，1/4块覆盖可在最低细节内工作；9块北京/京都及完整固定范围的最低几何仍会产生COVERAGE_EXCEEDS_BUDGET / MEASURED_DRAW_BUDGET诊断。帧率通过不等于这些范围满足该triangle上限；其支持边界是缩小覆盖、提高明确预算或进一步构建简化。SDK保留必要覆盖，不以隐藏城区来伪装预算通过。普通自动路径的驻留估计在96MiB内；原子替换的短暂headroom单独诊断，紧预算回归有稳定实测。', '', '截图来自实际生产WebGL viewer，见browser/*-overview.png；路径keys、逐帧JSON、环境、冷/热、full/far、加载/卸载/取消/资源往返全部保留。独立审查和最终京都60秒复现另见review.md。其他浏览器、移动GPU、Mac/Linux均未实测。','');
await fs.writeFile(path.join(root,'../performance.md'),output.join('\n'));console.log(JSON.stringify({cases:rows.length,p95Max:Math.max(...rows.map(r=>r.measured.rendering.intervalsMs.p95)),report:path.join(root,'../performance.md')}));
