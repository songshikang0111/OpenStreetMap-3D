# A 独立审查记录

日期：2026-11-03。审查者：独立 subagent `/root/core_review`，`gpt-6.1-sol`、`xhigh`、`fork_turns=none`。只读审查实际代码、规划、Schema、测试及提交；未替实现者修改文件，未自行运行重型快照审计。

初审提交 `4b9eab77cbb9e06ce5905c3fab54d44b55cef732`；完整复验提交 `457087a752ed8c070f50274f2b811441ebaf6957`；最终两行防御补审 `ebb81022e569b5f18e64a27ca10c5ca5ee143e77`。修复由实现者完成，审查者再次复现。

## 发现、修复与复验

| 发现 | 影响 | 已提交修复与证据 |
| --- | --- | --- |
| 单 claimed 对象生成多个实例 | P1，实例身份不足造成构建崩溃 | 40cad28；核心测试10；独立断言通过 |
| 空/NaN/没有可绘三角形的生成器 | P1，删原建筑或在后续构建崩溃 | 40cad28；接管前完整 codec 校验；测试9/19及独立断言通过 |
| matcher 抛错/null match | P2，普通异常漏出，无法回退 | 40cad28；结构化诊断保留旧形体；测试9/19通过 |
| 接管后残留旧屋顶附件 | P2，悬空设备 | 40cad28；按旧 objectId 过滤 claimed 顶点；测试18通过 |
| 多部件普通 mesh 主 ID 被首个对象覆盖 | P2，查询身份错误 | 6a0eeba；low 的 cityFeature 与 high 的 featureId 均复验；测试20通过 |
| 自定义实例 shader 属性未随分块重排 | P2，实例外观错误 | 40cad28；测试11及独立 meshPerAttribute=2 断言通过 |
| 共享 primitive 的角色属性互相覆盖；生成树来源不可追溯 | P2，角色/来源错误 | 40cad28；按 kind/role 复用隔离几何，生成 key 与原 OSM sourceIds 分开；测试14通过 |
| drawRange 丢失、多材质统计错误、隐藏父组失效 | P2，暴露池内几何、预算错误 | 40cad28；测试15/16及独立断言通过 |
| null chunk 头、清单字段类型和配置 origin 校验宽松 | P2，TypeError 或接受损坏协议 | 40cad28；测试12/17通过 |
| 公共 CityBuildError 构造声明与运行时不符 | P2，类型消费者无法正常调用 | 457087a；真实 TypeScript 消费者检查通过 |
| 自身重复 claims、环引用 provenance（作者补充） | 接管输入边界 | ebb8102；审查者补审确认拒绝重复且不调用生成器；环元数据诊断回退，bounds 与原形体一致 |

## 独立命令与结论

在指定 worktree 独立执行：

```powershell
node --test test/phase1-core.test.js
npm test
npm run build
npx --no-install tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext test/phase1-core.types.ts
```

457087a 实测结果：核心 **20/20**、全量 **158/158**、生产 build 成功、类型消费者通过。另行执行 13 组内联 Node 边界断言全部通过，覆盖 divisor=2 的实例重排、无可绘三角形回退等作者测试外场景。ebb8102 两处差异的针对性断言通过，未为该补丁重复全量。

审查者最终判断：“未再发现已复现的阻塞缺陷；A 组件可交付集成。”最后补审：“通过，无新增缺陷。”

审查者只读核对 snapshot-audit.json：北京/京都完整范围 1/4/16 的世界签名各自一致；北京 500 m、京都 250 m 物理格网的 1/4/9 扩区均为真实数据增长。

本记录仅覆盖 CPU 核心构建、协议和资源统计。实际 shader 重新绑定、60 秒真实浏览器相机路径、帧间隔、WebGL 实际提交、五次加载往返和视觉接缝为 C/D/E 集成验收，保持 **not-run**，不宣布一期整体通过。
