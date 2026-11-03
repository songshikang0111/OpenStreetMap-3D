# 一期 A：核心模型与连续场景构建交付

日期：2026-11-03。分支：`codex/phase1-core`。独立 worktree：`C:\Users\宋世康\.codex\worktrees\phase1-core\beijing-city-ink`。未在 main 或其他任务 worktree 写入/提交。

## 实际提交

按顺序集成以下提交（规划基线 ed0820b）：

1. `4b9eab77cbb9e06ce5905c3fab54d44b55cef732`：统一配置、区域规划、确定性场景包、真实三档资源与核心测试。
2. `40cad2886747ca661eaeb2674cf7adbcacaaa09f`：独立审查发现的回退、实例、可见性、来源、统计与校验修复。
3. `6a0eebab8c3e156f847108028dadb4fc67e5a64c`：地标多 mesh 主对象身份保真。
4. `457087a752ed8c070f50274f2b811441ebaf6957`：公共结构化错误类型构造函数及真实类型消费者。
5. `ebb81022e569b5f18e64a27ca10c5ca5ee143e77`：接管前校验重复 claims 与 provenance。

本报告、独立审查记录及 snapshot-audit.json 另行作为证据提交；其哈希见分支最终 HEAD。代码审查覆盖至 ebb8102。真实无 registry 快照审计在 40cad28 执行，之后仅修改注入 registry 主 ID/防御和类型，默认快照输出路径不受影响。

## 实现与接口

已提供冻结入口 `src/core/index.js`：validateProjectConfig、await compileScene、validateSceneManifest；`src/core/scene-codec.js`：await decodeChunk。附 `.d.ts`、项目/场景 JSON Schema、真实 TypeScript 消费者和20项核心回归。返回相对路径 assets 映射，不操作调用者文件系统。

项目配置锁定单一 WGS84 原点与局部米制投影；完整区域只求解一次道路连接/高程、桥、场地、水 union、植被，再确定资源归属。建筑、央视整组和每棵树不拆不重；道路/水/地面按共享三角形归属，不重新裁切/解算。1/4/16 切块世界三角形、实例与身份一致。块 contentBounds 包含越界几何，SDK 必须据此加载/剔除。

确定性二进制协议保留真实属性、索引、材质 groups、实例/实例颜色/自定义属性、语义角色、来源和对象 ID；剔除 UUID/时间/运行时代码。SHA-256、长度、版本与几何范围检查拒绝损坏资源。建筑合批的 cityFeature 和 cityMaterialRole 属性保留每对象/角色查询能力。

low 使用真实建筑挤出/地标简化截面、20面树冠、四边树干和建筑合批；medium 保留原主体/基本植被；high 恢复屋顶附件/街道设施。所有级道路和地表边界相同。外部地标经显式 registry 注入，失败/空形体/无效实例/非有限属性诊断回退；成功接管清理旧建筑和屋顶附件。

完整资产结构、字节协议、bounds、角色属性及选择参数见 [protocol.md](protocol.md)。无冻结函数签名变更。新增兼容字段包括 tiling.divisions（固定范围比较用）、三档描述符、报告哈希与 cityMaterialRole 表。

## 验证结果

Windows x64、Node v22.11.0、Intel i5-13600KF、约32 GiB内存；所有快照输入 hash、种子1、原点、构建耗时与进程内存见 [snapshot-audit.json](snapshot-audit.json)。该报告的成本为 CPU 资源统计/估计，不是 GPU 性能或实际显存。

| 完整真实范围，1块对照 | low 三角形 / medium | low resident bytes / medium | low draw calls / medium |
| --- | --- | --- | --- |
| 北京：477建筑、3680树 | 543,886 / 1,335,941 | 65,016,626 / 91,389,581 | 22 / 497 |
| 京都：4460建筑、1467树 | 650,245 / 1,330,679 | 94,158,615 / 196,061,931 | 26 / 4,485 |

