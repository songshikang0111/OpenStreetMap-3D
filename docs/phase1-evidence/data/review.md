# B 独立审查记录

审查日期：2026-11-03。审查者 `/root/review_data_cli`，gpt-6.1-sol，xhigh，fork_turns:none。实现者整理其只读审查结论；原始消息保留在本对话。审查者未改文件、未创建提交、未递归派发。

初审以 `git archive 664dfd2` 固定代码，避免作者工作区修复影响复现。指定18项测试通过后，独立构造真实FS/HTTP/worker故障fixture，发现以下问题。

| # | 发现与复现结果 | 修复/独立复验 |
| --- | --- | --- |
| 1 | abcd.json内部id指向../../../outside，首次恢复写可覆写根外文件 | id==文件名/类型先校验，外部原文件保持；service对恢复project/参数限制根 |
| 2 | CLI/studio/batch不同queue同项目maxConcurrent=2 | 跨进程项目锁，竞争返回PROJECT_BUSY，正常max=1 |
| 3 | 写.cancel后任务先failed，resume被旧标记cancelled | 终态和resume清标记，复验重试succeeded |
| 4 | 最后persist实际EPERM导致wait挂起active=1 | JOB_PERSIST_FAILED，wait完成active=0 |
| 5 | 4真实worker请求时间[0,3,3,7]ms | 父进程HTTP broker，独立复验[0,1111,2227,3337]ms |
| 6 | batch --offline丢失，空cache仍请求1次并成功 | batch/studio强制offline，复验0请求 |
| 7 | build中HTTP import仍200，source哈希改变job成功 | import/PATCH忙检查+跨入口锁，复验409 |
| 8 | build --bogus --json stdout含failed前缀 | parse前保留JSON意图，复验单条有效JSON |
| 9 | 两陈旧锁回收者都claim成功，simultaneousOwners=2 | 恢复锁原子仲裁；项目/queue各150轮含恢复者死亡，恰好1owner |
| 10 | validate绕锁把活动publisher的previous-dist移回dist | CLI validate持锁，复验PROJECT_BUSY且backup/root lock不变 |
| 11 | dev allowlist漏/packages，源style200但后续官方包404 | 限定styles/landmarks依赖；原case两包200，其他package/private/data/public/data/@fs404 |

`fbe15a8`：25/25与原8个独立case通过；`5b74d53`：27/27，#9/#10关闭；`eb9a4ae`：28/28但发现#11；`e17213a`：**29/29，已报告11项全部关闭，本轮无新阻断**。HTTPS Origin独立复验403。

审查者独立运行 `verify-toolchain.mjs` 针对组合快照 `8771df6(A/C/D)+eb9a4ae(B)`，Node22.11/Windows，退出0、未注入compiler。确认同锁样例重建hash一致（6b2ffae...），真实Web打包、GLB87,944bytes/glTF magic，中国尊两版本几何不同且回退资产/内容hash恢复，实际北京全快照取消保旧manifest/重开resume attempt2，北京+京都+故障batch partial/恢复仅失败项attempt2。

独立结论限定于B组件、真实本地worker/HTTP/FS及临时真实核心组合。它不是E最终集成、工作台浏览器、GPU性能或live外网验收证明。外网502/timeout保留为未通过。
