# 01 目标架构

## 1. 为什么一期架构不能直接放大

一期场景包把生成好的网格直接写进分块文件。实测体积（来自 `docs/phase1-evidence/remediation/integration/performance/`）：

| 样本 | 覆盖 | 建筑数 | 场景包体积 | Node 构建耗时 |
| --- | --- | --- | --- | --- |
| 北京国贸 `beijing-cbd-grow-9` | 9 块 × 500 m，约 2.25 km² | 286 | 110.6 MB | 7.6 s |
| 京都祇园 `kyoto-gion-grow-9` | 9 块 × 500 m，约 2.25 km² | 3,912 | 296.9 MB | 16.4 s |

按这个密度，一个 500 km² 的城市会是几十 GB，无法下载也无法托管。另外一期是"全区域规划后再分块"，输入只能来自公共 Overpass 小范围下载，单项目使用一个固定投影原点。这三点都不适用于城市尺度。

二期的核心改动因此只有一条：**构建期只做规划，把紧凑的规划结果写进瓦片；网格在运行时由 Worker 确定性地生成。**

## 2. 规划与生成的分界

| 阶段 | 做什么 | 判断标准 |
| --- | --- | --- |
| 构建期规划 | 关系解析、建筑分部归并、高度推断、屋顶参数、道路图与纵断面求解、路面与路口的布尔运算、水域合并、树木选址与避让、对象归属瓦片 | 需要跨对象布尔运算、邻域搜索或全局求解的步骤 |
| 运行时生成 | 由轮廓和参数拉出墙体与屋顶、由带高程的中心线生成桥梁和楼梯、由点位实例化树木、近景细节 | 只依赖单个对象自身参数、局部且确定的步骤 |

同一份生成器代码既在 Node 中运行（测试、GLB 导出、烘焙），也在浏览器 Worker 中运行。生成器不得依赖 DOM 或 WebGL，输入是瓦片里的规划要素，输出是类型化数组。

若某类对象在运行时生成达不到 06 的耗时预算，允许在构建期把它烘焙成量化网格写进瓦片。瓦片格式从一开始就同时支持"规划要素层"和"烘焙网格层"两种编码（见 02）。地标由受信任的配方代码生成，默认采用烘焙网格层。

## 3. 数据流

~~~mermaid
flowchart TD
  PBF[OSM PBF 或小范围 JSON] --> ING[读取与过滤]
  ING --> CELL[按规划格分区，带缓冲圈]
  CELL --> PLAN[规划：解析、推断、道路求解、选址]
  RECIPE[地标配方] --> PLAN
  PLAN --> CUT[归属与裁切到瓦片]
  CUT --> ENC[瓦片编码]
  ENC --> OUT[瓦片目录或单文件归档 + 元数据]
  OUT --> RT[运行时：选瓦片、取数、解码]
  RT --> WK[Worker：生成网格]
  GEN[生成器包] --> WK
  GEN --> PLAN
  WK --> SCENE[Three.js 场景]
  STYLE[样式配置与风格包] --> SCENE
  SCENE --> APP[独立地图 createMap]
  SCENE --> ML[MapLibre 自定义图层]
~~~

## 4. 包结构

采用 npm workspaces 单仓多包。新代码用 TypeScript 严格模式编写。下表的 `@scope` 是占位符，实际名称由 08 的待决事项 D1 决定；在决定前使用 `@city-ink`（与现有 `packages/styles` 一致）。

| 包 | 路径 | 运行环境 | 职责 | 依赖 |
| --- | --- | --- | --- | --- |
| `@scope/tiles` | `packages/tiles` | 通用 | 瓦片 Schema、编解码、墨卡托与瓦片数学、元数据校验 | 无运行时依赖 |
| `@scope/generators` | `packages/generators` | 通用 | 由规划要素生成几何（建筑、屋顶、道路、桥梁、树、水、地表） | `tiles`；可使用 `three` 的数学与 BufferGeometry，不得使用渲染器 |
| `@scope/builder` | `packages/builder` | Node | 输入读取、分格规划、裁切、写瓦片、CLI | `tiles`、`generators`、`landmarks` |
| `@scope/map` | `packages/map` | 浏览器 | 地图式 SDK、流式加载、Worker 调度、拾取、叠加层、MapLibre 图层 | `tiles`、`generators`、`styles`；`three` 为 peer 依赖；`maplibre-gl` 为可选 peer 依赖 |
| `@scope/styles` | `packages/styles`（已存在） | 浏览器 | 样式规范、三套默认风格、立面着色器 | `three` peer |
| `@scope/styles-ink` | `packages/styles-ink` | 浏览器 | 漫画、线稿、赛璐璐等风格化风格与后处理 | `styles` |
| `@scope/landmarks` | `packages/landmarks`（已存在） | 通用 | 官方地标配方 | — |
| `@scope/details` | `packages/details` | 通用 | 街道小品、车辆行人、场地补全等可选装饰 | `generators` |
| 根包 | 仓库根 | — | 一期 SDK、CLI、工作台，保持可用 | 逐步改为调用上述包 |

应用：`apps/demo`（在线 demo 与文档例子）、`studio/`（一期工作台，位置暂不移动）。

## 5. 一期代码的去向

