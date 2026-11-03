# 最终 12 案性能原始数据独立复核

日期：2026-11-03。审查者：`/root/architecture_review`。只读核对已有 raw，没有重新启动浏览器／GPU，没有修改产品源码或汇总脚本。复现命令：`node work/architecture-review/review-performance.mjs`。完整重算值、逐帧超限数、60次资源计数、每份 raw SHA-256 及输入摘要哈希见同目录 `final-performance-review.json`。

冻结运行提交 `9407af9c752b6b7cfc32eb4fb17622824e453cfd`，实际产品代码 `2c013fb0f8114c2dd1cba67ee1a2cd131e565aed`；当前复核 HEAD 为文档／汇总脚本提交 `4dd35b3`。实际读取 dist-sdk 文件独立计算 SHA-256 为 `d22408bc6be5535a5ddd2645bdb22ddcde79c25103cd6721407a2abe5a2a0900`，与 summary.environment 一致。旧 737 八案已取消归档，未混入本次正式12案。

**原始数据与汇总一致性复核：pass，0项不一致。帧率／统计目标：pass。默认绘制预算：fail。联合验收：fail。** 这里的审计 pass 指计算准确，不把产品预算失败改写成通过。

## 重算方法与结果

- 不调用作者 distribution；对全部原始值独立排序，采用最近秩 ceil(p*N)-1 重算 p50/p95/p99/max 和 count。RAF、GPU、CPU callback、draws、triangles 全部与 raw／assessment／summary 对应值一致。
- 12个预期名称逐一显式枚举，未从汇总中择取成功项；无缺案、重复案、error案。总共 **86109帧、86109个GPU样本**；所有frameCount=raw frames+首个无interval帧，没有统计窗口裁剪，13个>50ms长帧全部保留。
- 每案最后的 performance.now 实测相机路径时间为 **60.00000000007–60.00800000010秒**，时间采样单调且每案至少61个采样。原始RAF时间窗有的为59.994秒，来自首末帧边界，比持续运行的相机路径少约一个RAF边界；已记录而未伪称每个raw帧窗口都满60.000秒。
- 每案RAF p95均8.4ms，满足33.3ms目标；GPU p95范围 **4.771840–7.036928ms**。硬件样本与RAF是两个量，未互相替代。1280×720、device DPR和实际pixelRatio均1、balanced；硬件记录为RTX4090／Chrome156／WebGL2。
- 自动路径峰值估算驻留 **105491697 bytes = 100.60 MiB**，小于128MiB；这是CPU数组／资源估计，不是实测GPU显存。生命周期累计peak计数还包含强制full对照的超预算阶段，JSON另列该峰值，没有将自动路径峰值冒称全实验峰值。
- 核对 path、far/full/farAfter，以及60次离开/返回的GPU查询：created-deleted=unreleased=pending+active，均不超过maxPending+active，errors/deleteErrors/invalidResults均0。没有把pending查询当已完成样本。
- 12案各5轮资源往返均精确稳定：返回时几何／材质／纹理／CPU数组／估算驻留及renderer几何／纹理／program数量不增长；远离时城市和近景引用计数／数组归零；返回稳定驻留均在预算内。该结论是原始硬件结果的独立核算，不是本角色重新渲染。
- 每案far的CPU几何数组、实际整帧三角数p50和draws p50均低于full，farAfter恢复同CPU资源基线；并发≤3，浏览器无error事件，所有非绘制预算检查为true。
- 源OSM文件实际SHA与raw一致。北京／京都fixed1/4/16的area、origin、sourceHash、worldHash和feature数一致；grow1/4/9均使用相同origin／固定物理格宽，feature数递增。北京nominal500m，京都nominal300m，未把同一范围的分文件实验当扩区。

