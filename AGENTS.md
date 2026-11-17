# Spacetime Globe 维护约定

## 修改与交付

- 功能源码在 `src/`，专题在 `data/topics.json`；不要直接编辑生成的 HTML。
- 修改后运行 `node build.mjs`，同步生成 `index.html` 与 `index.offline.html`。涉及交互时运行适当的浏览器回归。
- 保持地球、时间轴与图层开关的首屏结构；阅读通过摘要抽屉进入独立阅读层。细节见 `docs/READING.md`。

## 网站同步（用户明确要求）

每次完成修改后，都要同步网站，不以本地文件作为最终交付：

1. 检查远端更新，保留他人改动。
2. 构建并完成与改动相符的验证。
3. 提交源码、数据和构建产物，推送到 `origin/main`。
4. 等待 GitHub Pages 发布完成，并请求线上页面核对更新内容。
5. 向用户提供网站链接与实际发布结果；发布失败要明确说明，不能把推送成功等同于网站已更新。

仓库：https://github.com/lllliam/spacetime-globe

网站：https://lllliam.github.io/spacetime-globe/