采用逐步抽取，不整体重写。迁移期间旧路径保留转发导出，一期测试必须始终通过。

| 一期模块 | 去向 | 说明 |
| --- | --- | --- |
| `src/osm.js` | `builder` 的解析部分；`projection` 等数学进 `tiles` | 解析逻辑保留，投影改为墨卡托瓦片坐标 |
| `src/building-envelope.js`、`building-rules.js`、`roofs.js`、`facade-layout.js`、`facade-loft.js` | 推断与参数决定进 `builder`；网格生成进 `generators` | 按"规划/生成"分界拆开 |
| `src/road-grade.js`、`road-surface.js`、`paint-inlay.js` | `builder`（求解与布尔运算） | 结果以带高程的中心线和路面多边形写入瓦片 |
| `src/road-structures.js`、`road-stairs.js` | `generators` | 由带高程的中心线在运行时生成 |
| `src/foliage.js`、`vegetation-rules.js`、`tree-clearance.js` | 选址与避让进 `builder`；树形网格进 `generators` | 瓦片只存点位、树形、高度 |
| `src/landscape*.js`、`streetlife.js` 中的设施与车辆行人 | `details` | 不属于核心 |
| `src/landmarks.js`、`landmark-registry.js`、`src/generators/` | `builder` 调用，产物为烘焙网格层 | 配方格式不变 |
| `src/core/`（场景包编译、编解码、LOD） | 保留为"场景模式"；`spatial-partition` 的归属规则被 `builder` 复用 | 见 00 第 7 节 |
| `src/runtime/`（streamer、policy、resources、statistics、gpu-timer） | 抽成 `map` 内部模块，同时服务场景模式与瓦片模式 | 预算、迟滞、回收逻辑复用 |
| `src/sdk/` | 保留 `createCityViewer`；`map` 新增 `createMap` | 两个入口共用运行时内核 |
| `src/styles/`、`ink-renderer.js`、`halftone.js`、`facade-shader.js` | 立面着色器与角色绑定进 `styles`；漫画后处理进 `styles-ink` | — |
| `src/data/`、`src/cli/`、`src/local-server/` | 保留；`builder` CLI 新增瓦片命令 | — |
| `src/main.js`、`src/baseline/` | 旧演示，仅用于视觉回归；M5 评估是否移除 | — |

## 6. 坐标约定

这是所有包共同遵守的硬约定，冲突时以本节为准。

1. **地理坐标**：WGS84，公共接口一律使用 `[lng, lat]` 数组顺序（与 MapLibre、GeoJSON 一致）。一期接口中的 `{lat, lon}` 对象保持不变，不混用。
2. **瓦片方案**：Web 墨卡托 XYZ（原点在左上，y 向南增大），与 MapLibre 使用的方案一致。支持纬度范围 ±80°（沿用一期限制）；跨日期变更线的构建范围明确拒绝。
3. **瓦片内坐标**：以瓦片中心为原点的局部米制，x 向东，y 向上，z 向南（与一期一致）。换算关系为：局部米 = 墨卡托坐标差 × 该瓦片中心纬度处的每单位米数。高度以米存储。
4. **世界坐标**：运行时选定一个锚点经纬度，世界单位是锚点纬度处的米。每块瓦片有自己的变换矩阵，平移到它在世界中的位置，并按"锚点比例 / 瓦片比例"做均匀缩放。该缩放比在同一城市内与 1 的偏差为万分之几，目的是保证相邻瓦片的共享边界在墨卡托坐标上严格重合。
5. **浮动原点**：相机目标点离锚点超过 10 km 时，运行时重设锚点并更新所有瓦片矩阵，对外接口不受影响。开发者自己放进场景的对象通过 SDK 提供的"经纬度锚定组"参与重设（见 04）。
6. **地面**：二期地面是 y = 0 的平面，没有地形。道路高程是规则推断的相对高度。瓦片元数据预留地面高程字段，值恒为 0。
7. **缩放级别定义**：`zoom`、`pitch`、`bearing`、`fov` 的含义与 MapLibre 一致，验收标准见 04。

## 7. 确定性与身份

沿用并扩展一期约定：

- 对象身份由 OSM 类型和 ID 决定（例如 `way/123`），生成对象由来源对象 ID、规则版本、世界位置和项目种子决定，不依赖瓦片编号、规划格编号或遍历顺序。
- 同一输入在不同的规划格划分下，必须得到相同的对象集合和相同的瓦片内容哈希。
- 同一瓦片在 Node 和浏览器 Worker 中生成的几何，顶点数和三角形数相同，坐标差不超过 1 mm。
- 每个建筑和地标整组只归属一块瓦片，不切碎、不重复。道路、水域、地表按瓦片边界裁切，边界顶点由两侧共享的规则计算。

## 8. 版本与兼容

- 瓦片格式、样式规范、元数据各自带 `schemaVersion`。运行时遇到更高的主版本必须给出明确诊断并拒绝加载，不得猜测解析。
- 生成器版本写入瓦片元数据。运行时生成器版本与瓦片声明的兼容范围不匹配时给出诊断。
- 二期发布 1.0 之前，格式允许不兼容变更，但每次变更都要提升版本号并在 08 记录。
