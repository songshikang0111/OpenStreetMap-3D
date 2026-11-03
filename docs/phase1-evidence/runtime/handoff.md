# 一期 D：Web SDK、LOD 与扩区性能交接

日期：2026-11-03。分支：`codex/phase1-runtime`。工作目录：`C:\Users\宋世康\.codex\worktrees\phase1-runtime\beijing-city-ink`。**当前实现和独立缺陷复验已完成，完整性能矩阵仍在运行；本文件会在矩阵完成后更新，当前不是最终 AC20 通过声明。**

## 提交与依赖

仅集成下面 D 提交；C/A 原提交若已集成，不要再 cherry-pick 本分支的依赖副本。

| D 提交 | 内容 |
| --- | --- |
| `41c1d8c` | 独立 SDK、调度、几何 LOD、资源生命周期、导出、fixture 与浏览器测量脚本 |
| `f55c12e` | 真实 CINK/官方风格、近景附件恢复、资源逐 mesh 视锥成本、默认生产绑定 |
| `2776a4f` | prepared geometry 驻留反馈、浏览器实际 transfer/body 计数 |
| `d8cbb9e` | 独立审查发现的五项异步/共享纹理/近景预算/协议验证缺陷修复 |

本分支为实际验证 cherry-pick 了 C `09a08cb`（本地 `e44b9db`）、A `4b9eab7`（本地 `8771df6`）。合并 `city.js` 时保留 C registry/style 行为，同时保留 A `landmarksEnabled`、`roadPlan`、`streetlifePlan`。上游后续审查/文档提交没有在这里重复混入。

## 已实现接口

`src/sdk/index.js` 默认 `createCityViewer({container,manifestUrl,style,quality,budget,onProgress,onDiagnostic,onSelect,readAsset})`，直接静态绑定 A `.cink` decoder 与 C styles，无旧 main.js、固定 DOM ID 或 studio API 依赖。`manifestUrl` 相对 document.baseURI，所有块 URI 相对 manifest URL；默认 fetch，注入 readAsset 按 json/arrayBuffer 与 AbortSignal 契约工作。错误提供解析后的 URL 和阶段。

控制器：`load`、`setStyle`、`setView/getView`、`getStats`、`resize`、`dispose`，以及 `whenIdle/resetStats/pause/setLodMode/exportPNG/exportGLB`。style/export/load 安装共享串行队列；请求 epoch 保留取消能力；内部暂停独立于用户暂停。dispose 幂等并等待在途受控操作。

调度按 contentBounds、CSS 屏幕尺度/SSE、FOV 与视口选择等级，带迟滞与驻留时间。先加载 coarsest 覆盖，再保持旧资源到新资源就绪后原子替换；每帧最多挂载一个完成块。实际不同资产降低几何/传输/驻留，近景恢复旧窗框/阳台、局部树冠与枝干规则。并发限制涵盖 reader 未确认取消的在途操作，过期请求 AbortSignal 取消，离开视野后释放几何/实例/材质/纹理引用；风格 pipeline 的 classification clones 可按块释放，render targets 在 pipeline dispose 释放。

预算覆盖 residentBytes、全帧 triangles/drawCalls、并发、近景附件、DPR、阴影和 AO。先削近景附件与低显著性块；最低覆盖仍超限发 `COVERAGE_EXCEEDS_BUDGET`，不静默删除必要覆盖。附件先核对剩余 bytes/calls/triangles/count，紧预算不反复驱动主体升降级。原子替换允许有诊断的短暂 headroom；稳态受预算约束。`full/far` 模式是明确的测量 override，绕过自动 LOD 降级，不能把控制组超预算解释为自动策略失效。

PNG：当前视野/已加载细节，署名、16M 像素限制与尺寸恢复。GLB 必须显式 `scope:'loaded'|'complete'`；complete 独立读所有块并拒绝超导出预算的部分文件，返回 chunkIds。loaded 含当前近景附件；complete 含每块持久化 LOD 资源，不含所有相机位置可能生成的窗框/树冠。程序窗格/玻璃/漫画后处理仅以标准几何与颜色近似；结果对象与文档明确这一边界。

共享 Texture 的 GPU 引用跨 registry 保护。图片/bitmap 的 CPU 生命周期由 decoder 或 StylePack.dispose 管理，registry 不关闭外部源图；这样共享风格在卸载/重载后仍能重新上传。

## 必须保留的跨所有权适配

