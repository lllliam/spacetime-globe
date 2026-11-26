# 公开更新记录

[原型更新记录](docs/archive/CHANGELOG-PROTOTYPE.md)保留从 v0.1 至 v14.2.x 的历史。从公开候选开始，产品更新按版本记录上线日期、提交、面向读者的变化和相关限制。

## 1.0.0-rc.2 · 2026-11-26

- 同源的旧页面关闭或退到后台时保留其他页面已保存的年份和阅读位置。读者主动在旧页继续导航时可继续保存，并读取共享记录里已有的分卷进度。
- 摘要卡打开后，双指捏合地图上方的遮罩时保持页面比例。单指点遮罩仍可收起摘要卡。
- 在地球上按住后于长按菜单出现前松手，照常打开所点位置的摘要。
- 地球视图新增明确的「关闭」入口，保留镜头和选项，并把焦点交回打开菜单的控件。
- 软键盘压缩可见高度时，年份输入面板向上收拢，提交后把有效范围提示留在可见区域。

浏览器回归覆盖双指触控、旧页面关闭、短视口错误提示、主屏幕布局模拟和 PWA 离线更新。iPhone 主屏幕安装和 VoiceOver 仍待真机验收。

## 1.0.0-rc.1 · 2026-11-25

产品负责人授权工程候选从 `main` 公开上线。GitHub Pages 于北京时间 17:13 完成部署。线上首页、离线单文件和 Service Worker 已与候选构建逐字节核对，公开首页的 1500 年历史疆域启动已实测。[上线提交 `3c762db`](https://github.com/lllliam/spacetime-globe/commit/3c762db45ac3871684ae37a4dea74aef62715b04) · [部署记录](https://github.com/lllliam/spacetime-globe/actions/runs/45583218374)

### 产品

- Explore 统一了时间轴与精确选年。点选疆域可打开相应主体摘要及书卷，有记录的年份可从当年史事进入相关历史。
- Read 以独立全屏书卷承载目录、正文、来源和跨卷关联，按稳定正文锚点恢复阅读。
- Observe 提供由读者主动打开的独立历史现场。可按证据精度查看地点、时段与路线，退出后恢复原阅读或探索上下文。
- 公开构建包含 57 卷、243 章、48 个历史现场（44 个可用、4 个暂停）与 28 组、117 篇补充专题。已通过专项验收的《明朝》包含 20 章和 8 个历史现场。[内容覆盖](docs/CONTENT-COVERAGE.md) · [标杆报告](docs/progress/PHASE-08.md)

### 工程

- 建立稳定的主体、正文、来源和场景身份，统一浏览器会话恢复，并保留既有阅读记录迁移路径。
- PWA 验证核心资源完整性、按路径与版本管理缓存、在旧窗口关闭后激活更新。单文件离线版内嵌所需数据与资源。
- 增加世界数据加载重试、未压缩疆域备用路径以及 WebGL 丢失后的 Canvas2D 降级和恢复。干净构建与主分支只读校验已通过。[工程验收与实测](docs/progress/PHASE-09.md)

### 首轮实际使用修复 · 2026-11-25

- **iOS 全屏沉浸与上下安全区独立管理**：在页面头部启用 `apple-mobile-web-app-status-bar-style="black-translucent"` 并统一由 `syncTopChrome()` 管理顶部与底部背景状态。保持 `html` 根背景色与独立应用 `theme-color` 固定为深空 `#0a1016`，确保 Explore、Sheet、Observe 与 Read 顶部状态栏均不出现灰白渐变或磨砂层（Read 与「这一年」在 `var(--safe-t)` 顶部安全区使用纯净深色 `#0a1016` 衬托白色系统图标，米纸导航栏从安全区下方开始）。同时针对 iOS standalone 下 `body` 被 `--app-height` 截断或 `100%` 低于物理屏高导致底部安全区露出黑边的问题，在 `src/app.css` 通过 `html::after`（覆盖 `inset: var(--app-height) 0 0`）与 `html.bottom-paper` / `html.bottom-observe-panel` 延伸底色独立管理底部边缘：Explore 上下保持深空色；Sheet、Read 与「这一年」底部米纸色 `#f6f2e9` 延伸至屏幕物理底缘；Observe 在打开底部解释面板时沿 `min(100vw, 660px)` 面板列向下延伸米纸底色、收起时上下保持深空色，内容与控件仍严格避让 `--usable-safe-b`。Safari 普通网页在顶部安全区为 `0px` 时仍通过 `theme-color` 与阅读纸面协调。已安装的旧版 iOS 主屏幕 PWA 需删除旧图标并重新添加到主屏幕以生效新的状态栏元配置。
- **历史地图主体标签语义治理**：在 `tools/polity-names.mjs`、`build.mjs`、`src/app.js` 与 `src/subject-reader.js` 中严格区分 Cliopatria 原始记录、规范主体中文名与双边/联合关系记录（同盟、共主邦联、效忠、臣属共 50 条）。保留 `data/polity.bin` 原始记录、稳定 ID、年代与几何，但不再将关系描述生成到地图主标签，并使关系复合多边形不参与地图图层绘制、标签避让、拾取与重叠主体列举，解决 1500 年明朝区域显示「朝鲜王朝向明朝效忠」及同类跨年代复合标签遮挡问题；1500 年中国区域正确显示「明朝」，朝鲜半岛在相应缩放下显示「朝鲜王朝」。
- **验证**：已通过内容校验、在线与离线构建、WebGL 与 Canvas2D 全量 UI 回归、四状态上下安全区覆盖与颜色回归，以及首页/移动端/阅读/观察/冒烟/真实产品路径测试和跨版本 PWA 缓存更新与旧阅读进度恢复验证；iPhone 真机体验与主屏幕实测仍待产品负责人确认。

### 实际使用反馈与全局产品质量治理 · 2026-11-26

- **历史主体与书卷身份彻底分离（P1）**：重构 `syncSheetIdentity()`（`src/app.js`）与 `subjectSheetMarkup()` / `renderSubjectOutline()`（`src/subject-reader.js`），摘要主标题与副标题固定展示地图选中主体的规范名称、经核实的身份/年代或诚实的待核标记，书卷以独立「阅读《…》 · 书卷范围 …」入口呈现，同名主卷（如《明朝》）不重复展示。全局清理 9 条时间零重叠同名误绑（`471 → 462`），扩充 `data/history/subjects.json` 重点主体台账至 50 项（含 47 项已核定年代与简介），并在 `tools/history-model.mjs` 新增政权入口时间交集硬校验。[治理报告](docs/progress/QUALITY-GOVERNANCE.md)
- **历史事件身份统一与去重（P1）**：新增 `data/history/event-identities.json`，构建与运行时（`initWorld()`）单源输出 `canonicalEntries` 与 `canonicalEventById`。将跨地区/宗教重复拆录的 35 组（72 条原始记录）合并为 35 条规范史事，保留多地区聚合、双书卷阅读按钮（如 1453 年君士坦丁堡陷落同时提供《罗马帝国》与《奥斯曼帝国》入口）、全部来源及观察返回定位，同时保留 13 组历史视角尚存差异的 `pendingCandidates` 供后续审校；构建期新增零遗漏与防重复回归断言。
- **移动端窄屏阅读顶栏修复（P2）**：为 `src/reading.css` `#book` 补充 `grid-template-columns: minmax(0, 1fr); width: 100%; max-width: 100%` 并收敛 `< 440px` 顶栏边距，修复阅读长标题专题（如 1900 年《义和团危机与八国联军》）时「返回史事」被推出 393px 视口的问题；同时修正全屏尺寸突变期间 `sheetMotion` 未随 `sheetDetents()` 更新的滞留问题，严格保留四状态上下安全区独立管理机制。
- **时间轴可读性与 1x 探索地名可发现性（P2）**：在 `src/chrome.css` 统一提升 `#vernier-track`、`major/med/minor` 刻度、BCE/CE 年份标注与事件点的对比度；重构 `src/app.js` `drawVector()` 与 `draw()`，以与球面半径平方（`Rz * Rz`）成比例的尺度判定代替固定像素面积阈值，在 `1x` 默认视口克制展示 5（手机）至 8（桌面）个主要地名并主动避让 HUD。
- **全库 57 卷只读清查**：在不动用书卷正文与不重启 Phase 07 的前提下完成全库体量、场景覆盖与来源厚度统计并记入 [治理报告](docs/progress/QUALITY-GOVERNANCE.md)。
- **验证**：已重新通过内容校验、干净构建复现、模型与会话单测、WebGL 与 Canvas2D 全量 UI/移动/首页/阅读/观察/PWA/稳定性/产品路径浏览器回归；iPhone 真机体验仍待产品负责人验收。

### 待验收

- 人工产品体验、iPhone Safari 与主屏幕安装和离线更新、原生辅助技术及实机性能仍待完成。已有浏览器模拟、键盘、可访问树及软件渲染数据留档。[验收矩阵](docs/progress/phase-09/matrix.md) · [人工与真机清单](docs/progress/phase-09/device-checklist.md)
- Phase 07 已暂存。存量 5,576 项已实质处置 387 项，另有 106 项一级筛查候选待审。《明朝》另有独立审校成果。正式 `1.0.0` 仍需完成全部验收并获发布授权。[审校恢复](docs/progress/PHASE-07.md#暂存与恢复) · [正式验收标准](docs/ACCEPTANCE.md)
