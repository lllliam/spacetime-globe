#!/usr/bin/env node
/* 数据构建：把网页版的原料整理成手机版要的两份东西
 *
 *   data/world.json      105 个地区 + 1512 条年表（带代表点）+ 177 块现代国界
 *   data/polity.bin      政权层：实体表 + 切片表 + 路径表（量化 1/4 像素、增量、varint）
 *   data/polity.bin.gz   同上，gzip 后随页面发布（约 0.7 MB）
 *
 * 用法：node tools/build-data.js [--src <时空坐标 html 路径>]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const srcArg = argv.indexOf('--src');
const SRC = srcArg >= 0 ? argv[srcArg + 1]
  : path.join(ROOT, '..', 'spacetime-atlas-main', '时空坐标_v1.4.html');

const log = (...a) => console.log(...a);

/* ─────────── 1. 读网页版的原料 ─────────── */
const html = fs.readFileSync(SRC, 'utf8');
const atlas = JSON.parse(/window\.ATLAS=(\{[\s\S]*?\});?\s*<\/script>/.exec(html)[1]);
const packB64 = /<script id="boundary-pack"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1].replace(/\s+/g, '');
const rows = JSON.parse(zlib.gunzipSync(Buffer.from(packB64, 'base64')).toString('utf8'));
log('原料：地区', atlas.regions.length, '条目', atlas.entries.length, '国界', atlas.map.length, '政权切片', rows.length);

/* ─────────── 2. 条目代表点：取所属地区国界的多边形质心 ─────────── */
const MAPW = 1000, MAPH = 500, Q = 4;              // 量化 1/4 像素
const isoPath = new Map(atlas.map.map(([iso, p]) => [iso, p]));
const isoRegion = new Map(atlas.regions.filter((r) => r.iso).map((r) => [r.iso, r.id]));

function rings(pathStr) {
  const out = [];
  let cur = null;
  const re = /([MLZ])|(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(pathStr))) {
    if (m[1] === 'M') { cur = []; out.push(cur); }
    else if (m[1] === 'Z') { /* 闭合，点已记录 */ }
    else if (cur) cur.push([+m[2], +m[3]]);
  }
  return out.filter((r) => r.length >= 3);
}
function polygonCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-6) { // 退化：取平均
    const n = pts.length;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}
function regionPoint(iso) {
  const p = isoPath.get(iso);
  if (!p) return null;
  const rs = rings(p).sort((x, y) => Math.abs(area(x)) - Math.abs(area(y))).reverse();
  if (!rs.length) return null;
  const c = polygonCentroid(rs[0]);
  const ns = c.map((v, i) => (v >= 0 && v <= (i ? MAPH : MAPW)) ? v : (i ? MAPH : MAPW) / 2);
  return [Math.round(ns[0] * 10) / 10, Math.round(ns[1] * 10) / 10];
}
function area(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; a += x1 * y2 - x2 * y1; }
  return a / 2;
}

const entries = atlas.entries.map((e) => {
  const reg = atlas.regions.find((r) => r.id === e.region);
  const pt = reg && reg.iso ? regionPoint(reg.iso) : null;
  const o = { ...e };
  if (pt) { o.px = pt[0]; o.py = pt[1]; }
  return o;
});
const withPoint = entries.filter((e) => e.px !== undefined).length;
log('条目代表点：', withPoint, '/', entries.length, `（${(withPoint / entries.length * 100).toFixed(0)}% 有坐标）`);

/* ─────────── 3. 政权层：实体 + 切片 + 路径 ─────────── */
const entByName = new Map();
const slices = [];           // {ent, start, end, pathId}
const pathIds = new Map();   // path string → id
const pathList = [];         // [{subpaths: [[x,y],...]}]

