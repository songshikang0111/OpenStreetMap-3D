# D 运行时 / SDK 修复交付

追加：主对话随后发现的可配置近景总预算 P2 已另行修复，见 [near-budget/handoff.md](near-budget/handoff.md)。以下保留首轮 R1/R4 冻结记录。

2026-11-03。分支 `codex/phase1-runtime-repair`，基线 `dee3cc8`。产品冻结提交 `492744bf083d816143ad54f66035cfb76b11a5fa`。这是 R1/R4 组件交付，不是 AC01–AC27 或最终 12 组集成验收结论。

## 可集成提交与边界

- `205b79c`：quality 仅控制 AO pass 的启用，保留风格已经验证的 aoStrength。
- `c58af6a`：按主视锥、阴影视锥、实际 pass 拓扑分开计算整帧成本；移除从前帧几何比例估计 multiplier 的反馈；近景附件只使用同帧主体余量；有计费的粗层备用保留异步替换期间覆盖。
- `129f1d4`：提前为粗层备用计入每个候选的驻留成本；持久缓存已解码的数字字节成本；世界空间成本缓存使用 chunk ID + URL，防止共享 URL 的不同变换串扰。
- `492744b`：兼容 A 可选的 shadowTriangles/shadowDrawCalls；预算滞后不能恢复到超硬上限的旧层；补延迟解码、取消、备用恢复及并发回归。

仅产品修改 `src/runtime/`、`src/sdk/` 及对应测试。没有修改 A 的生成器/core，或 C 的风格/打包/导出代码。没有提高默认 600000 triangles、1200 draws、128MiB、750ms 驻留或1200ms离场延迟。没有隐藏必要地物来满足预算。

## 调度与统计

主体预算先独立确定，附件不反向影响下一帧主体层级。manifest 的 draw units 在未知实际几何时保守估计；解码、风格绑定、classification 准备后，缓存实际球界、材质分组、instance 数量、castShadow 和数字字节成本。缓存不保留 geometry/material/texture。外部管线使用实际 renderer.render 调用观察 pass 数与屏幕 pass 固定成本，不再计算“上一帧整帧三角 / 这一层可见三角”的倍率。

SDK 主循环继续使用 renderer.info.autoReset=false、整帧 reset/record 与原 GPU query begin/end。frame-cost 预测不会替代实际 renderer.info 原始统计。所有自动层级预算均计算 scene + shadow + screen passes；附件用 scene+shadow 上界计费。

粗层在升级后可以保留为 standby，registry 和 estimatedResidentBytes 均计入它；候选升级前就为它预留空间。如果快速相机变化使当前主体超绘制预算，立即恢复已驻留粗层完整覆盖，再异步获得目标层。自动策略不会暂时隐藏建筑/道路/地标。force full/far 仍是显式测量 override。

`getStats().runtime` 新增只读诊断字段：

| 字段 | 语义 |
| --- | --- |
| frameCost.triangles / calls | 当前主体及固定屏幕 pass 的预测整帧成本，未包含 nearAttachments |
| desiredLods / currentLods | 每块的 tileId、排序 index 和原 manifest level |
| standbyChunks | 已计入驻留的粗层备用数量 |

原 getStats 类型为开放 `Record<string,any>`，方法和参数契约不变；没有新增配置或修改 SceneManifest schema。A 正在新增的可选 shadowTriangles/shadowDrawCalls 可直接被消费：显式0不会退回total；旧manifest仍兼容。E需整合A后验证其实际描述值。读诊断示例：`viewer.getStats().runtime?.desiredLods`；最终实际预算应读 `rendering.last` 或 `getStats({raw:true}).rendering.frames`。

最低覆盖本身超预算时仍保留覆盖并给出 COVERAGE_EXCEEDS_BUDGET；D 没有用遮挡城市替代 A 的几何优化。异步替换的 CPU 驻留峰值仍可需要过渡 headroom，原 TRANSITION_HEADROOM 诊断和 peakEstimatedResidentBytes 保留；没有把它称为已测 GPU 显存。默认12案是否整体逐帧通过，须由A+E整合后的真实数据决定。

## 已知固定镜头真实复验

