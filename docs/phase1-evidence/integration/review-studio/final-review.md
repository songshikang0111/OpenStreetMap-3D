# 最终独立工作台 / SDK / 扩展审查

以下“原报告”保持独立审查结束时的结论；其后仅补充归档清单和复现方式。本文件整理时 HEAD 为 `2ee762984ec643f8d3da74c39867cce631ff0bae`，没有将后来作者的验证改写为独立审查结果。本次整理未启动浏览器、渲染进程或 GPU，未修改产品文件或创建 commit。

## 原报告

最终只读审查覆盖功能提交 `73738b3`，修复复验至 **`2c013fb0f8114c2dd1cba67ee1a2cd131e565aed`**。未修改产品文件或提交。**GPU 已释放，我启动的浏览器和服务均已关闭。**

| 项目 | 结果 | 独立证据 |
|---|---|---|
| CLI、类型与样例 | pass | e2e 单元 **37/37**；strict types；隔离离线安装后执行 README 的 init/build/validate/export |
| 陌生开发者扩展教程 | pass | 按教程复制 sepia，实际绑定十种角色；独立应用构建并在浏览器加载。真实中国尊配方变体改变几何，rollback 恢复原哈希 |
| 真实取消、崩溃与恢复 | pass | 完整北京快照真实 worker：parse 阶段强杀服务，重启得到 `INTERRUPTED`，原 ID attempt 2 恢复成功；取消保留旧产物，再恢复得到相同内容哈希 |
| SDK 非根静态交付 | pass | 最新 2c 隔离包独立应用；外网请求被禁止；所有实际资源均为本机同源 |
| 四种官方风格、外部风格 | pass | 实际逐项切换并截图；连续五轮切换后几何、纹理和驻留字节返回相同值 |
| PNG | pass | 实际 SDK 导出，PNG 签名正确；图片可见 OSM 署名和版权链接 |
| 完整 GLB | pass | 将真实中国尊镜头移到场景外，确认 `currentChunks=0` 后完整导出；结果包含全部 manifest chunk IDs、实际 mesh；超预算明确拒绝 |
| 北京关键机位 | pass，有限视觉检查 | 相同输入、种子、坐标和视口；旧演示与 SDK 的俯瞰、中国尊、央视、道路原图均保留。检查的俯瞰和道路图未见分块空洞；SDK 地面/道路明暗与旧演示有差别，不能称像素等价 |
| 工作台独立 CUA 流程 | **not-run** | Computer Use 在读取窗口时强制终止，原因是无法足够确信 Windows 当前浏览器 URL。未继续输入或改用另一通道绕过。已有实现者手动工作台证据应与本项分开列出 |

本轮发现的两个 P2 已关闭：

- 保存配置允许 FOV 170，但 SDK 拒绝：`6f77859` 统一配置、Schema 和滑块范围。独立复验非法值拒绝且文件不变，5/140 正常保存。
- SDK 静默抬高向上看的街道相机：`2c013fb` 修复角度限制与旧阻尼残留。专项测试通过，实际浏览器街道机位回读误差小于 `1e-6`。

全部证据位于 [独立审查目录](C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink/work/independent-studio-review)：

- [browser-results.json](C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink/work/independent-studio-review/browser-results.json)
- [non-gpu-results.json](C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink/work/independent-studio-review/non-gpu-results.json)
- [api-restart-results.json](C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink/work/independent-studio-review/api-restart-results.json)
- [截图原图目录](C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink/work/independent-studio-review/screenshots)，含 `beijing-old-*`、`beijing-sdk-*`、`external-*`、`sdk-attributed-export.png`。

本审查不覆盖尚待重跑的最终性能矩阵，也不改变 AC04 外网获取失败、默认预算超限的结论；不能据此宣布一期整体通过。

## 证据范围与时间

- 环境：Windows、PowerShell、Node `v22.11.0`，本机 `C:/Program Files/Google/Chrome/Application/chrome.exe`，实际浏览器 WebGL2 可用。
- `non-gpu-results.json` 最初记录 `73738b3` 的隔离包、教程、样例与配方检查；FOV 旧范围不一致也保留在该历史记录中。
- `camera-fixed-results.json` 和 `api-restart-results.json` 记录 `6f77859` 的独立复验。
- `browser-results.json` 记录 **2c013fb** 的真实浏览器三组检查，三组均 pass。浏览器阶段前重新 npm pack、离线升级隔离 consumer 并重建其应用，确认已安装 SDK 使用 `applyView`；没有使用旧 737 SDK。
- 同机位北京输入是与旧演示一致的 `beijing-cbd` + `street-details` + `landscape-details` + `landscape-profile`，种子 1，477 建筑、785 道路，SDK 分为四块。不是外网成功下载证据。
- 同机位 SDK 使用明确的参考预算：512 MiB 驻留、20,000,000 三角形、100,000 draw calls、18,000 近景附件，并强制 full。该对照只检查视觉和相机，不作为默认预算或性能通过依据。
- CUA 错误原文：`Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy. Stop your work and send a final message noting why Computer Use ended.` 在调用 `sky.get_window_state` 时触发，未完成样例按钮操作。随后通过测试进程的正常清理入口关闭浏览器和服务。

