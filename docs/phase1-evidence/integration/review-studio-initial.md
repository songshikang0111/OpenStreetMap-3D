# E 自有组件初阶段独立审查

日期：2026-11-03。审查者：独立 subagent `/root/studio_review`，`gpt-6.1-sol`、`xhigh`、`fork_turns=none`。只读，无代码、暂存或提交操作。审查实际 `8580532 / 9753cf2 / 3e8df83`，修复复验至 `48709c6`。本记录不代表最终 A/B/C/D 集成验收。

## 发现与修复

| 级别 | 缺陷 | 修复与复验 |
| --- | --- | --- |
| P2 | 轮询断连后停止刷新，却禁用恢复按钮 | `296de31`。实际 main.js + DOM/API fixture：断连可点击，重连恢复轮询 |
| P2 | 首次 `exports/nested` 导出未创建父目录，rename 报 ENOENT | `0d97fed`。实际 export.js 隔离复验成功 |
| P2 | publish-site 回调中取消仍发布并返回成功 | `0d97fed`。取消抛 AbortError，保留旧站点；在旧站点移至 backup 后取消也正确回滚，清空暂存 |
| P2 | 相机预设围绕固定原点，无法跟随偏移内容 | `48709c6`。六值/四值/object bounds 都围绕内容中心；重开同步 FOV |
| P1 | 工作台保存相机/实时画风后，整个 configHash 校验把正常导出判为 STALE_BUILD | 集成待修：将几何构建键与 camera/style/quality 分开，保留完整配置 hash 追溯；最终需真实项目复验 |

## 独立执行证据

- `node --test test/phase1-e2e*.test.js`：初次 4/4，修复后 5/5。
- 实际 `openLocalBrowser()`、本机 Chrome、1280×720、WebGL2：`startPath` 打开 `/nested/index.html`，路径逃逸 404；pending CDP 请求取消后 47 ms 拒绝，预取消 AbortError。
- `node --experimental-vm-modules --input-type=module` 读取实际 export.js，临时 SDK/场景 fixture 与 B 已提交 common 模块：输出目录、发布取消、回滚测试通过；临时数据全部清理。
- `npm pack --ignore-scripts --dry-run --json`：当时 53 文件，约 447 KB 解包；未含地图大样本/缓存。组件入口尚未到齐，不能判 AC26 通过。

最终集成需证明 SDK bundle 无额外源码/远端依赖，统一 PNG help 与本机 Chrome/Edge 实现，并真实复验工作台、安装包、静态交付与 AC02/03/07/21/22/24/25/26。本阶段四项 E 自有 P2 均关闭；新增性能脚本未在该阶段受审。
