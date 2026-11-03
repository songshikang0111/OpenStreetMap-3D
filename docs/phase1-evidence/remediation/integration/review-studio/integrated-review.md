# Remediation Studio 集成后 Node 独立审查

日期：2026-11-03。工作目录始终为 `C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink`，分支 `codex/phase1-integration`。主 UI / 路由初审目标为 `0eac7947a2712fb72132a5ecf7904eb2d40dcf7f`、`2156d34291e21edd252366ace7cb148f05c02eb6`。修复独立复验至 **`3d4daf248224ce5675436f0b09d85512ac7aefa0`**。

本轮没有修改产品、正式测试、正式文档或提交。复现脚本、结果和小型项目仅写入 ignored `work/remediation-review-studio/`。没有启动浏览器、Windows 窗口、renderer 或 GPU；真实 UI 留待冻结版本独立执行。

## 结论

本轮发现的 P2 均已修复并用原始反例独立复验关闭，未发现其他已复现的目标 P1/P2。Studio 专项 **15/15 pass**。真实 Node API / esbuild / 生成 SDK 共享注册表 / CSS 加载器的独立两组检查均 pass；实际 main 源码的 VM 竞态与跨项目失败分支复验均 pass。

这些结果是 **Node、真实本地 API 与 VM DOM fixtures 范围通过**，不能写成实际浏览器 / 独立工作台端到端通过。

## 发现、修复与原反例复验

| 发现 | 修复 | 独立关闭依据 |
| --- | --- | --- |
| 0eac794 的 `preview()` 反序完成时旧创建覆盖全局引用，留下第二个 viewer 和 CSS；`disposePreview()` 后仍残留 | `b11bbebf15a4c61dde3a510fc4947cff49b8fe73` | 固定3d源码，两次创建反序完成后仅 viewer2 / 一个CSS存活；释放后 viewer=[]、CSS=0；过期创建自行释放 |
| 创建仍等待时选择 line，保存 line 成功，但 `if(state.viewer)` 为false，旧 comic 创建随后显示；UI/config/render不一致 | `b11bbeb` | 实际 style change handler 的 VM复验：form=line、saved=line、rendered=line；`newPreviewRequested=true`；原反例为 rendered=comic、newPreviewRequested=false |
| p1构建完成后等待CSS，切到p2并已加载；旧p1 CSS失败仍通过poll catch覆盖p2的状态和诊断 | `da6959090824d42c5ba1b5020b55d6e9c183b05f` | 固定3d源码，p2实际保留line viewer；旧CSS晚失败前后“场景已加载”状态一致，诊断不含旧错误 |
| 从已构建p1切无dist的新p2，只清viewer，没有清旧manifest、来源/质量报告、选中对象、导出success及已加载状态 | `3d4daf248224ce5675436f0b09d85512ac7aefa0` | 同一原VM操作切新p2，manifest=null / viewer=null，报告为“项目尚未构建”，selection为新占位，diagnostics为“暂无诊断”，状态为“项目已打开…构建…” |

前一轮 `7587826` 的非有限JSON数值变null缺陷已在 `0d4f22a` 独立复验关闭，记录在同目录 `review.md` / `results.json`，本次没有覆盖该历史证据。

## 实际命令

唯一执行目录为上述集成仓库根：

```powershell
node --test test/phase1-e2e-studio.test.js test/phase1-remediation-studio-settings.test.js test/phase1-remediation-studio-forms.test.js test/phase1-remediation-style-preview.test.js test/phase1-remediation-studio-race.test.js
node work/remediation-review-studio/review-integrated-node.mjs

# 原始问题证据仍可由固定旧提交复现，不依赖当前代码是否已修复：
node --experimental-vm-modules work/remediation-review-studio/review-main-race.mjs 0eac794
node --experimental-vm-modules work/remediation-review-studio/review-stale-failure.mjs b11bbeb
node work/remediation-review-studio/review-project-report.mjs b11bbeb

# 本次已实际执行的最终修复复验：
node --experimental-vm-modules work/remediation-review-studio/review-main-race.mjs 3d4daf2
node --experimental-vm-modules work/remediation-review-studio/review-stale-failure.mjs 3d4daf2
node work/remediation-review-studio/review-project-report.mjs 3d4daf2
```

