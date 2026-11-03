# A 核心修复交接

2026-11-03。分支`codex/phase1-core-repair`；工作区为原phase1-core worktree。基线`dee3cc8`，原`codex/phase1-core`保留。**产品冻结提交 `e03aaa85683bddb09f816be091a5afa18c60f51c` 可集成。** 后续本目录证据提交不改变产品代码。未改主仓库、其他任务worktree、SDK/runtime、source/style参数或默认预算。

## 交付与集成

按顺序合入修复提交（也可合入本修复分支），不重复原核心历史：

1. `a6b9292`：真实主体/树/道路LOD及合批，low真实caster关闭。
2. `0ba73f2`：拓扑、桥底高程、外部材质保真和真实caster校验。
3. `3a84c51`：完整组可选nearDetails字段、类型/Schema和资源真值校验。
4. `3963eb2`：共享表面真实cell裁切、各LOD共同桥壳/台阶、世界变换bounds。
5. `b5a8c39`：有界平面候选、细扶手主轮廓和原子几何快速路径。
6. `a66fe8b`：快速路径保留全部multipart成员身份。
7. `e03aaa8`：有方向的内侧去重、同向叠桥保留完整外皮。

具体实现及D字段契约见[implementation](implementation.md)，独立审查见[review](review.md)。generator版本为1.1.0，CINK与manifest schemaVersion仍为1；必须重建资产，不能沿用旧性能缓存。相关生成器仅增加既有road structures计划的共享访问和stair helper导出。跨组件测试`phase1-e2e-core.test.js`仅按low地面附着底面省略更新角色断言；悬空底面新增测试仍要求完整保留。

## 全12案CPU成本

所有案例由现有`scripts/phase1-build-cases.mjs`串行重建于同一冻结产品提交，seed1、官方地标、comic/balanced、原指定范围。北京grow物理块500m，京都300m；fixed分别1/4/16块，grow分别1/4/9块。**没有缩小覆盖、提高预算或删除必要对象。** 每个LOD均逐CINK解码、验证真实成本、绑定comic材质后再计数；fixed三种切法的世界身份与low/medium/high原子几何哈希全部一致。连续面因真实裁切允许三角剖分不同，以实际世界覆盖和高度测试核验。

表中L/M/H均为完整覆盖的**单场景pass triangles / draws**；右侧是low漫画整帧保守上界。精确caster、near、bytes、residentBytes、source/config/hash、原子几何hash与mesh成本见[cost-summary.json](cost-summary.json)。

| 案例 | Low 单pass | Medium 单pass | High 单pass | Low 整帧上界 | Low MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| 北京 fixed-1 | 101814 / 14 | 597727 / 23 | 1471289 / 1222 | 407262 / 59 | 7.61 |
| 北京 fixed-4 | 103050 / 52 | 599047 / 87 | 1473253 / 1314 | 412206 / 211 | 7.50 |
| 北京 fixed-16 | 105436 / 175 | 601785 / 273 | 1476699 / 1592 | 421750 / 703 | 7.64 |
| 北京 grow-1 | 5126 / 12 | 47433 / 18 | 118117 / 71 | 20510 / 51 | 0.34 |
| 北京 grow-4 | 32964 / 45 | 206713 / 74 | 506119 / 345 | 131862 / 183 | 2.31 |
| 北京 grow-9 | 67771 / 98 | 411877 / 150 | 975072 / 972 | 271090 / 395 | 4.77 |
| 京都 fixed-1 | 145620 / 12 | 650692 / 27 | 1342117 / 13354 | 582486 / 51 | 14.92 |
| 京都 fixed-4 | 146642 / 48 | 652016 / 103 | 1344099 / 13460 | 586574 / 195 | 14.43 |
| 京都 fixed-16 | 149008 / 173 | 654824 / 314 | 1348707 / 13696 | 596038 / 695 | 14.62 |
| 京都 grow-1 | 10324 / 11 | 62538 / 18 | 77068 / 1825 | 41302 / 47 | 0.95 |
| 京都 grow-4 | 48523 / 43 | 237591 / 77 | 389124 / 6132 | 194098 / 175 | 4.71 |
| 京都 grow-9 | 120535 / 99 | 521261 / 179 | 1046344 / 11909 | 482146 / 399 | 11.96 |

上界公式：`4 × mainTriangles + actualShadowTriangles + 6`；draw为`4 × mainDrawCalls + actualShadowDrawCalls + 3`。不按统一×5推测。所有low真实caster=0、nearDetails=0，完整覆盖上界均在**600000 triangles / 1200 draws**内，low数组驻留均低于128MiB。该结果证明调度器存在保持完整主体覆盖的可行低档；medium/high完整常驻仍可能超限，需要D按真实成本选择LOD和附件。不能把单pass或此CPU上界写成真实GPU测量。

北京fixed-1的low主要为道路61800、树干/冠各14720、建筑6822；京都为道路64184、建筑63572、树干/冠各5868。细分支持面/桥壳/护栏成本保存在cost-summary的roadTriangles。所有树、外露普通建筑、地标分组、观测道路/水域保留。grow-4与京都grow-9的4项无可见面源身份逐项证明为原普通envelope内部面，身份仍在索引，外体实际存在；详见review与sourceInternalFeatures，未把其作为通用缺失豁免。

## 验证与重现

- 冻结产品提交`e03aaa8`：`npm test` **287/287**；`npm run test:types`通过；`npm run build`的演示/Studio/SDK三套产物通过（Vite既有大包提示）。
- 四个核心/集成测试文件 **49/49**；repair/partition **23/23**。
- [ground混合覆盖](mixed-ground.json)：53种纯档/单块升级/回退/棋盘/条带图案，每图案900采样点，0洞/0重叠，面积360000m²。
- [road混合覆盖](mixed-road.json)：53图案，每图案300采样点，0洞/0重叠，面积5800m²。
- [bridge混合覆盖](mixed-bridge.json)：400个共同外侧面样本，逐块low→high升级全部通过；空results表示无失败。
- 水面、53图案共同桥壳、1/4/16父变换/反射/多材质/实例bounds以及5mm外凸共同cap/side由永久partition测试覆盖。根只读探针复制到本worktree重跑时仅改工作区路径；JSON均明确记录冻结提交。原探针不替代永久测试。
- 独立审查另验证600个平面样本和442个变换后混合覆盖样本，见review。

复现CPU包与审计：

```sh
node scripts/phase1-build-cases.mjs work/core-repair-frozen
node docs/phase1-evidence/remediation/core/audit-costs.mjs work/core-repair-frozen
node --test test/phase1-core-repair.test.js test/phase1-core-partition.test.js test/phase1-core.test.js test/phase1-e2e-core.test.js
npm test
npm run test:types
npm run build
```

生成模型与日志留在ignored work，未提交大型资产。audit-costs要求完整12案及同一compilerCommit，并保存审计脚本SHA，拒绝混用中间构建。

## AC范围与剩余依赖

A提供AC06/09/10/11/12/16的核心协议、复现、归属、混合覆盖与真实主体LOD证据，并支持AC18/20的默认预算可行性。独立核心审查支持AC27的组件范围。未宣称整个一期已通过。

E须在统一集成提交上重建全部12案并串行执行每案至少60秒真实WebGL整帧测量、冷启动/加载逐帧数据与每案五轮往返；D须核验固定镜头稳定、实际caster倍率、全局near预算和附件剩余额。AC17/18/19/20与最终AC27仍以该集成结果为准。无需更改600k/1200/18000默认阈值；若实际整帧发现超限或接缝，应回到真实几何/调度修复，不能靠缩小案例放行。
