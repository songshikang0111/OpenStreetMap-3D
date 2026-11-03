# 修复后独立只读架构审查（B/C与参数修复复验）

2026-11-03。请求起点 integration `0e9d282`；E仍在同工作区集成，随后经 `b64da59`、`7f87ef1`、`fdf2d0b`。未编辑产品、提交、访问公共网络或启动浏览器/GPU；只创建本 ignored 目录下的探针与结果。本轮不是最终freeze整体验收。

阅读 remediation规划、B最新handoff（数据worktree的75091db文档）、C handoff与实际代码／测试。B的正式live证据在组件worktree，集成目录尚未完整归档该handoff；未把它写成当前集成提交新跑的网络实验。

## 已证实的修复

- B：source/provider/endpoint/transport/fallback契约已接入CLI、项目、batch、resume、HTTP白名单；preset优先级和partial override具有实际修复。公开源默认仍main+POST，欧洲provider明确限定覆盖，未隐式替换全球默认。
- B：fallback只对网络/timeout/502/503/504生效；429/406保留同源cooldown且不换源；parent broker共享worker限速。未发现新的实质P1/P2。定向测试包括真实localhost worker，无公共服务请求。
- B live证据只读复核：1111要素、5建筑、21建筑分部；source文件SHA `cc8d7da7…e4a6`、elements contentHash `69427e17…11aab` 与正式报告一致，锁文件sourceFileHash一致；正式记录依次为首次cacheHit=false、离线cacheHit=true、build、validate成功。只支持明确欧洲小bbox，不证明默认main+POST恢复，也不冒充本次新live下载。
- C：明确entry/dependencies/assets；标准export先打包并校验再原子发布，共享SDK/style registry/loader，官方与外部画风打包路径都存在；低层helper正式package子路径由E补入，实际self-reference import成功。既有C独立真实浏览器证据来自标准导出产物而非旧手工consumer。
- D对旧AO覆盖：真实style pipeline+生产applyPipelineQuality在strength=0/.12/1、aoQuality=0/1/2保留全部参数，quality0只禁用AO。不是浏览器截图量化。
- 本轮 `node --test test/phase1-data-source.test.js test/phase1-styles-export.test.js test/phase1-runtime-style-quality.test.js`：19/19 pass，6.31s；`targeted-tests.tap`。不等于全量tests/build/最终安装包或浏览器复验。

## C-04，P2：未支持的参数类型被接受并跳过验证（已关闭）

`src/styles/index.js:19,29–32` 的metadata校验接受任意property rule，公开`StylePack`类型也将type声明为string；运行时只检查number/boolean/string。实际定义count为`{type:'integer',minimum:0,maximum:5,default:1}`，validateStyle成功，resolveStyleSelection接受1.25；实际bundleProjectStyle对count=-2.75也返回成功并发布descriptor。与“无效参数在发布前失败”的修复契约不一致，影响AC24，也影响AC21外部风格参数保真。

最小复现：`node work/root-remediation-architecture/style-probe.mjs`，原始失败证据 `style-before-fix.json`，记录实际probe提交fdf2d0b。探针不访问网络、不启动viewer，仅打包本地显式ESM。该脚本保留原先未捕获错误的写法，修复后会在非法1.25处抛错；成功复验改用下述断言脚本。

修复合入 `351da1eb618d855291ec66584890b95bad851c77`。新增 `src/styles/parameters.js` 统一Schema与值校验：明确number/integer/boolean/string子集，限制rule关键字，安全整数／有限数字／范围／enum／default／null分别验证；类型、Style Schema、教程同步。独立只读复验：

