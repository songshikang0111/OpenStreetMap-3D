# Studio 独立 Node 审查

原始只读记录覆盖表单字段、相机标签、本地 HTTP API、项目风格共用注册表、CSS 生命周期、缓存边界和异步状态。初次审查与失败记录保留；当前收口见 [集成审查](integrated-review.md) 和 [策略/任务状态收口](policy-status-review.md)。

已关闭：JSON数值溢出、反序创建泄漏、创建中改画风不生效、切项目残留报告、旧 CSS 失败污染、下载策略使旧几何失效、预览回调及 delayed idle 覆盖新失败任务。最后一项在 `d028e7e` 独立复验；本范围无剩余已复现 P1/P2。

可复跑实际 main 模块与真实 CLI/API 路径的仓库回归：

```powershell
node --test test/phase1-remediation-studio-race.test.js test/phase1-remediation-source-build.test.js
node --test test/phase1-remediation-studio-forms.test.js test/phase1-remediation-style-preview.test.js
```

VM 序列使用受控 DOM/API/engine 以确定性复现异步顺序，执行被测的实际 main 源码；Node 报告没有运行 GPU 或宣称独立 UI 通过。实际 Chrome CUA 预验另见 `../preflight-studio/`，最终独立 UI 由主对话执行。
