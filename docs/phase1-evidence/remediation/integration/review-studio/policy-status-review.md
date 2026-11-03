# 446a94c / e5a7de4 独立定向 Node 审查及 d028e7e 复验

实际 HEAD：`e5a7de48b92c10707ec3de3fb63e881a94b5def7`，分支 `codex/phase1-integration`。执行目录：`C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink`。只读产品源码，没有产品修改或 commit；独立脚本/结果仅写 ignored work。没有 GPU、浏览器、本地 Windows 窗口或全量 checks。

## 结论

`446a94c` 数据采集策略与构建身份分离通过；`e5a7de4` onProgress 和取消按钮修复通过。e5 阶段发现的 idle 收尾 P2 已在 `d028e7e360aa38c303f2e5e7959bb5388a81f17e` 独立复验关闭；当前本次定向 Node 审查无剩余已复现 P1/P2。

## d028e7e 独立关闭记录

实际 HEAD 为 `d028e7e360aa38c303f2e5e7959bb5388a81f17e`。未改原反例脚本，固定读取新提交 main 源码执行：

```powershell
node --experimental-vm-modules work/remediation-review-studio/review-idle-job-status.mjs d028e7e
node --test test/phase1-remediation-source-build.test.js test/phase1-remediation-studio-race.test.js
```

同一实际 build poll → preview 等待 whenIdle → Web click → export failed → preview idle 序列中，failedStatus 和 finalStatus 均为 `export-web · failed · `，state.job.status 仍为 failed，原失败诊断保留。证据 `idle-job-status-d028e7e.json` 的 failedStatusPreserved=true。代码统一由 canReportScene() 保护 onProgress 和 whenIdle 完成后的任务栏更新：只有无任务或仍为触发预览的同一 succeeded build 可写场景状态。仓库上述定向回归 4/4 通过（真实源策略/导出、反序资源释放、旧 CSS 失败、idle/新导出任务）。未运行 GPU、浏览器或全量检查；不将作者 CUA 结果列作独立 UI 复现。

## e5 阶段 P2 原反例（d028 已关闭）

实际 main 模块的 `pollJob()` 得到 build succeeded 后启动 preview；`viewer.whenIdle()` 仍等待时 Web 按钮已经启用。点击实际 Web handler，经过 save/start/poll 得到 export-web failed 后，原 preview whenIdle 完成，line120 无条件将任务栏改成“场景已加载…”。state.job 仍 failed，诊断也仍是失败，任务栏却丢失失败结果。

复现命令：

```powershell
node --experimental-vm-modules work/remediation-review-studio/review-idle-job-status.mjs e5a7de4
```

这是固定 e5a7de4 实际 main.js 加受控 DOM/API/SDK fixture，没有重写被测状态逻辑。脚本执行真实 build poll 与 Web click handler，受控 SDK 只将 whenIdle 延迟。证据 `idle-job-status-e5a7de4.json`：failedStatus=`export-web · failed · `；finalStatus=`场景已加载；拖动旋转，滚轮缩放，右键平移。`；jobStatus=`failed`；failedStatusPreserved=false。onProgress 的新保护不会覆盖这个另一处任务栏写入。

建议收尾状态也受任务身份保护；允许仍属于此预览的 build 显示 loaded，同时不能覆盖后来的 fetch/export/失败任务。

## 已通过

- 正式编译器创建 sample + 项目外部风格项目；正式本地 HTTP PATCH 分别保存 `DATA_SOURCE_FIELDS`，每次 validate 成功，buildConfigHash 和输入 bytes 不变。当前常量实际是五项：provider、endpoint、transport、fallbackEndpoints、fallbackPolicy；不是六项。
- 保存全部服务策略后，通过正式 `/api/projects/:id/jobs` 启动真实 export-web worker 成功，输出外部 style id=`project-sepia` / warmth=.23 保留。没有远程数据请求，不将它计为 live 下载验证。
- kind、file 身份改变仍 STALE_BUILD；恢复后 validate 成功。仅增加换行的实际 bytes 变化仍 STALE_BUILD；语义高度变化仍 STALE_BUILD；恢复数据后 validate 成功。锁定几何 contentHash / sourceFileHash / dataHash 未被策略保存改写。
- 固定 e5 实际 main 的 onProgress 在 failed job 下 complete=false/true 均保留失败任务栏；actionBusy=true 且无 job 时 cancel/retry disabled；running job 可取消，清空 job 后 cancel disabled。
- 复验原反序 preview、加载中改 line、切项目和 viewer/CSS 释放，均通过。
- 仓库定向 tests 6/6 通过。

## 命令与证据

```powershell
node work/remediation-review-studio/review-operational-policy.mjs
node --experimental-vm-modules work/remediation-review-studio/review-main-race.mjs e5a7de4
node --test test/phase1-remediation-source-build.test.js test/phase1-remediation-studio-race.test.js test/phase1-remediation-studio-forms.test.js
```

| 文件 | 证据 |
| --- | --- |
| `review-operational-policy.mjs` | 独立真实 API / compiler / export worker / validators 脚本 |
| `operational-policy-results.json` | 五字段各次保存的实际值、导出 job ID、各身份/数据过期结果 |
| `policy-1793714216000/` | 此次真实构建/导出项目；exports/policy-review 为实际 Web 输出 |
| `review-main-race.mjs` | 固定源码的原反序/切换反例与新 onProgress/按钮检查 |
| `main-race-e5a7de4.json` | 反序/切换释放、line一致、failed状态与按钮通过结果 |
| `review-idle-job-status.mjs` | 新 P2 的实际 poll/preview/Web handler 独立复现脚本 |
| `idle-job-status-e5a7de4.json` | 新 P2 任务栏覆盖的前后字符串和失败 job 状态 |
| `idle-job-status-d028e7e.json` | 固定 d028 执行同一原反例，失败任务栏保留，P2 关闭 |

真实 UI、最终浏览器导出和 GPU 行为本轮 not-run。作者 CUA/截图证据与本独立 Node 审查分列。
