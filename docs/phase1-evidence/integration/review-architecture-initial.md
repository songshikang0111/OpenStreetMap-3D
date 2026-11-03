# A/B/C/E 初阶段架构独立审查

日期：2026-11-03。审查者 `/root/architecture_review`，gpt-6.1-sol、xhigh、fork_turns=none；只读，未修改源码/暂存/提交。初审真实 `7929df3`，复验至 `dc122ce`（检查时 HEAD `44d86d5`）。D 尚未合入，本文不代替最终总验收。

| 级别 | 原始复现 | 修复与独立复验 |
| --- | --- | --- |
| P1 | Temp 真实 src/packages 副本，仅改官方配方 version 1.0.1/ribWidth 1.1，新进程 validate 仍 succeeded，inputs 全相同但 contentHash 改变 | `774732c / 445796a` 把 packages JS/JSON 纳入指纹。原复现返回 STALE_ENGINE，重建 engineHash/contentHash 均改变 |
| P2 | C 普通楼 wall/structure/roof 在分块后丢失 geometry.userData/groups，真实外部绑定只收到 wall | `774732c` 保留语义分组，low 按角色合批。独立 1/4/16 块、三档外部绑定均收到完整角色；实际重绑 triangles/drawCalls 与 manifest 一致 |
| P2 | 属性 cityMaterialRole 仍按法线猜测，与权威 groups 冲突；medium/high 各 22,794 / 36,204 个引用错误 | `dc122ce` 按权威组写属性，索引共享顶点先分开，区域角色表统一。原统计 low 996、medium/high 各 36,204 引用，错误全部 0 |

独立的普通 Mesh / 两实例 InstancedMesh、共享索引顶点双自定义角色 review-alpha/beta 测试：三个 LOD、1/4/16 切块和逆序输入的世界位置、角色、实例矩阵、aReview=[.25,.75] 签名均一致，外部绑定收到两种角色。

验证：初审指定核心/项目 25/25、CLI/数据 29/29；修复后相关 27/27；角色复验 25/25。核心严格类型消费者与真实 registry→compiler 类型消费者通过。npm dry-run 当时 103 文件/228274 bytes，无缓存/地图/CINK/GLB/TGZ；当时 SDK 未合入，AC26 仍 not-run。未启动浏览器或重压力。

截至 dc122ce，三项原始发现全部关闭，本轮无新 P1/P2。D 生命周期、最终安装包、真实工作台、GPU 与最终集成提交仍需复验。
