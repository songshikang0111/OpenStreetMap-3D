# 一期规划：本地城市生成工具链与 Web SDK

日期：2026-11-03。状态：经讨论确定的一期实施基线；本文中的新命令、接口和目录是待实现的交付契约，不代表当前版本已经支持。

## 1. 产品目标与范围

开发者通过统一工具搜索地点、下载真实地图数据，在本地生成可定制风格的城市场景；既能立即预览，也能保存成可复现项目，并通过 Web SDK 集成到自己的应用。项目维护者提供代码、规则、工具和参考实现，不运营地图、构建或推理服务器。

一期必须交付：

1. 本地工作台：搜索地点、指定范围、下载、生成、预览、调风格、保存与重新打开项目。
2. 标准化 CLI：初始化、地点解析、数据获取、本地导入、构建、批处理、恢复、验证、预览、导出与规则更新。
3. Web SDK：加载预构建场景、相机与对象交互、可插拔风格、分块加载、资源回收及性能统计。
4. 可复现城市项目与 Web 场景包；完整静态演示站点导出；PNG 与 GLB 辅助导出。
5. 官方地标生成配方库：中国尊、央视从既有特判迁移，支持外部配方及独立版本更新。
6. 有限连续区域的正确分块，以及真实减少绘制、传输和驻留资源的 LOD；以测量确定支持范围。
7. 对 AI agent 友好的类型、Schema、结构化诊断、最小例子、任务文档与独立验收证据。

一期专注 Three.js / WebGL 2 浏览器。Node 用于本地工具链和离线构建。优先验证当前 Windows 环境，同时保持路径、进程和 CLI 设计可移植；未实测的平台必须标记未验证。

后置：Unity/Godot/Unreal 适配、原生移动 SDK、全球无限地图、任意超大区域的分布式构建、完整 DEM、测绘级还原、交通模拟/碰撞/导航系统、运行时任意访客现场生成全球地点、MCP 包装与在线插件市场。区域 PBF 自动选择、下载、裁剪作为后续数据源扩展；一期必须先实现可用的小范围下载和本地标准数据导入，不得假称支持 PBF。

原创代码与配方沿用 MIT；OSM 数据保持 ODbL 与署名，第三方参考图与截图单独注明权利范围。仓库现名可以保留，产品文案逐步使用通用“城市线境 / City Ink”；包名须发布前确认，不在本轮注册或发布远端包。

## 2. 当前基线与差距

规划基线为 main 的 164af05。当前有北京国贸、领秀新硅谷、上海、京都、阿姆斯特丹、束河、拜伯里、曼哈顿、马拉喀什、悉尼的独立样本。2026-11-03 本次重新执行 npm test：138/138 通过；npm run build 成功，有 Three.js 分包超过 500 kB 的既有提示。

可复用资产：OSM 关系与分部解析、局部米制投影、确定性生成、建筑/道路/场地/植被规则、来源标记、漫画渲染、Node 几何审计与既有回归测试。采用逐步抽取，不整体重写。

主要差距：

- src/main.js 是演示应用入口，尚无稳定公共 SDK、工作台后端或统一 CLI。
- src/city.js 混合建模、Three.js 网格、颜色和着色器设置；四种显示模式尚非独立风格包。
- 下载器面向小范围定制 JSON；缺少缓存、恢复、统一诊断和搜索入口。
- 每份数据默认使用自己的投影中心；道路、水域按各自 bbox 处理，尚无可靠连续分块。
- 中国尊和央视已是程序化生成，但选择规则和实现仍嵌在核心中。
- 当前远窗过滤、树木局部细节 LOD、屋顶细节衰减有价值，但不等于大区域流式渲染。屋顶顶点缩到锚点并不消除这些顶点的提交与驻留；所有建筑主体仍在场景中。
- 现有 GLB 保存几何与支持的基础材质，不携带完整漫画后处理、程序窗格或特殊玻璃效果。

规划与验收不得将旧截图评分、Node 构建耗时或无 NaN 检查解释为 GPU 性能、真实性或全地区可用性证明。

## 3. 用户场景与完整流程

### U1：第一次试一个地点

安装依赖后运行 city studio，打开仅绑定本机的工作台。内置一个小型离线样例，首次试用不依赖外部服务。

流程：输入地址/地标/坐标/OSM 对象链接 → 展示地点候选 → 用户选定 → 调整半径或 bbox → 下载与校验 → 快速预览 → 改画风和质量 → 保存项目。

要求：

- 已知官方地标可从本地配方索引定位。一般地址使用可切换地理编码适配器，输入查询只负责定位，不把地名当作最终可复现区域。
- 重名、未找到、服务限流、没有建筑数据分别解释，不能静默换地点或虚构实测模型。
- 预览展示阶段进度、取消、重试与来源统计；耗时构建放在本地工作进程/线程，不阻塞工作台界面。
- 首次默认小范围与较低细节；允许提高质量，明确预计资源与区域限制。
- 显示高度来源、推断比例、缺失关系、地标规则命中和不支持的形体。
- 保存时将明确区域、数据快照、种子、规则/风格版本、相机一起固化。

