# A 默认预算几何修复：集成契约

基线 dee3cc8，分支 codex/phase1-core-repair，2026-11-03。不改 SDK/runtime、CLI 或 source/style 参数契约。原 core 分支保留。

## 真实资产改动

core generator 由1.0.0升至1.1.0，CINK/manifest schemaVersion仍为1。需重建场景资源，不得继续用旧缓存进行性能验收。

- low：普通 footprint 以15 cm有界闭环简化，联合验证外环、洞和自交，失败回退原环；邻接建筑复用原共享envelope去掉被邻体遮住的内部面，保留全部暴露面、洞、高度与源身份；仅地面附着建筑不提交向下底面，悬空分部保留底面。官方地标截面与央视倾斜/连接保持。每树为闭合4面冠+4面干，保留原实例变换/颜色/身份。低级不投射阴影；中/高级继续投射阴影。
- 全区一次规划后，low对道路支持面按2 mm有界高度平面union再三角化，普通道路边界4 mm、桥壳边界2 mm有界简化且检查联合拓扑。车道油漆、推断斑马线和推断边饰留给medium/high；所有观测车道/步道、水域、原有地表及建筑仍完整存在。地面各档复用相同的共享50m世界格网，再按块边界裁切；道路top、水域和桥壳也按每块物理格域裁切，避免不同三角剖分的质心归属在混合LOD下造成空洞/重叠。原子建筑/地标/树保持整组归属，contentBounds仍覆盖它们的越界部分，不生成重叠独立底座。
- 桥梁保留每个源way的完整slab footprint、侧壁、底面和所有原支撑，按top与bottom两组高度平面的联合约束合并采样块；底面保留原高度/clamp分片，侧壳复用同一ring边界，不再独立做9mm简化。T结点先切分再移除内部重复侧面。此结构壳在所有LOD共用，保证跨档物理覆盖；台阶tread/risers也在各档共用，避免横跨块边界的不同高度表现。栏杆仅合并同源连续段，保留真实间断和拐弯，low/medium以双面带状主轮廓代替逐段封闭盒。楼梯保留源路径、宽度、端点平台、高程与台阶/risers；low/medium仅将扶手细化为连续带，high恢复原扶手立柱/附件。
- low及medium对兼容静态主体合批，保留所有顶点程序属性、cityFeature、cityMaterialRole、材质groups与来源。顶点只按全部属性精确相等索引，不以舍入值焊接接缝。外部recipe与任意多材质对象跳过合批、保留原角色/材质次序。树实例按相同几何/材料prototype合批，保留species的中景尖冠。

地形仍是平地、道路高程仍为规则推断。以上为合法几何/阴影LOD分配，不提高600k/1200默认整帧预算，不隐藏必要建筑或地标。高精度建筑与细节保持原构建；桥壳按上文共同几何处理，方便混合LOD与GLB完整对照。

## 向后兼容的成本字段

`sceneStats`、LOD描述符、drawUnits增加 `shadowTriangles` / `shadowDrawCalls`。描述符/单元字段对旧包可选；有字段时必须是整体triangles/drawCalls的子集，单元之和必须精确等于LOD caster成本。字段反映真实castShadow标记及实际geometry/groups/instances，尚未做光源视锥剔除。单位字段各自独立可选且始终校验；缺aggregate时允许合法的部分unit字段，总字段存在则要求完整unit和一致sum。运行时共享drawUnitsError即使没有drawUnits也校验LOD成本。decodeChunk按实际Mesh.castShadow与geometry核对汇总以及所有已提供的unit成本，拒绝自洽但虚假的零成本；无字段旧包继续兼容。

类型和schemas/scene.schema.json已同步。D可用正常场景pass成本和caster成本分别预算；不得把draw倍率同时乘到triangles，或凭空认定4pass统计是GPU证据。low的两个caster字段恒为0，实际编码Mesh.castShadow也为false。完整实际WebGL/12案60秒性能与五轮往返由E在统一集成提交串行复验。

只有内部road生成器作兼容增加：buildRoadSurface的plan附带它本来就求解的structures；road-stairs导出其既有normaliseFlight/section/rampHeight供核心共用，不重新求解每个tile道路。旧默认演示行为不改。

