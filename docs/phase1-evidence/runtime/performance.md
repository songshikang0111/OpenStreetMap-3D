# Runtime 浏览器性能证据

日期：2026-11-03（Asia/Shanghai）。完整矩阵运行时基线：`d8cbb9e539180eb30ac069a8af6995eaa6ec5d80`；定向最终代码复现见 summary.json 的 reruns。所有 core-* 样本使用真实 A CINK 资产和 C 官方风格；synthetic 明确是合成连续区域 fixture，beijing/kyoto 读取仓库中的原始 OSM 快照，没有重复平铺城市来冒充扩区。

设备：13th Gen Intel(R) Core(TM) i5-13600KF，20 逻辑核，32581.3 MiB RAM；ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)；win32 10.0.26300；Chromium 153.0.8010.12，WebGL 2.0 (OpenGL ES 3.0 Chromium)。1280×720 CSS，DPR 1，balanced，96 MiB streamed resident estimate，900000 全帧 triangles，1500 calls，3 concurrent loads，18000 near attachments。背景系统负载未隔离；不把该设备结果外推到其他 GPU/移动端。

全部15组各60秒，固定路径包含俯瞰、街道、跨块、FOV/快缩放、离开覆盖再返回。每组另做同机位 full/far/far 对照，以及5次资源往返。完整 shader/阴影/normal/ID/AO/composite/resolve 均计入 renderer.info；autoReset=false，每帧只在开头 reset。

## 60秒预热路径

| 样本 | 建筑数 / 块 | p50 / p95 / p99 ms | >50ms帧 | 近景段 p95 / 远景段 p95 | 峰值驻留估计 MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| [core-synthetic-fixed-1](./browser/core-synthetic-fixed-1.json) | 7 / 1 | 8.3 / 8.4 / 8.5 | 5 | 8.4 / 8.4 | 9.2 |
| [core-synthetic-fixed-4](./browser/core-synthetic-fixed-4.json) | 7 / 4 | 8.3 / 8.4 / 8.5 | 0 | 8.4 / 8.4 | 8.6 |
| [core-synthetic-fixed-16](./browser/core-synthetic-fixed-16.json) | 7 / 16 | 8.3 / 8.4 / 8.5 | 0 | 8.4 / 8.4 | 8.4 |
| [core-beijing-cbd-fixed-1](./browser/core-beijing-cbd-fixed-1.json) | 477 / 1 | 8.3 / 8.4 / 8.5 | 1 | 8.4 / 8.4 | 65.5 |
| [core-beijing-cbd-fixed-4](./browser/core-beijing-cbd-fixed-4.json) | 477 / 4 | 8.3 / 8.4 / 8.5 | 4 | 8.4 / 8.4 | 94.0 |
| [core-beijing-cbd-fixed-16](./browser/core-beijing-cbd-fixed-16.json) | 477 / 16 | 8.3 / 8.4 / 8.5 | 9 | 8.4 / 8.4 | 65.5 |
| [core-beijing-cbd-grow-1](./browser/core-beijing-cbd-grow-1.json) | 14 / 1 | 8.3 / 8.4 / 8.5 | 4 | 8.4 / 8.4 | 17.3 |
| [core-beijing-cbd-grow-4](./browser/core-beijing-cbd-grow-4.json) | 92 / 4 | 8.3 / 8.4 / 8.5 | 15 | 8.4 / 8.4 | 32.0 |
| [core-beijing-cbd-grow-9](./browser/core-beijing-cbd-grow-9.json) | 286 / 9 | 8.3 / 8.4 / 8.5 | 10 | 8.4 / 8.4 | 55.4 |
| [core-kyoto-gion-fixed-1](./browser/core-kyoto-gion-fixed-1.json) | 4460 / 1 | 8.3 / 8.4 / 8.5 | 1 | 8.4 / 8.4 | 94.8 |
| [core-kyoto-gion-fixed-4](./browser/core-kyoto-gion-fixed-4.json) | 4460 / 4 | 8.3 / 8.4 / 8.5 | 4 | 8.4 / 8.4 | 94.9 |
| [core-kyoto-gion-fixed-16](./browser/core-kyoto-gion-fixed-16.json) | 4460 / 16 | 8.3 / 8.4 / 8.6 | 8 | 8.4 / 8.4 | 94.9 |
| [core-kyoto-gion-grow-1](./browser/core-kyoto-gion-grow-1.json) | 601 / 1 | 8.3 / 8.5 / 16.7 | 32 | 8.5 / 8.4 | 30.9 |
| [core-kyoto-gion-grow-4](./browser/core-kyoto-gion-grow-4.json) | 2017 / 4 | 8.3 / 8.5 / 16.7 | 27 | 16.6 / 8.5 | 65.6 |
| [core-kyoto-gion-grow-9](./browser/core-kyoto-gion-grow-9.json) | 3912 / 9 | 8.3 / 8.4 / 8.5 | 6 | 8.4 / 8.4 | 78.0 |

