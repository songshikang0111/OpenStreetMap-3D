这些文件是主对话独立性能验收材料，已归档至 `docs/phase1-evidence/remediation/root-acceptance/performance`。主对话已从此最终目录实际重跑17项完整性自测、12案审计及逐raw最终复算，均通过；临时结果写入ignored work，原JSON不覆盖。

最终统一12案已由独立raw重算确认为 **PASS，errors=[]**，测量compiler/SDK commit为55862f0a2649fb9289331c9ea19b2325f35f3037。当前结论见final-performance-review.md/json及performance-audit.json；其余旧JSON仍是明确标注版本的历史结果、CPU复现或构造完整性自测。所有JSON按原字节复制；`staging-map.json` 记录来源/目标SHA及脚本改写，历史JSON里的原机器路径和commit标签保持原状。

实际执行版本：

- `preflight-review.md` / `stationary.json` 对应起始0e9d282及D产品492744b的旧CINK稳定性审查；`runtime-evidence-audit.json` 是对D提交中已有真实浏览器raw的独立重算，本角色没有另开GPU。
- `near-global-budget.json` 是410+195>420的before记录；`near-global-budget-after.json` 与 `near-streamer-420/400/0.json` 在29a2e36修复后验证同帧共享预算。当前 `near-global-budget.mjs` 会产生after结果。
- `assessment-injection.mjs` 是29a2e36协议时代的历史探针；它的正样本尚无后来新增的initialFrame。只有在对应隔离checkout、同一旧raw下复跑才应复现其after正样本。不要把它在最新协议下被拒绝当作产品回归，也不要把它当作当前正样本。
- `fallback-frame-followup.md` 对应868d9b1/fef2f01。`initial-gpu-window-review.md`、17项独立自测与类型探针对应743d3e5/a273e6a及112ae159的首帧/GPU窗口阶段。各文件中的原执行命令保留为历史记录；SHA快照也不追溯改写。

当前独立审计/自测可从仓库根复跑（仅文件/CPU核算，避免与GPU测量同时运行）：

```powershell
node docs/phase1-evidence/remediation/root-acceptance/performance/initial-gpu-audit-selftest.mjs
.\node_modules\.bin\tsc.cmd --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 docs/phase1-evidence/remediation/root-acceptance/performance/frame-types.ts
node docs/phase1-evidence/remediation/root-acceptance/performance/audit-results.mjs docs/phase1-evidence/remediation/integration/performance work/root-remediation-performance-rerun/performance-audit.json
```

所有适配后脚本将重跑输出写到ignored `work/`，不会覆盖这里的原始JSON。`audit-results.mjs` 不导入E assessment；GPU pending容量核对实际SDK的8，并同时核对active/所有权。最终12案raw已存在于上述integration/performance路径；本角色只作CPU独立重算，没有重新启动GPU。

旧CINK复现依赖 `work/integration-scenes/beijing-cbd-grow-1/`，不随证据提交生成模型。输入身份见已提交的 `docs/phase1-evidence/remediation/runtime/near-budget/input.json`：manifest SHA-256 `47afbd8d545f60db3121006cdc84fcd0d2416cfb01d73871b019f23bcb63a043`，compiler commit `2ee762984ec643f8d3da74c39867cce631ff0bae`。可在该旧commit的隔离checkout用 `node scripts/phase1-build-cases.mjs work/integration-scenes beijing-cbd-grow-1` 准备，然后供被测运行时读取；先核对manifest/LOD hash，不能用最新简化后的资产冒充相同legacy输入。

准备好该依赖后，执行 `node docs/phase1-evidence/remediation/root-acceptance/performance/near-global-budget.mjs`，或 `node docs/phase1-evidence/remediation/root-acceptance/performance/stationary.mjs 420`（以及400、0）。这些是CPU调度复现，不能作为GPU性能结果。

最终独立复核：86146物理帧（含12首帧）、86133完成GPU样本＋13在途，另有固定机位3602物理帧/3600完成GPU样本；60轮资源稳定。最坏RAF p95=8.4ms、GPU p95=7.161856ms，所有自动物理帧max为599956tri/739draw/50.39MiB估计驻留/1104共同near，均在默认预算内。两个旧固定机位各15秒auto稳定medium，swap/cancel/URL请求均0；正式移动路径另有high/near恢复。最终重新核算脚本为final-performance-review.mjs（从最终docs位置、仓库根执行，输出回ignored work）。
