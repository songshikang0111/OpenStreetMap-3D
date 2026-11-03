# 独立只读审查

审查者：独立subagent，gpt-6.1-sol / xhigh；没有编辑工作区，没有运行GPU/浏览器压测。

首次审查 c58af6a 发现：

1. 窄驻留预算只容纳高层而容不下高层+备用粗层时，首次准入忽略未来备用，升级后全局reserve迫使降级，降级又移除reserve，从而反复下载高层。其复现2000B预算、高层1500B、低层1000B，20tick内高层URL7次、swaps12。129f1d4改为逐候选提前计入备用，已解码字节数字缓存防止低估后重试；测试覆盖预算窄区间及元数据低估。
2. 只按URL缓存世界空间界，会使两个不同transform的chunk串扰。129f1d4改为chunkID+URL，测试共享URL不同变换。

在129f1d4复查无新增已确认缺陷，建议补延迟解码/相机变动/standby组合。492744b补足此项，测试取消、stale资源释放、并发槽、恢复备用覆盖；另审查shadow字段显式0与预算hysteresis硬上限。

最终独立结论：

> Independent delta review of 492744bf083d816143ad54f66035cfb76b11a5fa: no actionable findings. Shadow metadata preserves explicit zero values; hysteresis cannot restore a state that exceeds hard caps. The delayed-decode regression covers cancellation, stale-resource disposal, standby recovery, and concurrency. Read-only validation: 24/24 targeted tests passed, git diff --check passed. No edits or GPU tests.

本结论是源代码/定向CPU审查，真实浏览器证据由D另行复跑；最终12案与总体验收由E和主对话执行。
