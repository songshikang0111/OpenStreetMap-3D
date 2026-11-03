# 最终12案性能与运行时独立验收

结论：**PASS，0项不一致/未解决性能发现；AC16–AC20在记录的桌面、质量和样本范围内通过。** 本角色直接读取最终raw并用独立CPU逻辑重算，没有导入E assessment，没有新开浏览器/GPU，没有重跑全量测试。整体AC01–AC27仍由主对话汇总其他角色。

冻结compiler/SDK提交：`55862f0a2649fb9289331c9ea19b2325f35f3037`。当前SDK SHA-256：`d867e0608eb7e7e3cc16f75f1d90e219f47cfbdcf94ea9b19d3d07c20b48e66b`，与summary测量冻结值一致。12案build.compilerCommit均为该提交；来源OSM SHA与当前实际输入相符。机器：i5-13600KF、RTX4090、Windows/Chrome/WebGL2；1280×720、DPR1、balanced。移动GPU及其他设备未由本报告扩展支持。

独立结果：`final-performance-review.json`；复算程序：`final-performance-review.mjs`。root另运行的独立审计结果按原字节复制为`performance-audit.json`（原来源`work/root-remediation-acceptance/performance-audit.json`，SHA-256 `0a6f391af59fd5d5fc14feac9deef564c6ab8f01493917ca78bd1cca979c7c94`）。两个独立读取结果均pass/errors=[]。

## 完整物理帧与GPU窗口

- 12案均达到实际60秒路径，共 **86146物理帧**，含12个单独保存的initialFrame；另有86134个有效RAF间隔。每个首帧均参与triangles/draws/bytes/共同near预算，而不是从第二帧起统计上限。首帧自身max为596038tri、736draw、16700952B、410near。
- 已完成GPU样本 **86133**，加13个有界在途query，恰好覆盖86146帧；active=0。每案maxPending固定8、created-deleted=unreleased=pending+active，样本时间唯一、递增且属于该物理帧窗口。p50/p95/p99/max均从实际raw独立排序核对。没有将pending冒充已完成GPU样本。
- 最坏RAF p95为 **8.40ms**，最坏GPU p95为 **7.161856ms**。5个>50ms长帧全部保留，最大帧间隔216.7ms；通过的是p95≤33.3ms目标，没有声称每帧均匀或删除长帧。
- 自动路径所有物理帧均≤600000tri/1200draw/128MiB/18000共同near。实测max为 **599956tri、739draw、52837111B（50.39MiB）、1104near**；超限帧数均0。字节是CPU数组/驻留估计，不能称实际GPU显存。force full比较控制组与自动路径分开。

| 案例 | RAF p95 ms | GPU p95 ms | 实际tri / draw max | 自动峰值估计MiB | 共同near max |
| --- | --- | --- | --- | --- | --- |
| beijing-cbd-fixed-1 | 8.40 | 4.842 | 407262 / 59 | 8.10 | 0 |
| beijing-cbd-fixed-4 | 8.40 | 5.822 | 446274 / 211 | 20.90 | 0 |
| beijing-cbd-fixed-16 | 8.40 | 7.150 | 599956 / 739 | 18.04 | 0 |
| beijing-cbd-grow-1 | 8.40 | 6.140 | 592943 / 350 | 13.08 | 1104 |
| beijing-cbd-grow-4 | 8.40 | 7.162 | 590781 / 281 | 12.80 | 0 |
| beijing-cbd-grow-9 | 8.40 | 5.775 | 596414 / 465 | 18.21 | 0 |
| kyoto-gion-fixed-1 | 8.40 | 5.436 | 582486 / 51 | 15.93 | 0 |
| kyoto-gion-fixed-4 | 8.40 | 5.836 | 586574 / 195 | 15.45 | 0 |
| kyoto-gion-fixed-16 | 8.40 | 5.569 | 599603 / 695 | 50.39 | 0 |
| kyoto-gion-grow-1 | 8.40 | 6.135 | 307358 / 84 | 11.83 | 0 |
| kyoto-gion-grow-4 | 8.40 | 5.567 | 446094 / 220 | 33.65 | 0 |
| kyoto-gion-grow-9 | 8.40 | 4.918 | 597868 / 399 | 44.85 | 0 |

## 两个原失败固定镜头

| 原机位 | 实际观察秒 | 物理帧 / 完成GPU样本 | 观察期swap / cancel / CINK请求 | 同URL最大请求 |
| --- | --- | --- | --- | --- |
| t13 | 15.004800 | 1801 / 1800 | 0 / 0 / 0 | 0 |
| t19 | 15.008700 | 1801 / 1800 | 0 / 0 / 0 | 0 |

原固定camera/FOV精确一致、全观察期无缺块。每相位另1个pending query已计入窗口；累计3602物理帧/3600完成GPU样本。最终新资产下两个机位均在 **auto模式稳定medium**，不能沿用旧D资产报告的“固定机位保持high”。这不是强制far：同一正式60秒北京grow1路径实际使用high/medium，并恢复运行时近景附件。原每秒反复请求/取消及high↔low风暴没有重现。

## 覆盖、LOD与60轮资源

fixed1/4/16的area、origin、sourceHash、worldHash、feature数一致；grow1/4/9保持相同origin和物理格宽，实际feature数递增。两地12案全部保留，没有以分文件冒充扩区，也没有删指定密集样本。

12案far/full均验证真实几何数组、实际整帧triangles/draws下降，farAfter回到原far数组基线。每案5次离开/返回，共 **60轮**：离开时城市、standby与近景数组/材质/纹理/实例/profile等归零；返回时CPU资源、renderer几何/纹理/program计数精确稳定，pending=0、settled且估计驻留在预算内。生命周期query所有权也闭合。这里不把renderer常驻屏幕资源称为零显存。

| AC | 结果 | 依据与边界 |
| --- | --- | --- |
| AC16 | pass | 两档以上真实几何、far/full实际提交与数组下降，路径high/near恢复；几何覆盖/接缝由独立geometry角色另行审查。 |
| AC17 | pass | 原t13/t19各15秒无swap/cancel/重复URL/缺块，正式相机路径真实运行；没有以强制全low代替自动策略。 |
| AC18 | pass | 本12案默认预算逐物理帧含initialFrame全部满足；共同near计数一致，先前420/400/0的定制预算缺陷另有已复验记录。 |
| AC19 | pass | 60轮资源回归基线，无持续线性增长，返回预算内。 |
| AC20 | pass | 固定/扩区两组及京都样本、真实浏览器/GPU全窗口、每案≥60秒、p95目标均满足。 |

原失败raw、before结果与历史reviews保持原样。旧`assessment-injection.mjs`仍是29a2e36协议的历史探针；当前完整窗口正/负检查使用root auditor及17项独立自测，不能混用版本来改写历史。
