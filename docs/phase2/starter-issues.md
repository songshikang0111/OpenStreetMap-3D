# 入门任务草稿（Starter issues）

每项都是可以单独完成、单独审阅的小改动。格式：背景、要改的文件、完成标准、验证命令。发布到 issue 跟踪器之前由维护者审阅（发布本身等待用户决定）。

| # | 标题 | 涉及文件 | 验证 |
| --- | --- | --- | --- |
| 1 | 标记的 `occlude` 选项：被建筑遮挡时隐藏 | `packages/map/src/map.ts`（`positionMarkers`）、`packages/map/src/picking/picker.ts` | `node scripts/benchmark-tiles/overlay-checks.mjs` 新增一项：标记被高楼挡住时 `display: none` |
| 2 | 线图层折角处的连接与圆头 | `packages/map/src/overlays/overlay.ts` | `overlay-checks.mjs` 的 AC506 截图中急弯不再出现缝隙；新增单元测试比较顶点数 |
| 3 | 给 `light` 风格的道路加按等级区分的颜色（`road.motorway` 等子角色） | `packages/generators/src/surfaces.ts`（`roleFor`）、`packages/builder/src/plan.ts`（地面要素带上道路等级）、`packages/styles/defaults.js` | `node --test test/phase2-style.test.js`；`style-shots.mjs` 截图中主干道颜色不同 |
| 4 | dark 风格玻璃幕墙偏亮：调低夜间环境反射 | `packages/styles/facade-shader.js`（`extendFacadeShader` 加一个反射强度 uniform）、`packages/styles/defaults.js` | `style-shots.mjs --styles dark --samples manhattan` 前后对比 |
| 5 | 一期屋顶设备的距离 LOD 接入瓦片模式 | `src/city.js` 的 `updateRoofDetails` 抽到共享模块、`packages/map/src/map.ts` | 远景三角形数下降；`map-checks.mjs` 全部通过 |
| 6 | 一期近景树冠细化（多瓣树冠、枝干）接入瓦片模式 | `src/streetlife.js`（`crownProfile` 等）、`packages/map/src/tile-object.ts` | `style-shots.mjs --views close`；三角形预算不超过 `nearDetails` |
| 7 | 构建报告增加每层的来源等级占比百分数，CLI `--json` 输出中同步 | `packages/builder/src/pipeline.ts`（`report`）、`test/phase2-builder.test.js` | `node --test test/phase2-builder.test.js` |
| 8 | `city tiles inspect` 支持 `--layer building --limit 20` 只看一层 | `packages/builder/src/cli.ts`、`packages/builder/src/validate.ts` | 新增 CLI 测试，`--json` 输出符合一期约定 |
| 9 | PBF 读取支持带 `indexdata`、`raw` 未压缩块的文件（补测试） | `packages/builder/src/ingest/pbf.ts`、`test/phase2-pbf.test.js` | 测试中用合成文件覆盖 raw 块 |
| 10 | demo 增加"复制当前视角链接"按钮（中心、缩放、俯仰、方位、风格写入 URL） | `apps/demo/main.js`、`apps/demo/index.html` | 打开复制的链接回到同一视角（手工或在 `map-checks.mjs` 中加一项） |
| 11 | 文档：`docs/support.md` 支持矩阵补充二期瓦片模式（只列实测项，其余"未验证"） | `docs/support.md` | 链接检查 `node scripts/check-links.mjs` 通过 |
| 12 | `StyleSpec` 增加 `roles.*.side`（单面/双面）并同步 Schema 与类型 | `packages/styles/spec.js`、`spec.d.ts`、`schemas/style-spec.schema.json`、`packages/map/src/tile-object.ts` | `node --test test/phase2-style.test.js` 增加用例 |

每项完成前都运行 `npm test`、`npm run test:types`、`npm run format:check`；涉及浏览器的改动另跑对应脚本（见 [CONTRIBUTING](../../CONTRIBUTING.md)）。
