# 首物理帧与 GPU 完整窗口独立复核

日期：2026-11-03。审查SDK `743d3e5`、验收 `a273e6a`；交付时HEAD已到E容量补强提交 `112ae159ad6d5b867d7f3dbe9a48ded2e3c5d23b`。本角色只修改获授权的root自有ignored审计脚本及本目录验证材料，没有编辑产品或提交，没有启动浏览器/GPU，没有运行全量测试/build。最终12案仍未开始，本轮没有执行最终GPU结果验收。

## 源码结论

FrameStatistics现在独立保存首个完整render后的physical frame。其intervalMs=null，复制到raw.initialFrame，reset会清空，调用者修改snapshot不会回写内部对象。FPS分布仍只使用有合法帧间隔的后续帧，避免把null当0；首帧draw/triangles/bytes/near则纳入物理帧预算。

E的新断言已将initialFrame接入帧完整性、绘制、驻留和共同near数量检查，并对GPU raw计数、时间身份及分位数重算。源码/CPU定向验证未发现新增可操作产品问题。GPU容量后续补强由E负责，本角色独立脚本直接锁定实际SDK容量8，不信任raw任意扩大maxPending。

## root审计脚本具体修改

已更新 `work/root-remediation-acceptance/audit-results.mjs`，原版备份 `audit-results-before-initial-frame.mjs`。独立实现没有导入E assessment或runtime distribution。

1. 增加可单独自测的 `auditPhysicalWindow`：要求raw.initialFrame、null首间隔、frameCount=intervalFrames+1、首帧到第二帧的时间连续，覆盖全部物理帧的draw/triangle/估计bytes/共同near及数组字节关系。path与两个stationary阶段都使用它。
2. 保留两种统计的区别：SDK的RAF/旧draw分位字段按intervalFrames重算；预算max和physicalDrawing按initialFrame+全部intervalFrames重算。输出保留首帧和物理/间隔数量，不以推测首帧补造原始证据。
3. 增加独立 `auditGpuWindow`：硬件能力显式为布尔；raw samples非负、唯一且时间递增，必须对应本物理帧窗口；samples+pending+active=frameCount；独立重算p50/p95/p99/max。
4. 固定实际SDK pending容量**8**，拒绝raw的maxPending=99之类声明；核对created-deleted=unreleased=pending+active，未释放数≤8+active，active必须布尔，错误/无效结果为0。无GPU时要求真实不可用原因、空samples和null分位，不能杜撰CPU替代值。
5. 增加 `auditBuildIdentity`：每案build.compilerCommit等于summary.environment.commit；summary完整且12个名称唯一，每条summary的RAF和SDK绘制分位与原始数据一致。继续核对当前SDK SHA与测量冻结SHA、输入来源SHA。
6. 审计可被自测import而不触发结果目录读取；允许第三个CLI参数指定独立输出，旧阴性对照不会覆盖正式结果报告。

脚本SHA、备份SHA与验证记录见 `auditor-initial-gpu-update.json`。最终运行方式仍为：

```
node work/root-remediation-acceptance/audit-results.mjs docs/phase1-evidence/remediation/integration/performance
```

## 轻量验证

- `node --check work/root-remediation-acceptance/audit-results.mjs`：pass。
- `node work/root-remediation-performance/initial-gpu-audit-selftest.mjs`：**17/17 pass**，结果 `initial-gpu-audit-selftest.json`。含合法物理/GPU完整窗口正样本，以及仅首帧tri/draw/bytes/near溢出、缺首帧、断首间隔、GPU截断/重复/窗外时间/伪分位/所有权错误/扩大capacity/active类型错误、build提交不一致等阴性注入。均明确是构造完整性测试，不冒充硬件测量。
- `node --test --test-name-pattern="raw statistics retain|GPU raw samples" test/phase1-runtime.test.js test/phase1-remediation-assessment.test.js`：**2/2 pass**。
- root `frame-types.ts` 加入optional initialFrame的严格消费，TypeScript noEmit/strict/NodeNext无cast、无skipLibCheck：pass。
- 对原12案历史raw执行新版独立审计，按预期exit1/status=fail；输出另存 `baseline-initial-gpu-audit.json`，12案均保留。历史报告没有新增initialFrame/near字段、也没有最终固定镜头阶段，且10案三角与个别draw确有原超限；这些是负面对照，不倒推声称历史GPU样本造假或过去已量到的8.4ms无效。

旧raw和已有baseline报告均未改。新版协议下缺失首物理帧不能以“从第二帧推断”冒充完整预算证据；最终测量须原样输出新字段后再独立重算。
