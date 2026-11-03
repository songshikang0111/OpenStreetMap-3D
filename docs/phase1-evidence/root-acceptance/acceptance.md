# 一期主对话整体验收

日期：2026-11-03。被验产品提交：`7c837551f5e364c98bbc19adf8d5af73a6a2ab85`，分支 `codex/phase1-integration`。主对话未实现本期产品代码；另由两个 `gpt-6.1-sol / xhigh` 独立角色分别审查架构与性能，主对话执行工作台浏览器验收并重跑基础检查。此轮只提交验收文档、脚本和证据，未修改产品。

**结论：五个开发子对话都已结束并交付，代码已经集成；一期整体验收不通过。** 本报告取代旧集成报告的最终放行结论，保留原始测量历史，不修改规划或预算来取得通过。

旧报告中的独立工作台 UI 未执行问题已补齐，但新审查发现三项产品缺陷。最终矩阵为 **21 项 pass、6 项 fail**；其中 AC27 是缺陷修复后复验尚未闭环，并非又出现一项独立产品缺陷。AC04、AC18 是原有未通过项；AC17、AC21、AC24 依据新证据降为 fail。

## 子对话状态

通过 Codex `wait_threads` 紧凑快照逐个检查，五个任务均为 idle / 最近 turn completed。结束对话不等于验收通过。

| 任务 | 交付 | 最后报告提交 | 当前状态 |
| --- | --- | --- | --- |
| A 核心 | 场景模型、编译协议、连续分块与归属 | `198a8e0` | 已交付并集成 |
| B 数据/CLI | 搜索、下载、项目、任务服务、批处理 | `e626097` | 已交付并集成；真实下载未通过 |
| C 地标/风格 | 中国尊/央视配方、规则包、官方/外部风格 | `8300ee7` | 已交付并集成 |
| D SDK/运行时 | Web SDK、LOD、流式加载、性能证据 | `176d798` | 已交付并集成；预算仍失败，本轮新增稳定性缺陷 |
| E 工作台/集成 | 本地 UI、打包、总链与验收归档 | `7c83755` | 已完成集成；未宣称一期全通过 |

线程 ID 与 worktree 见 [执行清单](../../phase1-execution.md)。未向 main 合并、推送、公开发布或启动新一轮产品开发。

## 本轮实际检查

- `npm test`：**264/264 pass**，无跳过；[完整 TAP](tests.tap)。
- `npm run test:types`：通过；`npm run build`：旧演示、Studio、SDK 三套构建通过。[退出状态](checks.json)、[类型输出](types.txt)、[构建输出](build.txt)。保留既有 >500 kB 分包提示。
- `npm run check:package`：**121 文件**，704,445 bytes 压缩包；隔离目录离线安装、严格类型、安装后真实 CLI init/build/validate/export 和本地服务均通过。[打包结果](package-results.json)。
- 正式 Chrome 扩展 / CUA 独立操作：打开合成离线样例、构建、彩色/低质量/街道视角、保存、刷新恢复、以真实相对路径打开、PNG/GLB 下载、静态站点导出及非根 URL 打开，四官方画风均显示。[操作与文件签名](studio-results.json)、[重开截图](studio-reopened.png)、[实际 PNG](studio-export.png)。本轮没有阻断外网，因此此 UI 操作本身不是断网实验；断网项保留已有独立拦截外网的证据。
- 自定义风格导出失败由主对话在浏览器现场确认：页面显示 `Unknown style: project-sepia`。[截图](static-custom-style-error.png)、[DOM](static-custom-style-dom.txt)。
- 重新运行本目录架构复现、风格参数探针、性能原始数据审计及固定相机 CPU 调度复现。网络 live 探针由架构角色执行；没有反复向公共端点重试。
- 性能审查独立重算 **86,109 个整帧及 86,109 个 GPU query 样本，0 项不一致**。当前构建 SDK SHA 与冻结硬件报告一致。此轮没有重跑 12 组 GPU 计时；沿用并核对原始硬件证据，固定相机 CPU 模拟只证明调度行为。

## 阻断验收的具体问题

### R1：静止镜头下反复切换 LOD / 取消同一资源（P2，AC17）

北京 grow-1 已保存的 60 秒真实浏览器 raw 中，一个块有 31 次 swap、149 次取消；medium 同 URL 请求 160 次。新固定相机 CPU 调度复现使用真实 manifest/CINK 和生产调度器：路径 t=13s 的镜头保持 15 秒，high↔low 切换 28 次，high 只驻留 160–200ms；t=19s 固定镜头产生 81 次取消。

`src/sdk/index.js:161` 把 draw 和 triangle 比例的最大值共用为放大系数，`src/runtime/streamer.js:28` 又扣除上一帧近景附件成本；`src/runtime/policy.js:66` 的预算降级绕过最短驻留，产生反馈循环和请求反复取消。此行为不因参考 GPU 帧率达标而消失。详见 [性能审查](performance/final-review.md)、[固定镜头结果](performance/stationary.json)。

