# 集成生产包真实浏览器性能

完整案例 12/12；帧间隔目标 pass；含绘制预算的联合检查 pass。冻结提交、bundle SHA-256、机器配置及原始所有帧/GPU采样见 summary.json 和同名 JSON。assessment.json 是原始报告的可重算汇总。

1280×720、DPR1、balanced，真实 OSM 快照；每案至少60秒预热后路径，随后 far/full/far 对照和五次离开/返回。超预算不删必要覆盖，保留明确诊断。

| 案例 | RAF p50 / p95 / p99 ms | GPU p95 ms | CPU callback p95 ms | 全帧 draws / triangles p95 | 峰值估算 MiB | 五次资源稳定 | 逐帧绘制上限 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kyoto-gion-fixed-16 | 8.30 / 8.40 / 8.50 | 5.57 | 3.00 | 695 / 596038 | 50.39 | pass | pass |
| beijing-cbd-fixed-1 | 8.30 / 8.40 / 8.50 | 4.84 | 1.00 | 59 / 407262 | 8.10 | pass | pass |
| beijing-cbd-fixed-4 | 8.30 / 8.40 / 8.50 | 5.82 | 1.30 | 211 / 412206 | 20.90 | pass | pass |
| beijing-cbd-fixed-16 | 8.30 / 8.40 / 8.60 | 7.15 | 5.60 | 736 / 547099 | 18.04 | pass | pass |
| beijing-cbd-grow-1 | 8.30 / 8.40 / 8.50 | 6.14 | 2.40 | 350 / 592059 | 13.08 | pass | pass |
| beijing-cbd-grow-4 | 8.30 / 8.40 / 8.50 | 7.16 | 2.10 | 262 / 573831 | 12.80 | pass | pass |
| beijing-cbd-grow-9 | 8.30 / 8.40 / 8.50 | 5.78 | 3.30 | 436 / 560727 | 18.21 | pass | pass |
| kyoto-gion-fixed-1 | 8.30 / 8.40 / 8.50 | 5.44 | 1.20 | 51 / 582486 | 15.93 | pass | pass |
| kyoto-gion-fixed-4 | 8.30 / 8.40 / 8.50 | 5.84 | 1.40 | 195 / 586574 | 15.45 | pass | pass |
| kyoto-gion-grow-1 | 8.30 / 8.40 / 8.50 | 6.13 | 0.90 | 84 / 307358 | 11.83 | pass | pass |
| kyoto-gion-grow-4 | 8.30 / 8.40 / 8.50 | 5.57 | 1.40 | 220 / 443487 | 33.65 | pass | pass |
| kyoto-gion-grow-9 | 8.30 / 8.40 / 8.50 | 4.92 | 2.10 | 399 / 511847 | 44.85 | pass | pass |

默认预算来自每份原始报告：600,000整帧三角形、1,200 draws、128MiB估算驻留、并发3。资源字节不是实测显存。首画面以含几何全帧提交标记计时，未测GPU/显示器呈现完成；完整加载指当前视野选定LOD就绪，不是所有持久化LOD全部载入。GPU时间不包含CPU与排队，不能替代RAF帧间隔。绘制上限同时检查全部原始帧，max/超限帧数保存在assessment.json；不能用p95掩盖瞬时超限。t13/t19固定机位各至少15秒，单独检查切换、取消、同URL重复请求和覆盖。最低LOD仍超预算的样本保留fail；不能用RTX4090的帧率通过宣称低端或移动GPU支持。

复现：npm run build；node scripts/phase1-build-cases.mjs work/remediation-integration-scenes；node scripts/benchmark-integration/run.mjs --output=docs/phase1-evidence/remediation/integration/performance；node scripts/phase1-summarize.mjs --input=docs/phase1-evidence/remediation/integration/performance。整个矩阵期间避免其他GPU任务。
