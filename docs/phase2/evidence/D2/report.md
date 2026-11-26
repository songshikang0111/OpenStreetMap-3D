# 地图运行时补充验证

2026-11-26，本机 Linux、Chrome 158、Radeon 780M。设备尚未被指定为 D5 参考设备。实现提交为 `ce89d86` 和 `05961d0`。材质合批与镜头迟滞以已有 F2 工作树的四处修改为起点。

| 检查 | 实测结果 |
| --- | --- |
| D，AC401、403、405–411 | 北京视图有 8 块可见瓦片；双通道测试得到 82 次绘制、569,860 个三角形，拾取前后读数一致，采集到 11 个 GPU 计时；Worker 样本区分两档。抖动零请求、零切换。京都往返 20 次后估算驻留保持 13,473,148 字节。全部 4 个 Worker 释放，几何/程序归零，Three.js 自有共享 DFG 纹理余 1。 |
| E，AC501–509 | 按既有 100 点投影边界检查全部通过；GPU 拾取 P95 为 1.4 ms；地面标记被实心建筑遮挡，隐藏建筑后重新显示。500 个普通标记的帧间隔 P95 增量为 0。 |
| G，AC703–706、709 | 5 次风格切换保持实际几何对象身份，新增请求 0；仅保留实测高度时 281 栋中显示 21 栋，与构建报告一致。关闭推断树和装饰分别隐藏 3,229 / 2,516 项，恢复过滤条件后隐藏数归零，两次空闲事件均无排队或运行中的 Worker。 |
| H，AC801–806 | MapLibre 6.16.0 的实际文字图层在最高建筑上方产生 326 个绿色文字像素，两次添加移除后宿主影像逐字节一致。50 组机位的 3,980 个可见点最大投影误差低于十万分之一像素。 |

## 复跑

在包括 WP-J 的 MapLibre Worker 构建修正的集成版本中执行以下命令。使用几何标识验证风格切换；首次进入阴影或颜色通道的几何可以在该帧首次上传。过滤检查读取实际要素状态纹理对应的标志。全样本建筑普查使用显式扩大后的驻留预算。

```sh
npm ci
npm run demo:tiles
npm run build:demo
export CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist'
for suite in map-checks overlay-checks style-checks maplibre-checks
do
  node scripts/benchmark-tiles/$suite.mjs --json /tmp/$suite.json
done
npm run test:types
node --test test/phase2-map.test.js
```

四份同名 JSON 保存本机原始检查摘要。真实手机触控（AC412）、参考设备计时（AC415、502、504、507、704）仍待实测。这里的整帧计数和 GPU 耗时来自浏览器；驻留字节是估算值。每帧上传耗时和密集瓦片生成耗时继续由固定路径单独测量。
