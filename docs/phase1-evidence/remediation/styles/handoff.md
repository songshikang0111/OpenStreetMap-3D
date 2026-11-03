# C 修复交接：标准网页携带项目画风

2026-11-03，分支 `codex/phase1-styles-repair`，从 `dee3cc8` 新建，原 `codex/phase1-landmarks` 保留。此处不合并旧组件历史。功能提交：`599c4486b86d4e28917526463b64cca49b51addf`；独立审查修复 `1e4296fba480d7028fa2ec1b706da7ae74e25738`；Schema 对齐 `5c204b212395d357daeb7cf286db6a39d846cd9d`。后续证据文档提交见分支日志。

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

**根 package.json/lock 由 E 所有：将 `esbuild: "0.25.12"` 加入 production dependencies 并更新 lock。** 目前仓库通过 Vite dev dependency 已有该版本；标准导出现在在运行时本地打包，安装包仅装生产依赖也必须具备 esbuild。缺失时明确 STYLE_BUNDLER_MISSING，无 CDN fallback。C 未修改根 package/lock。精确字段见 [package-additions.json](package-additions.json)。建议 E 同时加入公共 Node export `"./styles/project-bundle":{"types":"./src/styles/project-bundle.d.ts","import":"./src/styles/project-bundle.js"}`；源码内部已可复用。

Studio 接线建议（由 E 在 B 合并后实施）：

1. 服务端读取完整 config.style，调用 bundleProjectStyle。只对该项目 safePath 下的缓存目录原子写返回的 assets 和 `{style,styleModule:module}` 描述；缓存应按 report 输入/输出 hash 失效，不以 id 一项判断。
2. 在已有受保护 project 静态路由下增加如 `/projects/:id/style/viewer-config.json` 和该目录相对的 assets。不要开放任意磁盘路径或修改原 source 文件。descriptor 中 `./assets/...` 必须相对于此 JSON URL 解析。
3. 浏览器使用现有 SDK 所用的 `src/styles/index.js` 导出 loader：`loaded=await loadProjectStyle(response.style,{module:response.styleModule,baseUrl:responseUrl})`；再 `createCityViewer({style:loaded,...})`。如果用了别的 styleApi adapter，传入同一完整 style API（不是另建注册表）。
4. 保存时保留 entry/dependencies/assets，只更新当前 id/parameters；原 Studio capture 的 `{id,parameters}` 会丢掉声明，需要 E 修复。四官方画风无 entry 可直接加载；项目画风作为选择器可选项。
5. **CSS 生命周期**：新建或重复打开前，先 `await oldViewer.dispose(); oldLoaded.dispose()`，再加载下一项目。加载成功但创建 viewer 失败时也调用 loaded.dispose()；loader 自身验证失败会移除本次 CSS。多个句柄可同时存在，各自只移除自己的 CSS；dispose 幂等。标准导出 pagehide 已接线。必须把 loaded 句柄保留到页面/项目销毁；只存 id/parameters 不够。

## 验证及边界

新增 test/phase1-styles-export.test.js 覆盖模块/依赖/CSS/资产打包、参数、无效声明/导入、失败保旧站点、重复加载 CSS 释放。真实标准 CLI export 验证脚本：`node docs/phase1-evidence/remediation/styles/verify-standard-export.mjs`。它使用明确标注的合成离线样例，实际运行 city build/export web；打开 `/exports/nonroot/city/index.html`，浏览器请求只允许 loopback，验证 comic/line/color/white/project-sepia、相对模块/依赖/SVG/CSS、参数 .23、刷新、五轮 CSS load/dispose、真实 viewer PNG/GLB 和正式 CLI PNG/GLB，再检查未知画风失败保留旧站点。不是手工 consumer/app，也不是 GPU 基准。

当前修复不触碰 AO 覆盖逻辑：D 负责合法 AO 参数；C 的 config/bundle/loader 保留参数且管线层可验证，但此基线 SDK 仍有 R4，不能宣告整期 AC24 已通过。Studio 真实服务路由/保存/切换需 E 集成；正式安装包生产依赖与新公开 Node export 需 E 接入后复验。AC21 的本组件标准静态导出修复可独立验证；总验收由主对话在 E 冻结提交后执行。


## 验收结果与可集成提交

E 在自己的集成分支按序 cherry-pick **599c448 → 1e4296f → 5c204b2 → 最终证据文档提交**，不要 cherry-pick 老 C 组件历史。边界仅风格契约/helper、标准导出、静态查看器、类型/Schema style 字段和教程测试；没有改 SDK/runtime/AO、local-server、根 package/lock、其他 worktree。

最终功能 5c204b2：独立重跑 **270/270 npm test**、三套 build、test:types、新 C 严格类型消费均通过。实现者也运行全部回归（Schema 小修前269/269，修后六项针对性测试通过）。真实标准 CLI web/png/glb 与 loopback-only 子路径五风格通过，见 [browser-results.json](browser-results.json)、[cli-results.json](cli-results.json)；[validation-results.json](validation-results.json) 汇总命令与边界。输入明确为合成离线 sample，不是 live 地图下载；不是 GPU 基准。浏览器与预览临时 profile 已关闭，完整产物留在 ignored work。

