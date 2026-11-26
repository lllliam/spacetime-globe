# Historical World 续接台账

## 当前检查点

自原生分支 `acb675d` 续接，以 `5bae983` 的原清单、`2d8233b` 的 Phase 07 保存稿和 Phase 08 标杆记录核对稳定 ID。以现行版本的内容指纹决定既有审校能否继承。历史报告与机器产物保留其原有口径。[Phase 07](PHASE-07.md) · [Phase 08](PHASE-08.md) · [现行逐 ID 对照](historical-world/baseline.json)

| 项目 | 结果 |
| --- | --- |
| Phase 07 暂存稿已处置 | 387／5,576 |
| 已在现行原生内容中匹配的原存量处置 | 484／5,576，含 Phase 08 可继承记录 94 项及本批 3 项 |
| 原一级待审队列 | 暂停时 106 项，Phase 08 有 3 项可继承，本批完成 3 项，尚余 100 项 |
| 暂存稿至原生接收点 | 新增 268 个 ID，变更 78 个，既有地图迁移退役 9 个，逐项状态见对照表 |
| 独立待办 | 13 组史事身份候选和现有待审地图关联分别续审 |

分母只统计 Phase 06 原清单范围。后续新增资料单列，证据仅覆盖批次记录所列论断。一级筛查用于排队，事实强度由材料决定。

## 第一批 · 居鲁士与巴比伦

沿原稳定 ID 修订波斯卷和两河卷，区分奥皮斯交战、西帕尔被占、波斯军入城和居鲁士本人到达。修订圆柱铭文与《以斯拉记》的证据范围，交代巴比伦地理参考点的精度。补入前 539 年史事及两卷互链，地图沿用巴比伦遗址的城市级定位。[访问、论断、证据限制和复核](historical-world/batches/01-cyrus-and-babylon.json)

## 下一批起点

- 级别一先续审 `book-paragraph/achaemenid/satrap-revolt-and-alexander/p-05` 的高加米拉相关数字与战后叙述，再从现行对照表继续。
- 两河卷相邻段 `book-paragraph/mesopotamia-near-east/neo-babylon-cyrus-539/p-02`、`p-03` 继续核对营建归属、天文资料与巴比伦之囚的时间线。
- 年份、地图和现场按各自原始材料推进。按已有地点与证据评估巴比伦专题现场，维护身份候选和地图审校的独立队列。[史事身份候选](../../data/history/event-identities.json)

## 最小复现

使用 `git archive 2d8233b data tools src package.json` 和 `git archive acb675d data tools src package.json` 分别解出两个基线。运行 `node tools/verify-historical-world.mjs <暂存稿目录> <原生接收稿目录>`。批次录入后加 `--write` 更新现行快照。运行 `node tools/verify-content.mjs` 检查内容引用，原生打包使用 `node native-ios/prepare-data.mjs` 编译离线数据。
