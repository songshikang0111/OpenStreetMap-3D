# 主对话独立只读审查：架构／数据／交付边界

日期：2026-11-03。审查 HEAD：`7c837551f5e364c98bbc19adf8d5af73a6a2ab85`，Windows / Node 22.11.0。先读 AGENTS、phase1-plan 全部 AC 与 integration/acceptance，再抽查真实实现和既有独立证据。未修改产品文件、未暂存／提交，未重跑全套测试，未启动 GPU。临时真实 sample build、API fixture 与探针均在本目录；结束时 tracked 工作区仍清洁。以下只报告证据，不作一期总体通过决定。

## R1 — P2：自定义项目风格可以成功导出为无法独立加载的站点

位置：`src/cli/export.js:19–24`、`studio/static-viewer.js:2–6`、`src/styles/index.js:23–26`。真实 sample build 后，复制随包教程 sepia 到项目 `styles/sepia.js`，保存 `style:{id:'project-sepia',parameters:{}}`，`exportProject({format:'web'})` 返回 succeeded、空 diagnostics；产物配置仍指定 project-sepia，但 site 只有 scene、SDK、viewer，没有 sepia 模块或注册代码。新页面默认 registry 只有四官方风格，对该 ID 会抛 `Unknown style: project-sepia`。后者由实际公开 registry lookup 确认；本角色未启动浏览器验证错误画面。

契约边界：`ProjectConfig.style`（`src/core/index.d.ts:11`、project Schema）正式允许字符串 ID 和参数，实际 patch/save 接受该 ID；它**没有** style module/entry 字段，也没有承诺按文件名自动扫描 `styles/`。教程 `docs/extensions.md:7–17` 明确要求开发者在自己的应用 import + registerStyle；该 SDK 路径存在且本次实际注册成功。因此本发现不是“外部 SDK 风格未实现”，也不把简单放文件就应自动发现当作已定义的 API。缺口是项目风格序列化与标准站点导出之间没有模块映射／打包途径，也未在无法解析风格时拒绝成功发布。规划 §4（第99行）承诺查看器、SDK、风格、资源全部本地打包，§3/§4/§9允许项目外部风格。

影响 AC21 的自定义风格导出范围；不推翻已证明的 AC13 独立 SDK 风格能力。`integration/acceptance.md:41` 将“四官方/外部风格”合并作为导出站点依据，但 `review-studio/browser-review.mjs:16–20` 的五风格浏览器实际打开的是手工 consumer/app，而不是 `city export web` 产物。两种交付应分别验证和标注。

复现：`node docs/phase1-evidence/root-acceptance/architecture/reproduce.mjs`；原始输出 `findings.json.externalStyle`。

## R2 — P2：SDK 覆盖已校验的 aoStrength 风格参数

位置：`src/sdk/index.js:79`。正式参数 Schema 在 `packages/styles/index.js:7` 声明 aoStrength，`createStylePipeline` 正确将用户值写入 ink uniform，但 SDK 紧接着在任何带 ink 的 pipeline 上强制写成 balanced/high 的 `.65` 或 low 的 `0`。例如 `{id:'comic',parameters:{aoStrength:.12}}` 在实际 style API 产生 `.12`，随后 SDK 源码确定覆盖为 `.65`。保存项目、工作台预览和静态查看器共同使用 SDK，因此合法保存的画风参数不能忠实恢复。质量档位可以禁用 AO，但开启时不应无条件覆盖用户参数。

影响 AC13 风格参数、AC24 公开 Schema 与行为一致性，并影响 AC21 保存配置后的画风保真；不构成几何确定性 AC06 的失败。`style-parameters.mjs` 只调用真实 style API，确认 `.12` 正确到达 pipeline，未创建 WebGLRenderer；SDK 后续覆盖为源码证据，未冒充浏览器实测。

## 下载与端点配置观察

本次实际 live 查询：Photon 查询“北京 中国尊”，15秒 timeout／0 retries，2,407 ms 返回1候选；相同 Node 请求通道对正式 fetchArea 使用 AC04 的具名 bbox，保留产品75秒 timeout／0 retries，1,317 ms 收到默认 `https://overpass-api.de/api/interpreter` 的 HTTP502。另外 Node 和 PowerShell 对 `/api/status` 均在约15秒超时；环境 HTTP_PROXY／HTTPS_PROXY／ALL_PROXY／NODE_OPTIONS 未设。详见 `network-observed.json`，可选探针脚本 `network-probe.mjs`，本次不继续大量重试。

判断：AC04 当前仍没有成功真实下载；此次失败不是因报告使用20秒 timeout 太短，因为75秒配置同样快速得到502；Photon成功也排除了全部外网／全部 Node fetch 不通。现有证据支持默认 Overpass 或其网络中间链路返回错误，不能区分公开上游服务与代理／网关，不能声称已定位为上游全面宕机，也没有发现查询 bbox 顺序错误。

低层 fetchArea 有 endpoint、searchPlaces 有 photonUrl／overpassUrl；正常工作台 fetch 参数白名单仅 refresh/offline（`src/local-server/index.js:96`），CLI data fetch 没有 endpoint 选项（`src/cli/index.js:35,121`）。一个被配置校验接受并保存的 `source.endpoint` 实际不会传到 fetchArea（`src/cli/tasks.js:125`），fixture 观察到仍请求默认源；CLI --endpoint 为 UNKNOWN_OPTION，API parameters.endpoint 为400 INVALID_PARAMETER。**source.endpoint 并非正式命名的项目契约字段，因此本观察不单独定级为违反该字段承诺的缺陷**。batch parameters.endpoint 和直接 data API 是现有替代入口；工作台缺少显式选择数据／搜索服务的产品配置路径，限制默认源失败后的可复用性。不要把这个限制与502根因混为一谈。AC03一般地址 live 有单例成功；同名、无结果等仍以既有 fixture 为证；AC04失败状态应保留。

其他抽查未得到新的 P1/P2：worker 调用实际 compiler、配置／引擎／配方指纹、项目锁和发布恢复、CINK 哈希／长度验证与原子资源替换均有具体实现和既有针对性证据。AC18既有预算失败未被本角色重测。AC27工作台独立浏览器补验由主代理执行，本报告不替代。

文件：`reproduce.mjs`、`findings.json`、`style-parameters.mjs`、`network-probe.mjs`、`network-observed.json`。网络 probe 不在 reproduce 中自动触发，重复运行 fixture 不会增加公共服务请求。
