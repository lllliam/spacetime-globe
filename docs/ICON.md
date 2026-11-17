# 图标 · v2.2

采用内置 imagegen 工具生成正式母版，取代原来的地球画面裁切。深蓝珐琅与黄铜浮雕大陆呼应应用配色，经纬线与带刻度的环表达空间与时间。没有文字，在小尺寸下保留清晰轮廓。背景为不透明正方形，由操作系统裁切圆角。

## 资源

- 母版：`assets/icon-master.png`。
- iOS 主屏幕：`icon.png`（180×180）。
- PWA：`icon-192.png`（192×192）、`icon-512.png`（512×512，any / maskable）。
- 浏览器：`favicon.png`（64×64）。
- `tools/build-icons.ps1` 使用 Windows System.Drawing 从母版缩放，不重新生成画面。应用运行不依赖该脚本。
- 图标引用增加 `?v=3`，Service Worker 缓存同时升级，避免网站继续命中旧文件。单文件离线版将 favicon 和 touch icon 直接内嵌。

## 生成提示词（内置工具）

Use case: logo-brand. Create ONE finished square app icon for an elegant offline world-history globe application, Spacetime Globe. Asset only, full bleed square 1024x1024, opaque background; no presentation mockup, no surrounding device, no text, no letters, no numbers, no watermark. A single centered sculptural globe as a precision historical scientific instrument. Whole circular sphere clearly readable with generous space around it, diameter approximately 62% of the square, entirely within central 70% maskable safe area. Deep midnight ink navy background, subtly layered smooth matte surface. The Earth is dark petrol-blue enamel with delicately raised warm champagne-brass continental silhouettes (Eurasia and Africa visible, recognizable coastlines, no country borders), restrained fine engraved latitude/longitude meridians. A slender incomplete brass meridian/chronometer ring wraps around the sphere at a graceful tilt, with very few refined tiny index ticks suggesting time. Premium museum instrument craftsmanship, lightly brushed brass, soft tactile embossing, soft upper-left studio lighting and gentle grounded ambient shadow. Restrained warm gold highlights, quiet dark blue shadows, excellent silhouette and strong legibility at 48px. Contemporary Apple-quality app icon finish with subtle dimensionality, refined editorial restraint, no excessive ornament, no pedestal, no stars, no neon, no busy map texture, no excessive shine. Background fills square edges; do not bake rounded-square corners, the OS will mask the square. Save the generated asset locally and return the local file path if available.
