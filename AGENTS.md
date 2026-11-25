# Spacetime Globe 维护约定

## 产品与阶段

- 以 [产品规范](docs/PRODUCT-SPEC.md) 为产品设计决策依据，遵循 [开发路线](docs/ROADMAP.md) 的阶段顺序。只执行产品负责人已明确下达的当前阶段任务。
- 2026-11-25 产品负责人授权暂存 Phase 07，阶段验收仍待完成。Phase 08《明朝》标杆书卷建设及 Phase 09 产品与工程验收可按各自指令开展。正式发布仍须完成历史内容验收，并由产品负责人确认全部发布条件。[暂存与恢复](docs/progress/PHASE-07.md#暂存与恢复)
- 保持产品定位与已定决策。避免跨阶段开发、无关重构及未经指示的新增依赖。以 [工程基线](docs/BASELINE.md) 区分原型行为和未来目标。原型档案供追溯，设计指令来自现行规范。
- 保留用户工作区已有改动及所有历史提交、分支、标签和发布记录，禁止破坏性 Git 操作。已完成阶段的非阻断问题留待最终验收，阻断下一阶段的问题在负责人确认后处理。

## 源文件与验证

- 功能源码在 `src/`，主体书卷在 `data/books/*.json`，补充专题在 `data/topics/*.json`，历史场景在 `data/scenes.json`。构建生成 `data/topics.json`、`index.html` 和 `index.offline.html`。内容校验生成 `docs/CONTENT-COVERAGE.md`。修改其输入，避免直接编辑生成物。
- 保持书卷、章节及场景 ID 稳定，依据编辑选择和真实来源组织正文；地图几何与书卷叙事采用各自的数据口径。维护细节见 [阅读与内容组织](docs/READING.md)。
- 每轮完成后运行规定的验证。先执行 `node tools/verify-content.mjs` 和 `node build.mjs`，涉及交互时运行适用的 UI、移动端和 smoke 回归。仅允许文档或档案变更的阶段在临时副本中验证，保持生成物在工作区的原样。区分浏览器模拟、真机、结构检查和内容审校，如实记录失败、未执行项及原因。
- 涉及地球首页或选年时，运行 `node tools/verify-home.js`，核对地图生效年、选择范围、史事统计和视口适配。阶段实拍保存在对应的 `docs/progress/phase-NN/`。
- 涉及阅读时，运行 `node tools/verify-reading.js`，验证正文位置、旧会话、字号、引用、主动观察及全屏隔离，并保留全量断网正文回归。
- 历史内容按 [历史内容模型](docs/HISTORY-MODEL.md) 维护。正文块、来源和场景关系使用显式稳定 ID，地图入口在 `data/history/map-bindings.json` 编目，史料核查独立记录。内容结构变更运行 `node tools/verify-history-model.mjs`，触及兼容层时再用 Phase 04 构建运行 `node tools/verify-history-browser.js`。
- 维护历史现场、地名和全球关系时遵循 [历史现场规范](docs/HISTORICAL-SCENES.md) 与 [阅读组织](docs/READING.md)。场景的线、方向和具体位置按证据开放。运行 `node tools/verify-observation-model.mjs` 与 `node tools/verify-observation.js`，并在阶段报告记录实际核查范围。
- 实质审校遵循 [历史编辑规范](docs/EDITORIAL-STANDARD.md)。按稳定 ID 记录来源访问、实际读到的段落、支持的论断、限制与处置。每批用 Phase 06 归档重算清单，保留未审对象和历史证据。[审校进度](docs/progress/PHASE-07.md)
- 暂存期间如修改历史内容，按稳定 ID 登记改动前后、受影响论断和待复核范围。旧证据按原版本及审校范围保留，修订后的论断经复核才可计入当前审校结果。同一存量对象只计一次。[审校维护](docs/SOURCE-AUDIT.md#暂存期间的内容变更)
- 功能、交互、修复、图标与内容覆盖变化须核对并更新 README 和受影响的现行文档。按 [版本规范](docs/VERSIONING.md) 记录阶段变化和正式更新，自动生成产物的单独提交无需重复记录。

## 开发分支与网站发布

- 使用个人 GitHub 身份 `lllliam`，仓库级姓名 `lllliam`、邮箱 `lllliam@users.noreply.github.com`。提交前核对 author/committer，推送前核对认证账号。维护公司全局配置原样。
- 阶段成果统一保存在 `develop/1.0`。每阶段通过验收后，审查 diff、运行构建和回归、更新 README 和 [阶段报告](docs/progress/)，建立本地 Git 提交。经授权暂存的审校批次也可提交检查点，阶段状态以报告为准。远程连接正常时推荐推送至 `origin/develop/1.0` 并核对远端 commit。推送失败时保留本地提交并如实记录。远端推送与独立克隆属于可选同步验证。保留他人改动，禁止强制推送及重写历史。
- 提交仅纳入阶段工程成果、必要构建产物和证据。排除凭据、个人文件、浏览器配置、临时测试产物和无关修改。
- `main` 保持稳定线上版本。包括完整历史内容验收在内的最终验收通过并获正式发布授权后，按 [版本规范](docs/VERSIONING.md) 合并和发布。等待 Pages 部署完成后核对在线与离线入口。[仓库](https://github.com/lllliam/spacetime-globe) · [网站](https://lllliam.github.io/spacetime-globe/)
