# 参与开发

城市线境使用 JS 模块、公共 `.d.ts` 和版本化 JSON Schema。先阅读 [AGENTS.md](AGENTS.md)、[一期接口与验收](docs/phase1-plan.md)、[扩展指南](docs/extensions.md) 与 [支持范围](docs/support.md)。

使用 Node 22.11+：

```sh
npm ci
npm test
npm run build
npm run studio -- --workspace ./work/studio
```

`src/core` 提供统一坐标、连续区域规划、场景编解码与 LOD 产物；`src/data` 和 `src/cli` 提供下载、导入、项目及可恢复任务；`src/local-server` 仅服务本机；`src/sdk` / `src/runtime` 加载静态场景；`src/styles` 和 `src/landmark-registry.js` 绑定风格与地标；`studio` 是同一 SDK 的本地客户端。旧演示 `src/main.js` 继续用于视觉回归。

改变生成或协议时，检查确定性、来源、对象身份、切块独立性与资源释放。新增风格通过注册接口；新增地标使用配方和生成器，避免在核心按名称特判。改变协议需要更新类型、Schema、CLI help、例子和相关证据。未知形状按 strict/degraded 策略明确报告。

提交前运行与改动匹配的验证，每次实质改动创建 Git commit，仅暂存自己修改的文件。较大变更请提供独立审查、实际命令/环境、原始统计和已知限制。性能测试使用真实浏览器、整帧统计、固定路径和资源往返；Node 构建耗时不能替代帧率。

不要提交缓存、完整生成场景或地图大样本。输入数据许可、来源、时间与哈希需保留；原创代码是 MIT，OSM 是 ODbL，两者分别处理。依赖更新后运行 `npm pack` 并检查入口/文件；本地打包不意味着远端发布。
