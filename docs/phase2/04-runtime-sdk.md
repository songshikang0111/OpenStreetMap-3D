# 04 地图运行时 SDK

由 WP-D（内核与 `createMap`）、WP-E（叠加层与拾取）、WP-H（MapLibre 图层）实现，位于 `packages/map`。

## 1. 设计原则

1. **接口向 MapLibre 的习惯靠拢**：中心点、缩放、俯仰、方位、`flyTo`、`on('click')`。开发者和 coding agent 都已熟悉这套词汇。
2. **场景就是 Three.js**：暴露 `scene`、`camera`、`renderer`，开发者可以直接往里加自己的对象。这是相对其他地图 SDK 的核心差异。
3. **一份内核，两种宿主**：独立模式自己管相机和渲染循环；图层模式把相机和渲染时机交给 MapLibre。
4. **数据与渲染解耦**：SDK 只读静态瓦片，不依赖任何本项目运营的服务。
5. **一期的 `createCityViewer` 继续可用**，与 `createMap` 共用流式加载、预算、回收和统计模块。

## 2. 最小用法

~~~js
import { createMap } from '@scope/map';

const map = await createMap({
  container: document.getElementById('map'),
  tiles: 'https://example.com/beijing/tileset.json',
  center: [116.4605, 39.9095],
  zoom: 16,
  pitch: 60,
  bearing: -20,
  style: 'light',
});

map.addMarker({ lngLat: [116.4602, 39.9115], element: myDiv });
map.on('click', (e) => console.log(e.lngLat, e.feature));
~~~

容器需要有明确的宽高。省略 `center` 和 `zoom` 时使用 `tileset.json` 的 `center`。

## 3. 公共接口

以下签名为冻结契约，实现可增加可选字段，不得改变已有含义。完整类型位于 `packages/map/src/index.ts`，并随包发布 `.d.ts`。

~~~ts
type LngLat = [lng: number, lat: number];

interface MapOptions {
  container: HTMLElement;
  tiles: string | Tileset;                 // tileset.json 的地址，或已解析的对象
  center?: LngLat; zoom?: number; pitch?: number; bearing?: number; fov?: number;
  style?: string | StyleSpec | StylePack;  // 见 05
  quality?: 'low' | 'balanced' | 'high' | Budget;
  interactive?: boolean;                   // 默认 true
  attributionControl?: boolean;            // 默认 true
  filter?: ProvenanceFilter;               // 见 05 第 5 节
  readAsset?: ReadAsset;                   // 与一期相同的可注入读取函数
  workers?: number;                        // 默认 min(4, 硬件并发数 - 1)，至少 1
  onDiagnostic?(d: Diagnostic): void;
}

interface CameraOptions { center?: LngLat; zoom?: number; pitch?: number; bearing?: number }
interface AnimationOptions { duration?: number; easing?(t: number): number }

interface CityMap {
  // 相机
  getCenter(): LngLat; getZoom(): number; getPitch(): number; getBearing(): number;
  jumpTo(o: CameraOptions): void;
  easeTo(o: CameraOptions & AnimationOptions): Promise<void>;
  flyTo(o: CameraOptions & AnimationOptions): Promise<void>;
  fitBounds(bounds: [number, number, number, number], o?: { padding?: number } & AnimationOptions): Promise<void>;

  // 坐标换算
  project(lngLat: LngLat, altitude?: number): { x: number; y: number } | null;
  unproject(point: { x: number; y: number }): LngLat | null;   // 与地面的交点
  lngLatToWorld(lngLat: LngLat, altitude?: number): THREE.Vector3;
  worldToLngLat(v: THREE.Vector3): { lngLat: LngLat; altitude: number };

  // Three.js 接入
  readonly scene: THREE.Scene; readonly camera: THREE.PerspectiveCamera; readonly renderer: THREE.WebGLRenderer;
  createAnchor(lngLat: LngLat, altitude?: number): THREE.Group;   // 随浮动原点自动更新
  requestRender(): void;

