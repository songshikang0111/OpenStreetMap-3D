# E · 修复后集成验证与交接

本目录记录 E 的最终集成结果，交主对话进行独立最终验收。完整 12 案真实浏览器测量及原始数据重算均为 **pass**，进程退出码均为 0；未提高默认预算、删除案例或移除失败帧。

## 版本与证据边界

- 产品/场景/性能统一冻结：`55862f0a2649fb9289331c9ea19b2325f35f3037`。全部 12 份 `build.compilerCommit` 与运行环境提交相同，测量期间 HEAD、工作区及生产 SDK 哈希持续锁定。
- root 独立全量功能检查在 `e11990c5dc6175dbdae7c2789b2c3a4e4f7f0a9c` 完成；冻结提交只增加 A 的证据文档，`bin/src/studio/packages/schemas/package*.json/scripts` 零 diff。[版本、169 个源码文件 SHA256 与 SDK 哈希](final-checks/version.json)。
- 最终 E 归档提交仅更新本目录及 `docs/support.md`，不改变测量产品。SDK SHA256：`d867e0608eb7e7e3cc16f75f1d90e219f47cfbdcf94ea9b19d3d07c20b48e66b`。
- [旧集成失败记录](../../integration/acceptance.md)、[旧 root 验收](../../root-acceptance/)与[修复候选 cf9c74f 被边界反例否决的记录](attempts/cf9c74f-pre-boundary/README.md)保留。前两目录相对基线 `dee3cc8` 零 diff。

## 验证结果

| 范围 | 结果与原始证据 |
| --- | --- |
| 全量单测 | root 独立运行 344/344 pass、无 skip/cancel：[TAP](final-checks/tests.tap)、[退出码](final-checks/checks.json) |
| 类型、三套生产构建 | root 独立检查均 exit 0：[types](final-checks/types.txt)、[build](final-checks/build.txt) |
| 生产安装包 | root 独立 npm pack、离线 `--omit=dev` 安装、公共 Node 类型及真实外部画风 CLI 导出通过；esbuild 为生产依赖：[结果](final-checks/package-results.json)、[日志](final-checks/package.txt)。此文件是 root 15:07 的实测结果副本，不是 E 新跑的检查 |
| 最终集成 CLI/API | 7/7 pass：确定性离线重建、输入锁、batch 部分失败恢复、静态发布取消保留旧站、实际 API 边界/worker 取消恢复、PNG/GLB 签名、真实中国尊配方版本更新与回滚：[结果](e2e-results.json)、[PNG](sample-export.png) |
| 全 12 案 GPU/资源/预算 | 12/12 pass；[可读表](performance/README.md)、[完整重算](performance/assessment.json)、[环境/冻结提交](performance/summary.json)、[runner 输出](performance/runner.txt)。同名 JSON 保留全部逐帧/GPU/网络数据，PNG 为实际画面 |
| 最终标准站点 | 四官方画风与 project-sepia、相对入口/裸依赖/CSS/SVG、离线阻断外网、非根路径、CSS 生命周期、初始化失败清理、CLI web/png/glb 及无效画风保留旧站均 pass：[浏览器](style-export/browser-results.json)、[CLI](style-export/cli-results.json)、[可重跑脚本](style-export/verify-standard-export.mjs) |
| 最终 Studio CUA | fresh 公共 CLI 服务，保存/刷新恢复 `.12/.42` 参数、low 质量与 street 标签；白模释放 CSS、外部完整草稿恢复并应用；按钮导出标准网页 succeeded；console error 0：[状态](studio-final/ui-results.json)、[截图](studio-final/studio-external.png) |
| AO 参数 | root 在同一产品源码上实际 WebGL 检查 6 项通过，0/.12/.9 三份 PNG 哈希不同；low 关闭 AO 而保留 .12，高/均衡继续使用 .12：[记录](final-checks/root-ao/results.json)、[.12 图片](final-checks/root-ao/ao-0.12.png) |
| 真正在线获取 | 最终提交上明确选择 Dresel Europe GET，首次 cacheHit=false、随后离线 cacheHit=true，再 build/validate pass：[正式 CLI 原始命令、结果和来源哈希](formal-live-cli.json)。Studio 的实际在线下载、缓存、构建、渲染另见[早期 UI 来源核对](preflight-studio/live-source.json) |

12 案为北京、京都各 6 案：相同范围 1/4/16 分块，以及固定物理块 1/4/9 覆盖。Windows 10.0.26300 / Chrome156 / i5-13600KF / RTX4090 / Node22.11，1280×720、DPR1、balanced，每案路径至少 60 秒，之后 far/full/far 与 5 次离开/返回。RAF p95 均 8.4ms；GPU p95 4.84–7.16ms。全部路径物理帧最大值为 599,956 triangles、739 draws；最大估算驻留 52,837,111 bytes，最大共享 near 数量 1,104，默认上限仍为 600,000 / 1,200 / 128MiB / 并发3 / near18,000。资源字节是 CPU 数组/估算，不是实测显存。

