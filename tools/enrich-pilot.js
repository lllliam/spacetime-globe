#!/usr/bin/env node
/* 数据补充试点：把 Cliopatria 的英文政权名、年表的中文条目名，
 * 通过 Wikidata Action API（SPARQL 在本网络不可用）接上 QID，
 * 再批量取 中文名 / 描述 / 起止年 / 首都 / 前身-后继 / 坐标 / 维基摘要。
 *
 *   node tools/enrich-pilot.js --polity 20 --entry 20
 *
 * 结果写 data/enrich.pilot.json，并打印匹配率与样例。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const UA = 'spacetime-globe/1.0 (personal project; data enrichment)';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? Number(argv[i + 1]) : d; };
const NP = arg('polity', 20);
const NE = arg('entry', 20);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
}
const W = 'https://www.wikidata.org/w/api.php';
const qs = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

/* 取实体的一批 claims 值 */
function claimValues(ent, prop) {
  const c = ent && ent.claims && ent.claims[prop];
  if (!c) return [];
  return c.map((x) => {
    const dv = x.mainsnak && x.mainsnak.datavalue && x.mainsnak.datavalue.value;
    if (!dv) return null;
    if (typeof dv === 'object' && dv.time) return { time: dv.time, precision: dv.precision };
    if (typeof dv === 'object' && dv.latitude !== undefined) return { lat: dv.latitude, lon: dv.longitude };
    if (typeof dv === 'object' && dv.id) return { id: dv.id };
    if (typeof dv === 'string') return dv;
    return null;
  }).filter(Boolean);
}
function yearOf(t) {
  if (!t) return null;
  const m = /^([+-])(\d{1,6})-/.exec(t.time);
  if (!m) return null;
  const y = Number(m[2]);
  return m[1] === '-' ? -(y - 1) : y; // 天文纪年 → 历史纪年
}

/* ---------- 1. 政权：英文名 → QID（用存续年校验） ---------- */
function polityNames() {
  const html = fs.readFileSync(path.join(ROOT, '..', 'spacetime-atlas-main', '时空坐标_v1.4.html'), 'utf8');
  const rows = JSON.parse(zlib.gunzipSync(Buffer.from(/<script id="boundary-pack"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1].replace(/\s+/g, ''), 'base64')).toString('utf8'));
  const seen = new Map(); // name → {from,to,slices,id}
  for (const r of rows) {
    const name = r[2].replace(/^\(|\)$/g, '').trim();
    const o = seen.get(name) || { name, from: Infinity, to: -Infinity, slices: 0, id: r[5] };
    o.from = Math.min(o.from, r[0]);
    o.to = Math.max(o.to, r[1]);
    o.slices++;
    seen.set(name, o);
  }
  return [...seen.values()].sort((a, b) => b.slices - a.slices);
}

const KINDWORDS = /empire|kingdom|dynasty|caliphate|state|republic|khanate|sultanate|duchy|principality|confederation|chiefdom|polity|nation|colony|protectorate|federation|union|dominion|raj|sultanate/i;

async function resolvePolity(p, depth = 0) {
  const search = await getJSON(W + '?' + qs({ action: 'wbsearchentities', search: p.name, language: 'en', uselang: 'en', type: 'item', limit: 6, format: 'json', origin: '*' }));
  const cands = (search.search || []).slice(0, 4);
  if (!cands.length) return { ...p, qid: null, why: 'no-search-result' };
  const ids = cands.map((c) => c.id).join('|');
  const ent = await getJSON(W + '?' + qs({ action: 'wbgetentities', ids, props: 'labels|descriptions|claims', languages: 'zh|zh-cn|zh-hans|en', format: 'json', origin: '*' }));
  let best = null;
  for (const c of cands) {
    const e = ent.entities[c.id];
    if (!e) continue;
    const inc = claimValues(e, 'P571').map((x) => yearOf(x)).filter((y) => y !== null);
    const dis = claimValues(e, 'P576').map((x) => yearOf(x)).filter((y) => y !== null);
    const from = inc.length ? Math.min(...inc) : null;
    const to = dis.length ? Math.max(...dis) : null;
    const overlap = from !== null && to !== null
      ? Math.max(0, Math.min(to, p.to) - Math.max(from, p.from))
      : 0;
    const span = Math.max(1, p.to - p.from);
    const desc = (e.descriptions.en && e.descriptions.en.value) || '';
    const score = (overlap / span) * 2 + (KINDWORDS.test(desc) ? 0.6 : 0) + (from !== null ? 0.2 : 0);
    if (!best || score > best.score) best = { c, e, from, to, desc, score, overlap };
  }
  if (!best) return { ...p, qid: null, why: 'no-entity' };
  return {
    ...p,
    qid: best.c.id,
    labelEn: best.c.label,
    zh: (best.e.labels.zh || best.e.labels['zh-cn'] || best.e.labels['zh-hans'] || {}).value || null,
    descEn: best.desc,
    descZh: (best.e.descriptions.zh || best.e.descriptions['zh-cn'] || best.e.descriptions['zh-hans'] || {}).value || null,
    wdFrom: best.from, wdTo: best.to,
    capital: claimValues(best.e, 'P36').map((x) => x.id),
    replaces: claimValues(best.e, 'P1365').map((x) => x.id),
    replacedBy: claimValues(best.e, 'P1366').map((x) => x.id),
    score: +best.score.toFixed(2),
  };
}

