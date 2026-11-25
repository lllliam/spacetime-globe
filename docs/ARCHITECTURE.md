# 当前工程架构

**现行工程说明**，记录 1.0 建设中的工作区结构。产品目标见 [产品规范](PRODUCT-SPEC.md)，v14.2.1 原型记录见 [工程基线](BASELINE.md)。

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

`build.mjs` 合并三张样式表，在 `app.js` 的启动标记前拼接各模块。各脚本共享应用作用域，启动在地图、画布和分区准备后恢复已验证的会话。详见 [状态模型](STATE-MODEL.md)。

## 数据与状态

历史疆域来自 Cliopatria，现代国界来自 Natural Earth，绘制底图是现代地表。几何切片用于绘制、拾取和高亮。`data/history/` 记录独立历史主体、地图来源及分时段入口。构建按底图身份编译主叙事与相关历史索引，并将世界年表映射和章节 `eventIds` 合为一个阅读索引。编目 ID 和正文块 ID 由编辑维护，章节按场景 ID 和正文块 ID 定位图版。[历史内容模型](HISTORY-MODEL.md) · [阅读与内容组织](READING.md)

探索年、阅读入口年与观察年分别由协调层的三个业务上下文持有。阅读使用独立的 `#book` 滚动区域，隐藏底图、停掉地球绘制，并保留探索镜头。地图只在 Explore 与主动 Observe 中绘制。稳定导航于本地保存，书卷与章节使用编目 ID，正文位置优先按逻辑锚点复原。在线和单文件共用解码与降级路径。

`tools/historical-scenes.mjs` 校验旧档案和当前 `observation`，构建把可读的场景投影写入 HTML。`observationFrame` 由构建校验和浏览器共同使用，同步地点、路线和适用政权。阶段切换时检查疆域覆盖，地图包异步完成后按场景和当前有效请求更新。关系按 `relation` 语义校验并使用原阅读导航栈。[场景规范](HISTORICAL-SCENES.md)

首页的精确输入与游标均调用 `commitYear`。游标的预览与惯性留在控件内，分区和业务快照只在整年提交后更新。无有效会话时，启动等候 1500 年的疆域数据。历史数据覆盖公元前 3400 年至 2024 年，现代国界使用 Natural Earth 参考版本。

`yearEventGroups` 和 `concreteEventStarts` 来自同一条目分类。具体记录按单一历史年份匹配，政权年代和长时段背景单列，游标计数与列表共用同一结果。[首页实现与验证](progress/PHASE-03.md)

## 构建与部署

- 内容校验与构建共用 `tools/history-model.mjs` 校验和编译书卷、专题、场景、事件、地图入口及审校记录。内容校验生成 [内容覆盖](CONTENT-COVERAGE.md)，构建生成 `data/topics.json` 及在线与离线 HTML。`tools/migrate-history-model.mjs` 可用 Phase 04 数据快照核对兼容迁移。
- 在线页内嵌书卷与基础纹理，并从同源加载年表、历史疆域、地形等资源。离线页内嵌地图数据、高清资源和所需图标，移除清单链接。在线安全上下文注册 Service Worker。导航网络优先，其他同源 GET 缓存优先。
- `.github/workflows/build-site.yml` 使用 Node.js 22 运行内容、构建和部分语法检查，必要时将生成物提交回 `main`。目前通过 GitHub Pages 提供在线与离线入口。浏览器测试须另行运行，发布见 [版本规范](VERSIONING.md)。
- `tools/build-data.js` 用上游 Atlas HTML 重建世界数据和疆域二进制。高程与图标各有资产生成工具。日常站点构建使用已入库的地图数据、贴图和图标。

[原型架构快照](archive/design/ARCHITECTURE-PROTOTYPE.md)
