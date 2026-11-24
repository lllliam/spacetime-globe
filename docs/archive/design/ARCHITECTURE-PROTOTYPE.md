# 内部架构

> **已归档，供历史参考。** 原型架构说明的原文快照，保存当时对会话、场景和部署的描述。
> 原始文件 [`docs/ARCHITECTURE.md`](https://github.com/lllliam/spacetime-globe/blob/cfac7462bcd232d50baecd795962c8cd74af2597/docs/ARCHITECTURE.md)。

Spacetime Globe 是一个静态网页应用。在线构建从同源资源读取地图包，离线构建将所需资源内嵌到单文件。两种构建共用探索、阅读和观察代码。

| 模块 | 职责 |
| --- | --- |
| `src/app.js` | 地球渲染、镜头、疆域拾取、主体半窗与视图设置 |
| `src/year-control.js`、`src/year-discovery.js` | 年份手势、年份入口、事件与书卷关联 |
| `src/subject-reader.js`、`src/reading.js` | 书卷归属、目录与章节、阅读导航、手势和位置恢复 |
| `src/event-map.js` | 正文场景与世界表事件的地图投影、地点角色与返回 |
| `tools/subject-books.mjs`、`tools/historical-scenes.mjs` | 校验书卷、疆域绑定、场景数据以及段落引用，生成浏览器读取的结构 |

## 地图与内容如何连接

历史疆域由 Cliopatria 提供，现代国界由 Natural Earth 提供。当前地球根据年份和视图偏好选择疆域层，地形使用现代地表。疆域分区用于绘制、拾取和选中高亮。历史辖域按主体身份稳定着色，地名由构建时核准的中文名称映射提供。

`data/books/` 以书卷 ID 组织编辑正文。每卷以明确的政权名称绑定底图中的实体，编译后由稳定的实体 ID 匹配。当前单个底图实体只能绑定一个主要书卷。历史主体可能有继承、并立或疆域重叠，编辑可通过延伸阅读和地图重叠说明连接这些主体。将来若要让一个底图实体打开多个独立书卷，需要明确编辑指定的主要入口和可选的关联关系。

年表代表点用于世界表和区域定位。`data/world-reading.json` 和章节的 `eventIds` 维护可验证的读书入口。书卷章节及段落内容由编辑依据史料选定。

## 会话与历史场景

探索维护年份、视图、选中主体及镜头。阅读维护当前书卷、章节、导航路径和滚动位置。观察临时使用场景年份与镜头。正文场景保存阅读上下文，返回时恢复原地球镜头、章节、焦点及正文位置。场景年份固定，操作地球只改变观察视角。

`data/scenes.json` 独立存储场景、观察年份、地点和来源。书卷按段落引用，同一场景可以被多个章节复用。投影层将地点坐标放到球面上，尝试避开年份、底部说明及邻近标签。地区场景可共用这个地球和标注器，间隔很近的地点仍受默认取景、投影和标签面积限制。

## 构建与验证

先用 `node tools/verify-content.mjs` 校验数据，再用 `node build.mjs` 同步在线与离线成品。交互改动运行 `node tools/verify-ui.js` 和 `node tools/smoke.js`。发布由 GitHub Pages 从主分支生成网站，构建产物和源码一并提交。

[现行设计](../../DESIGN.md) · [内容编辑](../../READING.md) · [v2 架构说明](https://github.com/lllliam/spacetime-globe/blob/7a5bbd9/docs/ARCHITECTURE.md)