### U2：从预览转为自己的 Web 项目

工作台“保存项目”后，用 city build 生成场景包。开发者可选择：

1. 通过 Web SDK 在自己的网页中加载 manifest，使用自定义 UI、相机、点击事件和风格。
2. 导出带查看器和本地资源的静态网站，自行部署。
3. 导出 PNG 或 GLB；GLB 的材质与效果边界必须在 UI 和文档说明。

工作台和嵌入示例必须使用同一 SDK、场景包和风格接口，不维护两套独立生成逻辑。生产网页加载预构建资源，不要求访客安装 CLI 或访问开发者的本地工作台服务。

### U3：分散地点批处理

输入项目列表，逐个或按受控并发下载/构建。每个地点是独立场景，无须连接北京和京都。输出每项状态、结果路径、失败原因；允许单项重试和断点续作。部分成功必须明确报告，不能以退出码 0 伪装全部成功。

### U4：连续区域与相机移动

用户选择一片连续区域。工具在同一项目内统一解析和规划，再生成可加载的块；用户不负责手工摆放 GLB、修道路或消除重复建筑。SDK 根据视野和预算加载、升级、降级、卸载块，始终保留合理的远景表示。

一期支持有限区域；先以现有小范围快照验证 1、4、9 块覆盖，以及固定范围不同切块方式。范围上限按实际距离与资源预算校验，默认小街区；不把公开 API 请求大量切片以绕过服务限额。

### U5：改风格、改地标与刷新数据

- 仅材质、配色、光照、后处理变化：尽量实时应用。
- 改几何、密度、推断规则：明确哪些构建阶段需要重做。
- 更新地标库：检查兼容性，写锁文件，重建受影响对象与依赖阶段；保留回退版本。
- 刷新 OSM：独立显式动作，记录新快照；普通 build 不隐式刷新网络数据。
- 外部风格、地标配方和生成器可在项目目录维护，允许显式覆盖官方规则。

## 4. 交付物与项目目录

| 交付物 | 一期定义 | 必须演示 |
| --- | --- | --- |
| CLI | 一个入口串起工具链，所有主要命令支持 help 和 JSON 输出 | 从样例/下载到构建、验证、预览 |
| 本地工作台 | 搜索、范围、任务、预览、配置、保存/打开项目 | 新用户完整试用与中断恢复 |
| Web SDK | 浏览器公共入口与类型声明，不绑定现有 DOM ID | 独立最小应用加载自己的场景 |
| 城市项目 | 输入、配置、锁文件、本地规则、状态 | 关闭重开、离线重建与版本回退 |
| Web 场景包 | 清单、版本化分块、几何/实例/语义/材质角色和风格属性 | 脱离源工程加载且画风正确 |
| 官方地标库 | 配方、生成器引用、匹配索引、版本与兼容范围 | 两个已有地标迁移与更新测试 |
| 风格包 | 语义材质绑定、后处理、参数定义和兼容声明 | 官方画风与独立外部风格 |
| 静态站点 | 查看器、SDK、风格和场景资源全部本地打包 | 非根路径托管与断外网加载 |
| 开发者资料 | 架构、扩展教程、CLI/API、故障诊断、支持矩阵 | agent 按文档完成最小扩展 |

建议用户项目布局（由工具创建）：

~~~text
my-city/
  city.config.json
  city.lock.json
  data/                       # 原始下载及规范化数据，含来源
  rules/                      # 用户配方或生成器
  styles/                     # 用户风格
  .city-cache/                # 可重建缓存与任务状态
  dist/
    manifest.json
    chunks/
    metadata/
    attribution.json
  site/                       # 可选静态查看器导出
~~~

Web 场景包不是多个普通 GLB 的简单集合：必须保留程序化材质、对象 ID、来源、LOD 与材质重新绑定所需信息。生成物不提交为官方地标模型库；小型 fixture 和必要截图证据可保留，完整缓存和产物排除在 npm 包与 Git 之外。

## 5. 逻辑架构

~~~mermaid
flowchart TD
  UI[本地工作台] --> JOB[本地任务服务]
  CLI[CLI] --> JOB
  JOB --> LOC[地点解析与数据源适配]
  LOC --> RAW[缓存与标准地图数据]
  RAW --> CORE[统一坐标与城市语义规划]
  RECIPE[地标配方与生成器] --> CORE
  CORE --> BUILD[几何与多级细节构建]
  BUILD --> PACK[Web 场景包与来源清单]
  PACK --> SDK[Web SDK 分块加载与资源预算]
  STYLE[风格包] --> SDK
  SDK --> UI
  SDK --> APP[开发者网页与静态查看器]
~~~

三者共享配置与管线：CLI 调用核心任务函数，工作台通过本地 HTTP 服务调用同一任务，SDK只负责运行时资产与交互。构建不要求浏览器/GPU；浏览器不负责重新求解整个城区的道路和地表布尔运算。

