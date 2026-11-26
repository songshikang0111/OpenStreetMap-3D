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

## F6 新数据的十圈验收

SDK `b5e0bb7` 在 272 块 F6 恩克赫伊曾城区瓦片上跑完十圈。瓦片内容哈希为 `61a90202410666d4fbd262aec2b76073610f967c0e3a20a673a12239d9c3c94b`，实际服务的构建报告 SHA-256 为 `ebb9619aa4506addeb0d1aacc2579b7aaa29d6126928e75f477db124d427ab3d`。浏览器记录连续漫游 601.208 秒；包含启动、预热、取回逐帧记录和关闭浏览器的命令用时 606.82 秒。计时采集之外的完整记录留在仓库外。

| 实机项目 | 十圈实测 |
| --- | ---: |
| 记录帧数 | 35,978 |
| 全空帧、瓦片错误、WebGL 上下文丢失 | 0、0、0 |
| 超三角数、绘制调用、驻留上限的帧数 | 0、0、0 |
| 三角形、绘制调用、驻留字节峰值 | 569,037、92、134,214,920 |
| RAF 间隔 p95、超过 50 ms 的长帧 | 16.7 ms、19 次（1.90 次/分钟） |
| 首个可用画面、默认视角首屏编码字节 | 527 ms、782,845 B |
| L1 Worker 解码和生成 p95 | 133.9 ms |
| CPU 对象准备峰值、首次 WebGL 提交峰值 | 20.2 ms、123.9 ms |
| 两项合计的单帧峰值、超 4 ms 帧数 | 124.4 ms、244 |
| GPU 时间 p95 | 4.59 ms |

验收结果为 **未通过**。未达标的机器字段为 `uploadFrames`, `workerP95Ms`。已完成的实测仅对应这台桌面设备。运行中记录了瓦片错误和上下文丢失；此后添加的 CDP 控制台错误检查未随这次长跑采集。[完整验收摘要](enkhuizen-f6-ten-loops.json)

按每个实际 60 秒窗口复核，前十个窗口中的长帧数依次为 2、0、1、2、2、2、3、3、4、0，剩余约一秒没有长帧。第九分钟超过桌面每分钟 3 次的上限。原始运行时的判定只使用全程平均；`95138e8` 同时检查各分钟最大值。以此版本重算同一份 35,978 帧记录，最终未通过的三项是单帧上传、每分钟长帧数和 L1 Worker p95。[离线逐帧复核](enkhuizen-f6-frame-audit.json)保留了原始帧文件的 SHA-256。单次最慢的 WebGL 提交帧位于第 533.2 秒，10 次调用共 16,914,816 B；其中调用耗时合计 123.9 ms。

空白帧判定读取每帧的可见瓦片数、实际绘制调用和三角形数，任一为零即计入；局部缺块的父子覆盖检查见 AC406。功能回归在本分支通过 401/401 个根测试及 34/34 个工作区测试，示例类型检查、格式检查及生产构建均通过。
