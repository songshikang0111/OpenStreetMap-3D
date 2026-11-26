# 新贡献者走查 · 2026-11-26

一名此前未读过仓库实现的 agent 在 Linux x86_64、Node 24.18.0、Chrome 158.0.8127.36 上执行。以下为 UTC 墙钟时间。仓库改动及贡献者检查使用 `3468ab6` 的独立工作树。消费端页面在仓库外的空目录构建。浏览器使用 WebGL 2 / SwiftShader。

## AC1001 · 1 分 17 秒

05:56:13.526 打开 README，05:57:30.678 Chrome 确认了 1,050 px 宽的画布、视口内的「Beijing」标记、9 个 HTTP 200 的 C3T 响应、Worker 资源及可见 OpenStreetMap 署名。唯一参考的项目说明是 README。页面给 README 示例中的空标记添加了文字和背景色。

使用现场已经准备好的 npm tarball、北京 CBD 瓦片和 npm 依赖缓存。打包、建瓦片及下载依赖的时间未计入。第一次离线安装时未指定 Vite 版本，缓存缺少最新版所需的 `rolldown@~1.2.18`，npm 返回 `ETARGET`。读出本机已安装依赖的版本并重试成功；重试时间已计入。

复现时先设置 `PACKS` 为七个 City Ink 运行时包的 tarball 目录，`CITY` 为包含北京 CBD `tileset.json` 的目录。记录的 map tarball SHA-256 为 `b13fa1521ae6fc8579b978207576dce7365d0a55471a15b13c4915d8332e9750`，北京清单为 `8414aed72295e4302dbb972c785eb570be9170953b136c0111bb6cfa0558fdad`。

```sh
mkdir city-page && cd city-page
npm init -y
npm install --offline "$PACKS"/city-ink-{map,tiles,generators,styles,styles-ink,landmarks,details}-[0-9]*.tgz three@0.186.1 vite@6.4.5
mkdir -p public/tiles
cp -r "$CITY" public/tiles/city
```

保存以下两个文件，运行 `npx --no-install vite build --target esnext` 和 `npx --no-install vite preview --port 5216 --strictPort`，在 Chrome 打开 `http://localhost:5216/`。

`index.html`

```html
<!doctype html>
<html lang="en">
  <meta charset="utf-8"><title>Beijing city</title>
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0 }
    #marker { color: white; background: #922a52; border-radius: 4px; padding: 4px }
  </style>
  <div id="map"></div><script type="module" src="/app.js"></script>
</html>
```

`app.js`

```js
import { createMap } from '@city-ink/map';

const map = await createMap({
  container: document.getElementById('map'),
  tiles: './tiles/city/tileset.json',
  center: [116.4605, 39.9095],
  zoom: 16,
  pitch: 60,
  bearing: -20,
  style: 'light',
});
const marker = document.createElement('div');
marker.id = 'marker';
marker.textContent = 'Beijing';
map.addMarker({ lngLat: [116.4602, 39.9115], element: marker });
map.on('click', e => console.log(e.feature));
```

## AC1002 · 风格、建筑拾取与路线

05:57:46 打开 `docs/llms.md`，05:58:11 Chrome 已执行该文档的三项交互。沿用上述消费端页面和输入；没有打开示例源码、类型定义或其他 SDK 文档。调用 `await map.whenIdle()` 等待瓦片后，在同一相机下分别截取默认、改色、加路线三帧。直接比较 RGB 像素。浏览器通过鼠标事件点击由 `queryFeatures` 找到的建筑。整个过程没有遇到文档导致的调用失败。

| 操作 | 观察 |
| --- | --- |
| `await map.setStyle({schemaVersion: 2, id: 'rose-walls', extends: 'light', roles: {wall: {color: '#d97b8d', blend: 'multiply'}}})` | 与默认风格相比，58,723 像素改变 |
| 使用文档第 5 节的 `route` 线图层，红色、6 px 宽、高度 2 | 与加线前相比，1,710 像素改变，范围 x=84–676、y=319–342 |
| 点击画布 (50, 50)，响应 `map.on('click', ...)` 并调用 `setFeatureState(id,{highlight:true})` | 返回 `way/116944490`，图层 `building`，名称「中国国际贸易中心三期A座」，高度标签 `330`，来源 `observed`，屋顶形状来源 `inferred` |

## AC1009 · 入门任务 #9

05:58:32 首次打开 CONTRIBUTING 和其链接的入门任务列表。在独立工作树中执行 `npm ci --offline`，为未压缩 PBF 文件编写单独的 [回归测试](../../../../test/phase2-pbf-raw.test.js)。该测试合成一个 header 和一个 data 块，两者都有二进制 `BlobHeader.indexdata`；经由真实的流式读取器检查 header 中的复制时间戳、节点 ID 与有符号坐标。现有实现已经支持该数据形式。

```sh
npm run build
TMPDIR=/var/tmp node --test test/phase2-pbf-raw.test.js test/phase2-pbf.test.js
TMPDIR=/var/tmp taskset -c 0-2 npm test
TMPDIR=/var/tmp taskset -c 3-4 npm run test:packages
npm run test:types
npm run format:check
```

此 Node 版本不允许在 `NODE_OPTIONS` 中使用 `--test-concurrency`，使用 Linux CPU affinity 限制测试并发。PBF 定向测试 3/3 通过。根测试在 06:03:05 结束，377/377 通过，零跳过；从读贡献指南到完成入门任务和规定检查共 4 分 33 秒。工作区包测试 32/32 通过，构建、公开类型示例和 Prettier 检查通过。另跑链接检查，当前基线的两份 README 均引用尚未合入的 `docs/phase2/evidence/F/report.md`，其余链接通过。
