# 历史现场

历史现场通过地球解释正文中值得观察的空间问题。读者在正文主动进入，可以比较位置、理解空间结构、对照历史演变，或观察证据支持的跨区域联系。只有区域信息时，使用区域定位。场景设计和正文关系的审查记录见 [Phase 06 报告](progress/PHASE-06.md)。

## 正文入口和观察

书卷的 `sceneRefs` 用 `id` 引用场景，用 `afterBlockId` 把图版锚定到同章段落。图版包含历史问题、年代和观察按钮。同一场景可跨卷或跨章复用，历史内容及来源独立保存。专题事件以 `topicEvent` 复用原有专题地图及来源，场景也可从正文打开。世界史事缺少可靠具体地点时，用区域代表位置或「地点未详」。

需要给正文里的地名加链接时，在对应 `sceneRefs` 加 `placeLinks`。指定 `blockId`、块内只出现一次的 `text`、`placeId` 和需要时的 `stageId`。验证据此核对阶段有效性及同块文字的重叠。一个地点只在一个阶段有效时可省略 `stageId`。多个阶段都有效时须指定阶段或让链接继承图版的 `stageId`。其他地名保留正文文字。

进入 Observe 时暂存原卷、原章、正文位置、原始触发控件及镜头。顶部按来源显示「返回正文」「返回史事」或「返回探索」。地点操作补充当前阶段说明。退出观察后恢复正文或史事列表，包括相应焦点。暂停提示、资料和地点列表均使用显式控件。重启恢复进入观察前的阅读或探索；若观察由史事列表发起，则恢复列表位置。

## 场景内容与时间

`data/scenes.json` 保留原有记录和场景 ID。本轮的 `observation` 保存当前显示的内容，旧地点坐标仍可通过原场景的地点 ID 引用。`kind` 支持 `structure`（空间结构）、`change`（演变）、`connection`（跨区域联系）、`comparison`（地点比较）、`location`（区域定位）。`question` 是地图要解释的问题，`note` 是静态说明，`limit` 交代证据与地图边界。`status` 为 `available` 或 `paused`。

单阶段使用原始观察年。`steps` 使用编辑顺序，各有 `id`、`year`、`title` 和 `note`，可加 `dateLabel` 说明历史时段或近似年代。底图仍按该阶段的结构化 `year` 投影，并在图例标明实际参考年。默认进入首阶段，图版可显式指定 `stageId`。阶段 `places`、`routes`、`focusPolities` 可以缺省继承场景级配置，`[]` 表示当前阶段无此项目，非空数组只使用列出的 ID。已引用路线的两端须同时有效。阶段 `placeNotes` 可替换有效地点的显示名、作用和适当的降级精度。

跨年代概览可用有范围说明的自然地理定位。`naturalOnly` 选择自然底图，`dateLabel` 解释定位语义。当前观察按阶段表达历史状态。编辑同一时点的空间比较时，可在单阶段放置有依据的几个对象。历史疆域使用 Cliopatria，缺覆盖或加载失败时使用自然地理底图。阶段转换后的旧异步回调不会改动当前底图。

## 地点、路线和证据

地点默认使用近似位置。`placeNotes` 可按 ID 提供角色、精度、资料说明及 `evidence`。`precision` 支持 `site`（有定位依据）、`approximate`、`reference`（现代定位参照）、`region`、`unknown`。`site` 需要定位证据。`unknown` 仅列在地点说明中。`distanceBetween` 选择两个地点，只有两者在当前阶段有效时显示近似地理直线距离。

`observation.routes` 以稳定 ID 维护当前地图的线。`attested` 用实线，需要带定位及说明的证据与限定范围的核查记录。`approximate` 用虚线，证据需支持大致通道。`schematic` 用点线，证据只需支持有关地点之间的联系，折线节点不会作为示意线的一部分。`legacy` 原样留档。实际或近似线的 `directed:true` 需要独立 `directionEvidence`。示意联系保持无方向。观察图例只列当前启用的地理符号、地点精度和底图。球面绘制只用于显示，证据来自所引材料。

来源始终使用稳定来源 ID。原有场景来源及 `observation.sources` 在该场景内共享一个作用域。`evidence` 可在场景、地点、路线和阶段上附 `sourceId`、`locator` 与 `note`，分别解释证据支持哪一部分。史料无法确认时，保留原来源说明并缩减表达的地理精度。无可靠空间价值的场景使用 `paused`，原始数据、场景 ID 和正文关系继续供审校。在线可打开外部资料；断网时，内嵌标题、定位和说明仍可阅读。

## 编辑示例与验证

以下两个阶段从史料支持的定位发展为示意联系。第一阶段的空路线清单表达该阶段仅看地点。连接线用稳定 ID，`source-01` 在场景来源中定义。

```json
{
  "steps": [
    {"id":"opening","year":1411,"title":"先看两地","note":"比较两地的位置。","routes":[]},
    {"id":"connection","year":1421,"title":"运输通道","note":"观察两地之间的地理关系。","routes":["grain-link"]}
  ],
  "routes": [
    {"id":"grain-link","from":"a","to":"b","precision":"schematic","label":"运输联系","note":"以两点提示运输联系。",
     "evidence":[{"sourceId":"source-01","locator":"运输一节","note":"仅支持两端存在联系。"}]}
  ]
}
```

若 `a` 或 `b` 在某阶段隐藏而该阶段仍显式启用这条线，或给此示意线增加 `directed:true`，构建会报错。公元 0 年、阶段超出原历史范围、错误坐标、未知来源 ID 与暂停场景上的地名按钮也是结构错误。

新增场景时先确认正文中实际需要地图回答的问题，再选用最低足够的地理精度。核对地点、年份、路线和方向各自的证据，使用新的稳定 ID。通过 `node tools/verify-content.mjs`、`node build.mjs`、`node tools/verify-observation-model.mjs` 和 `node tools/verify-observation.js` 检查数据和真实交互。编辑核查范围另记。[历史内容模型](HISTORY-MODEL.md) · [审校记录](SOURCE-AUDIT.md)
