# WP-A 交付报告：地基

分支：`phase2/A-foundation`。环境：Linux（Fedora, kernel 7.2），Node v24.18.0，npm 11.16.0，16 核，13 GB 内存。日期：2026-11-12。

## AC 结论

| AC | 结论 | 验证命令 | 结果摘要 |
| --- | --- | --- | --- |
| AC101 | 通过（Linux 本机） | `npm ci && npm test && npm run test:types && npm run build` | 344/344 通过；类型检查无输出；三次 Vite 构建成功 |
| AC102 | 通过 | `npm run test:packages` | 六个新包各自 `tsc -b` 构建并运行各自测试，各 1/1 通过 |
| AC103 | 通过（自动化）；独立人工抽查待 WP-K | 见下 | 格式化提交 `9323866` 前后 `npm test` 通过项名称集合逐行相同（344 项，`test-names-after-format.txt`）；`node scripts/phase2-format-equivalence.mjs out.json 38bcb6a 9323866` 对全部 201 个改动的 JS/TS 文件得到相同的压缩产物（`format-equivalence.json`）。4 个 HTML/CSS 文件不在该检查范围内 |
| AC104 | 本机通过；CI 实跑未验证 | 加入 `src/zz-format-probe.js`（`export const x={a:1,b:2}`）后 `npm run format:check` | 有违规时退出码 1，清除后 0；CI 的 `Format check` 步骤执行同一命令 |
| AC105 | 未验证 | — | 需要推送到远端触发 GitHub Actions；按 README 须知第 7 条，推送需用户同意 |
| AC106 | 通过 | `node names.mjs …`（查询方法见 `naming.md`） | 11 个候选，含 npm 包名、npm 作用域、GitHub 账号与同名仓库数，查询日期 2026-11-12 |
| AC107 | 通过（部分条目标注未能核实） | GitHub REST API 与官方文档 | `competitors.md` 每行都有链接和核实日期；Mapbox 自托管、Google 缓存条款、F4map 更新时间标注为未能核实 |
| AC108 | 通过 | `node scripts/phase2-pack-check.mjs`；`npm run check:package -- --output=<tmp>` | 根包 `dependencies` 只含 `three`、`polygon-clipping`；`npm pack --dry-run` 与基线相比无源码条目增减（`pack-diff.json`，新增的 4 项为构建产物）；一期包消费者检查通过（离线安装、严格类型、CLI、项目风格打包） |
| AC109 | 通过 | `grep phase2 AGENTS.md` | 开发入口含二期计划书链接和包结构说明 |
| AC110 | 通过 | `node scripts/phase2-slim-inventory.mjs` | `slimming.md` 列出 19 个候选目录的体积、大文件体积和引用位置（共 267 MB，其中 245 MB 为大于 200 KB 的文件）；未移动任何文件 |

## 提交

- `970355d` build(phase2): workspaces 与六个 TypeScript 包骨架
- `3e76b1b` test(studio): VM 测试辅助脚本支持多行 import（为纯格式化提交做准备，不改工作台代码）
- `38bcb6a` chore(phase2): 格式化等价检查脚本
- `9323866` style: 一期代码纯格式化（已登记 `.git-blame-ignore-revs`）
- 本报告所在提交：CI、包文件清单检查、命名、竞品、瘦身清单、文档入口

## 偏离与决策

- E1：esbuild 改为可选依赖，类型包改为开发加 peer 依赖（见 08）。
- 格式化范围排除了 `examples/`、`packages/styles`、`packages/landmarks`、`index.html`：一期包检查和地标包测试对 `examples/quickstart/sepia-style.js` 与 `packages/landmarks/index.js` 做字面字符串替换，且这些路径不在 A3 允许的格式化范围内。
- 本机 npm 缓存缺少 `three` 等包的元数据时，一期 `check:package` 的离线安装会失败（与本次改动无关）；先 `npm cache add three@0.186.1 @types/three@0.187.0` 等即可。

## 已知限制

- Windows 和 CI 实跑未验证（AC105）。
- 竞品表中的闭源产品条款未取得原文。
- 静态检查目前由 `tsc` 严格模式承担（新包），一期 JS 只做格式检查；未引入 ESLint。
