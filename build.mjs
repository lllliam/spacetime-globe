#!/usr/bin/env node
/* 构建两个产物：
 *   index.html          线上版：阅读内容内嵌，地球数据按需加载
 *   index.offline.html  单文件版：数据全内嵌，双击即开、可离线
 */
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadHistoryModel } from './tools/history-model.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const rd = (...p) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const terrainPath = join(root, 'data', 'terrain-4k-v1.png');

const shell = rd('src', 'shell.html');
const css = ['app.css', 'chrome.css', 'reading.css'].map(name => rd('src', name)).join('\n');
const readingMarker = '/* ───────────── 19. 启动 ───────────── */';
const appSource = rd('src', 'app.js');
if (!appSource.includes(readingMarker)) throw new Error('缺少阅读模块插入位置');
const app = appSource.replace(readingMarker, ['history-rules.js', 'session-state.js', 'reading.js', 'subject-reader.js', 'event-map.js', 'year-discovery.js', 'chrome.js', 'year-control.js']
  .map((file) => rd('src', file)).join('\n') + '\n' + readingMarker);
const { world, books:subjectBooks, topics, scenes:historicalScenes, notes:timelineNotes,
  eventLinks, mapBindings, metadata, polityNames:{names:polityNames} } = loadHistoryModel(root);
for (const file of ['data/polity.bin.gz','data/relief.jpg','data/earth-detail.jpg','data/terrain-4k-v1.png']) {
  if (!existsSync(join(root,file))) throw new Error('构建缺少资源 ' + file);
}
writeFileSync(join(root, 'data/topics.json'), JSON.stringify(topics), 'utf8');

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
  h = put(h, '/*WORLD_READING*/', JSON.stringify([...eventLinks]).replace(/</g, '\\u003c'));
  h = put(h, '/*HISTORY_MAP_BINDINGS*/', JSON.stringify(mapBindings).replace(/</g, '\\u003c'));
  h = put(h, '/*HISTORY_MAP_SOURCES*/', JSON.stringify(metadata).replace(/</g, '\\u003c'));
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