独立审查发现并修复：

1. P2：loadProjectStyle 成功但 viewer 初始化/相机设置失败，旧 catch 未释放 CSS。1e4296f 将句柄提升作用域，catch 释放 viewer 与 CSS；pagehide 用 finally 保证 viewer.dispose 抛错也释放 CSS。
2. P2：声明资产文件名含 #/% 时 URL 未逐段编码导致404。1e4296f 对 JS/descriptor URL 编码，CSS输出资源用纯hash名称；三路独立 HTTP200；不把声明的原始 CSS 当另一份样式重复加载。
3. P3：dependencies propertyNames Schema 允许 foo/. 或 foo/..，运行时拒绝。5c204b2 同步负向段校验并补合法/非法标识符对照测试。

| 范围 | 状态 | 依据与限制 |
| --- | --- | --- |
| AC21 C 标准静态导出 | pass | 真实 city export web，四官方+外部、保存参数/刷新、相对JS/映射依赖/CSS/SVG、子路径、拒绝外网、坏入口/未知id保留旧站点 |
| AC22 C 共用导出解析 | pass | 标准产物 viewer PNG/GLB 与正式 CLI PNG/GLB，签名/哈希；GLB效果边界仍有说明 |
| AC24 C 风格契约 | pass | 类型/Schema/纯校验/helper/教程与行为一致；全项 AO SDK R4 仍归 D，不在C宣布通过 |
| AC27 C 独立审查 | pass（组件） | 非实现者 gpt-6.1-sol / xhigh / fork none，审查599c448，发现3项，复验5c204b2，最终无未解决C缺陷 |
| E 安装包/Studio真实接线 | not-run | 生产 esbuild/Node export、路由/保存/切换/lifecycle由E合入后验证 |
| D AO与全期最终矩阵 | not-run | 未修改也未冒充修复；主对话最终独立整体验收 |

当前没有职责内后置的功能缺口。E 的依赖声明和服务/UI接线是集成动作，已给出具体代码契约与释放顺序；未把源码目录的成功测试宣称为已完成生产安装包验证。


## 独立报告归档

[原样独立审查报告](independent-review.json) 包含首轮三个发现、最终实际提交、两轮原始浏览器结果、CSS正常/失败/pagehide/并存句柄、特殊文件名三路径HTTP状态、CLI产物与剩余集成依赖。审查者 `/root/styles_repair_review`，明确 gpt-6.1-sol / xhigh / fork_turns none，未编辑受跟踪文件或创建提交。最终功能5c204b2无未解决C组件缺陷。完整独立270项TAP见 [independent-tests.tap](independent-tests.tap)。

最终证据文档提交不改变产品代码。独立通过只限以上C责任范围；根验收历史失败报告保持原样，不能凭此提前把全期矩阵改成通过。


## 主对话追加 P2：参数规则契约（2026-11-03）

主对话在集成架构独立复验发现 integer 规则未执行：count:{type:'integer',minimum:0,maximum:5} 接受1.25，真实 bundle 对保存 -2.75 返回成功。此问题不通过只检查负数修补；本轮统一 register/resolve/load/bundle 的 primitive 参数契约。

- `src/styles/parameters.js` 是轻量共享校验器，不引入 JSON Schema 引擎。支持有限 number、安全 integer、boolean、string；数值范围必须有限且有序，integer 区间必须包含安全整数。拒绝未知类型、类型数组和未支持关键字。
- 注册时检查 schema/default/enum：enum 非空、唯一、同类型且符合范围；default 同样符合规则并属于 enum。number/integer 不转换字符串；boolean/string 不接受数值范围。
- 仅省略参数键才使用 default。明确的 null/undefined 值失败；无 default 的可选键省略。省略或 undefined 的 parameters 容器视为空对象，null/数组/其他原始容器失败。0/false/空字符串保留。重新读取已注册且被修改的 schema 也重验，避免绕过。
- 类型提供 StyleParameterRule 判别联合及 StyleParametersSchema；style.schema.json 限制为同一 primitive 子集。Schema 的注释明确跨字段默认值/范围/enum 一致性由共享运行时追加检查。教程和官方样式包说明同步。
- 新增直接注册/解析/加载边界和真实本地 bundle/export 回归：非法整数、null、未知规则、无效 default/enum 全部拒绝，旧 viewer-config/site 保持不变。新增严格类型消费包含预期编译失败断言。

本分支追加功能修复前的验证：274/274 npm test、三套 build、test:types、parameter-typecheck.ts 全部通过。独立审查会在实际提交上复验并单独归档；此前270项和初次review保持为历史证据。E 应先合入此次新增提交再运行最终 types/build/package/GPU；没有修改 SDK/runtime/AO、local-server、根 package 或集成 worktree。
