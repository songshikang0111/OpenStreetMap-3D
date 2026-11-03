# 最终集成独立架构／数据／协议审查

日期：2026-11-03（Windows x64，Node v22.11.0）。角色：`/root/architecture_review`，非实现者。工作仅在 `codex/phase1-integration` 的指定 worktree；未修改产品文件、未暂存、未提交、未操作 main／其他 worktree。只新增获准的 ignored `work/architecture-review/` 复现脚本和结果。

主要审查功能提交：`2c013fb0f8114c2dd1cba67ee1a2cd131e565aed`。此前核心／协议／导出完整定向复验功能提交为 `6f77859`，此次追加真实 Three.js／OrbitControls 相机复验。当前 `29ebab7` 仅修 CLI 测试的时序假设，实际产品代码仍为 `2c013fb`。旧 `73738b3` GPU 八案矩阵已取消并整体移入 ignored `work/performance-before-street-camera-fix/`，不再作为正式最终矩阵；正式 `performance/` 只接受最终相机修复后 bundle 的 12 案。

结论：本角色已复现的代码 P1/P2 均已由实现者修复并复验关闭；新增上视相机／残余阻尼缺陷由另一独立角色发现，本角色已在 `2c013fb` 独立复验关闭。审查范围内未再发现未关闭的 P1/P2。**一期整体不能宣布全部通过**：AC04 真实下载仍失败；旧 GPU 样本有默认三角预算未达风险，最终 AC18／AC20 结论必须等待相机修复后新 bundle 的完整 12 项矩阵。本角色未启动任何 GPU 浏览器，Node 资源往返不是 GPU 内存测量。

## 发现及关闭

| 发现 | 原始事实与位置 | 修复／独立复验 |
| --- | --- | --- |
| P1 默认官方配方未纳入构建指纹 | 原 `src/cli/tasks.js` 仅指纹化 src，Temp 真实副本的新进程将官方版本／ribWidth 改变后 validate 仍成功，inputs 相同但 contentHash 不同 | `774732c`／`445796a` 纳入 packages；原复现现返回 STALE_ENGINE，engineHash 和 contentHash 改变；最终 engine 回归通过 |
| P2 分块丢失权威材质角色 | 原 `src/core/geometry.js` 丢 geometry.userData，单原材质的语义 groups 未保留；外部风格仅收到 wall | `774732c` 保留 groups/table、low 建立角色组；独立 1/4/16 块、全三档实际 bindSceneStyle 收到 wall/roof/structure，重绑成本与清单一致 |
| P2 公开角色属性与分组矛盾 | 原 `src/core/index.js` 用 normal 启发式覆盖实际角色；medium/high 各 22794/36204 顶点引用错误 | `dc122ce` 按权威组写属性、拆共享索引顶点；原统计错误归零。自建双三角共享索引／双自定义角色的 Mesh、InstancedMesh 在三档和 1/4/16 块、逆序输入下位置／角色／实例属性签名一致 |
| P2 GLB 丢标准实例色及单实例身份 | 原 `src/sdk/exports.js:47–52` 展开实例时忽略 instanceColor；实际 GLB 两节点均白色且同 featureId | `0d33378`；真实 CINK→真实 GLTFExporter 的 loaded/complete 两范围输出 [.5,0,0,1]／[0,0,.5,1]，featureId a/b 与 node/1、node/2 对应正确 |
| P2 GLB 编码后不检查取消 | 原 `src/sdk/exports.js` await parseAsync 后直接成功；编码期间 abort 仍返回 2320-byte GLB | `0d33378`；异步 Blob/FileReader 兼容层在实际编码阶段 abort，现在拒绝 AbortError；没有替换 GLTFExporter |
| P2 drawUnits 负成本绕过预算 | 原纯 validator 不校验新字段；真实 compile 产物负成本仍 valid，预算为 1 时选择 high，triangles/calls=-35000000000 且未超限 | `73738b3`；负数、低估、分数、越界 bounds、逆序 bounds、非数组、safe-integer 溢出七类全部由 core 和 runtime manifest 阶段拒绝；legacy 缺字段回退保留 |
| P2 保存配置与 SDK 的 FOV 范围不一致 | core／Schema 原接受 0<fov<180，SDK 只接受 [5,140]；合法保存的项目会在预览恢复时被拒绝（源码确定分支，未启 GPU 复现） | `6f77859` 统一 [5,140]；独立检查 1/4.9/140.1/170 拒绝且配置字节不变，5/140 可原子保存，Schema、SDK、slider 一致 |

