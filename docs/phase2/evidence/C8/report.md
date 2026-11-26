# C8 建筑和结构瓦片生成

基线为 C7 合入后的 `02aaeea`，候选为 `8a65471`。AMD Ryzen 7 7840S，Linux，Node v24.18.0，Chrome 158.0.8127.36。两版读取相同的瓦片字节。

| 同机串行测量 | 优化前 p50 / p95 | 优化后 p50 / p95 |
| --- | --- | --- |
| AC312，167 块 L1，Node 单线程，每块预热后取 3 次中位数 | 5.7 / 111.4 ms | 5.5 / 95.5 ms |
| 京都 6 块 L1，真实 Chrome 模块 Worker，每块预热后取 5 次中位数 | 139.6 / 248.0 ms | 99.2 / 182.0 ms |

同一个 Chrome 进程另做了基线、候选、候选、基线四轮交错测量，每轮创建一个 Worker 并在轮末释放。最密的三块京都瓦片分别由 255.9、254.9、154.3 ms 降到 199.5、229.4、126.5 ms（每版每块 10 次的中位数）。机器上有其他构建任务，两版的比较采用本轮的基线。AC312 的 60 ms 和 06 的桌面 Worker 120 ms 仍未达标。整帧与固定路径结果见 WP-K。

## 实现与验证

- Chrome CPU 采样显示批次组装、面属性临时存储与逐顶点扩容消耗最多。建筑装饰条、入口和屋顶设备现在暂存八个角、六个面法线和材质参数，最终组装时一次展开。逐三角形保留原绕序，因此退化几何和负轴尺寸也可按原规则生成。
- 直接写入的几何属性按顶点数统一扩容。普通屋顶提前跳过无需执行的轴与边界计算，斜屋顶复用投影。瓦片生成仅收集调用方需要的近景墙和统计项。
- 三组对照合计 289 次瓦片比对，涵盖常规样本、启用装饰与景观的演示数据，以及 C7 的完整 888 栋建筑输入。18,527,179 个顶点和 6,684,012 个三角形的全部属性、索引、边界、树木实例、近景墙和渲染计数一致。另用 Chrome 对照 Node 的 7 块京都瓦片，2,026,448 个顶点的位置、索引与树实例字节一致。
- 新回归用例覆盖旋转、反向尺寸、零尺寸、跨块及拾取 ID。另有 18 个屋顶、建筑外壳、桥梁和量化墙规则用例通过。示例类型检查与生产构建通过。

优化后再次用 CDP 对独立 Worker 采样，最终盒属性展开占 706 个样本，批次组装占 650 个，直接顶点扩容和写入分别占 412 和 396 个。热点仍集中在生成和填充最终几何数组，采样明细见 `profile.json`。

详细数据分别见 `before.json`、`after.json` 和 `cross-checks.json`。复现先在两个检出目录分别执行 `npm ci`、`npm run build:packages` 和 `npm run build:demo`，再给两个目录下的命令传入同一份数据。

```sh
node scripts/benchmark-tiles/generate-measure.mjs <samples-directory>
CITY_DEMO_DIST=<demo-dist-with-tiles> node scripts/benchmark-tiles/browser-worker-measure.mjs kyoto-gion-grow-9 5
node scripts/benchmark-tiles/compare-generation.mjs <built-reference-checkout> <tileset-directory> [...]
CITY_DEMO_DIST=<demo-dist-with-tiles> node scripts/benchmark-tiles/worker-parity.mjs kyoto-gion-grow-9
```
