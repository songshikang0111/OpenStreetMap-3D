# 主对话独立验收证据

最终结论见 [acceptance.md](acceptance.md)：AC01–AC27全部通过。测量冻结55862f0，产品修复e11990c；首次失败、被拒绝候选及原始反例均另存，不覆盖旧报告。

- [架构](architecture/README.md)：参数、source锁与真实下载快照的正式CLI执行/文件哈希。
- [几何](geometry/README.md)：混合LOD、坐标/属性/身份、原漏裁反例与修复后的完整检查。
- [性能](performance/README.md)：直接重算全部物理帧、GPU窗口、预算和60轮资源往返。
- [最终界面](final-ui-smoke.json)：已重新构建的合成项目，真实CUA操作标准导出、风格切换和刷新恢复。[工作台截图](final-studio-restored.png)、[静态漫画截图](final-static-comic.png)。

主对话在最终归档位置实际重跑了参数26项、source锁9项、正式CLI只读审计、完整窗口17项、12案raw核算、几何12个脚本；均通过。参数化AO的六项实际SDK/PNG验证及344项全量检查另见本目录结果。测试浏览器和本地服务均已关闭。

从仓库根运行，先安装锁定依赖并构建SDK；避免与新的GPU测量并行运行验证：

```sh
node docs/phase1-evidence/remediation/root-acceptance/performance/audit-results.mjs docs/phase1-evidence/remediation/integration/performance work/root-audit-replay.json
node docs/phase1-evidence/remediation/root-acceptance/architecture/verify-parameters.mjs
node docs/phase1-evidence/remediation/root-acceptance/architecture/verify-source-build.mjs
node docs/phase1-evidence/remediation/root-acceptance/verify-ao.mjs
```

几何回放的标准输入准备与显式assets参数见其README。历史固定CINK探针和真实下载文件审计有各自的输入哈希/本地依赖，缺少时不能凭空补造。所有重跑结果进入ignored work，不覆写历史JSON。归档适配只改变路径和等价的集成Git版本引用，不改变阈值或测试断言；原件SHA与适配映射保留。

`root-archive-preparation.json`和各目录的staging/prepared记录描述准备时的状态与字节；最终结果以acceptance、final-consistency和各次实际执行记录为准。生成GLB/CINK、地图快照、任务队列和浏览器缓存不在本归档内。

`archive-integrity.json`记录本次最终归档的逐文件SHA-256；本目录的Git属性关闭行尾转换，以保留原始证据字节。几何历史运行的22份日志是显式纳入的验收材料，不是运行时缓存。最终文档更新后的生产包边界检查见`package-boundary-final.json`，仍为140个文件。