## 实际执行

在上述 worktree 执行：

```powershell
node --test test/phase1-core.test.js test/phase1-e2e-core.test.js test/phase1-runtime.test.js test/phase1-runtime-integration.test.js test/phase1-e2e-gpu.test.js test/phase1-e2e-engine.test.js test/phase1-e2e-project.test.js test/phase1-e2e-glb.test.js
node --test test/phase1-data.test.js test/phase1-cli.test.js test/phase1-e2e-glb.test.js
node node_modules/typescript/bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 test/phase1-core.types.ts examples/embed/typecheck.ts examples/quickstart/typecheck.ts
npm pack --ignore-scripts --dry-run --json
node work/architecture-review/reproduce-export.mjs
node work/architecture-review/review-node-flows.mjs
node work/architecture-review/review-streaming.mjs
```

- `6f77859` 核心／运行时／GPU timer 状态机／engine／project／GLB：**71/71 pass**。GPU timer 测试使用查询状态机 fixture，仅证明非阻塞轮询、跨全部 render passes 的 begin/end、disjoint、预算、异常、reset/dispose 所有权，不是硬件计时。
- 数据／CLI／真实 GLB：**30/30 pass**；源模式 Vite fixture 关闭时出现 dep-scan outdated 的 stderr，测试退出 0，无测试失败。
- 三个严格 TS 消费者通过；包括正式 core／SDK／Style API 的真实声明。
- 2c013fb 产品代码的 dry-run 121 文件、703770 bytes，SDK／类型／静态 bundle 入口存在；无地图大样本、缓存、CINK、GLB、TGZ 或私有目录。最新修复后的正式 prepack/build + 隔离安装由集成者收尾；本角色未再次执行会重写构建产物的 npm build／完整安装脚本。
- 真实 worker：基线 build 成功；运行中第二持锁者收到 PROJECT_BUSY；取消保留旧 manifest；关闭／重开队列恢复同 job，attempt=2 成功；两版本地声明式配方实际改变资产，rollback 后 assetHashes 与 contentHash 精确恢复。
- 近景归属：1/4/16 块均为 8 面普通墙、349 棵树；5 个被正式配方接管的建筑不再生成 generic 近景框；所有树完整、key 唯一、ownerChunk 正确。三种切块／逆序输入的 metadata 签名均 `d46ab8b2fdf8d68080ae5a263598e8c893cd6326f817fd8bc83571b51f829fca`。输入是明确标注的 synthetic continuity fixture，不冒充测绘实景。
- 实际 CINK／官方 comic 绑定／近景框的五次 Node 往返：每轮主几何 CPU 数组 1054794 bytes，近景 65992 bytes、224 个框，完全一致；每轮远离后引用归零，最终 streamer/near 引用数、classification clones、estimatedBytes 均为 0。没有 WebGL 渲染，没有实测显存。

脚本和原始 JSON：`reproduce-export.mjs`／`export-reproduction-results.json`、`review-node-flows.mjs`／`node-flows-results.json`、`review-streaming.mjs`／`streaming-results.json`，均位于 `work/architecture-review/`。

## 验收范围与明确非 pass 项

| 项目 | 本角色结果 |
| --- | --- |
| AC06 项目复现 | pass：真实 worker、版本指纹、确定资产及回退 |
| AC07 取消／恢复 | pass（Node 实际 worker）；工作台 UI 由另一独立角色验收 |
| AC09 协议 | pass（真实 CINK、roles/IDs/实例、损坏验证、正式风格 CPU 绑定）；硬件 shader 画面未由本角色重跑 |
| AC10／11 分块／归属 | pass（1/4/16 位置、身份、属性、近景唯一归属）；真实浏览器视觉接缝未由本角色重跑 |
| AC12 道路／水域 | 共享三角形不随切块改变的 CPU 断言 pass；最终真实画面接缝 not-run（本角色） |
| AC15 地标更新 | pass：真实 worker 两版规则、锁、重建和精确回退 |
| AC16 LOD | pass（真实不同 CPU 资产）；真实 WebGL 提交由父任务原始实验及另一角色验收 |
| AC18 全部预算达成 | **未通过／等待最终矩阵**：修前 737 raw 的整帧 triangles p95=2638236>默认600000，为历史风险，不能当成 2c013fb 正式结果；明确诊断不等于预算达成 |
| AC19 生命周期 | pass（本角色 Node 引用／数组五往返）；最终硬件矩阵 not-run（本角色），旧 737 raw 抽查只保留为修前历史 |
| AC25 服务边界 | pass（Node 测试：loopback/Host/Origin、路径／junction、项目／队列锁、取消和固定任务枚举） |
| AC26 包边界 | pass（当前 dry-run 文件和入口）；最终隔离安装／生产 bundle 的最新修复验收由集成者收尾，本角色 not-run |
| AC27 独立审查 | 此架构角色完成且所有发现复验关闭；另一独立 UI／SDK／硬件角色及最终矩阵须另有结论 |