  // 事件
  on(type: MapEventType, handler: (e: MapEvent) => void): () => void;
  off(type: MapEventType, handler: (e: MapEvent) => void): void;

  // 要素
  queryFeatures(point: { x: number; y: number }): Feature | null;
  getFeature(id: string): Feature | null;
  setFeatureState(id: string, state: Record<string, unknown>): void;   // 高亮、隐藏等，见 05

  // 叠加层
  addMarker(o: MarkerOptions): Marker;
  addLayer(layer: OverlayLayer): void; removeLayer(id: string): void;

  // 风格与过滤
  setStyle(style: string | StyleSpec | StylePack): Promise<void>;
  setFilter(filter: ProvenanceFilter): void;

  // 生命周期与诊断
  whenIdle(o?: { timeoutMs?: number }): Promise<void>;
  getStats(o?: { raw?: boolean }): MapStats;
  resize(): void; pause(value?: boolean): void;
  dispose(): Promise<void>;
}

type MapEventType = 'click' | 'dblclick' | 'pointermove' | 'movestart' | 'move' | 'moveend'
  | 'idle' | 'tileload' | 'tileerror' | 'styledata' | 'error';

interface MapEvent { type: MapEventType; lngLat?: LngLat; point?: { x: number; y: number }; feature?: Feature | null; originalEvent?: Event }

interface Feature {
  id: string;                       // 例如 "way/123456"
  layer: string;                    // building、road、tree…
  properties: Record<string, unknown>;
  provenance: Record<string, 'observed' | 'derived' | 'inferred'>;
  lngLat: LngLat;                   // 锚点
  bounds?: [number, number, number, number];
}
~~~

约定：

- 所有接受经纬度的地方使用 `[lng, lat]`。
- `dispose` 之后调用任何方法都抛出明确错误；重复 `dispose` 安全。
- 错误和诊断使用与一期一致的结构（`code`、`stage`、`message`、`hint`、可选 `tileId`、`url`）。

## 4. 相机模型

- `zoom`、`pitch`、`bearing`、`fov` 的定义与 MapLibre 一致。验收：在相同视口和相同相机参数下，同一经纬度的地面点在本 SDK 与 MapLibre 中的屏幕位置差不超过 2 像素（AC404）。测试参数覆盖缩放 13–19、俯仰 0–75°、方位任意。
- 默认俯仰上限 80°，缩放范围默认 12–20，可配置。缩放低于瓦片集最低内容级别太多时，显示空地面并发出一次诊断，不报错。
- 交互：鼠标拖动平移、滚轮缩放、右键或 Ctrl 拖动旋转和俯仰；触屏单指平移、双指缩放和旋转、双指上下滑动改变俯仰。带惯性。可整体关闭或逐项关闭。
- 相机近远裁面随高度和俯仰自动调整（复用一期 `src/depth-policy.js` 的思路）。远处使用雾化淡出，可见距离上限由预算决定。
- 浮动原点按 [01 第 6 节](01-architecture.md) 执行。重设原点不得产生可见跳变，不得触发任何对外事件。

## 5. 瓦片选择与流式加载

### 5.1 选择

1. 由相机视锥和地面求出可见范围，加上预取边距。
2. 对每个候选瓦片计算屏幕空间误差（级别的 `geometricErrorMeters` 投影到屏幕的像素数），超过阈值则细化到下一级。
3. 用覆盖位图过滤不存在的瓦片。
4. 应用预算：超出驻留字节、可见三角形或绘制调用预算时，从最远的瓦片开始降级，最低保留 L0 覆盖。

### 5.2 替换规则

