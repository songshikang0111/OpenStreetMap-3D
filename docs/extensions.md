# 扩展指南

先运行离线样例，确认工具链、浏览器和 WebGL 2 正常；新增扩展只修改项目目录。公共签名见 `.d.ts` 和 `schemas/`，完整约定见 [规划 §12](phase1-plan.md)。

## 添加画风

将 [独立 sepia 画风](../examples/quickstart/sepia-style.js) 复制到自己的项目 `styles/sepia.js`，在 `city.config.json` 保存明确入口：

```json
{
  "style": {
    "id": "project-sepia",
    "entry": "styles/sepia.js",
    "parameters": {},
    "dependencies": {},
    "assets": []
  }
}
```

`entry` 是项目内 ESM `.js/.mjs/.ts`，必须 default export 兼容 StylePack，id 与配置一致；模块顶层必须能在 Node 和浏览器求值，DOM/renderer 工作放在工厂内。模块是受信任本地代码。相对 JS/JSON/CSS import 自动跟随；裸 import 除 `three`、`three/*` 与 `beijing-city-ink/styles` 外，须在 `dependencies` 显式映射到项目相对模块文件，例如 `"local-palette":"styles/vendor/palette.js"`。这是离线模块映射，不是自动下载或版本范围；安装依赖由开发者先完成，子依赖也要显式映射。全部文件必须在项目边界内，无软链接逃逸。

图片/字体/二进制文件列入 `assets`，通过静态 import 使用，例如：

```js
import paperUrl from './paper.svg'; // assets: ["styles/paper.svg"]
import {tint} from './palette.js';
// 在工厂内 fetch(paperUrl) / TextureLoader.load(paperUrl)，不要手工拼网页路径。
```

打包器将资产 URL 绑定到输出模块的 import.meta.url；CSS url() 也本地打包。v1 不支持变量动态 import、隐式 Node/网络依赖或 `new URL('./paper.svg',import.meta.url)` 字面量项目路径；后者改为静态 import。所有声明资产都会本地携带。不要在风格运行时代码中另行访问 CDN；任意受信任 JavaScript 的网络行为不是沙箱所能保证，正式离线验收须拦截外网。

```sh
city build --project ./my-city --offline --json
city export web --project ./my-city --output exports/demo --offline --json
city export png --project ./my-city --offline --json
city export glb --project ./my-city --offline --json
```

标准导出使用同一 SDK/注册表，打包所有风格模块、相对依赖、CSS/资产并验证 metadata、id、兼容性及参数；未知 id 必须声明入口。无效入口或参数会在发布前失败，已有站点保留。`viewer-config.json` 记录参数与 `styleModule`，`style-build.json` 记录输入/输出哈希；产物可放在任意 HTTP 子路径，无 CDN/本地服务运行时依赖。PNG/GLB CLI 也先导出同一标准页面再加载画风。GLB 仍只保留基础材质/几何，不保证移植程序后处理。

参数规则是明确的小型子集，`StyleParameterRule`/`StyleParametersSchema` 与 `schemas/style.schema.json` 同步：

- `number`：有限 JavaScript number；`integer`：`Number.isSafeInteger`（±9007199254740991 内）。两者支持包含边界的 minimum/maximum；边界也必须有限，minimum ≤ maximum，integer 范围必须至少包含一个安全整数。整数边界可为小数，例如 .5–2.5 接受1/2，拒绝1.25。
- `boolean` 和 `string`：不做隐式转换，不接受 minimum/maximum。
- 四种规则均可使用 default、非空且唯一的同类型 enum，以及 title/description 字符串说明；default 与 enum 每项都必须满足类型/范围，default 还必须属于 enum。
- 所有参数可省略；只在键未提供时使用 default，无 default 的键从结果省略。明确提供 null/undefined 是非法值，不代表恢复默认。parameters 容器的省略/undefined 表示空对象，null/数组/其他原始值不合法。0、false、空字符串均按其真实值保留。
- 不支持 object/array/null 规则、类型数组、required、pattern、multipleOf、exclusiveMinimum 等未声明关键字；注册、加载及导出均明确拒绝，不会静默忽略。参数对象和规则应为普通对象（或无原型字典）。

例如 `count:{type:'integer',minimum:0,maximum:5,default:1}` 接受0/5，拒绝1.25、-2.75和null；非法默认值或枚举在注册前就报错。Schema 描述元数据形状及基本值类型；运行时还检查字段之间的范围/默认值/枚举一致性，并在发布前拒绝无效配置，保留旧站点。

手工 SDK 集成保留直接 `registerStyle(sepia)` 能力；消费标准打包 descriptor 时可用同一公开解析器：

```js
import {createCityViewer} from 'beijing-city-ink';
import {loadProjectStyle} from 'beijing-city-ink/styles';
const config = await fetch('./viewer-config.json').then(r => r.json());
const loaded = await loadProjectStyle(config.style, {
  module: config.styleModule,
  baseUrl: new URL('./viewer-config.json', document.baseURI),
});
const viewer = await createCityViewer({container, manifestUrl:'./scene/manifest.json', style:loaded});
// 导出 PNG/GLB 与 setStyle 使用同一个已注册 StylePack。
await viewer.exportPNG();
await viewer.dispose();
loaded.dispose(); // 释放这次加载创建的 CSS；切换项目/重复打开时必须调用。
```

