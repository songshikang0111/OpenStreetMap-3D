# 集成生产包真实浏览器性能

完整案例 12/12；帧间隔目标 pass；含绘制预算的联合检查 fail。冻结提交、bundle SHA-256、机器配置及原始所有帧/GPU采样见 summary.json 和同名 JSON。assessment.json 是原始报告的可重算汇总。

1280×720、DPR1、balanced，真实 OSM 快照；每案至少60秒预热后路径，随后 far/full/far 对照和五次离开/返回。超预算不删必要覆盖，保留明确诊断。

| 案例 | RAF p50 / p95 / p99 ms | GPU p95 ms | CPU callback p95 ms | 全帧 draws / triangles p95 | 峰值估算 MiB | 五次资源稳定 | 绘制预算 p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| beijing-cbd-fixed-1 | 8.30 / 8.40 / 8.50 | 5.66 | 0.90 | 118 / 2638236 | 66.71 | pass | fail |
| beijing-cbd-fixed-4 | 8.30 / 8.40 / 8.50 | 5.08 | 1.70 | 430 / 2638230 | 66.73 | pass | fail |
| beijing-cbd-fixed-16 | 8.30 / 8.40 / 8.50 | 6.81 | 3.80 | 1298 / 2531375 | 66.80 | pass | fail |
| beijing-cbd-grow-1 | 8.30 / 8.40 / 8.50 | 5.92 | 1.70 | 350 / 592086 | 17.28 | pass | pass |
| beijing-cbd-grow-4 | 8.30 / 8.40 / 8.50 | 4.77 | 1.60 | 368 / 810569 | 26.46 | pass | fail |
| beijing-cbd-grow-9 | 8.30 / 8.40 / 8.50 | 5.91 | 2.80 | 731 / 1632516 | 48.19 | pass | fail |
| kyoto-gion-fixed-1 | 8.30 / 8.40 / 8.50 | 5.81 | 1.30 | 126 / 3090196 | 97.48 | pass | fail |
| kyoto-gion-fixed-4 | 8.30 / 8.40 / 8.50 | 5.20 | 1.90 | 475 / 3090196 | 97.05 | pass | fail |
| kyoto-gion-fixed-16 | 8.30 / 8.40 / 8.50 | 7.04 | 4.40 | 1404 / 3090196 | 97.13 | pass | fail |
| kyoto-gion-grow-1 | 8.30 / 8.40 / 8.50 | 6.35 | 1.00 | 81 / 83980 | 19.10 | pass | pass |
| kyoto-gion-grow-4 | 8.30 / 8.40 / 8.50 | 4.85 | 1.70 | 342 / 785420 | 25.39 | pass | fail |
| kyoto-gion-grow-9 | 8.30 / 8.40 / 8.50 | 5.90 | 2.70 | 806 / 2499436 | 100.60 | pass | fail |

默认预算来自每份原始报告：600,000整帧三角形、1,200 draws、128MiB估算驻留、并发3。资源字节不是实测显存。首画面以含几何全帧提交标记计时，未测GPU/显示器呈现完成；完整加载指当前视野选定LOD就绪，不是所有持久化LOD全部载入。GPU时间不包含CPU与排队，不能替代RAF帧间隔。表中绘制预算按p95比较；逐帧max/超限帧数也保存在assessment.json，不将p95通过当作从未瞬时超限。最低LOD仍超预算的样本保留fail；不能用RTX4090的帧率通过宣称低端或移动GPU支持。

复现：npm run build；node scripts/phase1-build-cases.mjs；node scripts/benchmark-integration/run.mjs；node scripts/phase1-summarize.mjs。整个矩阵期间避免其他GPU任务。