- 一块 L0 瓦片只有在覆盖它且需要显示的全部 L1 子瓦片都就绪后才隐藏。子瓦片未就绪期间继续显示父瓦片，不出现空洞。
- 反向亦然：子瓦片只有在父瓦片就绪后才卸载。
- 使用迟滞和最短驻留时间防止镜头微动造成反复切换。默认参数沿用一期（`minResidenceMs` 750、`unloadDelayMs` 1200）。
- 切换不改变对象身份；被选中或设置了要素状态的对象在切换后保持状态。

### 5.3 加载管线

~~~text
选择 → 排队（按屏幕重要性排序） → 取数（可取消） → Worker 解码 + 生成 → 主线程分批上传 → 绑定风格 → 显示
~~~

- 取数并发上限默认 6；过期请求（相机已移走）必须取消。
- 解码和几何生成全部在 Worker 中完成，结果以可转移的 `ArrayBuffer` 传回，主线程不做几何计算。
- 主线程上传 GPU 资源按每帧时间片分批（默认每帧不超过 4 ms），避免长帧。
- 同一瓦片的生成结果在内存预算内缓存；卸载时释放几何、材质引用和 Worker 侧缓存。
- 加载失败按退避重试，最多 3 次，之后发出 `tileerror` 并保留父级覆盖。404 且覆盖位图标明存在时按错误处理。

### 5.4 预算

沿用并扩展一期的 `Budget`：`residentBytes`、`visibleTriangles`、`drawCalls`、`concurrentLoads`、`pixelRatio`、`nearDetails`、`shadowQuality`、`aoQuality`、`hysteresis`、`minResidenceMs`、`unloadDelayMs`、`prefetchMargin`，新增 `workerQueue`（Worker 排队上限）和 `uploadMsPerFrame`。三档质量的默认值见 [06](06-performance-and-devices.md)。

## 6. 拾取与要素状态

- 拾取使用对象 ID 离屏渲染或射线求交，由 WP-E 按实测选择；要求单次拾取不产生超过 4 ms 的主线程开销。
- `queryFeatures` 返回屏幕点下最前面的要素，包含 OSM 身份、图层、保留的标签和来源等级。
- `setFeatureState(id, state)` 支持 `highlight`、`hidden`、`color` 三个内置状态键，由默认风格实现；自定义风格可读取任意状态键。状态存放在按 `renderId` 索引的数据纹理或属性中，设置状态不得重建几何。

## 7. 叠加层

### 7.1 标记

~~~ts
interface MarkerOptions { lngLat: LngLat; altitude?: number; element: HTMLElement; anchor?: 'center' | 'bottom' | 'top'; occlude?: boolean }
interface Marker { setLngLat(l: LngLat): void; remove(): void }
~~~

DOM 元素每帧按投影结果定位。`occlude` 为真时被建筑遮挡的标记隐藏（通过深度查询或射线，默认关闭）。目标：同屏 500 个标记不造成可测量的帧率下降；超过时文档建议改用图层。

### 7.2 GeoJSON 图层

~~~ts
type OverlayLayer =
  | { id: string; type: 'line'; data: GeoJSON; paint: { color: string; width: number; opacity?: number }; altitude?: number }
  | { id: string; type: 'fill'; data: GeoJSON; paint: { color: string; opacity?: number }; altitude?: number }
  | { id: string; type: 'extrusion'; data: GeoJSON; paint: { color: string; opacity?: number; height: number | string; base?: number | string } }
  | { id: string; type: 'circle'; data: GeoJSON; paint: { color: string; radius: number } }
  | { id: string; type: 'custom'; object: THREE.Object3D; lngLat: LngLat; altitude?: number };
~~~

- `line` 和 `fill` 贴在地面上方一个小偏移处绘制，线宽单位为像素。
- `extrusion` 的 `height` 可以是数字或要素属性名。
- `custom` 把任意 Three.js 对象放在指定经纬度，内部使用 `createAnchor`。
- 叠加层参与拾取，事件中的 `feature.layer` 为图层 ID。
- 数据量目标：10 万个顶点以内的图层更新耗时小于 100 ms。更大的数据量不在二期承诺内。

### 7.3 文字标注

