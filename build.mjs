#!/usr/bin/env node
/* 构建两个产物：
 *   index.html          线上版：壳 + 代码，地球数据走 data/ 按需加载，专题内嵌（HTML 约550 KB）
 *   index.offline.html  单文件版：数据全内嵌，双击即开、可离线（约3.4 MB）
 *
 * 数据来自 data/：world.json / polity.bin.gz / relief.jpg
 */
import { readFileSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const rd = (...p) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

const shell = rd('src', 'shell.html');
const css = rd('src', 'app.css') + '\n' + rd('src','chrome.css');
const readingMarker = '/* ───────────── 19. 启动 ───────────── */';
const appSource = rd('src', 'app.js');
if (!appSource.includes(readingMarker)) throw new Error('缺少阅读模块插入位置');
const app = appSource.replace(readingMarker, rd('src', 'reading.js') + '\n' + rd('src', 'chrome.js') + '\n' + readingMarker);
const topics = readdirSync(join(root, 'data/topics')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(rd('data', 'topics', f)));
writeFileSync(join(root, 'data/topics.json'), JSON.stringify(topics), 'utf8');
const topicIds = new Set();
for (const t of topics) {
  if (topicIds.has(t.id) || !t.id || !t.title || !Number.isFinite(t.from) || t.from > t.to || !t.chapters.length) throw new Error('专题结构不合法');
  topicIds.add(t.id);
  const chapterIds = new Set();
  for (const c of t.chapters) {
    if (chapterIds.has(c.id) || !c.id || !c.sections.length || !c.sources.length || c.year < t.from || c.year > t.to) throw new Error('专题章节不合法');
    chapterIds.add(c.id);
    for (const s of c.sources) if (!/^https:\/\//.test(s.url)) throw new Error('专题来源必须是 HTTPS');
  }
}

/* ── 数据合法性检查：坏数据在构建时就报错，别到手机上白屏 ── */
const problems = [];
for (const f of ['data/world.json', 'data/polity.bin.gz', 'data/relief.jpg']) {
  if (!existsSync(join(root, f))) problems.push('缺少 ' + f + '（先跑 node tools/build-data.js）');
}
let world = null;
if (!problems.length) {
  world = JSON.parse(rd('data', 'world.json'));
  const ids = new Set(world.regions.map((r) => r.id));
  for (const e of world.entries) {
    if (!ids.has(e.region)) problems.push(`条目 ${e.id} 指向不存在的地区 ${e.region}`);
    if (typeof e.start !== 'number') problems.push(`条目 ${e.id} start 不是数字`);
    if (!e.point && typeof e.end !== 'number') problems.push(`条目 ${e.id} 缺 end`);
  }
  for (const [iso, path] of world.map) {
    if (typeof path !== 'string' || !/^M/.test(path.trim())) problems.push(`国界 ${iso} 的 path 不合法`);
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
const page = (atlasJson, reliefB64, polityB64, storiesJson) => {
  let h = shell;
  h = put(h, '/*CSS*/', css);
  h = put(h, '/*APP*/', app);
  h = put(h, '/*ATLAS*/', atlasJson);
  h = put(h, '/*RELIEF*/', reliefB64);
  h = put(h, '/*POLITY*/', polityB64);
  h = put(h, '/*STORIES*/', storiesJson);
  h = put(h, '/*TOPICS*/', JSON.stringify(topics).replace(/</g, '\\u003c'));
  return h;
};

/* 线上版：数据外置（书里的正文按需取） */
const online = page('', '', '', '');
writeFileSync(join(root, 'index.html'), online, 'utf8');

/* 单文件版：全部内嵌 */
const storiesRaw = existsSync(join(root, 'data', 'stories.json')) ? rd('data', 'stories.json') : '';
const offline = page(
  JSON.stringify(world),
  readFileSync(join(root, 'data', 'relief.jpg')).toString('base64'),
  readFileSync(join(root, 'data', 'polity.bin.gz')).toString('base64'),
  storiesRaw,
).replace('href="favicon.png?v=3"', 'href="data:image/png;base64,' + readFileSync(join(root, 'favicon.png')).toString('base64') + '"')
 .replace('href="icon.png?v=3"', 'href="data:image/png;base64,' + readFileSync(join(root, 'icon.png')).toString('base64') + '"')
 .replace('<link rel="manifest" href="manifest.webmanifest?v=3">', '');
writeFileSync(join(root, 'index.offline.html'), offline, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`index.html          ${kb(statSync(join(root, 'index.html')).size)}   （专题内嵌，地球数据按需加载）`);
console.log(`index.offline.html  ${kb(statSync(join(root, 'index.offline.html')).size)}   （全内嵌，双击可开）`);
console.log(`  data/world.json       ${kb(statSync(join(root, 'data/world.json')).size)}`);
console.log(`  data/polity.bin.gz    ${kb(statSync(join(root, 'data/polity.bin.gz')).size)}`);
console.log(`  data/relief.jpg       ${kb(statSync(join(root, 'data/relief.jpg')).size)}`);
console.log(`  年表 ${world.entries.length} 条 · 地区 ${world.regions.length} 个 · 国界 ${world.map.length} 块`);
