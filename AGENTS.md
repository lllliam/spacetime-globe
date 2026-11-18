# Spacetime Globe 维护约定

## 修改与交付

- 功能源码在 `src/`，主体书卷在 `data/books/*.json`，补充专题在 `data/topics/*.json`；`data/topics.json` 为构建生成的汇总；不要直接编辑生成的 HTML。
- 修改后运行 `node build.mjs`，同步生成 `index.html` 与 `index.offline.html`。涉及交互时运行适当的浏览器回归。
- 首页以地球与年份定位历史主体，摘要抽屉进入该主体的完整书卷。保持书卷 ID 稳定，章节依据编辑选材和来源组织。细节见 `docs/READING.md`。

## 网站同步（用户明确要求）

本项目必须使用个人 GitHub 身份 `lllliam`。仓库级提交姓名设为 `lllliam`，邮箱设为 `lllliam@users.noreply.github.com`；不得继承公司身份 `TH_WangYiFei`，不得更改公司的全局 Git 配置。提交前检查 author/committer，推送前确认认证账号为 `lllliam`；无法确认时不要推送。已发布提交的身份纠正涉及重写历史，应先准备修正结果，再取得用户确认。

每次完成修改后，都要同步网站，不以本地文件作为最终交付：

1. 检查远端更新，保留他人改动。
2. 运行 `node tools/verify-content.mjs`，构建并完成与改动相符的验证。
3. 提交源码、数据和构建产物，推送到 `origin/main`。
4. 等待 GitHub Pages 发布完成，并请求线上页面核对更新内容。
5. 向用户提供网站链接与实际发布结果；发布失败要明确说明，不能把推送成功等同于网站已更新。

仓库：https://github.com/lllliam/spacetime-globe

网站：https://lllliam.github.io/spacetime-globe/
