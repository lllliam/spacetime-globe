# 1.0 · Phase 03 地球首页与时间系统

2026-11-24 · 阶段工程验收通过。Phase 03 基于已验收的 Phase 01 和 Phase 02，当前开发分支为 `develop/1.0`。Phase 04 等待产品负责人下达完整指令。线上继续由 `main` 提供 v14.2.1 原型。[开发路线](../ROADMAP.md)

## 功能实况

- 首页常态由亚洲朝向的完整地球、左上选年、右上视图、底部游标与「这一年」组成。新会话等候 1500 年疆域包，加载期间显示进度说明。已有有效探索或阅读会话优先恢复，包括镜头、显示偏好、阅读锚点和进入来源。损坏记录安全降级，新操作会使迟到的选择恢复失效。
- 底部游标支持缓慢跟手、快速滑动、最多额外 120 年的惯性、整年落位、逐年键盘操作和减少动态效果。地图在有效年份提交后更新，拖动时同时标出预览年与地图生效年。点击左上年份或按 `F2` 可精确输入，支持负数和中文公元前年份、六个文明节点及返回当代。年份上下限为公元前 3500 年与当前自然年，公元前 1 年直接跨至公元 1 年。移除了顶部横拨、底部上滑打开史事和空白单击隐藏首页控件。
- Cliopatria 疆域覆盖公元前 3400 年至 2024 年。更早年份显示自然底图及缺少疆域记录的说明，范围内按选定年取有效几何，暂无记录或加载失败时用状态文字说明。2024 年之后随年份模式显示现代参考边界及历史疆域截止年。现代国界来自 Natural Earth。世界数据包的生成时间是 2026-11-16，仓库中未记录该现代国界资产的采集年份或上游版本。
- 「这一年」始终可打开，按钮数量和列表共用 `yearEventGroups`，时间刻度微光标记具体史事开始年份。单日条目按实际所属年份归入具体事件。按资料起止日期判断多年的活动是否与选择年份相交，并显示原始起止范围。时代类条目及结构性长时段进入「长期背景」。普通类型采用 12 年划分，「其他」中的活动采用 40 年划分，以保留既有航行和营建记录。公元 2026 年只显示与 2026 年相交的条目。事件观察或阅读返回后恢复原年份、镜头、列表滚动和操作焦点。
- 视图面板提供随年份、现代边界、自然地形、地名、经纬线及复位视角。复位保留探索年。单指旋转、双指缩放与平移、桌面拖动与滚轮，以及双击空白复位继续可用。摘要保留标题、年代、一段短介绍和一个主入口，书卷按进度显示「阅读历史」或「继续阅读」，只有地图记录的主体显示「查看地图资料」。阅读继续使用移动半窗／全窗、桌面书球同屏及 Phase 02 返回机制。

## 实际运行截图

截图来自 Edge 运行的在线构建。前七张使用 393×844 CSS 视口、DPR 2，桌面为 1366×768、DPR 1。

| 场景 | 文件 |
| --- | --- |
| 1500 年历史疆域首启 | [01-home-1500.png](phase-03/01-home-1500.png) |
| 精确年份面板 | [02-year-picker.png](phase-03/02-year-picker.png) |
| 公元前 221 年疆域 | [03-bce-map.png](phase-03/03-bce-map.png) |
| 明朝主体摘要 | [04-ming-summary.png](phase-03/04-ming-summary.png) |
| 视图设置 | [05-view-settings.png](phase-03/05-view-settings.png) |
| 1900 年史事列表 | [06-year-events.png](phase-03/06-year-events.png) |
| 当代参考边界 | [07-modern-map.png](phase-03/07-modern-map.png) |
| 桌面地球首页 | [08-desktop-home.png](phase-03/08-desktop-home.png) |

布局实测覆盖 320×568、393×844、430×932、844×390、1366×768、1920×1080，DPR 分别为 2、2、3、2、1、1。竖屏手机模拟顶部 47px 和底部 24px 安全区。六种视口均核对完整地球、可点击控件与精确面板边界。另验证放大后地名避开年份控件，以及桌面旋转、滚轮缩放与复位。

## 回归与构建

Windows、Node.js 24.18.1、Edge 158.0.4370.33。

| 检查 | 实际结果 |
| --- | --- |
| `node tools/verify-content.mjs` | 通过，57 卷、228 章、48 场景、28 组 117 篇专题，0 错误、0 警告 |
| `node build.mjs` | 通过，在线 HTML 2,884,692 字节，单文件离线 HTML 9,217,804 字节 |
| `node tools/verify-ui.js` | 122/122，通过。断网逐章检查 228 章，逐篇检查 117 篇专题 |
| `node tools/smoke.js` | 18/18，通过 |
| `node tools/verify-mobile.js` | 通过，覆盖触控选择、地图资料、阅读与观察往返、半窗和全窗、游标惯性、取消、减动效与显式史事入口 |
| `node tools/verify-session-state.mjs` | 通过，覆盖模式守卫、三个独立年份、返回来源、无效值和进度 |
| `node tools/verify-session-browser.js` | 通过，含阅读与观察相互返回、桌面同屏、刷新、浏览器关闭重开、异常存储、迟到的异步地图恢复与断网 `file://` 阅读进度 |
| `node tools/verify-home.js` | 通过，拦截实际疆域请求检查冷启动等待及空分区，另验证六种视口、精确格式、年份边界、地图生效年、1900 史事统计、长期背景，以及清空收录的模拟情形。实际点选明朝、恢复进度、验证鼠标和滚轮、复位并重载现代参考图层偏好 |

## 文件范围与待验收项

- 首页和地图使用 `src/app.js`、`src/app.css`、`src/chrome.js`、`src/chrome.css`、`src/shell.html`。时间与会话改动涉及 `src/year-control.js`、`src/year-discovery.js`、`src/session-state.js` 和 `src/event-map.js`。摘要与继续阅读涉及 `src/subject-reader.js` 和 `src/reading.js`。
- 新增 `tools/verify-home.js`，更新 `tools/harness.js`、`tools/verify-ui.js`、`tools/verify-mobile.js`、`tools/smoke.js` 与 `tools/verify-session-browser.js`。重新生成两份 HTML。同步更新 README、AGENTS、ROADMAP、VERSIONING、DESIGN、ARCHITECTURE、STATE-MODEL，并加入本报告和八张实拍。
- 未发现阶段验收阻断项。iPhone 实机、安装、缓存迁移和线上发布核查安排在第 09 轮。现代参考国界的上游版本元数据留待数据阶段核查。默认全屏阅读与目录改进归 Phase 04，历史主体归属模型归 Phase 05，独立场景策略归 Phase 06。

## Git 检查点与阶段成果

Phase 03 修改源码前，已将 Phase 01 和 Phase 02 的完整工作区纳入检查点 `9f2a2142a17c57a3efa168afcc1e7063de694290`。首次推送并核对 `origin/develop/1.0` 指向该检查点，`origin/main` 指向原型 `cfac7462bcd232d50baecd795962c8cd74af2597`。[Phase 01](PHASE-01.md) · [Phase 02](PHASE-02.md) · [远端检查点](https://github.com/lllliam/spacetime-globe/commit/9f2a2142a17c57a3efa168afcc1e7063de694290)

本轮实现提交为 `feat(1.0): phase 03 - globe home and timeline`，远端核对与独立克隆结果将在同步完成后补录。