| 案例 | 实测路径秒 | 原始帧数 | RAF p50 / p95 / p99 ms | GPU p50 / p95 / p99 ms | draws / triangles p95 | 绘制预算（p95） |
| --- | --- | --- | --- | --- | --- | --- |
| beijing-cbd-fixed-1 | 60.001600 | 7199 | 8.300 / 8.400 / 8.500 | 4.342 / 5.662 / 6.520 | 118 / 2638236 | fail |
| beijing-cbd-fixed-4 | 60.001000 | 7199 | 8.300 / 8.400 / 8.500 | 3.927 / 5.076 / 5.563 | 430 / 2638230 | fail |
| beijing-cbd-fixed-16 | 60.007200 | 7187 | 8.300 / 8.400 / 8.500 | 5.505 / 6.809 / 7.623 | 1298 / 2531375 | fail |
| beijing-cbd-grow-1 | 60.001100 | 7061 | 8.300 / 8.400 / 8.500 | 4.214 / 5.921 / 9.511 | 350 / 592086 | pass |
| beijing-cbd-grow-4 | 60.005600 | 7200 | 8.300 / 8.400 / 8.500 | 3.611 / 4.772 / 5.465 | 368 / 810569 | fail |
| beijing-cbd-grow-9 | 60.000000 | 7189 | 8.300 / 8.400 / 8.500 | 4.480 / 5.908 / 6.630 | 731 / 1632516 | fail |
| kyoto-gion-fixed-1 | 60.000300 | 7199 | 8.300 / 8.400 / 8.500 | 4.497 / 5.811 / 6.375 | 126 / 3090196 | fail |
| kyoto-gion-fixed-4 | 60.000900 | 7199 | 8.300 / 8.400 / 8.500 | 4.063 / 5.202 / 5.754 | 475 / 3090196 | fail |
| kyoto-gion-fixed-16 | 60.005500 | 7185 | 8.300 / 8.400 / 8.500 | 5.673 / 7.037 / 7.347 | 1404 / 3090196 | fail |
| kyoto-gion-grow-1 | 60.001300 | 7125 | 8.300 / 8.400 / 8.500 | 4.019 / 6.351 / 9.768 | 81 / 83980 | pass |
| kyoto-gion-grow-4 | 60.002800 | 7200 | 8.300 / 8.400 / 8.500 | 3.649 / 4.853 / 5.369 | 342 / 785420 | fail |
| kyoto-gion-grow-9 | 60.008000 | 7166 | 8.300 / 8.400 / 8.500 | 4.619 / 5.896 / 6.475 | 806 / 2499436 | fail |

## 预算与汇总是否掩盖失败

- 默认预算全案保持600000整帧三角形、1200draws、128MiB估算驻留、并发3，没有提高阈值来过关。**10/12案三角p95超限；北京和京都fixed16两案draws p95超限**。assessment.status=fail、timingStatus=pass；README明确写联合检查fail，并列出失败行。
- p95通过不等于逐帧从未超限：京都grow1的draws p95=81，但有10帧>1200、max2626；京都grow9有7帧>1200、max1627，p95=806。两者均保存在原始帧和本审查JSON，未被截掉。最新README已明确标“绘制预算 p95”，assessment新增的max与超限帧数已逐案独立核对一致；严格逐帧上限不能宣称已满足。
- 汇总脚本直接引用raw统计字段；本角色已从raw独立重算证实其值正确。CPU callback使用全部frames；没有删掉长帧、冷门失败案或GPU慢样本。传输汇总确实为冷加载+路径resource timing之和；SDK启动资源和后续对照／生命周期请求另存raw，不能把此列当整个实验的全部流量。

## 验收解释

**AC18 fail**，预算门槛未达，明确诊断并保留覆盖不会自动变成通过。**AC20可标pass（仅完整60秒证据、统计口径及p95帧间隔目标）**：规划验收矩阵已单列AC18，没必要因同一预算缺口重复判两项fail；但AC20必须带此限定，与AC18 fail和整体联合fail并列，不能写成“整体性能全部通过”。
AC04最新真实获取仍TIMEOUT fail；整体AC27按协调者记录为not-run，原因是另一独立UI验收角色被工具拒绝／浏览器不可用而未进入UI，作者操作不能替代要求的独立角色。本架构角色及本次raw核算完成，不因此宣布一期全验收通过。
本次没有发现raw汇总的不一致或新增代码P1/P2。旧737历史raw仍保存在 `fixed1-before-camera.json`，只作为修前历史；正式结果只使用本次9407冻结的12案。
