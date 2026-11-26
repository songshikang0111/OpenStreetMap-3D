# M0 工具链验收

2026-11-26，Linux 本机。复跑命令和原始历史数据见 [A 报告](A/report.md)。

| 项目 | 结论与依据 |
| --- | --- |
| AC101、102、108、109 | 本机通过。执行 `npm ci`、`npm test`、`npm run test:packages`、`npm run test:types`、`npm run build`、`npm run check:package`。根包在空目录离线安装、严格类型检查、CLI 和 Studio 出包通过，AGENTS.md 包含二期入口。 |
| AC103 | 通过。独立复跑 `node scripts/phase2-format-equivalence.mjs /tmp/equiv.json 38bcb6a 9323866`，201 个 JS/TS 文件的比较结果一致。两次历史运行的通过项见 A。另抽查 CLI、距离/景观/高度/树木审计、两个静态服务器、OSM 投影、道路坡度、Studio 和稳定性页面差异。两份 CSS 的压缩结果仅在四个十六进制颜色自定义属性的冒号后出现空格。 |
| AC104 | 本机通过，托管 CI 未验证。A 的格式错误注入使同一检查退出 1。 |
| AC105 | 未验证。Linux 和 Windows 的 GitHub Actions 需要实际工作流运行记录。 |
| AC106、107、110 | 文档交付通过。命名、竞品及瘦身数据按 [A 报告](A/report.md) 的调查日期解释。 |

AC1101–1104 的整体验证见 [K 集成记录](K/report.md)。
