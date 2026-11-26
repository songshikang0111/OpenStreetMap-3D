# 02 瓦片格式

本规格由 WP-B 实现并冻结。冻结后 WP-C（写）和 WP-D（读）以它为唯一依据。坐标约定见 [01 第 6 节](01-architecture.md)。

## 1. 设计目标

- 一块瓦片是一个独立可解码的二进制文件，可以放在任何静态托管上。
- 体积接近矢量瓦片的量级，而不是网格文件的量级（预算见第 6 节）。
- 携带足够的语义，让运行时确定性地生成与构建期一致的几何，并支持拾取、换肤和真实性过滤。
- 同时容纳"规划要素"和"烘焙网格"两种内容。

## 2. 金字塔与内容级别

瓦片集由元数据声明若干内容级别，每个级别绑定一个缩放级别和一个内容档案。运行时不得写死缩放级别，一律读元数据。

二期默认配置：

| 级别 | 缩放 | 北纬 40° 处边长 | 内容档案 | 内容 |
| --- | --- | --- | --- | --- |
| L0 | 14 | 约 1,874 m | `massing` | 简化轮廓的建筑体块（无屋顶细节、无立面参数）、主要道路的平面带、简化的水域和绿地、地标的低面数轮廓 |
| L1 | 16 | 约 468 m | `full` | 完整建筑（分部、屋顶、立面参数）、全部道路与桥梁楼梯、水域、绿地、树木点位、地标 |

说明：

- L1 的边长与一期验证过的 500 m 分块接近，一期的预算和迟滞参数可作为起点。
- 细化方式为替换：一块 L0 瓦片被它覆盖的 16 块 L1 瓦片替换。替换必须整组完成后再切换，避免空洞（规则见 04）。
- 近景细节（窗框、阳台、屋顶设备）不单独成级，由运行时在 L1 数据上按预算生成，沿用一期的近景附件机制。
- 若 WP-B 的度量任务（B5）表明 14/16 两级的切换代价过高，可以插入缩放 15 的中间级或调整级别，但必须通过元数据表达，并在 08 记录。

`massing` 档案的简化规则（构建期执行）：

- 建筑轮廓用道格拉斯-普克算法简化，容差 2 m；同一建筑的多个分部合并为不超过 3 段的阶梯体块，保留最高点高度。
- 不丢弃小建筑。面积小于 30 m² 且高度小于 6 m 的建筑按街区合并为一个低矮体块。
- 道路只保留主干以上等级，按宽度输出平面带，不含坡度和结构。
- 树木不输出个体，按 100 m 网格输出覆盖密度，供风格层决定是否显示成色块。

## 3. 地址与分发

两种分发形式，内容完全相同：

1. **目录形式（必须实现）**：`{base}/{z}/{x}/{y}.c3t`，另有 `{base}/tileset.json`。任何静态服务器都可用。
2. **单文件归档（M3 实现）**：一个支持 HTTP 范围请求的归档文件。优先评估 PMTiles v3 规范（开放、单文件、载荷类型不限）。若评估后不采用，须在 08 记录原因和替代方案。

文件扩展名 `.c3t` 是工作名，随 D1 的命名决定一起确认。服务端压缩（gzip 或 brotli）由托管方负责；瓦片本身不再做整体压缩，以便范围请求和流式解码。

## 4. 瓦片集元数据 `tileset.json`

