/* ═══════════════════════════════════════════════════════════════
   时空地球 · Spacetime Globe
   架构：球是空间索引，年份是时间索引，两者交叉出「此刻此地」的切片；
        切片里挂着实体（国家 / 政权），实体之间用关系连成图。
        所有界面都是这张图的投影，共享同一个会话状态 {year, layer, focus}。
   ═══════════════════════════════════════════════════════════════ */
(() => {
'use strict';

/* ───────────── 0. 基础 ───────────── */
const TAU = Math.PI * 2;
const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);
const lerp = (a, b, t) => a + (b - a) * t;

const THIS_YEAR = new Date().getFullYear();
const YMAX = THIS_YEAR;
const YMIN = -3500;
const DEFAULT_EXPLORE_YEAR = 1500;
const HOME_CAMERA = { yaw:-1.65, tilt:.42, zoom:1, panX:0, panY:0 };
const historyMapSources = JSON.parse(document.getElementById('history-map-sources').textContent);
const {from:POLITY_START,to:POLITY_END} = historyMapSources.polity.coverage;
const hasHistoricalCoverage = year => year >= POLITY_START && year <= POLITY_END;

const ord = (y) => (y < 0 ? y + 1 : y);
const MONTHS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const tOf = (y, m, d) => ord(y) + (m ? (MONTHS[m - 1] + (d || 1) - 1) / 365.25 : 0);
const fmtYear = (y) => (y < 0 ? '前' + (-y) : String(y));
const yearLabel = year => (year < 0 ? '公元前 ' + -year : year) + ' 年';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ───────────── 1. 素材装载 ───────────── */
const TW = 2048, TH = 1024;            // 贴图 / id 图分辨率
const PW = 1024, PH = 512;             // 拾取栅格
const DETAIL_WIDTH = 4096, DETAIL_ZOOM = 1.0;
const TERRAIN_WIDTH = 4096, TERRAIN_ZOOM = 1.45;
const MAPW = 1000, MAPH = 500;
const Q = 4;                           // 政权几何的量化倍数

const el = (id) => document.getElementById(id);
const canvas = el('globe');
const fallbackCanvas = el('globe-fallback');
const elYear = el('year');
const sheetEl = el('sheet'), sheetInner = el('sheet-inner');
const overlay = el('overlay');
const overlayTitle = el('overlay-title'), overlaySub = el('overlay-sub'), overlayBody = el('overlay-body');
const bootEl = el('boot');

const inlineText = (id) => { const n = el(id); return n ? n.textContent.trim() : ''; };
const polityNames = new Map(JSON.parse(inlineText('polity-names') || '[]'));
const polityRelations = new Map(JSON.parse(inlineText('polity-relations') || '[]'));
const isDisplayPolity = (ent) => Boolean(ent && !polityRelations.has(ent.name));
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const globeThemeColor = themeColorMeta.content;
const paperThemeColor = getComputedStyle(document.documentElement).getPropertyValue('--paper-bg').trim();
const standaloneGlobe = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
function syncTopChrome() {
  const paperScreen = reading.active || !overlay.hidden;
  const safeTop = view.safeTop || 0;
  // In standalone PWA (black-translucent) or whenever a top safe-area inset is present,
  // keep theme-color fixed at deep cosmos (#0a1016) so iOS never tints the translucent status bar beige/gray.
  // Only in normal Safari with zero top inset (browser chrome outside viewport) tint Safari's bar to match paper.
  const theme = !standaloneGlobe && safeTop === 0 && paperScreen ? paperThemeColor : globeThemeColor;
  if (themeColorMeta.content !== theme) themeColorMeta.content = theme;

  // Keep bottom extension outside body's --app-height clip independent from html's top #0a1016 background.
  const rootClasses = document.documentElement.classList;
  const sheetOpen = document.body.classList.contains('sheet-open');
  const observePanelOpen = !reading.active && session.mode === 'Observe' && !eventMapPanel.hidden;
  const bottomPaper = !observePanelOpen && (reading.active || !overlay.hidden || sheetOpen);
  rootClasses.toggle('bottom-paper', bottomPaper);
  rootClasses.toggle('bottom-observe-panel', observePanelOpen);
}
const buildAssets = JSON.parse(inlineText('build-assets'));
const assetURL = path => buildAssets.runtime?.[path]?.url || path;
const fetchRuntimeAsset = path => fetch(assetURL(path), {integrity:buildAssets.runtime?.[path]?.integrity || ''});

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function gunzip(buf) {
  if (typeof DecompressionStream === 'undefined') return null;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}
async function fetchBinary(url) {
  const res = await fetchRuntimeAsset(url);
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  return res.arrayBuffer();
}

/* 世界数据：地区 + 年表 + 现代国界 */
async function loadWorld() {
  const inline = inlineText('atlas');
  if (inline.length > 100) return JSON.parse(inline);
  const res = await fetchRuntimeAsset('data/world.json');
  if (!res.ok) throw new Error('data/world.json 读取失败');
  return res.json();
}

/* 政权包：自解释二进制 SGP1 */
function parsePolityBin(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SGP1') throw new Error('政权包格式不对: ' + magic);
  const nEnt = dv.getUint32(4, true), nSlice = dv.getUint32(8, true), nPath = dv.getUint32(12, true);
  const entOff = dv.getUint32(16, true), sliceOff = dv.getUint32(20, true);
  const pathIdxOff = dv.getUint32(24, true);
  const dec = new TextDecoder();
  const entities = new Array(nEnt);
  let o = entOff;
  for (let i = 0; i < nEnt; i++) {
    const len = dv.getUint16(o, true); o += 2;
    const name = dec.decode(new Uint8Array(buf, o, len)); o += len;
    const from = dv.getInt16(o, true); o += 2;
    const to = dv.getInt16(o, true); o += 2;
    entities[i] = { id: i, name, from, to };
  }
  const slices = new Int32Array(nSlice * 4);
  o = sliceOff;
  for (let i = 0; i < nSlice; i++) {
    slices[i * 4] = dv.getUint16(o, true);
    slices[i * 4 + 1] = dv.getInt16(o + 2, true);
    slices[i * 4 + 2] = dv.getInt16(o + 4, true);
    slices[i * 4 + 3] = dv.getUint16(o + 6, true);
    o += 8;
  }
  const pathIdx = new Uint32Array(nPath + 1);
  for (let i = 0; i <= nPath; i++) pathIdx[i] = dv.getUint32(pathIdxOff + i * 4, true);
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return { bytes, dv, entities, slices, nSlice, pathIdx, nPath, cache: new Map() };
}

/* 解码一条路径 → Path2D + bbox（带 LRU 缓存，一帧只要几十条） */
function polityShape(pk, pathId) {
  let hit = pk.cache.get(pathId);
  if (hit) { pk.cache.delete(pathId); pk.cache.set(pathId, hit); return hit; }
  const bytes = pk.bytes, dv = pk.dv;
  let o = pk.pathIdx[pathId];
  const subCount = dv.getUint16(o, true); o += 2;
  const p = new Path2D();
  const rings = [];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let s = 0; s < subCount; s++) {
    const n = dv.getUint16(o, true); o += 2;
    let x = dv.getUint16(o, true); o += 2;
    let y = dv.getUint16(o, true); o += 2;
    p.moveTo(x / Q, y / Q);
    const ring = [[x / Q, y / Q]];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (let k = 1; k < n; k++) {
      let v = 0, sh = 0, b;
      do { b = bytes[o++]; v |= (b & 127) << sh; sh += 7; } while (b & 128);
      x += v & 1 ? ~(v >> 1) : (v >> 1);
      v = 0; sh = 0;
      do { b = bytes[o++]; v |= (b & 127) << sh; sh += 7; } while (b & 128);
      y += v & 1 ? ~(v >> 1) : (v >> 1);
      p.lineTo(x / Q, y / Q);
      ring.push([x / Q, y / Q]);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    p.closePath();
    rings.push(ring);
  }
  const shape = { path: p, rings, area: ((x1 - x0) / Q) * ((y1 - y0) / Q) };
  if (pk.cache.size > 900) pk.cache.delete(pk.cache.keys().next().value);
  pk.cache.set(pathId, shape);
  return shape;
}

/* ───────────── 2. 世界索引 ───────────── */
let world = null, regions = [], regionById = new Map(), regionByIso = new Map(), entries = [], canonicalEntries = [], mapShapes = [];
let entryByRegion = new Map(), canonicalEventById = new Map();
const rawEventGroups = JSON.parse(inlineText('history-event-groups') || '[]');
let pk = null;                          // 政权包
let polityState = { loading: false, loaded: false, error: null };

function initWorld(w) {
  world = w;
  regions = w.regions;
  // 地图有轮廓但旧年表未单列的区域，也能打开档案并进入已编写的地区专题。
  const knownIsos = new Set(regions.map((r) => r.iso));
  for (const [iso] of w.map) {
    if (!/^[A-Z]{2}$/.test(iso) || knownIsos.has(iso)) continue;
    regions.push({id:'g-map-' + iso, iso, zh:w.isoNames[iso], parent:'g-world'});
    knownIsos.add(iso);
  }
  regionById = new Map(regions.map((r) => [r.id, r]));
  regionByIso = new Map(regions.filter((r) => r.iso).map((r) => [r.iso, r]));
  entries = w.entries.map((e) => {
    const t0 = tOf(e.start, e.sm, e.sd);
    let t1 = e.point ? t0 : tOf(e.end, e.em, e.ed);
    if (!(t1 >= t0)) t1 = t0;
    return { ...e, t0, t1 };
  });
  const rawById = new Map(entries.map((e) => [e.id, e]));
  const groupedMemberIds = new Set();
  canonicalEntries = [];
  canonicalEventById = new Map();
  for (const [, canonicalId, memberIds, displayTitle] of rawEventGroups) {
    const members = memberIds.map((id) => rawById.get(id)).filter(Boolean);
    if (!members.length) continue;
    const base = rawById.get(canonicalId) || members[0];
    const pointSource = members.find((m) => m.px != null && m.py != null);
    const canonical = {
      ...base,
      ...(displayTitle ? { zh: displayTitle } : {}),
      memberIds: members.map((m) => m.id),
      regions: [...new Set(members.map((m) => m.region).filter(Boolean))],
      sources: [...new Set(members.map((m) => m.source).filter(Boolean))],
      ...(pointSource ? { px: pointSource.px, py: pointSource.py } : {}),
    };
    canonicalEntries.push(canonical);
    for (const m of members) {
      groupedMemberIds.add(m.id);
      canonicalEventById.set(m.id, canonical);
    }
  }
  for (const e of entries) {
    if (groupedMemberIds.has(e.id)) continue;
    const canonical = {
      ...e,
      memberIds: [e.id],
      regions: e.region ? [e.region] : [],
      sources: e.source ? [e.source] : [],
    };
    canonicalEntries.push(canonical);
    canonicalEventById.set(e.id, canonical);
  }
  entryByRegion = new Map();
  for (const e of entries) {
    let a = entryByRegion.get(e.region);
    if (!a) entryByRegion.set(e.region, (a = []));
    a.push(e);
  }
  const countryPaths = new Map();
  for (const [iso, path] of w.map) {
    const key = iso === 'TW' ? 'CN' : iso;
    countryPaths.set(key, (countryPaths.get(key) || '') + path);
  }
  mapShapes = [...countryPaths].map(([iso, path], i) => ({ id: i + 1, iso, path, area: 0 }));
  for (const s of mapShapes) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const m of s.path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
      const x = +m[1], y = +m[2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    s.area = (x1 - x0) * (y1 - y0);
    s.p2d = new Path2D(s.path);
  }
}

/* ───────────── 3. 图层 ───────────── */
/* 图层 = f(年) → 一组 {id, 形状, 实体}。渲染、拾取、着色、关系全部只认这一层。 */
const LAYERS = {
  country: {
    id: 'country', name: '国家', range: [YMIN, YMAX],
    currentYear: (y) => y,
    shapes(year) {
      return mapShapes.map((s) => ({ id: s.id, path: s.p2d, area: s.area, iso: s.iso }));
    },
    entityOfShape(s) {
      const r = regionByIso.get(s.iso);
      return r ? { kind: 'country', region: r } : null;
    },
  },
  polity: {
    id: 'polity', name: '政权', range: [POLITY_START, POLITY_END],
    currentYear: (y) => y,
    shapes(year) {
      if (!pk || !hasHistoricalCoverage(year)) return [];
      const y = year;
      const out = [];
      for (let i = 0; i < pk.nSlice; i++) {
        if (pk.slices[i * 4 + 1] > y || pk.slices[i * 4 + 2] < y) continue;
        const ent = pk.entities[pk.slices[i * 4]];
        if (!isDisplayPolity(ent)) continue;
        out.push({ id: out.length + 1, ent, pathId: pk.slices[i * 4 + 3] });
      }
      /* 小的画在上层：点在帝国里点到小王国的概率更高，也符合“实际统治层级” */
      out.sort((a, b) => polityShape(pk, b.pathId).area - polityShape(pk, a.pathId).area);
      out.forEach((s, i) => { s.id = i + 1; });
      return out;
    },
    entityOfShape(s) { return { kind: 'polity', ent: s.ent }; },
  },
};

const state = {
  year: DEFAULT_EXPLORE_YEAR,
  layerId: 'polity',
  ...HOME_CAMERA,
  focus: null,
  lift: 0,
};

const view = { w: 1, h: 1, cx: 0, cy: 0, R: 1, dpr: 1, Rz: 1, safeTop: 0, safeBottom: 0 };

/* ───────────── 4. 分区（栅格化 + 拾取 + 着色表） ───────────── */
const idCanvas = document.createElement('canvas');
idCanvas.width = TW; idCanvas.height = TH;
const idCtx = idCanvas.getContext('2d', { willReadFrequently: true });
const pickCanvas = document.createElement('canvas');
pickCanvas.width = PW; pickCanvas.height = PH;
const pickCtx = pickCanvas.getContext('2d', { willReadFrequently: true });

let partition = { layerId: 'country', year: YMAX, shapes: [], pick: new Uint8Array(PW * PH), counts: new Map(), lut: new Uint8Array(256 * 4) };
let summary = { ev: 0, era: 0, countries: 0, entities: 0 };

function rasterize(layer, year) {
  const shapes = layer.shapes(year);
  idCtx.setTransform(1, 0, 0, 1, 0, 0);
  idCtx.globalCompositeOperation = 'source-over';
  idCtx.fillStyle = '#000';
  idCtx.fillRect(0, 0, TW, TH);
  idCtx.setTransform(TW / MAPW, 0, 0, TH / MAPH, 0, 0);
  idCtx.lineJoin = 'round';
  for (const s of shapes) {
    const p = layer.id === 'polity' ? polityShape(pk, s.pathId).path : s.path;
    idCtx.fillStyle = 'rgb(' + s.id + ',255,0)';
    idCtx.fill(p, 'evenodd');
  }
  /* 边界只写进 B 通道（lighter 叠加不破坏 R/G 的 id 编码） */
  idCtx.globalCompositeOperation = 'lighter';
  idCtx.strokeStyle = 'rgb(0,0,255)';
  idCtx.lineWidth = 0.95;
  for (const s of shapes) {
    const p = layer.id === 'polity' ? polityShape(pk, s.pathId).path : s.path;
    idCtx.stroke(p);
  }
  idCtx.globalCompositeOperation = 'source-over';

  /* 拾取栅格 */
  pickCtx.setTransform(1, 0, 0, 1, 0, 0);
  pickCtx.imageSmoothingEnabled = false;
  pickCtx.clearRect(0, 0, PW, PH);
  pickCtx.drawImage(idCanvas, 0, 0, PW, PH);
  const px = pickCtx.getImageData(0, 0, PW, PH).data;
  const pick = new Uint8Array(PW * PH);
  for (let i = 0, p = 0; i < pick.length; i++, p += 4) {
    const cover = px[p + 1];
    if (cover > 100) pick[i] = Math.round((px[p] * 255) / cover);
  }
  despeckle(pick);
  return { shapes, pick };
}

/* 边界上两个 id 混色会算出第三个 id（既点错也连出假邻居），这里把 1px 的杂点擦掉 */
function despeckle(pick) {
  const out = pick;
  const cand = [0, 0, 0, 0];
  for (let y = 1; y < PH - 1; y++) {
    const row = y * PW;
    for (let x = 1; x < PW - 1; x++) {
      const i = row + x, v = pick[i];
      cand[0] = pick[i - 1]; cand[1] = pick[i + 1];
      cand[2] = pick[i - PW]; cand[3] = pick[i + PW];
      if (cand[0] === v || cand[1] === v || cand[2] === v || cand[3] === v) continue;
      let best = 0, bestN = 0;
      for (let k = 0; k < 4; k++) {
        const c = cand[k];
        if (!c) continue;
        let cnt = 0;
        for (let j = 0; j < 4; j++) if (cand[j] === c) cnt++;
        if (cnt > bestN) { bestN = cnt; best = c; }
      }
      if (bestN >= 3) out[i] = best;
    }
  }
}

/* 条目代表点落在哪个 id 上 → 每个 id 的“记录数” */
function countEntries(pick) {
  const counts = new Map();
  for (const e of entries) {
    if (e.px === undefined) continue;
    if (e.t1 < ord(state.year) - 400 || e.t0 > ord(state.year)) continue; // 粗过滤，正式判定在档案页
    const x = Math.min(PW - 1, Math.max(0, (e.px / MAPW * PW) | 0));
    const y = Math.min(PH - 1, Math.max(0, (e.py / MAPH * PH) | 0));
    const id = pick[y * PW + x];
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function buildLut(layer, shapes) {
  const lut = new Uint8Array(256 * 4);
  if (chrome.natural) return lut;
  for (const s of shapes) {
    const o = s.id * 4;
    // 用实体名称决定颜色，跨年份保持稳定；颜色用于区分辖域，不代表史料数量。
    const key = layer.id === 'polity' ? s.ent.name : s.iso;
    let hash=0; for(const c of key||'')hash=(hash*31+c.charCodeAt(0))>>>0;
    const palette=[[183,154,104],[133,159,154],[158,141,126],[126,145,164],[164,157,118],[158,126,117]];
    const color=key==='Qing Dynasty' ? palette[0] : palette[hash%palette.length];
    lut[o]=color[0];lut[o+1]=color[1];lut[o+2]=color[2];lut[o+3]=layer.id==='polity'?185:100;
  }
  return lut;
}

function rebuildPartition() {
  const layer = LAYERS[state.layerId];
  const year = layer.currentYear(state.year);
  const t0 = performance.now();
  const { shapes, pick } = rasterize(layer, year);
  const counts = countEntries(pick);
  const lut = buildLut(layer, shapes);
  partition = { layerId: layer.id, year, shapes, pick, counts, lut };
  prepareVector();
  if (glr) { glr.uploadId(idCanvas); glr.uploadLut(lut); }
  updateSummary();
  if (state.focus && state.focus.layerId !== layer.id) state.focus = null;
  reanchorFocus();
  return performance.now() - t0;
}

function updateSummary() {
  const { events, background } = yearEventGroups(state.year);
  summary = { ev:events.length, era:background.length,
    countries:new Set([...events, ...background].map(event => event.region)).size, entities:partition.shapes.length };
}

/* ───────────── 5. 材质 ───────────── */
let baseCanvas = null, earthImg = null, cloudsImg = null, reliefImg = null;
let glr = null, renderGeneration = 0;

function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function buildBaseCanvas() {
  const c = newCanvas(TW, TH);
  const g = c.getContext('2d');
  const sea = g.createLinearGradient(0, 0, 0, TH);
  sea.addColorStop(0.00, '#08161f');
  sea.addColorStop(0.22, '#123047');
  sea.addColorStop(0.50, '#193b50');
  sea.addColorStop(0.78, '#123047');
  sea.addColorStop(1.00, '#08161f');
  g.fillStyle = sea; g.fillRect(0, 0, TW, TH);

  const paths = mapShapes.map((s) => s.p2d);
  g.setTransform(TW / MAPW, 0, 0, TH / MAPH, 0, 0);
  g.lineJoin = 'round'; g.lineCap = 'round';
  /* 大陆架：柔化后的大范围晕边（软化是因为它会被放大 6 倍看） */
  g.save();
  if ('filter' in g) g.filter = 'blur(7px)';
  g.strokeStyle = 'rgba(104,158,178,.30)'; g.lineWidth = 9;
  for (const p of paths) g.stroke(p);
  g.filter = 'none';
  g.strokeStyle = 'rgba(126,180,196,.19)'; g.lineWidth = 3.4;
  for (const p of paths) g.stroke(p);
  g.restore();

  const landAll = new Path2D();
  for (const p of paths) landAll.addPath(p);
  g.fillStyle = '#7e918a';
  for (const p of paths) g.fill(p, 'evenodd');

  if (reliefImg) {
    g.save();
    g.clip(landAll, 'evenodd');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.62;
    g.drawImage(reliefImg, 0, 0, TW, TH);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.20;
    g.drawImage(reliefImg, 0, 0, TW, TH);
    g.restore();
  }

  g.setTransform(1, 0, 0, 1, 0, 0);

  /* 低频斑驳：电脑版用一个 24px 网格的噪声场给陆地/海面加手感，
     这里用一张小噪声图放大后叠加（双线性插值出来正好是低频斑块） */
  const noise = newCanvas(64, 32);
  const ng = noise.getContext('2d');
  const nd = ng.createImageData(64, 32);
  for (let i = 0; i < nd.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 70;
    nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v;
    nd.data[i + 3] = 255;
  }
  ng.putImageData(nd, 0, 0);
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.06;
  g.imageSmoothingEnabled = true;
  g.drawImage(noise, 0, 0, TW, TH);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  const ice = g.createLinearGradient(0, 0, 0, TH * 0.085);
  ice.addColorStop(0, 'rgba(228,238,246,.62)');
  ice.addColorStop(.55, 'rgba(228,238,246,.18)');
  ice.addColorStop(1, 'rgba(228,238,246,0)');
  g.fillStyle = ice; g.fillRect(0, 0, TW, TH * 0.085);
  const ice2 = g.createLinearGradient(0, TH, 0, TH * 0.915);
  ice2.addColorStop(0, 'rgba(232,240,246,.78)');
  ice2.addColorStop(.55, 'rgba(232,240,246,.22)');
  ice2.addColorStop(1, 'rgba(232,240,246,0)');
  g.fillStyle = ice2; g.fillRect(0, TH * 0.915, TW, TH * 0.085);

  if (earthImg) {
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.drawImage(earthImg, 0, 0, TW, TH);
  }
  baseCanvas = c;
}

/* ───────────── 6. WebGL ───────────── */
const VERT = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform highp mat3 uRot;
uniform vec2 uCenter;
uniform vec2 uViewport;
uniform float uScale;
uniform float uRadius;
varying vec2 vUv;
varying vec3 vN;
void main() {
  vec3 p = (uRot * aPos) * uRadius;
  vec2 screen = uCenter + vec2(p.x, p.y) * uScale;
  // Keep both shells inside the clip volume, with cloud height present in depth as well as position.
  gl_Position = vec4((screen / uViewport) * 2.0 - 1.0, -p.z * 0.5, 1.0);
  vUv = aUv;
  vN = p;
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
varying vec3 vN;
uniform sampler2D uBase;
uniform sampler2D uId;
uniform sampler2D uLut;
uniform sampler2D uTerrain;
uniform float uTerrainMix;
uniform float uZoom;
uniform vec3 uLight;
uniform float uSel;
uniform float uMapLighting;
uniform sampler2D uCloud;
uniform float uCloudOffset;
uniform float uCloudStrength;
uniform highp mat3 uRot;
void main() {
  vec3 n = normalize(vN);
  vec3 base = texture2D(uBase, vUv).rgb;
  vec4 idTex = texture2D(uId, vUv);
  float idx = floor(idTex.r * 255.0 + 0.5);
  vec4 tint = texture2D(uLut, vec2((idx + 0.5) / 256.0, 0.5));
  float ocean = smoothstep(0.02, 0.15, base.b - base.r);

  // Luminance-preserving mineral wash so mountain ridges and basins breathe through polity tints.
  float luma = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 mineral = tint.rgb * mix(0.66, 1.24, smoothstep(0.08, 0.78, luma));
  vec3 col = mix(base, mineral, tint.a * 0.21);
  if (uSel > 0.5 && abs(idx - uSel) < 0.5) {
    col = mix(col, vec3(0.98, 0.87, 0.67), 0.15);
  }

  // The terrain texture stores east/north normal components in RG and land coverage in B.
  float lon = (vUv.x - 0.5) * 6.2831853;
  float lat = (0.5 - vUv.y) * 3.1415927;
  float cosLat = cos(lat);
  float sinLat = sin(lat);
  float sinLon = sin(lon);
  float cosLon = cos(lon);
  vec3 localN = vec3(sinLon * cosLat, sinLat, cosLon * cosLat);
  vec3 shadedN = n;
  if (uTerrainMix > 0.0) {
    vec3 terrain = texture2D(uTerrain, vUv).rgb;
    ocean = mix(ocean, 1.0 - terrain.b, uTerrainMix);
    vec2 xy = (terrain.rg * 255.0 - 128.0) * (0.42 / 127.0);
    vec3 east = vec3(cosLon, 0.0, -sinLon);
    vec3 north = vec3(-sinLat * sinLon, cosLat, -sinLat * cosLon);
    float z = sqrt(1.0 - dot(xy, xy));
    float relief = mix(1.05, 2.55, smoothstep(1.4, 5.0, uZoom)) * uTerrainMix;
    shadedN = normalize(n + uRot * (east * xy.x + north * xy.y) * (relief / z));
  }

  // Work in linear light so the terminator, relief slopes, and ocean satin glint remain smooth.
  col = pow(max(col, vec3(0.0)), vec3(2.2));
  vec3 sun = normalize(uLight);
  float macroLam = dot(n, sun);
  float lam = dot(shadedN, sun);
  float daylight = smoothstep(-0.22, 0.45, macroLam);
  float ambient = mix(0.032, 0.17, uMapLighting);
  float diffuse = max(lam, 0.0) * mix(1.06, 0.80, uMapLighting);
  float shadowFactor = 1.0;
  if (uCloudStrength > 0.005) {
    vec3 localSun = vec3(dot(uRot[0], sun), dot(uRot[1], sun), dot(uRot[2], sun));
    vec3 shadowRay = normalize(localN + localSun * 0.012 / max(macroLam, 0.2));
    vec2 shadowUv = vec2(atan(shadowRay.x, shadowRay.z) / 6.2831853 + 0.5,
      0.5 - asin(clamp(shadowRay.y, -1.0, 1.0)) / 3.1415927);
    float shadow = texture2D(uCloud, vec2(shadowUv.x + uCloudOffset, shadowUv.y)).a;
    shadowFactor = 1.0 - shadow * daylight * 0.24 * uCloudStrength;
  }
  col *= (ambient + 0.11 * daylight + diffuse) * shadowFactor;

  // Dual-lobe satin ocean specular (broad soft sheen + tight sun glint).
  vec3 halfLight = normalize(sun + vec3(0.0, 0.0, 1.0));
  float ndh = max(dot(n, halfLight), 0.0);
  float specTight = pow(ndh, 88.0) * 0.28;
  float specBroad = pow(ndh, 18.0) * 0.085;
  col += vec3(0.62, 0.78, 0.98) * (specTight + specBroad) * ocean * daylight;

  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  float rim = pow(1.0 - max(n.z, 0.0), 3.6);
  col = mix(col, vec3(0.16, 0.44, 0.78), rim * daylight * 0.44);

  gl_FragColor = vec4(col, 1.0);
}`;

const FRAG_CLOUD = `
precision highp float;
varying vec2 vUv;
varying vec3 vN;
uniform sampler2D uCloud;
uniform float uCloudOffset;
uniform float uCloudStrength;
uniform vec3 uLight;
void main() {
  vec3 n = normalize(vN);
  float density = texture2D(uCloud, vec2(vUv.x + uCloudOffset, vUv.y)).a;
  float lam = dot(n, normalize(uLight));
  float light = smoothstep(-0.16, 0.38, lam);
  vec3 color = mix(vec3(0.10, 0.17, 0.27), vec3(0.96, 0.98, 1.0), light);
  color *= 0.6 + 0.4 * max(lam, 0.0);
  float horizon = smoothstep(0.0, 0.10, n.z);
  gl_FragColor = vec4(color, density * 0.88 * horizon * uCloudStrength);
}`;

const VERT_ATM = `
attribute vec2 aPos;
uniform vec2 uCenter;
uniform vec2 uViewport;
uniform float uScale;
varying vec2 vP;
void main() {
  vP = aPos * 1.42;
  vec2 screen = uCenter + vP * uScale;
  gl_Position = vec4((screen / uViewport) * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG_ATM = `
precision highp float;
varying vec2 vP;
uniform vec3 uAtm;
uniform vec3 uLight;
void main() {
  float r = length(vP);
  float a = 0.0;
  if (r > 0.94) {
    float inner = smoothstep(0.985, 1.002, r);
    float t = clamp(1.0 - (r - 1.0) / 0.13, 0.0, 1.0);
    vec3 limb = normalize(vec3(vP, 0.08));
    float sun = smoothstep(-0.25, 0.55, dot(limb, normalize(uLight)));
    a = inner * pow(t, 4.0) * (0.025 + 0.42 * sun);
  }
  gl_FragColor = vec4(uAtm, a);
}`;

function mul3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[c * 3 + r] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

function initGL() {
  const opts = { alpha: true, antialias: true, depth: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
  let gl = null;
  try { gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts); } catch (_) { gl = null; }
  if (!gl) return null;
  const generation = ++renderGeneration;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('shader', gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    const v = shader(gl.VERTEX_SHADER, vs), f = shader(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('link', gl.getProgramInfoLog(p)); return null; }
    return p;
  };
  const prog = program(VERT, FRAG), progAtm = program(VERT_ATM, FRAG_ATM), progCloud = program(VERT, FRAG_CLOUD);
  if (!prog || !progAtm || !progCloud) return null;

  const LON = 192, LAT = 96;
  const verts = new Float32Array((LON + 1) * (LAT + 1) * 5);
  let k = 0;
  for (let j = 0; j <= LAT; j++) {
    const v = j / LAT, lat = (0.5 - v) * Math.PI;
    const cy = Math.sin(lat), cr = Math.cos(lat);
    for (let i = 0; i <= LON; i++) {
      const u = i / LON, lon = (u - 0.5) * TAU;
      verts[k++] = cr * Math.sin(lon); verts[k++] = cy; verts[k++] = cr * Math.cos(lon);
      verts[k++] = u; verts[k++] = v;
    }
  }
  const idx = new Uint16Array(LON * LAT * 6);
  let m = 0;
  for (let j = 0; j < LAT; j++) {
    for (let i = 0; i < LON; i++) {
      const a = j * (LON + 1) + i, b = a + 1, c = a + LON + 1, d = c + 1;
      idx[m++] = a; idx[m++] = c; idx[m++] = b;
      idx[m++] = b; idx[m++] = c; idx[m++] = d;
    }
  }
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos'), aUv = gl.getAttribLocation(prog, 'aUv');
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPosAtm = gl.getAttribLocation(progAtm, 'aPos');

  const U = {
    rot: gl.getUniformLocation(prog, 'uRot'), center: gl.getUniformLocation(prog, 'uCenter'),
    viewport: gl.getUniformLocation(prog, 'uViewport'), scale: gl.getUniformLocation(prog, 'uScale'),
    base: gl.getUniformLocation(prog, 'uBase'), id: gl.getUniformLocation(prog, 'uId'),
    lut: gl.getUniformLocation(prog, 'uLut'), light: gl.getUniformLocation(prog, 'uLight'),
    radius: gl.getUniformLocation(prog, 'uRadius'),
    sel: gl.getUniformLocation(prog, 'uSel'), mapLighting: gl.getUniformLocation(prog, 'uMapLighting'),
    terrain: gl.getUniformLocation(prog, 'uTerrain'), terrainMix: gl.getUniformLocation(prog, 'uTerrainMix'),
    zoom: gl.getUniformLocation(prog, 'uZoom'),
    cloud: gl.getUniformLocation(prog, 'uCloud'), cloudOffset: gl.getUniformLocation(prog, 'uCloudOffset'),
    cloudStrength: gl.getUniformLocation(prog, 'uCloudStrength'),
    atmLight: gl.getUniformLocation(progAtm, 'uLight'),
    atmCenter: gl.getUniformLocation(progAtm, 'uCenter'), atmViewport: gl.getUniformLocation(progAtm, 'uViewport'),
    atmScale: gl.getUniformLocation(progAtm, 'uScale'), atmColor: gl.getUniformLocation(progAtm, 'uAtm'),
  };
  const cloudUniforms = Object.fromEntries(['uRot','uCenter','uViewport','uScale','uRadius','uCloud','uCloudOffset','uCloudStrength','uLight']
    .map(name => [name, gl.getUniformLocation(progCloud, name)]));
  const cloudPos = gl.getAttribLocation(progCloud, 'aPos');
  const cloudUv = gl.getAttribLocation(progCloud, 'aUv');
  const tex = (unit, nearest) => {
    const t = gl.createTexture();
    if (!t) return null;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (nearest) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const tBase = tex(0, false), tId = tex(1, true), tLut = tex(2, true);
  const tCloud = tex(3, false);
  const cloudCanvas = newCanvas(1024, 512);
  if (cloudsImg) cloudCanvas.getContext('2d').drawImage(cloudsImg, 0, 0, 1024, 512);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cloudCanvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const anisotropy = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 1;
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  let detailState = maxTextureSize >= DETAIL_WIDTH ? 'idle' : 'unavailable';
  let terrainState = maxTextureSize >= TERRAIN_WIDTH ? 'idle' : 'unavailable';
  let tDetail = null;
  let tTerrain = null, terrainLoadedAt = 0;

  function uploadSurface(image, texture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, anisotropy);
  }

  function loadSurfaceDetail() {
    detailState = 'loading';
    const image = new Image();
    image.onload = () => {
      if (generation!==renderGeneration) return;
      detailState = 'unavailable';
      if (image.naturalWidth !== DETAIL_WIDTH || image.naturalHeight !== DETAIL_WIDTH / 2) return;
      const detail = tex(0, false);
      if (!detail) return;
      uploadSurface(image, detail);
      // Keep the standard texture bound if the device cannot upload the larger image.
      if (gl.getError() !== gl.NO_ERROR) {
        gl.deleteTexture(detail);
        gl.bindTexture(gl.TEXTURE_2D, tBase);
        return;
      }
      tDetail = detail;
      detailState = 'ready';
      invalidate();
    };
    image.onerror = () => { detailState = state.zoom < DETAIL_ZOOM ? 'idle' : 'retry'; };
    const inline = inlineText('earth-detail').trim();
    image.src = inline ? 'data:image/jpeg;base64,' + inline : assetURL('data/earth-detail.jpg');
  }

  function loadTerrain() {
    terrainState = 'loading';
    const image = new Image();
    image.onload = () => {
      if (generation!==renderGeneration) return;
      terrainState = 'unavailable';
      if (image.naturalWidth !== TERRAIN_WIDTH || image.naturalHeight !== TERRAIN_WIDTH / 2) return;
      const texture = tex(4, false);
      if (!texture) return;
      // The PNG channels are data. Browser color conversions would alter neutral slopes.
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (gl.getError() !== gl.NO_ERROR) {
        gl.deleteTexture(texture);
        return;
      }
      tTerrain = texture;
      terrainState = 'ready';
      terrainLoadedAt = performance.now();
      invalidate();
    };
    image.onerror = () => { terrainState = state.zoom < TERRAIN_ZOOM ? 'idle' : 'retry'; };
    const inline = inlineText('terrain').trim();
    image.src = inline ? 'data:image/png;base64,' + inline : assetURL('data/terrain-4k-v1.png');
  }

  return {
    kind: 'webgl',
    uploadBase(cv) { uploadSurface(cv, tBase); },
    uploadId(cv) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tId);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    },
    uploadLut(arr) {
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tLut);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, arr);
    },
    resize(w, h, dpr) {
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    },
    preloadDetail() {
      if (detailState === 'idle') loadSurfaceDetail();
    },
    draw(v, st) {
      if (st.zoom >= DETAIL_ZOOM && detailState === 'idle') loadSurfaceDetail();
      if (st.zoom < DETAIL_ZOOM && detailState === 'retry') detailState = 'idle';
      if (st.zoom >= TERRAIN_ZOOM && terrainState === 'idle') loadTerrain();
      if (st.zoom < TERRAIN_ZOOM && terrainState === 'retry') terrainState = 'idle';
      const arrival = reducedGlobeMotion.matches ? 1 : clamp((performance.now() - terrainLoadedAt) / 240, 0, 1);
      const terrainMix = tTerrain ? arrival * clamp((st.zoom - TERRAIN_ZOOM) / 0.55, 0, 1) : 0;
      if (tTerrain && arrival < 1 && st.zoom > TERRAIN_ZOOM) dirty = true;
      const W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      const ct = Math.cos(st.tilt), stt = Math.sin(st.tilt);
      const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
      const Rx = [1, 0, 0, 0, ct, -stt, 0, stt, ct];
      const rot = new Float32Array(mul3(Rx, Ry));
      /* 平移必须和矢量叠加层一致，否则缩放后两层会错位 */
      const center = [(v.cx + st.panX) * v.dpr, (v.h - v.cy - st.panY) * v.dpr];
      const scale = v.Rz * v.dpr;
      const zoomFade = clamp(1 - (st.zoom - 1.2) / 1.35, 0, 1);
      const cloudStrength = chrome.natural ? 0.92 * lerp(0.25, 1.0, zoomFade) : 0.34 * zoomFade * zoomFade;

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 20, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.uniformMatrix3fv(U.rot, false, rot);
      gl.uniform2f(U.center, center[0], center[1]);
      gl.uniform2f(U.viewport, W, H);
      gl.uniform1f(U.scale, scale);
      gl.uniform1f(U.radius, 1);
      gl.uniform3f(U.light, -0.52, 0.44, 0.73);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tDetail || tBase);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tCloud);
      if (tTerrain) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, tTerrain); }
      gl.uniform1i(U.terrain, tTerrain ? 4 : 0);
      gl.uniform1f(U.terrainMix, terrainMix);
      gl.uniform1f(U.zoom, st.zoom);
      gl.uniform1i(U.cloud, 3);
      gl.uniform1f(U.cloudOffset, cloudDrift);
      gl.uniform1f(U.cloudStrength, cloudStrength);
      gl.uniform1f(U.mapLighting, chrome.natural ? 0 : 1);
      gl.uniform1f(U.sel, chrome.natural ? 0 : (st.focus?.id ?? 0));
      gl.uniform1i(U.base, 0); gl.uniform1i(U.id, 1); gl.uniform1i(U.lut, 2);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clearDepth(1);
      gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      // Raised cloud shell fades cleanly away when zooming in to inspect terrain and borders.
      if (cloudStrength > 0.005) {
        gl.useProgram(progCloud);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(cloudPos);
        gl.vertexAttribPointer(cloudPos, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(cloudUv);
        gl.vertexAttribPointer(cloudUv, 2, gl.FLOAT, false, 20, 12);
        gl.uniformMatrix3fv(cloudUniforms.uRot, false, rot);
        gl.uniform2f(cloudUniforms.uCenter, center[0], center[1]);
        gl.uniform2f(cloudUniforms.uViewport, W, H);
        gl.uniform1f(cloudUniforms.uScale, scale);
        gl.uniform1f(cloudUniforms.uRadius, 1.007);
        gl.uniform1i(cloudUniforms.uCloud, 3);
        gl.uniform1f(cloudUniforms.uCloudOffset, cloudDrift);
        gl.uniform1f(cloudUniforms.uCloudStrength, cloudStrength);
        gl.uniform3f(cloudUniforms.uLight, -0.52, 0.44, 0.73);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
        gl.depthMask(true);
      }
      gl.disable(gl.DEPTH_TEST);

      gl.useProgram(progAtm);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(aPosAtm);
      gl.vertexAttribPointer(aPosAtm, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(U.atmCenter, center[0], center[1]);
      gl.uniform2f(U.atmViewport, W, H);
      gl.uniform1f(U.atmScale, scale);
      gl.uniform3f(U.atmLight, -0.52, 0.44, 0.73);
      gl.uniform3f(U.atmColor, 0.36, 0.54, 0.76);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    },
  };
}

