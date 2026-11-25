# 当前工程架构

本文件记录公开版本的工程结构及维护边界。产品目标见 [产品规范](PRODUCT-SPEC.md)，v14.2.1 原型记录见 [Phase 01 工程基线](BASELINE.md)。

## 目录职责

| 位置 | 职责 |
| --- | --- |
| `src/` | 应用模块、样式、页面结构与 Service Worker 模板 |
| `data/` | `books/` 和 `topics/` 是编辑源，`history/` 提供历史对象与地图编目。场景、地图、纹理与世界数据同时服务构建或运行时 |
| `assets/` 与根目录图标 | 图标母版与各入口所用图标，根目录清单供 PWA 安装 |
| `tools/` 与 `build.mjs` | 内容编译、构建和本地服务、专项验证、数据与资产再生成、审校台账复现 |
| `.github/` | 主分支构建核对 |
| `docs/` | 现行文档、`progress/` 阶段证据与 `archive/` 原型档案 |
| 根目录 HTML 与 `sw.js` | 由构建生成并提交，供 GitHub Pages 直接托管 |

## 页面与模块

| 位置 |职责 |
| --- | --- |
| `src/shell.html`、`src/app.css`、`src/chrome.css`、`src/reading.css` | 页面结构、PWA 元数据、舞台、探索摘要、独立全屏纸面和阅读字号 |
| `src/app.js` | 数据与材质加载、世界索引、疆域切片与拾取、WebGL／Canvas2D、镜头、抽屉、全局交互和启动 |
| `src/session-state.js` | 核心模式、稳定导航记录、会话验证与持久化，协调业务快照与地球投影 |
| `src/chrome.js` | 图层、显示选项、年份提交、复位与控件可见性 |
| `src/year-control.js` | 精确年份面板、底部游标、预览状态、整年提交和键盘输入 |
| `src/history-rules.js` | 页面与构建共享的历史年代、覆盖范围与章节推荐规则 |
| `src/year-discovery.js` | 当年史事与长期背景分类、游标事件标记与列表中的观察和阅读入口 |
| `src/reading.js`、`src/subject-reader.js` | 阅读会话、导航、手势、位置、目录与正文呈现、主体匹配 |
| `src/event-map.js` | 观察阶段投影、当前地点与证据线型、年代分区、说明区与按来源返回 |
| `src/offline-status.js`、`src/sw-template.js` | 视图设置中的离线准备状态，以及按站点路径和构建隔离的 Service Worker |

`build.mjs` 合并三张样式表，在 `app.js` 的启动标记前拼接各模块。各脚本共享应用作用域，启动在地图、画布和分区准备后恢复已验证的会话。详见 [状态模型](STATE-MODEL.md)。

## 数据与状态

历史疆域来自 Cliopatria，现代国界来自 Natural Earth，绘制底图是现代地表。几何切片用于绘制、拾取和高亮，其中 `tools/polity-names.mjs` 将规范历史主体名（`polity-names`）与 Cliopatria 中的 50 条双边或联合关系记录（`polity-relations`）分离，原始数据包保持不变，地图政权图层只渲染和拾取规范主体而非关系复合轮廓。`data/history/` 记录独立历史主体、地图来源及分时段入口。构建按底图身份编译主叙事与相关历史索引，并将世界年表映射和章节 `eventIds` 合为一个阅读索引。编目 ID 和正文块 ID 由编辑维护，章节按场景 ID 和正文块 ID 定位图版。[历史内容模型](HISTORY-MODEL.md) · [阅读与内容组织](READING.md)

探索年、阅读入口年与观察年分别由协调层的三个业务上下文持有。阅读使用独立的 `#book` 滚动区域，隐藏底图、停掉地球绘制，并保留探索镜头。地图只在 Explore 与主动 Observe 中绘制。稳定导航于本地保存，书卷与章节使用编目 ID，正文位置优先按逻辑锚点复原。在线和单文件共用解码与降级路径。

`tools/historical-scenes.mjs` 校验旧档案和当前 `observation`，构建把可读的场景投影写入 HTML。`observationFrame` 由构建校验和浏览器共同使用，同步地点、路线和适用政权。阶段切换时检查疆域覆盖，地图包异步完成后按场景和当前有效请求更新。关系按 `relation` 语义校验并使用原阅读导航栈。[场景规范](HISTORICAL-SCENES.md)

首页的精确输入与游标均调用 `commitYear`。游标的预览与惯性留在控件内，分区和业务快照只在整年提交后更新。无有效会话时，启动等候 1500 年的疆域数据。历史数据覆盖公元前 3400 年至 2024 年，现代国界使用 Natural Earth 参考版本。

`yearEventGroups` 和 `concreteEventStarts` 来自同一条目分类。具体记录按单一历史年份匹配，政权年代和长时段背景单列，游标计数与列表共用同一结果。[首页实现与验证](progress/PHASE-03.md)

## 构建与部署

- 内容校验与构建共用 `tools/history-model.mjs` 校验和编译书卷、专题、场景、事件、地图入口及审校记录。内容校验生成 [内容覆盖](CONTENT-COVERAGE.md)，构建生成 `data/topics.json`、`index.html`、`index.offline.html` 和 `sw.js`。`tools/migrate-history-model.mjs` 可用 Phase 04 数据快照核对兼容迁移。
- 在线页内嵌书卷和基础地表。构建把地图资源内容标识与 SHA-256 完整性写进页面和生成的 `sw.js`。核心缓存包含 HTML、清单与图标、世界数据、压缩及未压缩疆域和浮雕。高清地表与 4K 地形按需缓存。单文件内嵌原始疆域二进制和所需图标及图像，浏览器无需 `DecompressionStream` 即可读取。
- 安全上下文中的 Service Worker 先验证并缓存所有核心资源，再完成安装。等待中的新版在旧受控窗口关闭后激活，导航使用活动版本的 HTML。回收限于本路径内符合条件的旧构建缓存。旧原型缓存保留其原名，其他应用缓存保留。核心文件被清理后，联网可由视图设置重试准备。
- `.github/workflows/build-site.yml` 只在 `main` 执行只读构建核对，使用 Node.js 22 检查已提交的产物是否可复现。GitHub Pages 从 `main` 根目录提供公开网页。浏览器回归与发布顺序见 [最终验收](ACCEPTANCE.md) 和 [发布清单](RELEASE-CHECKLIST.md)。
- `tools/build-data.js` 用上游 Atlas HTML 重建世界数据和疆域二进制。高程与图标各有资产生成工具。日常站点构建使用已入库的地图数据、贴图和图标。

[原型架构快照](archive/design/ARCHITECTURE-PROTOTYPE.md)