保留 Three.js 作为一期的几何/渲染依赖，不为尚未支持的引擎设计大而全抽象。公共城市语义、配方、场景清单需可序列化且有版本；已有解析结果中的函数不能直接当 JSON 协议。

## 6. 标准化数据能力

### 6.1 地点解析

接受查询字符串、明确经纬度、OSM 类型/ID、官方地标 ID；输出候选 id、displayName、lat、lon、可选 bbox、source。选中后保存明确坐标和范围。默认候选服务可使用 Photon，必须可配置、缓存和限速；公开服务无 SLA。不要把公共 Nominatim 自动嵌成通用搜索默认服务，使用它须符合其当前政策。坐标、OSM 链接和离线样例为独立可用入口。

### 6.2 地图获取与本地导入

统一 Overpass 小范围下载流程，默认带必要建筑分部、街道与场地语义。源适配器封装 bbox 顺序；公共配置只用命名字段，避免南西北东与西南东北混淆。

缓存键含范围、查询版本、来源；记录时间、URL/查询、许可、哈希和对象版本信息。已有缓存优先，刷新需要显式参数。文件先写临时文件，完整校验后原子替换；请求取消、超时和错误不会破坏现有可用快照。

补全所需引用并报告仍不完整的关系。不能凭空封闭缺失海湾/水域边界。提供现有项目 JSON、标准 Overpass JSON（元数据通过项目补齐）、标准 OSM Map JSON 的规范化入口；若支持 XML，必须真正解析与验证，未实现格式明确拒绝。

限流、退避、重试次数与下载大小受控；429 不能通过轮换端点逃避限制。公开 OSM 编辑 Map API 不作为产品常规批量下载后端。大区域提示当前范围与后续区域提取路径，不要求用户研究多个接口才能完成一期的小范围任务。

### 6.3 数据真实性

观测值、由标签换算的值、规则推断值分别保留来源。地形仍为平地近似；道路高程是规则推断。未知空地补绿、低层屋顶推断维持显式选择，不能为了预览好看默认篡改数据。照片参考与参数化地标不宣称逐栋测绘还原。

## 7. 核心模型与连续分块

同一项目只有一个确定的地理原点和投影参数。源坐标为 WGS84，经变换后统一使用 x 向东、y 向上、z 向南，单位米。块内可采用相对原点，但必须在 manifest 记录可重建的变换。跨日期变更线、极区或超出验证尺度的区域明确拒绝/报告，不假设简单局部投影适合全球。

先合并/规范化区域数据、稳定对象身份、建筑分部与关系，再做共享道路连接和高程约束。每块生成所需邻域与完整关系由规划器提供；有限缓冲圈不保证所有桥梁或水域关系完整。

边界规则：

- 建筑与整组地标拥有确定归属，避免切碎或重复；对象实际包围盒可越过格网，加载器根据内容范围判断可见性。
- 道路边界使用共享的中心线、宽度、坡面和接点。裁剪点不是新的真实 OSM 节点。
- 水域、地表裁切遵循统一几何与精度；各块不生成重叠的独立展示底座。
- 植被与设施的随机规则依赖稳定源对象/世界位置、规则版本和项目种子，不依赖块序号或遍历顺序。
- 同一完整输入在不同切块方案下，应保留相同对象集合、关键几何和来源；允许输出容器组织不同。

一期可以全区域规划后分块输出，不宣称实现无限分块计算。缓存失效要考虑邻域依赖，修改道路或地标可能影响相邻块；不能仅靠文件名判断只需更新一个块。

## 8. LOD、远景与性能：一期必做

用户补充需求：不能假设连续区域全部一次渲染就能流畅；必须设计视野等级对应的信息密度，并验证扩大区域后的行为。

### 8.1 三种成本分别控制

| 层次 | 需要降低的成本 | 机制 |
| --- | --- | --- |
| 数据/场景加载 | 网络、解析、CPU/GPU 驻留 | 按视锥与预取范围加载、并发上限、取消过期请求、缓存与卸载 |
| 几何细节 | 顶点、三角形、绘制调用 | 实际不同几何级别、合批/实例化、远景简化体块、近景附件预算 |
| 着色与后处理 | 片元、多通道、阴影、填充率 | 屏幕尺度过滤、AO/阴影/像素比预算、统一后处理与质量档位 |

淡化颜色、隐藏纹理或把几何缩到零，不可单独作为降低几何与内存成本的证明。视锥剔除也不等于释放远处资源。

### 8.2 一期细节等级

- 远景：低成本建筑轮廓/地标轮廓与简化地表、低面数树冠或合适的替代表示；不保留全部窗框、屋顶设备和设施。远景底层覆盖避免加载空洞。
- 中景：常规建筑/道路和基础植被，保留空间关系与主要地标形体，控制独立 Mesh 和阴影成本。
- 近景：按预算启用窗框、局部树冠、设施等，复用已有细节机制。

