# D 独立审查与复验

日期：2026-11-03。审查者：独立 `gpt-6.1-sol` / `xhigh` subagent `/root/runtime_review`，`fork_turns=none`。它读取规划与实际实现，只读源码，测试产物写入本 worktree 的 `work/`；没有提交或替作者修改代码。

首次审查提交：`41c1d8c`、`f55c12e`，并检查增量 `2776a4f`。首次针对性 Node 24/24、独立生产嵌入检查通过，但审查者另外构造了并发与共享资源复现，发现以下缺陷，不能由顺序测试通过来掩盖。

| 缺陷 | 审查者复现 | 修复 |
| --- | --- | --- |
| P1 PNG 与异步换风格并发永久暂停 | 两操作 fulfilled，最终 paused=true 且帧停止 | 场景变更串行队列；内部暂停引用计数独立于用户暂停 |
| P1 旧慢验证 load 清空新场景 | fast 已 4 块，slow AbortError 后仍清空 | 验证后、安装队列内和销毁前检查 epoch / signal；拒绝 validator.valid=false |
| P1 complete GLB 释放共享风格纹理 | live bitmap 16px→0px，后续 WebGL 报错 | registry 间共享 WeakMap 引用计数；图片 CPU 生命周期归 decoder / StylePack.dispose |
| P2 近景无驻留预算产生静止镜头抖动 | 230000 字节预算，5秒 68 loads / 67 swaps，峰值331296 | 附件先按剩余 bytes / calls / triangles / count 分配；不足固定 buffer 成本时不分配 |
| P2 默认 SDK 接受 styleContractVersion=999 | A validator 明确拒绝，SDK仍加载 | 将纯 manifest validator 分离为浏览器模块并接入默认 SDK |

修复提交：`d8cbb9e539180eb30ac069a8af6995eaa6ec5d80`。

审查者独立复验：

- `node --test test/phase1-runtime*.test.js test/phase1-core.test.js`：26/26。
- `node scripts/benchmark-runtime/check-races.mjs work/review-regression-final`：五项原始问题均关闭。并发 PNG/风格后 paused=false，继续增加38帧；旧慢 load 返回 AbortError，新场景仍4块；共享 bitmap 导出/重载仍16px，最终 StylePack.dispose 后0px；230000字节稳定200704、2 loads / 1 swap；不兼容协议在 manifest 阶段拒绝。
- 重新 `build-embed.mjs` 后运行 `check-browser.mjs work/review-embed-final`：非根路径、阻断外网、跨LOD身份、四官方/外部风格、署名PNG、完整GLB、五次往返/重载、重复dispose均通过。
- 额外验证用户 pause 保持、失败操作后队列恢复、验证中取消保留原场景、进行中 style + queued PNG + 重复 dispose 返回相同 Promise 且无残留 canvas，全部通过。

原子替换临时峰值258344 > 230000，有 `TRANSITION_HEADROOM` 诊断；稳态符合预算。最低覆盖本身超预算也会明确诊断；不以删除必要覆盖伪装达标。

原始发现与复验证据已复制到 [review/](./review/)，作者永久回归脚本为 `scripts/benchmark-runtime/check-races.mjs`。审查者原话结论：“五项修复均已独立复验通过，本轮未发现新的需修复缺陷。”

审查者另外独立运行北京真实 CINK 5秒短测，p95 8.4ms，实际 full/far 三角形591244/156608，并发与五次生命周期通过；短测没有充当60秒验收。

后续错误恢复复核发现同一JS任务 `setView→whenIdle` 仍会读取旧调度。`42be74b` / `21ac78e` 增加当前目标故障筛选与调度revision；独立复验确认健康3块、full/far切换均正确等待，空天空约30.5ms正常idle，旧故障保持明确报错，无pageerror，27/27测试。原始证据在 `review/idle-revision-retest.json`。

`6466c0c` 补充导出NaN/Infinity限制，审查者只读检查并独立运行28/28测试，通过。有效参数/逐帧渲染未改变。

## 最终真实京都60秒独立复现

审查者针对 `024e12a` 冻结生产bundle，运行：

```powershell
node scripts/benchmark-runtime/run.mjs --seconds=60 --url=http://127.0.0.1:5187 --fixtures=core-kyoto-gion-grow-9 --output=work/review-final-performance --browser=C:/Users/宋世康/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe
```

它读取原始逐帧JSON自行复算，并核对服务端manifest与快照哈希：真实OSM 7014元素、3912建筑、9块，7118帧、60.0275秒。p50/p95/p99=8.3/8.4/8.5ms，6帧>50ms，最大108.4ms。并发峰3，自动路径驻留峰81,798,084 < 96MiB，五次离开几何归零、返回均157几何/81,798,084字节，无线性增长。

full→far：实际triangles 5,260,202→2,476,636；calls 20,623→702；CPU geometry arrays 176,772,060→81,798,084。首挂载49.4ms、首个整帧渲染842.3ms、完整目标加载1267.3ms，口径已分开。无页面错误，唯一失败请求是过期medium请求的正常Abort，与cancelled计数一致。

**独立审查明确指出未满足项：最低LOD全帧2,476,636 triangles仍超过配置900000，已发COVERAGE_EXCEEDS_BUDGET/MEASURED_DRAW_BUDGET。性能目标通过，不可声称该配置全部预算通过。** 原始结果与独立复算已归档在 `review/final-performance/`，并未用更短路径或删除压力样本掩盖边界。
