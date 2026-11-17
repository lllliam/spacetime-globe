# 地球仪 · 时空坐标

在可旋转的地球上探索历史疆域、全球事件和地区专题。现有 **28 组专题、117 篇正文**，覆盖六大洲。

[在线体验](https://lllliam.github.io/spacetime-globe/) · [单文件离线版](https://lllliam.github.io/spacetime-globe/index.offline.html) · [内容覆盖](docs/CONTENT-COVERAGE.md)

<img src="docs/design/globe.png" alt="当前首页，1900 年的历史地球" width="320">

## 操作

- 轻点年份打开当年全球事件表，长按年份展开时间轴。用键盘时，聚焦年份后按 Shift+Enter 可展开时间轴。
- 长按地球选择历史疆域、现代国家或自然地理。桌面也可右键点击球体，或聚焦球体后按 Shift+F10。
- 拖动旋转，双指缩放和平移。默认倍率松手后球体回到居中并慢速自转，放大后会停在当前区域。轻点陆地查看摘要，上滑摘要或点击专题进入阅读。

历史疆域来自 Cliopatria，覆盖公元前 3400 年至 2024 年。现代国界来自 Natural Earth，海岸与地形采用现代底图。正文各篇列有来源。

## 版本记录

| 版本 | 主要变化 |
| --- | --- |
| **4.4.2** | 修复放大后云层出现多边形缺口的问题。 |
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

界面源码在 `src/`，专题分文件存于 `data/topics/`。构建生成 `index.html` 和 `index.offline.html`。

地球表面与云层纹理来自 [three.js r160 地球示例](https://github.com/mrdoob/three.js/blob/r160/examples/textures/planets/earth_atmos_2048.jpg)。海陆影像表示现代地理，历史疆域叠加在该底图上。
