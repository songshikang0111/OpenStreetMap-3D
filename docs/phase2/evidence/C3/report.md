# WP-C 补充（C3）交付报告：瓦片生成耗时优化（第一轮）

分支：`phase2/C3-generate-perf`（基于 `phase2/G-styles`）。机器：AMD Ryzen 7 7840S，Radeon 780M（**非参考设备**），Chrome 150 硬件 GPU，Node v24.18.0。日期：2026-11-13。

## 改动

- `packages/generators/src/batch.ts`：`BatchBuilder` 使用可增长的 `Float32Array`/`Uint32Array`，输出数组的值不变。
- `src/road-structures.js`、`src/road-stairs.js`：写入器的三角形法线与颜色计算去掉每三角形对象分配（相同算术，颜色解析缓存）。
- `packages/generators/src/structures.ts`：护栏/扶手共线分段合并；`appendPlain` 不再逐顶点切片。
- 新脚本 `scripts/benchmark-tiles/worker-measure.mjs`：用地图 Worker 的同一组选项（屋顶推断、装饰层、近景墙体）在 Node 中测每块瓦片。

## 测量

| 测量 | 命令 | 优化前 | 优化后 |
| --- | --- | --- | --- |
| 京都 L1 瓦片，Node 单线程（3 次中位数） | `node scripts/benchmark-tiles/worker-measure.mjs apps/demo/public/tiles/kyoto-gion-grow-9` | p50 121 ms，p95 355 ms | p50 115 ms，p95 207 ms |
| 京都 60 s 固定路径，浏览器 Worker 解码+生成 | `CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" node scripts/benchmark-tiles/path-run.mjs scripts/benchmark-tiles/paths/kyoto-gion-grow-9.json` | p50 308.5 ms，p95 601 ms，最大 632 ms | p50 230.5 ms，p95 469 ms，最大 519 ms |
| 同一路径帧间隔 | 同上 | p95 16.8 ms | p95 16.7 ms，每分钟长帧 1 次 |

"优化前"为把四个源文件临时恢复到 `1ea2cc7` 后重建测得，摘要见 `generate-browser.json`。浏览器数字是"模拟"状态（非用户指定参考设备）。

## 结论

- 目标（06 桌面 Worker 预算 120 ms，京都 p95 接近该值）**未达到**：浏览器 p95 469 ms，约为目标 4 倍。
- AC306、AC308、AC311 测试仍通过；`npm test` 372 项通过；WP-D 浏览器检查、`bundle-check`、`style-checks` 复跑全部通过。
- 剩余方向与不做的原因见决策 E11（一期 `MeshWriter` 类型化、立面装饰条近景化都会牵动一期路径或 AC306 判据）。

## 提交

`git log phase2/G-styles..phase2/C3-generate-perf`（含一个 `wip:` 前缀的中间提交，是为了在测量基线时不留未提交改动）。