/* ───────────── 6.5 矢量叠加层：边线、经纬网、地名 ─────────────
   位图贴图放大必然糊，所以「线」和「字」不走贴图：
   把路径投影到屏幕后按设备分辨率直接用 2D canvas 画，任何缩放都是锐的。 */
const vecCanvas = el('vec');
const vctx = vecCanvas.getContext('2d');

/* 路径 → 三维单位向量序列（只在分区重建时算一次） */
function ringsToVectors(rings) {
  const out = [];
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    const xyz = new Float32Array(n * 3);
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) {
      const lon = (ring[i][0] / MAPW) * TAU - Math.PI;
      const lat = Math.PI / 2 - (ring[i][1] / MAPH) * Math.PI;
      const cl = Math.cos(lat);
      const x = cl * Math.sin(lon), y = Math.sin(lat), z = cl * Math.cos(lon);
      xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = z;
      sx += x; sy += y; sz += z;
    }
    out.push({ xyz, anchor: [sx / n, sy / n, sz / n] });
  }
  return out;
}

/* 国家路径的环（初始化时解析一次） */
function svgRings(pathStr) {
  const rings = [];
  let cur = null;
  const re = /([MLZ])|(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(pathStr))) {
    if (m[1] === 'M') { cur = []; rings.push(cur); }
    else if (m[1] === undefined && cur) cur.push([+m[2], +m[3]]);
  }
  return rings.filter((r) => r.length >= 3);
}