归档路径调整后主对话再次运行，t=13s 仍有28次swap，t=19s有83次取消，见 [复跑结果](performance/stationary-recheck.json)。异步文件读取和事件循环会改变精确取消数，结论不依赖某个固定次数；两次都出现静止视野下持续抖动，均不是GPU性能实验。

### R2：默认绘制预算不满足（AC18，原有缺口）

12 组真实路径中，**10 组 triangle p95 超 600,000，2 组 fixed-16 的 draw p95 为 1,298 / 1,404，超 1,200**。并发、返回后的驻留估算和资源释放有通过证据，但不等于绘制预算通过。应继续降低粗层几何、合理分配覆盖与细节；不能隐藏必要建筑或提高阈值来改写验收结果。

### R3：自定义项目画风无法随标准网页导出（P2，AC21）

真实构建后保存 `style.id=project-sepia`，`export web` 返回 succeeded 且无诊断；`src/cli/export.js:19` 未携带用户风格模块，`studio/static-viewer.js:2` 也没有模块注册入口，独立打开导出站点即报错。正式项目契约缺少 module/entry 映射，所以本报告不要求按文件名自动扫描；缺口是没有标准打包途径，也未拒绝无法独立加载的导出。

SDK 教程的显式 `registerStyle` 路径已实现，AC13 保持 pass。旧 AC21 引用的外部风格浏览器证据来自手工 consumer/app，不能替代 `export web` 产物的验证。[架构复现](architecture/findings.json)、[独立审查](architecture/final-review.md)。

### R4：合法风格参数被 SDK 覆盖（P2，AC24）

`aoStrength` 是公开风格 Schema 参数；实际 `createStylePipeline({style:{id:'comic',parameters:{aoStrength:.12}}})` 得到 `.12`。`src/sdk/index.js:79` 随后将所有 ink pipeline 的值强制设为 balanced/high 的 `.65` 或 low 的 `0`。因此 Schema/保存配置与实际效果不一致。低质量可以明确禁用 AO，但开启时应尊重风格参数。此项的管线部分为真实执行，SDK 覆盖部分为源码确认，未宣称用截图量化了 AO 差值。

### R5：标准真实下载仍未成功（AC04，原有缺口）

相同明确小 bbox，正式 `fetchArea` 使用默认 Overpass、产品 75 秒 timeout、0 retries，在 **1.317 秒返回 HTTP502**；同 Node 通道 Photon 查询“北京 中国尊”在 2.407 秒返回候选。故不能归因于全部外网断开，也不能只归因于此前 20 秒 timeout 偏短；无法区分公共源与网络中间链路具体故障。[网络观察](architecture/network-observed.json)。fixture 通过不代替成功下载和缓存证据。

低层 API / batch 可指定 endpoint，但普通 CLI data fetch 与工作台缺少同等配置入口，限制自托管和默认源失败时的可用性；这是需要补齐的产品入口观察，不能伪称已定位 502 根因。

## AC01–AC27 最终矩阵

未改变的项使用 [原集成证据](../integration/acceptance.md) 并结合本轮抽查；pass 仅覆盖该行陈述范围，不表示任意平台、无限区域或所有 OSM 输入均已验证。

