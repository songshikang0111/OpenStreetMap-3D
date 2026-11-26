# 二期审查后的本机集成复验

测试使用 2026-11-26 的 Linux 工作站、Chrome 158 和 Radeon 780M。数据、运行时和导出分别有可复跑的入口。

## 数据和运行时

- 七份样本重建共 372 块瓦片，其中 126 块内容变化。阿姆斯特丹中心区用 PBF 与独立提取的 JSON 核对，5,278 个建筑身份完全一致。构建中断后复用旧缓存的结果与干净重建相同。[数据验证](../F6/report.md)
- MapLibre 六组相机设置覆盖不对称内边距、调整尺寸和三种像素比。3,702 个轮廓点与宿主投影的最大偏差低于 0.000000011 CSS 像素，双地图能独立高亮。强制 WebGL 创建失败后，独立地图和宿主图层均可重试。[地图隔离验证](../D5/report.md)
- 本机性能对照用相同瓦片和相同计时脚本。首次缓冲提交的单帧峰值从 31.1 ms 降到 10.3 ms，准备与提交合计从 32.1 ms 降到 10.7 ms。4 ms 的整帧上传预算仍未通过。逐帧口径、超限帧数和十分钟回放见[性能验证](../I3/report.md)。

## 导出

阿姆斯特丹运河区完整模型共 12 块最高精度瓦片。产物为 60,775,840 字节，SHA-256 为 `fcbcc6e7ae6bb7bb3c9dea6ed1d420426858f3b3b9be4e602f5ef46938bd2521`。Three GLTFLoader 读出 1,141 个网格节点、580,128 个三角形。Khronos glTF Validator 2.0.0-dev.3.10 报告 0 个错误、0 个警告。模型含地理原点、坐标轴、OSM 来源和许可。Bibury 自动化用例逐块比对变换和三角形总数，还验证了输入损坏时已存在的输出文件保持完整。

```sh
npm run demo:tiles
npm run build:demo
node bin/city.js tiles export apps/demo/public/tiles/amsterdam-canals --output /tmp/canals.glb --json
node scripts/benchmark-tiles/export-checks.mjs
node --test test/phase2-tile-export.test.js
```

恩克赫伊曾城区全部 252 块最高精度瓦片导出为 279,310,732 字节的 GLB。模型包含 59,487 个网格节点，共 5,450,800 个三角形。Khronos 校验的错误、警告均为 0。[完整模型校验](enkhuizen-export.json)

北京独立地图导出的 PNG 为 1280 × 720。读取像素得到 3,817 种采样颜色和 624 个署名区深色像素。当前显示的 8 块瓦片与 GLB 场景根节点逐个吻合，文件包含 36 组网格，大小为 18,967,964 字节。整个导出过程的瓦片请求计数保持为 9，过小的字节预算触发拒绝。[浏览器导出实测](export-browser.json)

## 浏览器、安装和静态检查

- 北京、京都、曼哈顿、上海和阿姆斯特丹通过发布目录子路径冒烟。外部请求 0，控制台错误 0。用 `node scripts/demo-smoke.mjs` 复跑。
- 北京 CPU 射线与 GPU 拾取 100/100 一致。本次本机拾取 p95 为 1.9 ms。高亮和隐藏前后，被选中要素所在瓦片的 7 个网格、几何、顶点与索引缓冲均保持原身份和版本。颜色、重载后状态和遮挡通过。其他机器和历次运行的时延各自记录。[叠加层结果](overlay-checks.json) · [上一次设备观测](../D5/report.md)
- 北京与京都共 27 块瓦片通过静态预算，地图入口 gzip 为 55,840 字节。CI 同时检查覆盖位图、实际文件和内容哈希。空样本的负例会失败。[静态预算](static-budget.json)
- 根包和工作区包以本地 tarball 安装到仓库外的空目录，CLI 校验通过，浏览器显示 9 块瓦片，控制台错误为 0。命令为 `node scripts/pack-install-check.mjs`。

## 最终集成版十分钟回放

用 `d37b296` 构建 demo，加载 F6 瓦片，在 Radeon 780M 独占运行 10 圈。构建和实际服务的瓦片报告 SHA-256 一致。浏览器共记录 601.208 秒、36,048 帧，无空白帧、瓦片错误、控制台错误或上下文丢失。三角形、绘制调用、驻留预算和 Worker 队列均无超限帧。[验收 JSON](desktop-acceptance.json)

| 指标 | 实测 | 门槛 |
| --- | ---: | ---: |
| 首个可用画面 | 821 ms | ≤1,500 ms |
| 帧间隔 p95 | 16.7 ms | ≤16.7 ms |
| 最差一分钟内的长帧 | 1 次 | ≤3 次 |
| L1 Worker 解码与生成 p95 | 116.3 ms | ≤120 ms |
| 每帧对象准备与首次 WebGL 缓冲提交 | 207 帧超限，峰值 66.9 ms | 每帧 ≤4 ms |

命令以状态码 1 退出；本次唯一失败项为 `uploadFrames`。峰值帧在 9 次首次缓冲提交中传入 19,272,352 字节，GL 调用占 66.4 ms，对象准备占 0.5 ms。另一次长跑的 Worker p95 和最差一分钟也曾超限，因此应保留跨运行对照。[前次原始帧复核](../I3/enkhuizen-f6-frame-audit.json)

下一轮优先定位反复出现的 19,272,352 字节申请来自哪些属性或索引，并把分段写入和首次绘制都纳入计时，再用同瓦片重复十圈复验。本轮 Android、iPhone 真机和 500 km² 连续建成区保留为未验证。二十次往返后的共享纹理计数另见 [M2](../M2-acceptance.md)。

```sh
export CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist'
node scripts/benchmark-tiles/path-run.mjs scripts/benchmark-tiles/paths/enkhuizen.json \
  --acceptance --loops 10 --json /tmp/desktop.json --frames /tmp/desktop-frames.json
```

本机原始逐帧 JSON 的 SHA-256 为 `21058412e22a88a996e78ca02e7d44e6909f3f505fcfa2b6e971eb5f37948341`。

最终回归通过 407/407 个根测试、34/34 个工作区测试。示例类型、格式、lint 和生产构建通过。仓库内文档链接检查覆盖 85 个文件，断链为 0。
