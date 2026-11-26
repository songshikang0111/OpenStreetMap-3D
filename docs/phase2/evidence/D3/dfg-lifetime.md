# AC411 共享 DFG 纹理生命周期

Three.js r186 的两种实际地图组合均复现了 AC411 的剩余一项。销毁第一张地图后，其 Three 统计为几何 0、纹理 1、程序 0。严格的纹理归零条件未达到。

| Chrome 158 / 北京 CBD | 两张独立 CityMap | 同一 MapLibre 宿主上的两个 City Ink 图层 |
| --- | --- | --- |
| Three 纹理对象 | 两个 renderer 取得同一张 16×16 DFG_LUT | 两个 renderer 取得同一张 16×16 DFG_LUT |
| 上下文 | 各自独立，销毁后第一个上下文已丢失 | 两层共享，移除第一层后宿主上下文可用 |
| 第一张移除后 | 第二张仍绘制 266,488 个三角形 | 第二层仍绘制 254,804 个三角形 |
| 同一视角的中心像素 | 前后均为 RGBA (177, 194, 155, 255) | 前后均为 RGBA (238, 241, 244, 255) |
| LUT 的 dispose 监听数 | 移除前 2，移除后 2，GC 后 2 | 移除前 2，移除后 2，GC 后 2 |

请求 Chrome 垃圾回收后，两种组合中指向第一张地图的 `WebGLRenderer` 弱引用均已清空，指向其 WebGL 上下文包装对象的弱引用仍然有效。独立地图的 `isContextLost()` 已返回 true。MapLibre 宿主继续拥有并使用其上下文。纹理计数及监听器的生命周期不能单独证明整个 renderer 实例仍在内存中。

r186 的 `src/renderers/WebGLRenderer.js` 在物理材质绘制时调用 `getDFGLUT()` 设置着色器 uniform。其 `src/renderers/shaders/DFGLUTData.js` 缓存模块级纹理。`src/renderers/webgl/WebGLTextures.js` 为使用该纹理的每个 renderer 注册纹理 dispose 监听器，收到纹理自身的事件后移除监听器。材质销毁释放程序，renderer 销毁释放它管理的缓存，均未对该单例发送纹理销毁事件。公开的纹理销毁接口作用于整个纹理对象，无法限定为某个 renderer。强制丢失上下文会同时影响同一个 MapLibre 画布上的所有图层。[Three.js Renderer API](https://threejs.org/docs/pages/WebGLRenderer.html) · [Texture API](https://threejs.org/docs/pages/Texture.html)

## 复现

```sh
npm ci
npm run demo:tiles
npm run build:demo
CITY_BROWSER_FLAGS='--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist' \
  node scripts/benchmark-tiles/dfg-lifetime.mjs /tmp/dfg-lifetime.json
```

该诊断从已编译材质读取 r186 的 DFG uniform 和监听数，在两次独立的页面求值之间请求 GC。它不触发共享纹理销毁。输出中的 `strictZero` 单独记录严格 AC 的结果。测试退出成功表示双地图场景完整执行，结果见 `dfg-lifetime.json`。