## 与作者证据分列

父 agent 后续告知的最新 2c 工作台实现者复验包括：sample 成功、color、street 相机实际保存 position.y=12 / target.y=18、FOV55、reload 值55、slider 5..140、PNG / complete GLB 实际下载，以及 Web 任务成功生成 `site/index.html`；作者截图为 `docs/phase1-evidence/integration/studio-final.jpg`。这些是**作者证据，不是本独立审查者执行的 UI 流程**，不改变上表独立 CUA 的 not-run。

同样，父 agent 后续告知的根 264/264、strict types、121 文件隔离包检查、真实 E2E 七项通过，属于作者最终验证，不代替本报告明确列出的独立命令和版本。

## 源脚本与结果入口

所有以下相对路径均以 `C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink/work/independent-studio-review/` 为根。

| 文件 | 用途 |
|---|---|
| `non-gpu.mjs` | 隔离 npm pack / 离线安装 / 类型 / CLI 样例 / 陌生配方更新回退 / 外部风格绑定与应用构建。归档时将已实际验证的 `target:'es2022'` 修正并入脚本；历史默认 target 错误仍保留在 JSON |
| `api-restart.mjs` | 真实服务进程强杀、重启、同 ID 恢复、真实 worker 取消保旧产物和确定性恢复 |
| `server-child.mjs` | 上述进程恢复检查生成并启动的真实本地服务子进程 |
| `prepare-beijing.mjs` | 将当时实际执行的非 GPU 内联北京场景准备命令整理成可复现脚本；本次只写入，没有重新执行 |
| `upgrade-consumer.mjs` | 将浏览器前实际执行的离线包升级 / ES2022 应用构建命令整理成脚本；本次只写入，没有重新执行 |
| `browser-review.mjs` | 实际 SDK、非根静态、外网拒绝、五风格及五轮资源往返、PNG、未加载视野完整 GLB、北京四机位截图。归档时仅将固定审查目录路径改为由脚本所在目录计算，便于在新 replay 目录执行 |
| `sdk-reference.html`、`sdk-reference.js` | 真实 SDK 参考页，直接使用当前 `dist-sdk/city-ink.js` |
| `ui-server.mjs` | 初始 UI 服务 / 浏览器 / 证据捕获清理 helper；没有完成独立 UI 操作 |
| `browser-session-visible.mjs` | 从正式 CDP helper 复制的测试副本，唯一改动是 `windowsHide:false`，用于独立可见窗口；不是产品修改 |
| `ui-server-visible.mjs` | 使用上述可见窗口副本的测试服务；CUA 被终止后已关闭 |
| `consumer/main.js`、`consumer/index.html`、`consumer/styles/sepia.js` | 陌生开发者按教程创建的独立应用；外部样式复制自随包示例 |
| `consumer/typecheck.ts` | 从随包 quickstart 复制的严格类型消费例 |
| `non-gpu-results.json` | 非 GPU 初始检查结果及保留的默认 Vite target 错误 |
| `camera-fixed-results.json` | FOV 范围修复的独立真实配置保存检查 |
| `camera-look-up-results.json` | 修前 SDK 相机静默改写的独立重现，旧范围 `.495π`；它是修前故障证据 |
| `api-restart-results.json` | 真实服务 / worker 崩溃、取消与恢复结果 |
| `beijing-views.json` | 同输入、种子、原点、建筑道路数、四个精确机位和内容哈希 |
| `beijing-visual-source.json` | 合并后的实际北京输入，含 OSM；只保留在 ignored work，不建议提交完整地图样本 |
| `browser-results.json` | 三组真实浏览器结果、各风格与机位的 stats、请求 URL、截图路径、GLB 范围及超预算诊断 |
| `review-progress.json` | 非 GPU 阶段汇总快照，GPU 状态字段为当时 not-run，不作为最终浏览器结论 |
| `ui-ready.json` | 已关闭测试 UI 服务的当时 URL；不是 UI 流程通过证据 |
| `complete-unloaded-real.glb` | 从 `currentChunks=0` 视野实际导出的完整真实中国尊 GLB；生成模型只保留在 ignored work |
| `beijing-city-ink-0.8.1.tgz` | 浏览器前重新打包并离线安装的本地包；不发布远端 |

截图精确清单：