let vecShapes = [];
function prepareVector() {
  const layer = LAYERS[state.layerId];
  const shapes = partition.shapes;
  const out = [];
  for (const s of shapes) {
    let rings = null;
    if (layer.id === 'polity') {
      const sh = polityShape(pk, s.pathId);
      rings = sh.rings || (sh.rings = sh.pts ? [sh.pts] : []);
      if (!rings.length && sh.path) rings = [];      // 兜底
    } else {
      const src = mapShapes[s.id - 1];
      rings = src.rings || (src.rings = svgRings(src.path));
    }
    if (!rings.length) continue;
    const vecs = ringsToVectors(rings);
    if (!vecs.length) continue;
    const ent = layer.entityOfShape(s);
    const name = layer.id === 'polity'
      ? (isDisplayPolity(ent?.ent) ? (polityNames.get(ent?.ent?.name) || '') : '')
      : (ent?.region?.zh || '');
    let area = 0;
    for (const v of vecs) area = Math.max(area, ringRoughArea(v.xyz));
    out.push({ id: s.id, vecs, name, rawName: ent?.ent?.name || '', area });
  }
  /* 大的先画、标签也按大小优先 */
  out.sort((a, b) => b.area - a.area);
  vecShapes = out;
}

function ringRoughArea(xyz) {
  /* 球面上用向量和的模长做面积代理：0..1，越大说明铺得越开 */
  let sx = 0, sy = 0, sz = 0;
  const n = xyz.length / 3;
  for (let i = 0; i < n; i++) { sx += xyz[i * 3]; sy += xyz[i * 3 + 1]; sz += xyz[i * 3 + 2]; }
  const spread = Math.sqrt(sx * sx + sy * sy + sz * sz) / n;
  return 1 - spread;      // 铺得越开越大
}

