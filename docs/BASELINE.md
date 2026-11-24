# Phase 01 工程基线

## 基线身份与工作区

2026-11-24 审查。原型最终基线为 **v14.2.1**，来自 `package.json` 与原型 README。`main`、`origin/main` 和远端默认分支均指向 [cfac7462bcd232d50baecd795962c8cd74af2597](https://github.com/lllliam/spacetime-globe/commit/cfac7462bcd232d50baecd795962c8cd74af2597)，提交题名为 `Refine mobile drawer and globe transitions`。开始时目标仓库状态干净。Phase 01 交付为该工作区中的文档改动。

本地是浅克隆，最早可见边界为 `5eae8f9`，可达 60 个提交。单独的临时完整远端克隆可达 72 个提交，最早原型为 `29a6f27`，原型 `1.0` 为 `603e5f7`。远端设计分支 `design/reader-sheet-gesture-20261117` 指向 `b2e2723`，已包含在主线祖先中。本地 `codex/fix-personal-author` 保留在 `617b427`。核对时远端无 Git 标签，GitHub Releases 返回空列表。未发现 V15 规范文件。历史对照见 [原型档案](archive/README.md)。

## 模块与功能清单

模块依赖和构建顺序见 [工程架构](ARCHITECTURE.md)。以下是现有源码行为。

| 范围 | 当前行为与依据 |
| --- | --- |
| 地球渲染与空间入口 | `app.js` 使用 WebGL 球面材质，含地表、云层和按缩放加载的 4K 地形法线，另有 Canvas2D 兜底。历史疆域、现代边界和自然地理支持旋转、缩放、点选，辅以显示设置。历史包异步载入时暂存符合条件的点击，验证视角与年份后补选 |
| 时间与发现 | `year-control.js` 有顶部年份输入、长按横拨和底部惯性游标，键盘也可选年。`year-discovery.js` 将年份关联到世界事件、背景、地图及书卷。输入禁止公元 0 年。时间控件的范围是公元前 3500 年至代码定义的当年上限，历史边界有效范围是公元前 3400 年至 2024 年 |
| 主体点选与地图档案 | `app.js` 基于当前几何拾取主体并显示摘要，`subject-reader.js` 使用实体 ID 或带年代的现代 ISO 找书。无匹配书卷仍可查看地图资料及来源 |
| 阅读 | `reading.js` 与 `subject-reader.js` 支持书目、卷目录、章节、前后章、引文、延伸阅读及当前页面会话内的进度。移动端有摘要、半窗和全窗，桌面宽屏可呈现书球同屏 |
| 观察 | `event-map.js` 提供世界事件地图和从正文主动打开的场景，有地点角色、路线、多阶段、前后场景和返回。观察可阻止探索控件干扰，返回依靠内存镜头、滚动及焦点快照。桌面同屏还有随书卷、章节和滚动自动更新的地图 |
| 数据工具和发布 | `verify-content.mjs`、`subject-books.mjs`、`historical-scenes.mjs`、`polity-names.mjs` 校验和载入内容。`build-data.js`、`build-terrain.py`、`build-icons.ps1` 负责资产再生成。`fetch-stories.js`、`enrich-pilot.js` 是素材工具。`serve.mjs` 与 harness 提供本地验证服务，`shots.js`、`_text.js` 和 UI 脚本可生成截图。日常线上构建使用 GitHub Actions，`deploy-gh.mjs` 另保留旧 API 部署脚本 |

## 内容与数据规模

| 数据入口 | 实测规模与结构 |
| --- | --- |
| `data/books/` | 57 卷、228 章，每卷 3–5 章，章正文目前为 6–7 段。采用稳定 ID、编辑年代、政权名／现代 ISO 绑定、段落 `refs`、延伸阅读和 `contemporaries`。源码统计有 178 个不同的书卷来源网址 |
| `data/topics/`、`data/content-plan.json` | 28/28 组专题、117 篇补充正文、66,686 个正文汉字、220 个不同专题来源网址。生成汇总为 `data/topics.json` |
| `data/scenes.json` | 48 个稳定场景 ID，其中 37 个含阶段。44 章的 49 条段落场景引用覆盖这些场景。《明朝》原型 5 章，引用 8 个场景，卷内列 41 条来源 |
| `data/world.json` 与阅读映射 | 1,512 条年表、105 个地区、177 块现代国界。`world-reading.json` 有 46 条显式映射，书卷另有 2 条章节 `eventIds`。`reading-timeline.json` 补入条目说明及来源 |
| 地图与地名 | `data/polity.bin` 和 `.gz` 保存实体、时间切片与路径。1,604 个历史名称中 1,552 个有独立中文对照，50 个为构建合成的关系名称，2 个显示原名。地表、云层、地形和底图资产均在库 |

## 状态、已知差距与后续阶段

| 发现 | 工程依据与边界 | 归属及风险 |
| --- | --- | --- |
| 核心状态分散 | `state`、`sheetState`、`chrome`、`reading`、`worldEvent`、`splitScene` 和 DOM 类共同决定实际行为。`beginReading`、`closeReader`、`openReadingScene`、`returnToWorld` 分别读写快照。探索、阅读、观察缺少统一切换边界 | Phase 02。涉及 `app.js`、`reading.js`、`event-map.js` 和 `chrome.js`。转移状态时要覆盖异步边界、镜头、滚动、焦点和返回路径 |
| 阅读进度和探索状态缺少跨重启恢复 | `readingPositions` 和 `subjectProgress` 是 `Map`，书卷记录以章节和像素偏移为主。`localStorage` 只有 `chrome.js` 读写的 `globe.display.v4` 地名、经纬网偏好。`app.js` 以 `YMAX = Math.max(2026, 当年)` 启动 | Phase 02、03、04。`reading.js`、`subject-reader.js`、`app.js`。检验老记录、缩放或版面变化和稳定段落定位 |
| 年份入口重复，时间口径不同 | 顶部精确输入、横拨、底部游标均可改变地图年。顶端「今天」在 `windowOf` 中打开近 30 年事件范围，与普通的单一年不同。阅读有 `reading.year`，桌面联动及 `applySceneStep` 还会写同一个 `state.year`。UI 可选年份与历史疆域数据边界不同 | Phase 02、03、06。审查 `year-control.js`、`year-discovery.js`、`chrome.js`、`event-map.js`，避免覆盖探索年份、丢失约略时期或误显示无疆域数据年份 |
| 阅读及地图联动与 1.0 有差距 | 移动端半窗或全窗依入口和手势变化，宽屏由 `canSplitReading` 判断同屏。`syncSubjectGlobeForReading` 允许在本章无场景时选择全卷首个有场景的章节，`scheduleSplitScrollSync` 随阅读滚动联动 | Phase 04、06。涉及 `reading.js`、`subject-reader.js`、`event-map.js`、样式和模板。应覆盖全屏、地图回原文和辅助功能焦点 |
| 地图身份约束叙事模型 | `loadSubjectBooks` 要求至少一个底图政权、至少两章、连续年代和每章至少三段。一个底图实体 ID 只能认领给一卷，现代 ISO 的绑定区间不能重叠。独立的地理、文明与历史政权分类尚未建立 | Phase 05。涉及 `data/books/`、`tools/subject-books.mjs`、`src/subject-reader.js`。稳定 ID、旧链接和地图点选是迁移风险 |
| 关联语义与史料校验覆盖有限 | 书卷有 262 条 `contemporaries`，均未使用独立的关系类型字段。当前显式年份与当前章/目标范围的抽取遍历未发现越界，但加载器仅校验给定年份为合法整数及目标存在。专题有 `relation` 字段和部分共时年代约束。自动校验验证字段、HTTPS 形式和来源索引，无法验证论断、路线或史料之间的证据关系 | Phase 05–07。涉及 `data/books/`、`data/topics/`、`data/scenes.json` 及内容校验工具。旧专题审计的 219 个网址是历史快照。结构通过后仍需人工判读证据、日期及审校状态 |
| 原型范例混入固定编辑模板 | 旧范例明确限制卷型、段数与篇幅。原型《明朝》的 5 章、8 场景和 41 条来源由当前文件统计，逐项学术审查尚无本轮结论 | Phase 05、07、08。现行 [书卷指南](BOOK-EXEMPLAR-GUIDE.md) 保留可用编辑方法，旧模板已归档 |
| 发布与资源标识独立 | `package.json` 为 `14.2.1`。模板和清单仍用原型显示名。Cache Storage 为 `globe-v24-icons`，清单和图标资源为 `?v=4`，地形资源为 `terrain-4k-v1.png`。Service Worker 仅在 HTTPS 注册，创建缓存时逐项容错，导航网络优先，其他同源资源缓存优先。疆域与高程等按需资源未列入预缓存。激活按名称删除此源的其他缓存 | Final Acceptance。涉及 `package.json`、`src/shell.html`、`manifest.webmanifest`、`sw.js`、构建及发布。验证旧缓存与数据迁移、跨站点范围的同源缓存影响、安装与断网后资源可用性 |

### 文档一致性

原型 v7 说明仍列常驻复位／缩放以及显式三态按钮，v8 则记录取消显式入口。旧阅读说明写轻点年份进事件表和双击输入，当前轻点进年份输入、事件表另有入口。旧阅读说明所列《明朝》四处场景为早期范围。旧说明把观察年份描述为固定值，当前多阶段场景可更改观察年。这些版本描述均可在 [原型档案](archive/README.md) 追溯。现行设计只以 [产品规范](PRODUCT-SPEC.md) 为准。

## 实际验证

环境为 Windows、Node.js v24.18.1、Microsoft Edge 158.0.4370.33。所有会生成文件的检查在独立临时副本运行。已有 UI 与移动测试使用 Chromium DevTools 协议。默认受限执行对浏览器调试链路未能稳定完成，以下浏览器结果来自获准使用本地浏览器连接后的运行。

### 内容校验

`node tools/verify-content.mjs` 退出码 0，57 卷、228 章、48 场景、28 组专题、117 篇专题正文，0 错误、0 警告。生成报告与基线中的 `docs/CONTENT-COVERAGE.md` SHA-256 一致。

### 构建与语法

`node build.mjs` 退出码 0，在线 HTML 2,880,222 字节、单文件离线 HTML 9,213,334 字节。两份 HTML 与 `data/topics.json` 均和入库产物的 SHA-256 一致。`src/`、`tools/` 下的 JavaScript／ESM 文件以及 `build.mjs`、`sw.js` 通过 `node --check`。

### UI 回归

`node tools/verify-ui.js` 退出码 2。WebGL、地图加载、云层及平移缩放的早期检查通过。PWA 图标断言仍要求 `?v=3`，当前清单为 `?v=4`。脚本随后调用已不存在的 `#reset-view`，在 `.click()` 时抛错，其余用例未执行。记录为基线测试契约差距，控件断言归 Phase 03，PWA 版本断言归 Final Acceptance。

### 移动端回归

`node tools/verify-mobile.js` 退出码 0。覆盖地图档案、目录、半窗及全窗、独立场景返回、年份输入、时间轴手势和减动效。包含 320px 窄屏与模拟主屏幕视口变化。iPhone Safari／主屏幕模式的真机证据留待最终验收。

### Smoke

`node tools/smoke.js` 退出码 1，14/17 通过，控制台无异常。失败项为「返回地球恢复原抽屉与年份」（脚本同时要求半窗状态）、「年份轻点打开全景列表」（旧入口预期），以及「Esc 收起抽屉」（在旧入口检查失败之后执行）。结果记录为现有用例行为，分别归 Phase 02/04 和 Phase 03。正式回归由对应阶段核对。

### 线上部署与离线入口

2026-11-24 请求现有 GitHub Pages 两个地址均为 HTTP 200，实际下载的在线与离线 HTML 的 SHA-256 分别与基线构建一致。将 `file://` 方式打开的 `index.offline.html` 传给原移动端脚本，端到端界面操作退出码 0。部分镜头内部断言依赖调试钩子，由在线 harness 运行覆盖。PWA 安装、已有缓存迁移、断网重启和低性能设备检查列入 [最终验收](ACCEPTANCE.md)。[线上原型](https://lllliam.github.io/spacetime-globe/) · [离线 HTML](https://lllliam.github.io/spacetime-globe/index.offline.html)

### 文档与归档

21 份 Markdown 中的 112 处仓库内链接及 61 个固定 Git 历史链接通过检查。原 README 的 49 条版本记录与四节详细版本说明均已迁移。四份历史文档的正文与基线一致，归档标记与相对链接按新位置更新。24 张旧图均登记并保留原路径及 Git blob，另有 2 张基线实拍。README 标明当前的原型部署和未来的正式发布，路线仅 Phase 01 标记完成。

### Git 与交付范围

Git 连通性及工作区差异检查通过。改动仅包含 8 份现有文档、12 份新增文档与 2 张文档截图。基线提交、本地分支、远端引用、源码、历史数据、测试工具、运行时元数据与生成产物均保持原样。本轮无提交、推送或发布。
