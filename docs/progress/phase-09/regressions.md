# Phase 09 回归索引

在候选独立检出重建后分别运行。浏览器脚本使用隔离配置与本地静态服务。历史参数为解档根目录或指定的真实构建文件。全库数据、历史阶段台账和用户常用配置均保留。[运行日志摘录](regression-evidence.txt)

| 检查 | 命令或输入 | 结论与范围 |
| --- | --- | --- |
| 结构与构建 | `node tools/verify-content.mjs`、`node build.mjs`、生成结果与 Git 比对 | 57 卷、243 章、28 组 117 篇与 48 个现场。零结构错误，一条已有 469 入口审校汇总。两份 HTML、Worker、专题和覆盖文档字节可复现。 |
| 会话逻辑与浏览器 | `node tools/verify-session-state.mjs`、`node tools/verify-session-browser.js` | 会话、年份、存储异常、阅读位置、刷新、重启、过期上下文、断网文件页。 |
| 首页、阅读、移动 | `node tools/verify-home.js`、`node tools/verify-reading.js`、`node tools/verify-mobile.js` | 六视口、时间、长卷、目录、字号、原位、触控模拟、浏览器缩放与来源。 |
| 观察 | `node tools/verify-observation-model.mjs`、`node tools/verify-observation.js` | 阶段、示意线精度、来源、关联返回、数据失败与过期状态。 |
| 全量 UI | `node tools/verify-ui.js`，另设置 `NOGL=1` 运行同脚本 | WebGL 与强制 Canvas2D 均跑完整 UI。两种情形断网逐章及逐篇。 |
| 冒烟 | `node tools/smoke.js` | 基本输入、图层、全屏、旋转与手势。 |
| 历史结构及原文保全 | `node tools/verify-history-model.mjs <Phase 04> <Phase 05>`，在 Phase 06 快照运行 `tools/audit-observation.mjs <Phase 05>` | 验证现行模型，并复验两次历史迁移范围与原文保全。 |
| 审校 | `node tools/verify-editorial-audit.mjs <5bae983> --phase-08 <2d8233b>`、`node tools/verify-editorial-browser.js` | Phase 07 和 Phase 08 台账一致，来源与范围抽查及离线脚注通过。 |
| 旧构建浏览器 | `node tools/verify-history-browser.js <Phase 04 index.html>`，`node tools/verify-ming-exemplar.js <旧 index.html>` 分别用 `95ffc10`、`2d8233b` 和 `5323209` | 纯指纹、稳定正文块、按旧现有字段保留图版及场景，五章现场和全部新目录复验。 |
| 真实页面任务 | `node tools/verify-product.js [实拍目录]` | 真实网页，无内部调试接口。鼠标、键盘和滚轮走过明朝、秦、仅地图、史事、跨卷和重启。 |
| PWA | `node tools/verify-pwa.js <cfac746 解档> <下一版测试构建> [证据目录]` | 实际 Worker 和 Cache Storage。故障注入限本机测试子路径。 |
| 性能与异常 | `node tools/verify-performance.js <提交标识> <结果.json>`，`node tools/verify-resilience.js <结果.json>` | 五次冷与缓存、真实地图及渲染故障、50 次切换、会话后台/前台复验。 |

PWA 的下一版测试构建可由候选副本生成。在临时副本的 `data/world.json` 根对象添加一个测试标记后运行 `node build.mjs`。低层故障全部由本地服务器、Edge 开发者协议和暂存浏览器配置模拟。候选项目资料保留原样。现场视觉复核使用 [真实页面实拍](../PHASE-09.md#代表性实拍)。
