# 核心协议 v1 与集成

`await compileScene(raw, config, {signal, onProgress, landmarkRegistry})` 返回 `{manifest, assets, report}`，不读写调用者项目。`assets` 不含 manifest 自身；调用者将 manifest 写入 `manifest.json`，其余按相对路径落盘。输入是完整有限区域的标准 OSM JSON `elements`，区域与原点来自配置。下载、补全引用及锁文件由 B 提供。

`validateProjectConfig` / `validateSceneManifest` 返回 `{valid, diagnostics}`，配置成功另含 `value` 与兼容别名 `config`。初始化须保存 defaulted `value.origin`；build 不改用户配置。失败抛出带 `code/stage/diagnostics` 的 `CityBuildError`。取消在阶段、资源输出和 await 边界检查；已有同步几何计算应放 B 的 worker，以便强制终止长阶段。

## 坐标与所有权

所有 bounds 为 `[minX,minY,minZ,maxX,maxY,maxZ]`，米，x 东/y 上/z 南。块 transform 为 column-major matrix4；当前资产直接使用项目世界坐标，transform 为单位矩阵。projection 记录每度米数，可重建 WGS84 映射。局部投影拒绝 ±80° 之外、日期线与任一跨度超过 10 km 的区域；这仅是构建保护，不代表浏览器性能支持范围。

`tiling.sizeMeters` 默认 500。可选 `tiling.divisions` 覆盖 sizeMeters，用于固定范围 N×N（1/4/16）实验。完整区域先求解一次道路/桥梁高程、交叉口、水域 union、场地和植被，然后才分块。

建筑、CCTV 整组与每棵树都只有一个 owner。道路/水面/地表按共享原始三角形质心分配，**不把三角形裁切为格网形状**，因此切块不产生新的道路节点或接缝。格网只决定资源归属。`contentBounds` 含完整越界几何，必须用于加载、可见性和过渡覆盖；不可只根据名义 cell bounds 剔除。原始底座在核心包中由一个共享 50 m 世界格网地表替代，没有每块重叠盒底座。旧 buildCity 默认入口保持原来底座。

`featureIndex` 键保留现有 `w<ID>` / `r<ID>-<part>`；树为 `tree:<stable planting key>`。`sourceIds` 原始对象形式 `way/ID`、`node/ID`，生成规则保留种子/版本。水 union/场地/道路合批另有 `generated:*` 语义对象，来源列出参与规划的源对象；不是逐三角形测绘归因。原始道路/水对象可作为语义记录存在，没有独立可渲染体。`chunkIds` 是实际关联的块；`ownerChunk` 只适用于原子对象，`atomicGroupId` 标识地标组。

## LOD 与二进制

每块 `lods` 数组：low/level 0、medium/1、high/2。每级含 uri/SHA-256/hash、传输 bytes、估算 residentBytes、整帧单 pass 提交 triangles/drawCalls、bounds、geometricError、screen-space-error 选择依据。数值是资源统计和选择估计；不是 GPU 时间/实际显存或经认证的 Hausdorff 误差。最终屏幕选择、预算与真实浏览器统计由 D 实现和测量。

low：普通建筑 footprint 挤出，保留洞和高度；中国尊 10×12 截面、央视保留倾斜与空中连接；建筑按语义角色合批；树冠 20 面、树干四边；移除屋顶设备和街道设施。medium：现有建筑主体、道路、水域和基础树冠。high：恢复原有屋顶设备与街道设施。所有级道路/地表共享完全相同边界几何。外部任意生成器未提供特殊简化时保留其主体，仍能合批；并不声称自动解决任意 CAD 简化。近窗框和局部树冠的旧运行时动态生成不序列化为代码。

`.cink`：12 byte 前缀（ASCII CINK、uint32LE version=1、uint32LE JSON 长度），UTF-8 canonical JSON 元数据，补齐至四字节，随后原始类型化数组。几何/材质表在单块内共享；保留 index、geometry groups、实例矩阵/颜色、全部顶点属性与可序列化 userData；去掉 UUID、函数、原颜色副本。`decodeChunk(payload, lodDescriptor)` 可 await，校验 magic/version/bytes/hash/索引/属性范围后返回 Group；不绑定 shader。

风格层遍历 `userData.city`（featureId/featureIds/sourceIds/kind/materialRole/lodRole）、`inkClass`、`generatedFacade` 与 `aFacade/aStyle/aLayout/aSurface` 后恢复 shader。`cityFeature` 是 Uint32 顶点属性，值对应 featureIndex.renderId；合批建筑靠它恢复每三角形对象。实例通过 `userData.city.instanceFeatureIds[instanceId]` 映射身份。多材质生成器还可在 material.userData.city 声明角色。编码不保存运行时代码。

## 依赖与跨所有权改动

未改根 package/lock，无新运行时依赖。使用现有 three/polygon-clipping 和 Node 22+/现代浏览器 Web Crypto。公共类型位于 `src/core/index.d.ts` 和 `scene-codec.d.ts`；消费者应安装与 three 匹配的 `@types/three`。

`src/city.js` 四处小改：可选 `landmarksEnabled=true` 控制通用回退，并在返回对象增加 `roadPlan` 和 `streetlifePlan`，供核心读取同一次共享规划。这会与 C 的 city.js 修改相遇；集成时保留 C 的 registry/style 逻辑及这两个返回字段。A 的注入 registry 在完整旧规划后替换 claimed 建筑 mesh，生成失败记录诊断并保留原形体。D 应用此处的真实 `.cink`，禁止将依赖注入测试当作真实集成成功。
