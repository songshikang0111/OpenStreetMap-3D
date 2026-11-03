# B 修复交接：真实下载与统一数据源

2026-11-03（Asia/Shanghai）。分支 `codex/phase1-data-repair`，直接从 `dee3cc8` 创建，旧 `codex/phase1-data-cli` 保留；没有合并旧组件历史、修改main或其他worktree，也未push/publish/部署。

**B 产品修复与独立复验已完成。AC04 的正式显式provider路径已经真实成功；默认 main+POST 仍返回502，不能写成全球默认可用。** 完整一期与E工作台接线的最终放行由主对话继续验收。

## 可集成提交

按顺序 cherry-pick，下列均从修复基线新增：

| 提交 | 内容 |
| --- | --- |
| `5cc00de710e900060282df84e83f75d2430f945b` | source endpoint/transport/有限fallback统一到项目、CLI、batch、HTTP；来源记录/冷却/安全边界；类型Schema与回归 |
| `92411d8bb0a3a6dfd690042b3677cb8b83488e10` | provider预设、data providers、GET search fallback、旧默认search缓存兼容、正式验证脚本 |
| `cf3863eded0f48db510173c827c3ed8e6c3f7e0a` | preset在多层合并中的正确优先级；PATCH/new project/resume/batch/nested HTTP回归 |
| `528ddfebfdba5fcc53e32f88cb83b8467f4da1fe` | partial source只检查提供字段，最终有效源做跨字段校验 |

本文件及证据另有归档提交。产品变更归属：`src/data/`；`src/cli/index.js/tasks.js/project.js/worker.js`及CLI类型；`src/local-server/index.js`及类型；`schemas/project.schema.json`仅source字段和$defs；`src/core/config.js`仅source校验导入/调用、`src/core/index.d.ts`仅source类型。没有格式化style字段、改导出实现或根package/lock。

## 正式默认与provider结果

| 路径 | 明确范围/实际结果 |
| --- | --- |
| 默认 `init --area ...` → `data fetch`，不带source flags | 同一慕尼黑bbox，75s产品timeout，有限重试后9.1s返回HTTP502；无fallback、无快照写入。失败记录 `default-main-results.json`（commit92411d8） |
| `--provider dresel-europe` → 正式 `data fetch` → `data fetch --offline` → `build --offline` → `validate --offline` | commit cf3863e；bbox `south48.137,west11.575,north48.1375,east11.576`，约56×37m。真实公共请求成功，1111要素/5建筑/21建筑分部；离线缓存命中、原文件哈希不变、真实compileScene产出1块并校验成功。`formal-provider-results.json` |

实际provider为 `https://ovp.dresel.systems/api/interpreter`，GET，OSM base `2026-11-02T21:21:26Z`，请求记录时间 `2026-11-03T12:48:21.266Z`（UTC）；sourceHash `caa4e0dc9c7e4a493f5ba6fd688cdbf9e8c7f4759d04d4b0ed9690a58cc5d880`，normalized contentHash `69427e177a82fc1671deee1230ff438bccf6482af014e350dce82859c1c11aab`。项目在 ignored `work/data-remediation/live-Slwqd9`，sourceFileHash `cc8d7da7f9059f9705091995c348c57cf9a656cc48de42a21fd2ab50a319e4a6`。独立审查者在最终528ddfe再次离线核对通过。未用fixture、仓库旧快照或本地导入冒充该请求。

官方资料核对：主实例负载与资源规则、OSM实例目录、Private.coffee迁移后的端点和条款、VK部署，链接及接线见 [source-contract.md](source-contract.md)。实际有限探测另有 `network-observed.json`：Private.coffee POST75s超时，VK POST504；VK GET曾在北京极小范围成功取得一个银行点，但扩大范围正式CLI仍504，未把该点或失败当建筑场景成功。欧洲区域GET成功不代表北京、全球、任意端点或SLA通过。

## 新用户入口与默认策略

用户无需研究接口URL或自行试GET/POST：

```powershell
node bin/city.js data providers --json
node bin/city.js init work/my-city --area 48.137,11.575,48.1375,11.576 --provider dresel-europe --json
node bin/city.js data fetch --project work/my-city --json
node bin/city.js data fetch --project work/my-city --offline --json
node bin/city.js build --project work/my-city --offline --json
```

`data providers` 与 `GET /api/data-sources` 共享预设/transport/coverage/documentation。明确标记Dresel欧洲限定；不能把它作为全球默认或跨地区隐式fallback。全球默认保留main+POST，没有隐藏第三方fallback。显式 `--provider` 持久化配置；自托管通过同一 `--endpoint`/`source.endpoint`，允许HTTP loopback/LAN与HTTPS，但拒绝非HTTP协议、credentials/query/fragment。任意headers/requestOptions/shell不能由Studio任务输入。

优先级为 job/command > project.source > studio defaults > built-in；preset先展开自己的URL/transport，再合并高优先级字段；不把无关fallback默认覆盖进已有项。相同provider/endpoint/transport/fallback字段支持init、fetch、batch fetch项、resume、Studio默认和HTTP任务。build不联网。

