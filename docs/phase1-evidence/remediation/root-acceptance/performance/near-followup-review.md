# near 与验收断言修复的独立复验

日期：2026-11-03。集成提交 `29a2e360d1ac7f8613957a0675c677e57b2f1f70`。包含 D near 修复 `480d78d`（源 `ff3c33b`）、A near metadata `9d74256`、E 验收断言 `521db91`。只读产品、轻量 Node CPU 验证；未启动浏览器/GPU，未运行全量test/build。原 `near-global-budget.json` 和 `assessment-injection.json` 失败证据保持不变，新结果另存带after名称。

结论：本角色原先报告的 near 共用数量预算缺陷，以及 E 驻留/数量断言缺口，均已按原最小复现复验关闭。另一个已知多块 fallback componentwise 问题由D继续修复，不冒充本次新发现，也不提前宣布全部预算通过。

## 原 410+195>420 复现

命令：`node work/root-remediation-performance/near-global-budget.mjs`。

结果：`near-global-budget-after.json`。同一旧北京 grow1 CINK、同一t13相机，nearDetails=420，仍选high，主体410、运行时附件10、总数**420**。保留high真实几何与剩余10个附件，既不重复扣余额，也不通过隐藏主体来通过。

源码核查：

- `NearDetails.update` 先统计所有可见主体中实际的detail/near几何单位，再把 `budget.nearDetails-bodyDetails` 与调用者给出的余额取min。旧签名调用者也受到共同上限保护。
- SDK以同帧 `streamer.frameCost().nearDetails` 给附件剩余数量；主体选择仍先完成，附件不会再次反馈到主体选择。
- Streamer在解码/准备后、挂载前记录 `detailCache`，后续优先于可选manifest字段；hidden standby重测不会把intrinsic计数错误抹为0。挂载后的硬预算防御也包含near数量。
- A `sceneStats` 输出nearDetails，按普通detail/near mesh=1、实例mesh=count计数，不按材质groups/drawCalls或视锥误减。decoder核对显式descriptor计数与实际几何，缺省旧metadata继续兼容。

## 低于主体数量、legacy缺字段和稳定性

命令：

```
node work/root-remediation-performance/stationary.mjs 420
node work/root-remediation-performance/stationary.mjs 400
node work/root-remediation-performance/stationary.mjs 0
```

脚本使用生产Streamer、NearDetails、decoder、漫画绑定和整帧预测；输入为原真实CINK，manifest仍缺nearDetails。每案固定t13机位，运行5000ms合成时间。不是新的硬件性能证据。

| near budget | 最终层级 | 主体+附件 | 全过程最大near总数 | high请求 | cancel | loads / swaps |
| --- | --- | --- | --- | --- | --- | --- |
| 420 | high | 410+10 | 420 | 1 | 0 | 2 / 1 |
| 400 | medium | 0+0 | 0 | 1 | 1 | 2 / 1 |
| 0 | medium | 0+0 | 0 | 1 | 1 | 2 / 1 |

结果在 `near-streamer-420.json`、`near-streamer-400.json`、`near-streamer-0.json`。400/0首次探测高层后，已解码计数纠正legacy未知值并稳定medium，没有持续请求同一high；每资源URL都仅请求一次。每个CPU更新后可见主体+附件均在数量预算内；有计费standby，预测triangles/calls在默认上限内；dispose registry refs和估计字节归零。一次初始取消是未知成本被纠正后的有界行为，不能与原每秒60次取消风暴混为一谈。

定向测试：`node --test test/phase1-runtime-near-budget.test.js test/phase1-remediation-assessment.test.js`，**9/9 pass**。其中覆盖缺字段/低报metadata纠正、hidden standby、同帧余额、只够23个节点时不生成半个24节点树冠/枝干组、caster无关原失败统计、near资源离场归零。

显式错误metadata在标准core decoder中按协议一致性报错；D对可返回几何的legacy/custom decoder仍用实际数字纠正。两者不能混写成忽略损坏协议。

## E注入测试确实关闭原缺口

命令：`node work/root-remediation-performance/assessment-injection.mjs`；结果 `assessment-injection-after.json`。

首先补全新逐帧资源字段，保证未注入的构造正样本所有checks为true。随后保持窗口、相机、请求与资源字段一致性合法：

- 全窗口resident=128MiB+1：`resourceEvidence=true`、`resident=false`，整项拒绝。
- 主体near100+附件near18001：`resourceEvidence=true`、`nearDetails=false`，整项拒绝。
- 原北京grow4的7113个triangle溢出帧、京都grow1的10个draw溢出帧，仍分别被实际max断言拒绝。

这些是明确标为构造的断言完整性测试，不冒充真实产品/GPU测量；拒绝由对应资源超限触发，而不是由于缺少新增字段。

新的正式参考矩阵采用更强的每帧resident/near上限，保留超限帧数/累计时长与峰值。它用于当前12案严格目标；不把它扩写为协议禁止所有有诊断、可说明、能收敛的原子替换短峰。往返回预算、主体+附件计数一致及near缓存清空另有断言。

最终仍待D已知fallback补丁、A最终几何freeze及E同一冻结提交下的12案完整raw；届时独立重算包括near逐帧字段、resident峰值/持续区间、caster metadata与解码成本的一致性。