~~~json
{
  "schemaVersion": 1,
  "name": "beijing",
  "tiles": ["{z}/{x}/{y}.c3t"],
  "bounds": [116.10, 39.70, 116.75, 40.20],
  "center": [116.397, 39.908, 15],
  "levels": [
    {"id": "L0", "zoom": 14, "profile": "massing", "geometricErrorMeters": 12},
    {"id": "L1", "zoom": 16, "profile": "full", "geometricErrorMeters": 0.5}
  ],
  "coverage": {"zoom": 16, "index": "coverage.bin"},
  "generator": {"id": "builder", "version": "2.0.0", "compatibleRuntime": ">=2.0.0 <3.0.0"},
  "layers": ["building", "landmark", "road", "structure", "water", "green", "tree", "ground"],
  "attributes": {"building": ["height", "minHeight", "roofShape", "facade", "provenance"]},
  "source": {
    "kind": "osm-pbf",
    "file": "beijing-latest.osm.pbf",
    "sha256": "…",
    "timestamp": "2026-11-01T00:00:00Z"
  },
  "attribution": {
    "text": "© OpenStreetMap contributors",
    "url": "https://www.openstreetmap.org/copyright",
    "license": "ODbL-1.0"
  },
  "build": {"seed": 1, "options": {"inferRoofs": false, "landscape": false}, "configHash": "…"},
  "ground": {"elevation": "flat", "value": 0}
}
~~~

约定：

- `bounds` 为 `[west, south, east, north]`，`center` 为 `[lng, lat, zoom]`。
- `tiles` 中的地址相对 `tileset.json` 所在位置解析（与一期清单的规则一致）。
- `coverage` 指向一个位图，标明哪些瓦片存在。运行时用它区分"没有数据"和"加载失败"，不得对不存在的瓦片发请求。
- `attribution` 必填，运行时默认显示署名，关闭显示时开发者自行承担署名义务（文档须说明）。
- 对应的 JSON Schema 位于 `schemas/tileset.schema.json`，类型位于 `packages/tiles`。

## 5. 瓦片载荷

### 5.1 容器

小端字节序的二进制容器：

| 部分 | 内容 |
| --- | --- |
| 文件头 | 魔数（4 字节）、格式版本（主、次）、瓦片 z/x/y、内容档案、层数、层目录偏移 |
| 层目录 | 每层的名称 ID、编码类型（`features` 或 `mesh`）、字节偏移与长度、要素数量 |
| 字符串表 | 去重后的标签键值和枚举名 |
| 各层数据 | 按层目录顺序排列，每层可独立解码 |

要求：

- 只读取文件头和层目录即可知道每层大小，支持跳过不需要的层。
- 所有偏移 4 字节对齐，使解码可以直接在 `ArrayBuffer` 上建立类型化数组视图而不拷贝。
- 未知的层名称或未知的次版本字段必须能被安全跳过；未知的主版本拒绝解码。
- 具体字节布局由 WP-B 确定并写入本文件第 9 节"字节布局"（实现时补充），同时提供一个不依赖本项目代码的参考解码说明，方便第三方在其他引擎中读取。

### 5.2 坐标量化

- 水平坐标：瓦片局部米，16 位有符号整数，分辨率 1/32 m（约 3 cm），可表示范围约 ±1,024 m。L0 瓦片分辨率为 1/8 m，范围约 ±4,096 m。
- 垂直坐标：16 位无符号整数，分辨率 1/16 m，范围 0 到约 4,096 m，带一个每层的基准偏移以支持负高度（下沉道路）。
- 归属本瓦片但超出瓦片边界的对象（例如跨界的大型建筑）必须仍落在可表示范围内；超出时构建期报诊断并把该对象改为烘焙网格层的 32 位浮点编码。
- 量化引入的误差不得超过 5 cm；共享边界上的顶点，两侧瓦片量化后的墨卡托位置必须一致。

### 5.3 规划要素层（`features`）

每个要素包含：

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定身份。OSM 对象用类型加 64 位 ID；生成对象用来源 ID 加序号 |
| `renderId` | 瓦片内唯一的整数，供拾取使用 |
| 几何 | 多边形（外环加内环）、折线或点。折线和点可带逐顶点高程 |
| 属性 | 按层定义的定长字段和字符串表引用 |
| 来源等级 | 对每个可推断属性各占 2 位：`observed`、`derived`、`inferred` |

各层属性（最小集合，可向后兼容地增加）：

