# 冻结前正式CLI复验准备

2026-11-03。预检HEAD `a273e6a05182f989966cc3136b1cd6ea7f289889`；只读预检成功，**正式CLI执行数0，未重建场景**。目标是已复制的 `work/root-remediation-acceptance/live-rebuild`，脚本不引用或修改原B项目。

`verify-live-cli.mjs --preflight` 确认目标源文件SHA为 `cc8d7da7f9059f9705091995c348c57cf9a656cc48de42a21fd2ab50a319e4a6`，1111个OSM要素的独立canonical SHA为 `69427e177a82fc1671deee1230ff438bccf6482af014e350dce82859c1c11aab`，含5建筑、21建筑分部。原endpoint/GET、retrievedAt、upstream sourceHash、OSM base timestamp、来源/许可均保留；已有cache的key/contentHash/snapshotHash与实际JSON、源快照一致，旧build lock也指向同一源文件与elements。详见 `cli-preflight.json`；旧engine场景将由正式步骤重建，预检不假称已validate当前engine。

等待主对话明确最终freeze及允许执行的时段后，从仓库根运行：

```powershell
node work/root-remediation-architecture/verify-live-cli.mjs --run --freeze <40位冻结提交>
```

脚本拒绝HEAD移动或tracked脏工作区，并在每个正式命令前后检查freeze和源/config/cache字节。实际命令仅为 `city data fetch --offline --json`、`city build --offline --json`、`city validate --offline --json`、再次build和validate。要求第一次fetch命中现有cache且source.attempts为空；两次真实build的contentHash、manifestHash、assetHashes、关键manifest hashes与全部inputs相同，并逐个校验资产的实际文件SHA。build时间允许不同；来源endpoint/time/hash和原源文件必须不变。所有阶段stdout JSON、stderr、退出码、耗时写 `formal-live-cli-results.json`。不发新公共下载、不启动浏览器/GPU或npm build。

脚本默认没有--run时只预检；参数需完整freeze，输出只允许本ignored审查目录。只有副本项目的dist/lock/jobs会被正式命令更新；原B项目路径不在脚本中。预检阶段已做node --check，未运行上述正式命令。

同时只读审查 `d028e7e`：preview捕获开始时job ID，progress与whenIdle两处都检查 `canReportScene`，只有无job或同一成功build可报告场景就绪；新failed export的状态不再被旧preview的延迟收敛覆盖。配套VM回归精确覆盖该顺序并保留失败诊断。未发现新实质缺陷，本次未重跑浏览器或VM测试。

## 正式执行追加记录

root已在e11990c执行：5个正式离线命令全部succeeded，fetch为cacheHit=true／attempts=[]，build/validate双轮inputs/content/manifest/4个asset哈希一致；实际源文件、config、data cache与来源时间/端点不变。结果 `formal-live-cli-results.json`，本角色只读复算 `formal-cli-audit.json`。本次追加核对没有重跑CLI。

初次复制误带B绝对路径绑定的jobs，首次命令正确返回JOB_PROJECT_ESCAPE，历史结果保留 `cli-copied-job-store-rejected.json`。root仅将副本jobs完整Move到 `work/root-remediation-acceptance/copied-original-machine-job-store`，随后使用副本新队列成功；原B项目未改，源快照／配置／地图cache未改。jobs为本机操作恢复状态，不能与可重现项目输入混称；该纠正不属于新live下载，正式执行只使用既有真实下载的有效缓存。

最终checks在e11990c：344项tests、strict types、三build与pack四项退出码均0，记录于 `docs/phase1-evidence/remediation/integration/final-checks/`。GPU矩阵及总体放行不由本CLI结果推导。
