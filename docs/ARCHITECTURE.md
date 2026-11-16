# 内部架构 · v2

> 这份文档说「里面怎么搭」。产品意图见 [DESIGN.md](DESIGN.md)；这份说数据怎么流、图层怎么长、状态放哪。

## 一句话

**球是空间索引，时间轴是时间索引，两者交叉出一个切片；切片里挂着实体，实体之间用关系连成图。所有界面都是这张图的投影，共享同一个会话状态。**

## 四层

```
数据层    world.json  （地区 + 1512 条年表 + 177 块现代国界 + 中文地名）
          polity.bin  （1604 个政权 / 13797 个时间切片 / 10882 条路径）
          relief.jpg  （地形浮雕）
             ↓  全部静态、可版本化、可离线
索引层    partition(year, layer) → { shapes[], pick(Uint8Array), counts, lut }
             ↓  纯前端，无后端
投影层    球（WebGL 贴图）/ 时间轴（canvas）/ 档案抽屉 / 全景列表
             ↓  共享 session
交互层    手势、四个导航状态
```

## 会话状态

只有三个值，所有投影读同一份：

```ts
state = {
  year: number,        // 唯一的时间输入
  layerId: 'country' | 'polity',
  focus: null | { layerId, id },   // 唯一的选择
}
view = { cx, cy, R, Rz, zoom, panX, panY, dpr }   // 相机，只有球读它
```

时间轴改动 `year`，图层开关改 `layerId`，点地球改 `focus`。**没有第二个入口能改这三样**，所以「在故事里跳到 1789，回来球还停在 1789」是架构自带的，不需要同步逻辑。

## 图层抽象（整个设计的地基）

图层不是一堆 if，是一个纯函数：

```ts
Layer = {
  id, name, range,
  currentYear(y) → number,          // 超出数据范围时怎么夹（政权层夹到 2024）
  shapes(year) → Shape[],           // [{id, path|pathId, area, ent|iso}]
  entityOfShape(shape) → Entity,
}
```

`Shape` 只要求能画出来。国家层给 SVG 字符串缓存的 `Path2D`，政权层给二进制解出来的 `Path2D`——**上层不知道区别**。

于是下面这些东西对两个图层是同一份代码：

| 能力 | 实现 | 代码位置 |
| --- | --- | --- |
| 栅格化 | 按 bbox 从大到小填进 2048×1024 的 id 画布（R=id, G=覆盖率, B=边界） | `rasterize()` |
| 拾取 | 1000×500 地图坐标 → 1024×512 栅格 → 3×3 多数表决 | `mapPointAt()` / `pickAt()` |
| 着色 | 抽样年表代表点 → 每 id 的"当年记录数" → 256×1 的 LUT 纹理 | `countEntries()` / `buildLut()` |
| 去噪 | 两个 id 交界处混色会算出第三个 id，1px 杂点用四邻多数擦掉 | `despeckle()` |
| 邻居 | 同一张 pick 栅格上做 4 邻接统计 + 面积阈值 | `neighboursOf()` |
| 实体档案 | 统一模板（抬头 / 事实 / 条目） | `renderSheet()` |

**加第三个图层（文化圈、宗教、语言）只需要实现 `shapes()` 和 `entityOfShape()`，别的都不用动。**

## 三个渲染缓冲

| 缓冲 | 尺寸 | 用途 | 更新时机 |
| --- | --- | --- | --- |
| `idCanvas` | 2048×1024 | 喂给 WebGL 的 id 纹理：R 通道查 LUT 上色，B 通道画边界 | 换年 / 换图层 |
| `pickCanvas` | 1024×512 | 从 idCanvas 无插值缩下来，读成 `Uint8Array` 供拾取 | 同上 |
| `probeCanvas` | 1024×512 | 档案页里"政权→今天的国家"用的临时遮罩，不影响主缓冲 | 打开档案 |

拾取精度 1024×512 ≈ 0.35°，比手指精度细两个数量级，够用；id 图保持 2048 是为了贴图清晰。

## 数据格式

### `data/polity.bin`（gzip 后 1.06 MB）

```
SGP1
u32 entityCount · sliceCount · pathCount
u32 entityOff · sliceOff · pathIndexOff · pathDataOff

实体表    [u16 名长, UTF-8 名, i16 起, i16 止] × N
切片表    [u16 实体号, i16 起, i16 止, u16 路径号] × N     ← 一个实体有多个切片（帝国每年一份）
路径索引  u32 × (N+1)                                      ← 随机访问
路径数据  [u16 子路径数, 每段: u16 点数, u16 x0,y0, (zigzag varint dx,dy)…]
```

- 坐标量化到 1/4 像素（0..4000），相邻点做 delta + zigzag varint
- 相同路径按字符串去重（13,797 个切片 → 10,882 条唯一路径）
- 单年只需要解 88–192 条路径，Path2D 有 900 条 LRU 缓存

### `data/world.json`（gzip 后约 140 KB）

`regions`（105 个）+ `entries`（1512 条，带 `px/py` 代表点）+ `map`（177 块国界）+ `isoNames`（177 个中文地名）。

条目代表点 = 所属地区现代国界的多边形质心，88% 的条目有；没有的（宗教、大洲等分组）只进列表，不进空间查询。

## 内容从哪来（政权页为什么有东西看）

政权层没有一句现成文本，档案页的每一行都是算出来的：

| 档案行 | 算法 |
| --- | --- |
| 存续 | 该实体所有切片的 min(起) / max(止) |
| 今天的疆域主要在 X·Y | 把该政权的多边形栅格化成遮罩，数遮罩下每个现代国家 id 的像素，取前四 |
| 同期邻居 | 当前年份 pick 栅格上与该 id 相邻的其他 id，按共享像素数排序，面积占比 <1% 的丢弃 |
| 当年条目 | 条目代表点落在该政权当年疆域内 ∧ 时间区间与存续期相交；同名的合并（"奥斯曼统治"×4 → 1 条） |

索引只在打开档案时算（几毫秒），不进入渲染循环。

## 渲染

- 球体：192×96 网格 + 正交投影，片元着色器做昼夜光照、边缘大气、id→LUT 上色、边界描边
- 贴图：2048×1024 静态地表（海底渐变、大陆架、浮雕、经纬网、极冠）+ 动态 id 图 + 256×1 的 LUT
- 无 WebGL 时退回 Canvas2D：同一套投影反解逐像素采样，分辨率降到 520 以内
- 空闲即停：自转 20 秒后 rAF 归零，任何交互唤醒

## 构建

```
data/atlas.json?        不在仓库里，来自网页版的原料
  tools/build-data.js   → data/world.json + data/polity.bin(.gz)
src/{shell.html,app.css,app.js}
  build.mjs             → index.html（数据外置，69 KB）
                        → index.offline.html（全内嵌，2.1 MB，双击可开）
```

`build.mjs` 会校验数据（地区引用、起止年、路径头），坏数据直接构建失败。

## 已知欠账

- 政权名只有英文：目录里有 1,604 个，中文名要靠 Wikidata 补（`tools/enrich-pilot.js` 已验证链路，被 API 限流卡住，需要断点续跑）
- 条目代表点用国界质心，边境地区的关联会有偏差
- 图层切换时没有交叉淡入（现在是直接换）
- 第三图层（文化圈/宗教）只有接口，没有数据