至少提供两种真正不同的主体几何/资源级别，再叠加近景细节；manifest 记录每级内容、bounds、估算字节、三角数和几何误差/选择依据。不能只把同一全细节网格标成不同 LOD。

依据屏幕投影大小或屏幕空间误差选择等级，考虑距离、FOV 和视口。CSS 视觉尺寸与物理像素成本分别处理。使用迟滞、最短驻留或合适过渡避免镜头微动反复切换；相邻道路/地面保持同一边界约定，地标整体切换。切换不改变对象 ID 或来源。

共同预算包括 residentBytes、visibleTriangles、drawCalls、concurrentLoads、pixelRatio、shadow/AOQuality 和近景附件数。估计与实测超预算时按可说明顺序降级；不静默删掉大片必要城市数据。

SDK 负责队列优先级、卸载、引用计数和 dispose；场景、几何、材质、纹理和 render target 生命周期均需覆盖。新块材质/阴影准备避免同步巨型上传造成持续长帧；异步解码或分批上传按实测瓶颈实施。

### 8.3 性能证据

需要两组独立实验，不能把“同一场景分更多文件”当作扩大城市覆盖：

1. 固定覆盖范围分别 1/4/16 块：验证接缝、对象一致性和分块开销。
2. 同一快照内固定物理块大小，逐步扩大为 1/4/9 块的连续覆盖：验证更多数据的生成、传输、视野和资源预算。北京样本可使用约 500 m 格网，最终以实际快照范围为准。另做密集京都样本；合成压力数据必须明确标为合成。

固定机位与至少 60 秒相机路径，覆盖远景俯瞰、街道近景、跨块移动、快速缩放和往返；分别记录冷启动、预热后和重复加载。

记录机器/CPU/GPU/浏览器/WebGL 信息、视口/DPR、质量配置、来源与哈希、输入要素数、构建时间和内存、包体/下载量、首个可用画面与完整加载耗时、帧间隔 p50/p95/p99、长帧、实际绘制调用/三角数、驻留几何/纹理数、估算资源字节、加载/卸载次数。多通道 renderer.info 要按整帧累计，不能只取最后一次后处理绘制。GPU 时间计时若不可用明确标注；估算显存不是实际显存。

参考桌面目标：已记录的实测设备、1280×720、DPR 1、balanced 档、预热后固定路径的 p95 帧间隔不高于 33.3 ms；目标是验收目标而非现有承诺。达不到须优化或明确标为未通过，不能删除指定压力样本或修改统计口径来过关。移动 GPU 未实测不得宣布支持。

往返后资源回到预算内，重复至少 5 次不持续线性增长；远景实际提交/驻留成本低于同范围全细节对照；切换无空洞、重复对象和明显接缝。支持范围以测量报告为准，超出默认范围显示明确边界。

## 9. 风格包

分为参数预设、渲染风格和几何规则三个扩展层。StylePack 描述 id/version、参数 Schema、语义材质绑定、后处理工厂、兼容性、默认质量提示及 dispose。建筑、屋顶、道路、地面、水体、植被、设施和地标都需覆盖或有明确回退。

地标/普通生成器使用 glass、wall、roof、structure、road、water、foliage 等语义角色；保留既有程序窗格、玻璃参数和 inkClass 所需属性，但不将颜色常量视为公共模型协议。序列化再载入后须重新绑定 shader；Three.js 对象序列化本身不能保存任意 onBeforeCompile 函数。

保留现有漫画、线稿、彩色、白模能力。另提供一个项目外独立风格例子，不修改核心即可应用全场景。几何影响选项必须声明会触发 rebuild；材质参数变化不重下 OSM。

GLB 是可选资产出口：标准材质、颜色与实际几何可保留；自定义后处理和程序效果不保证通用导出。PNG 保存渲染结果并保留署名。高分辨率导出有资源上限并恢复运行时状态。

## 10. 地标生成配方与更新

地标库保存可编辑规则、参数、截面、曲线控制点和组合关系，本地生成最终网格；不维护生成后的大模型二进制。

优先抽取截面放样、圆角截面、倾斜体块、连接构件、重复竖肋等当前两地标所需操作。旋转曲面、扫掠和壳面按后续地标需求扩展，不一次性设计完整 CAD 语言。复杂地标允许小型受信任代码生成器；声明式配方不执行任意 eval。

Recipe 至少包含 schemaVersion、id/version、generator、兼容引擎范围、match、anchor/orientation、参数、材质角色、source/provenance。match 使用 OSM type+id 集合、位置范围以及可选稳定身份信息；名称只能辅助，不在全球按模糊名字替换。央视多个分部作为一组接管，避免原体块和新地标重复。

未知生成器、缺分部、版本不兼容或规则失败时，记录诊断并按照项目 strict/degraded 策略回退通用形体。原数据不被覆盖；记录使用配方版本和推断属性。

