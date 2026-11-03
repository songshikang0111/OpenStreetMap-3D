# C 修复交接：标准网页携带项目画风

2026-11-03，分支 `codex/phase1-styles-repair`，从 `dee3cc8` 新建，原 `codex/phase1-landmarks` 保留。此处不合并旧组件历史。最终提交与独立复验结果在结尾更新。

## 契约与改动

`ProjectConfig.style` 新增 `entry?:string`、`dependencies?:Record<string,string>`、`assets?:string[]`；保留 id/parameters。纯校验位于 `src/styles/project-contract.js`，core config 仅增加 style 字段校验调用；同步 core 公共类型、项目 Schema、style 公共类型与 docs/extensions.md。

- entry：项目相对 ESM .js/.mjs/.ts，default export StylePack；Node/browser 兼容的顶层求值，DOM 操作在工厂里。明确检查导出的 id/version/兼容性/参数。
- dependencies：裸导入标识符 → 项目相对模块文件。Three.js/three 子路径与 beijing-city-ink/styles 由引擎提供；其他裸依赖包括子依赖全部显式映射。相对 JS/JSON/CSS import 自动打包。不下载包、不扫描猜测风格。
- assets：项目相对图片/字体/二进制清单，静态 import 或 CSS url()。JS 资产转换为相对最终模块 import.meta.url 的绝对 URL，非根页面正确。声明文件均随产物携带。变量动态 import、远端/Node import、字面量 `new URL('./asset',import.meta.url)` 项目路径不受支持并明确失败，改用静态 import。
- `bundleProjectStyle(root,style,{signal})`（Node，独立文件及 .d.ts）：返回 `{style,module,assets:Map,report}`，不直接发布；module 为 `PublishedStyleModule`（entry/CSS/asset URL/hash），report 记录输入内容 hash 与输出集合/hash。临时验证目录受 safePath 限制并清理。
- `loadProjectStyle(selection,{module,baseUrl,styleApi?})`（公开 beijing-city-ink/styles）：共用现有 getStyle/registerStyle/resolveStyleSelection，返回 `LoadedProjectStyle`，包含 id/完整默认化参数及非枚举 dispose()。它不重新实现 SDK、材质或后处理。
- `src/styles/viewer-entry.js`：重导出现有 SDK 与同一 style registry/loader，esbuild 拆分共享 chunks；外部模块和 SDK 的 Three/风格模块共享。没有修改 SDK/runtime/AO。
- `src/cli/export.js`：先复制 scene 到临时目录，打包并验证风格，再替换 site。未知 id 无入口、缺文件、非法导入/资产或参数均失败，旧站点保留。`studio/static-viewer.js` 先加载注册再 createCityViewer，选择器加入项目画风，切回保留参数。
- CLI PNG/GLB 既有 browser-export 调用 exportWeb，因此同一风格解析和页面自动适用；公共 SDK/其导出使用 loadProjectStyle 返回的 selection，教程覆盖。

## E 必须接入的依赖与路由（不改 B 主文件）

**根 package.json/lock 由 E 所有：将 `esbuild: "0.25.12"` 加入 production dependencies 并更新 lock。** 目前仓库通过 Vite dev dependency 已有该版本；标准导出现在在运行时本地打包，安装包仅装生产依赖也必须具备 esbuild。缺失时明确 STYLE_BUNDLER_MISSING，无 CDN fallback。C 未修改根 package/lock。建议 E 同时加入公共 Node export `"./styles/project-bundle":{"types":"./src/styles/project-bundle.d.ts","import":"./src/styles/project-bundle.js"}`；源码内部已可复用。

Studio 接线建议（由 E 在 B 合并后实施）：

1. 服务端读取完整 config.style，调用 bundleProjectStyle。只对该项目 safePath 下的缓存目录原子写返回的 assets 和 `{style,styleModule:module}` 描述；缓存应按 report 输入/输出 hash 失效，不以 id 一项判断。
2. 在已有受保护 project 静态路由下增加如 `/projects/:id/style/viewer-config.json` 和该目录相对的 assets。不要开放任意磁盘路径或修改原 source 文件。descriptor 中 `./assets/...` 必须相对于此 JSON URL 解析。
3. 浏览器使用现有 SDK 所用的 `src/styles/index.js` 导出 loader：`loaded=await loadProjectStyle(response.style,{module:response.styleModule,baseUrl:responseUrl})`；再 `createCityViewer({style:loaded,...})`。如果用了别的 styleApi adapter，传入同一完整 style API（不是另建注册表）。
4. 保存时保留 entry/dependencies/assets，只更新当前 id/parameters；原 Studio capture 的 `{id,parameters}` 会丢掉声明，需要 E 修复。四官方画风无 entry 可直接加载；项目画风作为选择器可选项。
5. **CSS 生命周期**：新建或重复打开前，先 `await oldViewer.dispose(); oldLoaded.dispose()`，再加载下一项目。加载成功但创建 viewer 失败时也调用 loaded.dispose()；loader 自身验证失败会移除本次 CSS。多个句柄可同时存在，各自只移除自己的 CSS；dispose 幂等。标准导出 pagehide 已接线。必须把 loaded 句柄保留到页面/项目销毁；只存 id/parameters 不够。

## 验证及边界

新增 test/phase1-styles-export.test.js 覆盖模块/依赖/CSS/资产打包、参数、无效声明/导入、失败保旧站点、重复加载 CSS 释放。真实标准 CLI export 验证脚本：`node docs/phase1-evidence/remediation/styles/verify-standard-export.mjs`。它使用明确标注的合成离线样例，实际运行 city build/export web；打开 `/exports/nonroot/city/index.html`，浏览器请求只允许 loopback，验证 comic/line/color/white/project-sepia、相对模块/依赖/SVG/CSS、参数 .23、刷新、五轮 CSS load/dispose、真实 viewer PNG/GLB 和正式 CLI PNG/GLB，再检查未知画风失败保留旧站点。不是手工 consumer/app，也不是 GPU 基准。

当前修复不触碰 AO 覆盖逻辑：D 负责合法 AO 参数；C 的 config/bundle/loader 保留参数且管线层可验证，但此基线 SDK 仍有 R4，不能宣告整期 AC24 已通过。Studio 真实服务路由/保存/切换需 E 集成；正式安装包生产依赖与新公开 Node export 需 E 接入后复验。AC21 的本组件标准静态导出修复可独立验证；总验收由主对话在 E 冻结提交后执行。