/* 投影矩阵（与 GL 完全同一套） */
function rotation() {
  const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
  const ct = Math.cos(state.tilt), stt = Math.sin(state.tilt);
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, ct, -stt, 0, stt, ct];
  return mul3(Rx, Ry);      // 列主序
}

function globeHudBounds() {
  if (session.mode === 'Observe') return [eventMapReturn, eventMapYear].map(node => node.getBoundingClientRect());
  if (getComputedStyle(el('hud')).visibility === 'hidden') return [];
  const visible = [elYear, hudViewBtn];
  if (!yearForm.hidden) visible.push(yearForm);
  if (!vernier.hidden) visible.push(vernier);
  return visible.map((node) => node.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
}

function overlapsGlobeHud(bounds, x, y, w, h) {
  const gap = 5;
  return bounds.some((rect) => x < rect.right + gap && x + w > rect.left - gap &&
    y < rect.bottom + gap && y + h > rect.top - gap);
}

function drawVector(hudBounds = globeHudBounds()) {
  if (!vecCanvas.width) return;
  const dpr = view.dpr;
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.clearRect(0, 0, vecCanvas.width, vecCanvas.height);
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const M = rotation();
  const m0 = M[0], m1 = M[3], m2 = M[6];
  const m3 = M[1], m4 = M[4], m5 = M[7];
  const m6 = M[2], m7 = M[5], m8 = M[8];
  const cx = view.cx + state.panX, cy = view.cy + state.panY, Rz = view.Rz;

  /* 球下投影：让球「站」在背景上，这是质感的一大半 */
  vctx.save();
  const shY = cy + Rz * 1.01;
  const g = vctx.createRadialGradient(cx, shY, Rz * 0.15, cx, shY, Rz * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,.42)');
  g.addColorStop(0.55, 'rgba(0,0,0,.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  vctx.translate(cx, shY);
  vctx.scale(1.05, 0.22);
  vctx.translate(-cx, -shY);
  vctx.fillStyle = g;
  vctx.beginPath();
  vctx.arc(cx, shY, Rz * 0.95, 0, TAU);
  vctx.fill();
  vctx.restore();

  /* 球面裁剪 */
  vctx.save();
  vctx.beginPath();
  vctx.arc(cx, cy, Rz - 0.4, 0, TAU);
  vctx.clip();

  /* 经纬网：缩得越近越密 */
  const stepDeg = state.zoom >= 3 ? 10 : state.zoom >= 1.8 ? 15 : 30;
  if (chrome.grid) {
  vctx.lineWidth = 1;
  vctx.strokeStyle = 'rgba(255,255,255,.075)';
  vctx.beginPath();
  const sample = 3;
  for (let lonDeg = -180; lonDeg < 180; lonDeg += stepDeg) {
    let started = false;
    for (let latDeg = -90; latDeg <= 90; latDeg += sample) {
      const lon = (lonDeg / 180) * Math.PI, lat = (latDeg / 180) * Math.PI;
      const cl = Math.cos(lat);
      const x = cl * Math.sin(lon), y = Math.sin(lat), z = cl * Math.cos(lon);
      const px = x * m0 + y * m1 + z * m2;
      const py = x * m3 + y * m4 + z * m5;
      const pz = x * m6 + y * m7 + z * m8;
      if (pz <= 0) { started = false; continue; }
      const sx = cx + px * Rz, sy = cy - py * Rz;
      if (!started) { vctx.moveTo(sx, sy); started = true; } else vctx.lineTo(sx, sy);
    }
  }
  for (let latDeg = -60; latDeg <= 60; latDeg += stepDeg) {
    let started = false;
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += sample) {
      const lon = (lonDeg / 180) * Math.PI, lat = (latDeg / 180) * Math.PI;
      const cl = Math.cos(lat);
      const x = cl * Math.sin(lon), y = Math.sin(lat), z = cl * Math.cos(lon);
      const px = x * m0 + y * m1 + z * m2;
      const py = x * m3 + y * m4 + z * m5;
      const pz = x * m6 + y * m7 + z * m8;
      if (pz <= 0) { started = false; continue; }
      const sx = cx + px * Rz, sy = cy - py * Rz;
      if (!started) { vctx.moveTo(sx, sy); started = true; } else vctx.lineTo(sx, sy);
    }
  }
  vctx.stroke();

  }

  if (chrome.natural) {
    vctx.restore();
    return;
  }

  /* 面：整环都在正面才填（贴着轮廓的边缘交给贴图兜底），这样放大后边界是锐的 */
  const lut = partition.lut;
  for (const sh of vecShapes) {
    const o = sh.id * 4;
    if (!lut[o + 3]) continue;
    vctx.beginPath();
    let ok = true, any = false;
    for (const ring of sh.vecs) {
      const xyz = ring.xyz, n = xyz.length / 3;
      let started = false, back = false;
      for (let i = 0; i < n; i++) {
        const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
        const px = x * m0 + y * m1 + z * m2;
        const py = x * m3 + y * m4 + z * m5;
        const pz = x * m6 + y * m7 + z * m8;
        if (pz <= 0.08) { back = true; break; }
        const sx = cx + px * Rz, sy = cy - py * Rz;
        if (!started) { vctx.moveTo(sx, sy); started = true; } else vctx.lineTo(sx, sy);
        any = true;
      }
      if (back) { ok = false; break; }
      if (started) vctx.closePath();
    }
    if (!ok || !any) continue;
    vctx.fillStyle = 'rgba(' + lut[o] + ',' + lut[o + 1] + ',' + lut[o + 2] + ',' + (lut[o + 3] / 255 * 0.035).toFixed(3) + ')';
    vctx.fill('evenodd');
  }

  /* 边线 */
  const isPolity = state.layerId === 'polity';
  vctx.lineJoin = 'round';
  vctx.lineCap = 'round';
  const borderWidth = Math.min(1.05, 0.52 + state.zoom * 0.09);
  vctx.beginPath();
  const drawn = [];
  for (const sh of vecShapes) {
    let anyFront = false;
    for (const ring of sh.vecs) {
      const xyz = ring.xyz, n = xyz.length / 3;
      let started = false, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let i = 0; i < n; i++) {
        const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
        const px = x * m0 + y * m1 + z * m2;
        const py = x * m3 + y * m4 + z * m5;
        const pz = x * m6 + y * m7 + z * m8;
        if (pz <= 0.02) { started = false; continue; }
        const sx = cx + px * Rz, sy = cy - py * Rz;
        if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
        if (!started) { vctx.moveTo(sx, sy); started = true; } else vctx.lineTo(sx, sy);
        anyFront = true;
      }
      if (anyFront && maxX > minX) drawn.push({ id: sh.id, x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY, name: sh.name, area: 0 });
    }
    /* 一个实体只留一个标签：取屏幕上最大的那块 */
    let best = null;
    for (let i = drawn.length - 1; i >= 0; i--) {
      if (drawn[i].id !== sh.id) continue;
      const a = drawn[i].w * drawn[i].h;
      if (!best || a > best.w * best.h) best = drawn[i];
    }
    if (best) best.area = best.w * best.h;
  }
  // A narrow dark casing keeps fine borders legible over bright terrain and clouds.
  vctx.strokeStyle = 'rgba(10,15,23,.45)';
  vctx.lineWidth = borderWidth + 0.9;
  vctx.stroke();
  vctx.strokeStyle = isPolity ? 'rgba(238,217,175,.64)' : 'rgba(195,217,223,.38)';
  vctx.lineWidth = borderWidth;
  vctx.stroke();

  /* 选中描边 */
  if (state.focus) {
    vctx.beginPath();
    let any = false;
    for (const sh of vecShapes) {
      if (sh.id !== state.focus.id) continue;
      for (const ring of sh.vecs) {
        const xyz = ring.xyz, n = xyz.length / 3;
        let started = false;
        for (let i = 0; i < n; i++) {
          const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
          const px = x * m0 + y * m1 + z * m2;
          const py = x * m3 + y * m4 + z * m5;
          const pz = x * m6 + y * m7 + z * m8;
          if (pz <= 0.02) { started = false; continue; }
          const sx = cx + px * Rz, sy = cy - py * Rz;
          if (!started) { vctx.moveTo(sx, sy); started = true; } else vctx.lineTo(sx, sy);
          any = true;
        }
      }
    }
    if (any) {
      const focusWidth = Math.min(2.4, 1.2 + state.zoom * 0.25);
      vctx.strokeStyle = 'rgba(16,12,9,.82)';
      vctx.lineWidth = focusWidth + 1.5;
      vctx.stroke();
      vctx.strokeStyle = '#ffe2a4';
      vctx.lineWidth = focusWidth;
      vctx.stroke();
    }
  }

  /* 场景关联多政权高亮 */
  const sceneFocusNames = typeof activeSceneFocusPolities === 'function' ? activeSceneFocusPolities() : null;
  const focusedIds = new Set();
  if (isPolity && sceneFocusNames && sceneFocusNames.size) {
    vctx.beginPath();
    let anyFocus = false;
    for (const sh of vecShapes) {
      if (!sh.rawName || !sceneFocusNames.has(sh.rawName)) continue;
      focusedIds.add(sh.id);
      for (const ring of sh.vecs) {
        const xyz = ring.xyz, n = xyz.length / 3;
        let started = false;
        for (let i = 0; i < n; i++) {
          const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
          const px = x * m0 + y * m1 + z * m2;
          const py = x * m3 + y * m4 + z * m5;
          const pz = x * m6 + y * m7 + z * m8;
          if (pz <= 0.02) { started = false; continue; }
          const sx = cx + px * Rz, sy = cy - py * Rz;
          if (!started) { vctx.moveTo(sx, sy); started = true; } else vctx.lineTo(sx, sy);
          anyFocus = true;
        }
      }
    }
    if (anyFocus) {
      const fw = Math.min(2.2, 1.15 + state.zoom * 0.22);
      vctx.strokeStyle = 'rgba(12,10,8,.76)';
      vctx.lineWidth = fw + 1.4;
      vctx.stroke();
      vctx.strokeStyle = 'rgba(245,210,145,.92)';
      vctx.lineWidth = fw;
      vctx.stroke();
    }
  }

  /* 地名：按相对球盘面积决定显不显示，默启保留克制的重点锚点，放大后渐进增多，贪心避让 */
  const placed = [];
  const hasScenePolities = focusedIds.size > 0;
  const defaultExplore = state.zoom <= 1.15 && !state.focus && !hasScenePolities;
  const maxLabels = !chrome.labels || (worldEvent?.sceneId && !hasScenePolities)
    ? 0 : hasScenePolities ? Math.min(8, focusedIds.size)
    : defaultExplore ? (view.w < 500 ? 5 : 8)
    : state.zoom > 1.5 ? (view.w < 500 ? 14 : 24) : (view.w < 500 ? 8 : 15);
  const uiTop = view.safeTop + 12;
  const uiBottom = Math.min(view.h - 55, view.h - view.safeBottom - 24);
  const disk = Rz * Rz || 1;
  const need = Math.max(180, Math.round(disk * (state.zoom > 2 ? 0.0022 : state.zoom > 1.3 ? 0.0085 : defaultExplore ? 0.022 : 0.015)));
  const focusId = state.focus?.id;
  const cand = drawn.filter((d) => d.area > 0 && d.name && (!hasScenePolities || focusedIds.has(d.id)))
    .sort((a, b) => (b.id === focusId ? 1e9 : b.area) - (a.id === focusId ? 1e9 : a.area));
  vctx.textAlign = 'center';
  vctx.textBaseline = 'middle';
  for (const d of cand) {
    if (placed.length >= maxLabels) break;
    if (d.y < uiTop || d.y > uiBottom) continue;
    const isFocused = d.id === focusId;
    if (!isFocused && d.area < need) continue;
    vctx.font = isPolity
      ? '600 11.5px Georgia,"Songti SC",serif'
      : '600 11.5px system-ui,sans-serif';
    const w = vctx.measureText(d.name).width + 12;
    const h = 16;
    if (overlapsGlobeHud(hudBounds, d.x - w / 2, d.y - h / 2, w, h)) continue;
    const edgeX = Math.abs(d.x - cx) + w / 2;
    const edgeY = Math.abs(d.y - cy) + h / 2;
    if (edgeX * edgeX + edgeY * edgeY > (Rz - 5) ** 2) continue;
    if (d.x-w/2<4 || d.x+w/2>view.w-4 || w>d.w*1.2) continue;
    let overlap = false;
    for (const p of placed) {
      if (Math.abs(d.x - p.x) < (w + p.w) / 2 && Math.abs(d.y - p.y) < (h + p.h) / 2) { overlap = true; break; }
    }
    if (overlap) continue;
    placed.push({ x: d.x, y: d.y, w, h });
    vctx.shadowColor = 'rgba(0,0,0,.78)';
    vctx.shadowBlur = 4;
    const alpha = defaultExplore && !isFocused ? '.84' : '.95';
    vctx.fillStyle = isPolity ? `rgba(255,238,206,${alpha})` : `rgba(248,244,236,${alpha})`;
    vctx.fillText(d.name, d.x, d.y);
    vctx.shadowBlur = 0;
  }

  vctx.restore();
}

