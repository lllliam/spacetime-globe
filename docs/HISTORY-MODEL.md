# 历史内容模型

历史内容模型 **v1** 定义于 `data/history/subjects.json`。它独立于产品发布版本和浏览器会话版本。`node build.mjs` 和 `node tools/verify-content.mjs` 共用 `tools/history-model.mjs`，从源文件验证并编译在线及单文件离线数据。[Phase 05 迁移报告](progress/PHASE-05.md)

## 对象与权威数据

Historical World 的现行审校以统一内容库中的稳定 ID 和论断为单位。书卷、年度总览和现场复用同一条权威历史记录。内容版本、证据与覆盖按 [建设规范](HISTORICAL-WORLD.md) 和 [检查点](progress/HISTORICAL-WORLD.md) 维护。

| 对象 | 身份与维护位置 |
| --- | --- |
| 地理区域 `region` | `subjects.json` 中的编辑 ID。可用名称与范围说明表达江南、南亚次大陆等区域，允许未知边界 |
| 历史政权 `polity` | 编辑 ID 可带别名、存续年代、来源及不确定性。底图对象可用 Cliopatria 包中的精确原名定位。名称相近时需独立依据 |
| 文明与社会 `civilization` | 编辑 ID。可跨政权与地区，年代与边界可保持未知 |
| 现代国家 `country` | 底图注册表使用 ISO 键。需要围绕国家开展编辑工作时可建立对象并显式指定 `iso`。`world.json` 提供现代地图注册表 |
| 书卷与专题 | `data/books`、`data/topics` 中的稳定 `id`。书卷可通过可选 `subjectIds` 说明叙事涉及的对象，可以完全没有地图入口 |
| 地图入口 | `data/history/map-bindings.json`。独立维护编辑关系、有效年代、范围及审校状态 |
| 年表归并条目 | `data/history/event-identities.json`。将跨地区、宗教或国别重复录入的同一历史事件归并到统一 `canonicalEntryId`，保留 `memberIds` 与未强合并的 `pendingCandidates` |

优先复用底图注册表。Cliopatria 数字索引用于当前数据包绘制和拾取，入口以原名映射，叙事和稳定编辑身份另行维护。底图几何由已有资源加载。只有明确编辑需求才在对象注册表添加记录。Cliopatria 原始包中的双边与联合关系记录（如 `Alliance between`、`Personal union of`、`Allegiance of`、`Vassalage of`）在保留原始 ID 与几何的前提下由 `tools/polity-names.mjs` 单独分类为关系元数据，不生成为地图主标签，也不参与政权图层的渲染、拾取或标签避让。

## 地图入口与主体身份区分

每条记录有 `map`（`type` 为 `country` 或 `polity`，`key` 为 ISO 或精确底图原名）、`target.bookId`、`range`、`relation`、`scope` 和 `audit`。可用 `subjectId` 连到编辑对象。任一对象在一个有效年份最多有一条 `primary`，打开整卷；多条重叠主入口会拒绝构建。构建同时校验 `polity` 入口范围必须与 `data/polity.bin` 的实际底图存在时间存在交集，拒绝同名异物或零重叠绑定。`related` 可与主入口并存，也可指定书卷的 `chapterId`，在资料页或扉页显示为「相关历史」。

摘要界面与地图选区必须区分「历史主体本身」与「编辑书卷」：当选中如 1453 年帖木儿帝国或现代哈萨克斯坦等与书卷不同名的主体时，主标题与副标题仅展示该主体的规范名称与核定年代（未核定者显式标为「存续年代待核（底图记录 …）」），编辑书卷以独立「阅读《…》 · 书卷范围 …」入口呈现；仅同名主卷（如 `明朝`）不重复展示入口。无主入口时摘要保留「查看地图资料」。

```json
{
  "map": {"type": "country", "key": "LK"},
  "target": {"bookId": "india-classical-modern", "chapterId": "maurya-ashoka-kushan"},
  "range": {"from": 1948, "to": null},
  "relation": "related",
  "scope": "本卷涉及阿育王时期佛教向斯里兰卡传播。",
  "audit": {"status": "unreviewed"}
}
```

入口生效年代说明读者何时可从当前地图对象进入阅读。相关篇章可以讲更早的历史，例如上例的佛教传播。两条范围在 1948 年相交的 `primary` 会报错，底图无此 ISO 或政权原名也会报错。地理重叠、现代国界和文明相邻关系各有其依据。

## 叙事顺序、年代与推荐

- `chapters` 数组定义阅读顺序。每章需有稳定身份、标题、简介和正文块。有效书卷可有一章或多章，允许年代重叠、空档和回顾。专题只要求实际可阅读的正文及合法的来源、地点和关系。计划篇数和长度用于编辑统计。
- 书卷 `from`、`to` 是叙事范围，章的同名字段是正文主要年代，与对象的 `range`、地图入口范围和场景 `year` 分开。公元前用负整数，公元 1 年前一年是 `-1`。`from: null, to: null` 配合 `dateLabel` 表示待考，起年已知且结束年开放时用 `to: null`。近似范围可指定 `approximate: true` 和 `dateLabel`。例如 `{"from":-1,"to":1}` 合法，任一端填 `0` 或结束年早于起年会报错。
- 章的 `kind` 可为 `narrative`、`introduction`、`retrospective`、`thematic`、`epilogue`。超出书卷叙事范围的非叙事章节需注明 `scope`，如政权终结后的余波。普通章默认按正文范围推荐，其余章可明确给出 `recommendation`。此字段可以为 `false`，或提供 `range` 和整数 `priority`，默认优先级为 0。跨章范围的推荐需有 `reason`。最高优先级并列时都标注，空档无推荐。
- `world-reading.json` 记录事件指向书卷或明确章节的编辑路径。章内 `eventIds` 是另一类现有编辑记录。构建将其合并，同一事件只能有一个主入口。明确的章节优先。仅指定书卷时复用同一推荐规则，空档或并列时打开扉页，保留实际入口年份。

