# 支持范围与诊断

一期面向有限连续区域、Three.js / WebGL 2、Node 22.11+。修复后的本机验证与设备配置见 [本轮集成证据](phase1-evidence/remediation/integration/README.md)；[原验收失败记录](phase1-evidence/integration/acceptance.md)保留。未实测平台和移动 GPU 不承诺通过。

## 输入与真实性

支持具名 WGS84 bbox、经纬度、OSM 链接/对象、官方地标 ID、可配置 Photon 搜索，以及标准 Overpass/OSM Map JSON 和既有项目 JSON 导入。XML/PBF 需外部转换；不宣称支持它们的直接读取。公开服务有限速与配额；下载默认使用缓存，刷新必须显式指定。断外网可使用内置合成小街区或已缓存数据。

平地、规则道路高程、缺失高度估算和可选屋顶/场地推断属于近似。中国尊与央视是参数化配方，其他未实现地标使用通用形体并保留来源；不宣称逐栋测绘还原。源数据关系不完整时保持诊断，不凭空封闭海湾。

## 故障恢复

| 现象 | 操作 |
| --- | --- |
| 工作台无法连接 | 使用 `npm run studio`，查看 URL 与端口占用；普通静态服务器不提供项目 API |
| 没有搜索结果 | 尝试经纬度、OSM 对象或内置样例；检查查询服务与 offline 状态 |
| HTTP 429 | 等待退避，使用缓存或本地导入；不轮换端点绕限 |
| 下载中断 | 保留旧快照；恢复原任务或显式重试 |
| `STALE_BUILD` | 配置或输入改变，重新 `city build` 再 validate/export |
| `ORIGIN_LOCKED` | 项目原点固定；更换原点需要新建项目 |
| 场景加载错误 | 检查 manifest 相对 URL、资源哈希与兼容版本；查看 SDK 诊断中的阶段及 URL |
| 预算不足 | 降低质量、缩小范围或调整明确预算；最低覆盖超预算仍会报告 |
| PNG/GLB 浏览器不可用 | 安装本地 Chrome/Edge，或设置 `CITY_BROWSER` 指向已有 Chromium 可执行文件 |

工作台的“恢复 / 重试”保留任务身份与历史；服务重启后中断任务会回到可重试状态。CLI JSON 输出含 `schemaVersion/status/artifacts/diagnostics`；进度写 stderr，批处理部分失败不会返回成功退出码。

复制项目时，`city.config.json`、`data/source.json`、项目画风/地标文件和对应地图数据缓存是可复现输入；已有 dist/lock 需按当前引擎重新验证。`.city-cache/jobs` 是绑定原项目绝对路径的本机任务恢复队列，不能作为输入直接移植到新路径。误带旧队列会正确触发 `JOB_PROJECT_ESCAPE`：先将副本中的 jobs 完整保留并移出，再让 CLI 创建新队列；地图数据缓存可以保留。不要修改路径安全检查或原项目队列来绕过错误。

PNG 是当前相机及已加载 LOD 的渲染结果，带署名。GLB 完整范围加载所有块，超预算明确拒绝，保留标准材质与几何；程序窗格、玻璃和漫画后处理不能保证在其他应用保留。完整画风请使用静态 Web 导出。静态站点需要 HTTP 服务器，不使用 `file://`。

## 2026-11-03 修复后实测边界

测量提交 `55862f0`：Windows / Chrome156 / RTX4090、1280×720/DPR1/balanced，真实北京与密集京都固定范围 1/4/16 块、固定物理块 1/4/9 覆盖，共 12 条 60 秒路径全部通过。RAF p95 均为 8.4ms，GPU p95 为 4.84–7.16ms，60 次资源往返稳定；北京 grow-1 保留的 t13/t19 机位各至少 15 秒，均为零换块、零取消、零 CINK 请求。完整逐帧记录和可重算结果见 [本轮 performance](phase1-evidence/remediation/integration/performance/README.md)。此结论仅对应记录设备和路径，不外推移动或低端 GPU。

默认 600000 整帧三角、1200 draws、128MiB 驻留估算、并发 3、near 18000，12 案包含 reset 后首帧的逐帧最大值检查均通过。最低 LOD 仍超预算的其他输入会保留覆盖并明确诊断；强制 full/far 是测量 override。资源字节来自 CPU 数组与估算，不是实测显存。[旧的超预算结果](phase1-evidence/integration/performance/README.md)和[被边界缺面反例否决的修复候选](phase1-evidence/remediation/integration/attempts/cf9c74f-pre-boundary/README.md)均保留，不以本轮结果覆盖。

本轮显式选择 Dresel Europe GET，真实慕尼黑小范围下载成功，随后离线缓存、构建与锁校验通过；Studio 也已完成真实下载→缓存→构建→显示，以及最终冻结版本的参数保存、画风切换和标准网页导出。见 [正式 CLI 来源记录](phase1-evidence/remediation/integration/formal-live-cli.json)、[Studio 真实来源记录](phase1-evidence/remediation/integration/preflight-studio/live-source.json)和[最终界面复验](phase1-evidence/remediation/integration/studio-final/ui-results.json)。Dresel 仅覆盖欧洲且使用日更提取；默认 FOSSGIS POST 的 502/超时失败仍单独保留，不宣称所有公开服务都可用。

Studio 的“地图数据服务”设置会同时设置端点与 GET/POST，并显示区域覆盖；也可输入自托管 HTTP(S) 端点。保存后项目定位和下载使用同一来源配置。故障回退必须显式打开并填写最多两个端点，只适用于网络、超时与 HTTP 502/503/504；不会绕过 429 限流或 406 拒绝。具体可用性以真实下载证据为准。
数据服务预设、端点、传输和回退设置只控制下一次获取；保存这些设置不使已有几何失效。现有场景仍保留其实际数据文件的来源、时间与哈希。重新获取后文件内容变化，或更改 source.kind / source.file，仍须重新构建并通过锁校验。
SDK 的 getStats({raw:true}) 另返回 rendering.initialFrame（intervalMs 为 null），保存 reset 后首帧的实际绘制与资源成本；rendering.frames 保留具有帧间隔的后续记录。整段绘制/驻留/近景预算需合并这两部分，FPS 仍按非空 intervalMs 计算。GPU rawSamples 的时间戳对应这些提交帧，收集数加有界在途查询数应等于 frameCount。
