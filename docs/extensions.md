# 扩展指南

先运行离线样例，确认工具链、浏览器和 WebGL 2 正常；新增扩展只修改项目目录。公共签名见 `.d.ts` 和 `schemas/`，完整约定见 [规划 §12](phase1-plan.md)。

## 添加画风

将 [独立 sepia 画风](../examples/quickstart/sepia-style.js) 复制到自己的 `styles/sepia.js`。它覆盖建筑、玻璃、屋顶、结构、道路、水、树、地面、设施、地标，并声明兼容范围、参数 Schema、回退角色和资源释放。加入自己应用：

```js
import {createCityViewer} from 'beijing-city-ink';
import {registerStyle} from 'beijing-city-ink/styles';
import sepia from './styles/sepia.js';

registerStyle(sepia);
const viewer = await createCityViewer({
  container: document.getElementById('city'),
  manifestUrl: './scene/manifest.json',
  style: 'project-sepia',
});
await viewer.whenIdle();
await viewer.setStyle('comic');
```

使用 Vite 等打包器运行上述顶层 `await` 示例时，将 `build.target` 设为 `es2022`；也可以把初始化包在异步函数中。页面容器需要明确宽高。

风格不重新下载数据。仅材质、灯光、后处理变化可实时绑定；改变密度/几何必须声明 `rebuildParameters`，修改项目生成配置后重建。创建的材质、纹理和 render target 需要由绑定或管线的 `dispose` 释放，不释放调用者共享资源。使用原有程序立面时保留语义角色和 `facade-v6` 属性。

验证：用相同清单在 comic/line/color/white/自定义画风间切换，检查所有角色、近远景和连续五次切换后的资源数；SDK 与工作台不能各自维护一套生成规则。

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