## 正文块、场景与来源

- 书卷段落、补充说明、专题开篇及节正文均有章内稳定 ID。没有独立开篇的专题用 `openingBlockId` 标识摘要开篇。书卷空间线索用 `spatialThesisId`。改写同一内容或调换次序时沿用 ID。插入新块分配未使用的 ID。拆分时将原 ID 留给承接原论点的块，合并时保留最合适的原 ID，并逐一调整场景等链接。彻底删除时阅读位置回退到同章可见位置。
- `sceneRefs` 采用 `{ "id": "yongle-capitals", "afterBlockId": "p-04" }` 的形式。目标必须是本章存在的段落，跨章年代的引用需写明 `scope`。同一 `scene.id` 可跨卷跨章复用。移动段落时场景仍跟随该块。通过 `stageId` 可指定首阶段，通过 `placeLinks` 声明正文地名的位置和阶段。`data/scenes.json` 的 `observation` 提供分阶段地点、证据、路线、精度和可用状态。[历史现场规范](HISTORICAL-SCENES.md)
- 来源 ID 分别在书卷、专题篇章、独立场景或年表条目的来源列表内唯一。正文 `refs` 可写 `"source-01"` 或 `{"sourceId":"source-01","locator":"第 17 页","note":"附表 2"}`。数字数组下标和未知来源 ID 会报错。用户界面生成连续编号。来源重排保留引用目标。URL 相同的记录可有不同引用位置和证据作用。
- 书卷的 `related`、`contemporaries`、专题的 `connections` 与年表关联继续在原内容记录内维护。关系可有作用域内唯一的 `id`、`time`、`display`、`dimension`、`evidence` 与 `audit`。`contemporary` 要求明确源和目标章节覆盖所述时间。`compare` 要求比较维度。`documented` 同时需要适用时间、对联系本身的定位证据及限定范围的核查记录。`context`、`further`、`legacy` 提供背景和阅读导航。旧说明供追溯，读者看到经编辑选用的 `display`。[关系呈现](READING.md#全球历史关联)

## 审校与地图来源

可在对象、书卷、章、正文块、来源、场景与关系上增加 `audit`。缺省视为未审校。状态可为 `legacy`（沿用的关系）、`unreviewed`、`issues`、`checked`、`insufficient` 和 `disputed`。核对过的范围用 `scope` 写清并附真实 `checkedAt`。问题、资料不足和争议需要 `note`。可用 `checks.link`、`checks.claim`、`checks.editorial` 分别记录链接可达性、论断证据和编辑验收。原有来源的 `checkedAt` 为历史元数据。[来源核查](SOURCE-AUDIT.md)

地图元数据记录来源、上游版本、获取时间、本地生成时间、覆盖与许可。仓库的构建脚本从旧 Atlas HTML 抽取边界，未发现 Natural Earth 矢量资产的上游版本或获取日期，两个字段均保留 `null`。`world.generatedAt` 是本地世界数据包生成时间。Cliopatria 的覆盖为公元前 3400 年至 2024 年，包中未记录确切上游提交和生成日期。

书卷与章节可用 `editorialNotice` 保存直接影响当前阅读的资料和范围说明，读者可按需展开。审校批次以对象稳定身份连接来源读查、具体论断及处置，并以 Phase 06 归档比较存量差异。来源访问记录、全文审校状态及地图几何精度分别维护。[审校规范](EDITORIAL-STANDARD.md) · [Phase 07 记录](progress/PHASE-07.md)

## 维护与迁移

1. 从书卷和叙事需要出发选定 ID、章序和范围，按需登记历史对象。书卷文件名取书卷 ID。书卷有适合的地图入口时独立添加绑定。
2. 为新增正文块及来源分配此前未用的 ID，使用稳定 ID 维护引用。按真实资料记录范围、定位和审校状态。
3. 执行 `node tools/verify-content.mjs`、`node build.mjs` 和 `node tools/verify-history-model.mjs`。硬性结构错误阻止构建，史料和编辑待办作为提示。
4. 历史迁移脚本默认预演，`--write` 在完成内容等价性和结构检查后落盘。`--check` 要求源文件无需新增迁移。可用 `--baseline <Phase 04 源文件目录>` 验证迁移前后引用与内容，并用 `--report <输出文件>` 留存逐卷、逐章哈希与入口改动。

`globe.session.v1` 保留。新记录以当前书卷或专题、章和 `position.blockId` 定位，仍携带旧指纹、序位和 `scrollTop`。旧记录首次成功对准正文块时逐步写回新身份。作品内的地图、观察和阅读入口 ID 继续使用原 ID。
