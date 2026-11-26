# M1 瓦片验收

| 项目 | 结论与依据 |
| --- | --- |
| AC201–209 | 本地通过。随机往返、边界、截断、未知版本、无 DOM Worker 与独立解码器见 [B 报告](B/report.md)。实际浏览器 Worker 和 Node 的位置、索引与树实例逐项比较见 [K 复验](K/worker-parity.json)。`npm run test:packages`、`node scripts/benchmark-tiles/codec-measure.mjs` 可重跑。 |
| AC301–305、307、309–311 | 通过，体积的密集样本偏差按 AC302 列出。15 个数据与范围组合完成构建和校验。实际运行 `node scripts/benchmark-tiles/build-samples.mjs /tmp/osm-samples`、根测试及 [C6 分格和建筑部件对照](C6/report.md)。同一输入还做了恢复、不同并发数、园区跨界、河岸和道路接缝复验，见 [C 报告](C/report.md) 与 [F 报告](F/report.md)。 |
| AC306 | 通过。冻结 L1 量化会翻转的离散墙体选择后，888 栋逐栋对照全部达标：包围盒最大差 3.191 cm，三角形数最大相对差 0.495%。旧瓦片仍可生成。见 [C7 原始测量与复跑命令](C7/report.md)。 |
| AC308 | 通过。北京与京都 27 块的 Node 与 Chrome Worker 输出逐项一致。后续优化在 289 次瓦片对照中逐项复核了 18,527,179 个顶点及相关属性，见 [C8 数据](C8/report.md)。 |
| AC312 | 未通过 60 ms 上限。最新同机对照中 167 块 L1 的 Node p95 从 111.4 降至 95.5 ms，京都独立 Chrome Worker 从 248 降至 182 ms。不同测试轮次的基线和负载有差别，分别见 [C5](C5/report.md) 和 [C8](C8/report.md)。 |

AC1101–1104 的整体验证见 [K 集成记录](K/report.md)。
