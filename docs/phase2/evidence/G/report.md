# WP-G 交付报告：风格契约、默认风格与瓦片模式观感恢复

分支：`phase2/G-styles`（基于 `phase2/C2-visual-fixes`）。机器：AMD Ryzen 7 7840S，集成显卡 Radeon 780M（**非用户指定的参考设备**），Chrome 150（无头，`--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist` 硬件 GPU），Linux 7.2，Node v24.18.0。日期：2026-11-13。

按协调方调整后的顺序完成：(1) 窗格着色器、阴影、三套默认风格、StyleSpec；(2) 一期漫画等风格迁入 `styles-ink` 并在瓦片模式可用；(3) 装饰包 `details` 落地（追加任务）；(4) 近景窗框、窗台、阳台；(5) 规则、真实性过滤、要素状态外观、风格包流式钩子、扩展教程。

## 交付内容

- `@city-ink/styles`：`spec`（StyleSpec 严格校验、`extends` 合并、规则表达式）、`defaults`（`plain`、`light`、`dark`，均为 StyleSpec 数据，无后处理）、`facade-shader`（一期立面着色器迁入，`src/facade-shader.js` 转发；瓦片模式扩展：墙脚接触暗化、夜间窗灯）。Schema：`schemas/style-spec.schema.json`（一期 `schemas/style.schema.json` 不变，见 E8）。
- `@city-ink/map`：墙与玻璃批次在 L0、L1 都用立面着色器；太阳阴影（每帧拟合视野，每块瓦片自己的深度材质，无瓦片地面处有阴影接收面）；`setStyle` 支持内置 ID、StyleSpec 对象和 `supportsTiles` 风格包（`createPipeline` 整帧后处理、`onTileLoad/onTileUnload`）；`rules` 在瓦片加载与换风格时求值写入逐要素规则纹理；`ProvenanceFilter`（建筑压平为贴地轮廓、隐藏推断树、关闭屋顶推断时用缓存字节重新生成、隐藏装饰层），都不重新取瓦片；`featureState.highlight` 外观来自风格；近景窗框/窗台/阳台（一期 `nearbyFacadeFrames`，受 `nearDetails` 预算限制）。
- `@city-ink/styles-ink`：`comic`、`line`、`color`、`white`（一期 `InkRenderer`：描边、网点、实黑、AO、FXAA；`hostCompatible: false`）和 `cel`。
- `@city-ink/details`：路灯、信号灯、斑马线、路缘石、停放车辆、行人、长椅、推断场地面的运行时生成；构建期新层 `detail`、`landscape`（E10）。
- demo：风格下拉（含 5 种按需加载的 styles-ink 风格）、"street details""observed heights only""inferred roofs"开关。
- 扩展教程 `docs/extensions.md`"添加画风 · 瓦片模式"，可运行文件 `examples/phase2/styles/{use-styles.ts,brand.json,toon-pack.mjs}`。
- 验证脚本：`scripts/benchmark-tiles/style-checks.mjs`（AC703/704/705/706/709，摘要 `style-checks.json`）、`style-shots.mjs`（固定机位截图，写到仓库外）。

## AC 结论

复现前置：`npm run demo:tiles && node apps/demo/build-tiles.mjs manhattan-financial && npm run build:demo`；浏览器脚本都加 `CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist"`。