/* ---------- 2. 年表条目：中文名 → QID + 摘要 ---------- */
async function resolveEntry(e) {
  const search = await getJSON(W + '?' + qs({ action: 'wbsearchentities', search: e.zh, language: 'zh', uselang: 'zh', type: 'item', limit: 3, format: 'json', origin: '*' }));
  const first = (search.search || [])[0];
  if (!first) return { ...e, qid: null, why: 'no-search-result' };
  const ent = await getJSON(W + '?' + qs({ action: 'wbgetentities', ids: first.id, props: 'labels|descriptions|claims', languages: 'zh|en', format: 'json', origin: '*' }));
  const x = ent.entities[first.id];
  const coords = claimValues(x, 'P625')[0] || null;
  const inc = claimValues(x, 'P571').map(yearOf).filter((v) => v !== null);
  const dis = claimValues(x, 'P576').map(yearOf).filter((v) => v !== null);
  return {
    id: e.id, zh: e.zh, region: e.region, start: e.start, end: e.end,
    qid: first.id,
    labelZh: (x.labels.zh || {}).value || null,
    descZh: (x.descriptions.zh || {}).value || null,
    coords,
    wdFrom: inc.length ? Math.min(...inc) : null,
    wdTo: dis.length ? Math.max(...dis) : null,
    wikiZh: (x.sitelinks && x.sitelinks.zhwiki) ? x.sitelinks.zhwiki.title : null,
  };
}

/* ---------- 3. 中文维基摘要（只给匹配成功的） ---------- */
async function zhExtract(title) {
  if (!title) return null;
  const u = 'https://zh.wikipedia.org/w/api.php?' + qs({ action: 'query', prop: 'extracts', exintro: 1, explaintext: 1, exsentences: 2, titles: title, format: 'json', origin: '*' });
  const j = await getJSON(u);
  const pages = (j.query && j.query.pages) || {};
  for (const k of Object.keys(pages)) if (pages[k].extract) return pages[k].extract.trim().slice(0, 400);
  return null;
}

(async () => {
  console.log('== 1. 政权名 → Wikidata ==');
  const all = polityNames();
  console.log('唯一政权名', all.length, '（切片数最多的前几个：' + all.slice(0, 5).map((x) => `${x.name}×${x.slices}`).join(', ') + '）');
  const sample = all.slice(0, NP);
  const polOut = [];
  for (const p of sample) {
    try {
      const r = await resolvePolity(p);
      polOut.push(r);
      console.log(`  ${r.qid ? '✓' : '✗'} ${p.name.padEnd(32)} ${p.from}~${p.to}  →  ${r.qid || r.why} ${r.zh ? '「' + r.zh + '」' : ''} ${r.descEn ? '(' + r.descEn.slice(0, 40) + ')' : ''}`);
      if (r.qid) r.summary = await zhExtract(r.zh || null);
    } catch (e) { console.log('  ! ' + p.name + ' ' + e.message); }
    await sleep(250);
  }

  console.log('\n== 2. 年表条目 → Wikidata ==');
  const atlas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'atlas.json'), 'utf8'));
  const ents = atlas.entries.filter((e) => e.start > -3000).slice(0, NE);
  const entOut = [];
  for (const e of ents) {
    try {
      const r = await resolveEntry(e);
      entOut.push(r);
      console.log(`  ${r.qid ? '✓' : '✗'} ${String(e.zh).padEnd(14)} ${r.qid || r.why}  ${r.coords ? '📍' + r.coords.lat.toFixed(1) + ',' + r.coords.lon.toFixed(1) : '（无坐标）'} ${r.descZh ? r.descZh.slice(0, 30) : ''}`);
    } catch (err) { console.log('  ! ' + e.zh + ' ' + err.message); }
    await sleep(250);
  }

  const polHit = polOut.filter((x) => x.qid).length;
  const polZh = polOut.filter((x) => x.zh).length;
  const entHit = entOut.filter((x) => x.qid).length;
  const entCoord = entOut.filter((x) => x.coords).length;
  console.log(`\n政权：${polHit}/${polOut.length} 匹配到 QID，其中 ${polZh} 个有中文名`);
  console.log(`条目：${entHit}/${entOut.length} 匹配到 QID，其中 ${entCoord} 个有坐标`);

  const out = { generatedAt: new Date().toISOString(), polities: polOut, entries: entOut };
  fs.writeFileSync(path.join(ROOT, 'data', 'enrich.pilot.json'), JSON.stringify(out, null, 1));
  console.log('已写 data/enrich.pilot.json');
})();