| AC | 结果 | 本轮依据 / 限制 |
| --- | --- | --- |
| AC01 旧功能 | pass | 264 测试及三套构建重跑；旧演示/同输入 SDK 关键机位沿用独立对照。 |
| AC02 离线样例 | pass | 本轮工作台样例、安装包离线 CLI；断外网浏览器证据沿用既有独立实验。 |
| AC03 地点范围 | pass | 既有候选/范围 fixtures；本轮真实 Photon 单例成功，不承诺公共服务 SLA。 |
| AC04 标准下载 | **fail** | R5，尚无成功 live 获取；默认源或链路 502。 |
| AC05 缓存原子性 | pass | 全量回归；既有缓存破坏/取消保旧结果。 |
| AC06 项目复现 | pass | 真编译/安装后 CLI 与既有锁、哈希、更新回退证据。 |
| AC07 取消恢复 | pass | 全量回归；既有真实 worker 取消、重启、同 ID 重试。 |
| AC08 独立 SDK | pass | 独立消费及本轮无工作台依赖的非根静态网页。 |
| AC09 场景协议 | pass | CINK/属性/身份/角色/损坏检测回归与既有独立浏览器。 |
| AC10 连续坐标 | pass | 既有 1/4/16 世界几何与接缝审计。 |
| AC11 对象归属 | pass | 既有跨块、地标分组、近景附件唯一归属证据。 |
| AC12 道路水域 | pass | 全区规划与已有几何/关键机位证据；无测绘级或任意输入承诺。 |
| AC13 独立风格 | pass | 显式注册外部风格无需改核心；R3 属标准导出，R4 记入公开契约一致性。 |
| AC14 地标迁移 | pass | 既有中国尊/央视身份、分组、来源与退化回退验证。 |
| AC15 地标更新 | pass | 既有真实中国尊两版本规则、兼容、锁定、哈希精确回退。 |
| AC16 真实 LOD | pass | 真实三档资源；原始 far/full 几何、绘制量降低独立复算。 |
| AC17 镜头稳定 | **fail** | R1，真实路径请求抖动与固定镜头调度复现。 |
| AC18 默认预算 | **fail** | R2，10/12 三角预算与2/12 draw预算失败，R1另有请求风暴。 |
| AC19 生命周期 | pass | 既有12案各5轮，共60轮返回基线，独立复算一致；非实测显存。 |
| AC20 扩区帧统计 | pass | 既有12案各≥60s，RTX4090/1280×720/DPR1/balanced p95=8.4ms；只通过此性能范围，不覆盖AC17/18。 |
| AC21 静态交付 | **fail** | 官方四风格非根站点现场通过；自定义风格站点现场失败（R3）。 |
| AC22 PNG/GLB | pass | 本轮实际下载及签名/哈希；署名与范围限制显示，complete跨块完整性沿用既有测试。 |
| AC23 批处理 | pass | 既有两个离散项目+失败项、非零退出、仅恢复失败项；回归重跑。 |
| AC24 agent 友好 | **fail** | help/JSON/类型/安装入口均通过；R4 公开参数 Schema 与行为不一致。 |
| AC25 服务边界 | pass | 全量 Host/Origin/path/锁/固定任务回归；本轮本地服务，无新增公开访问。 |
| AC26 包边界 | pass | 本轮121文件pack、隔离离线安装、严格类型、安装后 CLI / Studio 成功。 |
| AC27 独立验收 | **fail** | 独立 UI 已执行成功；新发现的产品缺陷尚未修复与复验，闭环未完成。 |

## 修复后放行条件

1. D：分别处理 draw/triangle 成本反馈和近景附件预算；所有升级/降级路径一致遵守稳定策略。两个固定机位真实浏览器各运行至少15秒，记录逐帧 LOD/预算/取消/URL 请求，不再持续切换或请求。补针对行为的回归，不能只测最后 settled。
2. A/D/E：降低粗层绘制成本后，以默认预算重跑固定覆盖1/4/16与扩大覆盖1/4/9的12组、每组至少60秒，保留完整帧、GPU、对象覆盖及5次资源往返。不得仅在高端 GPU 上报告帧率或隐藏必要覆盖。
3. C/D/B/E：定义外部风格模块入口/依赖/资产的本地打包方式，同步类型、Schema、CLI/工作台、教程；不能解析的风格在发布前明确失败。实际 `export web` 后在非根路径且拒绝外网时验证四官方+外部画风，并验证保存的 AO 参数在 SDK 与静态产物中得到尊重。
4. B/E：统一提供可配置、可自托管的数据服务入口，保留限流/重试/缓存策略；通过正式 CLI/工作台完成一次明确小范围真实下载，归档来源、时间、内容哈希、缓存命中与构建。外部服务仍失败时保持 AC04 fail。
5. E/非实现者：对修复后的真实产品提交复验上述缺口、重跑适配检查，更新本矩阵并提交，才可关闭 AC27。此次没有通过缩小规划或降低验收目标放行。

## 复现入口与边界

从仓库根目录运行，先完成 `npm ci` 与 `npm run build`：

```sh
node docs/phase1-evidence/root-acceptance/architecture/reproduce.mjs
node docs/phase1-evidence/root-acceptance/architecture/style-parameters.mjs
node docs/phase1-evidence/root-acceptance/performance/audit.mjs
node scripts/phase1-build-cases.mjs work/integration-scenes beijing-cbd-grow-1
node docs/phase1-evidence/root-acceptance/performance/stationary.mjs
```

前三类复现不访问公共网络。临时输出写入 ignored `work/root-acceptance-*`，不覆盖本次归档。场景构建命令只用于准备固定相机复现的实际 CINK；不是 GPU 基准。网络脚本 `architecture/network-probe.mjs` 必须显式另行运行，按当时服务情况可能失败。本次归档脚本仅调整路径与输出目录，未更改复现算法；主对话已重跑验证。

本轮未执行云端 CI、Linux/macOS/移动 GPU，也没有新的12案GPU计时。UI 附带发现：保存的街道相机确实恢复，但预设选择框显示“俯瞰”（低优先级标签一致性问题）；无效名称当相对路径输入时显示 ENOENT，正确的 `projects/<id>` 路径可打开。测试浏览器标签页与两个专用本地服务器均已关闭。生成场景、缓存、GLB未提交，保留证据截图与数据署名。
