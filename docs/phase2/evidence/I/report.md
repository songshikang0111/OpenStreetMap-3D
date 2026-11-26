# WP-I 交付报告（仅 I3 静态部分）

分支：`phase2/J-docs`（与 WP-J 文档同一分支，基于 `phase2/F-pbf`）。日期：2026-11-13。参考设备（D5）未定，I1、I2、I4 和所有真机验收不在本次范围，**M5 未完成**。

## 交付

- `scripts/benchmark-tiles/static-budget.mjs`：对构建好的瓦片集逐块统计绘制调用（生成批次数加树实例，不含近景细节）、单块 gzip 体积，以及 `@city-ink/map` 单文件包的 gzip 体积；超限时退出码 1。
- `npm run build:map-bundle`、`npm run check:static-budget`；CI（`.github/workflows/ci.yml`，仅 Linux 任务）构建两个样本瓦片和地图单文件包后运行检查。

## AC 结论

| AC | 结论 | 验证 | 结果摘要 |
| --- | --- | --- | --- |
| AC903 | 通过（2026-11-13 复测） | `node scripts/benchmark-tiles/static-budget.mjs apps/demo/public/tiles/{beijing-cbd-grow-9,kyoto-gion-grow-9,manhattan-financial} --json docs/phase2/evidence/I/static-budget.json` | 首次测量 L1 最多 17 次、L0 6 次（未通过）；按材质组合批（决策 E15）后 L1 最多 6 次（北京）、5 次（京都、曼哈顿），L0 最多 2 次，上限 12/4 |
| AC906 | 本地通过；CI 上**未验证** | 同上，分别以 `--max-l1-draws 16` 和 `--max-bundle-gzip 30000` 运行 | 06 上限（L1 12、L0 4）、单块 gzip 256 KB、包 180 KB 下退出码 0；把上限压到低于实测值时退出码 1（相当于加入一块超预算瓦片或增大包体积）。没有推送到远端，GitHub Actions 未实际运行 |
| AC904 | 未验证 | — | 需要整城构建与默认视角首屏测量（WP-F 整城构建未完成） |
| 其余（AC901、AC902、AC905、AC907、AC908） | 未验证 | — | 依赖参考设备（D5） |

CI 现在直接使用 06 的上限（L1 12、L0 4），单块 gzip 256 KB，主包 180 KB。单块 gzip 最大值：北京 176 KB、京都 244 KB、曼哈顿 188 KB；地图主包 gzip 41,683 B。

## 本机整城路径（2026-11-26）

采用用户指定的本机 Ryzen 7 7840S / Radeon 780M 核显。Linux + Chrome 158、1280 × 720、DPR 1、balanced。完整浏览器从冷导航开始请求 gzip 压缩的静态文件。恢复默认视角后预热，再运行包含码头、住宅区、高低空转换及返回起点的固定路径。SDK 和瓦片数据的版本见[原始基线摘要](enkhuizen-desktop.json)。

| 验收项 | 实测 |
| --- | --- |
| AC901 整帧与首屏 | 10 分钟基线的 RAF p95 为 16.7 ms（按 0.1 ms 精度），>50 ms 长帧每分钟 1.70 次，首个可用画面 667 ms。逐帧最大调用 91 次、三角形 688,088 个、驻留估算 243,693,388 B。平衡档 600,000 三角形和 128 MiB 预算有瞬间超限。 |
| AC901 Worker 与上传 | 基线 L1 解码加生成 p95 265.2 ms（目标 120 ms）；主线程上传最大 20 ms（目标 4 ms）。 |
| AC902、AC905 | 本机连续 601.2 秒没有崩溃或瓦片错误。Android 和 iPhone 未验证。 |
| AC904 | 整城默认视角首屏瓦片、清单和覆盖位图共 790,518 B，低于 3 MB。 |
| AC907、AC908 | 摘要包含 CPU、GPU、浏览器版本、视口、像素比、档位、数据与 SDK 哈希。GPU 基线统计使用最后 18,000 次计时，RAF 统计覆盖全程。参见[支持矩阵](../../../support.md)。 |

复跑使用 `examples/cities.json` 中的恩克赫伊曾 PBF 及边界，先构建到仓库外、校验后将目录的数字 zoom 子目录、tileset.json、coverage.bin、report.json 复制到 `apps/demo/public/tiles/enkhuizen/`。同一数据和 SDK 版本可用如下命令重放。

```sh
npm run build:packages && npm run build:demo
CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist' \
  node scripts/benchmark-tiles/path-run.mjs scripts/benchmark-tiles/paths/enkhuizen.json \
  --loops 10 --json /tmp/enkhuizen.json --frames /tmp/enkhuizen-frames.json
```

手机基准页面位于构建目录的 `benchmark.html`，可选择单圈或十圈并复制结果或下载原始记录。

并行构建压力下另跑了 `97a71b4` 及新版接缝瓦片。10 分钟无瓦片错误，完整收集 35,560 个 GPU 计时。RAF p95 16.8 ms、每分钟长帧 4.99 次、首个可用画面 869 ms、首屏 790,585 B、Worker p95 323.9 ms、单帧上传峰值 40.7 ms。期间本机同时运行 PBF 区域构建和其他测试，SDK、数据哈希和负载也有变化，无法由两次测量单独推导优化收益。见[并行构建时的真实浏览器摘要](enkhuizen-concurrent.json)。

完整行政边界另有一条 60 秒路线。1,016 块瓦片的清单默认中心在湖上，冷启动首屏为 3,661 B，626 ms 出现首个可用画面。路线随后飞入市中心、港口和住宅区，累计再请求 17,477,240 B，其中瓦片错误 0。城区起点的约 791 KB 数据给出了更接近日常街区使用的首屏样本。两者均通过 AC904 的 3 MB 上限。复跑时将 [F 报告](../F/report.md) 的完整市界产物放在 demo 的 `tiles/enkhuizen-municipality`，使用 `scripts/benchmark-tiles/paths/enkhuizen-municipality.json` 运行同一 path-run 命令。见[完整市界浏览器记录](municipality-desktop.json)。