北京、京都各自固定范围切成1/4/16块，world hash 和解码后世界几何签名完全一致。物理范围独立扩大实验：北京500 m块的1/4/9覆盖，建筑14/92/286；京都250 m块的1/4/9覆盖，建筑397/1489/2876。京都原快照不足3×500 m，采用明确记录的250 m固定块，没有扩造样本。完整范围 high 三角数分别1,486,809与1,370,375，恢复真实附件。

命令与机器可读结果见 [validation.json](validation.json)：核心20/20；原138项保留，全量158/158；生产build成功（原有three分包大于500kB提示）；严格TypeScript消费者检查通过。`audit-snapshots.mjs --write-assets` 可复现12组真实CPU实验。完整生成资源仅在忽略目录 `work/phase1-core/{beijing-cbd,kyoto-gion}`，未提交大模型/缓存。

## 独立审查

已显式启动 `/root/core_review`，gpt-6.1-sol / xhigh / fork_turns none，独立读代码、复现缺陷，并在修复提交上复验。完整验证20/20、158/158、build和类型检查通过；另有13组作者测试外边界断言通过；ebb8102最后两行补审通过。发现与修复逐项见 [review.md](review.md)。没有以作者自测替代独立审查。

## 相关 AC 状态与边界

| AC | A组件结果 | 集成/完整门槛未在此宣称通过的部分 |
| --- | --- | --- |
| AC01 | pass：原138+20测试、build | not-run：E的北京关键机位视觉比较 |
| AC06 | pass：锁定输入/逆序输入字节一致、世界哈希稳定 | not-run：B完整项目锁文件/离线重建流程 |
| AC09 | pass：几何/实例/角色/来源/ID/程序属性、损坏/版本检查 | not-run：C/D真实浏览器shader重新绑定 |
| AC10 | pass：同范围1/4/16，几何完全一致，分块引入点误差0 | 无A职责内未完成项 |
| AC11 | pass：跨边建筑、央视整组、树及注入多mesh/实例身份与归属 | not-run：C正式registry集成复验 |
| AC12 | pass：道路坡面、桥、水域共享三角形不变，无分块新增断层/重叠 | not-run：E浏览器视觉接缝检查 |
| AC16 | pass：三档真实资源，low三角形/字节/驻留估算/调用均降低、high恢复附件 | not-run：D实际WebGL绘制/近景切换/资源统计 |
| AC24 | pass：A入口、类型消费者、Schema与结构化诊断 | not-run：CLI/陌生开发者完整扩展教程，属B/C/E |
| AC27 | pass：独立实现外审查、缺陷修复后复验，证据已保存 | not-run：E最终整合提交的双角色总验收 |

AC17–20的镜头、卸载、五次往返和60秒浏览器性能由D/E执行；本组件没有相关真实浏览器测量，不把CPU报告称为通过。未实测其他操作系统或移动GPU。10 km区域跨度仅是有限规划保护，不是流畅度承诺。外部任意生成器没有专门简化时保留其主体并可合批；未宣称自动简化任意CAD。

## 集成步骤与所有权

按C→A→D→B整合。本任务未改根package/lock/README，未新增运行时依赖。类型检查临时安装typescript7.0.2和@types/three0.187.0（no-save、package-lock=false）；E应按最终包的Three版本整理声明依赖及测试脚本。

唯一跨C所有权文件为 src/city.js 四处小改：`landmarksEnabled=true`兼容选项、对应envelope/landmark判断，以及返回roadPlan/streetlifePlan。合并冲突时保留C的registry/style行为，并保留这两个共享规划结果；compileScene读取它们以免每块重新求解。可通过适配层统一字段，但不能默默删掉计划数据。

B保存defaulted配置origin，再调用compileScene并写manifest/相对assets/锁文件；构建建议放worker，signal在阶段和资源边界响应。D加载低中高描述符、按contentBounds可见性处理越界三角形、通过cityFeature/instanceFeatureIds选取身份、交给C绑定材质并自行dispose。生成器返回group的原始材质代码不传输；核心只保存可序列化属性。

E集成后必须用正式C registry和style、D SDK真实重跑，核对版本/接口与浏览器成本；不应把本任务的注入registry测试标成正式模块集成成功。全部行为代码已提交，剩余属于跨模块集成和浏览器验收。
