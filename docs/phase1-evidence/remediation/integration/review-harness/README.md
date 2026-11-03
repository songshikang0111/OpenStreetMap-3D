# 独立采证与判定逻辑审查

只读角色的原始报告和探针结果保存在此。旧缺陷记录保持原始结论；当前收口见 [最终报告](final-remediation-harness-review.md)，覆盖至 harness `a929ceb`，实际审查 HEAD `8df77a3`。没有剩余已复现 P1/P2；该结论不替代最终真实 SDK/GPU 测量。

当前完整性回归可在仓库根运行：

```powershell
node docs/phase1-evidence/remediation/integration/review-harness/reproduce-current.mjs
node --test test/phase1-remediation-assessment.test.js
```

第一条将独立脚本的原始副本放入 ignored `work/remediation-harness-replay`，保留其模块相对路径，并将本次结果写入同目录；不覆盖原审查或历史硬件证据。它使用明确构造的记录验证15个拒绝探针、合法完整记录及128MiB边界，不产生新浏览器或 GPU 通过。

`probe-assessment.mjs`、`important-gate-probes.mjs` 是分别针对原记录所列历史 harness 的反例源代码，保留用于解释漏洞形成及关闭过程；随 harness 演进，旧合法对照缺少新要求字段，不宜作为当前通过脚本。旧12案真实 raw 的 SHA 与目录 diff 已独立核对，原始失败报告未被修改。
