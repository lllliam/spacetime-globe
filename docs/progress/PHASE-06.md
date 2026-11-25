# Phase 06 · 历史现场与全球关联

本轮以本地及远端 `develop/1.0` 的 `95ffc10e9adca688c7544cdf1fb697bf8ac033be` 为基线，初始工作树干净。该基线包含 Phase 05 实现 `2a5cb066e05a6bd6af57801424920827bf9094c6`。核对时 `origin/main` 指向 `cfac7462bcd232d50baecd795962c8cd74af2597`。[基线提交](https://github.com/lllliam/spacetime-globe/commit/95ffc10e9adca688c7544cdf1fb697bf8ac033be)

## 观察与返回

- 正文的图版跟随稳定段落 ID，带着空间问题和时间进入独立观察。保留已明确校对的正文地名链接。补充专题保留两个复用场景。暂停的场景保留出处与引用记录，正文隐藏相应入口。
- 顶部按入口显示返回正文、史事或探索及观察年代。地球可旋转、缩放与平移。底部说明区自然滚动，提供复位、阶段按钮、地点选择、来源和当前图例。选择地点在阶段解释下补充作用，重复点选可取消。统一返回按钮和 Escape；取消了卡片滑动退出及跨章场景串联。
- 观察进入首个有意义的阶段或入口指定阶段。空数组只显示该字段没有的项目，缺省使用场景默认配置。阶段切换重新匹配疆域参考年。覆盖以外、地图包等待或加载失败时用自然底图。已经失效的异步请求不接管新的场景或阶段。
- 地点按可核实位置、近似、现代参照、区域和未知管理。图中距离按当前阶段的有效地点计算并写明为地理直线距离。线型区分有证据的实际路线、近似路线、示意联系。使用箭头的条件为路线方向另有证据。当前正式场景仅使用有根据的示意联系。
- 返回观察来源时恢复原书卷、章节、正文位置、读书导航、镜头或史事列表焦点。浏览器重启把从正文进入的观察恢复为阅读，并可恢复从史事列表发起观察前的列表位置。[场景规范](../HISTORICAL-SCENES.md) · [状态模型](../STATE-MODEL.md)

## 48 个场景的处置

| 处置 | 数量 | 范围 |
| --- | ---: | --- |
| 保留地点观察 | 11 | 苏萨与波斯波利斯、墨西哥谷地盟城、两篇专题事件等 |
| 保留并降级为示意连线 | 2 | 永乐双都与运河、晚明跨太平洋白银贸易 |
| 简化阶段并移除旧线 | 23 | 郑和远航、秦朝区域交通、东亚近代海陆变化等 |
| 降级为地点或区域参照 | 8 | 南亚区域、伊比利亚跨洋贸易、英国和俄国的代表地点等 |
| 暂停 | 4 | `alexander-eastward`、`persia-crossroads`、`germany-central-europe`、`usa-continental-pacific` |

44 个场景可进入观察，其中 25 个有多阶段。86 条旧线及相关位置关系仍在原数据中，正式界面使用 3 条另有证据的示意联系，均无单向箭头。暂停案例的旧地点不足以代表所述历史阶段或主体。逐项记录包含每个场景的正文位置、问题、价值、前后年代、旧线路、地理限制、来源和 Phase 07 待办。[逐场景清单](phase-06/audit.json)

## 实际资料核查

| 场景或关联 | 查证范围与处置 |
| --- | --- |
| `yongle-capitals` | 查阅大运河遗产说明及 ICOMOS 对淮安、通惠河和漕运的评估，核对故宫的 1421 年迁都记录。当前图用两条示意联系表达南北输粮体系。1411 年阶段无路线。历史河道、局部闸口及可通航区间待查。[UNESCO 大运河](https://whc.unesco.org/en/list/1443/) · [ICOMOS 评估](https://whc.unesco.org/document/128794) · [故宫永乐资料](https://www.dpm.org.cn/court/lineage/226257.html) |
| `zhenghe-voyages` | 水手博物馆的分航次章节支持首航到印度西岸、第四次抵霍尔木兹、后期涉及摩加迪沙。保留港口位置比较，暂停使用旧折线；加州大学出版社的旧 PDF 在读取时被识别为二进制内容，未用作判定。具体停靠点、航迹和分航仍待复核。[水手博物馆](https://exploration.marinersmuseum.org/subject/zheng-he/) |
| `ming-global-silver`、`iberian-atlantic-pacific`、伊比利亚卷与明朝卷关联 | 大都会艺术博物馆贸易说明及外销织物记录支持阿卡普尔科和马尼拉的港口贸易，以及美洲银与中国等亚洲商品的交换。明朝场景展示港口联系，伊比利亚场景仅定位马尼拉。对特定波托西批次、月港转运、航迹和晚明课税因果保留待办。两卷的实际联系限定在两章节覆盖的 1571—1580 年。[大都会贸易说明](https://www.metmuseum.org/essays/the-manila-galleon-trade-1565-1815) · [外销织物藏品](https://www.metmuseum.org/art/collection/search/227351) |
| `achaemenid-darius` | ICOMOS 苏萨评估支持两处王室中心具有不同功能。用遗址近似位置对照行政与礼仪，保留波斯波利斯功能范围的解释余地。[ICOMOS 苏萨评估](https://whc.unesco.org/document/152720) |
| `egypt-nile-corridor` | 世界遗产价值声明支持孟斐斯的河谷地理与行政角色，以及它和亚历山大港在托勒密时期并存。当前孟斐斯点使用开罗附近的现代参照，旧线路撤下。遗址网页返回 403，核查使用正式声明 PDF。[世界遗产价值声明](https://whc.unesco.org/document/197467) |
| `india-ganges-deccan` | UNESCO 桑奇遗产声明支持阿育王、孔雀时代和区域文化背景。德里与班加罗尔用于现代区位参照。旧线缺古代行程依据，阿育王铭文分布与 1947 年分治范围继续待查。[UNESCO 桑奇遗产声明](https://whc.unesco.org/archive/2021/whc21-44com-8E-en.pdf) |
| `nanjing-treaty-ports` | 核对《南京条约》第二条和第十二条，确定五口名单及南京有关记录。港和码头用城市近似位置。[南加州大学刊载的条约](https://china.usc.edu/node/20462) |
| `boxer-crisis-1900` | 1900 年 6 月 4 日驻京报告支持北京节点，采用发报方立场的有限证据。美国海军专题检索有天津摘要，直接访问超时，天津的具体位置和战事细节继续待核对。图中两处城市为区位对照。[美国国务院档案](https://history.state.gov/historicaldocuments/frus1900/d116) · [美国海军历史资料](https://www.history.navy.mil/browse-by-topic/wars-conflicts-and-operations/early-20th-century-conflicts/boxer-rebellion.html) |
| 《明朝》与阿兹特克书卷共时 | 核对墨西哥国立自治大学关于三方同盟早期的记录与故宫的永乐资料。以 15 世纪前期对读明朝与墨西哥谷地，保留同盟成立年份的异说。[墨西哥国立自治大学](https://e1.portalacademico.cch.unam.mx/alumno/historiademexico1/unidad2/culturamexica/imperio) · [故宫永乐资料](https://www.dpm.org.cn/court/lineage/226257.html) |

## 全球关联与正文兼容

| 当前类型 | 条数 |
| --- | ---: |
| `contemporary` 共时 | 2 |
| `compare` 比较 | 76 |
| `documented` 有材料支持的实际联系 | 1 |
| `context` 历史背景 | 166 |
| `further` 延伸阅读 | 85 |
| `legacy` 遗留阅读目标 | 253 |

583 条关系各有源、目标、旧说明、时间信息与当前处置。两条完成指定范围的资料核对，1 条仍待核查，580 条为既有编辑关系。旧说明中的未经核查断言留档，读者看到阅读目标或有明确编辑依据的说明。正文按语义分组。指定目标章直达章节，关系时间进入阅读上下文并可用于扉页推荐。返回恢复原文、资料展开状态和关联入口焦点。[逐关系清单](phase-06/audit.json) · [阅读规范](../READING.md)

以 Phase 05 源文件逐项对比 57 卷、228 章、1,369 个书卷主段落及 28 组、117 篇专题。正文、段落标题、补充内容、稳定身份、原来源记录、48 个场景的完整原始记录、49 个正文引用及 48 个事件阅读入口保留。逐章比对清单 SHA-256 为 `9a475823e938d5499942cd778d2de9b2397d056b51cf9e3cb48ca3bf18decac2`。[逐项清单](phase-06/audit.json)

## 验证与运行实拍

使用 Windows、Node.js 24.18.1 和 Edge 158.0.4370.33。移动端为浏览器触控模拟。具体结果以本节和专项脚本输出为准。

| 检查 | 实际结果 |
| --- | --- |
| `node tools/verify-content.mjs` | 通过，0 结构错误、1 条编辑提示，471 条原地图绑定待逐条审校 |
| `node build.mjs` | 通过。在线 HTML 3,011,001 字节，单文件离线 HTML 9,344,113 字节 |
| `node tools/verify-history-model.mjs <Phase 04 目录> <Phase 05 目录>` | 通过，复核 Phase 04 到 Phase 05 的历史迁移及当前模型约束 |
| `node tools/verify-history-browser.js <Phase 04 目录>/index.html` | 通过，真实旧会话升级到稳定正文块并保留块内进度、探索镜头和离线恢复 |
| `node tools/audit-observation.mjs <Phase 05 目录>` | 通过，逐章原文、来源、绑定及场景身份和历史关系逐项可追溯 |
| `node tools/verify-observation-model.mjs` | 通过，检查阶段、空数组、位置、路线精度与证据、暂停入口和关系时间 |
| `node tools/verify-session-state.mjs`、`node tools/verify-session-browser.js` | 通过。状态隔离、进出观察与关联导航、刷新重启、异常状态与断网会话 |
| `node tools/verify-home.js`、`node tools/verify-reading.js` | 通过。首页、时间、阅读以及原全屏导航在六种视口通过 |
| `node tools/verify-mobile.js`、`node tools/smoke.js` | 触控回归通过，Smoke 18/18 |
| `node tools/verify-ui.js` | 122/122 通过，含全部 228 章、117 篇断网阅读，以及可用场景与暂停入口检查 |
| `node tools/verify-observation.js [实拍目录]` | 通过。历史现场、地球缩放平移和复位、地点及阶段、三类线型、箭头门槛、日期变更线、地图加载失败及竞态、六种视口、来源、真实关联与往返在线离线专项 |

复核基线时可执行 `git archive 9c4f2ee data index.html` 或 `git archive 95ffc10 data index.html`，分别解包到独立的 Phase 04 与 Phase 05 目录。

实测视口为 320×568、393×844、430×932、844×390、1366×768 和 1920×1080。移动端实拍为 393×844 CSS px、DPR 2，桌面为 1366×768、DPR 1。资料滚动在独立内层完成，已复核滚动后的地球纹理和历史疆域均可见。

| 场景 | 实拍 |
| --- | --- |
| 单一年代地点比较 | [苏萨与波斯波利斯](phase-06/01-susa-and-persepolis.png) |
| 多阶段的无路线阶段 | [1411 年会通河](phase-06/02-stage-without-route.png) |
| 示意联系与地点补充 | [1421 年清江浦与阶段说明](phase-06/04-place-and-stage.png) |
| 来源与地图精度 | [资料与说明](phase-06/05-source-and-precision.png) |
| 从观察回到原章 | [原文位置与入口](phase-06/06-returned-to-text.png) |
| 桌面观察 | [太平洋两岸的示意联系](phase-06/07-desktop-pacific.png) |
| 全球历史关联 | [历史比较](phase-06/08-historical-comparison.png) · [共时](phase-06/09-contemporary.png) · [实际联系及证据](phase-06/10-documented-link.png) |

## 文件及后续审校

运行时改动集中在 `src/event-map.js`、`src/history-rules.js`、`src/reading.js`、`src/subject-reader.js`、`src/session-state.js`、`src/year-discovery.js`、样式和页面模板。共享校验及场景编译在 `tools/history-model.mjs` 和 `tools/historical-scenes.mjs`。新增 `tools/audit-observation.mjs`、`tools/verify-observation-model.mjs`、`tools/verify-observation.js` 和场景维护规范。场景、书卷和专题关系、年表延伸阅读有数据变动，HTML 和专题汇总由构建重生成。阶段报告、实拍及逐项清单一并提交。

Phase 07 核对 471 条地图绑定、史料及关系原论断，补查 4 个暂停场景是否有合适定位，复核未经确认的旧几何、阶段和地点。历史资料的核查范围以逐项记录为准。iPhone 真机、安装、缓存迁移及原生辅助技术纳入最终验收。

## 阶段结论与 Git

本轮验收通过，未发现阻断项。Phase 01–06 已完成，Phase 07 等待产品负责人的完整指令。实施提交使用 `feat(1.0): phase 06 - historical observation and world connections`。[开发分支](https://github.com/lllliam/spacetime-globe/tree/develop/1.0)
