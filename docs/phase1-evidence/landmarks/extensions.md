# 地标与风格扩展：最小可运行流程

2026-11-03，接口版本 1。代码入口为 `src/landmark-registry.js` 和 `src/styles/index.js`，相邻 `.d.ts` 与 `schemas/landmark-recipe.schema.json`、`schemas/style.schema.json` 提供契约。使用 `npm ci` 后运行 `node --test test/phase1-landmarks.test.js test/phase1-styles.test.js test/phase1-landmark-packages.test.js`。

## 添加配方

```js
import {createLandmarkRegistry} from '../../../src/landmark-registry.js';
import pack from '../../../packages/landmarks/index.js';
const recipe = structuredClone(pack.recipes[0]);
recipe.id = 'my-zun-variant';
recipe.version = '1.0.1';
recipe.parameters.ribWidth = .7;
const registry = createLandmarkRegistry({recipes:[recipe]});
const ctx = {origin:{lat:39.9095,lon:116.4605}, bounds:data.bounds, seed:1, features:data.buildings};
const matches = registry.match(data.buildings,ctx);
const {group,claimedFeatureIds,provenance,diagnostics} = registry.generate(matches[0],ctx);
```

显式改 `match.osm` 和 geographic bounds 才能用于另一建筑；名称不能用于全局替换。生成独立 `Group`，不修改输入。输出 claimed IDs 在排序变化后稳定，成功后才取消通用建筑。配方可以通过 `overrides:{'china-zun':recipe}` 替换同 ID 官方规则，或 `false` 禁用；冲突按 priority（高优先）和 ID 字典序选择并报告诊断。`recipes:[]` 完全关闭默认配方。

自定义生成器用 `generators:{'my/generator': (match,ctx)=>result}` 注册。ctx.features 是已认领完整组的深拷贝；至少写 mesh.userData.city 语义和 group/source provenance，返回不变的 claimedFeatureIds、独立 group 和 diagnostics。生成器是受信任模块，不解释 recipe 内字符串代码。可复用 `src/generators/mesh-tools.js` 中 MeshWriter、polygon、addBox、addBeam，以及 `src/landmarks.js` 的 roundedRing、cctvRing、cctvOffset 和 `src/facade-loft.js` 的 writeLoftSkin。`writer.mesh(material,name,{groupRoles:true})` 按 glass/wall/roof/structure 重排顶点和合并角色段，保留所有程序属性，不为每根竖肋增加一个 draw group。

`match` 返回普通数组；验证失败诊断位于 `registry.diagnostics`，也可用 context.onDiagnostic 接收。缺件、未知生成器、兼容失败或生成失败在 degraded 模式退回；`context.policy:'strict'` 抛带 code/diagnostic 的 Error。重新生成序列化 match 时传 context.features；不依赖以前 match 的私有引用。普通调用可省略，注册表为原 match 保留 WeakMap。不要同时跨异步任务共享依赖 diagnostics 状态的注册表。

## 添加独立风格

把 `packages/styles/cel.js` 复制到项目外目录，改 ID，再 `const {default:style}=await import(pathToFileURL(path))`（Node）或用网页可访问 URL 动态导入（浏览器），然后 `registerStyle(style)`。`bindSceneStyle(group,{style,shared})` 和 `createStylePipeline({renderer,scene,camera,style,shared})` 无需修改核心。完整用例与生命周期见 `packages/styles/README.md`。本例真正替换材质类型、渐变纹理、雾和渲染管线，并覆盖道路、水、树和地标。

场景编解码必须保存 mesh.userData.city、geometry.userData.city、groups、facade-v6/foliage-v1 shader 标记、实例矩阵/颜色以及程序属性；解码后调用 bindSceneStyle。`annotateSceneSemantics` 仅是旧 buildCity 的一次性适配，不应替代新场景协议的语义记录。示例不依赖 A 的未合并 codec；组件测试使用 Three ObjectLoader 验证序列化后重新绑定，A/D/E 集成时必须通过实际 codec 复验。静态网页应打包样式模块及 Three.js，不能要求生产访客连接本机服务。

## 更新与回退

`checkLandmarkPackage(pack)` 返回 valid/diagnostics/lock；lock 只描述包/配方版本与兼容范围，B 的 CLI 还需锁存归档/内容哈希、原锁文件及更新范围。测试会执行本地 npm pack、离线安装 1.0.0 → 1.1.0、写临时锁、使用真实北京输入重建几何、再装旧归档并恢复锁与几何哈希。普通 build 不查 latest。组件不负责 CLI 下载/原子写入和全项目缓存失效；B 集成此纯 helper。

## 验证与浏览器

`browser.html` 是开发验收页面，实际创建 WebGLRenderer、真实北京地标子集和测试道路/水/树，序列化重新加载，再依次渲染五个风格。`verify-browser.mjs` 使用本地 Playwright 和 Edge；运行方法写在 handoff。它检查 WebGL shader 错误、非空像素、角色覆盖并保存截图。测试水体与树点是明确 fixture，地标来自仓库 OSM 快照；不是整城性能报告。原 138 项测试、生产 build 仍须通过。远景性能、跨块归属、真实 SDK 静态导出由 A/D/E 集成复验，不能把这些组件测试当全部 AC 通过。
