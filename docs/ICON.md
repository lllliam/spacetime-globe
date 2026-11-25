# 图标维护

现有立体浮雕地球仪图标源自 v7 原型。应用元数据与发布标识按 [版本规范](VERSIONING.md) 核对。

图标为深空底色、不透明正方形，由系统负责裁切圆角。Maskable 版另含安全边距。

## 文件与用途

- 正式母版：`assets/icon-master.png`（1024×1024）。
- iOS 主屏幕：`apple-touch-icon.png`（180×180），兼容旧路径 `icon.png`。
- PWA：`icon-192.png`（192×192）、`icon-512.png`（512×512，any）、`icon-512-maskable.png`（512×512，maskable）。
- 浏览器：`favicon-32.png`（32×32）、`favicon.ico`（16/32/48），兼容旧路径 `favicon.png`（64×64）。

## 页面与离线同步

`src/shell.html` 通过带 `?v=4` 的链接引用 iPhone 图标、favicon 及 PWA manifest；页面主题色为 `#0a1016`。

`manifest.webmanifest` 分开声明 `any` 和 `maskable` 图标，背景色和主题色均为 `#0a1016`。

生成的 `sw.js` 按站点路径与构建内容标识管理缓存，图标和清单列入核心资源完整性清单。旧原型的 `globe-v24-icons` 保留以兼容已有客户端。[工程架构](ARCHITECTURE.md#构建与部署)

`node build.mjs` 同时生成网站版和单文件离线版。离线版内嵌 Apple Touch Icon、favicon PNG 与 ICO，并移除 manifest 链接。

## 维护

不要直接修改生成的 `index.html`、`index.offline.html`。替换图标时同步检查静态文件、页面引用版本、清单、旧图标兼容文件和离线内嵌规则。重新构建以生成资源签名和缓存标识，按适用范围验证安装和缓存更新。
