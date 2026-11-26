# M2 地图与叠加层验收

| 项目 | 结论与依据 |
| --- | --- |
| AC401–410、413、414 | 本机通过。相机、覆盖、迟滞、空闲、取消、后台生成、重试、整帧统计与 GPU 样本见 [D](D/report.md)、[D2](D2/report.md)、[集成版实测](K/map-browser.json)和 [D3 预算与冷缓存取消对照](D3/report.md)。以 `map-checks.mjs`、`maplibre-camera.mjs`、`bundle-check.mjs`（位于 scripts/benchmark-tiles）、`npm test`、`npm run test:types` 重跑。 |
| AC411 | 严格计数未通过。20 次往返估算驻留稳定，销毁后几何、程序归零，4 个 Worker 终止。Three.js r186 的共享 DFG 查找表在计数中留下 1 个纹理。独立地图主动释放自有 WebGL 上下文，宿主地图的上下文继续运行。见 [D2](D2/report.md)。 |
| AC412、415 | Android、iPhone 真机触控及 RTX 4090 的二期路径未验证。 |
| AC501、503–506、508、509 | 本机通过。用独立 CPU 三角形射线先选定 100 个像素和预期 OSM 身份，GPU 精确命中 100/100，见 [K 对照](K/overlay-identity.json)。状态持久、五种叠加层、500 个标记、投影、回收见 [E](E/report.md) 和 [D2](D2/report.md)。 |
| AC502、507 | 高端指定设备未验证。本机结果按环境单列，参见 [E](E/report.md) 和 [D2](D2/report.md)。 |

AC1101–1104 的整体验证见 [K 集成记录](K/report.md)。