- `node work/root-remediation-architecture/verify-parameters.mjs`：在351da1e首次 **23/23 pass**，包括原1.25与-2.75、整数0/1/5、范围外、null/string/bool、unsupported Schema、非法default/enum/minmax、三种其他primitive与官方AO null。真实标准export对非法整数返回STYLE_MODULE_INVALID，已存在site的viewer-config文件哈希保持不变。最新扩展复跑结果见下面29a2e36追加复验。
- `node --test test/phase1-styles-export.test.js test/phase1-style-parameters.test.js test/phase1-runtime-style-quality.test.js`：**11/11 pass**，4.02s，`parameter-targeted-tests.tap`。
- C严格类型消费 `node node_modules/typescript/bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 docs/phase1-evidence/remediation/styles/parameter-typecheck.ts`：退出0。

本发现修复与原复现闭环，C-04关闭。本轮已审查B/C范围无未解决实质P1/P2；不是完整一期或最终freeze放行。

## 稀疏enum最终补丁复验

C另一独审发现Array.some跳过稀疏槽；组件修9ef9b03已合为integration `29a2e360d1ac7f8613957a0675c677e57b2f1f70`。只读核对 `parameters.js` 改成for-of遍历，每个稀疏槽按undefined处理并拒绝；没有扩展不受支持的规则。

扩展并重跑原独立探针 `verify-parameters.mjs`：**26/26 pass**，`parameter-retest.json`记录29a2e36；原23项全保留，新增Array(1)、[1,,]注册拒绝，以及两个真实ESM入口的标准export拒绝。后者均返回STYLE_MODULE_INVALID，原site的viewer-config哈希不变。该探针仅为原有小型离线sample编译／标准导出，没有npm build、浏览器、GPU或公共网络。

`node --test test/phase1-style-parameters.test.js`：**4/4 pass**，5.96s，`sparse-targeted-tests.tap`。未发现该最终补丁引入新的实质缺陷；B/C本轮先结案，最终E product freeze后仅需复核差量／安装包与归档结果。

当前未据组件结果关闭AC27，也不判定整体验收通过。E最终工作台接线／安装包／browser与A/D完整冻结后的几何和性能仍由后续同一freeze验证。

## 数据获取偏好与构建锁追加复验

只读审查 `446a94c` 与 `e5a7de4`，执行时HEAD `e5a7de48b92c10707ec3de3fb63e881a94b5def7`。446a94c仅从buildConfigHash的source中剔除DATA_SOURCE_FIELDS（provider/endpoint/transport/fallbackEndpoints/fallbackPolicy）；source.kind/file与未声明的其他identity字段仍纳入。完整configHash继续记录实际构建配置并用于编译期间INPUT_CHANGED检查；sourceFileHash和dataHash继续独立约束输入文件bytes与要素内容。保存下一次获取偏好不会改写旧manifest／来源／build lock，也不会冒充刷新了数据。该语义符合既有快照与获取策略的区分，未发现新的实质缺陷。

独立最小复现 `node work/root-remediation-architecture/verify-source-build.mjs`：**9/9 pass**，`source-lock-results.json`。从带显式provider的合成sample锁出发，五个获取字段一起修改后validate成功，完整configHash与保存配置区分仍存在，源文件／manifest／lock字节未被validate改写；source.kind、source.file（即使复制同样bytes）、area、seed、generation变化均STALE_BUILD；仅追加JSON空白（elements不变）也因sourceFileHash失效，实际OSM高度变化同样失效；origin仍在geometry hash内。仅一次小样例Node编译，没有npm build／网络／浏览器／GPU。

e5a7de4的SDK progress callback在state.job存在时不覆盖任务状态，取消按钮也只对真实非终态job可用。实际Studio模块的VM回归覆盖failed export后迟到complete progress、预览竞争与旧项目失败，不是浏览器画面验证。本轮 `node --test test/phase1-remediation-source-build.test.js test/phase1-remediation-studio-race.test.js`：**3/3 pass**，0.75s，`source-ui-targeted-tests.tap`。E真实UI复验与最终freeze仍独立完成。

证据：`style-probe.mjs`、`style-before-fix.json`、`verify-parameters.mjs`、`parameter-retest.json`、`parameter-targeted-tests.tap`、`sparse-targeted-tests.tap`、`data-and-ao-probe.mjs`、`data-and-ao-results.json`、`targeted-tests.tap`。