专项15/15通过。独立API脚本记录运行HEAD `0e9d282863afbb5c6f1aa4ab01014a84566c1366`；后续重点复验 Studio 状态/失败处理及回归，最后三条固定3d main源码执行并通过。原始问题脚本以旧提交 `git show` 载入实际 main，而非重写一份模拟实现；DOM/API/引擎入口被注入为可控fixtures，不使用GPU。

## 真实 API / 风格 / 源配置检查

`review-integrated-node.mjs` 在自己的新 ignored 子项目启动正式 `createLocalServer()`，调用实际路由和正式 esbuild bundler，最后关闭服务。其检查包括：

- 从正式 `/api/data-sources` 和项目 GET 的 effective `dataSource` 恢复 VK Maps / GET / 明确fallback策略；改成自托管URL后provider显示custom；完整 source 含 kind/file 通过正式 PATCH / GET 往返。
- `api/search?projectId=...` 将同一 effective source 交给搜索适配器。此处适配器只记录参数，不冒充live下载。
- 外部风格 id / parameters / entry / dependencies / assets 经官方画风来回切换和真实PATCH均保持；非法primary=fallback被服务器拒绝且旧配置不变。
- 正式 style-preview API 返回实际bundle、CSS和特殊文件名SVG `paper #1%25.svg`；真实HTTP读取声明资产成功；缓存响应不含immutable。
- 将正式生成SDK / 项目模块在Node导入，`engine.getStyle(style.id) === projectModule.default`，不是另建注册表；不构造WebGLRenderer。
- 实际StylePack工厂读取打包后特殊字符SVG，参数warmth=.42保留。Node对这个文件URL读取注入了本地文件fetch适配，不是浏览器网络成功证据。
- 使用真实 `loadProjectStyle()` 配合最小document/link fixture：CSS成功、第二次CSS加载失败只移除新链接；旧链接仍在；两句柄分别释放且重复dispose后链接归零。
- 非法entry验证失败后项目配置和已有SDK字节不变；访问缓存的编码路径逃逸被403拒绝。

## 精确证据清单

根：`C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink/work/remediation-review-studio/`。

| 文件 | 内容 |
| --- | --- |
| `review-integrated-node.mjs` | 独立真实API、表单往返、正式生成模块/CSS/资产/缓存检查源码 |
| `integrated-node-results.json` | 上述两组实际pass结果、字段、项目路径及版本 |
| `review-main-race.mjs` | 固定旧/新main的反序创建、加载中改line、跨项目及资源归零原反例 |
| `main-race-results.json` | 初次旧实现负面证据：两活跃viewer / 两CSS，释放后仍残留；line已保存但comic显示 |
| `main-race-da69590.json` | da修复阶段正面中间证据 |
| `main-race-3d4daf2.json` | 最终反序、改line、切p2和资源归零结果 |
| `review-stale-failure.mjs` | 实际poll→p1 CSS等待→打开p2→p1 CSS晚失败的可控复现 |
| `stale-failure-results.json` | 初次b11负面证据：p2被旧p1错误覆盖 |
| `stale-failure-da69590.json` | da修复阶段正面中间证据 |
| `stale-failure-3d4daf2.json` | 最终旧失败不污染p2的结果 |
| `review-project-report.mjs` | 切到无dist新项目后的manifest/UI报告保真检查 |
| `project-report-b11bbeb.json` | 初次旧manifest / 报告 / 诊断残留证据 |
| `project-report-working.json` | 修前fdf阶段工作树同一问题快照 |
| `project-report-3d4daf2.json` | 最终清空旧数据和正确新项目占位结果 |

本轮不更改历史独立UI not-run，也未使用作者浏览器截图代替自己的真实UI。下一阶段应在冻结版本用可用的正式浏览器surface独立验证源选择/真实任务、四官方与外部画风、参数/声明保存重开、相机标签、CSS/切换生命周期，以及PNG/完整GLB/Web；必要GPU性能验收仍串行协调。