同一 Git 仓库中维护，官方地标包独立版本与打包；开发者源码模式 git pull 后重建，依赖模式显式更新兼容版本并锁定。普通构建不请求 latest。提供本地新旧配方包更新/回退验证，及 npm pack / 发布说明；本轮不注册账号、不 npm publish、不推送远端、不部署公共网站。

更新链：PR → 自动测试和几何/视觉审查 → 新版本发布 → 开发者更新锁文件 → 相关区域重建 → 开发者部署。浏览器实时追踪最新版后置；现有静态网站不会因为维护者 commit 自动变更。

## 11. CLI、本地服务与 agent 契约

CLI 初始命令组：studio、init、search、data fetch/import、build、batch、validate、preview、export web/png/glb、landmarks check/update。实现者可提供必要别名，公开文档与 help 必须一致；不得只提供空壳命令。

支持 --json、--offline（适用命令）、--resume、明确项目路径、help 与确定退出码。JSON 结果写 stdout，进度/人类日志写 stderr；含 schemaVersion、status、artifacts、diagnostics。错误含 code、stage、featureId/tileId（如有）、message 和可操作 hint。批处理不能吞错。job 状态：queued/running/succeeded/failed/cancelled，附当前阶段、进度、产物和诊断。

本地服务默认绑定 127.0.0.1，端口可指定并检查占用；只服务明确的项目/缓存根目录，限制路径逃逸，接口校验输入，不能提供任意 shell 执行接口。它是开发工具的一部分，生产 SDK 不依赖此服务。

agent 文档包含：架构地图、从示例建项目、添加风格、添加配方、修改生成器、修失败数据、跑最小回归、复现截图/性能；AGENTS.md 的 Git 提交要求保留并补充必要入口。优先 JS + 公共 .d.ts 与 JSON Schema，是否逐模块迁移 TypeScript 由实现收益决定；无需一次重写全部源码。

## 12. 并行开发冻结接口（v1 初始契约）

以下是各任务共同起点；新增字段可向后兼容扩展。必须改变签名时，在自己的交付报告中注明迁移方式，集成任务统一适配，不能私自假设其他任务已经改完。

### 12.1 项目配置

~~~json
{
  "schemaVersion": 1,
  "name": "my-city",
  "area": {"south": 39.9015, "west": 116.4490, "north": 39.9175, "east": 116.4720},
  "origin": {"lat": 39.9095, "lon": 116.4605},
  "seed": 1,
  "source": {"kind": "overpass", "file": "data/source.json"},
  "generation": {"landscapeEnabled": false, "inferRoofs": false},
  "tiling": {"sizeMeters": 500},
  "quality": "balanced",
  "style": {"id": "comic", "parameters": {}},
  "landmarks": {"enabled": true, "packages": []}
}
~~~

origin 可在初始化时从 area 计算，此后锁定。lock 保存配置/数据/引擎/规则/风格版本或内容哈希；独立记录构建时间等非确定字段。相同锁定输入的核心内容应可重现，Three.js 随机 UUID 不得造成无意义缓存失效。

### 12.2 核心与场景包（任务 A 提供）

- src/core/index.js 公共入口：validateProjectConfig(config)、compileScene(raw, config, options)、validateSceneManifest(manifest)。公共入口提供类型。
- compileScene 可异步；调用方一律 await。options 支持 signal、onProgress、landmarkRegistry。返回 {manifest, assets, report}；assets 为相对路径到 Uint8Array/string 的映射，不直接写调用者文件系统。
- manifest 必有 schemaVersion、generator/version、origin、coordinateSystem、bounds、sources/attribution、style 属性契约版本、chunks 和 featureIndex。每块有 id、contentBounds、transform、各 lod 的 uri/hash/bytes/triangles 与级别选择信息。
- 元数据、对象 ID、语义材质角色和程序着色属性经过编解码后仍可用；不序列化运行时代码。
- src/core/scene-codec.js 提供 decodeChunk(payload, descriptor) → Three.js Group（调用方可 await），按当前场景协议重建几何、实例与元数据，材质由风格层绑定。A 与 D 保持此入口。

### 12.3 地标和风格（任务 C 提供）

- src/landmark-registry.js：createLandmarkRegistry({recipes, generators, overrides})，提供 match(features, context) 和生成接口；保留旧 buildCity 默认调用行为。类型与最小使用例明确。
- match 返回 LandmarkMatch[]，每项至少含 recipeId、recipeVersion、generatorId、claimedFeatureIds、parameters、diagnostics；claimedFeatureIds 为整组被接管的稳定城市 feature ID。context 至少含 origin、bounds、seed。generate(match, context) 返回 {group, claimedFeatureIds, provenance, diagnostics}，group 为 Three.js Group；生成器内部可复用既有 writer/helpers，但调用方不依赖其私有形状。
- 几何对象以 userData.city 保存 {featureId, sourceIds, kind, materialRole, lodRole} 等可序列化语义；多角色合批可采用几何 group/属性与元数据表，必须保留 featureIndex 映射。既有 inkClass 与程序属性通过明确适配保留。
- src/styles/index.js：getStyle(id)、registerStyle(style)、bindSceneStyle(group, {style, shared})、createStylePipeline({renderer, scene, camera, style, shared})。
- bindSceneStyle 负责从场景角色/元数据恢复自定义材质，返回可释放绑定；createStylePipeline 提供 render/resize/dispose，共享 uniform 的格式显式记录。默认行为兼容旧演示。
- src/city.js 可增加 options 接受 registry/style/quality，但旧调用不得破坏；核心构建在未传 registry 时仍能使用官方默认规则。