- `src/city.js` 返回 `runtimeDetails:{facadeWalls,trees}`，仅可序列化数据，不保存闭包代码。
- `src/core/index.js` 在 high chunk 的 `group.userData.city.nearDetails` 存 schemaVersion1、当前 owner 的 facadeWalls / trees。坐标为项目世界米制。walls 带原有 layout/style 与 featureId；trees 带 key/x/z/h/seed/rotation/variation/shape/featureId，供既有确定性近景规则重建。普通副本不重复跨块 ownership。
- LOD descriptor 可选 `drawUnits:[{bounds,triangles,drawCalls}]`，用于按保守包围球估计每档视锥提交，避免把近景一角误算成全块所有独立 Mesh 的绘制。没有此扩展时仍回退整块成本。最终以全帧 renderer.info 校正。
- `src/core/index.js` / `geometry.js` 输出 `city.schemaVersion=1`，修复新地表与合批远景的 C 风格兼容性。
- 纯 validator 分离到 `src/core/scene-manifest.js`，`core/index.js` 仍原签名 re-export，SDK 无须把 compiler 打入浏览器。
- `src/ink-renderer.js` 添加 prepareGroup/releaseGroup，按流式块清理分类 clones；aoEnabled=false 真正跳过 AO draw。旧行为默认不变。

## 验证与证据

- `npm test`：174/174（含旧138项）；`npm run build`：通过，保留既有 >500KB Three.js 提示。
- `node --test test/phase1-runtime*.test.js test/phase1-core.test.js`：26/26。
- `node scripts/benchmark-runtime/build-embed.mjs`：独立生产 bundle 构建成功。
- `check-browser.mjs`：非根路径、阻断外网、LOD 选择、4官方+外部风格、PNG/complete GLB、5往返/重载、重复 dispose 全通过，见 `embed/results.json`。
- `check-races.mjs`：独立审查的5个原始问题全部复验通过，见 `regressions/results.json` 与 `review/`。
- 独立审查模型/命令/发现/修复与额外边界复验见 [review.md](./review.md)。审查者只读测试，未代写实现。
- 原始完整性能矩阵写入 `browser/*.json`；冻结 bundle commit 为 `d8cbb9e`，运行在 127.0.0.1:5186，不受 Vite HMR 修改影响。最终表待矩阵完成后补充。

重现：先 `node --expose-gc scripts/benchmark-runtime/build-scenes.mjs`，再 `build-embed.mjs work/runtime-benchmark-site`、`serve.mjs`，最后 `run.mjs --seconds=60 --url=http://127.0.0.1:5186`。浏览器位置可用 CITY_BENCHMARK_BROWSER 或 `--browser=...`；Playwright 是测试依赖，E 可加根 devDependency/脚本，此任务没有修改根 package/lock/README/发布配置。

## 当前验收状态（组件范围）

| AC | 当前结果 | 依据/边界 |
| --- | --- | --- |
| AC01 | pass（测试/构建） | 174测试与生产构建；主站关键机位总验收仍由E负责 |
| AC08 | pass | 完整独立生产 SDK 非根路径、断外网运行 |
| AC09 | pass | 实际CINK、roles/attrs/IDs/instances，损坏/版本/错误阶段测试与默认validator |
| AC13 | pass（SDK） | 官方4风格及外部StylePack；完整场景角色来自C契约 |
| AC16 | pass | 真实三档资产，实际全帧远/全对照；近景规则恢复 |
| AC17 | pass（组件） | 迟滞/驻留/FOV/移动，原子替换；紧预算静止抖动修复并独立复验 |
| AC18 | pass | 并发/取消/驻留/附件/超限诊断；明确原子替换临时headroom |
| AC19 | pass | Node5次往返、生产浏览器5次往返/重载、独立复验与共享纹理回归 |
| AC20 | not-run（完整矩阵未结束） | 禁止把此前5秒短测当60秒性能通过 |
| AC21 | pass（SDK静态嵌入） | 生产站非根路径/阻断外网；CLI export-web 完整工作流由B/E验收 |
| AC22 | pass（SDK） | 署名PNG、全区域GLB、强制范围与导出限制；CLI封装由E验收 |
| AC24 | pass（SDK资料/接口） | SDK类型、embed教程、可复现实验脚本；根包入口/CI由E负责 |
| AC27 | pass（独立组件审查） | 5项真实缺陷修复后复验通过；整体集成独立角色仍由E负责 |

## 集成说明与限制

E 按依赖先保留 C/A，再顺序 cherry-pick D 提交；不要丢上述 city/core/ink 适配。重新 build 以写出带 nearDetails / drawUnits 的真实场景；旧已构建资源仍可加载，但不会凭空拥有未序列化的旧动态近景描述。E 应再次运行完整实际 OSM、工作台和静态导出链路。

大面积最低细节仍可能超过绘制预算，SDK会诊断并保留覆盖；不能据 RTX4090 上帧率通过宣称任意区域/移动端可用。性能统计是整帧（含阴影、所有后处理）；`geometryArrayBytes` 是 CPU 数组，`estimatedResidentBytes` 是估计，不是实测显存。GPU timer 未采集，不能把 CPU/RAF 数字宣称 GPU 时间。移动GPU、其他浏览器/操作系统未验证。

原始 `build-fixtures.mjs` 与 fixture-codec 是明确标注的合成/旧几何适配测试，不作为最终真实 CINK 集成成功依据；最终完整矩阵使用 core-* CINK 场景。生成模型/缓存位于忽略的 work/，不随 Git 或 npm 包提交。
