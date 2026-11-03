# 核心修复独立只读审查

2026-11-03。独立 subagent `core_repair_review`，`gpt-6.1-sol / xhigh`，独立上下文。审查者未修改任何文件、未运行 GPU 或重复重型12案构建。前轮算法复验提交：`e03aaa85683bddb09f816be091a5afa18c60f51c`；根随后发现边界漏裁，本次最终窄修提交`3b62b40281c116352dd8bd379cb22331d026f2df`的补审见末节。

## 修复前发现与闭环

- footprint 简化可能将庭院推出外环、形成自交或共线零面积。联合拓扑、面积与绕向检查失败回退原环，最小反例成为永久测试。
- 材质角色排序可能错配外部多材质颜色。外部 recipe 与任意材质数组跳过合批，保留原 groups、次序及颜色。
- 桥底 XZ 共线但有高程转折的点可能被三角化删除；cap/side 独立简化曾产生开口。改为共同 top/bottom 约束、共同 ring 的桥壳，各LOD一致；保留 clamp 和原高度分段。
- 仅元数据自洽的 caster 零值可能逃过验证。解码按实际 geometry/groups/instances/castShadow 核验 aggregate 与每个已提供 unit；旧资源及合法部分字段兼容。
- 原子快速路径曾缩小单mesh的多成员 claim。`a66fe8b`保留全部成员，新增4成员认领回归。
- 近高度同向叠桥外侧面曾被无向去重删除。`e03aaa8`只删除反向共同内边，同向外边保留完整竖向包络，分离桥板仍保留各自侧皮。

## 前轮算法审查结果（e03aaa8）

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

## 根最终验收新增P1与3b62b40复验

根独立验收发现前轮审查范围未覆盖的有符号微小坐标反例：候选cell索引经过origin减法舍入，严格裁切又保留正负差异，漏掉边界外露面。实现者先将两条永久回归在原版运行到失败，再提交`3b62b40`窄修；不删测试、不放宽裁切或面积阈值。原32m²墙由16m²恢复32m²；真实high护栏1→4面积由3480.494275995952→3480.022477668317的缺失，恢复为两边均3480.494275995952m²，missingSourceFaces为空。

审查者独立只读补审结论：**`3b62b40281c116352dd8bd379cb22331d026f2df`本次cell候选修复范围通过，无新增可复现缺陷。**

- partition **7/7**通过，含真实high护栏1/4/16面积及全部源face center的同向最近面检查。
- 独立额外 **108案、2592采样点**均恰好覆盖一次：Float32/64、XY/ZY、±MIN_VALUE/±1e-300/±1e-17/±1e-12/0、平面/微倾/0.37斜切、非等宽实际格网；将`grid.at`设置为throw，确认候选查找不再调用它。
- 最大面积误差约 **5.77×10⁻¹² m²**；精确边界与有符号微小坐标owner唯一。代码使用实际下界plane及同一world数值比较，upper-bound半开归属无额外epsilon。
- 未修改文件、运行GPU或重建12案。实现者在同一冻结提交另完成289/289、types/build及12案CPU重建审计，结果见handoff/cost-summary。

完整边界实测摘要见[boundary-regression.json](boundary-regression.json)。该补审仅放行本次几何候选范围；整体验收仍依赖E的统一提交GPU结果。