### 12.4 SDK（任务 D 提供）

- src/sdk/index.js：createCityViewer({container, manifestUrl, style, quality, budget, onProgress, onDiagnostic, onSelect, readAsset})。
- 可异步创建；控制器至少提供 load、setStyle、setView/getView、getStats、resize、dispose。PNG/GLB 导出可通过独立导出 API 暴露，文档说明是否仅当前视野或完整区域，不能悄悄漏块。
- SDK不引用现有 main.js/固定 DOM ID，不访问工作台 API；可从普通静态路径或注入的 readAsset 加载。
- readAsset(url, {signal, responseType}) 返回 Promise；responseType 为 json 时返回已解析 JSON，为 arrayBuffer 时返回 ArrayBuffer。manifestUrl 相对页面 base URL 解析，块与其他相对资源始终相对 manifest 的 URL 解析，不能相对当前页面路径拼接；readAsset 省略时用 fetch 适配。资源请求失败须包含解析后的 URL 和错误阶段。

### 12.5 本地服务（任务 B 提供，任务 E 消费）

- GET /api/search?q=...：候选结果。
- GET /api/projects，POST /api/projects：列出/创建已注册项目；创建接受 name、area、可选 origin/source。
- POST /api/projects/open：以配置的工作目录内 relativePath 注册已有项目，校验 city.config.json 和目录边界；CLI 的 studio --project <path> 可将用户明确选择的目录作为服务工作根。打开项目不重新下载或覆写输入。
- GET/PATCH /api/projects/:id：读取/修改经校验的项目配置。
- POST /api/projects/:id/jobs：body.kind 为 fetch/build/export-web/update-landmarks，带明确参数，不允许任意命令文本。
- GET /api/jobs/:id，POST /api/jobs/:id/cancel：任务状态与取消。
- GET /projects/:id/dist/...：限定根目录中的静态场景资源。
- 工作台源码位于 studio/，本地服务提供它的开发/构建入口。缺少依赖时返回清晰错误，不能以 mock 成功代替真实功能。

## 13. 实施任务、依赖与文件所有权

五个开发子对话均采用用户指定的 gpt-6.1-sol / xhigh。每个任务有独立 Git worktree 和 codex/ 分支；禁止在共享 main 上开发。任务可显式创建一个独立审查 subagent，不建立无限递归任务树。

| 任务 | 交付与主要子任务 | 主要写入范围 | 依赖 |
| --- | --- | --- | --- |
| A 核心与场景构建 | A1 项目 Schema/类型；A2 统一坐标和规划；A3 确定性场景编解码；A4 分块归属与接缝；A5 真实低/中级几何产物 | src/core/、schemas/project*、schemas/scene*、src/osm.js、必要 road/landscape 规划模块、test/phase1-core*、docs/phase1-evidence/core/ | 以现有建模为起点，集成时连接 C；输出给 B/D |
| B 数据、CLI 与本地任务 | B1 地点与数据适配；B2 缓存/导入/补全；B3 项目和锁文件；B4 CLI/任务状态/恢复/取消；B5 本地服务和规则更新编排 | src/data/、src/cli/、src/local-server/、bin/、scripts/fetch_osm.py、scripts/osm_map_areas.py、test/phase1-data*、test/phase1-cli*、docs/phase1-evidence/data/ | 按冻结契约调用 A/C；未集成前可依赖注入测试 |
| C 地标与风格 | C1 生成器与配方 Schema；C2 中国尊/央视迁移；C3 分组匹配与回退；C4 官方与外部风格；C5 独立打包与兼容更新 | src/landmark-registry.js、src/generators/、src/styles/、src/landmarks.js、src/building-rules.js、src/city.js、src/ink-renderer.js、src/facade-shader.js、packages/landmarks/、packages/styles/、schemas/landmark*、schemas/style*、test/phase1-landmark*、test/phase1-style*、docs/phase1-evidence/landmarks/ | 保持既有入口兼容；接口供 A/D/B |
| D Web SDK、LOD 与性能 | D1 SDK 生命周期；D2 按视野调度和卸载；D3 屏幕尺度与迟滞；D4 预算/统计；D5 实际浏览器性能回归 | src/sdk/、src/runtime/、src/distance-style.js、src/depth-policy.js、必要 foliage LOD、examples/embed/、scripts/benchmark-*/、test/phase1-runtime*、docs/phase1-evidence/runtime/ | 按冻结契约使用 A/C；完整性能验收在集成后复跑 |
| E 工作台、集成与总验收 | E1 真实工作台流程；E2 静态导出；E3 收集并集成 A/B/C/D 提交；E4 公共包入口/CI/文档；E5 独立审查与全链路验收/修复 | studio/、src/main.js、index.html、README.md、package.json/lock、vite.config.js、AGENTS.md、.github/、examples/quickstart/、test/phase1-e2e*、docs/phase1-evidence/integration/、docs/phase1-execution.md | 可先做 UI 和契约 fixture；最终必须真实集成 A/B/C/D |

