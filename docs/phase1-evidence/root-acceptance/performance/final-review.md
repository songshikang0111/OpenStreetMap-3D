# 主对话独立运行时／性能复核

审查日期：2026-11-03。审查 HEAD：`7c837551f5e364c98bbc19adf8d5af73a6a2ab85`。只读产品源码和已保存的真实浏览器报告；没有修改产品、没有运行全量测试、没有启动 WebGL/GPU。临时复现和重算仅保存在本目录。

结论：不能仅按旧报告维持“只有 AC18 fail”。**AC17 还存在可复现的静止镜头 LOD／请求抖动，应为 fail。** 12 案 p95 全部 8.4ms 本身没有统计造假或错误迹象；预算失败也已如实公开。

## 必须处理：静止镜头反复切换 LOD，并持续请求后取消同一资源

优先级：P2，影响 AC17；也影响 AC18 的实用性。此项是新增的行为缺陷，不是重复计算原有预算超限。

已有正式硬件 raw `docs/phase1-evidence/integration/performance/beijing-cbd-grow-1.json`：一个 500m 块，60 秒路径内 `loads=32`、`swaps=31`、`cancelled=149`。冷加载和路径合计 182 个资源请求，其中同一 medium 资源 URL 出现 160 次；`transferSize` 合计 250,990,544 bytes。路径样本 19.0078s→20.0079s 的取消计数为 33→93，约 60 次/秒。8.0073s→17.0077s，swaps 为 1→20。旧 summary 并不检查切换次数和请求抖动，因此该案例的 `checks` 仍全部 true。

为了排除“相机移动本来应切换”的解释，`stationary.mjs` 读取同一真实场景的 manifest/CINK，使用生产 `ChunkStreamer`、`NearDetails`、解码器和漫画材质，固定真实路径 t=13s／19s 的镜头 15 秒。没有创建 WebGLRenderer；按 Three.js 的 frustum/geometry 计数在 CPU 复现 4 次场景通道、1 次阴影和 3 次屏幕通道的整帧计数，并完全照 SDK 更新预算反馈。这是调度行为复现，**不提供任何 GPU 性能数字**。

执行：`node docs/phase1-evidence/root-acceptance/performance/stationary.mjs`。结果：`stationary.json`。

- t=13s 固定镜头：`position=[-54.465855332583416,26.25,-52.10670670317487]`、`target=[0.5427259487235006,19.5,-6.486136335879564]`、FOV 55。15 秒模拟出现 **28 次 high↔low swap、14 次取消**；`fetchedBytes=296,776,508`（解码前累计 payload，不是模拟网络传输）。high 在 760ms 挂载，960ms 已变 low；后续周期约 1.04–1.12 秒，high 仅存活 160–200ms。无相机/FOV 改变。
- t=19s 固定镜头：`position=[81.62020458277061,28.75,65.20333138415589]`、`target=[0.5427259487235006,18.5,-6.486136335879564]`、FOV 55。15 秒模拟 **81 次取消**；`fetchedBytes=699,907,832`。虽只保留 high，medium 资源被持续请求再取消。
- t=10s 静止控制机位仅初始化 1 次 low→high，随后稳定；t=37s 初始化后收敛 medium。说明问题与具体视野／预算反馈有关，不是复现程序无条件制造抖动。

根因和代码位置：

1. `src/sdk/index.js:161` 用 `max(draw ratio, triangle ratio)` 算同一个 passMultiplier。t=13s high 的 CPU 整帧计数为 247 draws、596,894 triangles（两项均在预算内），但 draw 比率给出 5.4222，将该数也乘到三角预算上，导致规划误判 high 超限；low 时倍率回落至 4.9075，随后再次允许 high。
2. `src/runtime/streamer.js:28` 又从下次主几何预算减去上一帧 near 附件；附件由 `src/sdk/index.js:149`、`:154` 在后续帧更新。这构成随表示切换而变化的反馈。
3. `src/runtime/policy.js:49` 的最短驻留只保护 `chooseLod`；`:66–70` 的预算降级循环会立即覆盖它，因而 high 仅存活 160–200ms，无法用默认 750ms 驻留稳定场景。
4. `src/runtime/streamer.js:42` 每帧取消 desired 不同的非最低 LOD 请求；`:57–67` 下一帧又可启动，产生重复请求。取消保留并发槽直到传输确认这一点是正确的（`:149–154`），但没有消除抖动源头。

