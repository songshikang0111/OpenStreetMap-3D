# C6 远景建筑体块与树密度（2026-11-26）

实现提交 `37fec02`，区域 PBF 路径集成提交 `174dd6a` 和 `5f37579`。采用仓库的 OSM 样本和一个跨 z14 规划边界的合成街区。几何面积在编码、解码并通过实际生成器生成屋顶三角形后测量。

| 场景 | 结果 |
| --- | --- |
| 阿姆斯特丹运河 `public/data/amsterdam-canals.json` | L1 包含 43 个带 `building:part` 的要素，其中 30 个完整落在唯一外廓内，归属 7 栋建筑，`provenance.partOf=derived`。L0 的 7 栋分别为 2 至 3 段体块，另有 10 个多建筑小块、55 个树密度格。构建诊断和降级均为零。 |
| 北京国贸 `public/data/beijing-cbd.json` | L0 中 `relation/7820447#0` 形成 3 段体块。L1 的地标仍走既有配方替换。树密度格 236 个，构建诊断和降级均为零。 |
| 合成建筑关系 | 显式角色优先。只有唯一完整包含的有标记分部才有空间推导归属。交叠外廓、建筑院内、包住院洞、外部邻接、相互矛盾的显式关系均保留未归属。 |
| 跨规划格，4 个分部、高度 10/20/30/40 m | 分部完全覆盖的外廓沿用一期抑制。L1 保留 4 个 OSM ID 和显式关系。L0 生成 3 段，最高 40 m，最低底标高 5 m。全局规划与双 Worker 分格规划的全部产物哈希一致。 |
| 小建筑与密度格 | 同格的重叠建筑、院洞和不相接建筑合为一个多面要素。渲染的屋顶投影面积在 45 m² 的 1.5 m² 量化容差内。改变输入顺序，编码字节相同。5 棵树跨固定网格边界产生 4+1 的密度。 |
| 区域 PBF | `type=building` 关系只引用有内洞的子多面关系时，磁盘地理索引使用子关系的范围。子要素在 L1 保留显式父 ID 与归属来源。整区与按格读取的瓦片哈希一致。另一个矩形外廓跨过读取窗口时，两侧的分部均进入一期抑制判定，按格与全域得到同一组建筑 ID。 |

在仓库根目录可运行以下复验。

```sh
npm ci
npm run build:packages
node --test test/phase2-massing.test.js test/phase2-pbf*.test.js test/phase2-region.test.js
node bin/city.js tiles build --input public/data/amsterdam-canals.json --output /tmp/city-amsterdam-c6 --json
node bin/city.js tiles build --input public/data/beijing-cbd.json --output /tmp/city-beijing-c6 --json
```

在 `5f37579` 上，上述 C6、PBF、区域定向测试 12/12 通过。工作区测试 32/32 通过，`npm run build`、`npm run test:types`、`npm run format:check` 全部通过。

原始坐标中只有在轮廓与院洞均满足几何包含时才能推导归属。L0 用源部件底标高和顶高选择高度断点。高度超过三段时优先保留最高处的投影及高度，其余合并段可能填平较小的高差。合并中被抬高的顶面或被降低的底面记为 `inferred`。树密度和小建筑网格从各 L0 瓦片西北角起算，以瓦片中心纬度换算米长。瓦片边缘的余格按实际宽度计算中心。

一期忽略二期使用的解析回调。L1 沿用原有建筑的几何、高度与 OSM 身份。此次复验不测帧率。
