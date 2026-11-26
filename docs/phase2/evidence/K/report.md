# 集成与独立验收

2026-11-26 在本地 `phase2/K-integration` 整合各工作包，主机为 Linux、Ryzen 7 7840S / Radeon 780M。以 [M0](../M0-acceptance.md)、[M1](../M1-acceptance.md)、[M2](../M2-acceptance.md)、[M3](../M3-acceptance.md)、[M4](../M4-acceptance.md)、[M5](../M5-acceptance.md) 的结论为当前入口，早先的 WP 报告保留各自的日期、环境和假设。

| 验收项 | 说明 |
| --- | --- |
| AC1101 | 各里程碑列出验收号、验证方法、设备和结果，历史结果与新增的本机实测分别注明。 |
| AC1102 | 密集城区生成与上传预算尚需优化；设备/UI 边界见 M2 和 M5。Android 和 iPhone 按用户要求标记未验证。D1、D2、D3、D8 分别涉及命名、托管、历史归档与公开发布，维持本地开发版。 |
| AC1103 | 代码、测试、类型与生产构建在本地集成分支验证。main 的发布验收未执行。 |
| AC1104 | 新增证据只保存文本和摘要。通过 `git diff --name-only --diff-filter=AM d2d5d5b HEAD -- docs/phase2/evidence` 枚举后逐文件检查 200 KB 上限。数据、生成瓦片和逐帧记录保存在仓库外或忽略目录。 |

### 复跑

```sh
npm ci
npm test
npm run test:packages
npm run test:types
npm run build
npm run format:check
npm run check:package
node scripts/phase2-pack-check.mjs
node scripts/check-links.mjs
npm run demo:tiles && npm run build:demo && npm run build:map-bundle
npm run check:static-budget
```

针对发布包空目录、真实浏览器和带日期 PBF 的检查另见各里程碑。AC308 的跨运行时数组检查用 `node scripts/benchmark-tiles/worker-parity.mjs`，AC608 的字节范围与目录对照用 `node scripts/benchmark-tiles/archive-check.mjs`。硬件 Chrome 测量使用 `CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist'`。