依赖图：A/B/C/D 可按冻结契约并行实现；E 先完成工作台和集成准备，随后读取四个子对话的完成状态及各自报告，按 C → A → D → B 顺序集成（若有显式依赖先调整），再做完整流程。组件未到齐时不能把 stub/mock 的演示当最终交付。

共享根 package.json/lock、根 README 和发布配置由 E 统一修改；其他任务把所需脚本/依赖写入自己报告，必要依赖可在所属子包独立声明。跨所有权修改尽量通过新增适配层完成，确有必要可在自己的隔离分支修改并在交付报告标明，E 负责冲突解决，禁止改动其他 worktree。

组件任务各自完成后写 docs/phase1-evidence/<组件>/handoff.md，包含提交哈希、实现项、API差异、测试、独立审查结果、已知缺口与集成步骤。任务未完成时必须如实列出缺口。所有实质改动按 AGENTS.md 提交，不 git add 全仓混入其他内容。

## 14. 验收矩阵

下表均为一期最终门槛。组件测试、mock 测试、实际浏览器和真实网络证据分开，网络不可用不得伪造 live 成功。

| ID | 验收内容 | 通过依据 | 责任 |
| --- | --- | --- | --- |
| AC01 | 旧功能不回归 | 原 138 项测试保留且通过，生产构建成功；北京关键机位比较 | 全体/E |
| AC02 | 零外网样例试用 | 安装依赖后断外网能打开内置样例并切换画风 | B/E |
| AC03 | 地点与范围 | 同名候选、无结果、坐标、地标、OSM 链接；范围保存后不漂移 | B/E |
| AC04 | 标准下载 | 一个明确小范围真实获取；来源/时间/哈希完整；限流和失败分支有确定 fixture 测试 | B |
| AC05 | 缓存与原子写入 | 重复请求命中缓存；强制刷新才联网；中断不毁坏旧数据 | B |
| AC06 | 项目复现 | 同一锁定输入重建关键内容哈希相同，配置/版本变化可解释 | A/B |
| AC07 | 构建取消与恢复 | 取消、重启、继续、失败单项重试，产物状态无伪成功 | B/E |
| AC08 | 独立 SDK 集成 | 独立样例不引用旧 main.js，不依赖工作台后端即可加载场景 | D/E |
| AC09 | 场景协议 | 几何/实例/角色/来源/对象 ID/程序属性可编解码，损坏与不兼容版本明确报错 | A/C/D |
| AC10 | 连续区域坐标 | 1/4/16 切块同源几何位置一致；接缝关键点差不大于 1 cm（局部米制） | A |
| AC11 | 对象归属 | 跨块建筑、央视分部、树木不重复/缺失；世界身份不因排序变化 | A/C |
| AC12 | 道路与水域 | 跨块坡路、桥、路口、水面无分块引入的断层、孔洞和重叠 | A/E |
| AC13 | 独立风格 | 外部目录添加风格，不改核心，覆盖建筑/路/水/树/地标 | C/D/E |
| AC14 | 地标迁移 | 中国尊/央视默认效果与高度来源保留，禁用后回退，分组只生成一次 | C |
| AC15 | 地标更新 | 本地两个版本配方包安装/兼容检查/锁定/重建/回退，旧项目可重现 | B/C |
| AC16 | 真实 LOD | 至少两档不同主体几何资源；远景资源和实际绘制降低；近景恢复 | A/D |
| AC17 | 镜头稳定 | 改 FOV/缩放/跨阈值/跨块无连续抖动、空洞或永久丢失建筑 | D/E |
| AC18 | 加载预算 | 并发、驻留与近景预算生效；过期请求取消；远处释放；超限有诊断 | D |
| AC19 | 内存生命周期 | 至少 5 次往返/重载后资源回到预算，无持续线性增长 | D/E |
| AC20 | 扩区性能 | 固定块大小的 1/4/9 覆盖与密集样本真实浏览器报告，统计满足第 8 节口径及目标 | D/E |
| AC21 | 静态交付 | 导出网页非根路径可用、无远端运行时依赖、全套画风正确 | B/D/E |
| AC22 | PNG/GLB | PNG 署名；GLB 导出范围与材质限制明确；不会静默遗漏未加载块 | D/E |
| AC23 | 批处理 | 两个离散项目+一个故障项；状态、退出码、恢复与产物正确 | B/E |
| AC24 | agent 友好 | help/JSON/类型/Schema 与实际一致；陌生审查者按教程添加配方或风格并验证 | 全体/E |
| AC25 | 本地服务边界 | localhost 默认绑定、项目路径校验、任务取消、不执行任意 shell | B/E |
| AC26 | 可发布包边界 | npm pack 检查入口与文件；不含缓存、地图大样本、生成模型或私有内容 | C/E |
| AC27 | 独立验收 | 非实现者检查真实提交并复现关键流程，缺陷修复后复验 | 全体/E |

