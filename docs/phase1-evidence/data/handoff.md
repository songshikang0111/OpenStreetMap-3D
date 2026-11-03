# 一期 B：数据、CLI 与本地任务服务交付

日期：2026-11-03（Asia/Shanghai）。分支：`codex/phase1-data-cli`。隔离工作目录：`C:\Users\宋世康\.codex\worktrees\phase1-data-cli\beijing-city-ink`。未修改 main、其他任务 worktree、根 package.json/lock 或发布配置，未 push/publish/部署。

## 实际提交

| 提交 | 内容 |
| --- | --- |
| `664dfd2feeb90533b4a5243f7e891e6fd0a3d283` | 数据标准化/缓存/来源、项目、CLI、worker jobs、本地 HTTP 服务、导出与测试初版 |
| `fbe15a8bdab495252ae1e8a903b632008cd1078c` | 审查修复：离线传播、恢复边界、统一限速、任务 ID/项目约束、跨入口互斥、写失败处理、C 协议适配 |
| `d343c9046c14b8952064e9d917913472b3f83960` | 引擎源/依赖锁定、校验引擎变化、Web 构建目标修正 |
| `c38bc9098c1e006b978aee1ba15181401707c412` | 陈旧项目锁恢复仲裁 |
| `5b74d536431119b077f545d02fdc33edb90cee0a` | 队列恢复共用原子仲裁，CLI validate 取得项目锁 |
| `eb9a4ae5b04874e21e43c2bf70dbe9cceaf1db88` | 官方地点采用真实 OSM footprint 中心；开发资源与 Origin 边界；补类型 |
| `e17213a04547d6f218bee4aa0ea507d6d52708c5` | 受控开放官方 styles/landmarks 源包依赖，真实 Vite 模块图回归 |

## 实现和接口

- `src/data/index.js` / `.d.ts`：`searchPlaces`、`normalizeOSM`、`fetchArea`、命名 bbox、结构化诊断。坐标、官方 ID、本地缓存离线可用；Photon 可配置，OSM URL 通过 Overpass 定位，重名与空结果不被合并/伪造。中国尊与央视位置直接来自已有 OSM 对象 footprint，有回归测试。
- 标准 Overpass JSON、OSM Map JSON 和旧项目 JSON 可导入；无需项目专用 metadata 包装。XML/PBF 明确拒绝。默认查询包含建筑分部、道路、地表、设施及递归引用；有一次有上限的补全，剩余引用缺失如实报告，不补造水域闭合边。
- 来源记录 URL/query/queryVersion、时间、原始/标准化哈希、对象版本、ODbL 署名。缓存键包括范围、来源、查询版本；命中优先、显式刷新、32 MiB 限额、超时/退避/有限重试。429 不轮换端点。worker 请求由父进程统一排队，批处理同源请求不会突发。
- `bin/city.js` 与 `src/cli/index.js`：help、JSON、离线、init/search/data/build/batch/validate/studio/preview/export/landmarks/jobs。JSON stdout 一条 envelope，进度 stderr。退出码 0/1/2/130；部分批处理不会退出 0。
- 固定 origin、种子、配置与输入/引擎/配方/风格/资产锁。只调用 A 的 `compileScene`，没有专用演示生成器。构建不请求网络；输入在构建中改变会终止发布。完整 staging 含一代构建锁，失败不替换旧场景；中断后可恢复目录或同步已发布锁。
- jobs 持久化 queued/running/succeeded/failed/cancelled、阶段/进度/产物/诊断；worker 编译/取消、重开后显式恢复；跨 CLI/batch/studio 的项目锁，陈旧锁回收有原子仲裁，写终态失败返回错误并释放 waiter。
- `src/local-server/index.js` / `.d.ts` 的 `createLocalServer`：§12.5 所有路由，注册/打开/编辑项目、真实任务与取消、dist 静态资源。默认 loopback，Host/Origin 校验、JSON body 限额、路径/符号链接拒绝。额外提供 workspace 内 JSON import 和 site 资源。source studio 使用真实 Vite middleware，production 使用 studio/dist；缺 UI/编译器/SDK 返回清晰失败。
- 本地声明式配方包两版本安装、兼容检查、内容寻址、锁定、全阶段重建和回退；外部 JS 不执行。官方内置模块是唯一可信代码包读取特例。调用 C 的 `createLandmarkRegistry({overrides: ID对象})`。
- Web 导出打包 SDK 和 dist，使用相对路径、不复制源数据/缓存；GLB 读取所有 chunk 的最高几何档二进制 CINK，明确材质限制。PNG 有实际浏览器实现；本分支 fallback 需要 Playwright/Chromium，集成后优先 E 的 browser adapter。PNG 未在 B 单独做浏览器验收。

