# 一期开发执行清单

日期：2026-11-03。本文件记录已派发的任务和恢复入口，不代表一期已经开发完成。

## 主对话总验收（2026-11-03）

已逐个用 `wait_threads` 确认 A/B/C/D/E 的最新 turn 均已结束；集成产品 HEAD 为 `7c83755`。主对话重跑264项测试、严格类型、三套构建、121文件隔离离线安装包，并完成独立工作台浏览器实操；另两个 `gpt-6.1-sol / xhigh` 角色复核架构和性能。

**一期整体验收不通过。** 独立 UI 工具缺口已补齐，但仍有真实下载、默认预算、静止相机 LOD 抖动、自定义风格导出和合法 AO 参数被覆盖五类问题；AC27 缺陷修复后复验也未闭环。最新 AC01–AC27 矩阵、复现证据及后续任务以 [主对话验收报告](phase1-evidence/root-acceptance/acceptance.md) 为准，以下 E 记录作为历史进展保留。未公开发布或合入 main。

## 集成分支实际进度（E 更新）

- C 已完成独立审查与交接，`8300ee7` 及其功能/修复提交已合入 E；C + E 的针对性测试 25/25 通过。组件报告：`docs/phase1-evidence/landmarks/handoff.md`。
- E 工作台、包/构建入口、静态/浏览器导出、文档与验收脚本已提交；独立初阶段审查的四项 P2 已修复复验，记录于 `docs/phase1-evidence/integration/review-studio-initial.md`。
- A `198a8e0`、B `e626097` 已完成组件独立审查与交接并合入 E。A/C 统一规划与 B 服务契约的实际联合缺陷已修复，证据见 `docs/phase1-evidence/integration/review-architecture-initial.md`。
- D最终176d798已交接并集成。E完成264/264测试、严格类型、生产构建、真实端到端七项、121文件隔离离线安装、两个独立角色审查及修复复验；最新生产包12组60秒矩阵p95均8.4ms，60次资源往返稳定。AC04真实获取仍超时、AC18默认绘制预算在10/12样本未达，独立工作台CUA子项因工具无法确认窗口URL而not-run；不得宣称一期全部通过。
- 已完成实际联合修复：实时配置与几何build key分离；low/import/锁对象统一；正式CINK/风格/地标接线与ownership/角色保真；全帧GPU计时；GLB实例色/身份/取消；预算协议防御；FOV范围和向上看的街道相机。最终以原始验收证据为准。

## 已完成的规划准备

- 完整规格：[一期规划](phase1-plan.md)，包含使用流程、架构、交付物、冻结接口、任务所有权和 AC01–AC27。
- 规划提交：ed0820b02761ca918508c3d8c25af1e936e433c8。
- 代码基线：164af05。重新验证 npm test：138/138 通过；npm run build 成功，保留既有 500 kB 分包提示。
- 规划已由独立 gpt-6.1-sol / xhigh subagent 只读审查，无阻碍派发的重大问题；已采纳它关于地标协议、打开项目和 readAsset 的三条细化建议。
- 五个开发任务均由 create_thread 创建并实际启动；首次 wait_threads 快照均为 active / inProgress，无 turn error。组件开发、集成及最终验收尚未完成。

## 子对话与隔离分支

所有任务模型为 gpt-6.1-sol，推理强度 xhigh（极高），hostId 为 local。工作区列相对 Windows 用户目录下 .codex/worktrees/；每个任务使用独立 worktree，原 main 不作为开发目录。

| 任务 | 职责 | 分支 | 工作区 | threadId |
| --- | --- | --- | --- | --- |
| A | 核心模型与连续场景构建 | codex/phase1-core | phase1-core/beijing-city-ink | 01a1a075-d1ab-79e1-9cde-cda1c3030dc2 |
| B | 地图下载、CLI 与本地任务服务 | codex/phase1-data-cli | phase1-data-cli/beijing-city-ink | 01a1a075-d41a-7a92-aea8-a401d14d3146 |
| C | 地标生成配方与可插拔风格 | codex/phase1-landmarks | phase1-landmarks/beijing-city-ink | 01a1a075-d687-72b3-821b-9d5c93cd4cd1 |
| D | Web SDK、LOD 与扩区性能 | codex/phase1-runtime | phase1-runtime/beijing-city-ink | 01a1a075-d9d0-71f3-a65c-64bac779745b |
| E | 本地工作台、集成与独立总验收 | codex/phase1-integration | phase1-integration/beijing-city-ink | 01a1a077-0c08-7220-bcc3-e0b4c60d3a3b |

## 交付与验收安排

A、B、C、D 各自完成实现、针对性测试、独立 review subagent 审查和修复，按项目 AGENTS.md 提交。各自报告分别位于：

- A：docs/phase1-evidence/core/handoff.md。
- B：docs/phase1-evidence/data/handoff.md。
- C：docs/phase1-evidence/landmarks/handoff.md。
- D：docs/phase1-evidence/runtime/handoff.md。

E 一边实现工作台和打包文档，一边使用 wait_threads 跟踪 A–D。组件完成后，E 在 codex/phase1-integration 上集成、解决冲突、执行实际端到端与扩区性能验证，另启两个独立验收角色复核。最终证据应位于 docs/phase1-evidence/integration/handoff.md 和 acceptance.md。上述证据均已生成并提交；逐项pass/fail/not-run以E acceptance.md为准，保留外部和预算未通过项。

重点保留最新补充要求：区分视觉衰减与真正 LOD；验证固定范围不同切块以及实际扩大连续覆盖；记录真实浏览器帧统计、绘制/驻留成本和往返资源回收。不能只看截图或 Node 构建计时。

若上游存在实现缺口，E 接手补齐并复验；不得把未接线接口或 mock 成功当作完成。真实外部阻塞必须写清恢复步骤，其他独立工作持续完成。未经实际验证的项目保留 fail/not-run，不通过删减规划掩盖。

## 主对话结束后的行为

主对话在规划提交、任务派发和启动确认完成后可结束当前 turn，不主动中断这五个子对话。E 已收到继续开发、等待、集成与独立验收的完整指令。系统/应用运行条件仍影响任务能否持续执行；不承诺主对话自动醒来或后台一定永不中断。

用户稍后唤醒主对话时，先读取本清单，使用 wait_threads 对上述 threadId 和 hostId=local 取得紧凑快照，再检查实际分支提交与 handoff。不要只按本文件的初始“运行中”状态推断当前进度。

恢复顺序：确认各任务状态 → 检查组件提交及缺口 → 检查 E 集成与 AC 矩阵 → 复核现场操作/性能证据 → 执行用户验收。不要重复创建同名任务或覆盖已有工作区。

## 仓库边界

规划与本执行清单已在原 main 本地提交。开发代码只在各自 codex/ 分支提交；最终集成结果留在 codex/phase1-integration 供用户复核。后台不覆盖 main，不推送远端、不发布 npm 包、不部署公共站点，也不改变仓库可见性。