| 层 | 几何 | 属性 |
| --- | --- | --- |
| `building` | 多边形 | `height`、`minHeight`、`levels`、`roofShape`、`roofHeight`、`roofDirection`、`facade`（立面语法 ID 与参数种子）、`usage`、`partOf`（所属建筑 ID）、`materialHint` |
| `road` | 带高程的折线 | `class`、`width`、`lanes`、`surface`、`bridge`、`tunnel`、`layer`、`oneway` |
| `structure` | 带高程的折线 | `kind`（桥板、楼梯、护栏、桥墩）、`width`、`thickness` |
| `water` | 多边形 | `kind` |
| `green` | 多边形 | `kind`（公园、草地、森林等） |
| `tree` | 点 | `shape`、`height`、`crown`、`leafType` |
| `ground` | 多边形 | `kind`（铺装、人行道、广场等），可带逐顶点高程 |

说明：

- 道路的路面和路口形状需要跨对象布尔运算，属于构建期工作。结果写入 `ground` 层（带逐顶点高程的多边形）或烘焙网格层；`road` 层保留中心线用于拾取、样式和 L0。
- L1 建筑的可选字符串列 `wallLengths` 保存会影响墙顶装饰条或入口雨棚选择的投影原始边长。值为 JSON 三元组数组 `[[ringIndex, edgeIndex, metres], ...]`。环和边按生成器规范化后的顺序编号（外环逆时针、内环顺时针）。仅在量化使选择翻转时写入，旧瓦片按解码后的边长计算。立面几何的坐标始终来自瓦片网格。
- 保留对开发者有用的原始标签（`name`、`building`、`highway`、`amenity` 等），清单由 `tileset.json` 的 `attributes` 声明。不保留全部标签，以控制体积。

### 5.4 烘焙网格层（`mesh`）

用于地标、无法量化的超界对象、以及按 01 第 2 节规则回退为烘焙的对象类型。

- 顶点位置按 5.2 量化（或在声明中标记为 32 位浮点），法线用八面体编码压到 2 字节，索引按顶点数选 16 或 32 位。
- 每个子网格带 `materialRole`、`featureId`、`renderId` 范围，以及风格层需要的程序着色属性（沿用一期 `facade-v6` 属性契约）。
- 是否进一步采用通用网格压缩算法由 WP-B 的度量任务决定，标准是"解码耗时与体积的综合收益"，结果记入 08。

## 6. 体积预算

所有数字为 gzip 压缩后的传输体积。

| 档案 | 中位数 | 第 95 百分位 | 硬上限 |
| --- | --- | --- | --- |
| L1 `full`（缩放 16） | ≤ 60 KB | ≤ 250 KB | 1 MB |
| L0 `massing`（缩放 14） | ≤ 40 KB | ≤ 150 KB | 500 KB |

- 超过硬上限的瓦片，构建期必须报 `TILE_OVER_BUDGET` 诊断，并按顺序降级：先去掉可选标签，再把烘焙层改为要素层（若可行），仍超限则保留并在报告中列出。不得静默丢弃对象。
- 度量基准：一期的北京国贸和京都祇园两个 9 块样本，转换后的总体积应分别不超过 4 MB 和 12 MB（一期为 110.6 MB 和 296.9 MB）。达不到时须在 08 说明原因再继续。

## 7. 解码接口

`packages/tiles` 导出（签名为契约，内部实现自由）：

~~~ts
export interface TileId { z: number; x: number; y: number }
export interface Tileset { /* 第 4 节的字段 */ }
export interface DecodedTile {
  id: TileId;
  profile: 'massing' | 'full';
  layers: Record<string, FeatureLayer | MeshLayer>;
}
export function validateTileset(json: unknown): ValidationResult<Tileset>;
export function encodeTile(tile: DecodedTile): Uint8Array;
export function decodeTile(buffer: ArrayBuffer, options?: { layers?: string[] }): DecodedTile;
export function tileToLngLatBounds(id: TileId): [number, number, number, number];
export function lngLatToTile(lng: number, lat: number, zoom: number): TileId;
export function metersPerMercatorUnit(lat: number): number;
~~~

