#!/usr/bin/env node
/* 抓「书的正文」：年表条目 → 中文维基导语。
 *
 * 路径（精确优先）：
 *   1. 条目自带出处是 en.wikipedia 的具体条目 → 查 langlinks 拿中文条目名（精确对应）
 *   2. 没有出处 / 没有语言链接 → 中文维基搜索，但必须过标题相似度 + 消歧义闸门
 *   3. 政权：英文名 → langlinks → 中文条目；失败才搜索
 *
 *   node tools/fetch-stories.js [--limit N] [--polities N] [--force]
 *
 * 产物：data/stories.json { entries: {id: {t, x}}, polities: {en: {t, x}} }
 * 断点续跑；每 20 条写盘。中文维基导语 CC BY-SA 4.0。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'stories.json');
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes('--' + k) ? Number(argv[argv.indexOf('--' + k) + 1]) : d);
const LIMIT = arg('limit', Infinity);
const NPOL = arg('polities', 240);
const FORCE = argv.includes('--force');
const UA = 'spacetime-globe/2.0 (personal history app; reading view)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let store = { generatedAt: null, entries: {}, polities: {} };
/* 始终读回已有结果；--force 只影响「是否重抓」，不会清空文件 */
if (fs.existsSync(OUT)) { try { store = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { } }
store.entries = store.entries || {};
store.polities = store.polities || {};

const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world.json'), 'utf8'));
let dirty = 0;
function save() {
  if (!dirty) return;
  store.generatedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(store));
  dirty = 0;
}

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) { await sleep(5000 * (i + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1200 * (i + 1));
    }
  }
}
const qs = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

