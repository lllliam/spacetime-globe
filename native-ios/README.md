# 时空地球 iOS 原生版 0.4.2

适用于 iOS 16 及以上的 iPhone。地球、时间轴、书卷与历史现场都可离线使用。外部史料网页需要联网。

## 安装与升级

1. 从 [GitHub Actions](https://github.com/lllliam/spacetime-globe/actions/workflows/build-ios-native.yml) 下载成功构建的 iPhone 安装包。
2. 在 Windows 上用 Sideloadly 打开未签名的 IPA，选择 USB 连接的 iPhone，用 Apple ID 签名安装。[Sideloadly](https://sideloadly.io/faq.html)
3. 首次运行按手机提示启用开发者模式。重启后还要在手机上确认启用。[Apple 官方说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)
4. 从已有原生版升级时，保留手机上的 App，使用同一 Apple ID 和 Bundle ID 覆盖安装。已有年份、镜头、地名和触感偏好、章节进度会自动读取。免费 Apple ID 的开发签名可用七天。

## 使用

- **探索**　拖动地球转向，双指以触点为中心缩放。缩回全球时球体平滑归中，空闲 1 秒后开始平滑自转。右上角「设置与关于」可开关自转，并在 0.5×–2× 之间调整速度。点疆域打开底部摘要。上拉摘要看全屏详情，从详情顶部下拉返回摘要。拖动时间轴选年，双指缩放切换刻度，长按打开精确选年。点左上角年份查看这一年的世界。
- **阅读**　在纸面上打开完整书卷。目录、引用、显示设置可随时打开。进入历史现场或跨卷阅读后，可回到原处。
- **观察**　在全屏地图上查看阶段、地点、路线及其证据。阶段年份与探索年份独立。

## 开发

在仓库根目录依次运行。

~~~sh
node native-ios/prepare-data.mjs
python3 native-ios/prepare-project.py
~~~

用 Xcode 打开生成的项目。GitHub Actions 可编译、检查并生成未签名真机 IPA。数据编译读取仓库现有历史资料和地图。原生产品规则见 [产品规范](PRODUCT.md)，数据与工程约定见 [架构规范](ARCHITECTURE.md)。

历史内容批次与原资料位置见 [Historical World 检查点](../docs/progress/HISTORICAL-WORLD.md)。