- `decodeTile` 是同步、纯函数，不做网络访问，可在 Worker 中调用。
- `ValidationResult` 与诊断结构沿用一期 `src/core/index.d.ts` 中的定义（`code`、`stage`、`message`、`hint`）。

## 8. 验收要点

对应 09 中的 AC201–AC209。摘要：

- 编码后解码的往返结果与输入逐字段相等（量化字段在量化网格上相等）。
- 损坏或截断的输入给出结构化错误，不崩溃、不死循环。
- 两个样本的体积达到第 6 节的度量基准。
- 同一要素在相邻瓦片共享边界上的顶点，换算回墨卡托后的差为 0。
- 第三方参考解码说明足以让不读本项目源码的人解析出建筑轮廓和高度（由独立审查 agent 按说明写一个最小解码脚本来验证）。

## 9. 字节布局

格式版本 1.0，由 WP-B 于 2026-11-12 冻结。参考实现：`packages/tiles/src/codec.ts`；不依赖本项目的最小参考解码器：`packages/tiles/examples/reference-decode.mjs`。本节足以独立实现解码器，不需要阅读源码。

### 9.1 通用约定

- 全部整数和浮点数为**小端**。`u8/u16/u32` 为无符号整数，`i8/i16/i32` 为有符号整数，`f32` 为 IEEE-754 单精度。
- 所有偏移都是相对文件开头的字节偏移。文件头、层目录、字符串表、每个层、每个分节的数据都从 4 字节对齐的位置开始；不足 4 字节的末尾用 0 填充，填充字节不计入声明的长度。
- 未知层（编码类型不认识）、未知分节代码、更高的次版本号：读者必须跳过，不得报错。主版本号不等于 1：读者必须拒绝。
- "缺失值"约定：`f32` 用 NaN，`i32` 用 `-2147483648`，`u32` 与字符串引用用 `0xFFFFFFFF`。

### 9.2 文件头（44 字节，偏移 0）

| 偏移 | 类型 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | u8×4 | magic | `43 33 54 01`（ASCII `C3T` 加 0x01） |
| 4 | u16 | major | 主版本，当前 1 |
| 6 | u16 | minor | 次版本，当前 0 |
| 8 | u16 | headerBytes | 文件头长度，当前 44；读者以此跳过未来新增的头字段 |
| 10 | u8 | profile | 0 = `massing`，1 = `full` |
| 11 | u8 | extentLog2 | 量化网格：每块瓦片边长 = 2^extentLog2 个网格单位（见 9.6） |
| 12 | u8 | z | 缩放级别 |
| 13 | u8 | reserved | 0 |
| 14 | u16 | layerCount | 层数 |
| 16 | u32 | x | 瓦片列号 |
| 20 | u32 | y | 瓦片行号（XYZ，y 向南增大） |
| 24 | u32 | directoryOffset | 层目录起点 |
| 28 | u32 | stringsOffset | 字符串表起点 |
| 32 | u32 | stringsLength | 字符串表总长（含填充） |
| 36 | u32 | totalLength | 整个文件的长度；实际收到的字节少于它即为截断 |
| 40 | u16 | directoryEntryBytes | 每个目录项的长度，当前 20 |
| 42 | u16 | reserved | 0 |

### 9.3 层目录（layerCount × directoryEntryBytes 字节）

层按名称的 UTF-16 码元顺序排列。

| 偏移 | 类型 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | u32 | name | 层名在字符串表中的序号 |
| 4 | u8 | encoding | 1 = 规划要素层（`features`），2 = 烘焙网格层（`mesh`），其他值跳过 |
| 5 | u8 | geometry | 要素层：1 多边形，2 折线，3 点；网格层为 0 |
| 6 | u16 | reserved | 0 |
| 8 | u32 | offset | 层数据起点（4 字节对齐） |
| 12 | u32 | length | 层数据长度 |
| 16 | u32 | featureCount | 层内要素数 |

只读文件头和层目录即可知道每层的位置和大小，可以只取需要的层。