/* ───────────── 7. Canvas2D 兜底 ───────────── */
let fallback = null;
function initFallback() {
  const cv = fallbackCanvas;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const off = newCanvas(1, 1);
  const octx = off.getContext('2d');
  let src = null, sphere = null;
  return {
    kind: 'canvas2d',
    prepare() { src = baseCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, TW, TH).data; },
    resize(w, h, dpr) { cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr)); },
    draw(v, st) {
      if (!src) return;
      const D = clamp(Math.round(v.Rz * 2 * v.dpr), 160, 520);
      if (off.width !== D) { off.width = D; off.height = D; sphere = octx.createImageData(D, D); }
      const buf = sphere.data, c0 = D / 2, rad = D / 2 - 0.5;
      const ct = Math.cos(st.tilt), stt = Math.sin(st.tilt);
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      const mapLighting = !chrome.natural;
      const sel = mapLighting ? (st.focus?.id ?? 0) : 0;
      const dark = mapLighting ? 0.49 : 0.32;
      const lightBase = mapLighting ? 0.63 : 0.42;
      const diffuse = mapLighting ? 0.50 : 0.78;
      const lx = -0.52, ly = 0.44, lz = 0.73;
      for (let py = 0; py < D; py++) {
        const ny = (py + 0.5 - c0) / rad, ys = -ny;
        for (let px = 0; px < D; px++) {
          const nx = (px + 0.5 - c0) / rad, rr = nx * nx + ny * ny, o = (py * D + px) << 2;
          if (rr >= 1) { buf[o + 3] = 0; continue; }
          const nz = Math.sqrt(1 - rr);
          const y1 = ys * ct + nz * stt, z1 = -ys * stt + nz * ct;
          const mx = nx * cy - z1 * sy, mz = nx * sy + z1 * cy;
          const lat = Math.asin(clamp(y1, -1, 1));
          let u = Math.atan2(mx, mz) / TAU + 0.5;
          if (u < 0) u += 1; else if (u >= 1) u -= 1;
          const vv = 0.5 - lat / Math.PI;
          const col = Math.min(TW - 1, Math.max(0, (u * TW) | 0));
          const row = Math.min(TH - 1, Math.max(0, (vv * TH) | 0));
          const si = (row * TW + col) << 2;
          let r = src[si], g = src[si + 1], b = src[si + 2];
          const id = partition.pick[((row >> 1) * PW) + (col >> 1)];
          if (mapLighting && id) {
            const lo = id << 2, a = partition.lut[lo + 3] / 255 * 0.15;
            r += (partition.lut[lo] - r) * a;
            g += (partition.lut[lo + 1] - g) * a;
            b += (partition.lut[lo + 2] - b) * a;
            if (sel && id === sel) { r = r * 0.77 + 59; g = g * 0.77 + 52; b = b * 0.77 + 40; }
          }
          const l = nx * lx + ys * ly + nz * lz;
          const lam = l > 0 ? l : 0;
          const d0 = clamp((l + 0.24) / 0.62, 0, 1), ds = d0 * d0 * (3 - 2 * d0);
          const lit = lightBase + diffuse * Math.pow(lam, 0.7);
          r = r * dark + r * (lit - dark) * ds;
          g = g * dark + g * (lit - dark) * ds;
          b = b * dark + b * (lit - dark) * ds;
          const rim = Math.pow(1 - nz, 3.2) * 0.6;
          buf[o] = Math.min(255, r + 76 * rim);
          buf[o + 1] = Math.min(255, g + 117 * rim);
          buf[o + 2] = Math.min(255, b + 163 * rim);
          buf[o + 3] = 255;
        }
      }
      octx.putImageData(sphere, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      const Rz = v.Rz * v.dpr;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, (v.cx + st.panX) * v.dpr - Rz, (v.cy + st.panY) * v.dpr - Rz, Rz * 2, Rz * 2);
    },
  };
}

function useFallback() {
  if (!fallback) {
    fallback = initFallback();
    fallback?.prepare();
  }
  fallbackCanvas.hidden = !fallback;
  el('graphics-status').hidden = !fallback;
}

canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  renderGeneration++;
  glr = null;
  if (!baseCanvas) return;
  useFallback();
  layout();
  invalidate();
});
canvas.addEventListener('webglcontextrestored', () => {
  if (!baseCanvas || !(glr = initGL())) return;
  glr.uploadBase(baseCanvas);
  glr.uploadId(idCanvas);
  glr.uploadLut(partition.lut);
  fallbackCanvas.hidden = true;
  fallbackCanvas.width = fallbackCanvas.height = 1;
  fallback = null;
  el('graphics-status').hidden = true;
  layout();
  invalidate();
});

/* ───────────── 8. 布局与拾取 ───────────── */
function layout() {
  const root = document.documentElement;
  const visible = window.visualViewport;
  const heightValue = visible?.height > 0 && Math.abs(visible.scale - 1) < .01
    ? Math.round(visible.height) + 'px' : '';
  if (root.style.getPropertyValue('--app-height') !== heightValue) root.style.setProperty('--app-height', heightValue);
  const { width, height } = canvas.getBoundingClientRect();
  const w = Math.round(width), h = Math.round(height);
  if (!w || !h) return;
  const rootStyle = getComputedStyle(root);
  const safeTop = parseFloat(rootStyle.getPropertyValue('--safe-t')) || 0;
  const reportedBottom = parseFloat(rootStyle.getPropertyValue('--safe-b')) || 0;
  // Some iOS Home Screen launches already exclude the bottom strip from both viewports.
  const screenGap = screen.height - h;
  const bottomAlreadyReserved = standaloneGlobe && heightValue && h > w && Math.abs(screen.width - w) <= 2 &&
    Math.abs(visible.offsetTop) <= 1 && Math.abs(root.clientHeight - h) <= 2 &&
    safeTop >= 24 && Math.abs(screenGap - safeTop) <= 2;
  const safeBottom = bottomAlreadyReserved ? Math.max(0, reportedBottom - screenGap) : reportedBottom;
  const usableBottom = safeBottom + 'px';
  if (root.style.getPropertyValue('--usable-safe-b') !== usableBottom) root.style.setProperty('--usable-safe-b', usableBottom);
  const viewportChanged = w !== view.w || h !== view.h || safeTop !== view.safeTop || safeBottom !== view.safeBottom;
  const dpr = Math.min(devicePixelRatio || 1, 3);
  view.w = w; view.h = h; view.dpr = dpr;
  view.safeTop = safeTop;
  view.safeBottom = safeBottom;
  syncTopChrome();
  const shortLandscape = session.mode !== 'Observe' && w > h && h <= 500;
  const shortPortrait = session.mode !== 'Observe' && h > w && h <= 640;
  view.cx = w / 2;
  view.cyBase = h * (h > w ? (shortPortrait ? 0.485 : 0.515) : shortLandscape ? 0.425 : 0.46);
  view.cy = view.cyBase - state.lift;
  view.R = Math.min(w * 0.455, h * (shortLandscape ? 0.29 : 0.34), 410);
  if (reading.active) return;
  document.body.style.setProperty('--globe-foot', (view.cyBase + view.R) + 'px');
  constrainPan();
  view.Rz = view.R * state.zoom;
  updateSheetGlobeCenter(sheetState.offset);

  const r = glr || fallback;
  const pixelsWide = Math.round(w * dpr), pixelsHigh = Math.round(h * dpr);
  const surface = glr ? canvas : fallbackCanvas;
  if (r && (surface.width !== pixelsWide || surface.height !== pixelsHigh)) r.resize(w, h, dpr);
  if (vecCanvas.width !== pixelsWide) vecCanvas.width = pixelsWide;
  if (vecCanvas.height !== pixelsHigh) vecCanvas.height = pixelsHigh;
  if (viewportChanged && !sheetState.dragging) {
    if (sheetMotion) sheetTo(sheetState.detent);
    else applySheetOffset(sheetDetents()[sheetState.detent], false);
  }
  draw();
}

function panLimit() {
  // Leave a circle of map around the viewing center, even when panning near the limb.
  return Math.min(view.R * (state.zoom - 1) * 2, view.R * state.zoom - view.R * 0.55);
}

function constrainPan(elastic = false) {
  const distance = Math.hypot(state.panX, state.panY);
  const limit = panLimit();
  if (distance <= limit) return;
  const slack = 44;
  const excess = distance - limit;
  const offset = elastic ? slack * excess / (slack * 2 + excess) : 0;
  const scale = (limit + offset) / distance;
  state.panX *= scale;
  state.panY *= scale;
}

/* 屏幕坐标 → 1000×500 地图坐标 */
function mapPointAt(sx, sy) {
  const Rz = view.R * state.zoom;
  const dx = (sx - view.cx - state.panX) / Rz;
  const dy = -(sy - view.cy - state.panY) / Rz;
  const rr = dx * dx + dy * dy;
  if (rr >= 1) return null;
  const wz = Math.sqrt(1 - rr);
  const ct = Math.cos(state.tilt), stt = Math.sin(state.tilt);
  const cy = Math.cos(state.yaw), sy2 = Math.sin(state.yaw);
  const y1 = dy * ct + wz * stt, z1 = -dy * stt + wz * ct;
  const mx = dx * cy - z1 * sy2, mz = dx * sy2 + z1 * cy;
  const lat = Math.asin(clamp(y1, -1, 1));
  let u = Math.atan2(mx, mz) / TAU + 0.5;
  if (u < 0) u += 1; else if (u >= 1) u -= 1;
  return { x: u * MAPW, y: (0.5 - lat / Math.PI) * MAPH };
}