function pathIdOf(p) {
  let id = pathIds.get(p);
  if (id !== undefined) return id;
  const rs = rings(p);
  if (!rs.length) return -1;
  id = pathList.length;
  pathIds.set(p, id);
  pathList.push(rs.map((r) => r.map(([x, y]) => [Math.round(x * Q), Math.round(y * Q)])));
  return id;
}
for (const r of rows) {
  const [start, end, rawName, pathStr] = r;
  const name = rawName.replace(/^\(|\)$/g, '').trim();
  let ent = entByName.get(name);
  if (!ent) { ent = { id: entByName.size, name, from: start, to: end, n: 0 }; entByName.set(name, ent); }
  ent.from = Math.min(ent.from, start);
  ent.to = Math.max(ent.to, end);
  ent.n++;
  const pid = pathIdOf(pathStr);
  if (pid >= 0) slices.push({ ent: ent.id, start, end, pathId: pid });
}
const entities = [...entByName.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
const entIndex = new Map(entities.map((e, i) => [e.id, i]));   // 原 id → 排序后 id
log('政权：实体', entities.length, '切片', slices.length, '唯一路径', pathList.length);

/* ─────────── 4. 编码成二进制 ─────────── */
function zigzag(v) { return v < 0 ? (~v) * 2 + 1 : v * 2; }
function writeVarint(out, v) { let z = zigzag(v); while (z >= 128) { out.push((z & 127) | 128); z >>>= 7; } out.push(z); }

const pathBlobs = pathList.map((subpaths) => {
  const out = [];
  out.push(subpaths.length & 255, (subpaths.length >> 8) & 255);
  for (const pts of subpaths) {
    const n = pts.length;
    out.push(n & 255, (n >> 8) & 255);
    out.push(pts[0][0] & 255, (pts[0][0] >> 8) & 255, pts[0][1] & 255, (pts[0][1] >> 8) & 255);
    let px = pts[0][0], py = pts[0][1];
    for (let i = 1; i < n; i++) { writeVarint(out, pts[i][0] - px); writeVarint(out, pts[i][1] - py); px = pts[i][0]; py = pts[i][1]; }
  }
  return Buffer.from(out);
});
const pathDataLen = pathBlobs.reduce((s, b) => s + b.length, 0);

const nameBufs = entities.map((e) => Buffer.from(e.name, 'utf8'));
const entTableLen = nameBufs.reduce((s, b) => s + 2 + b.length + 2 + 2, 0);
const sliceTableLen = slices.length * 8;
const pathIndexLen = (pathBlobs.length + 1) * 4;
const headerLen = 4 + 4 * 7;

const entOff = headerLen;
const sliceOff = entOff + entTableLen;
const pathIdxOff = sliceOff + sliceTableLen;
const pathDataOff = pathIdxOff + pathIndexLen;

const buf = Buffer.alloc(pathDataOff + pathDataLen);
let o = 0;
buf.write('SGP1', 0, 'ascii'); o = 4;
buf.writeUInt32LE(entities.length, o); o += 4;
buf.writeUInt32LE(slices.length, o); o += 4;
buf.writeUInt32LE(pathBlobs.length, o); o += 4;
buf.writeUInt32LE(entOff, o); o += 4;
buf.writeUInt32LE(sliceOff, o); o += 4;
buf.writeUInt32LE(pathIdxOff, o); o += 4;
buf.writeUInt32LE(pathDataOff, o); o += 4;
// 实体表
o = entOff;
entities.forEach((e, i) => {
  const nb = nameBufs[i];
  buf.writeUInt16LE(nb.length, o); o += 2; nb.copy(buf, o); o += nb.length;
  buf.writeInt16LE(e.from, o); o += 2;
  buf.writeInt16LE(e.to, o); o += 2;
});
// 切片表
o = sliceOff;
for (const s of slices) {
  buf.writeUInt16LE(entIndex.get(s.ent), o); o += 2;
  buf.writeInt16LE(s.start, o); o += 2;
  buf.writeInt16LE(s.end, o); o += 2;
  buf.writeUInt16LE(s.pathId, o); o += 2;
}
// 路径索引 + 数据
o = pathIdxOff;
let acc = pathDataOff;
for (const b of pathBlobs) { buf.writeUInt32LE(acc, o); o += 4; acc += b.length; }
buf.writeUInt32LE(acc, o);
let d = pathDataOff;
for (const b of pathBlobs) { b.copy(buf, d); d += b.length; }

const gz = zlib.gzipSync(buf, { level: 9 });
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'polity.bin'), buf);
fs.writeFileSync(path.join(ROOT, 'data', 'polity.bin.gz'), gz);
log(`\npolity.bin  ${(buf.length / 1e6).toFixed(2)} MB  →  gzip ${(gz.length / 1e6).toFixed(2)} MB`);
log(`  头部 ${headerLen}B · 实体 ${entTableLen}B · 切片 ${sliceTableLen}B · 路径索引 ${pathIndexLen}B · 几何 ${(pathDataLen / 1e6).toFixed(2)}MB`);