/* ---- 质量闸门 ---- */
const DISAMBIG = /可以指|可能指|消歧義|消歧义|維基百科有同名|同名條目|同名条目|是一个消歧/;
const norm = (s) => String(s).replace(/[（(].*?[)）]/g, '').replace(/[\s·・、,，.。:：;；'"“”‘’\-—–_/|]/g, '');
function titleScore(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (B.includes(A) || A.includes(B)) return 0.9;
  /* 二元字组重合度 */
  const grams = (s) => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const ga = grams(A), gb = grams(B);
  if (!ga.size || !gb.size) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return hit / ga.size;
}
function clip(s, max = 320) {
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const i = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
  return (i > max * 0.5 ? cut.slice(0, i + 1) : cut + '…');
}

/* ---- 维基调用 ---- */
async function zhTitleOf(enTitle) {
  const u = 'https://en.wikipedia.org/w/api.php?' + qs({
    action: 'query', prop: 'langlinks', lllang: 'zh', titles: enTitle,
    redirects: 1, converttitles: 1, variant: 'zh-cn', format: 'json', origin: '*',
  });
  const j = await getJSON(u);
  const pages = (j && j.query && j.query.pages) || {};
  for (const p of Object.values(pages)) if (p.langlinks && p.langlinks[0]) return p.langlinks[0]['*'];
  return null;
}
async function extractOf(title, sentences = 3) {
  const u = 'https://zh.wikipedia.org/w/api.php?' + qs({
    action: 'query', prop: 'extracts', exintro: 1, explaintext: 1, exsentences: sentences,
    redirects: 1, converttitles: 1, titles: title, variant: 'zh-cn', format: 'json', origin: '*',
  });
  const j = await getJSON(u);
  const pages = (j && j.query && j.query.pages) || {};
  for (const p of Object.values(pages)) if (p.extract && p.extract.trim()) return { x: p.extract.trim(), title: p.title };
  return null;
}
async function searchHit(query) {
  for (const q of ['intitle:' + query, query]) {
    const u = 'https://zh.wikipedia.org/w/api.php?' + qs({
      action: 'query', generator: 'search', gsrsearch: q, gsrlimit: 3, gsrnamespace: 0,
      prop: 'extracts', exintro: 1, explaintext: 1, exsentences: 3,
      redirects: 1, converttitles: 1, variant: 'zh-cn', format: 'json', origin: '*',
    });
    const j = await getJSON(u);
    const pages = (j && j.query && j.query.pages) || {};
    const list = Object.values(pages).sort((a, b) => (a.index || 9) - (b.index || 9));
    for (const p of list) {
      if (!p.extract || !p.extract.trim()) continue;
      if (DISAMBIG.test(p.title) || DISAMBIG.test(p.extract.slice(0, 120))) continue;
      if (titleScore(query, p.title) < 0.34) continue;
      return { t: p.title, x: p.extract.trim() };
    }
    await sleep(140);
  }
  return null;
}

function enTitleOf(url) {
  try {
    const u = new URL(url);
    if (!/wikipedia\.org$/.test(u.hostname)) return null;
    return decodeURIComponent(u.pathname.replace('/wiki/', '')).replace(/_/g, ' ');
  } catch { return null; }
}

function polityNames() {
  const buf = fs.readFileSync(path.join(ROOT, 'data', 'polity.bin'));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nEnt = dv.getUint32(4, true), entOff = dv.getUint32(16, true);
  const dec = new TextDecoder();
  const out = [];
  let o = entOff;
  for (let i = 0; i < nEnt; i++) {
    const len = dv.getUint16(o, true); o += 2;
    const name = dec.decode(new Uint8Array(buf.buffer, buf.byteOffset + o, len)); o += len;
    const from = dv.getInt16(o, true); o += 2;
    const to = dv.getInt16(o, true); o += 2;
    out.push({ name, span: to - from, from, to });
  }
  return out.sort((a, b) => b.span - a.span);
}

/* 条目：语言链接优先，搜索兜底 */
async function storyForEntry(e) {
  const en = e.source ? enTitleOf(e.source) : null;
  if (en) {
    const zh = await zhTitleOf(en);
    await sleep(120);
    if (zh && !DISAMBIG.test(zh)) {
      const got = await extractOf(zh);
      if (got && !DISAMBIG.test(got.x.slice(0, 120))) return { t: got.title || zh, x: clip(got.x) };
    }
  }
  const hit = await searchHit(e.zh);
  if (hit && !DISAMBIG.test(hit.x.slice(0, 120))) return { t: hit.t, x: clip(hit.x) };
  return null;
}

/* 政权：英文名 → 语言链接 → 导语；失败则先在 en 维基搜到正式条目名再转中文 */
async function enSearchTitle(name) {
  const u = 'https://en.wikipedia.org/w/api.php?' + qs({
    action: 'query', list: 'search', srsearch: name + ' state empire kingdom dynasty',
    srlimit: 3, srnamespace: 0, variant: 'zh-cn', format: 'json', origin: '*',
  });
  const j = await getJSON(u);
  const hits = (j && j.query && j.query.search) || [];
  for (const h of hits) if (titleScore(name, h.title) >= 0.5) return h.title;
  return null;
}
async function storyForPolity(name) {
  const tryTitle = async (en) => {
    if (!en) return null;
    const zh = await zhTitleOf(en);
    await sleep(110);
    if (!zh || DISAMBIG.test(zh)) return null;
    const got = await extractOf(zh);
    if (!got || DISAMBIG.test(got.x.slice(0, 120))) return null;
    return { t: got.title || zh, x: clip(got.x, 360) };
  };
  let rec = await tryTitle(name);
  if (rec) return rec;
  const en2 = await enSearchTitle(name);
  if (en2 && en2 !== name) {
    rec = await tryTitle(en2);
    if (rec) return rec;
  }
  return null;
}

(async () => {
  /* 1. 年表条目 */
  const todo = world.entries
    .filter((e) => FORCE || !store.entries[e.id] || !store.entries[e.id].x)
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`条目待抓 ${todo.length}（已有正文 ${Object.values(store.entries).filter((v) => v.x).length}）`);
  let done = 0, good = 0;
  for (const e of todo) {
    let rec = null;
    try { rec = await storyForEntry(e); } catch (err) { console.error('  条目失败', e.zh, err.message); }
    store.entries[e.id] = rec || { t: null, x: null };
    if (rec) good++;
    dirty++; done++;
    if (dirty >= 20) { save(); console.log(`  ${done}/${todo.length}  命中 ${good}  … 已写盘`); }
    await sleep(140);
  }
  save();
  console.log(`条目：${Object.values(store.entries).filter((v) => v.x).length} 条有正文 / ${Object.keys(store.entries).length} 条已处理`);

  /* 2. 政权 */
  const pols = polityNames().filter((p) => FORCE || !store.polities[p.name] || !store.polities[p.name].x).slice(0, NPOL);
  console.log(`政权待抓 ${pols.length}`);
  let pd = 0, pgood = 0;
  for (const p of pols) {
    let rec = null;
    try { rec = await storyForPolity(p.name); } catch (err) { console.error('  政权失败', p.name, err.message); }
    store.polities[p.name] = rec || { t: null, x: null };
    if (rec) pgood++;
    dirty++; pd++;
    if (dirty >= 20) { save(); console.log(`  ${pd}/${pols.length}  命中 ${pgood}  … 已写盘`); }
    await sleep(140);
  }
  save();
  console.log(`政权：${Object.values(store.polities).filter((v) => v.x).length} 个有正文`);
  console.log('→ data/stories.json', (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
})();
