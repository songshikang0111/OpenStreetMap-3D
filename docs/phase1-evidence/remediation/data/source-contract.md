# 可配置数据源契约（B 修复）

日期：2026-11-03；修复起点 `dee3cc8`。新增字段只影响 source，未改 style 字段格式。所有网络动作仍是本机工具触发的有界 Overpass 查询，生产 SDK 不依赖本机 API。

```json
{
  "source": {
    "kind": "overpass",
    "file": "data/source.json",
    "provider": "dresel-europe",
    "endpoint": "https://ovp.dresel.systems/api/interpreter",
    "transport": "get",
    "fallbackEndpoints": [],
    "fallbackPolicy": "none"
  }
}
```

`endpoint` 是完整 interpreter URL。允许 HTTPS 和自托管 HTTP；不允许相对路径、其他协议、用户名/密码、query 或 fragment。API 密钥不要存入项目/公开场景；需要认证的服务可在用户控制的反向代理后接入。`transport` 为 post/get。默认保留 FOSSGIS 主实例与 POST；它不是 SLA 承诺。本机观测不能说明全球通用可用性，因此不会暗中把全球默认切为欧洲区域服务。

用户不必自行试 URL/方法：`city data providers` 返回四个受文档核对的预设与覆盖范围；`--provider dresel-europe` 自动选择区域实例的 URL+GET，`--provider vk-maps` 自动选择全球实例的 URL+GET（后者本机较大北京请求仍有504，不承诺稳定）。provider 可在项目 source、CLI、batch 参数、studio 默认与 HTTP job 中统一使用；显式 endpoint/transport 覆盖预设，实际 URL 不属内置预设时解析结果标为 custom。默认 overpass-main+POST 仍须单独列实测失败，不与区域预设成功合并。

`fallbackEndpoints` 最多两个且与 primary 不重复。默认 `fallbackPolicy:none`，没有隐式端点轮换；显式 `unavailable` 仅在连接错误、超时或 HTTP502/503/504 后尝试下一个已声明端点。429/406、其他HTTP错误、无效JSON/OSM、引用限额及用户取消均不回退。每个端点沿用有限请求重试与有界超时；不是无限重试。所有候选采用同一 transport。

已有有效缓存优先（按 primary、显式 fallback 顺序），含离线读取；若缓存来自 fallback，会返回 FALLBACK_CACHE_HIT。`--refresh` 必须成功获取新数据才替换，失败不悄悄用旧缓存宣告刷新成功。POST 延续旧 v1 缓存键，GET 使用独立缓存键，范围/端点/查询版本均参与。源记录实际 endpoint/transport、requestedEndpoint、retrievedAt、OSM base timestamp、查询、原始sourceHash、标准化contentHash、对象版本及有界sourceAttempts；结果区分 cacheHit 与真实请求。

同父进程的 worker/search 共用来源队列。429/406 至少等待30秒并尊重更长 Retry-After；重试次数耗尽仍保留同源 cooldown，下一请求可取消且不会抢先重发。不会因限流切到其他服务。现有小范围、响应大小、引用补全、原子写入与本地服务 Host/Origin/path/任务锁边界保持。

## CLI 与 batch

```powershell
node bin/city.js data providers --json
node bin/city.js init work/my-city --area 48.137,11.575,48.1375,11.576 --provider dresel-europe --json
node bin/city.js data fetch --project work/my-city --json
node bin/city.js data fetch --project work/my-city --offline --json
node bin/city.js build --project work/my-city --offline --json
node bin/city.js validate --project work/my-city --offline --json
```

init 的 source flags 保存进项目；fetch 的 flags 只覆盖本次持久化 job（可恢复），不会暗改项目。允许 `--provider ID --endpoint URL --transport get|post --fallback-policy none|unavailable`；`--fallback-endpoint URL` 可重复两次，提供该选项默认明确启用 unavailable，除非显式给 none。