function pickAt(sx, sy) {
  const p = mapPointAt(sx, sy);
  if (!p) return 0;
  const col = Math.min(PW - 1, Math.max(0, (p.x / MAPW * PW) | 0));
  const row = Math.min(PH - 1, Math.max(0, (p.y / MAPH * PH) | 0));
  /* 3×3 多数表决：两个 id 交界处的混色会算出第三个 id，表决把它压掉 */
  const tally = new Map();
  for (let dy = -1; dy <= 1; dy++) {
    const r = row + dy;
    if (r < 0 || r >= PH) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const c = col + dx;
      if (c < 0 || c >= PW) continue;
      const v = partition.pick[r * PW + c];
      if (v) tally.set(v, (tally.get(v) || 0) + 1);
    }
  }
  let best = 0, bestN = 0;
  for (const [v, n] of tally) if (n > bestN) { best = v; bestN = n; }
  return best;
}

/* ───────────── 9. 实体 ─────────────
   实体的身份不能绑在 shape id 上：换年份会重建分区，同一个 id 就指向另一个政权了。
   focus 里存 key（国家是 ISO、政权是 entId），shape id 每次重建后重新解析。 */
function focusKeyOf(layerId, shape) {
  if (!shape) return null;
  if (layerId === 'country') return shape.iso || null;
  return shape.ent ? shape.ent.id : null;
}

function entityByKey(layerId, key, shapeId) {
  if (layerId === 'country') {
    const r = regionByIso.get(key);
    if (!r) return null;
    const s = mapShapes.find((x) => x.iso === key);
    return {
      kind: 'country', id: shapeId || (s ? s.id : 0), layerId, key,
      name: r.zh, iso: r.iso,
      from: null, to: null, regionId: r.id,
      total: (entryByRegion.get(r.id) || []).length,
    };
  }
  const e = pk && pk.entities.find((x) => x.id === key);
  if (!e) return null;
  return {
    kind: 'polity', id: shapeId || 0, layerId, key,
    name: e.name,
    from: e.from, to: e.to, entId: e.id,
    total: null,
  };
}

function entityById(layerId, id) {
  const shape = partition.shapes.find((s) => s.id === id);
  if (!shape) return null;
  return entityByKey(layerId, focusKeyOf(layerId, shape), id);
}

/* 分区重建后：按 key 找回同一个实体在新分区里的 shape id */
function reanchorFocus() {
  const f = state.focus;
  if (!f) return;
  if (f.layerId !== state.layerId) { state.focus = null; return; }
  const shape = partition.shapes.find((s) => focusKeyOf(f.layerId, s) === f.key);
  f.id = shape ? shape.id : 0;
}

/* 相邻实体（同一年、共享边界的其它 id） */
function neighboursOf(id, limit = 6) {
  const seen = new Map();
  const pick = partition.pick;
  for (let y = 1; y < PH - 1; y++) {
    for (let x = 1; x < PW - 1; x++) {
      const i = y * PW + x;
      if (pick[i] !== id) continue;
      const n = [pick[i - 1], pick[i + 1], pick[i - PW], pick[i + PW]];
      for (const v of n) if (v && v !== id) seen.set(v, (seen.get(v) || 0) + 1);
    }
  }
  /* 阈值 + 面积占比，滤掉栅格化噪声连出来的“假邻居” */
  const mine = [...pick].filter((v) => v === id).length;
  const minShare = Math.max(24, mine * 0.01);
  return [...seen.entries()]
    .filter(([, n]) => n >= minShare)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v);
}

/* 政权 → 今天的国家（空间重叠） */
const probeCanvas = newCanvas(PW, PH);
const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });

function countriesUnderPolity(ent, limit = 4) {
  const g = probeCtx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, PW, PH);
  g.setTransform(PW / MAPW, 0, 0, PH / MAPH, 0, 0);
  g.fillStyle = '#fff';
  for (const s of partition.shapes) {
    if (s.id !== ent.id) continue;
    g.fill(polityShape(pk, s.pathId).path, 'evenodd');
  }
  const px = g.getImageData(0, 0, PW, PH).data;
  const tally = new Map();
  for (let i = 0, p = 0; i < PW * PH; i++, p += 4) {
    if (px[p] < 128) continue;
    const cid = countryPick[i];
    if (cid) tally.set(cid, (tally.get(cid) || 0) + 1);
  }
  let total = 0;
  for (const v of tally.values()) total += v;
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([id, n]) => ({ iso: mapShapes[id - 1] ? mapShapes[id - 1].iso : '', pct: n / Math.max(1, total) }));
}

/* 某一年的政权栅格（独立于主分区，512×256，几毫秒） */
const polityProbeCache = { year: NaN, shapes: [], pick: null };
function polityProbe(year) {
  if (!pk) return null;
  if (polityProbeCache.year === year) return polityProbeCache;
  const shapes = LAYERS.polity.shapes(year);
  const g = probeCtx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, PW, PH);
  g.setTransform(PW / MAPW, 0, 0, PH / MAPH, 0, 0);
  for (const s of shapes) {
    g.fillStyle = 'rgb(' + s.id + ',255,0)';
    g.fill(polityShape(pk, s.pathId).path, 'evenodd');
  }
  const px = g.getImageData(0, 0, PW, PH).data;
  const pick = new Uint8Array(PW * PH);
  for (let i = 0, p = 0; i < pick.length; i++, p += 4) {
    const cover = px[p + 1];
    if (cover > 100) pick[i] = Math.round((px[p] * 255) / cover);
  }
  polityProbeCache.year = year;
  polityProbeCache.shapes = shapes;
  polityProbeCache.pick = pick;
  return polityProbeCache;
}

/* 国家 → 这一年的政权（取代表点所在 id） */
function polityOverCountry(iso) {
  if (!pk) return null;
  const centre = regionCentroid(iso);
  if (!centre) return null;
  const probe = polityProbe(LAYERS.polity.currentYear(state.year));
  if (!probe) return null;
  const col = Math.min(PW - 1, Math.max(0, (centre[0] / MAPW * PW) | 0));
  const row = Math.min(PH - 1, Math.max(0, (centre[1] / MAPH * PH) | 0));
  const id = probe.pick[row * PW + col];
  if (!id) return null;
  const s = probe.shapes.find((x) => x.id === id);
  return s ? s.ent : null;
}
function regionCentroid(iso) {
  const r = regionByIso.get(iso);
  if (!r) return null;
  const e = entries.find((x) => x.px !== undefined && x.region === r.id);
  return e ? [e.px, e.py] : null;
}

/* 现代国家的拾取栅格（政权页要用，静态建一次） */
let countryPick = new Uint8Array(PW * PH);
function buildCountryPick() {
  const save = state.layerId;
  const { pick } = rasterize(LAYERS.country, 2026);
  countryPick = pick;
  state.layerId = save;
}

/* ───────────── 10. 渲染调度 ───────────── */
let dirty = true, spinning = true, lastT = 0, rafId = 0;
const reducedGlobeMotion = matchMedia('(prefers-reduced-motion: reduce)');
let spinStep = 0, cloudDrift = 0;

function shouldSpin() {
  return spinning && !reducedGlobeMotion.matches && !document.hidden && state.zoom === 1 &&
    !pointers.size && !zoomAnim && !panReturn && !(typeof resetAnim === 'number' && resetAnim) && !globeTapTimer && !state.focus &&
    session.mode === 'Explore' && overlay.hidden && !yearControlOpen() && !vernierGesture && !vernierGlideFrame && !chrome.panel &&
    sheetState.detent === 'hidden' && !sheetMotion;
}

function invalidate() {
  if (reading.active || document.hidden) return;
  dirty = true;
  if (!rafId) { lastT = 0; rafId = requestAnimationFrame(frame); }
}
function frame(t) {
  if (document.hidden) { rafId = 0; return; }
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
  lastT = t; rafId = 0;
  let busy = false;
  if (applyMomentum(dt)) {
    dirty = true; busy = true; spinStep = 0;
  } else if (shouldSpin()) {
    spinStep += dt;
    if (spinStep >= 1 / 32) {
      cloudDrift = (cloudDrift + spinStep * 0.0008) % 1;
      state.yaw = (state.yaw - 0.04 * spinStep) % TAU;
      dirty = true; spinStep = 0;
    }
    busy = true;
  } else {
    spinStep = 0;
  }
  if (dirty) { dirty = false; draw(); }
  if (busy || dirty) rafId = requestAnimationFrame(frame);
}
function draw() {
  if (reading.active) return;
  const r = glr || fallback;
  if (!r || !baseCanvas) return;
  r.draw(view, state);
  const hudBounds = (chrome.labels && !chrome.natural) || state.zoom !== 1 || state.focus || session.mode === 'Observe'
    ? globeHudBounds() : [];
  drawVector(hudBounds);
  drawEventMap(hudBounds);
}

/* ───────────── 11. 交互 ───────────── */
const pointers = new Map();
let drag = null, pinch = null, momentum = { yaw: 0, tilt: 0 };
let panReturn = 0;

function stopPanReturn() {
  cancelAnimationFrame(panReturn);
  panReturn = 0;
}

function settlePan() {
  stopPanReturn();
  const x = state.panX, y = state.panY;
  constrainPan();
  const targetX = state.panX, targetY = state.panY;
  if ((x === targetX && y === targetY) || reducedGlobeMotion.matches) { invalidate(); cameraSettled(); return; }
  state.panX = x;
  state.panY = y;
  const start = performance.now();
  const step = (t) => {
    const progress = clamp((t - start) / 300, 0, 1);
    const k = 1 - (1 - progress) ** 3;
    state.panX = lerp(x, targetX, k);
    state.panY = lerp(y, targetY, k);
    panReturn = progress < 1 ? requestAnimationFrame(step) : 0;
    if (!panReturn) cameraSettled();
    invalidate();
  };
  panReturn = requestAnimationFrame(step);
}

function applyMomentum(dt) {
  if (!momentum.yaw && !momentum.tilt) return false;
  state.yaw += momentum.yaw * dt;
  state.tilt = clamp(state.tilt + momentum.tilt * dt, -0.62, 1.02);
  const damp = Math.pow(0.0016, dt);
  momentum.yaw *= damp; momentum.tilt *= damp;
  if (Math.abs(momentum.yaw) < 0.01) momentum.yaw = 0;
  if (Math.abs(momentum.tilt) < 0.01) momentum.tilt = 0;
  if (!momentum.yaw && !momentum.tilt) cameraSettled();
  return true;
}

let globeTapTimer=0;
let lastTapAt = 0, lastTapPos = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (session.mode === 'Explore') claimSession();
  exploreIntent();
  clearTimeout(globeTapTimer);
  globeTapTimer = 0;
  cancelGlobeFly();
  cancelZoom();
  stopPanReturn();
  momentum.yaw = momentum.tilt = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
  const dismissedYear = dismissYearFromGlobe();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX:e.clientX, startY:e.clientY, moved:0, dismissedYear });
  if (pointers.size === 1) {
    drag = { last: performance.now(), vy: 0, vt: 0 };
    pinch = null;
  } else if (pointers.size === 2) {
    lastTapAt = 0;
    for (const point of pointers.values()) point.moved = 10;
    const [a, b] = [...pointers.values()];
    pinch = {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: state.zoom, px: state.panX, py: state.panY,
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    };
    drag = null; momentum.yaw = momentum.tilt = 0;
  }
}, { passive: true });

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  // Small iOS pointer jitter should not make an otherwise stationary tap disappear.
  p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.startX, e.clientY - p.startY));
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const z = clamp((pinch.zoom * d) / pinch.d, 1, 6);
    const k = z / pinch.zoom;
    state.panX = (a.x+b.x)/2 - view.cx - k * (pinch.cx - view.cx - pinch.px);
    state.panY = (a.y+b.y)/2 - view.cy - k * (pinch.cy - view.cy - pinch.py);
    state.zoom = z;
    constrainPan(true); view.Rz = view.R * state.zoom;

    invalidate();
    return;
  }
  if (!drag) return;
  const now = performance.now();
  const dts = Math.max(0.008, (now - drag.last) / 1000);
  drag.last = now;
  const k = 1 / (view.R * state.zoom);
  state.yaw += dx * k;
  state.tilt = clamp(state.tilt + dy * k, -0.62, 1.02);
  drag.vy = lerp(drag.vy, dx * k / dts,.4); drag.vt = lerp(drag.vt,dy * k / dts,.4);
  invalidate();
}, { passive: true });

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 0 && drag) {
    const fresh = e.type === 'pointerup' && performance.now()-drag.last<110;
    momentum.yaw = fresh ? clamp(drag.vy * .32,-2,2) : 0;
    momentum.tilt = fresh ? clamp(drag.vt * .22,-1,1) : 0;
    drag = null;
  }
  if (pointers.size === 0) {
    const snapToFit = pinch && state.zoom > 1 && state.zoom <= 1.04;
    pinch = null;
    if (snapToFit) zoomTo(1);
    else settlePan();
  }
  // A completed hold already cleared the pointers when it opened the chooser.
  if (e.type === 'pointerup' && !p.dismissedYear && p.moved < 10) {
    const now = performance.now();
    const isDouble = lastTapAt > 0 && now - lastTapAt < 300 && Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y) < 26;
    lastTapAt = now; lastTapPos = { x: e.clientX, y: e.clientY };
    if (isDouble) {
      lastTapAt = 0;
      if (!mapPointAt(e.clientX, e.clientY)) {
        if (typeof resetView === 'function') resetView(true);
      } else {
        zoomTo(state.zoom > 1.35 ? 1 : 2.5, e.clientX, e.clientY);
      }
      return;
    }
    globeTapTimer=setTimeout(()=>{
      globeTapTimer = 0;
      tapGlobe(e.clientX,e.clientY);
      invalidate();
    },280);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (session.mode === 'Explore') claimSession();
  zoomTo(clamp(state.zoom * Math.exp(-e.deltaY * 0.0016), 1, 6), e.clientX, e.clientY);
}, { passive: false });

