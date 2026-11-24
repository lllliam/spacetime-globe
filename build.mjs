#!/usr/bin/env node
/* 构建两个产物：
 *   index.html          线上版：阅读内容内嵌，地球数据按需加载
 *   index.offline.html  单文件版：数据全内嵌，双击即开、可离线
 */
import { readFileSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSubjectBooks } from './tools/subject-books.mjs';
import { loadPolityNames } from './tools/polity-names.mjs';
import { loadHistoricalScenes } from './tools/historical-scenes.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const rd = (...p) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const terrainPath = join(root, 'data', 'terrain-4k-v1.png');

const shell = rd('src', 'shell.html');
const css = rd('src', 'app.css') + '\n' + rd('src','chrome.css');
const readingMarker = '/* ───────────── 19. 启动 ───────────── */';
const appSource = rd('src', 'app.js');
if (!appSource.includes(readingMarker)) throw new Error('缺少阅读模块插入位置');
const app = appSource.replace(readingMarker, ['session-state.js', 'reading.js', 'subject-reader.js', 'event-map.js', 'year-discovery.js', 'chrome.js', 'year-control.js']
  .map((file) => rd('src', file)).join('\n') + '\n' + readingMarker);
const topics = readdirSync(join(root, 'data/topics')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(rd('data', 'topics', f)));
const timelineNotes = JSON.parse(rd('data', 'reading-timeline.json'));
const worldReading = JSON.parse(rd('data', 'world-reading.json'));
const subjectBooks = loadSubjectBooks(root);
const historicalScenes = loadHistoricalScenes(root, subjectBooks, topics);
const {names: polityNames} = loadPolityNames(root);
writeFileSync(join(root, 'data/topics.json'), JSON.stringify(topics), 'utf8');
const topicIds = new Set();
const worldEventChapters = new Map();
for (const t of topics) {
  if (topicIds.has(t.id) || !t.id || !t.title || !Number.isFinite(t.from) || t.from > t.to || !t.chapters.length) throw new Error('专题结构不合法');
  topicIds.add(t.id);
  const chapterIds = new Set();
  for (const c of t.chapters) {
    if (chapterIds.has(c.id) || !c.id || !c.sections.length || !c.sources.length || c.year < t.from || c.year > t.to) throw new Error('专题章节不合法');
    chapterIds.add(c.id);
    if (c.opening && (!c.opening.headline || !c.opening.text || !c.opening.refs?.length ||
      c.opening.refs.some((index) => !Number.isInteger(index) || !c.sources[index]))) throw new Error('专题开篇或来源不合法：' + c.id);
    if (c.mapStory) {
      const { title, summary, worldEntryId, places, participants, refs } = c.mapStory;
      const placeIds = new Set(['main', ...places.map((p) => p.id)]);
      if (!c.place || !title || !summary || !worldEntryId || worldEventChapters.has(worldEntryId) ||
        !refs?.length || refs.some((index) => !Number.isInteger(index) || !c.sources[index]) ||
        !participants?.length || participants.some((p) => !p.name || !p.role ||
          (p.members && (!Array.isArray(p.members) || p.members.some((name) => !name)))) ||
        !places.length || placeIds.size !== places.length + 1 ||
        places.some((p) => !p.id || !p.name || !p.role || !Number.isFinite(p.lon) || Math.abs(p.lon) > 180 ||
          !Number.isFinite(p.lat) || Math.abs(p.lat) > 90)) {
        throw new Error('专题地图的地点、参与方或来源不合法：' + c.id);
      }
      worldEventChapters.set(worldEntryId, c);
    }
    for (const s of c.sources) if (!/^https:\/\//.test(s.url)) throw new Error('专题来源必须是 HTTPS');
  }
}

/* ── 数据合法性检查：坏数据在构建时就报错，别到手机上白屏 ── */
const problems = [];
for (const f of ['data/world.json', 'data/polity.bin.gz', 'data/relief.jpg']) {
  if (!existsSync(join(root, f))) problems.push('缺少 ' + f + '（先跑 node tools/build-data.js）');
}
if (!existsSync(join(root, 'data/earth-detail.jpg'))) problems.push('缺少仓库中的高清地表贴图 data/earth-detail.jpg');
if (!existsSync(terrainPath)) problems.push('缺少仓库中的高程法线贴图 data/terrain-4k-v1.png');
let world = null;
if (!problems.length) {
  world = JSON.parse(rd('data', 'world.json'));
  const ids = new Set(world.regions.map((r) => r.id));
  const entries = new Map(world.entries.map((e) => [e.id, e]));
  const books = new Map(subjectBooks.map((book) => [book.id, book]));
  const chapterEvents = new Set(subjectBooks.flatMap((book) => book.chapters.flatMap((chapter) => chapter.eventIds || [])));
  for (const [id, path] of Object.entries(worldReading)) {
    const [bookId, chapterId, extra] = path.split('/');
    const event = entries.get(id);
    const book = books.get(bookId);
    const target = chapterId ? book?.chapters.find((chapter) => chapter.id === chapterId) : book;
    const start = timelineNotes[id]?.start ?? event?.start;
    const end = timelineNotes[id]?.end ?? (event?.point ? event.start : event?.end);
    if (chapterEvents.has(id) || extra !== undefined || !event || !target || start > (target.to ?? Infinity) || end < target.from) {
      problems.push('年份阅读入口无效：' + id + ' → ' + path);
    }
  }
  for (const [id, chapter] of worldEventChapters) {
    const event = entries.get(id);
    if (!event || chapter.year < event.start || chapter.year > (event.point ? event.start : event.end)) {
      problems.push('专题地图对应的世界事件或年份无效：' + id);
    }
  }
  for (const [id, note] of Object.entries(timelineNotes)) {
    const entry = entries.get(id);
    if (!entry || (note.start ?? entry.start) > (note.end ?? entry.end ?? entry.start)) problems.push('无效的年表条目：' + id);
    if (!note.paragraphs?.length || !note.sources?.length || note.sources.some((s) => !s.title || !/^https:\/\//.test(s.url))) problems.push('年表正文或来源缺失：' + id);
    if (note.related) {
      const topic = topics.find((t) => t.id === note.related?.topicId);
      const chapter = topic?.chapters.find((c) => c.id === note.related.chapterId);
      if (!topic || (note.related.chapterId && !chapter)) problems.push('无效的年表延伸阅读：' + id);
    }
  }
  const hasChinese = (value) => typeof value === 'string' && /\p{Script=Han}/u.test(value);
  for (const r of world.regions) {
    if (!hasChinese(r.zh)) problems.push('地区缺少中文名称：' + r.id);
  }
  for (const e of world.entries) {
    if (!ids.has(e.region)) problems.push(`条目 ${e.id} 指向不存在的地区 ${e.region}`);
    if (typeof e.start !== 'number') problems.push(`条目 ${e.id} start 不是数字`);
    if (!e.point && typeof e.end !== 'number') problems.push(`条目 ${e.id} 缺 end`);
    if (!hasChinese(e.zh)) problems.push('世界表条目缺少中文标题：' + e.id);
  }
  for (const [iso, path] of world.map) {
    if (typeof path !== 'string' || !/^M/.test(path.trim())) problems.push(`国界 ${iso} 的 path 不合法`);
    if (/^[A-Z]{2}$/.test(iso) && !hasChinese(world.isoNames[iso])) problems.push('现代地图缺少中文名称：' + iso);
  }
  if (!world.entries.length) problems.push('年表为空');
  if (!world.map.length) problems.push('国界为空');
}
if (problems.length) {
  console.error('数据有问题：\n  ' + [...new Set(problems)].slice(0, 20).join('\n  '));
  process.exit(1);
}

const put = (hay, needle, value) => {
  const i = hay.indexOf(needle);
  if (i < 0) throw new Error('模板缺少占位符 ' + needle);
  return hay.slice(0, i) + value + hay.slice(i + needle.length);
};
const page = (atlasJson, reliefB64, polityB64, earthDetailB64 = '', terrainB64 = '') => {
  let h = shell;
  h = put(h, '/*CSS*/', css);
  h = put(h, '/*CLOUDS*/', readFileSync(join(root, 'data/clouds.png')).toString('base64'));
  h = put(h, '/*EARTH*/', readFileSync(join(root, 'data/earth.jpg')).toString('base64'));
  h = put(h, '/*EARTH_DETAIL*/', earthDetailB64);
  h = put(h, '/*TERRAIN*/', terrainB64);
  h = put(h, '/*APP*/', app);
  h = put(h, '/*ATLAS*/', atlasJson);
  h = put(h, '/*RELIEF*/', reliefB64);
  h = put(h, '/*POLITY*/', polityB64);
  h = put(h, '/*POLITY_NAMES*/', JSON.stringify([...polityNames]).replace(/</g, '\\u003c'));
  h = put(h, '/*TOPICS*/', JSON.stringify(topics).replace(/</g, '\\u003c'));
  h = put(h, '/*SUBJECT_BOOKS*/', JSON.stringify(subjectBooks).replace(/</g, '\\u003c'));
  h = put(h, '/*HISTORICAL_SCENES*/', JSON.stringify(historicalScenes).replace(/</g, '\\u003c'));
  h = put(h, '/*TIMELINE_NOTES*/', JSON.stringify(timelineNotes).replace(/</g, '\\u003c'));
  h = put(h, '/*WORLD_READING*/', JSON.stringify(worldReading).replace(/</g, '\\u003c'));
  return h;
};

/* 线上版：地球数据外置，阅读内容随页面提供 */
const online = page('', '', '');
writeFileSync(join(root, 'index.html'), online, 'utf8');

/* 单文件版：全部内嵌 */
const offline = page(
  JSON.stringify(world),
  readFileSync(join(root, 'data', 'relief.jpg')).toString('base64'),
  readFileSync(join(root, 'data', 'polity.bin.gz')).toString('base64'),
  readFileSync(join(root, 'data', 'earth-detail.jpg')).toString('base64'),
  readFileSync(terrainPath).toString('base64'),
).replace('href="favicon-32.png?v=4"', 'href="data:image/png;base64,' + readFileSync(join(root, 'favicon-32.png')).toString('base64') + '"')
 .replace('href="apple-touch-icon.png?v=4"', 'href="data:image/png;base64,' + readFileSync(join(root, 'apple-touch-icon.png')).toString('base64') + '"')
 .replace('href="favicon.ico?v=4"', 'href="data:image/x-icon;base64,' + readFileSync(join(root, 'favicon.ico')).toString('base64') + '"')
 .replace('<link rel="manifest" href="manifest.webmanifest?v=4">', '');
writeFileSync(join(root, 'index.offline.html'), offline, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`index.html          ${kb(statSync(join(root, 'index.html')).size)}   （专题内嵌，地球数据按需加载）`);
console.log(`index.offline.html  ${kb(statSync(join(root, 'index.offline.html')).size)}   （全内嵌，双击可开）`);
console.log(`  data/world.json       ${kb(statSync(join(root, 'data/world.json')).size)}`);
console.log(`  data/polity.bin.gz    ${kb(statSync(join(root, 'data/polity.bin.gz')).size)}`);
console.log(`  data/relief.jpg       ${kb(statSync(join(root, 'data/relief.jpg')).size)}`);
console.log(`  data/terrain-4k-v1.png ${kb(statSync(terrainPath).size)}`);
console.log(`  年表 ${world.entries.length} 条 · 地区 ${world.regions.length} 个 · 国界 ${world.map.length} 块`);