### 9.4 字符串表

| 内容 | 类型 |
| --- | --- |
| count | u32 |
| offsets | u32 × (count + 1)，第一个为 0，单调不减；相对字符串数据起点 |
| data | UTF-8 字节，字符串 i 占 `[offsets[i], offsets[i+1])` |

字符串按 UTF-16 码元顺序排列并去重。层名、属性名、字符串属性值、标签键值、来源等级键、材质角色、顶点属性名都通过序号引用这里。

### 9.5 层

层数据以 16 字节的层头开始：

| 偏移 | 类型 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | u32 | featureCount | 与目录一致 |
| 4 | u8 | encoding | 与目录一致 |
| 5 | u8 | geometry | 与目录一致 |
| 6 | u8 | flags | 网格层：bit0 = 1 表示位置为 f32 |
| 7 | u8 | reserved | 0 |
| 8 | f32 | baseElevation | 高程基准（米），是 1/16 m 的整数倍 |
| 12 | u32 | sectionCount | 分节数 |

层目录的 `offset` 指向这个层头；第一个分节紧接在层头之后（层起点 + 16）。随后是 `sectionCount` 个分节，每个分节为 8 字节的分节头加数据；下一个分节从 `数据起点 + byteLength 向上取整到 4 的倍数` 处开始。分节顺序不作约定，读者按代码识别。同一代码只出现一次，ATTRIBUTE（12）与 VERTEX_ATTRIBUTE（27）除外，每个属性一个分节。

| 偏移 | 类型 | 字段 |
| --- | --- | --- |
| 0 | u16 | code（分节代码） |
| 2 | u16 | reserved |
| 4 | u32 | byteLength（数据长度，不含填充） |
| 8 | … | 数据，之后填充到 4 字节对齐 |

下表中 n 为要素数，P 为部分数，R 为环数，V 为顶点数，T 为标签数。

| 代码 | 名称 | 内容 | 层 |
| --- | --- | --- | --- |
| 1 | ID_TYPE | u8 × n：0 node，1 way，2 relation，3 generated | 两种 |
| 2 | ID_LO | u32 × n：64 位 ID 的低 32 位 | 两种 |
| 3 | ID_HI | u32 × n：64 位 ID 的高 32 位 | 两种 |
| 4 | ID_SEQ | u32 × n：0 表示无序号；k > 0 表示生成对象，身份写作 `type/id#(k-1)` | 两种 |
| 5 | RENDER_ID | u32 × n：瓦片内唯一的拾取 ID | 两种 |
| 6 | PART_START | u32 × (n+1)：要素 i 的部分为 `[PART_START[i], PART_START[i+1])` | 要素层 |
| 7 | RING_START | u32 × (P+1)：部分 p 的环为 `[RING_START[p], RING_START[p+1])` | 要素层 |
| 8 | VERTEX_START | u32 × (R+1)：环 r 的顶点为 `[VERTEX_START[r], VERTEX_START[r+1])` | 要素层 |
| 9 | POSITIONS | i16 × 2V：网格坐标 (x, y)，交错存放 | 要素层 |
| 10 | ELEVATION | u16 × V：高程 = baseElevation + 值 / 16 米（只在带高程的层出现） | 要素层 |
| 11 | PROVENANCE | u32 × n：第 k 个来源键占 bit 2k..2k+1；0 未记录，1 observed，2 derived，3 inferred | 两种 |
| 12 | ATTRIBUTE | u32 属性名序号，u32 类型（0 f32，1 i32，2 u32，3 字符串序号），随后 n 个 4 字节值；每个属性一个分节 | 两种 |
| 13 | TAG_START | u32 × (n+1)：要素 i 的标签为 `[TAG_START[i], TAG_START[i+1])` | 两种 |
| 14 | TAG_KEYS | u32 × T：字符串序号 | 两种 |
| 15 | TAG_VALUES | u32 × T：字符串序号 | 两种 |
| 16 | PROVENANCE_KEYS | u32 × k（k ≤ 16）：来源键名的字符串序号，顺序即 PROVENANCE 的槽位 | 两种 |
| 20 | MESH_POSITION_Q | i16 × 2V：(x, z) 网格坐标 | 网格层 |
| 21 | MESH_HEIGHT_Q | u16 × V：y = baseElevation + 值 / 16 米 | 网格层 |
| 22 | MESH_POSITION_F32 | f32 × 3V：(x, y, z) 瓦片局部米 | 网格层（flags bit0） |
| 23 | MESH_NORMAL_OCT | i8 × 2V：八面体编码法线，分量 / 127 | 网格层 |
| 24 | MESH_INDEX16 | u16 × I：三角形索引 | 网格层 |
| 25 | MESH_INDEX32 | u32 × I：三角形索引（顶点数超过 65,535 时） | 网格层 |
| 26 | SUBMESHES | 每个子网格 4 个 u32：材质角色序号、要素序号、索引起点、索引数 | 网格层 |
| 27 | VERTEX_ATTRIBUTE | u32 名称序号、u32 分量数，随后 f32 × 分量数 × V（如 `facade-v6` 属性） | 网格层 |
| 28 | VERTEX_FEATURE16 | u16 × V：每个顶点所属要素序号 | 网格层 |
| 29 | VERTEX_FEATURE32 | u32 × V：同上（要素数超过 65,535 时） | 网格层 |