/* ─────────── 5. world.json ─────────── */
const extraIso = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'iso-zh.json'), 'utf8'));
const isoNames = { ...extraIso };
for (const r of atlas.regions) if (r.iso) isoNames[r.iso] = r.zh || r.en || r.iso;
const world = {
  generatedAt: new Date().toISOString(),
  regions: atlas.regions,
  entries,
  map: atlas.map,
  isoNames,
};
const wj = JSON.stringify(world);
fs.writeFileSync(path.join(ROOT, 'data', 'world.json'), wj);
log(`world.json  ${(wj.length / 1e6).toFixed(2)} MB (gzip 后约 ${(zlib.gzipSync(wj, { level: 9 }).length / 1024).toFixed(0)} KB)`);

/* ─────────── 6. 自检：解码回来比对 ─────────── */
function decodePath(i) {
  let off = buf.readUInt32LE(pathIdxOff + i * 4);
  const end = buf.readUInt32LE(pathIdxOff + (i + 1) * 4);
  const subCount = buf.readUInt16LE(off); off += 2;
  const subs = [];
  for (let s = 0; s < subCount; s++) {
    const n = buf.readUInt16LE(off); off += 2;
    let x = buf.readUInt16LE(off); off += 2;
    let y = buf.readUInt16LE(off); off += 2;
    const pts = [[x, y]];
    for (let k = 1; k < n; k++) {
      let v = 0, shift = 0, byte;
      do { byte = buf[off++]; v |= (byte & 127) << shift; shift += 7; } while (byte & 128);
      const dx = v & 1 ? ~(v >> 1) : (v >> 1);
      let v2 = 0, shift2 = 0, byte2;
      do { byte2 = buf[off++]; v2 |= (byte2 & 127) << shift2; shift2 += 7; } while (byte2 & 128);
      const dy = v2 & 1 ? ~(v2 >> 1) : (v2 >> 1);
      x += dx; y += dy;
      pts.push([x, y]);
    }
    subs.push(pts);
  }
  if (off !== end) throw new Error('路径 ' + i + ' 长度不符: ' + off + ' vs ' + end);
  return subs;
}
let ptsChecked = 0;
for (let i = 0; i < pathBlobs.length; i += 997) {
  const subs = decodePath(i);
  ptsChecked += subs.reduce((s, p) => s + p.length, 0);
  const orig = pathList[i];
  const same = subs.length === orig.length && subs.every((p, si) => p.length === orig[si].length && p.every((pt, pi) => pt[0] === orig[si][pi][0] && pt[1] === orig[si][pi][1]));
  if (!same) throw new Error('路径 ' + i + ' 解码不一致');
}
log(`自检：抽查 ${Math.ceil(pathBlobs.length / 997)} 条路径（${ptsChecked} 个点）解码逐点一致 ✓`);

/* 单年切片数抽样 */
const perYear = new Map();
for (const s of slices) for (let y = Math.max(s.start, -3500); y <= Math.min(s.end, 2026); y++) perYear.set(y, (perYear.get(y) || 0) + 1);
log('单年切片数：1500 →', perYear.get(1500), ' 1900 →', perYear.get(1900), ' 2000 →', perYear.get(2000), ' 2026 →', perYear.get(2026) || 0);
