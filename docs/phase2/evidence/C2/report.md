# WP-C 补充（C2）交付报告：观感修复

分支：`phase2/C2-visual-fixes`（基于 `phase2/H-maplibre`）。机器：AMD Ryzen 7 7840S，集成显卡 Radeon 780M（非用户指定的参考设备），Chrome 150，Linux 7.2，Node v24.18.0。日期：2026-11-12。

## 修复内容

| 问题（独立审查） | 原因 | 修复 |
| --- | --- | --- |
| L0 没有主干道 | 构建期已写出 L0 主干道（`road` 层，motorway–secondary），但生成器的带状几何绕序反了，顶面朝下被背面剔除；桥面板顶面同样不可见 | 按法线确定绕序（`packages/generators/src/structures.ts` 的 `quad`），L0 道路带和桥面板都可见 |
| L0/L1 交界色差 | L0 体块用固定浅灰，L1 用一期立面配色 | L0 体块改用一期 `MeshWriter` + `buildingStyle` + `facadeLayout`：颜色、材质角色（`wall`/`glass`/`roof`）和立面着色器属性与 L1 同一建筑一致 |
| 桥梁只有桥面板 | C4 未接入一期 `road-structures.js`、`road-stairs.js` | 构建期调用 `planRoadStructures`（需要邻近建筑与道路做净空检查）写出护栏、扶手、桥墩，按 OSM 台阶写出楼梯；生成器调用一期新拆出的 `writeRoadStructures`、`writeRoadStairs` 写网格（一期场景路径调用同一函数） |
| 京都两层小屋也有屋顶设备 | 一期 `roofEquipment` 只看占地 ≥ 160 m² | 高度 < 12 m 且占地 < 1,500 m² 不放设备（决策 E7） |
| 京都传统街区全是平顶 | 屋顶推断默认关闭 | 构建默认不变；demo 样本构建时显式开启一期保守推断（E7 第 5 条），运行时可用 `ProvenanceFilter` 关闭（WP-G） |

格式变化：`structure` 层 `kind` 新增 `rail`、`rail.walk`、`pier`、`stairs`（向后兼容的次要扩展，见 E7）。

## 验证

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 绕序、L0/L1 同色、桥梁结构、屋顶设备阈值、划分无关 | `node --test test/phase2-generators-visual.test.js` | 5 项通过：北京国贸 L0 道路带三角形全部与法线一致；L0 与 L1 同一建筑的墙色、角色、立面族一致的比例 > 97%（阈值）；L1 瓦片含 `deck`、`rail`、`rail.walk`、`pier`、`stairs` 五类，结构三角形 > 1 万；单格与默认规划格构建的瓦片哈希一致 |
| AC306、AC308、AC311 | `node --test test/phase2-generators.test.js` | 通过（AC311 的文件清单加入 `structures.js`、`road-structures.js`、`road-stairs.js`） |
| 全部测试 | `npm test` | 364 项通过（359 + 5） |
| 类型、构建 | `npm run test:types`、`npm run build` | 通过 |
| 浏览器检查 | `CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" node scripts/benchmark-tiles/{map-checks,overlay-checks,maplibre-checks,bundle-check}.mjs` | WP-D、WP-E、WP-H 全部 AC 复跑通过 |
| 截图 | `node scripts/benchmark-tiles/style-shots.mjs <仓库外目录> --samples beijing,kyoto` | 人工查看：北京远景 L0 区域出现主干道，远处高楼与近处同色（深灰玻璃幕墙），交界处不再是"浅灰体块 → 彩色"；人行天桥有扶手、两端楼梯；京都小屋不再有屋顶设备，部分小屋为坡屋顶 |

示例样本中的结构数量（`apps/demo/build-tiles.mjs` 构建的瓦片，L1）：北京国贸 9 块：桥面 75、护栏 85、扶手 37、桥墩 165、楼梯 20；京都祇园 9 块：桥面 47、护栏 120、扶手 204、桥墩 92、楼梯 7；曼哈顿金融区：桥面 16、护栏 6、扶手 34、桥墩 23。

## 代价与未解决

- 京都 demo 瓦片开启屋顶推断后，可见三角形从约 48 万增至约 72 万，HUD 显示的 Worker 生成第 95 百分位从约 526 ms 增至约 634 ms（非参考设备，仅作开发参考）。生成耗时优化单独处理（见 WP-C3 的报告）。
- 楼梯与桥墩整体归属一块瓦片，跨瓦片边界的长楼梯在另一块瓦片未加载时看不到。
- 桥墩盖梁坡度由 1 cm 高程量化后恢复，绝对值 < 0.03 时取 0。
- 阴影、窗格着色器和环境光遮蔽属于 WP-G，见其报告。

## 提交

见 `git log phase2/H-maplibre..phase2/C2-visual-fixes`。

## 偏离与决策

- E7（本次新增）。
