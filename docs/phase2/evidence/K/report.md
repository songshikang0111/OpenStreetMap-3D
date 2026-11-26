# 集成与独立验收

2026-11-26 在本地 `phase2/K-integration` 整合各工作包，主机为 Linux、Ryzen 7 7840S / Radeon 780M。以 [M0](../M0-acceptance.md)、[M1](../M1-acceptance.md)、[M2](../M2-acceptance.md)、[M3](../M3-acceptance.md)、[M4](../M4-acceptance.md)、[M5](../M5-acceptance.md) 的结论为当前入口，早先的 WP 报告保留各自的日期、环境和假设。

| 验收项 | 说明 |
| --- | --- |
| AC1101 | 各里程碑列出验收号、验证方法、设备和结果，历史结果与新增的本机实测分别注明。 |
| AC1102 | 密集城区生成与上传预算尚需优化；设备/UI 边界见 M2 和 M5。Android 和 iPhone 按用户要求标记未验证。D1、D2、D3、D8 分别涉及命名、托管、历史归档与公开发布，维持本地开发版。 |
| AC1103 | 代码、测试、类型与生产构建在本地集成分支验证。main 的发布验收未执行。 |
| AC1104 | 新增证据只保存文本和摘要。通过 `git diff --name-only --diff-filter=AM d2d5d5b HEAD -- docs/phase2/evidence` 枚举后逐文件检查 200 KB 上限。数据、生成瓦片和逐帧记录保存在仓库外或忽略目录。 |

### 本机集成复验

| 范围 | 实测结果 |
| --- | --- |
| 回归测试 | 最终集成代码 `846c084` 的 `npm test` 通过 395/395，工作区测试通过 32/32，无跳过。生产构建、示例类型、格式和 lint 均通过。 |
| 安装与 CLI | 根包和 8 个工作区包打成本地 tarball，在仓库外的空目录安装。消费者生成了 15 块瓦片，安装版 CLI 校验成功，Chrome 显示 9 块可见瓦片，控制台错误 0。根包清单共 169 个文件。 |
| 静态预算 | 北京与京都共 27 块，L0 最多 2 次绘制，L1 最多 7 次，最大瓦片 gzip 为 251,237 B，地图库入口 gzip 为 51,732 B。仅含 L0 的样本通过单独的预算归类回归，故意降低上限时正确返回 1。见[静态摘要](static-budget.json)。 |
| 真数据与跨端一致性 | 七个示例的 372 块瓦片从空目录重建通过，全部指纹匹配。北京与京都另取 27 块，在 Node 与 Chrome Worker 逐项对比 2,784,540 个顶点的位置、全部索引和树实例，[结果完全一致](worker-parity.json)。 |
| 桌面运行时 | 五城静态 demo、样式、点选和 MapLibre 宿主见[浏览器记录](demo-browser.json)。相同数据与机位的 60 秒优化对照中，3,578 帧均有可见瓦片，三角数和驻留估算均在 balanced 预算内，见 [D3](../D3/report.md)。 |

最新十分钟城区回放共 35,868 帧。首屏传输 782,537 B，1,149 ms 出现首个可用画面，全程无空白、无瓦片错误。帧间隔 p95、Worker p95、上传峰值和 1 帧的驻留估算超出对应目标。随后修复首次加载的源字节记账，最终集成代码的[单圈实测](../I/enkhuizen-source-budget.json)共 3,531 帧，驻留预算超限 0 帧。参见 [I 测量](../I/report.md) 和[桌面原始摘要](../I/enkhuizen-final.json)。

### 复跑

```sh
npm ci
npm test
npm run test:packages
npm run test:types
npm run build
npm run format:check
npm run lint
npm run check:package
node scripts/phase2-pack-check.mjs
node scripts/pack-install-check.mjs
node scripts/check-links.mjs
npm run demo:tiles && npm run build:demo && npm run build:map-bundle
npm run check:static-budget
```

针对发布包空目录、真实浏览器和带日期 PBF 的检查另见各里程碑。AC308 的跨运行时数组检查用 `node scripts/benchmark-tiles/worker-parity.mjs`，AC608 的字节范围与目录对照用 `node scripts/benchmark-tiles/archive-check.mjs`。硬件 Chrome 测量使用 `CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist'`。
