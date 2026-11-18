# 地球仪 · 时空坐标

**一本可以通过地球和时间打开的世界历史书。** 转动地球、选一个年份、点开一个历史主体，就能沿着它的一生往下读。

[在线体验](https://lllliam.github.io/spacetime-globe/) · [单文件离线版](https://lllliam.github.io/spacetime-globe/index.offline.html) · [内容覆盖](docs/CONTENT-COVERAGE.md)

<img src="docs/design/globe.png" alt="当前首页，1900 年的历史地球" width="320">

## 设计理念

地球负责发现，年份负责定位，历史主体负责组织章节，连贯的叙事负责建立理解。比如在 1500 年或 1600 年点击明朝疆域，两次都打开《明朝》全卷。入口年份只在目录里标出所在章节，可以从建立读起，也可以跳到眼前的年代。

- **主体明确。** 首页以地球为视觉中心。阅读以国家、王朝和帝国等历史主体为单位，通过固定的书卷身份组织内容。地图上重叠的主体可在阅读中按需查阅。
- **叙事优先。** 一卷串起建立、发展、转折、结局与影响。每章围绕一个历史问题展开，交代前因与后果。仍存续的主体继续增订。
- **关联按需。** 事件、人物、地点、其他政权和来源帮助读懂当前章节。地图和延伸阅读随正文提供，阅读进度和地球年份各自保留。
- **渐进深入。** 地球用来探索，半窗用来快速了解，正文用来建立理解，出处支撑进一步查证。只有地图资料的主体会如实标明收录状态，完整书卷由编辑选材和核对。

## 内容

首批 **5 卷、25 章**，收录《明朝》《清朝》《罗马帝国》《奥斯曼帝国》和《中华人民共和国》。罗马卷沿着帝国传统读到东罗马的终结，清朝卷从定国号读到 1912 年退位，中华人民共和国卷按开放终点处理。原有 28 组、117 篇专题收在历史书目的「补充专题资料」中。 [内容覆盖](docs/CONTENT-COVERAGE.md)

## 操作

- 单击年份打开当年全球事件表，长按后可在原位左右拨动年份，双击可直接输入。用键盘时，聚焦年份后按 Shift+Enter 展开，方向键逐年调整，F2 输入年份。
- 点全球事件表的标题查看已知地点或相关地区。点地名了解它在事件中的作用，展开参与方可查看各方角色。
- 长按地球选择历史疆域、现代国家或自然地理。桌面也可右键点击球体，或聚焦球体后按 Shift+F10。
- 拖动旋转，双指缩放和平移。轻点疆域查看该主体的摘要，上拉或点「打开全卷」进入目录。正文底部可读下一章，支持的章节可展开「地图与延伸阅读」。从阅读顶部下拉回到原半窗。

历史疆域来自 Cliopatria，覆盖公元前 3400 年至 2024 年。现代国界来自 Natural Earth，海岸与地形采用现代底图。正文各篇列有来源。

## 版本记录

| 版本 | 主要变化 |
| --- | --- |
| **5.0.1** | 地球按前台实际画布尺寸重绘，为 iPhone 主屏幕启动时的缩短视口做边缘过渡。地名避开年份。 |
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

版本链接指向对应的 GitHub 源码快照。需要回退发布时，从目标提交恢复到新的 Git 提交，再部署到 GitHub Pages。

## 开发

```sh
npm run content:verify
npm run build
npm run serve
npm run verify
npm run smoke
```

界面源码在 `src/`。主体书卷存于 `data/books/`，补充专题存于 `data/topics/`。构建检查书卷身份、地图绑定、章节年代、来源和延伸阅读，生成 `index.html` 和 `index.offline.html`。

地球表面与云层纹理来自 [three.js r160 地球示例](https://github.com/mrdoob/three.js/blob/r160/examples/textures/planets/earth_atmos_2048.jpg)。海陆影像表示现代地理，历史疆域叠加在该底图上。
