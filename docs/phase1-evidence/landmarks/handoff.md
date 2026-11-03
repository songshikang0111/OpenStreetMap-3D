# 一期 C：地标生成配方与可插拔风格

日期：2026-11-03。隔离分支 `codex/phase1-landmarks`，worktree `C:\Users\宋世康\.codex\worktrees\phase1-landmarks\beijing-city-ink`。基线 `ed0820b02761ca918508c3d8c25af1e936e433c8`。本文件将在独立审查后补充最终提交与验收结论；当前不是全项目验收报告。

## 实现与公共接口

- `src/landmark-registry.js/.d.ts`：冻结的 createLandmarkRegistry、match、generate；额外导出 validateLandmarkRecipe/checkLandmarkPackage。官方规则默认启用，`recipes:[]` 或 `buildCity(...,{landmarks:{enabled:false}})` 可关闭。overrides 显式替换/关闭，未知生成器/缺件/不兼容/失败均诊断并回退，strict 抛错。
- `src/generators/` 与 `src/landmarks.js`：复用既有截面、放样、倾斜、连接和竖肋操作。中国尊与央视按准确 OSM type/id 和位置匹配；央视一次返回独立 Group 接管四个 part；保留每个 source height/min_height/heightSource。生成器返回独立 group/稳定 claimedFeatureIds/provenance/diagnostics，不修改输入，不依赖核心私有 writer。
- `src/styles/index.js/.d.ts`：getStyle/registerStyle/bindSceneStyle/createStylePipeline；额外 createStyleShared/annotateSceneSemantics/validateStyle。四个官方画风与独立 cel ESM 风格。绑定恢复程序窗格和玻璃；外部例子替换 Toon 材质、梯度纹理、雾和直接渲染管线，覆盖建筑/路/水/树/地标。参数 Schema、角色回退、管线 resize/dispose 与引用计数已实现。
- `src/ink-renderer.js`：修复共享几何分类元数据被 clone 共享、切换管线反复产生几何副本的既有问题；管线释放自己的 clone 并恢复原几何。
- `packages/landmarks/` 与 `packages/styles/`：独立版本 1.0.0，自包含 ESM/类型/说明/许可证，地标包为配方数据及引擎生成器引用，不含生成模型。仅本地 npm pack/安装验证；未 publish/push。
- Schema 与 [扩展教程](extensions.md)。根 package.json/lock/README 未改；无新运行时依赖。

## 与 A/B/D/E 的集成约定

`context.origin` 接受冻结的 `{lat,lon}`（也兼容旧 `[lat,lon]`）；地理位置检查可由此还原投影，也支持 context.project.inverse/context.inverse。context.bounds 为局部米制。序列化 match 后 generate 必须传 context.features。generate 同步，调用者 await 亦可。`registry.diagnostics` 是本次 match/generate 的累计诊断；context.onDiagnostic 可逐条接收。契约引擎版本为 `LANDMARK_ENGINE_VERSION='1.0.0'`，与历史网页版本 0.8.1 分开。

Mesh 的 `userData.city` 保存 schemaVersion/featureId/sourceIds/kind/materialRole/lodRole/inkClass；地标还含 recipeId/version/height/minHeight/heightSource。程序材质声明 `shader:'facade-v6'`，要求 aFacade:4、aStyle:2、aLayout:4、aSurface:2、objectId:3。合批角色保存在 `geometry.userData.city.materialRoles` 和 geometry.groups，组索引对应该表。所有字段、属性、实例矩阵和颜色须由 A codec 原样保留，D 解码后 bindSceneStyle。A 对央视整组做一次块归属，再容纳越界 bounds；不能每块调用不完整组后重复回退。此分支不含 A/D，未假称真实 codec/分块集成成功。

