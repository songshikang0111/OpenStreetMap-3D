# 05 风格契约

由 WP-G 实现，位于 `packages/styles` 和 `packages/styles-ink`。

## 1. 目标

- 开发者只改一个配置对象就能换肤，不需要读着色器。
- 需要深度定制的开发者可以用代码完全接管材质和后处理。
- 核心与任何具体视觉风格解耦：默认体验是朴素、克制、通用的；漫画等强风格是可选包。
- 一期的 `StylePack` 接口和四种官方风格继续可用。

## 2. 三个层次

| 层次 | 形式 | 能改什么 | 面向 |
| --- | --- | --- | --- |
| 样式配置 `StyleSpec` | JSON 对象 | 各语义角色的颜色与材质参数、光照、雾、天空、立面窗格开关、按属性着色 | 大多数开发者 |
| 风格包 `StylePack` | 代码（一期已有） | 自定义材质、着色器、后处理管线 | 需要独特视觉的开发者 |
| 几何选项 | 运行时生成器参数 | 屋顶细节、近景附件、树形精度 | 性能与观感取舍 |

样式配置由一个内置的通用风格包解释执行。也就是说，`StyleSpec` 是数据，`StylePack` 是解释它的代码；默认风格全部用 `StyleSpec` 表达。

## 3. 语义角色

瓦片中的每个子网格都带一个材质角色。角色集合沿用一期：

`wall`、`glass`、`roof`、`structure`、`road`、`water`、`foliage`、`ground`、`facility`、`landmark`。

二期补充子角色，用点号表示，未识别的子角色回退到父角色：

- `road.motorway`、`road.primary`、`road.minor`、`road.footway`、`road.marking`
- `ground.pavement`、`ground.green`、`ground.plaza`
- `foliage.broadleaf`、`foliage.conifer`、`foliage.trunk`
- `roof.flat`、`roof.pitched`

角色清单是公共契约，新增角色必须同步更新 `schemas/style-spec.schema.json`、类型和本文件。

## 4. 样式配置规范

~~~json
{
  "schemaVersion": 2,
  "id": "light",
  "name": "Light",
  "extends": null,
  "environment": {
    "background": "#eef1f4",
    "fog": {"color": "#eef1f4", "start": 0.6, "end": 1.0},
    "sun": {"azimuth": 135, "altitude": 50, "color": "#ffffff", "intensity": 1.0},
    "ambient": {"color": "#ffffff", "intensity": 0.6},
    "shadows": true
  },
  "roles": {
    "wall": {"color": "#e9e6e1", "roughness": 0.9},
    "glass": {"color": "#b9c7d3", "roughness": 0.2, "reflectivity": 0.4},
    "roof": {"color": "#d6d2cb"},
    "road": {"color": "#c9ccd1"},
    "road.marking": {"color": "#ffffff"},
    "water": {"color": "#a9c8e6"},
    "ground": {"color": "#f3f2ee"},
    "ground.green": {"color": "#cfe3c0"},
    "foliage": {"color": "#9cc48a"},
    "structure": {"color": "#bdbdbd"},
    "facility": {"color": "#9a9a9a"},
    "landmark": {"inherit": true}
  },
  "facade": {"windows": true, "density": 1.0, "nightLights": false},
  "rules": [
    {"layer": "building", "when": ["==", ["provenance", "height"], "inferred"], "set": {"wall": {"opacity": 0.85}}},
    {"layer": "building", "when": [">", ["get", "height"], 150], "set": {"wall": {"color": "#dfe6ee"}}}
  ],
  "featureState": {
    "highlight": {"emissive": "#ffb300", "emissiveIntensity": 0.6},
    "hidden": {"visible": false}
  },
  "hostCompatible": true
}
~~~

规则：

