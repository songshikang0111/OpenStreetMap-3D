# Remediation harness 独立审查

日期：2026-11-03；实际审查 HEAD `758782644c4dfc400cedd370eb64edb95bce2734`，harness提交 `c7a4542`，基线 `dee3cc8`。只在指定集成worktree只读产品代码；测试脚本／结果仅写ignored `work/remediation-review-architecture/`。没有启动浏览器或GPU，没有修改产品／暂存／提交。

**当前结论：fail，存在一项已复现P2验收漏判；其余已确认的边界如下。**

## P2：固定机位证据完整性／身份未验证

`scripts/benchmark-integration/assessment.mjs:10–15,24` 仅用 durationSeconds>=15、frames非空判断机位时长；整案只要求两条stationary记录，未要求targetTime为13和19。

独立纯数据完整性反例（不是新硬件测量）：从旧真实北京grow-1 raw保留两个原始帧（跨度8.2ms），取实际runtime稳定快照，声明duration=15，stationary所有checks均true。复制为targetTime=[13,13]两条后，assessCase对旧北京grow-1返回status=pass、无失败check；没有15秒完整渲染证据，也没有t19。结果保存在 `probe-results.json`，脚本 `probe-assessment.mjs`。

这会让录制被截断、渲染中途停止但RAF测量回调仍运行，或漏掉指定机位时获得伪通过。应核对完整frameCount/window、原始时间跨度、有限且连续的帧／elapsed样本、measurementEpoch与endedEpoch、暂停／RENDER_FAILED状态，并要求机位集合恰为{13,19}；可将view与已归档的旧参考进行核对。

## 已确认有效

- page.js直接import生产 `dist-sdk/city-ink.js`，调用createCityViewer、真实setView/getStats；没有手写sceneCosts／passMultiplier反馈替代SDK。t13/t19从旧失败raw.path.keys插值，并保存参考raw哈希和来源。
- 路径测量使用performance.now实际elapsed，保存raw:true全帧；case gate要求>=60秒、frameCount=frames+1、raw跨度>=59.9秒。固定窗口上限18000若真的裁窗会导致完整性gate失败，不能以裁后的窗口通过。新硬件raw仍待最终整合实际运行。
- 默认600k triangles／1200draws／128MiB／并发3和1280×720/DPR1/balanced有显式gate；drawing最大值直接从全部raw frames重算，旧京都grow-1的p95通过不能掩盖max2626。
- 旧真实北京grow-4被三角预算gate拒绝，旧京都grow-1被draw最大值gate拒绝。旧北京grow-1真实路径记录31 swaps／149取消／单URL160请求，纯gate单测全部拒绝。该单测不是固定镜头浏览器证据。
- 默认输出为新 `docs/phase1-evidence/remediation/integration/performance`，默认scenes为新work/remediation-integration-scenes；--output=与--scenes=均有实际参数解析。只运行unknown-case提前错误分支验证--output路径，未触发浏览器。
- 将旧12份raw与summary复制到本审查ignored目录后，实际运行summarize --input；退出1、12/12全部fail、timingStatus单独pass，未把帧率通过改成整体通过。原文件与临时复制的raw哈希全部不变。
- 对原失败目录执行git diff --exit-code dee3cc8，无差异，未改历史。

## 请求窗口及冻结边界

browser-session.js的observedAt来自本机Date.now，记录的是Node收到Fetch.requestPaused事件的时间；page的measurementEpoch来自同机performance.timeOrigin+performance.now。正常同机比较可用，但它不是CDP请求发起时间，边界处有事件传递／毫秒取整误差。run保存phaseRequests及其窗口过滤后的measuredRequests，最终raw复核应重算过滤和确认时间字段完整；assessor目前直接信任measuredRequests。

stationary在whenIdle与2秒预热之后清统计；它验证的是预热后15秒稳定性，预热请求被保留但不参与noRepeatedRequests gate。不能据此声称从setView起完全没有瞬时请求／取消。主60秒路径中移动相机的swap/cancel不能直接套固定机位阈值。

runner保存HEAD、bundleSHA及各build-report，但不自动拒绝dirty tree／异代compilerCommit；最终整合必须冻结产品、重新编译同一代场景、归档新12案并独立核对，而不是把本轮harness静态检查当最终性能通过。

## 实际命令

```powershell
node --test test/phase1-remediation-assessment.test.js
node work/remediation-review-architecture/probe-assessment.mjs
node scripts/phase1-summarize.mjs --input=work/remediation-review-architecture/historical-as-new-evidence
git diff --exit-code dee3cc8 -- docs/phase1-evidence/integration/performance docs/phase1-evidence/root-acceptance
```

作者测试3/3 pass；summarizer旧失败raw退出1符合预期。复现JSON、CLI结果及review.json均在同目录。
