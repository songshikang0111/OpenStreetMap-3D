# City Ink（工作名）

**把 OpenStreetMap 变成好看、可嵌入、可换风格的 3D 城市图层。** 带屋顶和分部的建筑、有路缘和坡度的道路、带护栏和桥墩的桥梁、树和绿地——以静态瓦片发布，在浏览器 Worker 中生成网格。它就是一个普通的 Three.js 场景，也能作为 3D 图层叠在 MapLibre 上。

> 状态：发布前（二期开发中）。`@city-ink/*` 包名和 `.c3t` 扩展名是工作名，尚未发布到 npm，也没有在线 demo。[English](README.md)

## 它是什么，不是什么

| 是 | 不是 |
| --- | --- |
| 3D 城市图层：建筑、屋顶、道路、桥梁、楼梯、水、树、街道细节 | 完整地图产品：没有搜索、路线、实时路况、POI 服务 |
| 从 OSM 构建、可任意静态托管的瓦片；无需密钥和服务器 | 托管的瓦片服务（维护者不运营任何服务） |
| 每个对象都有语义角色和 OSM 身份的 Three.js 场景 | 测绘级或照片级模型 |
| 可换肤：一个 JSON 风格文件，或自己的材质与后处理 | 文字标注引擎：独立地图**不画文字标注**，需要标注请用 MapLibre 图层 |

### 真实与推断

OSM 很少给出建筑高度和屋顶形状。本项目用规则补全，并给关键属性标注来源等级：`observed`（OSM 直接给出）、`derived`（如层数乘层高）、`inferred`（估算）。运行时可以查看和过滤：`map.setFilter({ buildings: { minHeightProvenance: 'observed' } })` 会把没有实测高度的建筑画成贴地轮廓。屋顶形状、补种树、街道小品和场地补全都是带开关的推断装饰。请勿把结果描述为"真实还原"。

### 中国大陆的数据与合规

OSM 在中国大陆的建筑覆盖稀疏。在中国大陆上线的应用需要自行处理地图合规（审图号、坐标系等），本项目不提供任何规避手段。

## 本地试用（约五分钟）

需要 Node 22.11+ 和支持 WebGL 2 的浏览器。

```sh
npm ci
npm run demo:tiles -- beijing-cbd-grow-9     # 用内置 OSM 数据先构建一个片区
npm run build:demo
node scripts/serve-static.mjs apps/demo/dist --port 5180
```

打开 `http://127.0.0.1:5180/`。运行不带参数的 `npm run demo:tiles` 并重新构建 demo，即可切换五个样本片区。见[静态站点与样本指南](docs/demo.md)。

可切换风格（`light`、`plain`、`dark` 以及漫画类 `comic`、`line`、`color`、`white`、`cel`），开关街道细节、"仅真实高度"、推断屋顶，点击建筑。其他页面：`overlays.html`（标记、线、面、拉伸）和 `maplibre.html`（MapLibre 图层）。

## 在自己的页面中使用

```js
import { createMap } from '@city-ink/map';

const map = await createMap({
  container: document.getElementById('map'), // 容器需要有宽高
  tiles: './tiles/my-city/tileset.json',
  center: [116.4605, 39.9095], // [经度, 纬度]
  zoom: 16,
  pitch: 60,
  bearing: -20,
  style: 'light',
});
map.addMarker({ lngLat: [116.4602, 39.9115], element: document.createElement('div') });
map.on('click', (e) => console.log(e.feature)); // OSM 身份、图层、保留标签、来源等级
```

包发布前，请在本仓库构建（`npm run build:packages`），使用 workspace 包或再运行 `npm run build:map-bundle` 生成 `packages/map/bundle/`（保留旁边的 Worker，`three` 通过导入映射提供）。完整接口见 [04 地图运行时 SDK](docs/phase2/04-runtime-sdk.md)；[docs/llms.md](docs/llms.md) 是给编程 agent 的单文件接入说明。

### 叠加在 MapLibre 上

```js
import { createMapLibreLayer } from '@city-ink/map/maplibre';
map.addLayer(createMapLibreLayer({ id: 'city', tiles: './tiles/my-city/tileset.json' }), 'labels-layer-id');
```

MapLibre 保留底图和文字标注；隐藏它自己的 `fill-extrusion` 建筑。已实测 `maplibre-gl` 6.16.0。

## 为自己的范围构建瓦片

```sh
# 小范围 OSM JSON（Overpass "out body geom"）
node bin/city.js tiles build --input area.json --output tiles/my-area --json
# 城市级 .osm.pbf（输入不超过 1 GB，构建范围不超过 5,000 km²）
node bin/city.js tiles build --input city.osm.pbf --bbox 4.885,52.368,4.905,52.380 --output tiles/my-city --json
node bin/city.js tiles validate tiles/my-city --json
node bin/city.js tiles serve tiles/my-city --port 4181
```

选项（`--config options.json`）：`inferRoofs`（默认关）、`ruleTrees`（默认开）、`details`（街道小品，默认关）、`landscape`（场地补全，默认关）。构建结果确定且可恢复（`--resume`）。过大的 PBF 先裁剪，例如 `osmium extract -b 西,南,东,北 in.osm.pbf -o city.osm.pbf`。已知限制：整城构建目前很慢（见 [WP-F 报告](docs/phase2/evidence/F/report.md)）。

## 换风格

三个层次（[05 风格契约](docs/phase2/05-style-contract.md)，教程见 [docs/extensions.md](docs/extensions.md)）：

1. **StyleSpec**：一个 JSON 文件，按语义角色配颜色、光照、雾、立面窗格，按属性或来源等级写规则。`map.setStyle(spec)` 不重新取瓦片、不重建几何。
2. **漫画类风格**：`import { comic } from '@city-ink/styles-ink'`，一期渲染器的描边、网点和实黑。只用于独立地图。
3. **代码风格包**：自己的材质、后处理和瓦片加载/卸载钩子。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/tiles` | 瓦片格式 1.0、编解码、墨卡托数学、tileset Schema |
| `packages/generators` | 由规划要素生成几何（建筑、屋顶、道路、桥梁、水、树） |
| `packages/builder` | OSM JSON / PBF 读取、规划、裁切、编码、`city tiles` CLI |
| `packages/map` | `createMap`、流式加载、Worker、拾取、叠加层、MapLibre 图层 |
| `packages/styles`、`styles-ink` | StyleSpec、默认风格、立面着色器；漫画类风格 |
| `packages/details` | 可选的街道细节与场地补全 |
| `src/`、`studio/`、`bin/` | 一期工具链、场景包、工作台和 CLI（继续可用，见[一期历史](docs/history.md)） |
| `docs/phase2/` | 计划、规格、决策和证据 |

## 参与

见 [CONTRIBUTING.md](CONTRIBUTING.md)、[路线图](ROADMAP.md) 和[入门任务](docs/phase2/starter-issues.md)。支持矩阵：[docs/support.md](docs/support.md)。

## 许可与署名

代码 MIT（[LICENSE](LICENSE)）。地图数据 © OpenStreetMap contributors，ODbL 1.0（[DATA_LICENSE.md](DATA_LICENSE.md)）；显示瓦片的地方都要保留署名（地图默认显示）。
