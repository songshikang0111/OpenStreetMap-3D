# WP-J 交付报告（不依赖用户决定的部分）

分支：`phase2/J-docs`（基于 `phase2/F-pbf`）。日期：2026-11-13。名称继续使用 `@city-ink` 工作名（D1 未决）；不发布 npm（D8）、不部署（D2）、预构建城市清单沿用默认（D7），README 英文为主附中文（D4 默认做法）。

## 交付

- `README.md`（英文）重写与 `README.zh-CN.md`；一期 README 原文迁到 `docs/history.md`（相对链接已改写）。
- `docs/llms.md`：面向编程 agent 的单文件接入说明；每段 JS 都有 `examples/phase2/llms-usage.ts` 中的对应代码，纳入 `npm run test:types`。
- `CONTRIBUTING.md` 重写（英文），`ROADMAP.md`，`docs/phase2/starter-issues.md`（12 项）。
- `scripts/check-links.mjs`：文档相对链接检查（修复一处一期遗留死链）。
- demo：城市切换（北京国贸、京都祇园、曼哈顿金融区）、风格切换（含 styles-ink）、真实性过滤开关（仅真实高度、推断屋顶、街道细节）、点击建筑显示属性并高亮、标记、指向叠加层与 MapLibre 图层页面。

## AC 结论

| AC | 结论 | 验证 | 结果摘要 |
| --- | --- | --- | --- |
| AC1001 | 未验证 | — | 需要未读过仓库的独立 agent 走查；且包未发布、无在线预构建城市（D1/D2/D8），README 目前只能给出本地构建路径 |
| AC1002 | 未验证 | — | 需要独立 agent 按 `docs/llms.md` 走查 |
| AC1003 | 通过 | `npm run test:types` | `docs/llms.md` 每段 JS 对应 `examples/phase2/llms-usage.ts`；扩展教程对应 `examples/phase2/styles/use-styles.ts`；04 用法对应 `examples/phase2/map-usage.ts`；严格类型检查通过。README 的 `createMap`/`createMapLibreLayer` 片段与 llms 相同 |
| AC1004 | 通过 | demo 复制到 `/some/path/demo/` 子路径后用无头 Chrome（硬件 GPU）打开京都样本 | 6 块瓦片可见，18 个资源请求全部同源（外部请求 0），显示"© OpenStreetMap contributors"，控制台错误 0 |
| AC1005 | 通过 | 同上；`style-checks.mjs` | 城市切换（3 个）、风格切换、真实性过滤开关、点击建筑属性面板、标记、MapLibre 图层页面链接均在 demo 中 |
| AC1006 | 通过（2026-11-13 补做） | `CITY_BROWSER_FLAGS="--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist" node scripts/pack-install-check.mjs` | 8 个包 `npm pack` 后装进仓库外空目录（另装 three 0.186.1、vite 6.4.5）：`@city-ink/builder` 构建出 15 个文件，最小 `createMap` 页面经 Vite 打包后在 Chrome 中显示 9 块瓦片、带标记，控制台错误 0。做法见决策 E14（构建后把一期模块打进各包 dist） |
| AC1007 | 通过 | 人工核对 | README（中英文）都包含"它不是什么"、独立地图无文字标注、中国大陆数据与合规提示、真实与推断说明 |
| AC1008 | 通过 | `docs/phase2/starter-issues.md` | 12 个入门任务，各注明涉及文件和验证方式 |
| AC1009 | 未验证 | — | 需要独立 agent 按 CONTRIBUTING 走查 |
| AC1010 | 通过（相对链接） | `node scripts/check-links.mjs` | 59 个文档、无断开的相对链接（不抓取外部 URL）；一期结论可从 `docs/history.md` 与 `docs/phase1-evidence/` 找到 |

未做：J5（预构建城市发布准备，依赖 D7/D2）、J7（Issue/PR 模板、行为准则、安全报告方式）、J9（仓库瘦身，依赖 D3）、J10（新用户走查）。
