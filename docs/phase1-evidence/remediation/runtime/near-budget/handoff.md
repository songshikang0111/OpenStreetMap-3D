# P2：主体与附件共享近景总预算

2026-11-03。接续首轮R1/R4交付 `a13ed34`。主对话的独立 CPU 复现：真实北京grow1、t13、合法配置 `budget.nearDetails=420`，持久主体410单位，加运行时附件195单位，总计605，超出用户设置420。默认18000在此案例仍足够；本P2不是默认GPU性能失败。

产品冻结：`adfbde7ae2cd115732517945ed370442e3b24aed`。顺序集成：

- `ff3c33b`：主体与附件同帧分配近景预算；解码计数缓存优先于manifest；旧资产加载后校正；附件分配器自带旧调用兼容保护；明确SDK Budget类型注释。
- `adfbde7`：备用粗层根据替换后的整帧总成本准入，允许利用剩余三角预算来降低已超限近景数量；补独立审查构造的双块延迟替换回归。

只改D所有权 `src/runtime/`、`src/sdk/` 和对应测试。默认18000、triangles/draws、驻留延迟不变；没有修改A的core/Schema或C风格文件。

## 明确计数语义

- 统计当前激活chunk的完整LOD，遍历可见的Mesh且有position几何属性，语义 `userData.city.lodRole` 为 `detail` 或 `near`。
- 普通Mesh计1，InstancedMesh计当前count。材质分组不重复计数；不按当前视锥细分，以保守涵盖主体/阴影所需细节。
- 隐藏的standby不占近景单位数，但仍占已报告驻留；其完整LOD数字计数保留，重新激活前不会被“隐藏root导致0计数”覆盖。
- 运行时附件使用相同单位：一个窗框/窗台实例计1；树的完整profile为18个冠簇+6个枝干，共24。预算不足时不拆分完整pane/profile，也不会删除必要主体地物。

生产planner使用 `解码并准备后的实测缓存 > 可选LOD.nearDetails > 旧资产未知0`。未知不是已证明0：解码完成后，在挂载前校正候选成本；不能满足低预算的高层会被取消并降到可用中/低层，实测值保留以避免固定相机反复请求。低预算不再永久停留于超限high。

同一帧先统计实际激活主体，再传给NearDetails剩余近景量。NearDetails自身也检查传入entries的主场景计数，保护仍用旧调用签名的调用者；使用 `min(全局限制-实际主体, 调用者剩余额度)`，不会再花一次完整预算，也不会双扣主体。余量为0立即清除附件实例及其资源。

如所有可用完整LOD本身都超过配置，仍保留必要覆盖并给出既有 `COVERAGE_EXCEEDS_BUDGET`，而不是隐藏城市。此案例有合法中层，因此400/0可稳定落在预算内。

## 真实SDK同帧验证

公开createCityViewer，真实未修改的北京grow1 CINK，t13原固定相机，1280×720、balanced；Chromium153.0.8010.12，ANGLE NVIDIA RTX4090 D3D11。每组冷加载与约2.2秒持镜，再离场1.35秒、返回whenIdle、dispose；六组串行，没有并行GPU压测。

独立于SDK统计，再遍历实际scene中 `City Ink streamed chunks` 和 `Budgeted near attachments`，按上述Mesh/instance语义逐帧计数。与runtime.nearDetails、frameCost.nearDetails、nearAttachments.nearDetails逐帧对照。

| 输入metadata | 配置上限 | 最终主体 + 附件 = 总计 | 最终LOD | 最大triangles / draws | near超限帧 / 计数不匹配帧 |
| --- | --- | --- | --- | --- | --- |
| 原旧资产（无字段） | 420 | 410 + 10 = 420 | high | 578774 / 243 | 0 / 0 |
| 原旧资产（无字段） | 400 | 0 + 0 = 0 | medium | 538214 / 172 | 0 / 0 |
| 原旧资产（无字段） | 0 | 0 + 0 = 0 | medium | 538214 / 172 | 0 / 0 |
| 原旧资产（无字段） | 18000（默认） | 410 + 195 = 605 | high | 590354 / 247 | 0 / 0 |
| 派生可选计数字段 | 420 | 410 + 10 = 420 | high | 578774 / 243 | 0 / 0 |
| 派生可选计数字段 | 400 | 0 + 0 = 0 | medium | 538214 / 172 | 0 / 0 |

六组加载后均无覆盖缺失帧，绘制逐帧也未超过600000/1200；离场/销毁驻留均0，返回后总计与离场前相同。420/default没有取消；旧资产400/0各有一次未知high解码后取消，随后稳定medium，返回时复用数字缓存，不再探测high；已带计数字段的400不需该探测。不是把所有配置都强制low。

“派生可选计数字段”仅在测试readAsset中为原manifest增加已实测的high410、medium/low0，几何资源完全不变，用来验证向后/向前兼容；不是冒充A已重新生成的资产。A仍负责正式compiler/validator/types/Schema与最终资产，E合入A后需再核对其输出。D对可选LOD.nearDetails检查非负安全整数。

## 证据与复跑

- [before.json](before.json)：保留主对话原CPU失败，410+195=605。
- [minimal.mjs](minimal.mjs) / [minimal-after.json](minimal-after.json)：原CPU复现仅适配本worktree的路径与固定view导入，生产调用不传新headroom也已为410+10=420。CPU不声称GPU性能。
- [browser.mjs](browser.mjs) / [after.json](after.json) / [browser.txt](browser.txt)：冻结提交、GPU、逐帧真实双侧计数、requests、解码值、层级、资源生命周期、自动断言。
- [input.json](input.json)：原manifest SHA256、LOD资源hash/bytes，原nearDetails字段均缺失。
- [tests.txt](tests.txt)、types.txt、build.txt、package-results.json：最终验证日志。

复跑条件同上级handoff：先构建原beijing-cbd-grow-1 fixture并启动本地5184 Vite，运行本目录minimal.mjs与browser.mjs；Playwright/Chromium路径可按环境调整。不提交生成模型。

## 验证与独立审查

- 全套 `npm test` 277/277通过；类型检查、legacy/Studio/SDK三项build通过。
- 包验证通过，offlineInstall、strictTypes、builtStudio均true。
- 最终提交adfbde7上CPU复现和六组真实SDK所有断言通过。
- 独立只读gpt-6.1-sol/xhigh审查先发现多块延迟替换的备用准入P2：A high120tri/10near、备用528tri/0near，B进入120tri/10near；medium异步等待时，旧componentwise规则拒绝备用，留下20near。现按整帧替换后结果判断，立即保留两块覆盖为648tri/10near，随后正常挂载medium。精确状态回归已加入。
- 最终独立审查adfbde7无未解决可操作发现，29/29定向CPU回归、diff-check通过；审查者无文件编辑或GPU测试。

预算类型的nearDetails既有字段增加语义注释；没有新增SDK配置、没有修改开放getStats方法签名。主场景计数可读 `runtime.nearDetails` 或 `runtime.frameCost.nearDetails`，总计需加 `nearAttachments.nearDetails`。例：`const s=viewer.getStats(); const total=(s.runtime?.nearDetails||0)+(s.nearAttachments?.nearDetails||0);`。SDK不把此数称为三角数、feature数或GPU显存。

交付E/主对话：在原D提交后依次合入ff3c33b、adfbde7及本证据commit；A的正式可选字段可独立合并，D缓存对旧资产仍有效。最终12案及AC总体验收仍由E和主对话在整合后执行。
