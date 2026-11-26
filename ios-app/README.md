# 时空地球离线 iOS 版

从 [构建记录](https://github.com/lllliam/spacetime-globe/actions/workflows/build-ios-offline.yml) 下载 `SpacetimeGlobe-iOS-unsigned`，解压后取出 `.ipa`。地图、书卷和历史现场随安装包提供，首次启动即可使用。打开外部史料网页需要联网。

## 在 Windows 上安装

1. 安装 [Sideloadly](https://sideloadly.io/)，按其说明准备 Windows 版 iTunes 和 iCloud。
2. 用数据线连接并解锁 iPhone。按提示信任这台电脑，在 Sideloadly 选择手机和刚下载的 `.ipa`，用自己的 Apple 账号签名安装。
3. iOS 16 及以上在「设置 → 隐私与安全性 → 开发者模式」开启开发者模式，并按手机提示信任开发者。完成后从主屏幕打开「时空地球」。[Apple 开发者模式](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device?language=objc)
4. 免费签名的有效期为七天。后续可通过同一 Apple 账号续签，并保持应用标识一致以覆盖安装。PWA 的已有阅读记录保存在网页的存储中，首次打开这个 App 会使用独立的阅读记录。[Apple 账号说明](https://developer.apple.com/help/account/basics/about-your-developer-account/) · [Sideloadly 续签](https://sideloadly.io/faq)

## 维护

向 `codex/ios-offline` 推送会在 GitHub 的 macOS runner 上生成未签名 `.ipa` 和 SHA-256。构建使用根目录的离线页面、固定版本的 Capacitor 和 Swift Package Manager。仓库产物不包含 Apple 账号、证书或设备描述文件。

安装后可打开飞行模式，从主屏幕冷启动，进入《明朝》并打开大运河观察。退出并重开可检查章节位置。打开明朝摘要后双指捏合地图上方，可检查页面比例和摘要位置。