相同 flags 可用于 search、batch、studio。batch flags 仅覆盖 fetch 项，优先于该项 parameters，再优先于项目 source。没有全局 flags 时，各项可在 parameters 放同名 endpoint/transport/fallbackEndpoints/fallbackPolicy。`--offline` 总是强制无网。恢复 fetch 可用 `jobs resume JOB_ID --project ... --endpoint ...` 改用明确来源；成功项仍不重复。

studio flags 是该服务的默认值，优先级为 **job override > project.source > studio defaults > built-in defaults**。项目配置缺省值不会覆盖 operator 显式默认。`PATCH source` 支持字段级合并，保留 kind/file。source 校验同时接入 Node 项目入口、浏览器可用的核心 config validator、公开类型和 JSON Schema。

## E 的工作台接线

- `GET /api/data-sources` 返回 envelope + defaults/providers/limits/fallbackOn/neverFallbackOn。providers 只是一组可编辑起点，含 coverage/documentation，未承诺每个源可用。自托管输入不要求使用 catalog。
- `GET /api/projects`、`GET /api/projects/:id` 的 project 含 `config.source` 原始配置和 `dataSource` 已解析有效配置。用户编辑 source 后 `PATCH /api/projects/:id`，例如 `{source:{provider:'dresel-europe'}}`，或自托管 `{source:{endpoint,transport,fallbackEndpoints,fallbackPolicy}}`。
- 创建项目仍支持 source；显式 studio 默认会保存到新项目的 source。构建不联网，不自动刷新。
- `POST /api/projects/:id/jobs`，`kind:fetch` 的 parameters（或兼容的扁平字段）接受 provider/endpoint/transport/fallbackEndpoints/fallbackPolicy 以及 refresh/offline。服务在入队前验证并固化有效 source；不接受 cacheDir/area/任意 requestOptions/headers/shell。
- resume 可接受相同 source override，保留原项目与 job kind 检查。返回 job.result.source 为 `{endpoint,transport,retrievedAt,sourceHash,osmBaseTimestamp,cacheKey,attempts}`；UI 应显示实际源与 fallback/cache 诊断，不能把 cache 命中标成新下载。
- `GET /api/search?...&projectId=...` 对 OSM 对象定位使用该项目的有效源与有限 fallback；普通文本仍走 Photon，旧默认查询缓存继续离线可读。坐标/官方地标保持离线可用。
- source 若为区域服务，应展示 provider coverage，例如 Dresel 是欧洲区域每日快照，不能作为北京/全球默认或全球自动 fallback。没有建筑继续显示 NO_BUILDINGS，不编造建筑。

## 官方资料与实测边界

2026-11-03核对：[Overpass共享资源规范](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)、[OSM实例目录及覆盖范围](https://wiki.openstreetmap.org/wiki/Overpass_API)、[Private.coffee运营者与当前端点](https://overpass.private.coffee/)、[VK Maps部署](https://maps.mail.ru/osm/tools/overpass/)。旧 kumi 名称已迁移至 private.coffee。

本机75秒配置的 private.coffee POST超时，VK POST返回504；VK GET曾对北京极小范围成功返回一个真实银行点，扩大后正式CLI请求504，未将该失败改写为成功。Dresel欧洲GET对明确慕尼黑小范围两次实际返回1111要素（含5建筑/21分部）；**正式 CLI fetch → 离线缓存命中 → 真 compileScene build → validate 已成功**。只是本次可复现路径；不是整个外网不可用或任意端点可靠的结论。完整正式结果和失败观察随 handoff 归档，原始地图和生成模型留 ignored work。

可显式复跑（会发一次真实网络请求）：

```powershell
node docs/phase1-evidence/remediation/data/live-download.mjs --provider dresel-europe --area 48.137,11.575,48.1375,11.576 --output work/data-remediation/formal-provider-results.json
```

不传 source flags 则独立测试真正默认路径；脚本默认同一慕尼黑 bbox，失败保留完整正式命令/诊断，不借已有缓存或旧快照绕过。