let zoomAnim = 0;
function cancelZoom() {
  cancelAnimationFrame(zoomAnim);
  zoomAnim = 0;
}
function zoomTo(z, ax, ay) {
  exploreIntent();
  z = clamp(z, 1, 6);
  const from = state.zoom, R = view.R;
  const dx = (ax == null ? view.cx : ax) - view.cx;
  const dy = (ay == null ? view.cy : ay) - view.cy;
  const px0 = state.panX, py0 = state.panY;
  const apply = (k) => {
    state.zoom = from + (z - from) * k;
    const ratio = state.zoom / from;
    state.panX = dx - ratio * (dx - px0);
    state.panY = dy - ratio * (dy - py0);
    constrainPan();
    view.Rz = R * state.zoom;

    invalidate();
  };
  if (z === from && !zoomAnim) { settlePan(); return; }
  cancelZoom();
  stopPanReturn();
  const t0 = performance.now();
  const step = (t) => {
    const k = clamp((t - t0) / 220, 0, 1);
    apply(k < 1 ? 1 - Math.pow(1 - k, 3) : 1);
    zoomAnim = k < 1 ? requestAnimationFrame(step) : 0;
    if (!zoomAnim) cameraSettled();
  };
  zoomAnim = requestAnimationFrame(step);
}

let pendingPolityTap = null;
function tapGlobe(sx, sy) {
  if (reading.active) return;
  if (session.mode === 'Observe') { if (session.observe.place) selectEventPlace(null); return; }
  const onGlobe = mapPointAt(sx, sy);
  if (!onGlobe || chrome.natural) {
    if (state.focus) closeSheet();
    return;
  }
  // The historic raster arrives asynchronously. Do not discard a real tap while it loads.
  if (state.layerId === 'polity' && hasHistoricalCoverage(state.year) && !polityState.loaded) {
    pendingPolityTap = {x:sx, y:sy, year:state.year, yaw:state.yaw, tilt:state.tilt,
      zoom:state.zoom, panX:state.panX, panY:state.panY};
    ensurePolity();
    return;
  }
  const id = pickAt(sx, sy);
  if (!id) {
    if (state.focus) closeSheet();
    return;
  }
  openEntity(state.layerId, id, onGlobe);
}

/* ───────────── 12. 抽屉：三档吸附（peek / half / full） ─────────────
   半屏展示此刻摘要，抓手上拉或点击专题入口，进入独立阅读层。 */
const sheetScroll = el('sheet-scroll'), grabEl = el('grab'), dimEl = el('sheet-dim');
const sheetState = { detent: 'hidden', offset: 0, dragging: false };

const SHEET_BOTTOM_GAP = 16;

function sheetDetents() {
  const H = view.h || innerHeight;
  const entity = state.focus && entityByKey(state.focus.layerId, state.focus.key, state.focus.id);
  const book = entity && subjectBookForEntity(entity);
  const hasSeparateBook = Boolean(entity && (book ? book.title !== subjectEntityName(entity)
    : historyBindingsFor(entity, state.year).some(row => row[3] === 'related')));
  const peekHeight = hasSeparateBook ? 202 : 144;
  const peek = H - (peekHeight + view.safeBottom);
  const half = Math.min(peek - 68, Math.round(H * .42));
  return { hidden: H, peek: Math.max(H * .46, peek), half: Math.max(H * .3, half), full: 0 };
}

function updateSheetGlobeCenter(offset) {
  if (view.w >= 960 || session.mode === 'Observe') return;
  const { hidden, half } = sheetDetents();
  const top = clamp(offset, half, hidden);
  const lift = Math.max(0, view.cyBase - top * .58);
  view.cy = view.cyBase - lift;
  const anchor = state.focus?.anchor || sheetState.closingAnchor;
  if (anchor && top < hidden) {
    const point = projectReadingPlace(anchor, rotation());
    const exposure = clamp((hidden - top) / 120, 0, 1);
    if (point.front) view.cy -= clamp(point.y - (top - 32), 0, view.h * .40) * exposure;
  }
  state.lift = view.cyBase - view.cy;
}

function paintSheetPosition(offset) {
  sheetState.offset = offset;
  const y = Math.round(offset);
  sheetEl.style.transform = 'translate3d(0,' + y + 'px,0)';
  if (view.w < 960) sheetEl.style.setProperty('--sheet-radius', clamp(y * .55, 0, 22) + 'px');
  if (view.w < 960 && session.mode !== 'Observe') {
    const previous = view.cy;
    updateSheetGlobeCenter(offset);
    if (Math.abs(previous - view.cy) > .1) invalidate();
  }
}

function applySheetOffset(offset, animate = true) {
  /* offset 必须是有限数：一旦是 NaN，transform 无效，抽屉就再也拖不动了 */
  const H = view.h || innerHeight;
  if (!Number.isFinite(offset)) offset = Number.isFinite(sheetState.offset) ? sheetState.offset : H;
  sheetEl.style.transition = animate ? '' : 'none';
  paintSheetPosition(offset);
  const show = offset < H - 2;
  /* 用 class 控制 pointer-events：只改 opacity 的话遮罩点不穿，点暗处关不掉 */
  dimEl.classList.toggle('show', show);
  dimEl.hidden = !show;
  dimEl.style.opacity = show ? Math.min(1, (1 - offset / H) * 0.9).toFixed(3) : '0';
  sheetEl.style.setProperty('--sheet-scroll-height', Math.max(0, H - Math.max(0, offset) - SHEET_BOTTOM_GAP - 48) + 'px');
  sheetEl.classList.toggle('full', offset <= 1);
  sheetEl.classList.toggle('peek', !reading.active && sheetState.detent === 'peek' && show);
  document.body.classList.toggle('sheet-full', offset <= 1);
  document.body.classList.toggle('sheet-open', show);
  syncTopChrome();
  if (typeof updateVernier === 'function') updateVernier();
}

// 位移由同一套弹簧积分驱动：动画途中再次按下可直接接住，不读取 CSS 目标位置。
let sheetMotion = 0;
function stopSheetMotion() {
  cancelAnimationFrame(sheetMotion);
  sheetMotion = 0;
}
function settleSheet(target, paint, finish, velocity = 0, animate = true) {
  stopSheetMotion();
  const start = sheetState.offset;
  if (!animate || reducedGlobeMotion.matches || Math.abs(start - target) < .6) {
    paint(target);
    finish?.();
    return;
  }
  const begin = performance.now();
  const distance = start - target;
  const damping = 20;
  const speed = clamp(velocity, -2200, 2200);
  const step = now => {
    const t = (now - begin) / 1000;
    const offset = target + (distance + (speed + damping * distance) * t) * Math.exp(-damping * t);
    if ((t > .12 && Math.abs(target - offset) < .55) || t > .52) {
      sheetMotion = 0;
      paint(target);
      finish?.();
      return;
    }
    paint(clamp(offset, 0, sheetDetents().hidden));
    sheetMotion = requestAnimationFrame(step);
  };
  sheetMotion = requestAnimationFrame(step);
}
function sheetTo(detent, animate = true, velocity = 0) {
  if (detent === 'full') { enterSheetReading(); return; }
  if (!['hidden', 'half', 'peek'].includes(detent)) detent = 'half';
  sheetState.detent = detent;
  setSheetIntent('idle');
  settleSheet(sheetDetents()[detent], offset => applySheetOffset(offset, false), () => {
    sheetState.closingAnchor = null;
    invalidate();
    cameraSettled();
  }, velocity, animate);
  const H = view.h || innerHeight;
  if (view.w >= 960) animateLift(detent === 'half' ? H * .075 : detent === 'peek' ? H * .04 : 0);
}
function enterSheetReading() {
  if (!state.focus) return;
  stopSheetMotion();
  setSheetIntent('idle');
  openBook({ resume: true });
}

let liftRaf = 0;
function animateLift(target) {
  cancelAnimationFrame(liftRaf);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    state.lift = target; view.cy = (view.cyBase || view.cy) - target; invalidate(); return;
  }
  const from = state.lift || 0;
  if (Math.abs(target - from) < 0.5) { state.lift = target; view.cy = (view.cyBase || view.cy) - target; invalidate(); return; }
  const t0 = performance.now(), dur = 420;
  const step = (t) => {
    const k = clamp((t - t0) / dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    state.lift = from + (target - from) * e;
    view.cy = (view.cyBase || view.cy) - state.lift;
    invalidate();
    if (k < 1) liftRaf = requestAnimationFrame(step);
  };
  liftRaf = requestAnimationFrame(step);
}

/* 抓手与摘要头都可拖；下面的条目保持原生滚动，互不争抢。 */
function setSheetIntent(intent) {
  sheetEl.dataset.gesture = intent;
  el('sheet-gesture').textContent = intent === 'expand' ? '松开，展开阅读' : intent === 'dismiss' ? '松开，收起' : '';
}
function sheetDragStart(e) {
  if (reading.active || sheetState.dragging || !state.focus || sheetState.detent === 'hidden' || e.isPrimary === false) return;
  if (e.target.closest('button, a, input')) return;
  if (e.pointerType === 'mouse' && e.buttons !== 1) return;
  if (e.currentTarget === sheetScroll && sheetState.detent !== 'peek') return;
  claimSession();
  stopSheetMotion();
  cancelAnimationFrame(liftRaf);
  momentum.yaw = momentum.tilt = 0;
  sheetState.dragging = true;
  sheetState.pointerId = e.pointerId;
  sheetState.startX = e.clientX;
  sheetState.startY = e.clientY;
  sheetState.startOffset = sheetState.offset;
  sheetState.startDetent = sheetState.detent;
  sheetState.samples = [{ y: e.clientY, t: e.timeStamp }];
  sheetState.distance = 0;
  sheetState.moved = false;
  setSheetIntent('idle');
}
function sheetReleaseVelocity(samples, now) {
  const last = samples.at(-1);
  const first = samples[0];
  if (now - last.t >= 105 || last.t - first.t < 8) return 0;
  return (last.y - first.y) / (last.t - first.t) * 1000;
}
function sheetDragPosition(offset) {
  return clamp(offset, 0, sheetDetents().hidden);
}
function sheetSnapTarget(origin, offset, velocity, modes) {
  const d = sheetDetents();
  const projected = offset + clamp(velocity * .16, -230, 230);
  const direction = Math.sign(projected - d[origin]);
  const initial = modes.indexOf(origin);
  let index = initial;
  if (!direction) return origin;
  // The first stop has a short threshold. Skipping another stop takes a longer pull or a flick.
  for (let next = index + direction; modes[next]; next += direction) {
    const span = Math.abs(d[modes[next]] - d[modes[index]]);
    const threshold = index === initial ? clamp(span * .24, 36, 84) : span * .46;
    if (direction * (projected - d[modes[index]]) < threshold) break;
    index = next;
  }
  return modes[index];
}
function sheetDragMove(e) {
  if (!sheetState.dragging || e.pointerId !== sheetState.pointerId) return;
  const now = e.timeStamp;
  sheetState.distance = e.clientY - sheetState.startY;
  if (!sheetState.moved) {
    const dx = Math.abs(e.clientX - sheetState.startX);
    if (dx > 8 && dx > Math.abs(sheetState.distance)) {
      sheetState.moved = true;
      sheetDragEnd(e, true);
      return;
    }
    if (Math.abs(sheetState.distance) < 6) return;
    sheetState.moved = true;
    sheetEl.classList.add('dragging');
    // Keep the touched element's implicit capture on iOS; only mouse drags need a transfer.
    if (e.pointerType === 'mouse') sheetEl.setPointerCapture(e.pointerId);
  }
  sheetState.samples.push({ y: e.clientY, t: now });
  sheetState.samples = sheetState.samples.filter((p) => now - p.t < 110);
  const offset = sheetDragPosition(sheetState.startOffset + sheetState.distance);
  applySheetOffset(offset, false);
}
function sheetDragEnd(e, cancelled = e?.type !== 'pointerup') {
  if (!sheetState.dragging) return;
  if (e && e.pointerId !== undefined && e.pointerId !== sheetState.pointerId) return;
  sheetState.dragging = false;
  sheetEl.classList.remove('dragging');
  sheetState.suppressClick = sheetState.moved;
  if (sheetState.suppressClick) setTimeout(() => { sheetState.suppressClick = false; }, 350);
  const original = sheetState.startDetent;
  if (cancelled || !sheetState.moved) { sheetTo(original); return; }
  const velocity = sheetReleaseVelocity(sheetState.samples, e.timeStamp);
  const target = sheetSnapTarget(original, sheetState.offset, velocity, ['full', 'half', 'peek', 'hidden']);
  if (target === 'hidden') closeSheet(velocity);
  else if (target === 'full' || target === 'half' && target !== original) enterSheetReading();
  else sheetTo(target, true, velocity);
}