二期独立模式不提供路名和兴趣点文字。需要文字的用户使用 MapLibre 图层模式，或用标记自行实现。文档必须在显著位置说明这一点。

## 8. MapLibre 图层模式

~~~js
import maplibregl from 'maplibre-gl';
import { createMapLibreLayer } from '@scope/map/maplibre';

const layer = createMapLibreLayer({ id: 'city3d', tiles: '…/tileset.json', style: 'light' });
map.on('load', () => {
  map.setLayoutProperty('building-3d', 'visibility', 'none'); // 隐藏底图自带的盒子
  map.addLayer(layer);
});
~~~

- 返回值实现 MapLibre 的自定义图层接口，与宿主共用 WebGL 上下文和相机矩阵。
- 图层对象暴露与 `CityMap` 相同的要素、风格、过滤和统计方法（不含相机和交互方法，这些由 MapLibre 负责）。
- 渲染后必须恢复宿主的 WebGL 状态；与宿主的深度缓冲配合，使 MapLibre 的文字标注正确显示在建筑之上。
- 二期图层模式下只绘制立体对象（建筑、地标、结构、树），地面、路面和水域由 MapLibre 绘制。原因是本项目的道路有厚度和坡度，与底图的平面道路同时绘制会互相冲突。提供 `ground: 'host' | 'self'` 选项，`self` 为实验性质，默认 `host`。
- `maplibre-gl` 为可选 peer 依赖；不使用图层模式的用户不应被迫安装。支持的版本范围由 WP-H 实测后写入包声明。
- 后处理类风格（描边、网点）在图层模式下不可用或降级，由风格声明 `hostCompatible`（见 05）。

## 9. 与一期场景模式的关系

- `createCityViewer({manifestUrl})` 保持不变，一期全部运行时测试继续通过。
- `createMap` 接受 `tiles`。两者内部共用：资源生命周期与回收、预算与降级策略、整帧统计与 GPU 计时、风格绑定、PNG 导出。
- 一期的 GLB 导出在瓦片模式下提供"当前已加载范围"导出；"完整范围"导出改由构建端命令提供，不在浏览器中做。

### 导出瓦片地图

独立地图在画面就绪后可调用 `await map.exportPNG()`，取返回值的 `blob`。PNG 使用当前 WebGL 画布的物理分辨率，图像底部包含来源与许可。地图网页中的 HTML 标记不属于 WebGL 画面。

`await map.exportGLB({scope: 'loaded'})` 返回 `blob`、`tileIds` 和 `attribution`。导出使用当下真正显示的瓦片层级，保留楼体、道路和树实例的模型几何。只作为后备的父瓦片不会叠加到子瓦片上。可用 `maxBytes` 指定输出字节上限，默认为地图驻留预算。GLB 使用通用材质，后处理、着色器风格和业务叠加层仅在地图中显示。地理原点、坐标方向、数据源和 OSM 许可写入 GLB 的 `extras`。示例见[类型检查用例](../../examples/phase2/map-usage.ts)。

完整已构建目录可运行 `city tiles export ./tiles --output ./city.glb --json`。命令逐一读取覆盖位图里的最高精度瓦片，校验内容哈希，将几何块暂存到输出文件所在磁盘，再原子替换最终文件。请预留临时几何和最终模型所需空间。单份 GLB 受格式的 32 位文件长度限制，必要时分区构建和导出。[glTF 2.0 文件格式](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

## 10. 包体积

- `@scope/map` 压缩后不超过 180 KB（不含 `three`）；Worker 代码单独成块并按需加载。
- 默认风格随主包；`styles-ink`、`details`、MapLibre 适配分别独立成块。
- 提供一个不需要打包器的单文件 ESM 构建，供直接用 `<script type="module">` 引入。

## 11. 验收要点

对应 09 中的 AC401–AC415（WP-D）、AC501–AC509（WP-E）、AC801–AC806（WP-H）。
