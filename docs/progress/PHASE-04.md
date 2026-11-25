# 1.0 · Phase 04 历史书卷与阅读系统

2026-11-25 · 阶段工程验收通过。开发分支为 `develop/1.0`。本地与远端工作基线均为 Phase 03 的 `bdaad6f0aad2869016c0bdc0c80455025f1767cf`，稳定线上原型为 `cfac7462bcd232d50baecd795962c8cd74af2597`。[开发路线](../ROADMAP.md)

## 本轮实现

- 手机、平板和桌面共用独立全屏阅读。进入时隐藏并停绘背景地球，探索摘要仍可按原入口打开全屏书卷。移除了半屏阅读、手势调节阅读高度、桌面书球同屏、章节自动定位地图及横向章节标签。
- 首读进入书卷扉页，包含真实书卷简介、年代、从头读、入口年提示与完整纵向目录。目录分别标识当前章、推荐章和上次阅读章。已有记录时，摘要可直接继续。目录或临时浏览别章章首时保留原进度，主动从头读或顺读下一章会开始新的阅读位置。
- 正文保留现有篇章、场景、同期内容、延伸阅读及引用。章末支持前后章和回目录。空间线索和完整来源可按需展开。引用编号打开对应来源，关闭后恢复原位置和焦点。地图资料页显示数据来源及正文收录情况。
- 书目、目录、阅读字号与退出均有顶部入口。退出目标根据入口为原摘要或地图、史事列表或观察。正文图版与既有地名链接主动进入独立观察，回来时恢复原卷、原章、段落相对位置和原入口焦点，仍可重复进入。
- 会话保留 `globe.session.v1`。旧 `viewMode: half` 记录恢复全屏并保留原探索状态、章节、导航链和正文位置。锚点沿用段落指纹与块内偏移，新增记录章中已展开的说明。四档字号单独存储。正文支持选取、键盘复制和正常的浏览器缩放。

## 实际运行截图

截图来自本轮 Edge 在线构建。手机为 393×844 CSS 像素、DPR 2，桌面正文为 1366×768、DPR 1。

| 场景 | 截图 |
| --- | --- |
| 《明朝》扉页与章节目录 | [01-ming-contents.png](phase-04/01-ming-contents.png) |
| 手机章首 | [02-mobile-chapter.png](phase-04/02-mobile-chapter.png) |
| 桌面章首 | [03-desktop-chapter.png](phase-04/03-desktop-chapter.png) |
| 正文中的历史场景图版 | [04-scene-in-article.png](phase-04/04-scene-in-article.png) |
| 独立历史观察 | [05-independent-observation.png](phase-04/05-independent-observation.png) |
| 观察结束后返回原文 | [06-returned-chapter.png](phase-04/06-returned-chapter.png) |
| 四档字号设置 | [07-reading-size.png](phase-04/07-reading-size.png) |
| 特大字号下的正文 | [08-large-text.png](phase-04/08-large-text.png) |
| 引用来源弹层 | [09-source-note.png](phase-04/09-source-note.png) |
| 历史书目 | [10-history-library.png](phase-04/10-history-library.png) |
| 地图资料 | [11-map-archive.png](phase-04/11-map-archive.png) |

布局覆盖 320×568、393×844、430×932、844×390、1366×768、1920×1080，DPR 分别为 2、2、3、2、1、1。竖屏手机模拟顶部 47px、底部 24px 安全区，也检查了原独立主屏视口退让。桌面 1366px 实拍正文约 665px，标准字号 20px，手机标准字号 18px，行高 1.9。Windows 实测中文用 STSong，未加载网络字体。顶栏操作的实际触区至少为 44×44 CSS px。墨色和次要文字与米纸的对比度分别约为 14.18∶1 和 4.57∶1。

在 Codex 内置浏览器用实际地图点选《明朝》，核对扉页、正文、目录返回和字号选择。逐图检查了顶栏及焦点、中文层级、版心与段间距、纸色与强调色、图版和注释的权重，以及移动安全区。精简了扉页简介的垂直间距，调整程序聚焦章节标题时的视觉呈现。扉页、正文标题与日期以仓库实际内容为准，顶栏按当前层级显示可用操作。

## 回归与构建

Windows、Node.js 24.18.1、Edge 158.0.4370.33。

| 检查 | 实际结果 |
| --- | --- |
| `node tools/verify-content.mjs` | 通过。57 卷、228 章、48 个历史场景、28 组 117 篇补充专题，0 错误、0 警告 |
| `node build.mjs` 与语法检查 | 通过。在线 HTML 2,845,917 字节，单文件离线 HTML 9,179,029 字节 |
| `node tools/verify-session-state.mjs` | 通过。状态守卫、三类年份、导航源、进度及异常数据 |
| `node tools/verify-session-browser.js` | 通过。刷新与真实进程重启、段落锚点重排、桌面隔离、损坏存储、迟到恢复、从史事和观察返回、断网本地文件会话 |
| `node tools/verify-home.js` | 通过。首页六种视口、1500 年首启、精确选年、史事、设置、继续阅读及探索恢复 |
| `node tools/verify-mobile.js` | 通过。触控、摘要进全屏、地图资料、观察返回、原生正文滚动、安全区及时间游标 |
| `node tools/smoke.js` | 18/18 通过 |
| `node tools/verify-ui.js` | 122/122 通过，含全部 228 章和 117 篇专题的离线正文、来源及关联入口 |
| `node tools/verify-reading.js` | 通过。六种视口、34 章临时目录、旧半窗会话、跨卷与两级观察返回、来源编号核对、浏览器双指缩放、特大字号与连续转屏锚点、真实浏览器重启。复制验证到浏览器可信事件，保留系统剪贴板 |

## 范围及后续阶段

- 新增阅读样式 `src/reading.css` 和专项回归 `tools/verify-reading.js`。改用全屏阅读结构的文件包括 `src/shell.html`、`src/reading.js`、`src/subject-reader.js`、`src/session-state.js`。观察和探索衔接涉及 `src/event-map.js`、`src/app.js`、`src/year-discovery.js`、`src/app.css`、`src/chrome.css`。
- 更新 `build.mjs`、在线及单文件离线 HTML 和既有浏览器回归。更新 README、AGENTS、ROADMAP、ARCHITECTURE、DESIGN、READING、STATE-MODEL、VERSIONING，并加入本报告及实拍。清理的半屏、同屏相关实现原位移除。
- 正式段落 ID 和数据迁移归 Phase 05，场景与共时关系治理归 Phase 06，史料审校归 Phase 07。iPhone 真机、安装、缓存迁移和原生辅助技术完整验证留待最终验收。

## 阶段结论与同步

本轮验收通过，未发现阻断项。Phase 01–04 已完成，Phase 05 等待完整指令。本地实现提交使用 `feat(1.0): phase 04 - immersive reading experience`，远端结果随阶段记录补充。