不要把项目文件 `entry` 直接当浏览器 URL 导入；先由本地 `bundleProjectStyle(root, config.style)` 生成 descriptor/assets。Node 消费者可从 `beijing-city-ink/styles/project-bundle` 导入该 helper；源码位于 `src/styles/project-bundle.js`，返回 Map，不直接发布或覆盖站点。Studio 接线与缓存/路由说明见 [修复交接](phase1-evidence/remediation/styles/handoff.md)。加载器以传入 descriptor 的 baseUrl 解析所有相对模块/CSS；外部模块必须同站点 origin。`LoadedProjectStyle.dispose()` 只移除该句柄拥有的 CSS，不销毁别的 viewer 的链接，重复调用安全。Studio 应先 `await oldViewer.dispose(); oldLoaded.dispose()` 再切换项目，并在预览失败时也释放句柄。

画风覆盖建筑、玻璃、屋顶、结构、道路、水、树、地面、设施和地标，声明兼容范围、参数 Schema、回退角色与释放。风格不重新下载数据；几何变化应声明 rebuildParameters。保留原有程序立面时使用 `facade-v6` 属性和语义角色。验证相同清单的四官方+自定义画风、保存/重开参数、非根路径、阻外网和至少五次打开/释放，SDK 与工作台共用同一注册表/加载器。

## 添加地标配方

在项目规则包中创建 `package.json` 与 `recipes.json`，沿用 [官方配方包](../packages/landmarks/README.md) 的结构。配方必须有 `schemaVersion/id/version/generator/engineCompatibility/match/anchor/orientation/parameters/materialRoles/source/provenance`。`match.osm` 使用精确的 type + ID，配合位置范围；不能只按模糊名称替换全球建筑。

最小可运行例子：`node examples/quickstart/make-recipe-package.mjs ./work/my-landmarks`。它从官方中国尊配方生成本地 1.0.1 变体，改变竖肋宽度，保留精确身份、来源和兼容范围。编辑输出的 JSON 后使用以下命令；需要含中国尊的真实输入才能观察该规则命中，离线合成小街区不会冒充中国尊。

```sh
city landmarks check ./my-landmarks --json
city landmarks update ./my-landmarks --project ./my-city --json
city validate --project ./my-city --json
city landmarks update --project ./my-city --rollback --json
```

本地规则锁定版本与内容，普通 build 不访问 latest。升级/回退后重建受影响区域，比较 lock、命中与来源报告。缺件、未知生成器或不兼容版本必须诊断，并遵循 strict/degraded 策略。

自定义代码生成器作为受信任 JS 模块由开发者显式导入：

```js
import {createLandmarkRegistry} from 'beijing-city-ink/landmarks';
import {compileScene} from 'beijing-city-ink/core';
const registry = createLandmarkRegistry({
  recipes: [recipe],
  generators: {'my-project/generator': (match, context) => ({
    group: buildMyGroup(match.parameters, context),
    claimedFeatureIds: match.claimedFeatureIds,
    provenance: {kind:'parametric-approximation'},
    diagnostics: [],
  })},
});
const result = await compileScene(raw, config, {landmarkRegistry:registry});
```

为每个 Mesh 写可序列化 `userData.city`：`featureId/sourceIds/kind/materialRole/lodRole`，整组认领全部 `claimedFeatureIds`。不要执行配方中的 eval 或任意 shell。生成器应保留原始高度来源，近远景不改变身份。

## 修复数据与跑回归

先保存原始快照和诊断，检查缺失的节点/关系与高度来源。标准 JSON 可通过 `city data import file.json --project my-city` 导入；不要为了闭合水面伪造边界。修改来源或范围后 build/validate，再检查对象 ID、接缝与渲染。

```sh
npm test
npm run build
node bin/city.js init ./work/extension-check --sample --json
node bin/city.js build --project ./work/extension-check --offline --json
node bin/city.js validate --project ./work/extension-check --offline --json
node bin/city.js export web --project ./work/extension-check --json
```

固定相机和种子复现截图；需要性能结论时使用真实浏览器、1280×720/DPR 1、至少 60 秒路径，保留整帧 draws/triangles、p50/p95/p99、冷启动和五次资源往返。验收证据路径见 [集成报告](phase1-evidence/integration/acceptance.md)。

Studio 中选择“项目外部画风”，在“画风参数与项目入口”填写 ID、项目相对入口、依赖映射、资产数组与参数 JSON，再点击“验证并应用画风”。配置保存前先完成本地打包与参数验证；切换官方画风时只保存该官方 ID 和参数，外部配置草稿在本次打开期间保留。修改画风文件后再次点击验证可重建预览。项目文件必须可信，本地模块会执行代码。

本地 API `POST /api/projects/:id/style-preview` 接收 `{style?: ProjectStyleConfig}`，缺省使用已保存配置；不修改项目配置或静态站点。成功响应的 `preview` 包含 `style`、`styleModule`、`baseUrl`、`sdkUrl` 与输入/文件/hash 报告。客户端先动态导入 `sdkUrl`，再用该模块的 `loadProjectStyle` 和 `createCityViewer`，保持画风注册表一致。项目有运行或排队任务时返回 409；无效入口/依赖/资产/参数明确失败。生成文件仅从 `/projects/:id/style-preview/:hash/…` 的对应缓存子目录提供，metadata 使用可重新验证的缓存策略。