fallback默认none，显式unavailable最多两备用；仅连接/timeout/502/503/504可触发。429/406、其他错误、无效数据、取消不换源。429/406至少30秒并尊重更长Retry-After；重试耗尽仍保留同源cooldown，等待可取消。缓存按明确候选顺序优先，fallback cache单独诊断；显式refresh失败不使用旧缓存伪报成功。

## 测试、独立审查与证据

Windows、Node22.11.0。最终代码528ddfe：

| 命令 | 结果/证据 |
| --- | --- |
| `npm test` | **276/276 pass**，`tests.tap`，无skip |
| `node --test test/phase1-data-source.test.js test/phase1-data.test.js test/phase1-cli.test.js` | **41/41 pass**，含endpoint/preset优先级、fallback/限流/取消/cache/服务边界 |
| `npm run test:types` | pass |
| `npm run build` | 旧演示、Studio、SDK三套pass，保留>500kB既有提示；`build.txt` |
| `npm run check:package`（最终build之后） | pass；123文件、709917压缩bytes；隔离离线安装、严格类型、安装后真实CLI/worker/服务；`package-results.json`。不含work/map cache/源下载或生成模型 |
| `git diff --check` | pass |
| 正式公共服务链路 | 显式provider成功；默认失败独立归档，见上表 |

独立审查 `/root/review_data_repair`，用户指定gpt-6.1-sol/xhigh/fork_turns:none。实际localhost服务+worker验证网络错误的有限重试/fallback、503fallback、429/406冷却、500/坏JSON/OSM/过大body/取消不回退及旧文件保留；发现并复验关闭preset合并优先级和partial验证缺陷，最终无未解决P1/P2。详见 [review.md](review.md)。

四个**实际batch worker、无runner注入**的HTTP fixture，作者观测 `[0,1114,2222,3327]ms`，独立观测 `[0,1117,2224,3333]ms`，均全部成功，见 `worker-throttle*.json` 与脚本。worker经IPC将请求交给同一父进程的requestJSON broker，search也共用该父模块。**不是跨所有CLI进程、所有机器的全局限流**；没有用独立worker的模块map冒充共享队列。

## E接线与主对话复验

完整字段/路由/示例在 [source-contract.md](source-contract.md)。E在Studio添加provider选择及coverage说明、自托管URL/transport、显式备用策略；保存到project.source，再发标准fetch job。可先GET `/api/data-sources`取default/providers，project详情还返回已解析`dataSource`。不能给用户展示“欧洲源全球可用”，也不能把cacheHit称为新下载。CLI已有无需手写URL的方法预设；E只需消费同一接口。

E可能同时集成C的style扩展：本修复仅改共享Schema/type/config的source部分，合并时保留双方字段与导入。`src/local-server/index.js`先由B修改，C的独立helper仍由E后接，不应以旧服务文件覆盖B的新source解析/白名单/优先级。错误类拆至browser-safe `src/data/errors.js`，核心source验证不会引入Node fs/crypto进浏览器。

可离线复验已下载项目，不需再访问公共服务：

```powershell
node bin/city.js validate --project C:/Users/宋世康/.codex/worktrees/phase1-data-cli/beijing-city-ink/work/data-remediation/live-Slwqd9 --offline --json
node docs/phase1-evidence/remediation/data/worker-throttle.mjs work/data-remediation/worker-throttle-recheck.json
```

明确要复跑live时，脚本 `live-download.mjs --provider dresel-europe --output work/...json` 一次正式下载后只做离线cache/build/validate；无flags单独测试真正默认。新数据、大缓存和CINK仅在ignored work，证据JSON没有地图elements或生成模型。主对话整合新A/C/D引擎后，应复制/重建同一锁定源快照再复验，而不是假设旧engineHash仍有效。

## B相关AC结果

| AC | 修复范围结果 | 限制 |
| --- | --- | --- |
| AC04 | pass（明确选择欧洲provider的正式小bbox真实下载） | main+POST实测仍失败；非全球默认可用、非SLA或任意地区承诺 |
| AC05 | pass | 来源/transport隔离缓存、旧POST兼容、缓存优先、刷新失败/取消保旧、fallback缓存诊断 |
| AC06 | pass | 真构建锁定源、cache/source/manifest/lock哈希一致；最终引擎已独立离线validate |
| AC07 | pass（B回归） | 取消与resume保留原语义，换provider恢复有回归；UI操作由E验 |
| AC23 | pass（B回归） | batch source/preset优先级与实际worker队列；无跨进程全局限速宣称 |
| AC24 | pass（source契约部分） | help/类型/Schema/预设/教程一致；AO/风格等其他修复不是B放行范围 |
| AC25 | pass（B组件） | localhost/URL/路径/任务白名单/取消/锁边界保留；用户明确配置的自托管HTTP被支持 |
| AC27 | pass（B独立复验闭环） | 主对话最终同一集成commit整体验收仍需执行；不宣告一期全通过 |
