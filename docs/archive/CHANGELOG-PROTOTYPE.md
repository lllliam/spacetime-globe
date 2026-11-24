# 原型阶段更新记录

本档案保留原型名称。原始记录来自 [基线 README](https://github.com/lllliam/spacetime-globe/blob/cfac7462bcd232d50baecd795962c8cd74af2597/README.md)。正文表格逐项迁移，历史版本链接继续指向原提交。带版本号的历史说明按原文保留，当前能力与数据口径以 [工程基线](../BASELINE.md) 为准。

## 原型版本表

| 版本 | 主要变化 |
| --- | --- |
| **v14.2.1 · 抽屉与地球过渡** | 统一手机端摘要、半窗和全窗的拖动与落位。地图资料可在小窗查看，正文和地图之间保留原镜头与段落。时间游标和底部渐变在原位一起淡入淡出。 |
| **v14.2.0 · 高程地形光照** | 按需加载 4K 高程法线贴图，近景坡向随光照显形。海岸和湖泊由物理地理遮罩定位，单文件离线版包含同一贴图。 |
| **v14.1.5 · 地点摘要显示** | 打开地点摘要时隐藏底部时间轴及其渐变背景，关掉摘要回到地图后恢复。 |
| **v14.1.4 · 快划跨年** | 底部时间轴的惯性距离随甩动速度递增，慢拖依然逐年定位。停住再松手时沿用最近整年。 |
| **v14.1.3 · 时间轴手感** | 底部刻度连续跟手，松手减速后选定整年并切换地图。史事入口出现时标尺保持原位。减少动态效果时直接停在最近的整年。 |
| **v14.1.2 · 阅读底边与下拉过渡** | 年份游标、地图说明和阅读区对齐可见视口；部分 iPhone 主屏幕模式已扣除的底部安全区不再重复留白。正文末尾可滚动读完，全屏下拉时地球保持深色背景。 |
| **v14.1.1 · 手机端抽屉修复** | 简览支持从抓手、标题和摘要上拉；修复小窗圆角穿帮和半窗顶部多余留白。抽屉底边使用纸色，主屏幕版交由 iOS 管理状态栏样式。 |
| **v14.1 · 深空质感与自然交互** | 重绘地球光照和地形层次，4K 地表贴图提前载入，近距观察时降低云层遮挡；首页改为左上角轻量年份入口、底部无边框史事天文游标、右上角悬浮视图选择。新增空白双击复位、单击纯净观赏模式与年份游标上滑直达史事。历史书卷、章节和地图场景数据不变。 |
| **v14 · 经典老书重写** | 10 卷经典书重写为 40 章，保留原有史料、政权入口及地图场景，迁移延伸阅读与 13 个年份直达入口。57 卷、228 章统一采用《明朝》范例的正文结构。 |
| **v13 · 全球书目补齐** | 新增 15 卷、60 章，扩展近现代地图阅读入口。校正底图不支持或重复的入口、同期对照的年代及目标。 |
| **v12.1 · 手机端修复** | 阅读抽屉和地球按可见视口重新布局，全屏阅读用纸色覆盖页面边缘。地图资料档案下拉回摘要，工具栏提供关闭按钮与可用的历史书目入口。 |
| **v12 · 世界全史精修** | 精修 17 部世界文明书卷，每卷 4 章、每章 6 段并增设历史现场；补齐东南亚与拉丁美洲两部综合书卷，修复 6 处同期阅读关联。现为 **42 卷、171 章、48 个地图场景**；保留原中国史书卷、史料目录与既有场景，并同步更新 README 和覆盖报告。 |
| [v12 · 中国全史精修](https://github.com/lllliam/spacetime-globe/tree/c01d177) | 以《明朝》为范本扩写其他 14 部中国史书卷，补入《辽、西夏与金朝》；每章六段叙事、空间论点与微观现场。保留原 48 个地图场景并修复历史关联、同期书卷年代和汉清旧版专题入口。全站现为 **40 卷、133 章**，其中中国史 **15 卷、60 章**；同步补齐 README 与内容覆盖报告。 |
| [v10 · 全球文明扩展](https://github.com/lllliam/spacetime-globe/tree/f8becf3) | 新增 22 卷、44 章，包括中国史 7 卷与全球文明 15 卷；精修《中华人民共和国》，保留原有 17 卷及数据绑定；增加 18 个多阶段地球场景。全站达到 39 卷、118 章、48 个场景；修正一处阿拔斯时代同期阅读链接的年代归属，更新内容覆盖报告。新增卷以概览体量为主，仍待进一步史料核查与深度编辑。 |
| [v9 · 中国核心王朝](https://github.com/lllliam/spacetime-globe/tree/2c268a1) | 新增《宋朝》5 章与《元朝》4 章，精修《汉朝》4 章、《唐朝》4 章及《清朝》5 章，保留既有出处、地图场景与延伸阅读；新增 11 个多阶段历史观察场景，完善汉唐宋元明清六卷的跨时期阅读与书球关联；修复场景年代及同期书卷跳转，并更新内容覆盖统计。 |
| [v8.2](https://github.com/lllliam/spacetime-globe/tree/f4a14fb) | iOS PWA 专项修复：场景图注卡改用非 transform 水平居中，滑动时不再横向错位；iPhone 冷启动视口增加延迟校准与统一底色；修复 peek 判定和重复标题，点击疆域先显示两行摘要；场景说明按完整两行省略，清理旧版暗黑毛玻璃与安全区覆盖样式。 |
| [v8.1](https://github.com/lllliam/spacetime-globe/tree/e16caeb) | 修复政权疆域点击时边界异步加载的响应、阅读态右上控件重叠、抽屉 peek 下滑关闭与误触、取消拖拽后回弹、书卷目录与场景联动、移动安全区以及场景返回闪动；优化拖拽期间地球重绘节流。 |
| [v8](https://github.com/lllliam/spacetime-globe/tree/f2ebb28) | 《明朝》五章以 41 条来源精修为内容样板，引用 8 个历史场景；iPhone 抽屉以 peek/half/full 连续手势替代显性三态按钮，保留地图图注滑动返回和书卷位置恢复。 |
| [v7 · 图标更新](https://github.com/lllliam/spacetime-globe/tree/e925021) | 更新 Apple Touch Icon、PWA/Maskable 图标、浏览器 favicon 与离线版内嵌图标，同步缓存版本。 |
| [v7 · 界面改造](https://github.com/lllliam/spacetime-globe/tree/7380c65) | 深空三维地球与米纸书卷视觉规范、显性年份与地球视图入口、纸本章节导航、图版卡、引文角标和阅读对照布局。 |
| [v6.x · 明朝场景扩充](https://github.com/lllliam/spacetime-globe/tree/fa4513f) | 扩充《明朝》场景、来源及阅读关系，并加入自动构建与 GitHub Pages 发布流程。 |
| **6.1.2** | WebGL 地球放大至 2 倍时按需载入 4096 × 2048 的地表影像。单文件离线版内置高清贴图。 |
| [6.1.1](https://github.com/lllliam/spacetime-globe/tree/2ee3b17) | 历史和现代地图减淡云层与云影，提亮暗部并增强边线对比。选中疆域使用金色描边，地形视图保留原有光照与云层。 |
| [6.1.0](https://github.com/lllliam/spacetime-globe/tree/1362498) | 重写《明朝》全卷，逐段标注来源。四处历史场景分别说明都城、漕运、半岛与关口的地理关系。 |
| [6.0.0](https://github.com/lllliam/spacetime-globe/tree/7a5bbd9) | 历史场景成为正文和地球的共同入口。场景紧跟相关段落，读者可主动观察并返回原处。 |
| [5.2.0](https://github.com/lllliam/spacetime-globe/tree/7b9bf1b) | 重做地球视图面板。年份入口以具体事件引导阅读，长期背景按需展开，已关联的条目直达书卷。 |
| [5.1.0](https://github.com/lllliam/spacetime-globe/tree/13637d2) | 新增 10 卷、40 章，扩充西亚、西非、美洲与亚洲的历史叙事。统一历史地图、主体摘要和世界表的中文名称。 |
| [5.0.1](https://github.com/lllliam/spacetime-globe/tree/b896c7e) | 地球按前台实际画布尺寸重绘，为 iPhone 主屏幕启动时的缩短视口做边缘过渡。地名避开年份。 |
| [5.0.0](https://github.com/lllliam/spacetime-globe/tree/50fff85) | 地球和年份定位历史主体，同一主体进入同一卷书。首批 5 卷，支持目录年份定位、连续阅读与地图往返。 |
| [4.7.1](https://github.com/lllliam/spacetime-globe/tree/ca3da37) | 统一加载页与屏幕边缘的底色，收起的半窗停止绘制。收紧横拨的年份间距。 |
| [4.7.0](https://github.com/lllliam/spacetime-globe/tree/a87b344) | 长按年份原位横拨，大幅拖动加速，停稳后切换疆域。单击看世界表，双击就地输入年份。 |
| [4.6.0](https://github.com/lllliam/spacetime-globe/tree/8f4db7c) | 从年份事件表进入地球事件视图，点地名了解地点，展开查看各方角色。首批以 1900 年义和团危机和 1842 年《南京条约》呈现。 |
| [4.5.4](https://github.com/lllliam/spacetime-globe/tree/0a37771) | 地球上显示同一事件的地点关系，可点地点查看它在事件中的作用。首批覆盖天津到北京、南京与五处通商口岸。 |
| [4.5.3](https://github.com/lllliam/spacetime-globe/tree/f183a9a) | 详情先讲事件，地点、背景和出处顺着正文展开。晚清八篇更新开篇。 |
| [4.5.2](https://github.com/lllliam/spacetime-globe/tree/150ddd8) | 阅读支持从左边缘右划返回、在正文顶部下拉收起。地区年表按时间排成一条路线。 |
| [4.5.1](https://github.com/lllliam/spacetime-globe/tree/fb6256c) | 摘要和阅读共用抽屉，下拉时连续过渡。地点预览在地球上标出具体地点，保留原文阅读位置。 |
| [4.5](https://github.com/lllliam/spacetime-globe/tree/2ddcb08) | 重做半窗与阅读界面。年表分开显示事件和时代背景，更新中国现代年表。 |
| [4.4.2](https://github.com/lllliam/spacetime-globe/tree/b2e2723) | 修复放大后云层出现多边形缺口的问题。 |
| [4.4.1](https://github.com/lllliam/spacetime-globe/tree/03aeafd) | 修复太平洋方向的竖向贴图接缝。 |
| [4.4](https://github.com/lllliam/spacetime-globe/tree/65664a8) | 云层独立于地表缓慢移动，加入云影与受光方向一致的大气渐变，改进日夜交界。 |
| [4.3](https://github.com/lllliam/spacetime-globe/tree/b941635) | 更新真实海陆纹理、云带、日夜光照与大气薄层；默认隐藏地名以突出地球，放大后显示。移除首页底部文字，统一安全区背景。 |
| [4.2](https://github.com/lllliam/spacetime-globe/tree/35ea64c) | 按 iPhone 17 Pro 竖屏比例调整首页，加入年份对应的阅读入口、默认自转与双指平移回弹。 |
| [4.1](https://github.com/lllliam/spacetime-globe/tree/e5b6a5f) | 简化首页与年份字体。轻点年份打开全球事件表，长按展开渐隐时间轴。长按或右键地球打开观察选项。 |
| [4.0](https://github.com/lllliam/spacetime-globe/tree/1a83588) | 重做地球首页与球面材质，加入按需展开的时间轴、播放和自然地理视图。 |
| [3.0](https://github.com/lllliam/spacetime-globe/tree/2d7866c) | 扩展为六洲 28 组专题、117 篇正文，加入跨专题阅读、大洲筛选与逐段出处。 |
| [2.2](https://github.com/lllliam/spacetime-globe/tree/617b427) | 更新应用图标，加入半窗上拉阅读、下拖关闭和阻尼回弹。 |
| [2.1](https://github.com/lllliam/spacetime-globe/tree/0931471) | 加入独立阅读层、晚清专题和地图往返。 |
| [2.0](https://github.com/lllliam/spacetime-globe/tree/5eae8f9) | 加入历史政权图层、矢量边界与地名，以及按时期浏览的资料。 |
| 1.0 | 建立可旋转缩放的 WebGL 地球、时间轴与 Canvas 兜底。 |

## 版本与 Git 对照

| 历史名称 | 可核对的提交或记录 |
| --- | --- |
| v0.1 | [29a6f27](https://github.com/lllliam/spacetime-globe/commit/29a6f27) 建立地球、章节时间轴和国家点击 |
| 原型 1.0 | [603e5f7](https://github.com/lllliam/spacetime-globe/commit/603e5f7)，原型渲染及交互重写 |
| 原型 v2 起点 | [93cd58b](https://github.com/lllliam/spacetime-globe/commit/93cd58b) 引入图层抽象及政权层。原 README 的 2.0 链接指向较晚的 [5eae8f9](https://github.com/lllliam/spacetime-globe/commit/5eae8f9) 快照 |
| 6.1.2 | [dfe4426](https://github.com/lllliam/spacetime-globe/commit/dfe4426) |
| v11 | 旧 README 提到《辽、西夏与金朝》是原升级脚本的 v11 前置依赖。公开 Git 历史未发现独立 v11 版本，入库补齐见 [624a082](https://github.com/lllliam/spacetime-globe/commit/624a082) |
| v12 世界全史精修、v12.1 | [b4b7f73](https://github.com/lllliam/spacetime-globe/commit/b4b7f73)、[47299e5](https://github.com/lllliam/spacetime-globe/commit/47299e5) |
| v13、v14 | [fad35e1](https://github.com/lllliam/spacetime-globe/commit/fad35e1) 一并提交两轮内容 |
| v14.1、v14.1.1、v14.1.2 | [9bb766d](https://github.com/lllliam/spacetime-globe/commit/9bb766d)、[ced1daf](https://github.com/lllliam/spacetime-globe/commit/ced1daf)、[cade615](https://github.com/lllliam/spacetime-globe/commit/cade615) |
| v14.1.3、v14.1.4、v14.1.5 | [ef7df47](https://github.com/lllliam/spacetime-globe/commit/ef7df47)、[ac75565](https://github.com/lllliam/spacetime-globe/commit/ac75565)、[bf1c02d](https://github.com/lllliam/spacetime-globe/commit/bf1c02d) |
| v14.2.0、v14.2.1 | [c5e382b](https://github.com/lllliam/spacetime-globe/commit/c5e382b)、[cfac746](https://github.com/lllliam/spacetime-globe/commit/cfac7462bcd232d50baecd795962c8cd74af2597) |

公开远端还保留 [抽屉手势探索分支](https://github.com/lllliam/spacetime-globe/tree/design/reader-sheet-gesture-20261117)，其分支头已在主线祖先中。参见 [主线工程记录](https://github.com/lllliam/spacetime-globe/commits/main/) 与 [固定原型快照](https://github.com/lllliam/spacetime-globe/tree/cfac7462bcd232d50baecd795962c8cd74af2597)。

## 原 README 中的详细更新说明

### v14.2 · 高程地形光照

放大地球后，WebGL 依据全球高程计算的坡向为山脊、峡谷和盆地着光。线上版约在 1.45 倍时请求 4K 法线贴图，并随缩放逐渐显现地形起伏。海岸与湖泊使用独立的地理遮罩，切换历史年份和疆域图层时水面的光照计算保持一致。单文件离线版内嵌同一贴图。

### v14.1 · 深空质感与自然交互

本次为界面与操作体验升级，**不改动历史内容和书卷身份**；继续遵守视觉主体明确、控件克制、操作自然、阅读不打断沉浸感的原则。

- **地球材质与光照：** 在 WebGL 中将真实地形纹理用于细微表面明暗，改善海洋柔和高光、日夜过渡与政权着色；靠近地球时逐渐减淡云层，并在启动后预载 4K 地表以缩短放大等待。
- **简化首页：** 左上年份采用无边框排版与悬浮输入；右上图层切换由底部抽屉改为轻量悬浮面板；支持单击无主体空白区域隐藏或恢复操作控件，双击球外空白处平滑复位视角。
- **时间游标：** 底部增加层级刻度、年份微光提示与快速史事入口，支持拖动切换、上滑打开当年史事以及键盘操作。
- **验证边界：** 代码通过语法及数据构建校验后仍需在 iPhone PWA 真机复查手势、低性能设备的 WebGL 表现及无动画偏好；样式与交互调整不能代替历史内容的史实审校。

### v12 · 世界文明书卷深度精修

- **本次精修范围：** 古埃及、古希腊与马其顿、阿拉伯帝国、萨珊与萨非波斯、英国与大英帝国、法兰西、西班牙与葡萄牙帝国、神圣罗马帝国与德意志、俄罗斯与苏联、美利坚合众国、蒙古帝国、印度、日本、朝鲜半岛、阿克苏姆与埃塞俄比亚、海洋东南亚、拉丁美洲共 **17 卷、68 章**。每章采用六段叙事，配备空间论点与微观历史现场；全站由 40 卷、133 章增至 **42 卷、171 章**。
- **补齐版本依赖：** 包内脚本需要《海洋东南亚》《拉丁美洲》两个尚未存在的书卷。新增跨政权综合书卷基础数据，分别绑定底图已收录的室利佛逝／满者伯夷，以及大哥伦比亚／巴西帝国，并附可公开访问的文献与机构导读；综合书卷的现代边界入口仅代表地区阅读线索，不意味着这些历史政权延续至今。
- **现有数据保护：** 原有 40 卷的书卷身份保持稳定；17 卷中已有的 15 卷保留原始史料目录、政权绑定、现代边界绑定和场景引用。全站原有 **48 个历史地图场景**、中国史 **15 卷、60 章**均未改动。
- **关联修正：** 修复希腊与马其顿、古埃及及阿拉伯帝国章节中部分「同期世界」目标年代不在书卷范围、或对照年份不属于当前章节的问题；完整书目及统计见 [内容覆盖](../CONTENT-COVERAGE.md)。

**史料与质量提醒：** 本次校验包含章节年代连续性、段落引用索引、场景完整性、跨书卷链接和构建有效性，不代表每条历史事实、数字和叙事解释已完成学术审校。尤其本次自动生成的部分书卷原始来源数量有限，需要后续补充针对性研究文献、核对具体论断。

### v12 · 中国史书卷深度精修

本次以《明朝》为结构参照，精修《夏商与西周》《春秋与战国》《秦朝》《汉朝》《三国与魏晋南北朝》《隋朝》《唐朝》《五代十国》《宋朝》《元朝》《清朝》《中华民国》《中华人民共和国》13 部已有书卷，另补建《辽、西夏与金朝》并精修，共计 **14 部**；《明朝》既有正文保持不变。由此中国史相关书卷达到 **15 卷、60 章**，本次精修章节以每章六段正文、空间命题与一处历史现场札记为主要组织方式。

- **延续已有内容连接。** 保留既有书卷身份、政权与现代国界入口、史料目录及全部历史场景引用；修复并恢复汉、清此前已有的专题延伸阅读和事件关联。
- **同期世界准确指向。** 对跨书卷链接逐项核对目标书卷 ID 及覆盖年代，修复原升级脚本中指向不存在的国家书卷或落在目标书卷年代外的链接。
- **补齐前置版本缺口。** 本仓库的上一版为 v10，未包含升级脚本原本依赖的 v11《辽、西夏与金朝》。本次根据其章节内容和历史底图绑定新建综合书卷基础信息，并使用剑桥中国史、耶鲁大学与大都会艺术博物馆等来源，保证四批脚本能够完整执行。

**内容质量边界：** “六段叙事＋场景关联”是结构与阅读深度的改进，不代表 15 部书卷的历史细节已获逐条学术审校。尤其综合书卷涵盖多个并行政权，不能视为对每个历史政权的独立完整专著。软件校验负责结构、年代、来源索引和连接有效性；重要历史判断、精确数字与争议事件仍需继续人工复核。
