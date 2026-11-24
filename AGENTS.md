# Spacetime Globe 维护约定

## 产品与阶段

- 以 [产品规范](docs/PRODUCT-SPEC.md) 为产品设计决策依据，遵循 [开发路线](docs/ROADMAP.md) 的阶段顺序。只执行产品负责人已明确下达的当前阶段任务。
- 保持产品定位与已定决策。避免跨阶段开发、无关重构及未经指示的新增依赖。以 [工程基线](docs/BASELINE.md) 区分原型行为和未来目标。原型档案供追溯，设计指令来自现行规范。
- 保留用户工作区已有改动及所有历史提交、分支、标签和发布记录，禁止破坏性 Git 操作。已完成阶段的非阻断问题留待最终验收，阻断下一阶段的问题在负责人确认后处理。

## 源文件与验证

- 功能源码在 `src/`，主体书卷在 `data/books/*.json`，补充专题在 `data/topics/*.json`，历史场景在 `data/scenes.json`。构建生成 `data/topics.json`、`index.html` 和 `index.offline.html`。内容校验生成 `docs/CONTENT-COVERAGE.md`。修改其输入，避免直接编辑生成物。
- 保持书卷、章节及场景 ID 稳定，依据编辑选择和真实来源组织正文；地图几何与书卷叙事采用各自的数据口径。维护细节见 [阅读与内容组织](docs/READING.md)。
- 每轮完成后运行规定的验证。先执行 `node tools/verify-content.mjs` 和 `node build.mjs`，涉及交互时运行适用的 UI、移动端和 smoke 回归。仅允许文档或档案变更的阶段在临时副本中验证，保持生成物在工作区的原样。区分浏览器模拟、真机、结构检查和内容审校，如实记录失败、未执行项及原因。
- 功能、交互、修复、图标与内容覆盖变化须核对并更新 README 和受影响的现行文档。按 [版本规范](docs/VERSIONING.md) 记录阶段变化和正式更新，自动生成产物的单独提交无需重复记录。

## 开发分支与网站发布

- 使用个人 GitHub 身份 `lllliam`，仓库级姓名 `lllliam`、邮箱 `lllliam@users.noreply.github.com`。提交前核对 author/committer，推送前核对认证账号。维护公司全局配置原样。
- Phase 01–08 的阶段成果统一保存在 `develop/1.0`。每阶段通过验收后，核对远端与工作区、审查 diff、运行构建和回归、更新 README 和 [阶段报告](docs/progress/)，然后提交并推送到 `origin/develop/1.0`，以远端查询确认 commit。保留他人改动，禁止强制推送及重写历史。
- 提交仅纳入阶段工程成果、必要构建产物和证据。排除凭据、个人文件、浏览器配置、临时测试产物和无关修改。
- `main` 保持稳定线上版本。第 09 轮验收通过并获正式发布授权后，按 [版本规范](docs/VERSIONING.md) 合并和发布。等待 Pages 部署完成后核对在线与离线入口。[仓库](https://github.com/lllliam/spacetime-globe) · [网站](https://lllliam.github.io/spacetime-globe/)