补充契约：HTTP 返回 CLI envelope 外加 candidates/projects/project/job。project 为 `{id,relativePath,config}`；任务支持嵌套 `{kind,parameters}` 和 E 客户端的扁平参数，resume 支持 job ID 或 true（同项目/类型最新失败项）。studio/batch `--offline` 强制生效。

A 当前配置使用 `quality:draft`、`source.kind:local` 与字符串 packages；B 在 compile 调用处把公共 `low`、`import`、含锁元数据的 packages 对象转换为上述值，原项目配置保持不变。默认 balanced/sample 均直接兼容。内部 tasks/recovery helper 要求调用者持有项目锁；CLI/jobs/service 已取得。

## 验证与证据

Windows、PowerShell、Node v22.11.0。`npm ci --no-audit --no-fund` 成功，无新增根依赖。

| 命令/检查 | 实际结果 |
| --- | --- |
| `npm test`（代码 e17213a） | **167/167 pass**：原138 + B新增29；原始输出 `tests.tap` |
| `node --test test/phase1-data.test.js test/phase1-cli.test.js` | **29/29 pass**，包含真实 worker+本地 HTTP fixture 的限速/离线 |
| `npm run build` | pass；既有 Three.js >500 kB 提示仍在 |
| `python -m py_compile scripts/fetch_osm.py scripts/osm_map_areas.py` | pass |
| `git diff --check` | pass |
| `verify-toolchain.mjs <真实组件临时快照>` | pass，详见 `real-core-results.json` |
| 小范围真实 Overpass | **fail**：主源 POST/GET 均502；显式选另一源后25s超时；没有成功缓存，详见 `network-results.json` |

真实组件临时快照由 `git archive 8771df63811f24a034ae5d4d1c93c2d0552188a2`（D 已组合 C `e44b9db`、A `8771df6`）加 B `eb9a4ae` 自有文件构成。只在 Temp 提取并通过 junction 使用本 worktree node_modules，未改其他 worktree。它不是 E 最终集成分支。复现脚本：

```powershell
node docs/phase1-evidence/data/verify-toolchain.mjs <已集成A/C/D/B的目录> <可选结果JSON>
```

该脚本未注入 compiler/generator：离线三要素样例连续两次 build 核心 hash `6b2ffaec5bb8abfc2bb1b6f6aaa52a6122de99e1857a86434b181382e810ca75` 相同；Web 真打包、GLB 87,944 bytes 且 magic 正确；真实 OSM 中国尊 way/599547918 两版配方导致全部三级主体资产哈希变化，rollback 恢复原资产和内容哈希；真实北京全快照编译取消保留旧 manifest，重开队列 resume attempt=2 成功；北京/京都两地点+故障项 batch 为 succeeded/succeeded/failed，修好后恢复为全部成功，仅故障项 attempt=2。它不包含 GPU/工作台 UI 或外网成功证明。

## 独立审查

审查 agent `/root/review_data_cli`，用户指定 `gpt-6.1-sol` / `xhigh` / `fork_turns:none`，只读固定提交和运行独立故障 fixture，未替作者改代码。

初审 `664dfd2` 18/18 测试通过但发现8项真实缺陷：持久化 ID 越界写、跨队列并发、旧取消标记、终态写失败挂起、worker 限速隔离、batch 离线丢失、import 不互斥、parse 错误破坏 JSON。均修复于 fbe15a8。复审25/25及8个独立原始fixture通过，再发现 stale lock 回收竞态和 validate 恢复绕锁，修复于 c38bc90/5b74d53。

