# WP-H 交付报告：MapLibre 图层

分支：`phase2/H-maplibre`（基于 `phase2/E-overlays`）。MapLibre GL JS 6.16.0（开发依赖），Chrome 150，Radeon 780M，Linux 7.2。日期：2026-11-12。

## 交付内容

- `@city-ink/map/maplibre` 的 `createMapLibreLayer({ id, tiles, style, ground })`：实现 MapLibre 自定义图层接口，共用宿主 WebGL 上下文；每帧把 MapLibre 的中心、缩放、俯仰、方位、视场角同步到与 `createMap` 相同的相机模型（与 MapLibre 投影一致，见 AC404），在宿主帧缓冲中绘制；绘制前后重置 three.js 的 GL 状态，并清除深度缓冲，使宿主在其上方的图层（文字标注等）不被城市深度遮挡。
- `ground: 'host'`（默认）时不绘制地面、路面、水域、绿地，只绘制建筑、地标、结构和树；`'self'` 为实验选项。
- 图层对象提供 `queryFeatures`、`project`、`getFeature`、`setFeatureState`、`setStyle`、`setFilter`、`getStats`、`whenIdle`、`on/off`、`ready`、`renderer`；宿主点击会转发为图层的 `click` 事件（含拾取到的要素）。
- `maplibre-gl` 是可选 peer 依赖，声明范围 `>=6.16.0 <7.0.0`（仅实测 6.16.0）；主入口不引用它。
- `apps/demo/maplibre.html`：04 第 8 节用法，默认使用离线样式（背景、样本建筑轮廓作为 `building-3d` 并按文档隐藏、一层圆点代替文字标注）；`?basemap=<style.json>` 可换真实底图。
- 修复：取消后又重新请求的瓦片，旧请求的迟到结果会覆盖新状态（图层模式下表现为 `whenIdle` 永不完成），现以每次加载的令牌忽略过期结果；10 万顶点线图层构建去掉临时数组（约 62 ms）。

复现：`npm run demo:tiles && npm run build:demo && CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" node scripts/benchmark-tiles/maplibre-checks.mjs --json docs/phase2/evidence/H/maplibre-checks.json`

## AC 结论

| AC | 结论 | 结果摘要 |
| --- | --- | --- |
| AC801 | 通过 | 底图 `building-3d` 隐藏，城市图层显示 8 块瓦片，无控制台错误 |
| AC802 | 通过 | 50 组相机（缩放 14–19、俯仰 0–75°、任意方位）下 3,980 个建筑轮廓顶点，图层投影与 MapLibre 投影最大差 7e-8 px；瓦片中顶点与原始经纬度的偏差由网格量化决定（≤ 3 cm，AC203/AC307） |
| AC803 | 通过（以圆点图层代替文字） | 加在城市图层之上的宿主圆点覆盖在最高的建筑（中国尊）上方，像素为纯绿；移除城市图层后宿主画面与添加前逐字节相同。离线环境没有字形服务，未用真实文字标注测试 |
| AC804 | 通过 | 图层工作时 77 个几何，移除后 0；宿主地图继续正常渲染 |
| AC805 | 通过 | 主入口与单文件构建均不引用 `maplibre-gl`；peer 依赖标记为可选 |
| AC806 | 通过 | 实测 6.16.0，声明 `>=6.16.0 <7.0.0`；其他版本未测 |

WP-D、WP-E 的浏览器检查和 `npm test`（359 项）在本次改动后复跑全部通过。

## 限制

- 只实测 MapLibre 6.16.0。
- 清除深度缓冲意味着城市图层下方的宿主三维图层（例如未隐藏的拉伸建筑）会被覆盖，而不是与城市建筑互相遮挡。
- 地形（DEM）宿主未支持，地面恒为 0 高程。
- 叠加层（`addLayer` 的 GeoJSON）和标记在图层模式下未暴露，宿主可直接使用 MapLibre 自己的图层。