地面附着普通建筑的far底面不再存在，因此既有role回归改为low要求wall/roof，medium/high仍要求structure；独立新增回归明确悬空分部的underside不可删除。没有删去角色协议或降低浮空形体完整性要求。

临时生成物在 ignored work/core-repair-*；后续交接附全12案成本、几何/身份连续性验证和独立审查。本文的四通道成本上界是CPU几何提交可行性依据，不是最终AC18放行。


## 近景数量字段（A/D冻结）

LOD增加可选`nearDetails`：可见/激活的完整chunk组内，`lodRole=detail`或`near`的普通Mesh计1、InstancedMesh计实际count，保守不按相机frustum进一步切分。无per-unit near字段。compiler的sceneStats与runtime.measureGroup同义，descriptor输出真实值；validator/types/Schema同步，decodeChunk校验实际资源数量。旧manifest缺省仍合法，D需采用已解码缓存实际数优先、再metadata、最后旧未知0并在加载后校正。

standby不可见时不占活跃near计数，但其bytes仍由D的ResourceRegistry引用统计保留。SDK附件只能分配`max(0,budget.nearDetails-mainActualNearDetails)`；主体不足时完整LOD降级，不能通过删必要城市对象或提高18000默认数量来过关。本分支不改任何SDK/runtime文件。

## 分块验证口径更新

连续表面现在会在格网边界增加插值顶点，因此固定1/4/16不再要求切分后triangle列表SHA完全一致；原子建筑/实例几何、featureIndex世界身份仍要求一致。连续面改用实际世界坐标覆盖/高程与混合LOD53种图案验证，不能只检查纯档位hash。普通/多材质/反射/实例与父Group非零变换也在1/4/16检验world bounds，boundsOf和partition明确强制更新world matrix。完整复验与12案预算摘要在最终handoff提供；中间成本数不作为最终放行。

## 最终平面/栏杆成本修复

道路和桥梁的平面分组使用多个固定候选模型；新三角形的全部原始顶点均须满足最大2 mm高度误差（桥梁同时检查top/bottom），才可并入。仿射误差在整个原三角形内有界；不逐次拟合漂移。普通low道路外环简化上限4 mm，桥壳各档仍为2 mm，拓扑联合检查失败则回退。两个相邻拟合平面共用XZ边且上下高度均相差不超过4.01 mm时，只有相反朝向的共同边才删除内部侧皮；同向重合外边保留一份完整竖向包络（top最大值、bottom最小值），不能删除外侧面。保留完整底面和真实高度台阶，接缝要求仍为1 cm。

low/medium的细步行/楼梯扶手以一枚双面三角面保留两端完整上缘和中央下缘；厚车行护栏仍为双三角面带。细杆下缘的最大抽象误差为6.5 cm，high保持原封闭杆体和立柱。树仍为闭合4面干+4面冠；不删除树干底面或缩减树对象。原子建筑/地标分块直接复用完整几何，保留外部任意材质groups和属性，减少逐顶点复制开销。

独立审查补充的单mesh认领multipart情形保持全部`featureIds`成员，不能把认领集合缩成primary；每个成员的`chunkIds`均指向同一原子owner。独立审查补充的相近高度同向叠桥情形保留外侧面，已有专门回归。

## 极小有符号坐标的候选块修复

根最终复验发现原候选块通过`grid.at`的`(value-origin)/width`计算时，约±1e-17的有效world坐标会在减去origin时舍入到同一正侧cell；后续严格物理边界裁切却仍区分正负，造成32m²外墙仅输出16m²，某些单侧变体甚至全部丢失。high护栏真实端盖也因此少0.471798m²。

`3b62b40`仅将共享表面的候选行列查找改为直接对实际cell下界planes做upper-bound二分，和clip使用同一world坐标及同一边界数值。精确落在内边界的竖面归属半开区间的唯一cell；真实微倾跨界面包含两侧候选。原属性插值、严格裁切、材质groups与退化判定不变，不增加epsilon。原子对象仍整组归属，不受此改动影响。永久回归覆盖54组signed微小坐标/精确边界/两种墙轴向/1-4-16切法，以及真实high护栏总面积与每个源面中心的同向最近面覆盖。
