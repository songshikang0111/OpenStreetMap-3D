# Remediation harness 最终独立审查（a929ceb）

日期：2026-11-03。实际复验 HEAD：8df77a3f2b566f893b5fd09caacb3bc841c54ab2。最新 harness 修复：a929ceba548f20527798e91459fed6a14ddd9ac7。a929ceb 至实际 HEAD 仅有一项文档提交，相关 harness 文件无差异。

结论：本角色当前没有剩余已复现的 P1/P2，harness 代码审查闭环。该结论只覆盖已审查的采证和判定逻辑，不表示 D 的 raw 资源字段生产接线、最终真实 SDK/GPU 跑数或整体 remediation 验收通过。

本次实际执行：

    node work/remediation-review-architecture/dynamic-resource-retest-a929.mjs
    node --test test/phase1-remediation-assessment.test.js

作者测试 5/5 通过。独立构造的合法完整 case 通过。stationary 和 path 的精确 134217728 字节边界控制均通过。

原样本驻留反例现已拒绝：10Hz 样本记录 134217729 字节，而 raw/end/peak 为 1000，整案返回 fail，resident=false。另补三个定向反例：stationary 样本 1001 大于末峰值 1000；path 样本 134217729；path 样本 18118213 大于末峰值 18118212。三者均整案 fail；返回的 sampleResident.max 准确保留超值，未被 p95 隐藏。sampleResident 从所有样本重算，要求同时不超过固定 128MiB 和最终 runtime peak。raw 每帧、末值和峰值的原检查仍保留。

521db91 已关闭的 11 个探针此次均继续拒绝：离开后 frames/crownClusters/branches/profiles 任一未归零；raw 近景字节超过总驻留；负近景组件与正组件相抵消；末峰值小于 raw 最大值；末驻留大于末峰值；样本近景总数不一致；样本近景字节大于样本驻留；缺失 sample.render。

此前六项重要漏判已在 2659144/6cd495d/57625b5 闭环，详见 final-harness-review.md 和 final-harness-results.json：完整连续 stationary raw/epoch 窗口和 t13/t19 唯一身份；固定默认预算；baseline/sample/end 实际 getView 读回；raw 帧 p95 重算及 CLI 使用重算值；完整请求窗口过滤和 measuredRequests 互证；实际 epoch 与末样本时长各至少 15 秒。旧真实 12 案复制件的最新判定仍为 12/12 fail，而非用帧率通过掩盖预算或请求风暴；该 CLI 历史复验未在本次重复，证据保留于先前结果。

相对 dee3cc8，docs/phase1-evidence/integration/performance 的 git diff 为空。本轮未编辑历史原失败文件；未改任何 tracked 文件、暂存或提交。已有 untracked docs/phase1-evidence/remediation/integration 属于父 agent 的运行，未触碰。新增脚本与结果仅在 ignored work/remediation-review-architecture。

证据：dynamic-resource-retest-a929.mjs、dynamic-resource-retest-a929-results.json。先前带 9cf/521 状态的失败报告继续保留为修前历史；本文件是当前 harness 收口结论。

未验证范围：没有启动浏览器或 GPU，没有新测 12 个至少 60 秒完整路径或两个至少 15 秒真实旧失败视图。D 的四项 raw 资源字段接线仍待最终整合确认。最终生产 bundle、真实 SDK 测量、全帧 raw 完整性、实际资源峰值和预算均需在冻结后的真实证据中独立复核。
