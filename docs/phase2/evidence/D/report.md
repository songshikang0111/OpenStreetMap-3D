# WP-D 交付报告：地图运行时内核

分支：`phase2/D-map`（基于 `phase2/C-builder`）。机器：AMD Ryzen 7 7840S 笔记本，集成显卡 Radeon 780M，Linux 7.2，Chrome 150。日期：2026-11-12。

## 交付内容

- `@city-ink/map`：`createMap` 与 04 第 3 节全部接口；MapLibre 兼容相机（`transform.ts`）；屏幕空间误差选择与覆盖位图过滤（`selection.ts`）；Worker 池（优先级、取消、可转移结果、崩溃 Worker 退役）；可取消取数与退避重试；替换规则（父级在全部子级就绪前保留、祖先预取与钉住）；分时上传；浮动原点；锚定组；事件、`whenIdle`、`getStats`、署名控件、`dispose`；鼠标与触摸交互及惯性；临时 light/plain/dark 风格。
- 单文件 ESM 构建 `packages/map/bundle/city-map.js`（`three` 外置，Worker 独立成块）。
- `apps/demo`：04 第 2 节最小用法，加载本地构建的北京国贸与京都祇园 9 块瓦片。
- 浏览器验证脚本：`scripts/benchmark-tiles/{map-checks,maplibre-camera,bundle-check,path-run}.mjs`，固定路径 `scripts/benchmark-tiles/paths/*.json`。

复现前置：`npm run demo:tiles && npm run build:demo`。

## AC 结论

| AC | 结论 | 验证 | 结果摘要 |
| --- | --- | --- | --- |
| AC401 | 通过 | `node scripts/benchmark-tiles/map-checks.mjs` | demo 原样运行，北京国贸 8 块瓦片可见、64 次绘制调用、无控制台错误 |
| AC402 | 通过 | `npm run test:types` | `examples/phase2/map-usage.ts` 调用 04 第 3 节每个接口，严格模式类型检查通过 |
| AC403 | 通过 | `map-checks.mjs`；`test/phase2-map.test.js` | 浏览器中 1,000 点往返最大误差 1e-8 px |
| AC404 | 通过 | `node scripts/benchmark-tiles/maplibre-camera.mjs` | 与 MapLibre GL JS 6.16.0 对比，200 组相机（缩放 13–19、俯仰 0–75°、任意方位）× 12 点，最大差 9e-8 px |
| AC405 | 通过 | `map-checks.mjs` | 沿直线平移 60 km，重设锚点 5 次，跟随相机的地面点屏幕位移最大 3e-9 px，锚定对象经纬度误差 < 1e-8 m |
| AC406 | 通过 | `map-checks.mjs` | 缩放 14→17→14 往返两次共 435 帧，逐帧检查无空洞 |
| AC407 | 通过 | `map-checks.mjs` | 静止 2 s 请求数 0；40 次 ±0.4 m 抖动：请求 0、瓦片切换 0 |
| AC408 | 通过 | `map-checks.mjs` | 400 ms 网络延迟下快速移走：4 个过期请求被取消，Worker 队列最大 0（预算 12） |
| AC409 | 通过 | `map-checks.mjs`（未压缩构建 + CDP 主线程 CPU 采样） | 主线程采样中没有 `decodeTile`、`generateTile`、`writeBuildingBody` 等，也没有 Worker 代码块的帧；`buildTileObject`（上传）出现在主线程 |
| AC410 | 通过 | `map-checks.mjs` | 注入失败的瓦片尝试 3 次后发出一次 `tileerror`，父级 L0 保持可见；全部请求都在覆盖位图内 |
| AC411 | 通过（附说明） | `map-checks.mjs` | 京都 9 块 20 次往返，估算驻留字节与几何数不增长（96.7 MB / 69）；`dispose` 后几何 0、程序 0、Worker 4/4 终止、后续调用抛出 `MAP_DISPOSED`。纹理计数剩 1：three.js r186 为 PBR 材质创建的全局 `DFG_LUT` 单例，按设计跨渲染器共享且不释放 |
| AC412 | **未验证**（仿真通过） | `map-checks.mjs` | 桌面 Chrome 的 CDP 触摸仿真：单指平移、双指捏合缩放生效；真实移动浏览器未测试 |
| AC413 | 通过 | `npm test` | 359 项全部通过，含一期全部 `phase1-runtime*` 与 `phase1-e2e*` |
| AC414 | 通过 | `node scripts/benchmark-tiles/bundle-check.mjs` | 主包 67,183 B（gzip 20,940 B，上限 180 KB，不含 three）；Worker 独立成块 443 KB（含 three.js 数学部分与一期建筑代码，按需加载）；`<script type="module">` 加导入映射的页面正常显示 10 块瓦片 |
| AC415 | **未验证** | `CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" node scripts/benchmark-tiles/path-run.mjs <路径>` | 没有一期的 RTX 4090 桌面高端设备。本机（集成显卡 Radeon 780M，非用户指定的参考设备，标记"模拟"）上北京、京都 60 s 固定路径：帧间隔第 95 百分位 16.7 ms，每分钟长帧 1 次，首个可用画面 125–166 ms，绘制调用最多 143。未达标项：主线程单帧上传最大 5.7–8.7 ms（目标 4 ms）；京都密集瓦片 Worker 解码加生成第 95 百分位约 460 ms（目标 120 ms，见 E5） |

## 未完成或偏离

- D1：一期与二期运行时未合并成共用内核，`createCityViewer` 保持原样（决策 E6）。
- D6：临时风格为按角色的标准材质加一期立面配色，未复用一期 `color` 风格绑定（E6）；立面窗格着色器属性已随批次上传，WP-G 接入。
- `queryFeatures` 目前为 CPU 射线求交（WP-E 按 04 第 6 节改为 ID 渲染或优化）；`setFeatureState` 只记录状态；GeoJSON 叠加层留给 WP-E（`addLayer` 对非 `custom` 类型返回 `OVERLAY_UNSUPPORTED`）；`setFilter` 只记录过滤条件（WP-G）。
- 阴影、AO、近景细节预算项已声明但未实现。

## 提交

`feat(map)` 初版、`fix(map)` 替换规则与空闲判定、`feat(map)` 单文件构建与类型例子、`perf(map)` 固定路径基准与上传优化，以及本报告所在提交。

## 已知限制

- 性能数据来自非参考设备，只能作为开发期参考；真机验收归 WP-I，依赖用户决定 D5。
- 无头 Chrome 默认使用 SwiftShader；性能测量必须用 `CITY_BROWSER_FLAGS` 启用硬件 GPU，并以报告中的 GPU 字符串为准。
- GPU 计时（`EXT_disjoint_timer_query`）未接入，帧间隔为整帧墙钟时间。
