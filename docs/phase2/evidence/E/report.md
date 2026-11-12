# WP-E 交付报告：拾取、要素状态与叠加层

分支：`phase2/E-overlays`（基于 `phase2/D-map`）。机器：AMD Ryzen 7 7840S，集成显卡 Radeon 780M（非用户指定的参考设备），Chrome 150，Linux 7.2。日期：2026-11-12。

## 交付内容

- GPU 拾取（`packages/map/src/picking/picker.ts`）：只渲染光标下 1 个像素的 ID 通道，RGB 为 renderId，A 为瓦片或叠加层槽位；被隐藏的要素不参与拾取。
- 要素状态（`picking/feature-state.ts`）：每块瓦片和每个叠加层一张按 renderId 索引的 RGBA8 纹理，顶点着色器读取；`hidden`、`highlight`、`color` 生效且不重建几何。因为 three.js 只在材质切换时上传内置材质的 uniform，每块瓦片使用同一程序的轻量材质副本，各自绑定状态纹理。状态在 L0/L1 切换和瓦片卸载重载后重新应用。
- 叠加层（`overlays/overlay.ts`）：`line`（屏幕像素宽度的条带）、`fill`、`extrusion`（高度和底高可取要素属性）、`circle`（屏幕像素半径）、`custom`；按墨卡托比例的锚定组放置，浮动原点重设后自动更新位置和比例；全部参与拾取，事件中 `feature.layer` 为图层 ID。
- `apps/demo/overlays.html`：五种图层、标记、点击显示属性并高亮。

复现：`npm run demo:tiles && CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" node scripts/benchmark-tiles/overlay-checks.mjs --json docs/phase2/evidence/E/overlay-checks.json`

## AC 结论

| AC | 结论 | 结果摘要 |
| --- | --- | --- |
| AC501 | 通过 | 100 次随机拾取全部命中建筑，且点击点都落在被拾取建筑三维包围盒的屏幕投影内；返回 OSM 身份、图层、保留标签与来源等级 |
| AC502 | 通过（非参考设备） | 单次拾取主线程耗时 p50 0.6 ms、p95 0.8 ms（上限 4 ms）；参考设备未测 |
| AC503 | 通过 | 设置高亮与红色后渲染像素变为红橙色；隐藏后不再被拾取；几何数不变；切到 L0 和卸载重载后仍隐藏；清除后恢复 |
| AC504 | 通过（非参考设备） | 旋转动画中帧间隔 p95：无标记 16.7 ms，500 个标记 16.7 ms（增量 0） |
| AC505 | 通过 | 浮动原点重设后标记屏幕位置误差 2e-13 px；填充图层在原经纬度被拾取，边缘内命中、外侧不命中 |
| AC506 | 通过 | 五种类型各有可运行例子；线宽在缩放 15.5、17、18.5 下均为 12 px |
| AC507 | 通过（非参考设备） | 10 万顶点的线图层首次添加 74–94 ms（上限 100 ms） |
| AC508 | 通过 | 叠加层拾取返回正确的图层 ID 与要素 ID |
| AC509 | 通过 | 移除五个图层后几何数从 172 降到 160（≤ 添加前）；移除 500 个标记后 DOM 节点为 0 |

WP-D 的全部浏览器检查在本次改动后复跑仍通过；`npm test` 359 项通过。

## 限制

- 标记的 `occlude`（被建筑遮挡时隐藏）未实现，选项被忽略。
- 线条在折角处没有连接与圆头，宽线在急弯处会出现缝隙。
- 状态的高亮颜色和强度为固定默认值，由 WP-G 的 `featureState` 风格配置接管。
- 性能数据来自非参考设备。