边界复验5b74d53：27/27 pass；项目锁/队列锁分别150轮陈旧锁双争用（含恢复者死亡）恰好一名持有者；持锁 validate 返回 PROJECT_BUSY 且不移动backup/不改根锁；前10项发现关闭。真实四 worker 同源请求独立观测时间 `[0,1111,2227,3337] ms`。eb9a4ae 小diff复跑28/28 pass，另发现开发模块图遗漏官方packages；修复e17213a后独立复验29/29 pass，styles/landmarks均200，private/data/public/data/其他package/@fs均404，HTTPS Origin 403。**11项发现全部关闭**。审查者还独立执行真实组件verify-toolchain脚本退出0，复现相同样例hash、GLB大小、规则回退、取消恢复和批处理结果。完整记录见 `review.md`。

## AC 状态

这里是 B 组件交付边界；不是一期全部完成声明。严格含 UI/真实外网的条目保留未验收。

| AC | 状态 | 范围/限制 |
| --- | --- | --- |
| AC01 | pass | 原138保留，完整167测试与生产build通过；北京UI机位比较由E |
| AC02 | not-run | B离线样例/真实core build pass；断外网工作台切画风待E浏览器 |
| AC03 | pass | B坐标/官方ID/OSM链接/多候选/空结果/范围原点测试；真实Photon搜索非此pass依据 |
| AC04 | fail | 代码与错误fixture pass，真实小范围获取未成功（502/timeout） |
| AC05 | pass | cache hit、显式刷新、损坏哈希、取消旧数据保护 |
| AC06 | pass | 真实core同锁重建相同hash；配置/引擎/规则变化可解释 |
| AC07 | pass | 组件故障/中断、真实worker取消保旧产物、重开resume已跑；E工作台交互另验 |
| AC15 | pass | 真实C配方1.0.0/1.1.0安装/兼容/锁/几何改变/rollback恢复 |
| AC21 | not-run | B真实Web打包pass，非根路径断网与全画风浏览器验收由E/D |
| AC22 | not-run | B完整GLB实际产物pass；PNG浏览器/署名画面与D导出总验收待E |
| AC23 | pass | 真实北京/京都+故障项，部分状态与退出码逻辑、恢复仅失败项 |
| AC24 | not-run | B help/JSON/类型与回归pass；陌生审查者扩展风格/配方的整项门槛由C/E |
| AC25 | pass | loopback/Host/Origin、项目路径/符号链接、恢复任务边界、取消、无shell接口 |
| AC26 | not-run | B未改根发布配置；E的npm pack必须排除data/cache/site/generated exports |
| AC27 | pass | B独立初审/修复/多轮原fixture复验；E最终整体验收另行 |

## 集成说明和剩余边界

1. 将以上7个代码提交按顺序 cherry-pick，再收本目录证据提交。根 bin 注册 `city: ./bin/city.js`、Node>=22.11、scripts由E加入。本模块无新数据/服务依赖；source Web bundle用现有Vite。若保留B fallback PNG需要Playwright+Chromium，优先采用E的原生浏览器adapter即可免该依赖。
2. E已提前实现 `src/cli/export.js` / browser-export/browser-session，产生唯一已知文件所有权冲突。**选择E的export.js**，保留B最新 tasks.js 的 validate/锁/codec契约，E browser adapter调用D实际导出。B export.js已经真实验证Web/GLB，可作参考；不要同时保留两套viewer生成逻辑。复验E发布阶段取消与非根路径静态交付。
3. C默认包源码是受信任 JS declarations；外部更新为声明式JSON。请保留B对C权威validator/engineCompatibility、ID-keyed overrides的适配。A若统一enum/packages协议，可删显式alias转换；不应丢掉项目锁里的包哈希/回退元数据。
4. B服务按E当前client支持 `sample:true, source:{kind:'sample'}`、扁平offline/refresh、resume:true，创建时补默认source.file。重新打开已建项目会返回config；E可按manifest是否存在自行预览。
5. 外网获取尚未成功，必须从允许访问的环境复跑AC04；不得把本地HTTP fixture或现有仓库快照当live成功。不要通过429端点轮换或大量切片绕限流。公开Photon/Overpass无SLA；原始记录已保存。
6. 未测非Windows、移动GPU、工作台浏览器、PNG、高分辨率或扩区性能。本任务没有修改LOD/SDK来替代D验收。源数据/缓存/生成模型未加入此次提交，Temp产物不属于发布包。全部功能源码已实现；上述缺口是明确的服务/依赖集成验收边界。