| AC | 结论 | 验证 | 结果摘要 |
| --- | --- | --- | --- |
| AC701 | 通过（人工查看） | `node scripts/benchmark-tiles/style-shots.mjs <仓库外目录> --styles plain,light,dark --samples beijing,kyoto,manhattan` | 18 张图（3 样本 × 3 风格 × 远景/街道）全部正常渲染、无控制台错误。截图不入库 |
| AC702 | 通过 | `node --test test/phase2-style.test.js`；`style-checks.mjs` AC705-browser | 05 第 4 节示例原样通过校验；只改角色颜色和规则即得到明显不同外观（规则色像素 74,871 个，切回 plain 为 0） |
| AC703 | 通过 | 同上 | 14 类非法配置全部拒绝且错误含字段路径；浏览器中 `setStyle` 抛出 `STYLE_INVALID`（路径 `$.roles.wall.color`），原风格保留 |
| AC704 | 通过（非参考设备） | `style-checks.mjs` | dark/plain/light 间切换 5 次：网络请求 0，几何数 143 → 143，`setStyle` 加下一帧 15.8–20.2 ms（上限 100 ms） |
| AC705 | 通过 | `test/phase2-style.test.js`；`style-checks.mjs` | 05 示例两条规则各有测试，`in`/`all`/`any`/`!` 也有测试；浏览器中按高度规则着色生效 |
| AC706 | 通过 | `style-checks.mjs` | 北京国贸 9 块的 16 块 L1 全部加载：共 281 栋；"仅真实高度"显示 21 栋（报告 observed 21），"derived 及以上"153 栋（报告 21+132）；新增请求 0。树/屋顶/装饰开关切换：三角形 1,041,158 → 893,482 → 1,041,158，请求 0 |
| AC707 | 通过 | `npm test`；`test/phase2-style.test.js` | 一期风格测试全部通过；根包 `getStyle('comic'|'line'|'color'|'white')` 可用 |
| AC708 | 通过 | `test/phase2-style.test.js`；`bundle-check.mjs` | `packages/map/dist` 无任何对 `styles-ink`、`ink-renderer`、`halftone` 的 import；主包 137,066 B（gzip 41,683 B） |
| AC709 | 通过 | `style-checks.mjs` | `toon-pack.mjs`（只用传入的 three 命名空间）：`loaded` 集合与地图就绪瓦片一致（19 块），移到 30 km 外后仍一致（4 块） |
| AC710 | 通过 | `npm run test:types`（含 `use-styles.ts`）；`test/phase2-style.test.js` | 教程三段代码都有对应可运行文件且通过严格类型检查 |

其余复跑：`npm test` 372 项通过（一期 359 项全部通过）；`npm run test:packages`、`test:types`、`build`、`format:check`、`scripts/phase2-pack-check.mjs` 通过；WP-D/E/H 浏览器检查与 `style-checks` 共 34 项 PASS。

## 与一期旧演示的对照（本人查看截图）

一期 `dist/index.html?site=beijing|kyoto` 默认机位（漫画网点）截图，与瓦片模式同地点的 light、dark、plain、comic 截图对照（都在仓库外临时目录）。

已恢复：
- 程序化立面窗格（一期着色器原样复用），近处有窗洞、幕墙分格、石材/砖分缝；L0 远景同样有窗格且与 L1 同色。
- 太阳阴影：建筑投在地面和邻楼上的阴影清楚可见；comic 风格中阴影以网点呈现。
- 漫画后处理：`comic` 下出现一期的黑色描边、网点、实黑窗洞、纸色地面，北京远景与一期默认画面观感已很接近；`line`、`color`、`white` 可用。
- 近景附件：低空时出现窗台、窗框、阳台（京都近景约 9,500 个实例，北京约 4,200 个）。
- 街道小品与场地补全：车道标线、斑马线、路缘石、路灯、信号灯、停放车辆、行人、长椅，推断的草坪、铺装；桥梁护栏、扶手、桥墩、楼梯（C2）。
- 墙脚接触暗化（低成本 AO 替代）；dark 风格夜间窗灯。

尚未恢复或不同：
- 一期树木的近景细化树冠（多瓣树冠与枝干 LOD）未迁移，仍为二十面体树冠。
- 一期场地规划中的补种树、停车位与球场标线未写入瓦片。
- 一期屋顶设备的距离 LOD 未迁移。
- 墨线后处理各通道使用覆盖材质，`setFeatureState` 的隐藏/压平只作用于颜色通道（E9）。
- dark 风格的玻璃幕墙反射偏亮，夜景需再调色。
- 京都大量 4–6 层体量仍为平顶（数据多为 `building=yes` 且无层数，保守推断规则不覆盖）。

## 偏离与决策

E8（StyleSpec 补充字段 `blend`、`environment.ambientOcclusion`、`environment.ambient.ground`；Schema 文件名；阴影计入统计）、E9（漫画风格实现位置）、E10（`detail`/`landscape` 层与 `details` 包）。一期与二期运行时内核仍未合并（E6）。构建报告的 `provenance.building` 现不计入被地标配方认领的建筑（另记 `counts.landmarkClaimedBuildings`），以与 L1 建筑要素一致。

## 限制

- 开启阴影后 `getStats().drawCalls/triangles` 含阴影深度通道（约两倍）；开启墨线管线后只反映最后一个全屏通道。
- 京都 demo 开启屋顶推断、装饰与近景后，HUD 中 Worker 生成第 95 百分位约 600–650 ms（WP-C 时约 460–526 ms），非参考设备。
- 移动浏览器、其他 GPU、Windows/macOS 未验证。

## 提交

`595a154`、`7b1a427`、`259eccb`、`81b2d20`、`ff4f955`、`2eab1ee`、`d244e34`，以及本报告所在提交。