近景段为路径12–21秒，远景段为0–7及56–60秒；由原始RAF时间与路径起点对齐。p95目标33.3ms全部通过，但长帧仍存在，尤其首次上传、着色器与重载边界；没有删除这些帧或缩短指定路径。

## 实际全帧 LOD 对照与传输

| 样本 | full / far triangles p50 | full / far calls p50 | CPU geometry MiB full / far | 实传 MiB / body MiB | 5次往返 |
| --- | ---: | ---: | ---: | ---: | --- |
| core-synthetic-fixed-1 | 719018 / 91934 | 172 / 67 | 4.7 / 1.0 | 10.6 / 72.6 | pass |
| core-synthetic-fixed-4 | 719018 / 91934 | 332 / 165 | 4.9 / 1.0 | 11.0 / 61.2 | pass |
| core-synthetic-fixed-16 | 719018 / 91934 | 676 / 354 | 5.1 / 1.0 | 11.8 / 84.6 | pass |
| core-beijing-cbd-fixed-1 | 7327694 / 2619228 | 2432 / 98 | 101.2 / 65.5 | 596.1 / 596.1 | pass |
| core-beijing-cbd-fixed-4 | 7327688 / 2619222 | 2867 / 350 | 101.5 / 65.5 | 616.4 / 647.8 | pass |
| core-beijing-cbd-fixed-16 | 7092185 / 2512367 | 4132 / 1038 | 102.4 / 65.5 | 565.1 / 762.1 | pass |
| core-beijing-cbd-grow-1 | 591244 / 156608 | 210 / 74 | 9.0 / 3.6 | 90.1 / 117.3 | pass |
| core-beijing-cbd-grow-4 | 2529577 / 795593 | 987 / 292 | 29.5 / 18.7 | 249.6 / 378.8 | pass |
| core-beijing-cbd-grow-9 | 4835113 / 1617636 | 2501 / 579 | 65.2 / 39.1 | 381.2 / 598.9 | pass |
| core-kyoto-gion-fixed-1 | 6771748 / 3062884 | 22483 / 114 | 202.7 / 94.8 | 920.4 / 920.4 | pass |
| core-kyoto-gion-fixed-4 | 6771748 / 3062884 | 22976 / 427 | 203.2 / 94.9 | 939.3 / 939.3 | pass |
| core-kyoto-gion-fixed-16 | 6771748 / 3062884 | 24046 / 1212 | 204.4 / 94.9 | 839.6 / 1085.7 | pass |
| core-kyoto-gion-grow-1 | 379260 / 82204 | 3125 / 69 | 16.1 / 2.6 | 289.8 / 342.2 | pass |
| core-kyoto-gion-grow-4 | 1940191 / 772508 | 10567 / 294 | 70.4 / 24.7 | 635.2 / 802.8 | pass |
| core-kyoto-gion-grow-9 | 5260202 / 2476636 | 20623 / 702 | 168.6 / 78.0 | 697.3 / 825.5 | pass |

full/far 控制组在同一机位强制不同资产，明确绕过自动LOD降级；full控制可能超预算。geometry bytes 仅CPU数组，residentBytes为协议/准备后缓冲估计，均不是实际显存。Resource Timing 记录实际 transferSize/encodedBodySize（cache命中可为0 transfer），SDK fetchedBytes 则含缓存读取的解码payload，不能混称网络实传。16分块合成样本曾碰到默认250条资源时间线限制，已以10000条缓冲完整复跑并替换该条原始报告。

## 输入、构建与冷启动