建议修复后：在两个固定机位用真实浏览器复验稳定状态，记录至少 15 秒逐帧 desired/current LOD、passMultiplier、near 成本、取消次数和同 URL 请求数；预算回归应同时约束 tri 与 draw 的独立反馈，避免用 draw 的放大系数误降三角级别。不能仅增大 budget 或只检查最终 `settled`。

## 既有性能证据的独立复核

执行：`node docs/phase1-evidence/root-acceptance/performance/audit.mjs`；独立结果：`audit.json`。

- 12 个预期案例齐全；从所有 raw 帧独立排序重算最近秩 p95，RAF／GPU／draw／triangle 均与 raw、summary、assessment 相同，0 项不一致。
- **86,109 帧及 86,109 个 GPU query 样本**；没有帧窗口截断，时间戳递增，间隔与相邻时间戳差一致。每案实际相机路径最后采样 ≥60 秒；每帧均有几何提交计数。
- 12 案 p95 均 8.4ms，符合记录的约 120Hz RAF 节奏。GPU p95 4.77–7.04ms、CPU callback／draws 随场景变化；相同 RAF 百分位在这台 RTX4090 上合理，不能据此称假。
- `src/runtime/statistics.js:10–18` 使用 RAF 时间戳而非 Node 计时。`src/sdk/index.js:27` 关闭 renderer.info.autoReset，`:150–157` 在整条 pipeline 前 reset，GPU query 包围 pipeline.render。`src/ink-renderer.js:390–399` 包括颜色／光照／法线／ID／AO／合成／屏幕解析，阴影在首个场景 render 内；不是只记录最后一次后处理。
- 当前 SDK bundle SHA-256 为 `d22408bc6be5535a5ddd2645bdb22ddcde79c25103cd6721407a2abe5a2a0900`，与冻结报告一致。冻结测量 commit 是 `9407af9c...`，不冒充在本次 HEAD 新跑的 GPU 测量。
- `scripts/phase1-build-cases.mjs:23–30` 确实区分同覆盖 fixed 1/4/16 与同 origin、固定物理格宽的 grow 1/4/9；北京 500m，京都 300m。raw 配置、要素数和 chunk 数与之对应。
- 全部 12 案 far 资源数组与实绘 p50 triangles/draws 均小于 full；core 确实输出不同 low/medium/high 几何。不是同几何换标签。
- 5 次离开／返回时，城市与 near 附件引用/数组清空，返回几何、材质、纹理、数组、renderer 几何/纹理/program 计数精确稳定，返回估算驻留在128MiB内。支持 AC19 的现有硬件证据，不能当作实测GPU显存或对任意无限循环无泄漏的证明。
- **10/12 案 triangle p95 超 600k，两个 fixed16 的 draw p95 超1200**。assessment 和 README 正确写联合 fail；没有提升阈值、删压力案例或截掉慢帧来通过。CPU数组/估计字节与实际显存、GPU query 时间与RAF间隔的限制表述准确。

## AC16–AC20

| AC | 结论 | 边界 |
| --- | --- | --- |
| AC16 | pass（已有源码及硬件证据复核） | 真实主体几何级别、far/full 实绘／驻留下降、high 可恢复。强制 full 对照不等于默认预算下全覆盖都能恢复 high。 |
| AC17 | **fail** | 已有移动路径 raw 的抖动和新增静止镜头 CPU 复现；修复后仍需真实浏览器固定机位复验。 |
| AC18 | **fail** | 原有绘制预算失败仍成立；并发≤3、返回估算驻留≤128MiB、远处释放和明确诊断这些子项有证据，但不能代替全项通过。请求风暴是新增问题。 |
| AC19 | pass（现有5轮硬件raw复核） | 限该数据／机器／路径；本次独立角色没有重跑GPU。 |
| AC20 | 已保存的12案覆盖、全帧统计、≥60秒及p95目标 pass | 仅此限定，不能写“整体性能／预算均通过”；AC17、AC18失败保持阻断最终一期验收。重复加载资源统计存在，但没有逐轮单独的first-usable/full-load耗时，不应宣称已测独立重复加载延迟分布。 |

本次未发现比上述问题更严重的崩溃、假渲染或伪 GPU 计时证据。新增 AC17 是必须修复的功能缺陷；原“只有AC18预算失败”的结论需要更新。
