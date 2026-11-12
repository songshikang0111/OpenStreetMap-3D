# WP-I 交付报告（仅 I3 静态部分）

分支：`phase2/J-docs`（与 WP-J 文档同一分支，基于 `phase2/F-pbf`）。日期：2026-11-13。参考设备（D5）未定，I1、I2、I4 和所有真机验收不在本次范围，**M5 未完成**。

## 交付

- `scripts/benchmark-tiles/static-budget.mjs`：对构建好的瓦片集逐块统计绘制调用（生成批次数加树实例，不含近景细节）、单块 gzip 体积，以及 `@city-ink/map` 单文件包的 gzip 体积；超限时退出码 1。
- `npm run build:map-bundle`、`npm run check:static-budget`；CI（`.github/workflows/ci.yml`，仅 Linux 任务）构建两个样本瓦片和地图单文件包后运行检查。

## AC 结论

| AC | 结论 | 验证 | 结果摘要 |
| --- | --- | --- | --- |
| AC903 | **未通过** | `node scripts/benchmark-tiles/static-budget.mjs apps/demo/public/tiles/{beijing-cbd-grow-9,kyoto-gion-grow-9,manhattan-financial} --json docs/phase2/evidence/I/static-budget.json` | 06 的上限为 L1 12 次、L0 4 次。实测最多 L1 17 次（北京、曼哈顿）、16 次（京都），L0 6 次。原因：批次按"图层:角色"划分，G/C2 新增了 `detail`、`landscape`、`structure` 等图层（例：北京一块 L1 有 building×5、ground×3、detail×2、landscape×2、green、landmark、structure）。可能的处理：跨图层按角色合批，改用逐要素状态实现装饰层开关和宿主地面隐藏；留待后续 |
| AC906 | 本地通过；CI 上**未验证** | 同上，分别以 `--max-l1-draws 16` 和 `--max-bundle-gzip 30000` 运行 | 当前基线（L1 17、L0 6、单块 gzip 256 KB、包 180 KB）下退出码 0；把上限压到低于实测值时退出码 1（相当于加入一块超预算瓦片或增大包体积）。没有推送到远端，GitHub Actions 未实际运行 |
| AC904 | 未验证 | — | 需要整城构建与默认视角首屏测量（WP-F 整城构建未完成） |
| 其余（AC901、AC902、AC905、AC907、AC908） | 未验证 | — | 依赖参考设备（D5） |

CI 中使用的是当前基线而不是 06 的上限，目的是防止继续变差；这不改变 AC903 的结论。单块 gzip 最大值：北京 176 KB、京都 244 KB、曼哈顿 188 KB；地图主包 gzip 41,683 B。
