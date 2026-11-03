# 一期集成验收

日期：2026-11-03，Windows x64 / Node 22.11.0。分支 `codex/phase1-integration`，产品功能修复至 `2c013fb`；最终生产包性能运行冻结在 `9407af9`。**代码集成与最终矩阵已完成；AC04、AC18仍未通过，独立工作台CUA子项not-run，一期不能宣布全部验收通过。**

## 已验证的交付

- 全量测试 **264/264**，原138项保留，见 [tests.tap](tests.tap)。严格 TypeScript 消费与三套生产构建通过；Three.js / studio 的 >500 kB 提示仍在。
- [真实端到端七项](e2e-results.json)全部 pass：样例确定性重建，实时配置不使几何过期，批处理部分失败与恢复，嵌套静态导出及发布取消保护，真实本地 API/worker 取消恢复，实际 PNG/GLB，真实中国尊两版配方与精确回退。
- [最终安装包](package-results.json)：121文件，本地离线隔离安装、公共入口、严格类型、安装后真实 CLI/编译 worker/生产工作台 HTTP 与静态 SDK 检查通过。没有发布、推送或部署；包不含地图大样本、缓存、CINK、GLB 或私有目录。
- [实现者工作台实操](studio-ui-results.json)：最终构建实际 sample→color→街道→FOV55→保存→重开→PNG/complete GLB→静态网页。保存相机 position.y=12、target.y=18，不再静默抬高；滑块范围5–140。实际下载文件签名/哈希已记录，[完整界面](studio-final.jpg)与[实际 PNG](studio-ui-export.png)可核对。此样例明确是合成，不冒充真实 OSM 下载。
- 两个非实现者角色分别执行真实架构/数据/协议/worker 审查及隔离包/扩展教程/SDK/实际浏览器审查。已复现的代码P1/P2均修复并复验；原始脚本、JSON、截图与修复记录分别在 [架构审查](review-architecture/final-review.md)、[SDK与浏览器审查](review-studio/final-review.md)。

最终统计另由两个角色从原始数据独立复算，0项不一致：[架构性能复核](review-architecture/final-performance-review.md)、[第二角色文档/统计复核](review-studio/final-document-review.md)。

## AC01–AC27

`pass` 只用于本行已验证的范围；`fail` 保留未达到的必需条件；`not-run` 不用作者推测或组件证据冒充最终实验。

| AC | 结果 | 证据与边界 |
| --- | --- | --- |
| AC01 旧功能不回归 | pass | 264测试保留原138；生产构建；独立旧demo/同输入SDK北京俯瞰、中国尊、央视、道路四机位对照。画面明暗存在差别，不称像素等价，见 review-studio/screenshots/beijing-* |
| AC02 零外网样例 | pass | 实现者实际工作台样例与切画风；CLI离线重建；独立安装包SDK在拒绝外网下运行样例及四官方/外部画风。工作台独立CUA子项not-run，单列如下 |
| AC03 地点与范围 | pass | B真实搜索适配器的同名/无结果/坐标/地标/OSM fixture、具名bbox/原点锁定测试；E客户端范围精度测试与真实API坐标/地标输出；未把公共Photon可用性冒充稳定SLA |
| AC04 标准真实下载 | **fail** | [network-results.json](network-results.json)：默认Overpass小范围首次502，最终重试20秒TIMEOUT，无成功缓存；错误/限流fixture通过不能替代live下载 |
| AC05 缓存/原子写 | pass | B缓存命中、显式刷新、哈希破坏、取消保旧快照；真实worker/发布恢复回归，原始组件证据 ../data/ |
| AC06 项目复现 | pass | 真core/worker同锁重建相同contentHash；版本/配方/生成参数变化可解释，实时相机/画风/质量不使几何过期；官方包纳入engine fingerprint |
| AC07 取消与恢复 | pass | 真worker/API取消保留旧产物；独立parse阶段强杀服务，重启INTERRUPTED，同ID attempt2恢复成功，见 review-studio/api-restart-results.json |
| AC08 独立SDK | pass | 最新2c隔离安装包的独立应用与非根静态站点；不引用旧main或工作台API，见 review-studio/browser-results.json |
| AC09 场景协议 | pass | 实际CINK几何/实例色/自定义属性/角色/ID/来源回归；core与runtime拒绝损坏/版本/负drawUnits；实际浏览器重新绑定官方shader |
| AC10 连续坐标 | pass | A真实快照1/4/16世界几何一致；E权威角色/索引/实例属性的1/4/16及逆序审查；分块引入关键点误差0，见 ../core/snapshot-audit.json |
| AC11 对象归属 | pass | 地标原体块/屋顶/通用近框接管清理；央视整组、跨块建筑、树唯一归属；独立1/4/16 near metadata一致，见 review-architecture/node-flows-results.json |
| AC12 道路与水域 | pass | 全区统一规划后共享三角归属，各LOD/切块不重复解算；独立北京俯瞰/道路画面未见分块空洞，配合核心几何接缝断言；不是任意数据测绘级保证 |
| AC13 独立风格 | pass | 陌生审查者外部目录复制sepia，十角色真实绑定、ES2022应用构建及浏览器加载；4官方+外部画风与五轮资源切换，见 review-studio/browser-results.json |
| AC14 地标迁移 | pass | C准确OSM身份/高度来源、央视分组、禁用/失败回退；正式registry与CINK/browser/GLB集成，关键机位原图保留 |
| AC15 地标更新 | pass | 真中国尊输入，两版本地声明式包兼容/锁/worker重建/高几何改变/回退资产与contentHash精确恢复；E端到端与两独立角色均复现 |
| AC16 真实LOD | pass | 三档实际不同资源；正式CINK，近景窗框/树冠可恢复；最终12案远景实际几何/triangles/draws均低于全细节对照，近景恢复及对象身份有回归与独立浏览器证据 |
| AC17 镜头稳定 | pass | 迟滞/最短驻留/旧块保留到新块挂载、whenIdle相机revision；2c实际街道回读与四机位；最终12条60秒跨块/缩放/FOV路径无浏览器错误，配合原子替换与阈值专项回归 |
| AC18 全部默认预算 | **fail** | 默认600000整帧triangles/1200draws；最低几何仍在较大/密集覆盖超限，虽有明确诊断且并发/驻留/附件预算与取消生效，不把保留覆盖改写为预算达成 |
| AC19 内存生命周期 | pass | 真实CINK与官方风格Node五往返引用归零，独立浏览器五轮风格往返稳定；最终12案共60次离开/返回全部资源稳定，几何/材质/纹理/CPU数组/renderer几何纹理及programs回到相同基线；不称实测显存 |
| AC20 扩区性能 | pass | 最新相机修复后12案各实际>=60秒，1280×720/DPR1/balanced，p95全部8.4ms，统计及33.3ms目标通过；默认绘制预算单列AC18 fail。修前8案不作为最终依据，见 performance/assessment.json |
| AC21 静态交付 | pass | 完整范围打包、嵌套输出/原子发布取消保护；独立最新隔离包的非根路径、拒绝外网、四官方/外部风格实际浏览器通过 |
| AC22 PNG/GLB | pass | 实际署名与版权链接PNG；GLB明确scope/标准材质限制/资源上限；未加载视野下complete包含全部chunk；实例颜色/身份与编码中取消修复复验 |
| AC23 批处理 | pass | 两离散项目成功+故障项真实管线，JSON状态/非零退出码正确，恢复仅失败项；B真实北京/京都及E样例总链均有原始证据 |
| AC24 agent友好 | pass | help/JSON/Schema/strict types/安装后入口；非实现者按教程实际添加sepia与配方变体并验证、回退。顶层await需ES2022的说明已补 |
| AC25 服务边界 | pass | localhost/Host/Origin、项目/任务ID/路径/junction/项目锁、固定任务枚举、取消与重启；无任意shell路由，见最终测试和独立worker记录 |
| AC26 可发布包边界 | pass | 最终121文件pack与离线安装；生成场景/缓存/地图不入包；本轮仅本地pack，根包private=true，没有npm publish |
| AC27 独立验收 | **not-run** | 两个非实现者的架构/数据/CLI/SDK/扩展与缺陷复验完成；规划§15要求的独立工作台端到端未执行成功，整项不能按已完成部分宣布pass；作者UI另列 |