追加证据：`verify-source-build.mjs`、`source-lock-results.json`、`source-ui-targeted-tests.tap`。

## 最终freeze前CLI准备与延迟预览guard复核

只读复核d028e7e捕获preview开始时job ID，并同时保护progress与whenIdle状态；新的失败export不会被旧preview结束覆盖，配套VM回归顺序具体，未发现新增实质问题。本次不重跑UI／GPU。

已准备 `verify-live-cli.mjs`，默认／--preflight仅检查副本快照与cache，--run必须显式40位freeze并检查tracked清洁。预检 `a273e6a` 成功，原B源文件／elements SHA、来源、1111要素、5建筑／21分部、cache及旧lock一致；**正式CLI命令数0，未重建**。最终freeze通知后才执行fetch--offline、build/validate两轮并核对真实资产／关键哈希确定性。说明 `cli-preflight.md`，原始预检 `cli-preflight.json`。不访问公网、不修改原B项目。

## e11990c正式离线CLI执行结果只读核对

root已在产品 `e11990c5dc6175dbdae7c2789b2c3a4e4f7f0a9c` 执行准备好的正式脚本，`formal-live-cli-results.json` 为 **5命令全部exit0/succeeded**：data fetch--offline命中cache，build--offline、validate--offline，再build/validate。未进行新live请求；首次原始下载的依据仍为B的正式provider记录。

本角色只读核对完成记录，未重跑CLI：`audit-formal-cli.mjs`／`formal-cli-audit.json`。独立重算副本source/config/manifest/全部4个锁定asset的实际文件SHA，重算data cache的snapshot/contentHash，与两轮records、lock和来源字段逐项一致；原脚本逐命令cache字节guard也全部通过。两轮inputs、contentHash、manifestHash、assetHashes、关键manifest hashes精确相同，builtAt允许不同。contentHash=`5e0429bbcd3cbcb33bdbc167ca3c77961fddd4a8daf28659fd811d9a3723bd87`；manifestHash=`e47832b109ba79796232b7698ff855c184f74d6208cf6489c7782a7cd2109902`。source文件仍cc8d7da7…e4a6、elements仍69427e17…11aab；原endpoint/GET、2026-11-03T12:48:21.266Z获取时间、OSM base与sourceHash保持。

第一次复制项目时同时带入了B的`.city-cache/jobs`，其中3条持久job仍绑定B机器的原绝对project路径。正式CLI在队列打开时正确拒绝JOB_PROJECT_ESCAPE／exit1，保留于 `cli-copied-job-store-rejected.json`，不改成成功。该目录属于本机、绝对路径绑定的操作／恢复状态，不是地图源快照、配置、数据缓存或场景包的语义输入。root验证路径后**只把副本的jobs完整移动**至 `work/root-remediation-acceptance/copied-original-machine-job-store`，没有修改原B项目，也没有改source/config/data cache；新副本队列重新建立并执行成功。这是项目迁移准备的纠正，不能写成下载重试成功或删除了数据错误。

本角色实际读取移出的3条job，确认均指向原B项目；副本当前3条新job均指向副本且succeeded。另只读比较原B与副本的source/config字节仍一致。原失败证据和移出目录均保留；正式证据只归档拒绝JSON，不归档机器job store本身。

root的 `docs/phase1-evidence/remediation/integration/final-checks/checks.json` 记录同一e11990c前后HEAD一致，tests/types/build/package四个退出码全部0；TAP确为344/344、fail0。本角色仅核对现有结果，不冒充重新运行全量检查。观察时HEAD55862f0仅新增A证据文档，相对e11990c的产品/Schema/包/测试/脚本路径diff为空；不因此冒充在新HEAD重跑。最终GPU与总体AC结论仍留root及对应独立角色。

新增最小归档文件：`audit-formal-cli.mjs`、`formal-cli-audit.json`、`formal-live-cli-results.json`、`cli-copied-job-store-rejected.json`。不归档副本项目、原B项目、移出job store或生成资产。
