# 桌面逐帧验收与首次缓冲提交

Radeon 780M、Chrome 158、1280 × 720、DPR 1、balanced。SDK 改动在 `b5e0bb7`，判定工具在 `80bc1d5`。所有计时均来自本机浏览器。各版采用独立浏览器会话、冷导航和同一预热过程。

## 同瓦片单圈对照

使用恩克赫伊曾 C7 城区瓦片，构建报告 SHA-256 为 `5efbcf2619fb4747b1f03bad95d7ee5a31b076f33c19826721d88e93d9c6b5b4`。基线 SDK 为 `80bc1d5`（运行时代码等同于 `60cace3`），两端使用 `b5e0bb7` 的同一测量脚本。每个版本从默认视角复跑仓库 60 秒路径一圈。

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 已采集帧数 | 3,600 | 3,596 |
| 单帧对象准备等主线程工作峰值，ms | 8.6 | 8.4 |
| 单帧首次 WebGL 缓冲提交峰值，ms | 31.1 | 10.3 |
| 单帧新提交缓冲区最大字节数 | 69,814,812 | 19,272,352 |
| 准备和首次提交合计的逐帧峰值，ms | 32.1 | 10.7 |
| 合计超过 4 ms 的帧数 | 32 | 30 |
| 整帧间隔 p95，ms | 16.7 | 16.8 |
| 每分钟超过 50 ms 的长帧 | 0 | 1.99 |
| 首个可用画面，ms | 769 | 710 |
| L1 Worker 解码和生成 p95，ms | 195.8 | 128.1 |
| 空白帧、瓦片错误 | 0、0 | 0、0 |

首次提交的峰值及单帧数据量下降。两版的上传和 L1 Worker 时间均超过桌面门槛，修改后的帧间隔 p95 也超过 16.7 ms。每个版本仅采一圈，Worker 样本随摄像机移动和调度而变。见[基线诊断](route-before.json)和[修改后诊断](route-after.json)。

原先的对象准备计时在真正绘制前就结束，Three 会在首次使用属性时创建 WebGL 缓冲。现在独立地图在密集几何发布前，用同一几何对象、原始属性和不可见材质提前提交属性。每次优先组合不超过 2 MiB 的完整属性，一个超过此大小的属性单独提交。每组后检查本帧已用时间，单次驱动调用仍可超过预算。索引和小几何继续由 Three 在绘制时提交。

基准在同一上下文测量 `gl.bufferData` 返回前的主线程耗时，同时记录调用次数和数据字节。固定版本的 Three 用它创建属性存储，而已有数据更新使用 `gl.bufferSubData`。对象准备耗时扣除时间片内已经被测到的 WebGL 调用，每帧以两项之和判定 4 ms；表中各分项最大值可以出自不同帧。GPU 时间查询另行记录。驻留字节是 SDK 估算，未将其作为驱动实际显存。

## 复跑及退出码

在 `apps/demo/public/tiles/enkhuizen` 准备相应版本的构建输出。运行前校验报告 SHA-256。CLI 在一圈诊断和十圈验收中均检查逐帧空白、三角形、绘制调用、驻留、Worker 排队、上传和瓦片错误，同时检查帧时间、L1 Worker、首屏、GPU 来源与版本信息。十圈还要求已登记的整城路径、每圈计划 60 秒、实际漫游至少 600 秒和硬件 GPU。单圈只输出 `diagnostic`；显式指定 `--acceptance` 并只跑一圈会失败。完成但未达标时先写完整 JSON，再以状态码 1 退出。20 次资源往返由 AC411 单独测试。

```sh
sha256sum apps/demo/public/tiles/enkhuizen/report.json
npm run build:packages
npm run build:demo
export CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist'
node scripts/benchmark-tiles/path-run.mjs scripts/benchmark-tiles/paths/enkhuizen.json \
  --loops 1 --json /tmp/enkhuizen-diagnostic.json --frames /tmp/enkhuizen-diagnostic-frames.json
node scripts/benchmark-tiles/path-run.mjs scripts/benchmark-tiles/paths/enkhuizen.json \
  --acceptance --loops 10 --json /tmp/enkhuizen-acceptance.json --frames /tmp/enkhuizen-acceptance-frames.json
```
