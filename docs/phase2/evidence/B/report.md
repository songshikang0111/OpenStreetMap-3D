# WP-B 交付报告：瓦片格式与编解码

分支：`phase2/B-tiles`（基于 `phase2/A-foundation`）。机器：AMD Ryzen 7 7840S（16 线程），13 GB 内存，Linux 7.2，Node v24.18.0。日期：2026-11-12。

格式 1.0 已冻结，字节布局见 [02 第 9 节](../../02-tile-format.md)。

## AC 结论

| AC | 结论 | 验证命令 | 结果摘要 |
| --- | --- | --- | --- |
| AC201 | 通过 | `cd packages/tiles && npm test`（`codec.test.js`） | 1,000 组随机要素层和网格层编码后再解码，要素字段逐项相等（量化字段在网格上相等），网格误差在半个量化步长以内；解码后再编码逐字节相同 |
| AC202 | 通过（范围按决策 E2 解释） | 同上 | 水平每轴误差不超过半步长：L1 赤道 1.9 cm、L0 赤道 3.7 cm；垂直 1/16 m（误差 3.1 cm），基准以上 0–4,096 m，超出时报 `ELEVATION_RANGE` |
| AC203 | 通过 | 同上 | 2,000 个随机共享边界点，两侧量化后的墨卡托坐标差为 0 |
| AC204 | 通过 | `robustness.test.js` | 12 份样本逐长度截断、每份 200 次随机翻转、每个 4 字节对齐位置写入超大长度，外加 500 份垃圾输入，共两万次以上，全部返回 `TileError`（含 code、stage、message、hint），单次最长远小于 1 s |
| AC205 | 通过 | `codec.test.js` | 未知编码类型的层被跳过并列在 `skippedLayers`；未知分节代码被跳过；更高次版本可解码；更高主版本被拒绝，返回 `TILE_VERSION_UNSUPPORTED` 并提示升级 |
| AC206 | Node Worker 通过；浏览器 Worker 未验证 | `worker.test.js` | `worker_threads` 中无 DOM 解码结果与主线程一致；包没有运行时或 peer 依赖，`dist` 只引用包内文件。浏览器 Worker 由 WP-D 的加载管线验证 |
| AC207 | 通过（合成代表性瓦片） | `node scripts/benchmark-tiles/codec-measure.mjs` | 所有场景解码第 95 百分位不超过 1 ms（预算 5 ms）。真实样本由 WP-C 复测 |
| AC208 | 通过 | 见 `ac208/` | 独立 agent 只读第 9 节和一份样本瓦片，不读源码，写出 `ac208/decode.mjs`；25 栋建筑的 ID、高度、轮廓与答案相比 0 处不符。它列出的 8 处歧义（`ac208/notes.md`）中的 4 处已补进第 9 节 |
| AC209 | 通过 | `mercator.test.js` | 缩放 0–20、纬度 ±80°、经度 ±180° 边界及每级 200 个随机点 |

另外：`examples/reference-decode.mjs` 是不依赖本项目的参考解码器，`reference.test.js` 保证它与包的结果一致。

## B5 度量结论

见 `codec-measure.json` 和决策 E3：不采用额外网格压缩和差分编码，保持 14/16 两级。合成 CBD 瓦片 gzip 后 233 KB，超过 L1 中位数预算，主要来自随机生成、不可压缩的地标网格，需要在 WP-C 用真实数据复测。

## 提交

- `584897d` feat(tiles): 墨卡托数学、tileset 校验与二进制编解码
- 本报告所在提交：第 9 节字节布局、参考解码器、度量脚本、E2/E3

## 偏离与决策

- E2：量化网格与墨卡托对齐，int16 范围以瓦片宽度计。
- E3：格式 1.0 不做额外压缩。
- `tileset.json` 新增可选字段 `terrain`（必须为 null）、`heightSources`（必须为空）和 `extensions`，为 M6 预留（00 第 4.4 节要求）。
- 网格层除 `normal` 外还接受预编码的 `normalOct`，用于无损再编码。

## 已知限制

- 体积结论来自合成数据，真实体积由 WP-C 的 AC302 给出。
- 解码耗时是 Node 单线程时间，不代表浏览器或 GPU 性能。
- 大端平台走逐元素拷贝的回退路径，未在大端机器上测试。