1. `screenshots/beijing-old-overview.png`
2. `screenshots/beijing-sdk-overview.png`
3. `screenshots/beijing-old-citic.png`
4. `screenshots/beijing-sdk-citic.png`
5. `screenshots/beijing-old-cctv.png`
6. `screenshots/beijing-sdk-cctv.png`
7. `screenshots/beijing-old-crossing.png`
8. `screenshots/beijing-sdk-crossing.png`
9. `screenshots/external-comic.png`
10. `screenshots/external-line.png`
11. `screenshots/external-color.png`
12. `screenshots/external-white.png`
13. `screenshots/external-project-sepia.png`
14. `screenshots/sdk-attributed-export.png`

原图没有经过生成式处理。Page.captureScreenshot 得到北京与风格截图；署名 PNG 来自真实 `viewer.exportPNG`。本目录没有独立工作台已加载截图，因为该 UI 检查未能执行完成。

## 复现方式

唯一仓库工作目录：`C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink`，分支 `codex/phase1-integration`。为了保留现有证据，脚本应用于新的、空的 ignored replay 目录，不在既有生成项目上重复 init。测试脚本会创建自己的项目、队列、包和安装依赖；它们不修改产品源文件，不执行 publish / push。

以下是非 GPU 步骤。准备前需已有依赖；npm 离线安装需要本地 npm cache。不要在父 agent 性能矩阵测量时运行 CPU 构建。

```powershell
Set-Location -LiteralPath 'C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink'
node --test test/phase1-e2e*.test.js
npm run test:types
node bin/city.js --help --json

# 选择一个尚不存在的 ignored work 子目录；本例不要覆盖原证据。
$reviewReplay = Join-Path (Get-Location) 'work/independent-studio-review-replay'
New-Item -ItemType Directory -Path $reviewReplay -ErrorAction Stop
Get-ChildItem -LiteralPath 'work/independent-studio-review' -File |
  Where-Object { $_.Extension -in '.mjs', '.js', '.html' } |
  Copy-Item -Destination $reviewReplay

node work/independent-studio-review-replay/non-gpu.mjs
node work/independent-studio-review-replay/api-restart.mjs
node work/independent-studio-review-replay/prepare-beijing.mjs
node work/independent-studio-review-replay/upgrade-consumer.mjs
node --test test/phase1-e2e-project.test.js test/phase1-e2e-camera.test.js
```

`non-gpu.mjs` 在第一轮按正确 ES2022 目标构建外部应用；本次实际检查最初遇到的默认 Vite target 错误仍保留在原 `non-gpu-results.json` 的 `initialDefaultTargetError`。`prepare-beijing.mjs` 与 `upgrade-consumer.mjs` 是对实际内联准备操作的归档，并非本次整理新增的执行证据。

以下步骤**会启动 GPU / 浏览器，仅在明确获得独占时段后执行**。本次整理没有执行它们：

```powershell
node work/independent-studio-review-replay/browser-review.mjs
```

浏览器脚本顺序运行并关闭每个浏览器，在 `finally` 写 JSON 和清理浏览器。它实际测量两个静态应用和四个北京机位；不会启动本地工作台 UI。若要单独重试工作台，应另行取得有效 Computer Use / 已知浏览器标签页控制；本报告不提供绕过已停止 CUA 的流程。`ui-server-visible.mjs` 只是保留当时 setup / cleanup helper 源码，不代表独立 UI 通过。

完整逐文件清单附在本文件末尾，并另存 `evidence-file-list.json` / `evidence-file-list.txt`，含绝对路径、字节与 SHA-256。清单覆盖本审查目录内全部自有源脚本、HTML、TypeScript、JSON、PNG/JPG，以及本报告、GLB 与本地 tgz；排除安装得到的 `node_modules` 第三方依赖。由项目/队列/缓存产生的 JSON 也列出，以便区分摘要证据和重放输入。清单不列自身，避免自引用哈希。


## 完整逐文件精确清单

根目录：`C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink/work/independent-studio-review`。以下 111 项与机器清单逐一对应；`node_modules` 内第三方包不在本清单。

