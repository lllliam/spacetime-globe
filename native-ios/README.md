# 时空地球原生版 0.1.0

适用于 **iOS 16 或更新版本的 iPhone**。SwiftUI 提供时间轴、书架和阅读界面，Metal 绘制地球。疆域、地表、正文和历史现场都随安装包提供，安装完成后可以在飞行模式下使用。史料原网页需要联网。

## 用 Windows 安装

1. 解压安装包，从官网下载 Windows 版 Sideloadly，并按官网安装所需的 Apple 组件。[Sideloadly 官网](https://sideloadly.io/)
2. 用数据线连接 iPhone，在手机上点「信任」，在 Sideloadly 中选择手机。拖入 `SpacetimeGlobe-Native-0.1.0-unsigned.ipa`，输入自己的 Apple ID，点 **Start**。
3. 按 iPhone 的提示开启「设置 → 隐私与安全性 → 开发者模式」。如果提示未受信任，在「设置 → 通用 → VPN 与设备管理」中信任对应的开发者帐号，然后从桌面打开「时空地球」。[Apple 开发者模式说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)
4. 免费 Apple ID 的签名有效期为 7 天。续签请保留原 App，使用同一 Apple ID 和 Bundle ID 覆盖安装。Sideloadly 也支持自动续签。[Sideloadly 续签说明](https://sideloadly.io/#faq)

## 首次使用

- 首页默认是 1500 年。单指拖动旋转地球，双指围绕触点缩放。点选明朝可以进入书卷，从正文的现场入口查看地点和路线。
- 底栏可拖动切换年代，也可以点左上角直接输入年份。书架收录 57 卷、28 个专题和 360 篇正文，另有 44 个可用历史现场。
- 时间刻度、选年、疆域和历史现场阶段有轻触感。双指缩放到边界时有较柔的触感，普通拖动与阅读滚动保持安静。右上角「地球设置」里可关闭「触感反馈」。
- 地图年份、镜头和本版阅读进度保存在 App 内。PWA 和此前的 iOS 封装版使用独立数据，已有进度暂时无法迁入。

## 构建

源码位于 `codex/ios-native`。从仓库根目录运行 `node native-ios/prepare-data.mjs` 和 `python3 native-ios/prepare-project.py`，再用 Xcode 构建生成的项目。GitHub Actions 中的 **Build native iOS IPA** 会验证现有内容、编译原生代码并生成未签名的真机包。地图与地表资料署名沿用项目首页。[项目资料说明](https://github.com/lllliam/spacetime-globe#数据与来源)
