# C5 瓦片生成耗时与几何一致性

在相同的瓦片字节上比较基线 `61c0e34` 和优化后的 `1619134`。测试机为 AMD Ryzen 7 7840S（8 核 16 线程），Linux，Node v24.18.0，Chrome 158.0.8127.36。浏览器测量使用一条实际的模块 Worker 线程。

| 测量 | 样本与统计方法 | 优化前 p50 / p95 | 优化后 p50 / p95 |
| --- | --- | --- | --- |
| AC312，Node 解码加生成 | 167 块 L1，每块预热后取 3 次中位数 | 8.9 / 147.5 ms | 4.2 / 85.3 ms |
| Node，地图生成选项 | 京都 6 块 L1，每块预热后取 5 次中位数 | 145.4 / 263.2 ms | 74.7 / 132.2 ms |
| Chrome，单独运行发布的 Worker | 同一批京都瓦片，预热后取 5 次中位数，含解码、生成和拾取记录构造 | 131.4 / 228.1 ms | 89.7 / 165.1 ms |

AC312 的 Node 目标为 60 ms。京都最慢的地图瓦片包含 1,125 栋建筑和 251,193 个三角形。建筑外壳、密集的桥梁和护栏生成，以及组装最终可传输的属性缓冲，仍占主要开销。独立的浏览器 Worker 测量也高于 06 所列桌面 120 ms 目标。整帧和固定路径统计见 WP-K。

建筑与桥梁写入器共用一期的几何规则，将已定向的面直接写入瓦片批次，减少了逐顶点的临时数组。生成器保留原有材质次序、立面着色属性、三角形索引、拾取 ID 与地面偏移。建筑屋顶和底面裁剪在瓦片生成实际需要它们时才执行。

## 正确性

- 15 组样本中有瓦片的 14 组共 199 块，覆盖 13,191,297 个顶点和 4,710,432 个三角形。所有批次属性和索引按字节比对一致，边界、渲染统计、树木实例和近景墙记录也一致。样本集中的 street-details 为空。
- 另取启用 detail、landscape 的北京、京都和曼哈顿演示数据。34 块瓦片、3,670,316 个顶点和 1,370,588 个三角形通过同一套比对。
- 在京都 7 块瓦片上对照 Chrome Worker 和 Node，2,026,448 个顶点的位置、索引及树实例字节一致。
- 26 个建筑、屋顶、桥梁、一期对照和浏览器视觉用例通过。补入 AC308 的断言还会逐批对比流式输出与保留逐建筑统计的一期写入器输出。示例类型检查和生产构建通过。

## 复现

两个检出目录分别执行 `npm ci`、`npm run build:packages`、`npm run build:demo`。用相同选项生成一份样本，向两个检出的测试命令传入相同目录。浏览器测量从发布目录的 `tiles/<sample>` 读取，`benchmark.html` 可以是空白页面。

```sh
node scripts/benchmark-tiles/generate-measure.mjs <samples-directory>
node scripts/benchmark-tiles/worker-measure.mjs <kyoto-tileset> --runs 5
node scripts/benchmark-tiles/compare-generation.mjs <reference-checkout> <tileset-directory> [...]
CITY_DEMO_DIST=<dist-directory> node scripts/benchmark-tiles/browser-worker-measure.mjs kyoto-gion-grow-9 5
CITY_DEMO_DIST=<dist-directory> node scripts/benchmark-tiles/worker-parity.mjs kyoto-gion-grow-9
```

`before.json` 和 `after.json` 保存按瓦片统计和浏览器原始耗时，`parity.json` 保存一致性检查结果。