PART_START、RING_START、VERTEX_START 中的值都是层内全局序号：要素 i 的第一个部分的第一个环是 `RING_START[PART_START[i]]`，其顶点为 `[VERTEX_START[r], VERTEX_START[r+1])`。

要素层中，多边形的每个部分为"外环 + 若干内环"；折线的每个部分只有一个环；点要素一个部分、一个环、一个顶点。外环和内环的方向不作约定；环不重复首点（闭合是隐含的）。ID 以十进制书写，即 `hi × 2^32 + lo`。同一瓦片内层名唯一。f32 属性值按存储原样读出，不做额外舍入。

### 9.6 坐标

**水平。** 设瓦片 (z, x, y)，`E = 2^extentLog2`（L1 默认 2^14，L0 默认 2^15）。网格坐标 (qx, qy) 对应的归一化墨卡托坐标（0 到 1，原点西北角，y 向南）为：

~~~text
mx = (qx + x·E + E/2) / 2^(z + extentLog2)
my = (qy + y·E + E/2) / 2^(z + extentLog2)
~~~

即网格原点在瓦片中心。经纬度：`lng = mx·360 − 180`，`lat = atan(sinh(π·(1 − 2·my)))·180/π`。

瓦片局部米（x 向东、z 向南）：`x = qx · s`，`z = qy · s`，其中 `s = 40075016.686 · cos(瓦片中心纬度) / 2^(z + extentLog2)`。L1 在北纬 40° 处 s ≈ 2.9 cm，量化误差不超过 s/2。

由于网格是全局对齐的，同一点在相邻两块瓦片中量化后换算回墨卡托坐标完全相同（AC203）。int16 的表示范围为 ±32,767 个网格单位，即 L1 约 ±2 块瓦片宽、L0 约 ±1 块瓦片宽；超出时必须改用网格层的 f32 编码（决策 E2）。

**垂直。** 高度以 1/16 m 为单位存为 u16，加上层头的 baseElevation，范围为基准以上约 4,096 m。

### 9.7 读取建筑轮廓与高度的最小步骤

1. 校验 magic 与 major；读 z、x、y、extentLog2。
2. 读字符串表。
3. 在层目录中找到名称为 `building` 的层。
4. 遍历该层的分节，取 PART_START、RING_START、VERTEX_START、POSITIONS，以及名称为 `height` 和 `minHeight` 的 ATTRIBUTE 分节（f32）。
5. 对要素 i：部分 `PART_START[i]` 的第一个环是外轮廓；按 9.6 把每个 (qx, qy) 换成经纬度；高度为 `height[i]`（NaN 表示缺失）。