- `api-restart-results.json`
- `api-restart.mjs`
- `beijing-city-ink-0.8.1.tgz`
- `beijing-views.json`
- `beijing-visual-source.json`
- `beijing-visual/city.config.json`
- `beijing-visual/city.lock.json`
- `beijing-visual/data/source.json`
- `beijing-visual/dist/attribution.json`
- `beijing-visual/dist/city.build-lock.json`
- `beijing-visual/dist/manifest.json`
- `beijing-visual/dist/report.json`
- `browser-results.json`
- `browser-review.mjs`
- `browser-session-visible.mjs`
- `camera-fixed-results.json`
- `camera-fixed/city.config.json`
- `camera-fixed/city.lock.json`
- `camera-fixed/data/source.json`
- `camera-look-up-results.json`
- `complete-unloaded-real.glb`
- `consumer/app/assets/index-6QQI0ruX.js`
- `consumer/app/index.html`
- `consumer/app/scene/attribution.json`
- `consumer/app/scene/city.build-lock.json`
- `consumer/app/scene/manifest.json`
- `consumer/app/scene/report.json`
- `consumer/index.html`
- `consumer/main.js`
- `consumer/my-landmarks/recipes.json`
- `consumer/package-lock.json`
- `consumer/package.json`
- `consumer/real-zun.json`
- `consumer/real-zun/.city-cache/jobs/65dcc2bc-0dc1-4271-9c1d-ce38d3f5add9.json`
- `consumer/real-zun/.city-cache/jobs/775097e7-98a7-4bff-ace2-8a379940eec6.json`
- `consumer/real-zun/.city-cache/jobs/9ae60959-9588-4735-bd1d-59214ba0deac.json`
- `consumer/real-zun/.city-cache/jobs/f9ae3a93-15cd-4c99-9e00-9f006d76cb69.json`
- `consumer/real-zun/city.config.json`
- `consumer/real-zun/city.lock.json`
- `consumer/real-zun/data/source.json`
- `consumer/real-zun/dist/attribution.json`
- `consumer/real-zun/dist/city.build-lock.json`
- `consumer/real-zun/dist/manifest.json`
- `consumer/real-zun/dist/report.json`
- `consumer/real-zun/rules/packages/418288a5c99daac6ac5b3b95ad35ad18a2e9232bdc4717221f8db4b5ad479daa.json`
- `consumer/real-zun/site/assets/city-ink.js`
- `consumer/real-zun/site/index.html`
- `consumer/real-zun/site/scene/attribution.json`
- `consumer/real-zun/site/scene/manifest.json`
- `consumer/real-zun/site/scene/report.json`
- `consumer/real-zun/site/viewer-config.json`
- `consumer/real-zun/site/viewer.js`
- `consumer/sample/.city-cache/jobs/1869bf20-581e-4720-876f-f35bcf5d25a0.json`
- `consumer/sample/.city-cache/jobs/496bb9ff-b802-4014-98da-ab0ce3cbcf1c.json`
- `consumer/sample/city.config.json`
- `consumer/sample/city.lock.json`
- `consumer/sample/data/source.json`
- `consumer/sample/dist/attribution.json`
- `consumer/sample/dist/city.build-lock.json`
- `consumer/sample/dist/manifest.json`
- `consumer/sample/dist/report.json`
- `consumer/sample/exports/nested/assets/city-ink.js`
- `consumer/sample/exports/nested/index.html`
- `consumer/sample/exports/nested/scene/attribution.json`
- `consumer/sample/exports/nested/scene/manifest.json`
- `consumer/sample/exports/nested/scene/report.json`
- `consumer/sample/exports/nested/viewer-config.json`
- `consumer/sample/exports/nested/viewer.js`
- `consumer/styles/sepia.js`
- `consumer/typecheck.ts`
- `final-review.md`
- `non-gpu-results.json`
- `non-gpu.mjs`
- `prepare-beijing.mjs`
- `review-progress.json`
- `screenshots/beijing-old-cctv.png`
- `screenshots/beijing-old-citic.png`
- `screenshots/beijing-old-crossing.png`
- `screenshots/beijing-old-overview.png`
- `screenshots/beijing-sdk-cctv.png`
- `screenshots/beijing-sdk-citic.png`
- `screenshots/beijing-sdk-crossing.png`
- `screenshots/beijing-sdk-overview.png`
- `screenshots/external-color.png`
- `screenshots/external-comic.png`
- `screenshots/external-line.png`
- `screenshots/external-project-sepia.png`
- `screenshots/external-white.png`
- `screenshots/sdk-attributed-export.png`
- `sdk-reference.html`
- `sdk-reference.js`
- `server-child.mjs`
- `server-workspace/.city-service/jobs/24264c17-a569-4e9e-a348-559784f52376.json`
- `server-workspace/.city-service/jobs/a51408dc-fd41-44b8-869e-f8ce611a6864.json`
- `server-workspace/.city-service/jobs/owner.json`
- `server-workspace/.city-service/projects.json`
- `server-workspace/real-beijing/city.config.json`
- `server-workspace/real-beijing/city.lock.json`
- `server-workspace/real-beijing/data/source.json`
- `server-workspace/real-beijing/dist/attribution.json`
- `server-workspace/real-beijing/dist/city.build-lock.json`
- `server-workspace/real-beijing/dist/manifest.json`
- `server-workspace/real-beijing/dist/report.json`
- `ui-ready.json`
- `ui-server-visible.mjs`
- `ui-server.mjs`
- `ui-workspace/.city-service/projects.json`
- `ui-workspace/sample/city.config.json`
- `ui-workspace/sample/city.lock.json`
- `ui-workspace/sample/data/source.json`
- `upgrade-consumer.mjs`