- `extends` 可以引用内置风格 ID，只写需要覆盖的部分。
- `fog.start` 和 `fog.end` 是相对于可见距离上限的比例。
- `rules` 使用小型表达式子集：`get`（取属性）、`provenance`（取来源等级）、`==`、`!=`、`<`、`<=`、`>`、`>=`、`all`、`any`、`!`、`in`。不支持任意脚本。表达式在瓦片加载时求值并写入逐要素属性，不在每帧求值。
- `featureState` 定义 [04 第 6 节](04-runtime-sdk.md) 中状态键的外观。
- `hostCompatible` 声明能否用于 MapLibre 图层模式。
- 补充字段（决策 E8）：角色样式的 `blend`（`replace` 默认，`multiply` 保留并着色生成器颜色）、`environment.ambientOcclusion`（墙脚接触暗化，0–1）、`environment.ambient.ground`（半球光地面色）。完整 Schema 见 `schemas/style-spec.schema.json`，校验函数为 `@city-ink/styles/spec` 的 `validateStyleSpec`。
- 校验沿用一期风格参数的严格策略：未知字段、类型不符、非法颜色都明确拒绝并给出路径，不静默忽略。
- 运行时调用 `setStyle` 切换样式配置不得重新取瓦片；只改颜色和光照时不得重建几何。

## 5. 真实性过滤

~~~ts
interface ProvenanceFilter {
  buildings?: { minHeightProvenance?: 'observed' | 'derived' | 'inferred' };  // 默认 inferred，即全部显示
  trees?: { inferred?: boolean };          // 默认 true
  roofs?: { inferred?: boolean };          // 默认 true（仅当瓦片构建时开启了屋顶推断才有内容）
  details?: boolean;                       // details 包生成的对象，默认 true
}
~~~

- 过滤在运行时生效，不需要重新构建瓦片。
- 被过滤掉高度的建筑不是消失，而是按"无高度"处理：显示为贴地轮廓。完全隐藏需使用样式规则。
- demo 中提供一个开关直观展示"全部"与"仅真实数据"的差别。

## 6. 默认风格

| ID | 描述 | 用途 |
| --- | --- | --- |
| `plain` | 白模，单色加柔和阴影，无窗格 | 作为数据可视化的底，或自定义风格的起点 |
| `light` | 浅色配色，有窗格和玻璃，白天光照 | 默认风格 |
| `dark` | 深色配色，可选夜间窗灯 | 深色界面、夜景 |

要求：

- 三者全部用 `StyleSpec` 表达，不含后处理通道，以保证在移动端和 MapLibre 图层模式下可用。
- 保留一期的程序化立面窗格（着色器实现，成本低），这是默认观感的主要来源。
- 每种风格在北京国贸、京都祇园、曼哈顿三个样本上做固定机位截图对照，作为视觉回归基线。截图不进主仓库（见 07）。

## 7. 风格化风格包 `styles-ink`

- 一期的 `comic`、`line`、`color`、`white` 四种风格和 `cel` 例子迁入此包。
- 根包为保持一期兼容，继续能通过原来的 ID 使用它们（内部转为依赖 `styles-ink`）。
- 新的 `createMap` 默认不包含它们，需要显式引入：

~~~js
import { comic } from '@scope/styles-ink';
const map = await createMap({ /* … */ style: comic });
~~~

- 此包同时是"第三方能把本项目做成什么样"的示范，README 应把它作为定制案例介绍。

## 8. 自定义风格包

`StylePack` 接口沿用一期（`getStyle`、`registerStyle`、`bindSceneStyle`、`createStylePipeline`），二期的变更限于：

- 绑定时可以取得要素的属性、来源等级和状态，用于按属性着色。
- 新增可选的 `hostCompatible` 和 `supportsTiles` 声明。
- 新增 `onTileLoad` / `onTileUnload` 钩子，替代一期对整个场景组的一次性绑定，以适应流式加载。

`docs/extensions.md` 的"添加画风"教程需要按新接口更新，并保留一期项目内风格入口的打包流程。

## 9. 验收要点

对应 09 中的 AC701–AC710。
