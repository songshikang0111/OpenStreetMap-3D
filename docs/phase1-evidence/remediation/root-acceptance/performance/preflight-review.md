# 主对话修复前置复核：D 调度与 E 性能断言

日期：2026-11-03 21:15 +08:00。起始集成 HEAD `0e9d282863afbb5c6f1aa4ab01014a84566c1366`，结束 HEAD `3d4daf248224ce5675436f0b09d85512ac7aefa0`；期间 D/SDK/benchmark 源码没有变化（`git diff --stat 0e9d282 HEAD -- src/runtime src/sdk scripts/benchmark-integration` 为空）。D 产品冻结为 `492744bf083d816143ad54f66035cfb76b11a5fa`。A 的庭院、桥坡、多材质与 caster 校验尚未最终冻结，不宣布最终 AC16–AC20 通过。

范围：只读源码、已有 D 浏览器证据及轻量 Node CPU 复现。未改产品，未执行全量 test/build，未启动 GPU/浏览器。以下所有本角色输出仅在本目录，不提交，由主对话归档。

## 已确认修复

- 旧 `max(drawRatio,triangleRatio)` 统一倍率已从 SDK 主循环移除。`render-cost.js` 按观察到的 pass 拓扑、主视锥和阴影视锥分别累加 triangles/calls；透明双面额外 color draw、material groups、instance count、layers 和 frustumCulled 均有独立处理。显式 shadow cost=0 经 `??` 保留，不退回全量。
- SDK `index.js:150–158` 先确定同帧主体成本，再给附件剩余 triangles/calls/bytes；附件不再反向驱动下一帧主体几何。真实 renderer.info 和 GPU query 仍独立覆盖完整管线，预测成本不替代实测。
- `streamer.js:29–30` 逐候选计入 coarse standby，数字 resident cache 避免反复低估；standby 计入 registry/estimatedBytes，突变时恢复已驻留粗层，dispose/evict 能释放。`policy.js:79–90` 的升级 dead band 仍受硬预算约束。
- `style-quality.js:3–4` 只控制 AO pass 启用，没有覆盖经验证的 aoStrength。定向测试保留0/.12/.9，low 禁用后仍保留参数。

独立定向验证：`node --test test/phase1-runtime-render-cost.test.js test/phase1-runtime-style-quality.test.js test/phase1-remediation-assessment.test.js`，**12/12 pass**，耗时约5.1秒。

独立旧真实 CINK 静止复现：`node work/root-remediation-performance/stationary.mjs`，见 `stationary.json`。没有重新生成简化数据来掩盖原问题；输入仍是原北京 grow1 CINK（compilerCommit `2ee762984ec643f8d3da74c39867cce631ff0bae`），两个原始固定机位各运行15,000ms合成时间。

| 原机位 | loads / swaps / cancelled | 同URL请求上限 | 主体+附件预测整帧 triangles / calls max | 估算驻留 | standby |
| --- | --- | --- | --- | --- | --- |
| t13 | 2 / 1 / 0 | 1 | 590354 / 247 | 13439492B | 1 |
| t19 | 2 / 1 / 0 | 1 | 592678 / 295 | 13436420B | 1 |

两案都保持 high，没有全部强制low；dispose后 registry refs与估算驻留均归零。该结果是 CPU 调度/成本复现，不是新的 GPU 性能测量。

另外从 D 的 `browser-after.json` 独立重算，执行 `audit-runtime-evidence.mjs`，结果在 `runtime-evidence-audit.json`：t13/t19真实保持15.5098/15.509秒，max triangles/calls 与上表完全一致；初次几何出现后无缺块，0预算超帧、0cancel、1次正常low→high、每URL一次、dispose零驻留/零未释放query。原始加载期有2个尚未挂首块的采样，单独标为initialLoadingSamples，未假称冷加载瞬间已完整覆盖。AO保存值与请求值一致。这里只核算D已有真实raw，没有本角色重新启动硬件。

