# 竞品现状核实（WP-A，任务 A6）

核实日期：2026-11-12。方法：开源项目使用 GitHub REST API（`/repos/{owner}/{repo}`）读取许可、最近推送时间和归档状态；闭源产品使用官方文档页面。复跑命令见文末。凡是只有第三方来源或无法从官方来源确认的条目，均标注"未能核实"。

| 产品 | 许可 / 商业模式 | 最近更新（核实值） | 是否提供可嵌入 SDK | 3D 城市能力 | 依据 |
| --- | --- | --- | --- | --- | --- |
| MapLibre GL JS | BSD-3-Clause（仓库 `LICENSE.txt`；API 返回 `NOASSERTION`，因许可文件含附加声明） | 2026-11-11 有推送，未归档 | 是（JS SDK，另有 Native） | 拉伸平顶建筑（`fill-extrusion`），无屋顶、分部、桥梁结构 | [GitHub](https://github.com/maplibre/maplibre-gl-js) |
| CesiumJS + Cesium OSM Buildings | CesiumJS 为 Apache-2.0；OSM Buildings 数据为 ODbL，经 Cesium ion 分发，需要 ion 账户（免费档可用），受 ion 服务条款约束 | CesiumJS 2026-11-11 有推送；OSM Buildings 官方称按季度更新 | 是 | 全球 3D Tiles 建筑，体块为主；风格化能力有限 | [GitHub](https://github.com/CesiumGS/cesium)、[OSM Buildings 页面](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/)、[第三方条款](https://cesium.com/legal/third-party-terms/) |
| Mapbox Standard | 闭源，按用量计费，通过 `mapbox://styles/mapbox/standard` 由 Mapbox 托管；未找到可自托管的官方说明（未能核实"不可自托管"这一点，只能确认官方只提供托管方式） | 官方博客称已覆盖 370 个城市、上万个地标模型 | 是（GL JS 与原生 SDK） | 建筑带光照与立面细节、3D 地标、树 | [Standard 文档](https://docs.mapbox.com/map-styles/standard/guides)、[地标博客](https://mapbox.com/blog/global-cities-3d-landmarks) |
| Google Photorealistic 3D Tiles | 闭源，Map Tiles API 按调用计费，需要 API 密钥和计费账户；缓存与离线限制见平台条款（条款原文本次未取得，标注未能核实） | 已 GA | 通过 3D Tiles 标准由 Cesium / deck.gl 等加载 | 照片级网格，无单栋语义 | [用量与计费](https://developers.google.com/maps/documentation/tile/usage-and-billing) |
| Streets GL | MIT | 最近推送 2025-08-21，未归档；本次核实时已超过一年无推送 | 否，是独立网站应用 | 屋顶、分部、道路、树，效果最接近本项目 | [GitHub](https://github.com/StrandedKitty/streets-gl)、[OSM Wiki](https://wiki.openstreetmap.org/wiki/Streets_GL) |
| F4map | 闭源；免费网页使用，OSM 署名；产出物许可在 OSM Wiki 各语言版本中说法不一（未规定 / CC-BY-NC），源码与自制地标模型不开放 | 未能核实更新时间 | 否 | 3D 建筑、地标模型、地形 | [OSM Wiki](https://wiki.openstreetmap.org/wiki/F4_Map)、[官网](https://f4map.com/) |
| OSM Buildings（补充） | 仓库 API 返回 `NOASSERTION`（需人工核对许可文件） | 最近推送 2021-04-29，事实上停止维护 | 是（JS 库） | 拉伸建筑 | [GitHub](https://github.com/OSMBuildings/OSMBuildings) |

## 结论

1. 规划时的判断基本成立：开源、可嵌入、带屋顶和结构的 3D 城市 SDK 仍是空位。
2. 最接近的 Streets GL 已一年多没有推送，且定位是网站而非 SDK，这降低了 08 中"类似项目复活"的风险，但不排除。
3. Mapbox Standard 的地标覆盖已大幅扩大（官方称 370 个城市），对外文案不应把"地标"作为差异点，差异应聚焦在开源、可自托管、可二开。
4. 00 第 1 节表格已按本文件更新措辞；本文件以外的对外文档在引用前应重新核实日期。

## 复跑

~~~sh
for r in maplibre/maplibre-gl-js CesiumGS/cesium StrandedKitty/streets-gl OSMBuildings/OSMBuildings; do
  curl -s https://api.github.com/repos/$r | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.full_name,j.license?.spdx_id,j.pushed_at,j.archived)})'
done
~~~

原始输出（2026-11-12）：

~~~text
maplibre/maplibre-gl-js NOASSERTION 2026-11-11T17:45:53Z false
CesiumGS/cesium Apache-2.0 2026-11-11T19:16:12Z false
StrandedKitty/streets-gl MIT 2025-08-21T19:43:43Z false
OSMBuildings/OSMBuildings NOASSERTION 2021-04-29T07:32:34Z false
~~~