| 样本 | 物理块尺寸m | 包体 MiB（含manifest） | build ms | 构建RSS结束 MiB | 首次含几何帧 / 完整目标加载 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| core-synthetic-fixed-1 | 600.0×600.0 | 10.6 | 338.6 | 123.6 | 948.1 / 1152.6 |
| core-synthetic-fixed-4 | 300.0×300.0 | 11.0 | 280.4 | 126.2 | 99.3 / 167.3 |
| core-synthetic-fixed-16 | 150.0×150.0 | 11.8 | 369.2 | 127.6 | 66.5 / 360.9 |
| core-beijing-cbd-fixed-1 | 1966.7×1776.5 | 253.7 | 10119.7 | 468.4 | 496.0 / 496.1 |
| core-beijing-cbd-fixed-4 | 983.3×888.3 | 255.3 | 10321.5 | 770.6 | 269.9 / 562.6 |
| core-beijing-cbd-fixed-16 | 491.7×444.1 | 260.7 | 9683.2 | 877.8 | 292.0 / 669.6 |
| core-beijing-cbd-grow-1 | 500 | 20.6 | 481.2 | 173.9 | 165.7 / 289.2 |
| core-beijing-cbd-grow-4 | 500 | 75.3 | 1536.9 | 318.6 | 171.2 / 306.4 |
| core-beijing-cbd-grow-9 | 500 | 163.0 | 5734.6 | 594.9 | 251.4 / 451.2 |
| core-kyoto-gion-fixed-1 | 1131.9×920.8 | 493.3 | 24578.5 | 1612.4 | 727.5 / 727.7 |
| core-kyoto-gion-fixed-4 | 566.0×460.4 | 495.9 | 24627.4 | 1604.7 | 266.8 / 687.4 |
| core-kyoto-gion-fixed-16 | 283.0×230.2 | 503.7 | 25568.0 | 1626.5 | 205.7 / 816.8 |
| core-kyoto-gion-grow-1 | 300 | 36.1 | 1408.7 | 335.2 | 168.4 / 175.8 |
| core-kyoto-gion-grow-4 | 300 | 166.9 | 4848.2 | 667.5 | 189.8 / 346.0 |
| core-kyoto-gion-grow-9 | 300 | 413.6 | 19102.1 | 1331.5 | 208.7 / 702.8 |

构建耗时覆盖compileScene，RSS为同进程结束值（不是峰值）；原始报告保留开始/结束memoryUsage、输入数量、快照SHA-256、world/manifest hash。北京固定块500m，京都固定块300m，后者9块900m×900m仍在同一快照内。固定覆盖1/4/16保持同一真实区域，固定物理块1/4/9增加真实建筑/植被数量，两个实验没有混用。

补充冷启动探针使用最终生产包、每例新browser context。firstRenderedMs从manifest请求到首个含几何整帧提交完成；firstRenderedAtMs使用navigation-origin，包含SDK启动前段；allLoadedMs从同一请求起点到当前目标完整加载。旧runtime.firstUsableMs是首挂载标记，不作为首画面报告。GPU/显示完成时间未测，GPU timer虽被设备支持但未采集，不将CPU/RAF时间称GPU时间。

## 支持边界与结论

本机15条60秒路径的p95全部达到33.3ms目标，远景实际triangles/驻留低于full对照，5次返回均回到稳定资源计数，实际并发不超过3。连续区域、近景与远景数据均保留原始统计。

900000全帧triangle预算下，1/4块覆盖可在最低细节内工作；9块北京/京都及完整固定范围的最低几何仍会产生COVERAGE_EXCEEDS_BUDGET / MEASURED_DRAW_BUDGET诊断。帧率通过不等于这些范围满足该triangle上限；其支持边界是缩小覆盖、提高明确预算或进一步构建简化。SDK保留必要覆盖，不以隐藏城区来伪装预算通过。普通自动路径的驻留估计在96MiB内；原子替换的短暂headroom单独诊断，紧预算回归有稳定实测。

截图来自实际生产WebGL viewer，见browser/*-overview.png；路径keys、逐帧JSON、环境、冷/热、full/far、加载/卸载/取消/资源往返全部保留。独立审查和最终京都60秒复现另见review.md。其他浏览器、移动GPU、Mac/Linux均未实测。
