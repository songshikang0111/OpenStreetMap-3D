# B 数据修复独立审查

日期：2026-11-03。审查者 `/root/review_data_repair`，gpt-6.1-sol / xhigh / fork_turns:none。实现者整理只读消息，原始审查对话保留；审查者没有修改产品文件、提交或继续派发。

起点 `5cc00de`，最终覆盖 `528ddfebfdba5fcc53e32f88cb83b8467f4da1fe`。先读实际源码/差异/规划和R5失败证据，再运行测试及独立 localhost 服务/worker 故障矩阵，未再访问公共服务。

发现与闭环：

| 发现 | 修复与独立复验 |
| --- | --- |
| 初版 search 接受 fallback 配置但 OSM 对象分支只使用 primary | 92411d8 增加同一有限 fallback 语义，并保持旧默认查询缓存离线兼容；回归通过 |
| provider 在平铺参数合并后被低优先级旧 endpoint/POST 覆盖：batch、CLI resume、PATCH、新建项目；同类 HTTP nested/flat 问题 | cf3863e 在合并前仅展开显式 preset 的 endpoint/transport；原四个独立复现全部改为正确Dresel/GET，保留原fallback策略。HTTP nested 另有回归 |
| partial fallback-only override 错误地与内置默认 primary 检查重复，拒绝合法自托管 primary + main fallback | 528ddfe 只校验已提供字段，最终分层解析后再校验主/备用跨字段约束；独立 PATCH、正式CLI、真实service worker均成功，仅请求localhost |

独立结果：指定测试最初36项，最终 **41/41 pass**；types pass。当前没有未解决P1/P2。

- 真实服务/worker、无runner注入：网络断连实际有限3次/约2s和4s退避，再POST fallback成功；503可fallback；HTTP500+长Retry-After、坏JSON/OSM remark、超大响应、429/406和取消均不换源。
- GET503 同origin fallback 两次请求相隔1107ms。坏JSON刷新和运行中取消保留旧source文件；取消关闭底层连接。
- 429 Retry-After=120 首个worker失败后，第二worker及父进程HTTP请求均等待同源cooldown，取消后没有新请求。
- 四个实际batch workers、无runner注入，独立脚本观测 `[0,1117,2224,3333]ms`，gaps为1117/1107/1109，全部succeeded，见 `worker-throttle-independent.json`。只证明同一CLI父进程broker，未声称跨所有进程全局限速。
- 只读核对正式公共下载项目 `work/data-remediation/live-Slwqd9`，在最终528ddfe上再次离线validate成功：1111要素、5建筑、21分部；source/cache/manifest/lock哈希与 `formal-provider-results.json` 一致，sourceFileHash=cc8d7da7…e4a6、manifestHash=04e9b128…9b61。
- URL、项目路径、任务参数白名单及任意headers/shell拒绝路径未发现绕过；source类型、Schema与运行时对齐。

审查没有把欧洲实例成功解释为默认全球主源可用；默认POST的502独立保留。没有替主对话宣布一期总验收通过；E的最终Studio UI与整合提交仍须由主对话验收。