el('sheet-top').addEventListener('pointerdown', sheetDragStart);
sheetScroll.addEventListener('pointerdown', sheetDragStart);
addEventListener('pointermove', sheetDragMove);
addEventListener('pointerup', sheetDragEnd);
addEventListener('pointercancel', sheetDragEnd);
sheetEl.addEventListener('lostpointercapture', e => {
  if (e.target === sheetEl) sheetDragEnd(e);
});
addEventListener('blur', sheetDragEnd);
function openPeekProgressively() {
  if (sheetState.detent !== 'peek') { enterSheetReading(); return; }
  const f = state.focus;
  const ent = f && entityByKey(f.layerId, f.key, f.id);
  if (ent && subjectBookForEntity(ent)) enterSheetReading();
  else sheetTo('half');
}
grabEl.addEventListener('click', () => {
  if (!sheetState.suppressClick && !reading.active) openPeekProgressively();
});
sheetInner.addEventListener('click', (event) => {
  if (reading.active || sheetState.suppressClick || !state.focus) return;
  if (event.target.closest('[data-open-sheet-book]')) { openBook({ resume: true }); return; }
  const relatedBtn = event.target.closest('[data-open-sheet-related]');
  if (relatedBtn) {
    const book = subjectsById.get(relatedBtn.dataset.openSheetRelated);
    if (book) {
      const entity = entityByKey(state.focus.layerId, state.focus.key, state.focus.id);
      beginReading(entity, null, relatedBtn.dataset.openSheetChapter || null, book);
    }
    return;
  }
  if (sheetState.detent !== 'peek') return;
  if (event.target.closest('button, a, input, select, summary')) return;
  if (event.target.closest('.subject-sheet-summary')) openPeekProgressively();
});
grabEl.addEventListener('keydown', (e) => {
  if (!['Enter', ' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'ArrowDown') closeSheet();
  else enterSheetReading();
});
dimEl.addEventListener('click', () => {
  claimSession();
  closeSheet();
});

/* 内容：档案头 + 书，一列到底 */
function renderEntity() {
  const f = state.focus;
  if (!f) return;
  const ent = entityByKey(f.layerId, f.key, f.id);
  if (!ent) { closeSheet(); return; }

  sheetInner.innerHTML = subjectSheetMarkup(ent);
  syncSheetIdentity();
}

function selectEntity(layerId, id, point) {
  const shape = partition.shapes.find((s) => s.id === id);
  const key = focusKeyOf(layerId, shape);
  if (key === null) return false;
  const anchor = point && readingPlaceVector({ lon:(point.x / MAPW - .5) * 360, lat:(.5 - point.y / MAPH) * 180 });
  sheetState.closingAnchor = null;
  state.focus = { layerId, id, key, point, anchor, atlasPeers: politySelectionsAt(point, key) };
  renderEntity();
  return true;
}

function openEntity(layerId, id, point = null) {
  if (session.mode !== 'Explore') return;
  exploreIntent();
  if (!selectEntity(layerId, id, point)) { closeSheet(); return; }
  syncHud();
  if (sheetState.detent === 'hidden') {
    applySheetOffset(sheetDetents().hidden, false);
    // v8.2: open the compact archival peek first; the user can pull up to read.
    sheetTo('peek');
    sheetScroll.scrollTop = 0;
  } else {
    /* 已经开着：保持当前高度（自由位置也保持不变），只换内容 */
    sheetTo(sheetState.detent);
  }
  rememberExplore();
  saveSession();
  invalidate();
}

function closeSheet(velocity = 0) {
  exploreIntent();
  if (!state.focus && sheetState.detent === 'hidden') return;
  sheetState.closingAnchor = state.focus?.anchor;
  state.focus = null;
  sheetTo('hidden', true, velocity);
  if (session.mode === 'Explore') { rememberExplore(); saveSession(); }
  invalidate();
}

/* 兼容旧调用 */
const closeBook = () => closeReader();
const renderSheet = renderEntity;

function isoName(iso) {
  return world?.isoNames?.[iso] || regionByIso.get(iso)?.zh || '相关地区';
}
const KIND = {
  era: ['朝代 / 政权', '#6f93b8'], war: ['战争', '#c0766d'], movement: ['思潮', '#9a86b8'],
  colonial: ['殖民', '#c08355'], religion: ['宗教', '#b79a5f'], economy: ['经济', '#6aa88c'],
  politics: ['政治', '#bf7f93'], technology: ['科技', '#6da3a9'], literature: ['文学', '#a888b8'],
  other: ['其他', '#8a9a7a'],
};
const kindOf = (e) => KIND[e.kind] || KIND.other;
const kindColor = (e) => kindOf(e)[1];
/* ───────────── 15. 图层开关 ───────────── */
function setLayer(id) {
  if (session.mode !== 'Explore' || !LAYERS[id]) return;
  if (state.layerId === id) return;
  state.layerId = id;
  if (id === 'polity' && hasHistoricalCoverage(state.year) && !polityState.loaded) ensurePolity();
  /* 换划分方式时，抽屉里那张卡片描述的已经是另一套东西了：收起来，别留残影 */
  closeSheet();
  rebuildPartition();
  syncHud();
  invalidate();
  rememberExplore();
  saveSession();
}
/* ───────────── 16. HUD ───────────── */
function syncHud() {
  const y = state.year;
  syncYearControl(y);
  syncChrome();
}
function onYearChanged() {
  rebuildPartition();
  if (session.mode === 'Explore' && state.focus && !state.focus.id) closeSheet();
  syncHud();
  if (!overlay.hidden) openWorld();
  if (state.focus) renderSheet();
  invalidate();
}


/* ───────────── 17. 键盘 ───────────── */
function closeTopNavigationPanel() {
  if (footnoteTrigger) closeFootnote(true);
  else if (closeReadingDisplay(true)) return true;
  else if (chrome.panel) closeView();
  else if (yearControlOpen()) closeYearControl({ focus: true });
  else return false;
  return true;
}

function navigateBack() {
  if (closeTopNavigationPanel()) return;
  if (session.mode === 'Observe') returnToWorld();
  else if (session.mode === 'Read') readingGoBack();
  else if (!overlay.hidden) closeWorld(true);
  else if (!abortVernierPreview()) closeSheet();
}

addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) navigateBack();
}, true);

addEventListener('keydown', (e) => {
  if (handleReadingKey(e)) return;
  if (session.mode === 'Observe' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  if (!overlay.hidden) return;
  if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || chrome.panel) return;
  const step = e.shiftKey ? 20 : 1;
  if (e.key === 'ArrowLeft') { stepYear(-step); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { stepYear(step); e.preventDefault(); }
  else if (e.key === 'Home') { commitYear(YMIN); e.preventDefault(); }
  else if (e.key === 'End') { commitYear(YMAX); e.preventDefault(); }
  else if (e.key === 'F2' && session.mode === 'Explore') { openYearInput(); e.preventDefault(); }
  else if (e.key === '0' || e.key.toLowerCase() === 'r') { resetView(true); e.preventDefault(); }
  else if (e.key === '+') { zoomTo(state.zoom * 1.4); e.preventDefault(); }
  else if (e.key === '-') { zoomTo(state.zoom / 1.4); e.preventDefault(); }
});

/* ───────────── 18. 尺寸 ───────────── */
let viewportFrame = 0;
function scheduleViewportLayout() {
  if (viewportFrame) return;
  viewportFrame = requestAnimationFrame(() => { viewportFrame = 0; layout(); });
}
function recheckViewportLayout() {
  scheduleViewportLayout();
  setTimeout(scheduleViewportLayout, 120);
  setTimeout(scheduleViewportLayout, 420);
}
addEventListener('resize', scheduleViewportLayout);
addEventListener('orientationchange', recheckViewportLayout);
addEventListener('pageshow', recheckViewportLayout);
addEventListener('focus', recheckViewportLayout);
window.visualViewport?.addEventListener('resize', scheduleViewportLayout);
new ResizeObserver(scheduleViewportLayout).observe(canvas);
document.addEventListener('visibilitychange', () => {
  lastT = 0;
  if (!document.hidden) { scheduleViewportLayout(); invalidate(); }
  else { cancelAnimationFrame(rafId); rafId = 0; }
});
reducedGlobeMotion.addEventListener('change', invalidate);

function syncSheetIdentity() {
  const entity = state.focus && entityByKey(state.focus.layerId, state.focus.key, state.focus.id);
  const book = entity && subjectBookForEntity(entity);
  const title = entity ? subjectEntityName(entity) : '历史档案';
  el('sheet-identity-name').textContent = title;
  el('sheet-seal').textContent = title.includes('明') ? '明' : title.slice(0, 1) || '史';
  el('sheet-identity-years').textContent = entity ? subjectIdentitySubtitle(entity) : '时间与空间';
  el('sheet-close').hidden = !entity;
  const toc = el('sheet-toc');
  toc.hidden = !entity;
  toc.toggleAttribute('data-read-subject', Boolean(entity));
  toc.textContent = book ? savedSubjectProgress(book) ? '继续阅读' : '阅读历史' : '查看地图资料';
}
el('sheet-close').addEventListener('click', () => {
  claimSession();
  closeSheet();
});
el('sheet-toc').addEventListener('click', () => {
  if (state.focus) openBook({ resume: true });
});
/* ───────────── 19. 启动 ───────────── */
async function loadRelief() {
  const inline = inlineText('relief');
  const relief = inline ? 'data:image/jpeg;base64,' + inline : assetURL('data/relief.jpg');
  const load = src => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  [cloudsImg,earthImg,reliefImg] = await Promise.all([
    load('data:image/png;base64,' + inlineText('clouds')),
    load('data:image/jpeg;base64,' + inlineText('earth')),
    load(relief),
  ]);
}

let polityLoadPromise = null;
function ensurePolity() {
  if (polityState.loaded) return Promise.resolve();
  if (!polityLoadPromise) polityLoadPromise = loadPolity().finally(() => { polityLoadPromise = null; });
  return polityLoadPromise;
}

async function loadPolity() {
  polityState.loading = true;
  polityState.error = null;
  syncHud();
  try {
    const inline = inlineText('politypack');
    let buf;
    if (inline) buf = b64ToBytes(inline).buffer;
    else {
      if (typeof DecompressionStream !== 'undefined')
        buf = await fetchBinary('data/polity.bin.gz').then(gunzip).catch(() => null);
      if (!buf) buf = await fetchBinary('data/polity.bin');
    }
    pk = parsePolityBin(buf);
    polityState.loaded = true;
    if (state.layerId === 'polity') { rebuildPartition(); syncHud(); invalidate(); }
    const tap = pendingPolityTap;
    pendingPolityTap = null;
    if (tap && state.layerId === 'polity' && session.mode === 'Explore' &&
        tap.year === state.year && Math.abs(tap.yaw - state.yaw) < .02 &&
        Math.abs(tap.tilt - state.tilt) < .02 && Math.abs(tap.zoom - state.zoom) < .02 &&
        Math.abs(tap.panX - state.panX) < 3 && Math.abs(tap.panY - state.panY) < 3) {
      tapGlobe(tap.x, tap.y);
    }
  } catch (err) {
    pendingPolityTap = null;
    polityState.error = err.message;
    console.warn('polity load failed', err);
    return;
  } finally {
    polityState.loading = false;
    syncHud();
  }
}

(async function boot() {
  const [world_] = await Promise.all([loadWorld(),loadRelief()]);
  initWorld(world_);
  buildBaseCanvas();
  glr = initGL();
  if (!glr) useFallback();
  if (glr) { glr.uploadBase(baseCanvas); glr.uploadId(idCanvas); }

  buildCountryPick();
  rebuildPartition();
  layout();
  const restored = restoreSession();
  if (!restored) {
    bootEl.querySelector('p').textContent = '正在加载 1500 年历史疆域…';
    await ensurePolity();
  }
  syncHud();
  draw();

  bootEl.classList.add('gone');
  setTimeout(() => { if (bootEl.parentNode) bootEl.remove(); }, 600);
  invalidate();
  recheckViewportLayout();
  setTimeout(() => { initializeOfflineStatus(); },700);

  /* 空闲时后台预热 4K 高清底图与政权边界，放大和切换图层都无需等待 */
  if (glr && typeof glr.preloadDetail === 'function') setTimeout(() => { glr.preloadDetail(); }, 600);
  if (restored && state.layerId === 'country') setTimeout(() => { ensurePolity(); }, 2200);
})().catch(() => {
  bootEl.querySelector('.spin').hidden = true;
  bootEl.querySelector('p').textContent = '地图资料未能加载。请检查连接后重试。';
  const retry = el('boot-retry');
  retry.hidden = false;
  retry.addEventListener('click', () => location.reload());
  retry.focus();
});

})();