## 新发现 P2：近景数量预算未合并持久化 detail 与运行时附件

最小复现：`node work/root-remediation-performance/near-global-budget.mjs`；结果 `near-global-budget.json`。使用原真实北京grow1、t13、生产budgetPlan/decoder/style/NearDetails：

```
budget.nearDetails = 420
selected LOD = high
persisted lodRole=detail/near instances = 410
runtime near attachments = 195
total = 605 > 420
```

证据链：

- `src/runtime/resources.js:62` 将持久化 `lodRole='detail'|'near'` 纳入 nearDetails；运行时 `streamer.stats()` 也报告这些410个实例。
- `src/runtime/policy.js:66` 想按 `lod.nearDetails` 为主体准入计费，但当前真实 manifest 及 `core/scene-codec.js` 的 sceneStats 没输出该字段，因而是0。
- 即使补了持久化计数，`src/sdk/index.js:156` 仍只向 NearDetails 分配 triangles/bytes/calls余量，未扣主体的 nearDetails；`near-details.js:41` 每次用全部 `budget.nearDetails`，两个分配器可各用一份预算。

默认18000下此小案没有超限，不应将其写成当前12案默认预算已失败。但可配置的共同数量预算确实失效，且目前API/实现没有声明持久化detail豁免。建议由D明确统一计数，主体准入使用已解码数字成本并兼容旧manifest；运行时附件只分配同帧主体计数后的余量，避免重新引入附件→主体反馈。E应按同一语义验证 `runtime.nearDetails + nearAttachments.nearDetails`，而不是只读后者。

此问题已即时回报主对话，不编辑D/A源码。

## E断言有效性与尚需补充的预算检查

新的 `assessment.mjs` 确实会拒绝原失败：从原raw重放，北京grow4的7113个triangle超限帧与京都grow1的10个draw超限帧均使status=fail；没有只看p95。stationary同时验证原镜头、连续15秒、帧窗口完整、counter delta、重复URL、每帧draw/triangle硬上限与覆盖；现有测试证明原t13/t19反复swap/cancel/request被拒绝。不会因最终settled而误通过。

但起始版本 `assessStationary:32` 没有任何实际 resident 或 near数量断言；`assessCase:42` 只检查五轮返回驻留，没有检查path/stationary实际驻留。`assessment-injection.mjs/json` 保存了明确标为**构造的完整性测试**：将原本全部通过的15秒phase改成全窗口 resident=128MiB+1，或者附件nearDetails=18001且主体nearDetails=100，所有checks仍true。它不是实际产品超限测量，而是断言覆盖的最小证明。主对话已要求E补充。

建议边界：

- 不凭新要求禁止所有有说明的原子替换驻留峰值。计划允许可说明的超预算降级，AC19要求往返后回预算。不能仅凭有一条TRANSITION_HEADROOM就无限放行。
- 对预热后15秒固定镜头，应要求样本驻留和数量回到预算；对移动路径保留逐帧峰值、超限帧数、最长连续时长、settled状态及对应诊断，区分短暂替换与持续不收敛。若正式12案实际每帧≤128MiB，可直接报告这个更强事实。
- 近景预算按统一主体+附件计数；初始未知manifest可以保守估计，解码后必须计入真实数字，不能永久用optional缺省0。数量断言应有缺失/非有限数据防御。
- 不将强制full对照的峰值混进自动路径的预算结论；同时保留其原始峰值和明确override标签。

## 等最终冻结后复核

A已知 caster-unit缺省aggregate漏校验由主对话另行报告并跟进，未当作新发现重复计入。最终还需核对：caster metadata逐单位及总量与真实解码资产一致；庭院/桥坡/多材质修改没有删除覆盖或改变身份；同一冻结提交/SDK hash下12案完整raw、两个固定15秒机位、5轮往返、全帧预算与新驻留/数量断言独立重算。当前结论只是修复前置审查。
