# Studio 功能预验

2026-11-03，正式 Chrome CUA 扩展操作公共本地服务。初始产品 `fef2f01`；UI 发现的数据策略/任务状态问题分别修复于 `446a94c`、`e5a7de4`，重启公共 CLI 后复验导出成功。额外的延迟 idle 状态竞态修复于 `d028e7e`，通过独立实际 main 模块回归。本目录早于 A 最终混合 LOD 覆盖修复，不作为最终冻结版本或性能验收。

入口：`node bin/city.js studio --workspace work/remediation-studio-final --port 4181 --json`。可复现 fresh fixture：`node scripts/phase1-remediation-studio.mjs --workspace=work/<new-workspace>`，再用公共 CLI 启动；项目相对路径 `official` / `external`。外部项目显式声明 JS 入口、本地裸依赖、CSS 及带 `#/%` 文件名的 SVG。

- 外部入口、依赖、资产和 `aoStrength:0.12 / warmth:0.42` 经应用、质量 low 切换、保存与刷新恢复；保存的街道相机标签正确。
- 四官方画风实际显示，切换时外部 CSS 背景归零；同次会话切回外部时完整声明草稿恢复。[四画风状态及完整过程](ui-results.json)。
- 工作台按钮实际下载 PNG 180,059 bytes、GLB 101,728 bytes；签名、GLB v2 声明长度和 SHA256 通过，PNG 署名已目视核验。[实际文件信息](downloads.json)、[PNG](studio-export.png)。CUA 的 PNG download 事件等待超时，实际 Downloads 文件按本次时间及文件名确认。
- 原策略保存导致 STALE_BUILD 的失败保留在 [原失败截图](external-export-web.png)；修复后同一已有几何无需重建即可重试成功。[成功任务](export-retry-succeeded.png)。保留 source.kind/file、实际 bytes/dataHash 的过期校验，独立 Node 记录见 [策略与状态审查](../review-studio/policy-status-review.md)。
- UI 导出的标准站点在 `/projects/:id/site/index.html` 非根 URL 显示项目画风，CSS/SVG 从该站点本地资产加载。[截图](static-external-nonroot.png)。本次 CUA 没有阻断外网，离线验证单独记录。
- 新项目无 dist 时，canvas、旧来源报告、选择结果与诊断正确清空。真实小范围项目通过 UI 完成下载→缓存→构建→渲染，见下表和 [来源/锁核对](live-source.json)。

| 真实获取项 | 结果 |
| --- | --- |
| bbox | south 48.137, west 11.575, north 48.1375, east 11.576 |
| 服务 | 明确选择 Dresel Europe，UI 标注欧洲区域覆盖，GET，fallback none |
| 请求 | 一次成功，7,524 ms；首次 cacheHit=false |
| 获取时间 / OSM base | 2026-11-03T13:57:49.409Z / 2026-11-02T21:21:26Z |
| 原始响应 hash | caa4e0dc9c7e4a493f5ba6fd688cdbf9e8c7f4759d04d4b0ed9690a58cc5d880 |
| 项目输入文件 SHA256 | dac5f6e804b9b1352e2e99de58f961cd97f5cc50d085a0a391421f452a9f3a21 |
| 内容 | 1,111 个 OSM 元素、5 个 building-tagged records；非 synthetic |
| 再次下载 | cacheHit=true、attempts=[]，输入 bytes/hash 与获取时间保持一致 |
| 构建 | 33 features、6 个编译建筑（包括 parts）、1 chunk；lock.sourceFileHash 与实际输入一致 |

[真实渲染截图](live-munich-built.png)。地图数据 © OpenStreetMap contributors，ODbL。完整任务响应和所显示的来源信息保存于 `ui-results.json`；未将合成 fixture、旧仓库快照或本地导入计作真实下载。
