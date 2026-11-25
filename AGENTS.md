# Spacetime Globe 维护约定

## 产品与范围

- 时空地球是一本可通过时间和空间进入历史现场的世界历史书。让历史成为一个可以亲自进入的世界。保持一屏一个主要主体、叙事优先、证据可追查和上下文连续。以 [产品规范](docs/PRODUCT-SPEC.md) 和 [设计说明](docs/DESIGN.md) 为依据。
- Explore 以地球与时间探索历史，Read 以全屏纸面承载正文，Observe 由读者主动进入独立地图。维护三种年份各自的含义、来回的焦点及阅读位置。[状态模型](docs/STATE-MODEL.md)
- 只实施已授权的维护范围。新增功能、大规模重构、依赖变更和恢复 Phase 07 存量审校须有相应指令。[维护路线](docs/ROADMAP.md)

## 源码、数据与证据

- 应用源码在 `src/`，编辑源在 `data/books/`、`data/topics/`、`data/history/` 和 `data/scenes.json`。修改源文件，经构建生成 `index.html`、`index.offline.html`、`sw.js` 和 `data/topics.json`。内容检查生成 `docs/CONTENT-COVERAGE.md`。[工程架构](docs/ARCHITECTURE.md)
- 保留书卷、章节、正文块、来源和场景的稳定 ID，以及原有存储键、阅读锚点、站点作用域和用户数据。涉及迁移时，用现行与旧版实际写入的数据验证读取、重启和回退。[历史内容模型](docs/HISTORY-MODEL.md) · [状态模型](docs/STATE-MODEL.md)
- 史料修订按论断记录实际访问、材料定位、支持范围、限制及处置。Phase 07 暂存期间修改既有内容时，登记前后版本、稳定 ID、受影响的论断和待复核范围。旧证据随原稿保留，修订后的论断经复核才计入现行结果，同一存量对象只计一次。[历史编辑规范](docs/EDITORIAL-STANDARD.md) · [审校维护](docs/SOURCE-AUDIT.md#暂存期间的内容变更) · [恢复说明](docs/progress/PHASE-07.md#暂存与恢复)

## 验证与记录

- 在干净检出运行 `node tools/verify-content.mjs` 和 `node build.mjs`。仅改文档时在临时检出重建并核对产物字节。应用变更按 [验收标准](docs/ACCEPTANCE.md) 运行适用的 UI、移动端和 smoke 回归。
- 首页或选年运行 `node tools/verify-home.js`。阅读运行 `node tools/verify-reading.js`，并保留全量断网正文回归。状态与兼容变更运行 `node tools/verify-session-state.mjs`、`node tools/verify-session-browser.js`，并按影响范围验证旧格式。
- 内容结构运行 `node tools/verify-history-model.mjs`，涉及 Phase 04 兼容层时用基线构建运行 `node tools/verify-history-browser.js`。场景与关联运行 `node tools/verify-observation-model.mjs` 和 `node tools/verify-observation.js`。[场景规范](docs/HISTORICAL-SCENES.md)
- 缓存与内容标识变更验证首备、跨版本更新、损坏资源、失败恢复、多标签、断网及同源缓存保全。[PWA 验收](docs/progress/PHASE-09.md#pwa-与离线)
- 实测结果按工程自动化、人工体验、真机和史料审校各自记录，如实列出失败和未执行项。每次公开产品更新核对并同步 README、CHANGELOG 及受影响的现行文档，保留阶段报告、复现实验和验收证据。[文档导航](docs/README.md)

## 分支与发布

- `main` 是公开产品的主要维护分支，Pages 从其根目录部署。`develop/1.0` 及既有分支供追溯。复杂或高风险改动可先在短期功能分支验证，再获授权进入 `main`。
- 保留工作区已有改动和 Git 历史。禁止强推、改写历史或删除历史分支及标签。提交仅纳入授权范围内的源码、文档、必要产物及证据。
- 使用个人 GitHub 身份 `lllliam`。仓库级姓名为 `lllliam`，邮箱为 `lllliam@users.noreply.github.com`。提交前核对 author、committer，推送前核对认证账号及远端分支。沿用现有全局配置。
- 产品负责人已授权 `1.0.0-rc.1` 在完整历史审校待续时公开上线。正式 `1.0.0` 仍须完成全部验收并获得正式发布授权。更新 `main` 后核对只读构建工作流、Pages 部署及在线和离线入口。[版本规范](docs/VERSIONING.md) · [发布与回退](docs/RELEASE-CHECKLIST.md)