## 性能口径

最终12案：RAF p95全部8.4ms，GPU p95为4.77184–7.036928ms，共86109个GPU采样、13帧超过50ms；60次资源往返全部稳定、并发不超过3，默认路径峰值驻留估算100.60MiB。10/12案整帧三角p95超600000，两组16块的draws p95分别1298/1404超1200。京都grow-1另有10帧瞬时draws超限（max2626），grow-9有7帧（max1627）；绘制预算表按p95判定，不代表每帧硬上限。帧间隔目标pass、含绘制预算联合结果fail。见[可重算汇总与原始案例](performance/README.md)。

设备为i5-13600KF、32GiB RAM、Windows 11（10.0.26300）、Chrome156、WebGL2/ANGLE D3D11/NVIDIA RTX4090。测试浏览器每案新profile；其他操作系统背景负载没有完全隔离。

最终机器/CPU/GPU/浏览器/WebGL、1280×720/DPR1/balanced、bundle SHA-256、来源/种子/范围、包体、CPU构建峰值RSS、冷启动、全部逐帧与GPU查询、实际资源传输、far/full/far和每例五次生命周期统计保留在 performance/。首个可用画面为含几何全帧提交标记，未测GPU/显示器呈现完成；完整加载为当前视野选定LOD就绪，并非全部高细节资产。GPU使用非阻塞 `EXT_disjoint_timer_query_webgl2` 包裹完整pipeline，不把RAF或CPU耗时冒充GPU时间；字节是CPU数组/驻留估算，不是实测显存。

默认600000全帧三角形、1200draws、128MiB驻留估算、并发3。固定范围1/4/16与固定物理块1/4/9分别实验；北京500m、京都300m，均来自原快照，没有平铺合成城区。最低LOD仍超预算的范围需进一步简化或缩小范围；不以隐藏必要覆盖来伪装成功。强制far/full测量组明确绕过自动细节预算。

## 独立UI工具限制

独立studio审查者在Computer Use读取Windows浏览器窗口时被工具强制停止：无法足够确信当前窗口URL以执行策略；没有继续输入或切换通道绕过。后续在新任务中仅尝试能返回可信URL/DOM的正式Chrome扩展入口，工具返回 `Browser is not available: 3`，未创建标签页或操作UI，即停止。独立工作台流程仍为 **not-run**，AC27整体不按已完成部分计pass。同一角色的独立实际SDK浏览器、扩展教程、CLI/进程崩溃恢复等已完成并各有证据；实现者使用此前已建立的Chrome extension/CUA会话完成的工作台流程另存，不冒充非实现者复现。

未执行云端CI、Linux/macOS/移动GPU验证；仓库包含Windows/Ubuntu CI配置，不把配置存在称为云端执行成功。