## 15. 独立审查、证据和完成标准

每个组件任务必须安排一个独立审查 subagent，使用 gpt-6.1-sol / xhigh，最好 fork_turns=none；给出规划、worktree、差异、验收项和运行命令。审查者先读实际代码与测试，不能只复述作者的 handoff。它以只读检查/测试为主；实现者修复问题后再复验。需要 UI 时遵循可用的 computer-use 技能，截图必须来自真实运行结果。

E 在最终集成提交上再安排两个独立验收角色，可顺序执行以控制资源：

1. 架构/数据/协议/确定性/分块与生命周期审查。
2. 工作台端到端、外部 SDK、风格/地标、截图和浏览器性能验收。

集成者修复发现的问题，并让对应审查者复验。不得让审查者替实现者直接宣布所有验收通过；报告逐项列 pass/fail/not-run，真实证据路径和机器条件。未能测到的性能或网络路径保持未验收，不伪造通过。

每份证据包含日期、commit、命令、输入与种子、配置、环境、结果和限制。性能报告必须保留原始统计 JSON 与路径/视角配置，截图少量且可定位。测试或审查如果环境确实不可用，记录阻塞及恢复方法；先完成不依赖它的工作，不能用环境问题掩盖缺实现。

最终完成要求：AC01–AC27 均有结果，必需项无 fail/not-run；规划范围有真实可运行实现；所有代码与证据已提交；集成分支清洁；README 提供安装、工作台、CLI、SDK、静态部署与扩展入口。实际未完成的项目保留为缺口，不能靠改规划删除要求宣布一期完成。

## 16. 开源整理与运维边界

提供 README 的通用产品介绍、CONTRIBUTING、扩展指南、数据许可示例和支持矩阵；将历史对标研究与开发者快速开始分开。现有 MIT、DATA_LICENSE 保留；引用照片/第三方截图不随软件许可证重新授权。

核心包、风格包、地标包可独立打包，首先本地验证 npm pack/安装，不在开发任务中直接 publish、push、创建公开站点或改变仓库可见性。用户后续决定公开发布时，以具体可审查成果执行。

无需维护者服务器不等于无外部依赖：首次依赖安装、地点查询、地图下载和规则更新需要对应来源；准备完成后的构建、预览和静态站点运行可离线于外网。公开数据服务和包分发平台仍有条款/配额。

## 17. 执行安排与恢复

本主对话负责规划提交、工作区隔离、创建五个开发子对话和记录执行清单，随后可以结束当前 turn。结束主对话不作为中断已启动子对话的命令；子对话在各自任务中继续工作。

E 是持续集成与验收协调任务：在自己 worktree 内完成工作台，使用 wait_threads 的紧凑快照等待 A/B/C/D，读取完成报告，整合已提交代码，并持续推进验收。它不得仅因上游暂未完成就结束 turn；如确需退出，必须提交恢复记录、待办与阻塞信息。不得声称主对话一定会被自动唤醒；用户可在任意时间唤醒主对话查看清单与执行状态。

各任务可以自主启动独立审查 subagent；不需要为常规可逆修改重复请求用户确认。所有 Git 操作限定自己的 worktree，最终集成保留在 codex/phase1-integration 分支供用户验收，不从后台覆盖用户正在使用的 main。公开发布不属于当前执行范围。

执行清单由 docs/phase1-execution.md 记录线程 ID、worktree、分支与初始基线。实际进度以子对话状态、提交与 handoff 报告为准，不能把“已派发”写成“已完成”。

## 18. 参考资料

以下为方案核对来源；外部政策实施时再次核对，不能将某次查询结果视为永久授权。

- [OSMF API policy](https://operations.osmfoundation.org/policies/api/)
- [Overpass 资源与限制](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
- [Photon API 与服务说明](https://photon.komoot.io/)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [区域下载 Geofabrik](https://download.geofabrik.de/)
- [Osmium 提取与关系完整性](https://docs.osmcode.org/osmium/latest/osmium-extract.html)
- [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
- [Three.js GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html)
- [Three.js LOD 与迟滞](https://threejs.org/docs/pages/LOD.html)
- [Three.js WebGLRenderer 统计和资源生命周期](https://threejs.org/docs/pages/WebGLRenderer.html)
- [OGC 3D Tiles 坐标与包围体概念参考；一期不宣称兼容](https://docs.ogc.org/cs/22-025r4/22-025r4.html)
- [npm 公共包发布说明](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [OpenAI 长任务的规格、状态与验证组织](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)