北京 grow-1 的 t13、t19 相机沿用旧失败记录的精确机位，未重新选择。每段不少于 15 秒、1,801 个物理帧、151 个相机采样，均 0 换块、0 transition、0 取消、0 CINK 请求；相机、覆盖、连续帧与样本检查全部通过。原报告 SHA256 及历史提交保存在环境记录中。

最终 A 资源在这两个固定机位自动稳定于 medium；60 秒路径实际包含 high/medium 和附件恢复。旧 D fixture 中的固定 high 结果不代表本轮静止机位。本轮路径合计 86,146 个物理帧（含 12 个首帧）、86,134 个 RAF 间隔、86,133 个 GPU 结果及 13 个 pending，active=0；GPU 查询容量固定为 8。两个静止窗口的额外记录单独保留。

在线记录为慕尼黑 bbox `48.137,11.575,48.1375,11.576`，获取于 `2026-11-03T15:09:50.108Z`，OSM base `2026-11-02T21:21:26Z`，1,111 个元素、5 个 building-tagged records、1 chunk。原响应 SHA256 为 `caa4e0dc9c7e4a493f5ba6fd688cdbf9e8c7f4759d04d4b0ed9690a58cc5d880`。Dresel 是欧洲日更提取；[默认 FOSSGIS POST 的失败记录](../data/default-main-results.json)仍保留，不能从此次成功外推所有服务可用。合成 UI/离线样例、仓库快照均未计作实时下载。

## 修复交接索引

- A：真实面域裁切、混合 LOD 的 ground/road 覆盖、桥梁外表皮与原子身份一致性；最终精确边界面候选选择修复为上游 `3b62b40`，集成为 `e11990c`，没有提高面积或 epsilon 容差。[交接](../core/handoff.md)、[边界回归](../core/boundary-regression.json)、[12 案 CPU 成本](../core/cost-summary.json)。
- B：可选数据源/传输/明确回退、429 全 worker 节流、缓存/来源/原子写入。[交接](../data/handoff.md)。
- C：真实项目入口打包、局部依赖/资产、外部画风与参数校验，失败不替换已发布站点。[交接](../styles/handoff.md)。
- D：独立物理 draws/triangles/pass 预算、必要粗覆盖与缓存隔离、共享 near 总量、静止滞回与合法 AO 参数。[交接](../runtime/handoff.md)。
- E：Studio 完整配置/草稿、同一编译模块 SDK 与画风注册、预览 CSS 生命周期、跨项目/异步任务竞态；数据获取策略不使已有几何失效；公开 Node 打包导出与生产依赖、schema 修复；首物理帧与 near 原始记录、GPU 查询窗口与完整性门禁。[Studio 独立审查](review-studio/policy-status-review.md)、[测量工具独立审查及旧反例](review-harness/)、[早期实际 UI/下载和失败重试](preflight-studio/README.md)。

## 复现

先切换到测量提交或产品源码完全一致且 tracked 工作区干净的提交，再执行下列命令。整轮测量避免其他 GPU 或重 CPU 任务；运行器会拒绝提交、场景编译版本、SDK 哈希漂移。不要覆盖本目录原始记录，复跑请指定新输出目录。

```powershell
npm test
npm run test:types
npm run build
npm.cmd run check:package -- --output=work/replay-package.json
node scripts/phase1-build-cases.mjs work/remediation-integration-scenes
node scripts/benchmark-integration/run.mjs --seconds=60 --stationary-seconds=15 --output=work/replay-performance
node scripts/phase1-summarize.mjs --input=work/replay-performance
node scripts/phase1-integration-check.mjs --output=work/replay-e2e
node scripts/phase1-remediation-studio.mjs --workspace=work/replay-studio
node bin/city.js studio --workspace work/replay-studio --port 4183 --json
```

本轮实际将 `kyoto-gion-fixed-16` 放首位，随后其余 11 案，仍是完整唯一案例集。CPU 场景构建原始信息见 [build-summary](final-checks/scene-build-summary.json) 与[输出](final-checks/scene-build.txt)。默认 npm 参数转发在本机 PowerShell 曾被忽略，包检查最终写入默认 `integration/package-results.json`；归档副本与 root 文件的日期、提交、140 文件、560,316 bytes 一致。

复制项目重验时请区分地图缓存与 `.city-cache/jobs`：后者含原绝对路径，是本机任务状态；误复制会被 `JOB_PROJECT_ESCAPE` 拒绝。保留并移出副本旧 jobs 后新建队列，数据快照/来源/地图缓存保持原样；详情见[支持与故障恢复](../../../support.md)。

最终 CUA 及命令测试的浏览器均已关闭；E 的 4181、4183 公共本地服务已停止。无 push、发布、主分支合并或部署操作。
