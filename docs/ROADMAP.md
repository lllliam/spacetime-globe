# 建设记录与维护路线

Phase 01—09 的阶段性工程建设已收尾。`1.0.0-rc.1` 已公开上线。后续按授权维护公开版本，新的建设阶段由产品负责人另行决定。[上线记录](../CHANGELOG.md) · [版本规范](VERSIONING.md)

| 阶段 | 状态 | 验收与归档 |
| --- | --- | --- |
| Phase 01 | 已验收 | 版本体系、工程基线、产品规范和原型档案。[阶段报告](progress/PHASE-01.md) |
| Phase 02 | 已验收 | Explore、Read、Observe 的状态、导航与持久化底层。[阶段报告](progress/PHASE-02.md) |
| Phase 03 | 已验收 | 地球首页、1500 年历史疆域、年份交互、主体与史事入口。[阶段报告](progress/PHASE-03.md) |
| Phase 04 | 已验收 | 全屏阅读、目录、引用、字号、进度与观察往返。[阶段报告](progress/PHASE-04.md) |
| Phase 05 | 已验收 | 历史内容模型、稳定 ID、地图绑定与旧会话兼容。[阶段报告](progress/PHASE-05.md) |
| Phase 06 | 已验收 | 独立观察、分阶段场景、地理证据及全球关联。[阶段报告](progress/PHASE-06.md) |
| Phase 07 | 已暂存，等待后续继续审校，尚未通过完整阶段验收 | 已实质处置 387／5,576 项，106 项一级候选待审。[暂存及恢复](progress/PHASE-07.md#暂存与恢复) |
| Phase 08 | 产品负责人已验收 | 《明朝》标杆书卷的 20 章、8 个现有场景及独立审校台账。[阶段报告](progress/PHASE-08.md) |
| Phase 09 | 工程验收通过，工程候选已上线 | 工程、浏览器兼容和离线验证留档，人工体验、iPhone 真机、原生辅助技术、硬件性能与完整内容验收待续。[阶段报告](progress/PHASE-09.md) · [验收矩阵](progress/phase-09/matrix.md) |

2026-11-25，产品负责人授权暂存 Phase 07，并允许 Phase 08、09 的工作独立进行。同日授权 `1.0.0-rc.1` 公开上线。完整历史内容验收仍是正式 `1.0.0` 的条件。[正式验收标准](ACCEPTANCE.md)

## 长期维护

两条维护线共用同一仓库。公开产品在 `main` 维护，`develop/1.0` 保留为阶段建设记录。

- **产品与工程**。处理实际使用反馈、缺陷、交互和视觉细节、性能、设备兼容及 PWA 离线能力。功能改进由产品负责人确认。人工与设备待验收按 [真机和人工清单](progress/phase-09/device-checklist.md) 追踪。
- **历史与内容**。Historical World 已获授权续接 Phase 07，先合账，再处理重大风险、深化完整书卷和补足全球覆盖。以 `codex/ios-native` 的权威内容库为现行基线。[建设规范](HISTORICAL-WORLD.md) · [检查点](progress/HISTORICAL-WORLD.md)
