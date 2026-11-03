# A 默认预算几何修复：集成契约

基线 dee3cc8，分支 codex/phase1-core-repair，2026-11-03。不改 SDK/runtime、CLI 或 source/style 参数契约。原 core 分支保留。

## 真实资产改动

core generator 由1.0.0升至1.1.0，CINK/manifest schemaVersion仍为1。需重建场景资源，不得继续用旧缓存进行性能验收。

- low：普通 footprint 以15 cm有界闭环简化，保留高度、洞、源身份；仅地面附着建筑不提交向下底面，悬空分部保留底面。官方地标截面与央视倾斜/连接保持。每树为闭合6面冠+4面干，保留原实例变换/颜色/身份。低级不投射阴影；中/高级继续投射阴影。
- 全区一次规划后，low对道路支持面按同一高度平面union再三角化。车道油漆和推断边饰留给medium/high；所有观测车道/步道、水域、原有地表及建筑仍完整存在。完整地面由两共享世界三角形覆盖，contentBounds继续承担跨格网加载，不生成独立重叠底座。少数仅有高阶细节的格网可包含合法的空low资源，其物理地面由共享越界资产覆盖。
- 桥梁保留每个源way的完整slab footprint、侧壁、底面和所有原支撑，合并采样块；外边界按三维9 mm误差约束精简。栏杆仅合并同源连续段，保留真实间断和拐弯，low/medium以双面带状主轮廓代替逐段封闭盒。楼梯保留源路径、宽度、端点平台和高程，以连接坡壳与连续扶手表示；high恢复原台阶/立柱/附件。
- low及medium对兼容静态主体合批，保留所有顶点程序属性、cityFeature、cityMaterialRole、材质groups与来源。顶点只按全部属性精确相等索引，不以舍入值焊接接缝。树实例按相同几何/材料prototype合批，保留species的中景尖冠。

地形仍是平地、道路高程仍为规则推断。以上为合法几何/阴影LOD分配，不提高600k/1200默认整帧预算，不隐藏必要建筑或地标。高精度geometry保持原构建，方便近景和GLB完整对照。

## 向后兼容的成本字段

`sceneStats`、LOD描述符、drawUnits增加 `shadowTriangles` / `shadowDrawCalls`。描述符/单元字段对旧包可选；有字段时必须是整体triangles/drawCalls的子集，单元之和必须精确等于LOD caster成本。字段反映真实castShadow标记及实际geometry/groups/instances，尚未做光源视锥剔除。

类型和schemas/scene.schema.json已同步。D可用正常场景pass成本和caster成本分别预算；不得把draw倍率同时乘到triangles，或凭空认定4pass统计是GPU证据。low的两个caster字段恒为0，实际编码Mesh.castShadow也为false。完整实际WebGL/12案60秒性能与五轮往返由E在统一集成提交串行复验。

只有内部road生成器作兼容增加：buildRoadSurface的plan附带它本来就求解的structures；road-stairs导出其既有normaliseFlight/section/rampHeight供核心共用，不重新求解每个tile道路。旧默认演示行为不改。

地面附着普通建筑的far底面不再存在，因此既有role回归改为low要求wall/roof，medium/high仍要求structure；独立新增回归明确悬空分部的underside不可删除。没有删去角色协议或降低浮空形体完整性要求。

临时生成物在 ignored work/core-repair-scenes；后续交接附全12案成本、几何/身份连续性验证和独立审查。本文的四通道成本上界是CPU几何提交可行性依据，不是最终AC18放行。
