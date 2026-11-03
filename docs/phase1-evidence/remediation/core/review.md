# 核心修复独立只读审查

2026-11-03。独立 subagent `core_repair_review`，`gpt-6.1-sol / xhigh`，独立上下文。审查者未修改任何文件、未运行 GPU 或重复重型12案构建。最终算法复验提交：`e03aaa85683bddb09f816be091a5afa18c60f51c`。

## 修复前发现与闭环

- footprint 简化可能将庭院推出外环、形成自交或共线零面积。联合拓扑、面积与绕向检查失败回退原环，最小反例成为永久测试。
- 材质角色排序可能错配外部多材质颜色。外部 recipe 与任意材质数组跳过合批，保留原 groups、次序及颜色。
- 桥底 XZ 共线但有高程转折的点可能被三角化删除；cap/side 独立简化曾产生开口。改为共同 top/bottom 约束、共同 ring 的桥壳，各LOD一致；保留 clamp 和原高度分段。
- 仅元数据自洽的 caster 零值可能逃过验证。解码按实际 geometry/groups/instances/castShadow 核验 aggregate 与每个已提供 unit；旧资源及合法部分字段兼容。
- 原子快速路径曾缩小单mesh的多成员 claim。`a66fe8b`保留全部成员，新增4成员认领回归。
- 近高度同向叠桥外侧面曾被无向去重删除。`e03aaa8`只删除反向共同内边，同向外边保留完整竖向包络，分离桥板仍保留各自侧皮。

## 最终审查结果

结论：当前核心算法与CPU几何正确性范围通过，无新增可复现阻断。

- 冻结后 repair/partition **23/23**；独立类型检查通过。实现者另跑完整 **287/287** 与全部生产构建，见handoff。
- 独立4成员单mesh claim：每个源身份的 owner/chunkIds 恢复；任意材质数组、groups、drawRange、normalized自定义属性和原子world bounds保留。
- 同向叠桥dy=3.8 mm保留8个外侧tri；分离dy=2 cm保留16个；相邻反向共同内边为0个。细扶手上缘、共同桥边及共线退化回归通过。
- 独立600个平面源样本：最大高度误差 **1.982995 mm**。
- 独立442个经过反射、旋转、非均匀缩放的混合cell覆盖样本：无洞/重叠，边界最大误差 **2.95e-7 m**。
- 旧 near/caster 合约复验：near计数与runtime同义，standby bytes保留；虚假caster被拒绝；部分字段与旧资源仍兼容。

## grow-4 身份审计

审查者另直接读取冻结的北京grow-4源配置和CINK，未重建：`w548126517`、`w547523487`的原普通envelope均为roof=0、bottom=0、wallSpans=0；其footprint超出`r7820447-0`的polygon difference面积均为0。外体[min0,height245]完整包含两个部件[0,234]、[161,234]。源身份、sourceIds、标签、高度、renderId和owner仍保留；外体在真实low/medium/high分别为 **27/1260/1620 triangles**。

该范围只解析到两项CCTV源部件，已有`LANDMARK_MISSING_PARTS`诊断并退化普通源几何。这是源棱柱模型中完全内部面的逐项证明，不是删除暴露对象，也不代表测绘级CCTV造型验证。审计脚本只允许原始envelope无暴露面、没有原geometry bounds、没有外部recipe且仍有实际外体的个案；不会泛化跳过缺失身份。京都grow-9另两项同类证明逐项保存在cost-summary。

最终AC18/19/20/27的统一集成提交、真实WebGL整帧60秒与五轮往返仍由E/主对话执行；此审查不替代GPU验收。
