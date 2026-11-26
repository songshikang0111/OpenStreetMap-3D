# WP-F 整城构建验收

验收使用 Geofabrik 的 2026-01-01 Noord-Holland 提取文件，184,846,938 字节，OSM 数据时间 21:21:30 UTC。数据归属 © OpenStreetMap contributors，许可 ODbL-1.0。固定下载地址、SHA-256、两个示例的范围与内容哈希见 [示例清单](../../../../examples/cities.json)。机器为 AMD Ryzen 7 7840S，8 核 16 线程，物理内存 14,389,837,824 字节，Node 24.18.0。各次测量的版本及范围单独记录，机器还运行了其他任务。

| AC | 实测结果 |
| --- | --- |
| 601 | 从同一份地方 PBF 提取 Enkhuizen 市行政边界 relation/296469，按完整 MultiPolygon 裁切，使用默认双层几何。市界包含大片水面。11eef41 完成 104 个 z14 规划格，包含 11,788 栋建筑、76 块 L0 和 940 块 L1，CLI validate 成功，诊断数为 0。 |
| 602 | 同一 PBF 的 Amsterdam Centrum 范围由独立 libosmium 还原为一期 JSON。分别构建并解码满细节瓦片，计入地标接管的建筑，两边各有 5,277 个不同身份，两个方向的差集均为空。 |
| 603 | 有记录的 Enkhuizen 城区运行最高峰值 RSS 为 2,377,612 KiB。PBF 大小超过 1 GiB 或范围超过 5,000 km² 时，构建器明确拒绝并提示用 osmium extract 裁剪。整市单工峰值为 937,732 KiB。1 GiB / 5,000 km² 上限仍无实测。 |
| 604 | Enkhuizen 城区 29.24 km² 在 f08ea82 上，单工 97.25 秒（18.04 km²/min），并发 8、实际 4 格并行，79.97 秒（21.94 km²/min）。完整产物校验后恢复用时 0.36 秒，为单工全量的 0.37%。完整市界面积约 115.80 km²（球面面积），735.91 秒，约 9.44 km²/min。两种范围均包括水面，未证实密集城区 20 km²/min。5af2c34 的同一区域全量 186.0 秒，已完成输入的完整校验及恢复 0.79 秒（0.43%）。17 项专项回归通过，包含分阶段中断恢复和文件损坏修复。 |
| 605 | 对相邻 L1 瓦片按固定随机种子 605 无放回抽 200 对，每对在水域、绿地、地表各查 20 个格点，并核对道路身份、精确边界端点与高程。完整市界 1,791 对候选，12,000 个地表采样、61 个道路接点，差异数为 0。城区样本也完成 12,000 个采样及 377 个道路接点的验证。 |
| 606 | f08ea82 在单工和请求并发 8 的运行中，目录递归比对所有发布文件，完全相同。独立夹具还将磁盘分格路径与单格、不同并发、恢复后的瓦片逐一比对。 |
| 607 | 超长水域与桥坡连接组夹具生成 GROUP_TOO_LARGE 并写入 report.json，按局部几何完成构建。整市构建实测水域 r945096-0 跨度 21.5 km，记录该诊断；4 个源数据不完整的多边形关系另作记录。 |
| 608 | CLI 将发布文件打入带路径索引的 USTAR，SDK 使用 206 字节范围读取单个成员。本地真实浏览器验证跨域归档；单测把每个成员与目录逐字节比较，覆盖损坏索引、服务端忽略 Range、重复归档。见 [E18](../../08-risks-and-decisions.md) 和[归档格式](../../tile-archive.md)。 |
| 609 | 一条脚本命令重建五个随库 JSON 城市场景及两个带日期的真实 PBF 范围，使用配置、来源与成品文件 SHA-256 检查清单。 |

机器、逐层体积、建筑计数、完整市界的哈希及两种范围的边界抽样结果见 [city.json](city.json)。完整市界于 11eef41 运行，两个 PBF 示例于 b8ff4d6 更新了 C7 墙体形状规则后的内容哈希。

### 构建与独立校验

以下命令在仓库根目录运行。无需把原始数据、临时文件或瓦片提交到 Git。PBF 定位和下载方法见示例清单。`$PBF` 为文件全路径，`$OUT` 为本机独立输出目录。Python 辅助脚本需要 osmium==4.3.2，仅用于导出行政边界和独立复核建筑身份。

```sh
npm run build:packages
mkdir -p "$OUT"
python scripts/phase2-municipal-boundary.py "$PBF" 296469 "$OUT/municipality.geojson"
node bin/city.js tiles build --input "$PBF" --polygon "$OUT/municipality.geojson" --cell-zoom 14 --concurrency 1 --max-memory 2700 --name enkhuizen-municipality --output "$OUT/municipality" --json
node bin/city.js tiles validate "$OUT/municipality" --json
node scripts/check-city-boundaries.mjs "$OUT/municipality"
node scripts/build-example-cities.mjs --out "$OUT/examples" --pbf-dir "$(dirname "$PBF")"
python scripts/phase2-pbf-reference.py "$PBF" 4.885,52.368,4.905,52.38 "$OUT/amsterdam-reference.json"
node bin/city.js tiles build --input "$OUT/amsterdam-reference.json" --output "$OUT/reference" --concurrency 1
node scripts/compare-city-buildings.mjs "$OUT/examples/amsterdam-centrum" "$OUT/reference"
node --test test/phase2-pbf.test.js test/phase2-builder.test.js test/phase2-region.test.js test/phase2-archive.test.js
```

### 数据规模与恢复

同一日期的阿姆斯特丹大区压力样本取经纬度范围 `[4.72, 52.28, 5.08, 52.48]`，包含市区、乡村和水域。原实现在 16,622 个水域要素整体求并时触及裁切库队列上限，31.94 秒退出。随后实现将水域按 2,048 米方格裁切并分批求并，按空间索引分格读取几何。见 [E19](../../08-risks-and-decisions.md)。在 288 个规划格中，第 87 格完成时峰值 RSS 为 2,197,776 KiB，已落盘 437 MiB 的要素存储。本次检查点仅描述区域压力测试的部分进度。地理范围为 540.97 km²。此范围的面积无法证明完成了连续 500 km² 建成区。已支持的恢复路径会校验数据来源、构建选项、算法版本以及文件哈希，参数或版本变化时重新规划。