其他验收：AC01 全量旧测试／build、AC02/03/08/13/14/17/21 的完整 UI／静态浏览器流程、AC22 PNG 像素／署名实际图像、AC23 的真实多项目总链、AC24 陌生开发者浏览器扩展，不由本角色本轮独立重跑，不借作者组件 pass 宣称整项完成。AC04 当前仍为 **fail**：最新已读 `integration/network-results.json` 日期 2026-11-03T10:14:09.362Z，默认源 TIMEOUT；本角色没有再发外网请求。AC20 修前 737 八案矩阵已取消并归档，最终 2c013fb 新 bundle 的 12 案矩阵待重新运行，维持 **not-run／未完成汇总**；旧样本不能用作最终通过依据。

## 修前 73738b3 GPU raw 的历史抽样审计（不作为最终矩阵）

当时只读审计父任务的修前 fixed-1 JSON；完整原始文件现单独保存为 `work/architecture-review/fixed1-before-camera.json`，来源为 `work/performance-before-street-camera-fix/beijing-cbd-fixed-1.json`，对应旧 `73738b3` bundle，不会与今后正式目录的同名结果混淆：60 秒路径，7199 个原始帧、帧时间跨度 59985.8 ms；独立用 nearest-rank 重算 RAF p95=8.4 ms、GPU p95=5.479424 ms，与报告一致。硬件记录 Chrome 156、WebGL2、NVIDIA RTX4090；GPU query created-deleted=1≤maxPending8，7199 个硬件样本；五个生命周期循环存在。源码 `GpuFrameTimer.begin/end` 包裹整个 pipeline.render，renderer.info.autoReset=false 后每帧 reset，rendererPrograms 在全帧统计中记录。

同一 raw 的三角 p95=2638236 > 600000；存在 LOD_BUDGET_DOWNGRADE、MEASURED_DRAW_BUDGET、COVERAGE_EXCEEDS_BUDGET。帧率目标达到、最低覆盖预算未达是两个独立结论。旧 737 八案均已取消／归档；没有将其作为最终全矩阵结果。最终相机修复后新 12 案完成后再追加只读 raw 复核。本角色没有抢用 GPU，也没有将 CPU 数据称为硬件 GPU／显存证明。非 Windows、移动 GPU 未验证。

## 2c013fb 相机修复独立追加复验

命令：`node work/architecture-review/review-camera.mjs`；`node --test test/phase1-e2e-camera.test.js test/phase1-runtime.test.js test/phase1-e2e-project.test.js`。后者 **18/18 pass**，真实相机复现和结果位于 `review-camera.mjs`／`camera-results.json`。

- 使用真实 Three.js PerspectiveCamera 与 OrbitControls，无 DOM、无 WebGL；旧 `.495π` 限制在原街道上视机位产生 3.23568112276681 m 位置偏差，确认了原问题。
- 修复后四个机位包含两个街道上视、一个低机位上视及一个俯视；在真实 controls 中先留下旋转／平移／dolly 阻尼残量，再 applyView，连续更新30次。位置最大误差 3.18e-14 m，target 最大误差 1.01e-14 m，视线方向最大误差 3.52e-16，均远小于 1e-8；fov／near 正确，enableDamping 恢复。
- 九类无效输入（含 null/undefined、NaN near、FOV越界、缺维target、非有限position/target、near0）全部在任何 camera／target／FOV／near／projection／damping 状态改变前拒绝，验证异常原子性。
- 只读核对 SDK 初始化 `controls.maxPolarAngle=Math.PI`，setView 委托 applyView 后 invalidateSchedule；实际 SDK 模块可在 Node import。本角色没有创建 WebGLRenderer 或抢用浏览器；视觉与硬件指标仍由另一角色及最终新矩阵给出。

此前角色／编码／worker／生命周期结论未因本次仅相机接线改动而重新冒充全量重跑；本节记录的是上述实际新增验证。
