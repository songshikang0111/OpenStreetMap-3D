# 参与开发

城市线境使用 JS 模块、公共 `.d.ts` 和版本化 JSON Schema。先阅读 [AGENTS.md](AGENTS.md)、[一期接口与验收](docs/phase1-plan.md)、[二期计划书](docs/phase2/README.md)、[扩展指南](docs/extensions.md) 与 [支持范围](docs/support.md)。

使用 Node 22.11+：

```sh
npm ci
npm test               # 一期测试（不少于 344 项）
npm run test:packages  # 构建并测试二期 workspaces
npm run test:types
npm run format:check   # Prettier，行宽 120
npm run build
npm run studio -- --workspace ./work/studio
```

本地 `git blame` 建议忽略纯格式化提交：`git config blame.ignoreRevsFile .git-blame-ignore-revs`。

## 包结构

仓库是 npm workspaces 单仓多包。二期新包使用 TypeScript 严格模式，源码在 `packages/<name>/src`，`tsc -b` 输出到 `dist/`，测试在 `packages/<name>/test`。

| 包 | 职责 |
| --- | --- |
| `packages/tiles` | 瓦片 Schema、编解码、墨卡托与瓦片数学 |
| `packages/generators` | 由规划要素确定性地生成几何（Node 与 Worker 通用） |
| `packages/builder` | 输入读取、分格规划、切瓦片、`city tiles` 命令 |
| `packages/map` | `createMap` 地图式 SDK、流式加载、叠加层、MapLibre 图层 |
| `packages/styles` | 风格规范与默认风格（一期已有） |
| `packages/styles-ink` | 漫画、线稿等可选风格 |
| `packages/landmarks` | 官方地标配方（一期已有） |
| `packages/details` | 街道小品等可选装饰 |

`@city-ink` 是待定的工作名（见 [docs/phase2/naming.md](docs/phase2/naming.md)），代码中的名称集中在 `packages/tiles/src/naming.ts`。

## 一期代码

`src/core` 提供统一坐标、连续区域规划、场景编解码与 LOD 产物；`src/data` 和 `src/cli` 提供下载、导入、项目及可恢复任务；`src/local-server` 仅服务本机；`src/sdk` / `src/runtime` 加载静态场景；`src/styles` 和 `src/landmark-registry.js` 绑定风格与地标；`studio` 是同一 SDK 的本地客户端。旧演示 `src/main.js` 继续用于视觉回归。二期按 [01 目标架构](docs/phase2/01-architecture.md) 逐步把这些模块抽进新包，旧路径保留转发导出。

## 约定

改变生成或协议时，检查确定性、来源、对象身份、切块独立性与资源释放。新增风格通过注册接口；新增地标使用配方和生成器，避免在核心按名称特判。改变协议需要更新类型、Schema、CLI help、例子和相关证据。未知形状按 strict/degraded 策略明确报告。

提交前运行与改动匹配的验证，每次实质改动创建 Git commit，仅暂存自己修改的文件。较大变更请提供独立审查、实际命令/环境、原始统计和已知限制。性能测试使用真实浏览器、整帧统计、固定路径和资源往返；Node 构建耗时不能替代帧率。

不要提交缓存、完整生成场景或地图大样本。证据只放文本和小于 200 KB 的 JSON 摘要。输入数据许可、来源、时间与哈希需保留；原创代码是 MIT，OSM 是 ODbL，两者分别处理。依赖更新后运行 `npm pack` 与 `node scripts/phase2-pack-check.mjs` 并检查入口/文件；本地打包不意味着远端发布。
