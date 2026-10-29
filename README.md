# 京城线境 / Beijing City Ink

使用真实北京 OSM 数据、Three.js 与独立编写的程序化建模/漫画渲染代码，在浏览器中构建国贸 CBD 街区。

本项目参考 Location Scout 的产品思路，未复制其程序、着色器、素材或专用地标生成器。

## 运行

要求：Node.js 20.19+ 或 Node.js 22（本机验证版本 22.11.0）；重新下载数据时需要 Python 3。

```powershell
cd C:\myGit\beijing-city-ink
npm ci
npm run dev
```

打开 <http://127.0.0.1:5178/>。也可在 PowerShell 中运行 `./start.ps1`。

数据已随项目保存在 `public/data/beijing-cbd.json`。首次安装依赖后，预览不需要外部网络、地图密钥或在线推理服务。

```powershell
npm test          # 地理投影、多边形、层高、裁切及实际数据回归检查
npm run build     # 生成 dist/
npm run preview   # 预览生产构建；请先停止同端口的 dev 服务
```

## 已实现

- 北京国贸 CBD 的真实建筑轮廓、建筑分部、内庭院与道路；局部坐标单位为米。
- 优先使用 OSM `height`，其次根据 `building:levels` 换算，缺失时采用用途/面积与固定随机种子估算。
- 支持 `min_height` 和 `building:min_level`；避免完整建筑轮廓与其分部重复叠加。
- 程序化窗格、近处窗台实例、屋顶设备、绿地与树木。
- 三维场景的颜色、法线/深度、对象编号离屏渲染；自定义全屏着色器生成轮廓和网点。
- 漫画、线稿、彩色、白模四种风格；线宽、网点间距、墨色和太阳方位可调。
- 根据来源给建筑着色；点击建筑查看高度、推算方式、OSM ID 和原始对象链接。
- 俯瞰、天际线、街道和顶部视角；拖动、缩放、平移与地图定位。
- PNG 导出（长边 2400 像素、附 OSM 署名）和 GLB 几何导出。

## 数据范围与真实性

- WGS84 包围框：南 39.9015、西 116.4490、北 39.9175、东 116.4720。
- 约 2.0 × 1.8 公里，中心 39.9095, 116.4605。
- 当前快照解析后：477 个建筑体块，785 个道路对象，407 棵树（含按绿地生成的树）。建筑体块不等同于现实中的独立楼栋数量，道路对象也不等同于街道条数。
- 高度来源：28 个 OSM 标注高度，267 个楼层换算，182 个规则估算。
- 国贸三期 A 座 330 米、中国尊 528 米来自数据中的高度标签。央视部分几何保留了 `min_height=161` 的空中结构。
- 完整请求、获取时间、服务地址与许可信息保存在数据文件 `metadata` 中。OSM 本身可能存在缺漏或过时信息。

### 当前简化

1. **平地**：尚未接入 DEM 高程，不能用于高差精确的场景。
2. **地标体块**：中国尊等仍按 OSM 轮廓挤出；未拟合实际曲面、收腰或斜塔。央视分部保留空间高度，但没有重建倾斜立面。
3. **推测细节**：窗户、设备和补充树木是程序规则，并非街景照片重建。道路宽度缺失时也采用车道/类别估计。
4. **有限 LOD**：建筑主体全部保留；窗台按相机距离开关，远处窗格进行像素尺度衰减。没有全球瓦片流式加载与完整树木图像替身。
5. **GLB**：导出体块、道路、树木和当前已生成的几何细节。漫画后处理、程序化窗格属于渲染器效果，不会变成 GLB 贴图。GLB 附来源信息，使用时仍需保留地图署名。
6. **关系容错**：能拼接 multipolygon 外环/内环；完整分部的覆盖率检查是简化规则，不是精确布尔并集。复杂或不完整数据需要后续完善。
7. **渲染**：当前使用屏幕空间边界与明暗网点，尚无完整 AO、笔触系统、建筑地区规则库、远景地形或原创产品的全部功能。

## 更新或换一块地图

```powershell
npm run data:fetch
python scripts/fetch_osm.py --bbox 39.9015,116.4490,39.9175,116.4720 --name "北京 · 国贸 CBD"
```

脚本直接调用 Overpass API，只在下载并验证成功后覆盖数据。默认使用两个公开实例作为顺序备用。请小范围请求，避免反复批量抓取。改变区域后，页面的静态地点标题与副标题需要相应修改。

## 代码结构

| 文件 | 作用 |
| --- | --- |
| `src/osm.js` | 经纬度投影、关系拼接、内环、楼高来源、道路裁切 |
| `src/city.js` | 批量墙面/屋顶三角网格、窗格着色、实例化装饰与树木 |
| `src/ink-renderer.js` | 多通道离屏渲染、几何边缘、网点与黑色窗格 |
| `src/main.js` | 相机、光源、界面、选取、导出 |
| `scripts/fetch_osm.py` | 真实数据获取与来源记录 |
| `test/osm.test.js` | 关键地理处理和真实样本回归检查 |

## 原项目是否开源

截至 2026-10-29，本次检索未找到作者 MIYADAIKU / oyasumi-gamedev 的官方 Rokehan 开源仓库或开源许可证。GitHub 搜索中的若干同名项目与本产品无关。

作者当前的 [使用条款](https://oyasumi-gamedev.com/tools/terms/) 声明保留程序版权，限制程序/组件的提取和再分发；其页面可读取的 JavaScript 不等于开源许可。其引用的 OSM、Three.js 等第三方部分有各自许可。

## 来源与许可

- 本项目原创程序：MIT，见 `LICENSE`。
- 地图数据库：© OpenStreetMap contributors，ODbL 1.0，见 `DATA_LICENSE.md`。
- Three.js：MIT；Vite：MIT。依赖的许可证保留在安装包中。
- [OSM Simple 3D Buildings](https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings)
- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL)
- [Three.js](https://threejs.org/)

本项目与 Location Scout / MIYADAIKU 无隶属或授权关系。
