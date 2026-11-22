# 图标 · v7（立体浮雕地球仪）

采用本次应用图标升级包中的正式图标。深空底色、立体浮雕地球仪，与 v7 历史阅读界面保持一致。图标为不透明正方形，由系统负责裁切圆角；maskable 版另含安全边距。

## 文件与用途

- 正式母版：`assets/icon-master.png`（1024×1024）。
- iOS 主屏幕：`apple-touch-icon.png`（180×180），兼容旧路径 `icon.png`。
- PWA：`icon-192.png`（192×192）、`icon-512.png`（512×512，any）、`icon-512-maskable.png`（512×512，maskable）。
- 浏览器：`favicon-32.png`（32×32）、`favicon.ico`（16/32/48），兼容旧路径 `favicon.png`（64×64）。

## 页面与离线同步

`src/shell.html` 通过带 `?v=4` 的链接引用 iPhone 图标、favicon 及 PWA manifest；页面主题色为 `#0a1016`。

`manifest.webmanifest` 分开声明 `any` 和 `maskable` 图标，背景色和主题色均为 `#0a1016`。

`sw.js` 更新至 `globe-v24-icons`，预缓存新版图标和 manifest，激活时清理旧版本缓存。

`node build.mjs` 同时生成网站版和单文件离线版。离线版内嵌 Apple Touch Icon、favicon PNG 与 ICO，并移除 manifest 链接。

## 维护

不要直接修改生成的 `index.html`、`index.offline.html`。以后替换图标时应同时更新静态文件、shell 引用版本、manifest、SW 缓存名和离线构建中的资源替换规则。旧图标兼容文件同样应同步更新。
