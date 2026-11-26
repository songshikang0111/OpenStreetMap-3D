# 瓦片细化的驻留和绘制预算

2026-11-26 在 Linux、Chrome 158 和 Radeon 780M 实机 GPU 上，以 1280 × 720、DPR 1、balanced 对旧版 Enkhuizen 瓦片进行了受控对照。对照两端的 `report.json` SHA-256 都是 `dc48bd90b150e282cd5b1af530a829a28a817d27a615a8af324f3a8f3b8e3da3`。浏览器从独立会话打开，按相同机位预热，然后完整播放仓库的 60 秒固定路线一圈。机器同时运行了其他构建和测试，帧耗时受负载影响。

瓦片选择保留最低层所需的完整覆盖。每组子瓦片与同组仍须驻留的父瓦片一起计入预算。Worker 返回的几何数组、要素状态等在上传前参与估算。已知费用可以跨卸载复用；有可见父瓦片时，同一时刻只探测一组费用未知的子瓦片。退回粗层后，可在剩余预算中保留少量原始瓦片字节供返回使用，最多 8 MiB。统计包含这些原始字节。`residentBytes` 是 SDK 的估算，覆盖瓦片对象和保留的瓦片来源；浏览器显存分配、JS 堆和 Worker 临时峰值需另外测量。

| 同一路线 | 基线 `02aaeea` | 修改后 `2ab6d1c` |
| --- | ---: | ---: |
| 已采样帧数 | 3,572 | 3,578 |
| 逐帧三角数峰值 | 617,754 | 569,063 |
| 超过 600,000 三角形的帧 | 6 | 0 |
| 驻留估算峰值（B） | 225,212,516 | 134,214,476 |
| 超过 128 MiB 的帧 | 328 | 0 |
| 可见瓦片为零的帧 | 0 | 0 |
| 开始的瓦片请求 | 176 | 148 |
| 请求返回的瓦片字节 | 17,612,392 | 11,336,940 |
| Worker 解码与生成样本 | 148 | 201 |
| RAF 间隔 P95（ms） | 16.8 | 16.8 |
| 超过 50 ms 的长帧 | 4 | 6 |

移动中需要为被淘汰的几何体重新生成对象，Worker 样本增加。空闲视角的稳定性与移动路线的成本分别测量。两次回放均为零瓦片错误。[基线摘要](route-before.json) · [修改后摘要](route-after.json)

## 近景、最低覆盖与取消

同一 Enkhuizen 瓦片的历史中心机位在 zoom 18.5、pitch 35° 下能提升到两块 L1。将可见三角预算和驻留字节都设为 1 后，最低层的一块 L0 填满该视图，收到了 1 次 `TILE_MINIMUM_COVER_OVER_BUDGET`。只公布 L0 的清单得到相同结果。三个场景在初次空闲后分别跟踪了 125 帧，期间三次轻微改变朝向，各自有 0 次新增请求和 0 帧空白。见[近景记录](near-and-cover.json)。

北京的 AC406 在 zoom 14 → 17 → 14 全程逐帧检查覆盖，681 帧均有区域覆盖。AC407 静止和亚米级抖动均为零新增请求和零切换。AC408 用独立地图从城市覆盖之外跳入两处高层级机位，同时禁用浏览器网络缓存并引入 400 ms 延迟，14 次请求中 6 次在读取源数据时取消。京都 20 次往返后的驻留估算保持 73,198,984 B，销毁后剩余 0 个几何体和 0 个程序，4 个 Worker 全部终止。见[浏览器检查](map-browser.json)。触控检查使用 Chrome 桌面模拟，手机未实测。

## 复跑

在两个版本各自的工作树中准备同一份 Enkhuizen 输出，放在 `apps/demo/public/tiles/enkhuizen` 下。对比用的两端都需固定相同的瓦片数据、档位、视口和路径。运行北京和京都的通用浏览器检查前，使用 `npm run demo:tiles` 准备相应样本。

```sh
sha256sum apps/demo/public/tiles/enkhuizen/report.json
npm run build:packages
npm run build:demo
export CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist'
node scripts/benchmark-tiles/path-run.mjs scripts/benchmark-tiles/paths/enkhuizen.json \
  --loops 1 --json /tmp/enkhuizen-summary.json --frames /tmp/enkhuizen-frames.json
node scripts/benchmark-tiles/refinement-checks.mjs
node scripts/benchmark-tiles/map-checks.mjs --json /tmp/map-browser.json
```
