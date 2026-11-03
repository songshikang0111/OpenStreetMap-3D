# 最终文档与证据边界独立复核

日期：2026-11-03。只读复核时 Git HEAD 为 `4dd35b3985c45ad8f7416612050e6033700199e8`，同时读取父 agent 正在整理的工作区文档。产品功能审查范围仍到 `2c013fb0f8114c2dd1cba67ee1a2cd131e565aed`；最终性能原始记录冻结在 `9407af9c752b6b7cfc32eb4fb17622824e453cfd`，bundle SHA-256 为 `d22408bc6be5535a5ddd2645bdb22ddcde79c25103cd6721407a2abe5a2a0900`。

本轮没有重新运行产品测试、构建、浏览器性能实验或 GPU。只读取文档、已有作者截图和 JSON，并对归档原始 JSON 独立复算统计。只在 ignored work 写本报告和复算结果；未修改产品、正式文档或提交。

## 结论

**当前文档诚实保留了未通过条件，没有把参考设备的帧时目标通过写成一期全部通过。** 发现的 AC27 范围过宽问题已在本轮工作区文档中改正：整项现在为 **not-run**，架构、CLI、SDK 和扩展已完成的独立检查与未完成的独立工作台端到端分列。作者工作台截图及 JSON 没有被改写为非实现者复现。

因此本次文档陈述复核通过；项目验收结果仍须保留：**AC04 fail、AC18 fail、AC27 not-run**。这不是一期全部完成或全部验收通过的结论。

## 逐项复核

| 检查 | 结论 | 依据与限制 |
| --- | --- | --- |
| `acceptance.md` 的完成状态 | pass | 顶部已从“矩阵进行中”改为实际完成，并明确 AC04、AC18 未通过、独立 UI not-run；AC16 / AC19 的待汇总旧句已替换 |
| AC20 的口径 | pass | 只把 12 案的测量和 33.3ms 帧时目标记为 pass；默认绘制预算单列 AC18 fail，联合结果仍为 fail |
| AC18 的失败 | pass，陈述诚实 | 10/12 案默认整帧三角 p95 超 600000；北京/京都各一组 16 块 draws p95 为 1298 / 1404，超过 1200；没有删去这些案例或提高报告预算 |
| AC27 的结果 | pass，范围问题已修 | 初读 `acceptance.md:45` 为无条件 pass，超出规划 §15 与本角色实际完成范围。提出后改为 not-run，明确“整项不能按已完成部分宣布pass；作者UI另列” |
| 作者 / 独立 UI 分列 | pass | `studio-ui-results.json` 的 role 为 `implementer, not independent UI evidence`，并保留 `independentUiStatus`；`review-studio/final-review.md` 的独立 CUA 仍为 not-run |
| 作者工作台图片 | pass，作为作者证据 | 读取 `studio-final.jpg` 可见已加载场景、彩色风格、项目名和范围、保存状态、Web 导出 `succeeded` / `site/index.html`。精确保存相机和 FOV55 由作者 JSON 支持；未将查看这张图称为本人执行 UI 流程 |
| `handoff.md` | pass | 已替换矩阵进行中的旧句，明确 12×60 秒完成、帧时与预算分别判断；没有用作者 UI 补成独立 UI pass |
| 根 `README.md` | pass | 第5行直接披露 RTX4090 参考测量、真实下载和默认绘制预算未全部通过，以及独立工作台 UI 未执行；没有只靠深层证据链接隐藏缺口 |
| `docs/support.md` | pass | 实测范围明确为 Windows / Chrome156 / RTX4090、1280×720、DPR1、balanced；明列 10/12 三角预算失败、两组16块 draws失败，未外推任意单块、低端或移动 GPU；明确 128MiB 是估算驻留而非实测显存 |
| 外网真实下载边界 | pass，陈述诚实 | 默认 Overpass 本轮 502 / TIMEOUT，无 live 成功缓存；本地样例、仓库快照和 fixture 没有补成 AC04 通过 |

## 独立复算最终性能归档

仅对 `performance/` 中既有12份 raw JSON读取计算，没有启动性能脚本或浏览器。独立使用 nearest-rank 分位数重算每案的 RAF / GPU p95、drawCalls / triangles p95、采样数、超过50ms的帧数与 lifecycle 数，与 `assessment.json` 逐项一致。结果在 `final-document-metrics-review.json`。

- 案例：12；每案记录的实际路径时长不少于60秒。
- RAF 样本：86,109；GPU 查询样本：86,109。
- RAF p95：各案约 8.4ms。
- GPU p95：4.77184–7.036928ms。
- 超过50ms的帧：13。
- 生命周期往返：60；归档各案 `lifecycleStable` 均为 true。这里是已有原始数据的独立核对，不是本角色重新执行60次 GPU 往返。
- 10案三角 p95 超默认600000；两组16块 draws p95 超1200。
- 汇总的 `timingStatus='pass'`、`status='fail'` 与文档区分一致。

性能文档还保留了真实输入来源与哈希、物理范围和切块方式、冷启动、CPU callback、GPU timer、传输、全帧计数、far/full override、CPU数组/估算驻留与设备限制；未把 GPU elapsed 误写为包含 CPU / 排队的整帧呈现时间。

## 新独立 CUA 入口尝试

在本轮得到父 agent 明确的新尝试指令后，只调用其指定的正式浏览器入口：

```javascript
await cua.createBrowserTab('3','http://127.0.0.1:4179',{
  sessionName:'🏙️ 独立工作台终验'
});
```

工具立即返回：**`Browser is not available: 3`**。没有创建标签页、没有读取可信 URL / DOM，也没有执行 sample、风格、相机、保存或导出操作。依照任务明确的停止条件，立即停止；未枚举、猜测其他 browser ID / URL，没有转回 native / sky，也没有更换其他通道。

这次接口不可用与早前 native Windows CUA 的 URL 置信度停止是两次独立的工具限制，均不能写成独立工作台通过。**本角色独立工作台端到端仍为 not-run；AC27 not-run 保持。** 此次没有新增浏览器、服务或 GPU 进程。

## 归档建议

保留原 `final-review.md` 的历史版本范围和原始 not-run，不覆盖为 pass。将本报告作为后续文档复核附录归档，并与 `final-document-metrics-review.json` 一起保留。`studio-final.jpg` / `studio-ui-results.json` 始终标记作者证据。将最终文档 / 测量证据提交后，最终答复仍需直接说明 AC04、AC18、AC27 的实际状态，不得宣布一期整体全部通过。
