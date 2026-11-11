# WP-C 交付报告：生成器抽取与小范围构建

分支：`phase2/C-builder`（基于 `phase2/B-tiles`）。机器：AMD Ryzen 7 7840S（16 线程），13 GB，Linux 7.2，Node v24.18.0。日期：2026-11-12。

## 交付内容

- `packages/builder`：`plan`（一期解析与规划规则按规划格加 800 m 缓冲圈运行）、`cut`（归属、全局网格裁切、L0 体块、建筑上下文层、平坦地面合并、地标烘焙）、`pipeline`（ingest → partition → plan → cut → encode → finalize，按输入哈希缓存、原子写入、`--resume`）、`validate`、`inspect`、`serve`、CLI。
- `packages/generators`：建筑（复用一期围护面、屋顶和 `writeBuildingBody`）、地面/水域/绿地三角化、道路与桥面带、L0 体块、树木实例数据、烘焙网格，按材质角色合批。
- `city tiles build|validate|inspect|serve`，与一期 CLI 输出约定一致。
- 一期 `src/building-mesh.js`（从 `city.js` 原样抽出的建筑写入器）和类型边界 `.d.ts`。

## AC 结论

| AC | 结论 | 验证 | 结果摘要 |
| --- | --- | --- | --- |
| AC301 | 通过 | `node scripts/benchmark-tiles/build-samples.mjs <out> --json docs/phase2/evidence/C/samples.json` | `public/data` 中 13 份带范围的数据（含两份细节叠加数据）和两个 9 块基准区全部构建成功，`city tiles validate` 全部通过 |
| AC302 | 通过 | 同上 | 北京国贸 9 块 0.46 MB、京都祇园 9 块 0.70 MB（gzip；预算 4 MB / 12 MB；一期 110.6 MB / 296.9 MB）。所有 L1 瓦片最大 203 KB（硬上限 1 MB，第 95 百分位目标 250 KB）。超过中位数目标 60 KB 的样本：曼哈顿 98 KB、京都 9 块 94 KB（建筑密集）。L0 最大 184 KB（京都），超过 150 KB 的第 95 百分位目标但低于 500 KB 硬上限 |
| AC303 | 通过 | `test/phase2-builder.test.js`；另对北京国贸、京都祇园手工比较 | 单个全局规划格与 z12、z13、z14 规划格（4 个以上）构建的全部瓦片哈希一致 |
| AC304 | 通过 | `test/phase2-builder.test.js` | 两次构建逐字节相同（瓦片、`tileset.json`、`coverage.bin`、`report.json`） |
| AC305 | 通过 | `test/phase2-builder.test.js` | 4 个样本：瓦片建筑（含地标认领的建筑）身份集合与一期 `parseOSM` 建筑集合（即一期 `featureIndex` 的建筑来源）相同，每栋只在一块 L1 瓦片中 |
| AC306 | 通过（差异逐类说明） | `test/phase2-generators.test.js` | 3 个样本 888 栋建筑中 886 栋包围盒差 ≤ 2 cm 且三角形数相同；三角形总数差 < 0.02%。例外 2 栋：(a) 两面墙长度差恰在 10 cm 平局阈值附近 ±4 cm 量化带内，入口雨棚落在另一面墙，包围盒差 0.23 m、三角形数相同；(b) 立面开间数在长度阈值处翻转，三角形 +7% |
| AC307 | 通过 | `test/phase2-builder.test.js` | 北京国贸与阿姆斯特丹：每对相邻 L1 瓦片在 ground/water/green 三层各随机抽 20 个边界点，覆盖与高程集合两侧一致（高程差 ≤ 1 cm，含桥面与地面叠置）；道路中心线在边界的切点网格坐标与高程两侧完全相同 |
| AC308 | Node `worker_threads` 通过；浏览器 Worker 未验证 | `test/phase2-generators.test.js` | 无 DOM 的 Worker 与主线程生成的全部数组逐值相等（差为 0）。浏览器 Worker 由 WP-D 验证 |
| AC309 | 通过 | `test/phase2-builder.test.js` | 6 次在 ingest/plan/cut/encode/finalize 的随机位置中断后 `resume`，产物与未中断构建逐字节相同 |
| AC310 | 通过 | `test/phase2-builder.test.js` | `report.json` 含各类对象数量、各属性三种来源等级计数、不完整关系数、回退清单、体积统计、预算诊断和哈希；`--json` 时标准输出只有一行结果，进度在标准错误，退出码 0/1 |
| AC311 | 通过 | `test/phase2-generators.test.js` | 生成器代码路径不引用 DOM、WebGL 或渲染器；在无 DOM 的 Worker 中运行通过 |
| AC312 | **未通过** | `node scripts/benchmark-tiles/generate-measure.mjs <out> --json docs/phase2/evidence/C/generate-measure.json` | 167 块 L1：p50 5.8 ms，p95 约 130 ms，最大约 190 ms。超出的是建筑密集瓦片（每块 600–1,300 栋）。处理方式见决策 E5 |

## 未完成或简化的任务

- C4：桥梁只生成带厚度的桥面带（`structure` 层），未生成桥墩、护栏和楼梯细节；一期 `road-structures.js`、`road-stairs.js` 尚未接入。
- C6：L0 的"同一建筑多个分部合并为不超过 3 段"未实现，分部各自简化输出；小建筑按 50 m 格合并时保留各自轮廓（未求并集）。
- `ground` 中的路面标线、坡道保持原碎片，体积仍以地面为主。
- `--concurrency` 已接受但规划格仍顺序执行（并行与 AC606 留给 WP-F）。
- PBF 输入与 `city tiles pack` 明确报错，留给 WP-F。

## 提交

`f5cf1bb`（抽出 building-mesh）、`3716757`（builder 与 generators）、CLI 与划分无关性修复、`test(phase2)` 验收测试、地标烘焙、性能优化，以及本报告所在提交。

## 偏离与决策

- E4：一期模块单一来源加类型边界；新增 `buildingContext` 层和 `area` 属性；平坦地面合并；规划格不细于 L0；按路名组扩大读取范围；入口雨棚平局规则。
- E5：AC312 未达标的记录与处理。

## 已知限制

- 耗时均为 Node 单线程测量，不代表浏览器或 GPU 性能。
- 生成器通过相对路径引用 `src/` 中的一期模块，发布前需打包或迁入（WP-J）。
- 一期立面着色器属性（`aFacade` 等）已随批次输出，但样式绑定在 WP-D/WP-G 完成。
