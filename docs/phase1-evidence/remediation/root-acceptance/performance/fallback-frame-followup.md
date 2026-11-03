# 双块 fallback 与 SDK 原始资源字段复核

日期：2026-11-03。审查集成 HEAD `fef2f017244f7bb7538527d8b173371a602761e5`，包含 D `868d9b1`（源 `adfbde7`）和证据 `1dfe13f`，以及 E 四字段接线 `fef2f01`。只读产品、轻量CPU/类型验证；未启动浏览器/GPU，未运行全量test/build。

结论：已知双块延迟替换 fallback 问题修复正确；SDK新增四个逐帧字段来源及类型一致。本轮没有新增可操作缺陷。A连续地表/道路/桥的格网裁切仍由另一独立角色审查，最终12案raw尚未产生，不提前给最终AC通过。

## 双块延迟替换

命令：`node --test --test-name-pattern="feasible coarse standby" test/phase1-runtime-near-budget.test.js`，**1/1 pass**，约0.52秒。

状态回归使用真实生产ChunkStreamer及Three几何：A高层120tri/10near，A备用粗层528tri/0near；B进入后增加120tri/10near。A中层异步解码悬停，原componentwise规则因为528>120而拒绝粗层，造成near20>10。

现 `streamer.enforceFrameBudget` 为每个维度计算 `当前全帧 - 当前表示 + 粗层表示`，仅在没有新增/加剧违反上限且至少一个已超维度改善时替换。此例利用空闲triangle额度，立即保留完整A+B为**648tri/10near**；等待期间无缺块，随后挂载A中层并settled，dispose refs/bytes归零。没有通过隐藏A或B规避near预算。

源码差异还保护draw维度：如果候选虽改善near但引入新的draw超限，仍拒绝；不使用“任一成本比原层大就拒绝”的旧判断。该规则是有明确预算单调约束的紧急降级，不是把所有粗层无条件视为便宜。

## 四字段与类型

`src/sdk/index.js` 在完整pipeline.render之后执行 streamer/near refreshResources，取得同一帧实际runtime和near统计，再record：

- bodyNearDetails = 当前激活主体的detail/near几何单位；
- nearAttachmentDetails = 当前运行时附件的实例单位；
- totalNearDetails = 前两项相加；
- nearGeometryArrayBytes = 近景registry中实际CPU数组字节。

它们与renderer.info整帧draw/triangles一起进入FrameStatistics，getter按原raw契约返回。计数不以LOD manifest声明代替实际数字；字节不称GPU VRAM。原始字段和E `assessResources` 使用的名字一致。

新增公开 `CityFrameRecord`、`CityViewerStats` 与实际shape相符：raw frames可选，last是Partial以容纳reset/尚无帧时的空对象；首帧interval允许null。包根exports/types实际指向SDK声明。

独立严格TS消费文件：`frame-types.ts`。命令：

```
.\node_modules\.bin\tsc.cmd --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 work/root-remediation-performance/frame-types.ts
```

退出0，无输出；从包根导入两种类型并读取四字段，不使用cast或skipLibCheck。未重新运行E已完成的359帧浏览器短测；本角色仅核对本次接线、公开类型及CPU状态回归。
