# 一期 E：工作台、集成与总验收交接

分支：`codex/phase1-integration`。唯一开发目录：`C:\Users\宋世康\.codex\worktrees\phase1-integration\beijing-city-ink`。未在原main开发、合并main、推送、远端发布或部署。产品功能修复至 `2c013fb`，最终浏览器性能冻结入口提交 `9407af9`。**当前最后矩阵正在运行；一期不是全部验收通过状态。**

## 集成和实现

A `198a8e0`、B `e626097`、C `8300ee7` 已完整合入；D自有实现及最终证据 `176d798` 顺序cherry-pick，未重复引入它的A/C依赖副本。组件交接在 ../core、../data、../landmarks、../runtime。最终判断以本目录整合证据为准，组件报告不替代最终验收。

工作台真实调用本地服务并使用公共SDK：定位候选、具名bbox/半径、项目创建保存重开、下载或CLI导入后的真实worker构建、进度/取消/断线重连与恢复、来源/高度/屋顶/地标报告、画风/质量/相机、PNG/完整GLB/静态网页。内置样例明确是合成街区。没有mock成功生成器或另建一套工作台模型。

根bin/exports/types/build、生产studio、独立SDK bundle、quickstart、离线包安装检查、CI与扩展/支持文档已接线。静态网页携带全部本地资源，相对路径可嵌套部署，无CDN运行时。Chrome/Edge原生CDP导出适配器使用自己的临时profile与loopback-only网络限制，不接管用户配置。

集成修复包括：统一low/import/锁对象配置契约；相机/画风/质量保存不使几何过期；官方配方纳入引擎指纹；正式registry只接管一次并清理旧体块/屋顶/通用近框；保留权威角色groups/属性和自定义实例属性；SDK纯validator不带compiler；序列化nearDetails/drawUnits；全帧GPU查询与程序资源计数；GLB实例色/单实例身份和编码后取消；drawUnits预算成本防御；FOV范围及向上看的街道相机/旧阻尼修复。

重点提交：`e2ad1b2`（GPU/地标近框）、`0d33378`（实际GLB回归修复）、`73738b3`（预算协议防御）、`6f77859`（FOV统一）、`2c013fb`（街道相机）、`29ebab7`（服务测试等待实际状态）、`9407af9`（最终工具链/独立浏览器证据）。完整提交列表见本分支git log。

## 验证

已完成264/264测试、严格TS、三套build、真实端到端七项、121文件pack/隔离离线安装、两个独立角色审查与缺陷复验。实现者最终工作台实际操作与截图已归档；独立CUA工作台流程受工具URL确认限制not-run，见 acceptance.md 明确边界。最后12×60秒真实北京/京都性能与每例五次往返正在运行；完成前不宣布性能全通过。

原始证据入口：[逐项AC](acceptance.md)、[端到端](e2e-results.json)、[包](package-results.json)、[CPU构建](build-results.json)、[真实网络失败](network-results.json)、[工作台](studio-ui-results.json)、[架构独立审查](review-architecture/final-review.md)、[SDK独立审查](review-studio/README.md)。

## 运行与恢复

```powershell
Set-Location C:\Users\宋世康\.codex\worktrees\phase1-integration\beijing-city-ink
npm ci
npm run build
npm run studio -- --workspace ./work/studio
```

打开输出的localhost URL，点击内置离线样例。CLI使用 `node bin/city.js --help --json`；SDK/扩展教程见根README与docs/extensions.md。静态导出：`node bin/city.js export web --project ./work/my-city --json`，再 `node scripts/serve-static.mjs ./work/my-city/site --port 4180`。

验证复现：`npm test`、`npm run test:types`、`npm run check:package`、`node scripts/phase1-integration-check.mjs`。真实性能：先 `node scripts/phase1-build-cases.mjs`，再 `node scripts/benchmark-integration/run.mjs`，最后 `node scripts/phase1-summarize.mjs`。构建/场景/项目/缓存仅在忽略work，原始统计与截图保存在本目录。复现独立原脚本前按各review目录README复制回原work层级，以保留相对import。

## 必须保留的未通过项

AC04真实小范围下载仍TIMEOUT/502：在可访问默认Overpass的环境重跑明确小范围fetch，核对URL/query/时间/许可/哈希与成功缓存；fixture、旧快照或切换端点不能补成live成功。普通build/export仍可使用本地导入或已有缓存。

AC18默认600000全帧三角/1200draw预算不适合全部完整/密集范围；最低LOD仍会超限并明确诊断。需进一步简化最低覆盖或缩小项目范围，不能提高报告预算、删除压力样本或删必要覆盖来改写为通过。当前性能目标达标与预算达标应分开判断。移动GPU及未实测平台无支持承诺。
