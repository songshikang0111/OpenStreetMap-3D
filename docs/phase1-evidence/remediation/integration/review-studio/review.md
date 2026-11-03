# Remediation：Studio 准备阶段独立只读审查

日期：2026-11-03。唯一工作目录 `C:/Users/宋世康/.codex/worktrees/phase1-integration/beijing-city-ink`，分支 `codex/phase1-integration`。本轮目标为 `45310d6d2d1331e78e7e2897cf9ea5290eba16f7` 和 `758782644c4dfc400cedd370eb64edb95bce2734`，并复验修复 `0d4f22a3e1311aa89720eb2fdb53e90492590efa`；追加检查 `8bfcf0a86ebf89f3d080ed35f6b92a290dff5b27` 的独立预览 helper。独立 fixture 实际运行时 HEAD 为 `7ffaefb4fff0054d8d59d1a0f83717571f24bce8`。

只读检查产品；仅在 ignored `work/remediation-review-studio/` 创建复现脚本、结果和测试项目。没有修改产品、提交、递归 agent、浏览器、本地 Windows 窗口或 GPU 操作。

## 发现与修复复验

**P2：JSON 参数数值溢出后静默变成 null，已关闭。**

在 `7587826` 的 `studio/settings.js:1–4`，`jsonObject('{"aoStrength":1e400}')` 返回包含 Infinity 的对象，随后 API 的 JSON.stringify 会发送 `{"aoStrength":null}`；嵌套数组中的 `-1e400` 同样变 null。服务端只能看到已变 null 的请求，不能恢复原始用户输入。这违背表单参数保存保真，必须在传输前拒绝。

`0d4f22a` 使用迭代遍历检查嵌套对象和数组中的非有限数值，独立复验直接 / 嵌套正负溢出均被拒绝；有限浮点数、嵌套数组、false、null、中文与字符串内部空白保留。原始 7587826 源码通过 `git show` 加载，故修前现象不会因当前树已修复而丢失。

本轮未发现其他已复现的目标实现 P1/P2。

## 实际命令与结果

```powershell
node --test test/phase1-e2e-studio.test.js test/phase1-remediation-studio-settings.test.js
node --test test/phase1-remediation-style-preview.test.js
node work/remediation-review-studio/review.mjs
```

前两条共 **9/9 pass**。第三条 **4组独立 fixture 全 pass**，结果保存在 `results.json`：

| 检查 | 结果与范围 |
| --- | --- |
| 非有限 JSON 缺陷 / 修复 | 实际 758源码重现 null 改写；当前修复拒绝；正常嵌套值经过 JSON 往返保真 |
| source/style 字段保真 | source kind/file、额外来源元数据不丢失、原对象不被修改；显式 endpoint/GET/两备用端点/unavailable 策略；外部 id/entry/dependencies/assets 和参数正确输出 |
| 实际 main 相机标签逻辑 | 使用 45310d6 的真实 main 源码和 DOM/API/SDK fixtures：保存 street 初始化显示 street；移动后运行实际 interval 回调显示 custom；选择 skyline 后显示 skyline；无保存相机显示 overview |
| 实际 esbuild 预览 helper | 使用正式 `prepareProjectStyle` / `bundleProjectStyle`、真实项目模块/依赖/SVG/CSS；匹配 id/参数；输入 entry 与依赖在 hash 输入报告中，资产与 CSS 在 descriptor 中；输入配置对象不变；无效越界 entry 失败后旧 SDK 和 preview.json 字节保持不变 |

`review.mjs` 只执行 Node。相机 VM fixture 检查的是实际 preview 和 interval 函数体，不能替代真实浏览器拖动/重开流程。helper 的 compiled `style` 有意仅返回 id/parameters；原项目 entry/dependencies/assets 没有被写回或覆盖，仍在原配置及编译 descriptor/report 中。

## 后续接线注意

参数变更不改变编译资源时，bundle hash 相同，SDK 字节可复用；同一 hash 下的 `preview.json` 会保存最新参数。当前未把此现象列为产品失败，但**它不是不可变 metadata**：未来 HTTP 路由不能把 preview.json 当永不变化的内容设置 immutable 缓存。可只对 hash 内编译资产使用 immutable，或将 selection metadata 单独寻址。

本轮只检查纯表单 helper 和内部预览 helper。B source 正式契约、C 已合模块与具体本地服务路由 / Studio 主 UI 的接线应在合并后再审；当前不能将这些单元 / Node 结果写成完整工作台端点配置、外部风格、真实导出或独立浏览器通过。

`review.mjs` 会在其所在目录创建 `preview-project`，应在新的空 ignored 工作目录重放，以免重复 init 已有项目；保留相同两级 `work/<name>/` 层级即可保留相对 import。
