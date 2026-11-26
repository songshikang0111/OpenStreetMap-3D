# M3 城市构建与 MapLibre 验收

| 项目 | 结论与依据 |
| --- | --- |
| AC601 | 通过。184,846,938 B 的真实 PBF，按恩克赫伊曾完整行政边界 relation/296469 构建。约 115.80 km²，1,016 块瓦片，11,788 栋建筑，CLI 目录校验通过。见 [F 报告](F/report.md)。 |
| AC602 | 通过。阿姆斯特丹样本从两种独立输入构建，双向比较 5,277 个建筑身份，差集为空。 |
| AC603、604 | 实测整市界峰值 RSS 937,732 KiB，全量 735.91 秒。较小城区样本的恢复约为全量构建的 0.37%。输入规模上限和密集城区 20 km²/min 的目标未验证，见 [F 报告](F/report.md)。 |
| AC605、606 | 完整市界从 1,791 对相邻候选中抽验 200 对，12,000 个地表采样、61 个道路穿界点均一致。较小城区样本并发 1 和 8 的瓦片一致。见 [原始 F 测量](F/city.json)。 |
| AC607 | 通过。超大连通水域和坡度组保留局部几何并在报告中记录，执行 `node --test test/phase2-pbf.test.js`。 |
| AC608 | 通过。目录及归档分别在真实 Chrome 加载，北京可见瓦片相同。归档服务处理 13 次 Range 请求并保留署名，见 [K 原始结果](K/archive-browser.json)。运行 `node --test test/phase2-archive.test.js` 和 `node scripts/benchmark-tiles/archive-check.mjs`。 |
| AC609 | 以 [城市清单](../../../examples/cities.json) 的提取时间、输入 SHA-256、选项、输出瓦片数和内容哈希重建。命令见 [demo 手册](../../demo.md) 和 [F 报告](F/report.md)。 |
| AC801–806 | 本机通过。实测 MapLibre GL JS 6.16.0，50 组机位、3,980 个点，独立宿主文字图层位于城市之上。两次添加移除后画面逐像素恢复。见 [H](H/report.md)、[D2](D2/report.md)。 |

AC1101–1104 的整体验证见 [K 集成记录](K/report.md)。