buildCity 保留旧返回 buildings/landmarks/shared/LOD 等，新增 landmarkGroups、landmarkDiagnostics、styleBinding。额外接受 registry/landmarkRegistry、landmarks、style、quality；quality 接受但细节调度由 A/D 实现。仅传 style 时创建 styleBinding；调用者释放该绑定，仍负责原材质和几何生命周期。旧网页继续使用默认兼容材质与 InkRenderer。D 切换风格时先释放 pipeline、binding；风格层不负责场景几何和原材质的最终 dispose。

B 使用 checkLandmarkPackage 的 valid/diagnostics/lock 结果，还需锁归档/内容哈希、执行文件安装/原子写锁/缓存失效。组件测试在临时目录真实离线 npm install 两版本、写锁、重建和回退，但不是 B CLI 验收。类型消费方需提供 Three.js 类型（验证使用临时安装的 @types/three）。官方 styles 包用 Three peer >=0.186.0 <0.187.0；独立 landmarks 包无需 runtime dependency。建议 E 根导出增加 registry/styles 入口并继续 npm test；不需改脚本才能运行新增 test/*.test.js。

## 验证记录（独立审查前）

环境：Windows，Node v22.11.0；npm ci 18 packages。`npm test`：148/148 通过，保留原 138 项，10 项新增。`npm run build`：通过，既有 Three >500 kB 提示。`git diff --check`：通过。TypeScript 临时严格消费测试通过；Ajv 2020 对两配方/四风格 Schema 验证通过。

包验证：`$env:CITY_PACK_EVIDENCE = Join-Path (Get-Location) 'docs/phase1-evidence/landmarks/npm-pack.json'; node --test test/phase1-landmark-packages.test.js`。真实 npm pack 文件清单/完整性和 1.0.0→1.1.0→1.0.0 锁/几何哈希见 [npm-pack.json](npm-pack.json)。临时目录隔离、offline install、无地图/缓存/生成模型/私有数据，结束删除临时目录。

浏览器复现：`npm install --prefix work/browser @playwright/test --no-save --no-audit --no-fund`，另一个终端 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5193 --strictPort`，然后 `node docs/phase1-evidence/landmarks/verify-browser.mjs`。可设置 CITY_PLAYWRIGHT_MODULE、CITY_BROWSER_EXECUTABLE、CITY_BROWSER_BASE；默认本机 Edge。结果见 [browser-results.json](browser-results.json)，截图 comic/line/color/white/external-cel.png。Edge 156、WebGL 2、RTX 4090、i5-13600KF，960×640、DPR1；五种画风非空且无浏览器/shader 错误。修复后官方风格切换 resident geometry 都为 21；该实验是组件渲染，不是 60 秒扩区性能。测试水/树明确为 fixture，地标是真实仓库北京输入。

## 逐项 AC（当前组件证据）

| AC | 状态 | 范围与限制 |
| --- | --- | --- |
| AC01 | pass（组件） | 原 138 测试+build；默认关键地标截图，E 仍需全北京关键机位比较 |
| AC09 | pass（组件） | ObjectLoader 编解码后角色/来源/ID/程序属性/shader 恢复；A 实际 codec 未集成 |
| AC11 | pass（组件） | 央视四件整组一次认领，排序稳定，无额外原体块；跨块归属由 A 复验 |
| AC13 | pass（组件） | 独立 ESM 全角色材质与不同渲染管线；实际浏览器通过，D/E 外部 SDK 复验待集成 |
| AC14 | pass | 两地标迁移、原高度/来源、禁用/失败回退、央视一次生成 |
| AC15 | pass（组件） | 真实本地包安装、两个版本、锁、重建和完全回退；B CLI 编排待集成 |
| AC24 | not-run（独立） | 类型/Schema/教程已实现，待独立审查者按教程验证 |
| AC26 | pass（组件） | 两官方子包 npm pack/离线安装；根公共包由 E 负责 |
| AC27 | not-run | 待启动独立只读审查 actual commit |

其他 AC 由所属任务/集成报告，不在此重复宣称通过。当前职责内没有计划后置的功能；外部模块集成项明确保留为未验证。