数据：正式构建的 `work/integration-scenes/beijing-cbd-grow-1/manifest.json`，与根验收相同固定镜头定义，默认 balanced 预算。通过公开 createCityViewer 与真实 CINK / WebGL，不复制旧 scheduler。Chromium 153.0.8010.12，ANGLE / NVIDIA RTX4090 D3D11。下表来自冻结产品提交，完整逐帧记录包含加载期、current/desired LOD、near 成本、预测和实际帧成本、cancel 和URL请求。

| 原路径 t | 固定时长 | 采样帧 | loads / swaps / cancel | max triangles | max draws | overFrames / missingFrames |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 3.009s | 266 | 2 / 1 / 0 | 589010 | 303 | 0 / 0 |
| 13 | 15.510s | 1847 | 2 / 1 / 0 | 590354 | 247 | 0 / 0 |
| 19 | 15.509s | 1849 | 2 / 1 / 0 | 592678 | 295 | 0 / 0 |
| 37 | 3.006s | 350 | 2 / 1 / 0 | 591586 | 259 | 0 / 0 |

四组均只请求一次 low URL 和一次 high URL，只有初始低层到高层的正常替换；没有反复取消或重复请求同一 URL。高层保留，并非强制全低。原始失败记录保存在 stationary-before.json；根验收 archived stationary.mjs 未改。原失败是 CPU 调度复现而非GPU性能结果：t13 29 loads/28 swaps/14 cancels，t19 82 cancels。

- [browser-after.json](browser-after.json)：完整固定镜头原始记录，productCommit 与 GPU 身份。
- [browser-regression.mjs](browser-regression.mjs)：可复跑真实 SDK 脚本，超过逐帧预算、重复URL、cancel、覆盖缺失会断言失败。
- [motion-ao.json](motion-ao.json)：360帧快速切换四机位与小幅FOV变化，max 592678 triangles / 303 draws，overFrames=0，missingFrames=0；五次往返驻留均13439492B，away/dispose均0。
- 显式 full/far 和 whenIdle 均完成；loaded GLB 11366892B、complete GLB 10702260B 均实际导出。几何差异来自完整导出重解码并绑定所选LOD及已加载导出的near附件范围，未作为字节相等断言。

这是短浏览器行为与预算回归，不能替代每组60秒和12案的性能验收。

## AO 实际效果

真实公开 SDK 保存/恢复 `{id:'comic',parameters:{aoStrength}}`，实际管线配置分别为0/.12/.9。balanced 的三个导出像素SHA256各不相同；low 三个配置均保留原值但 aoEnabled=false、有效强度0，三个像素SHA256完全相同。结果、哈希和PNG见 motion-ao.json 与 ao-*.png；PNG含 OSM 署名，已视觉检查。

## 验证与独立审查

- `npm test`：272/272通过，0失败，见 tests.txt。
- `npm run test:types`：通过，见 types.txt。
- `npm run build`：legacy、Studio、SDK三项通过，见 build.txt（原有chunk-size提醒保留）。
- `npm run check:package`：通过；offlineInstall、strictTypes、builtStudio均true，见 package-results.json/package.txt。没有覆盖根验收历史报告。
- 两项浏览器脚本在冻结提交串行运行，全部断言通过，见 browser.txt / motion-ao.txt。
- 独立只读 `gpt-6.1-sol / xhigh` 审查发现窄resident抖动和共享URL变换缓存风险，均已修复并补状态回归。最终审查492744b无未解决可操作发现；其独立24/24 targeted tests与diff-check通过。审查不编辑文件、不运行并行GPU压测，见 review.md。

复跑：启动 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5184 --strictPort`；必要时先 `node scripts/phase1-build-cases.mjs work/integration-scenes beijing-cbd-grow-1`。依次运行本目录 browser-regression.mjs、motion-ao.mjs；需本机Playwright/Chromium，脚本中的浏览器路径可按环境调整。生成CINK不入Git。

E接线：按上述四个产品commit顺序cherry-pick，随后证据commit；整合A的更低LOD成本与可选shadow字段，保留原GPU timer与整帧统计，在最终单一提交上运行12案逐帧max/overFrames、固定镜头和5次资源往返。D组件通过不覆盖E最终独立验收。
