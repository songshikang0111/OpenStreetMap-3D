# 命名候选（WP-A，任务 A5；待用户决定 D1）

查询日期：2026-11-12。本文件只提供候选，不注册任何 npm 作用域、组织、域名或 GitHub 账号。

## 查询方法

- npm 包名：`GET https://registry.npmjs.org/<name>`，404 记为"空闲"。
- npm 作用域：`GET https://registry.npmjs.org/-/org/<name>/package`，404 记为"空闲"。注意：同名的 npm **用户**也拥有同名作用域，该接口不能完全排除这种情况，最终注册前须在 npm 网站上手工确认。
- GitHub 账号或组织：`GET https://api.github.com/users/<name>`，404 记为"空闲"。
- GitHub 同名仓库数：`GET https://api.github.com/search/repositories?q=<name>+in:name` 的 `total_count`，用于判断名字的拥挤程度，不代表冲突。

## 候选

| 候选 | 含义 | npm 包名 | npm 作用域 | GitHub 账号 | 同名仓库数 | 评价 |
| --- | --- | --- | --- | --- | --- | --- |
| `osmcity3d` | OSM + 城市 + 3D，直白 | 空闲 | 空闲 | 空闲 | 0 | 最安全、最易搜索；略显工程化 |
| `cityloom` | 织机：把 OSM 的线织成城市 | 空闲 | 空闲 | 空闲 | 9 | 好记、不绑定城市和画风；需配副标题说明 OSM |
| `mapblocks3d` | 地图积木 | 空闲 | 空闲 | 空闲 | 0 | 无冲突；"blocks"易让人联想到体块（只有盒子） |
| `plinth3d` | 基座：城市场景的底座 | 空闲 | 空闲 | 空闲 | 1 | 有"底图层"的意味；英文非母语用户可能不认识 plinth |
| `tessellate-city` | 镶嵌出城市 | 空闲 | 空闲 | 空闲 | — | 准确但偏长，搜索时易与"三角化"混淆 |
| `city3d` | 城市 3D | 空闲 | 空闲 | 空闲 | 61 | 极其通用，搜索不可区分，不推荐 |
| `urbanlayer` | 城市图层 | 空闲 | 空闲 | **已占用** | 7 | GitHub 账号被占用 |
| `citymesh` | 城市网格 | 空闲 | 空闲 | **已占用** | 17 | GitHub 账号被占用；且暗示网格瓦片，与 R2 不符 |
| `osm3d` | OSM 3D | 空闲 | 空闲 | **已占用** | 12 | GitHub 账号被占用；OSM 商标使用需遵守 OSMF 商标政策 |
| `streetform` | 街道形态 | 空闲 | 空闲 | **已占用** | 7 | GitHub 账号被占用 |
| `blockcity` | 街区城市 | 空闲 | 空闲 | **已占用** | 56 | 拥挤 |

建议优先考虑 `cityloom`（品牌性）或 `osmcity3d`（可发现性）。含 "OSM" 的名字须遵守 OpenStreetMap 基金会的商标政策，发布前应核对。

## 名称在代码中的位置

在 D1 决定前，所有新包使用 `@city-ink/*` 工作名，瓦片扩展名为 `.c3t`。名称集中定义在 `packages/tiles/src/naming.ts`（`SCOPE`、`TILE_EXTENSION`、`TILE_MAGIC`），其他包从这里引用；各 `package.json` 的 `name` 字段由一次全局替换更新。

## 原始查询结果

~~~json
[
 {"name": "osmcity3d", "npmPackage": "free", "npmScope": "free", "githubAccount": "free", "githubReposWithName": 0},
 {"name": "city3d", "npmPackage": "free", "npmScope": "free", "githubAccount": "free", "githubReposWithName": 61},
 {"name": "urbanlayer", "npmPackage": "free", "npmScope": "free", "githubAccount": "taken", "githubReposWithName": 7},
 {"name": "cityloom", "npmPackage": "free", "npmScope": "free", "githubAccount": "free", "githubReposWithName": 9},
 {"name": "streetform", "npmPackage": "free", "npmScope": "free", "githubAccount": "taken", "githubReposWithName": 7},
 {"name": "osm3d", "npmPackage": "free", "npmScope": "free", "githubAccount": "taken", "githubReposWithName": 12},
 {"name": "citymesh", "npmPackage": "free", "npmScope": "free", "githubAccount": "taken", "githubReposWithName": 17},
 {"name": "plinth3d", "npmPackage": "free", "npmScope": "free", "githubAccount": "free", "githubReposWithName": 1},
 {"name": "blockcity", "npmPackage": "free", "npmScope": "free", "githubAccount": "taken", "githubReposWithName": 56},
 {"name": "mapblocks3d", "npmPackage": "free", "npmScope": "free", "githubAccount": "free", "githubReposWithName": 0},
 {"name": "tessellate-city", "npmPackage": "free", "npmScope": "free", "githubAccount": "free"}
]
~~~
