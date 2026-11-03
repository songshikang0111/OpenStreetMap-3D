# Remediation harness 最终独立复验

日期：2026-11-03。实际复验HEAD `0e9d282863afbb5c6f1aa4ab01014a84566c1366`，harness核心修复提交 `57625b593da8414161ef6bb780eb8774c17006e4`；当前HEAD仍为 `0e9d282863afbb5c6f1aa4ab01014a84566c1366`。仅指定worktree内只读产品代码，新增文件仅在ignored `work/remediation-review-architecture/`。未改产品、暂存或commit，未启动浏览器/GPU。

**结论：pass（本轮harness闭环）。本角色提出的六项重要验收漏判均已关闭；未再发现本范围内未关闭P1/P2。该结论不表示A/D修复或新的12案GPU矩阵已经验收通过。**

## 关闭证据

- complete stationary raw window and t13/t19 unique identities (2659144)
- default baseline/end phase budgets and hard limits (6cd495d)
- actual baseline/sample/end viewer.getView capture (57625b5)
- raw-frame p95 recomputation and CLI summary reuse (57625b5)
- complete request-window derivation and filtered-evidence consistency (57625b5)
- actual epoch and final elapsed sample each >=15s (57625b5)

原两帧8.2ms／重复t13反例已拒绝；抬高phase预算也已拒绝。最终新版格式的合法13/19正对照可得到整案pass。15个定向反例覆盖actual camera基线/中段/结束漂移、readback缺失、重复请求被隐藏、缺request时钟、真实14.91秒、末样本不足15秒、两帧窗口、baseline/end抬预算、paused/RENDER_FAILED、采样孔洞，均拒绝。

完整60秒1500帧、每帧40ms而旧aggregate报告8.4ms的原反例：completeSamples仍true，但重算p95=40、p95 gate=false、整案fail。实际summarize CLI对临时拷贝也输出raf.p95=40和timingStatus=fail，退出1，证明不只修改了单测中的判断。

phaseRequests窗口内重复URL两次而measuredRequests空时，requestEvidence/noRepeatedRequests均拒绝；合法窗口内不同URL一次及窗口外预热请求仍通过。实际相机现在由page在baseline、每10Hz sample及结束调用viewer.getView读回，不再仅保存入参。t13/t19常量与保留旧raw的插值结果已按JSON数值逐字精确核对。

## 实际命令与结果

```powershell
node work/remediation-review-architecture/final-harness-retest.mjs
node --test test/phase1-remediation-assessment.test.js
node scripts/phase1-summarize.mjs --input=work/remediation-review-architecture/historical-as-new-evidence
git diff --exit-code dee3cc8 -- docs/phase1-evidence/integration/performance docs/phase1-evidence/root-acceptance
```

- 作者回归4/4 pass；最终15个定向拒绝探针及合法正对照通过。
- 原12份真实旧raw复制件重算：12/12 fail、timing pass、CLI exit1；预算/request-storm失败没有被旧帧率成功掩盖。另注入40ms完整raw的拷贝重算为timing fail，CLI exit1。
- 历史raw所有SHA不变，历史目录相对dee3cc8 diff为空；没有写入旧失败证据。
- 默认输出仍为新remediation证据目录，支持--output/--scenes与summarize --input；脚本已保存真实SDK、bundle/HEAD/旧参考SHA以及build/compiler信息。当前runner追加了跟踪文件dirty、运行间HEAD/bundle变更及scene compiler commit一致性检查；最终完整运行前仍须冻结集成提交。

最终脚本 `final-harness-retest.mjs`、结果 `final-harness-results.json` 保存实际HEAD、源码SHA和每条拒绝check。旧初审／中间失败报告继续保留为修前历史，不能误读为最新状态。

## 未验证范围

本次未启动GPU，不声称已产生新的≥60秒12案或两个真实≥15秒固定机位结果；这些必须在最终A–D整合、构建与冻结后实际执行并独立检查raw。Node观察时间是本机CDP通知接收时间，phaseRequests保留的预热与边界数据仍需在最后raw审计时核对。本次针对的是measurement/gate可靠性；A/D运行时及几何修复本体另待最终整合审查。
