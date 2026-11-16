#!/usr/bin/env node
/* 构建两个产物：
 *   index.html          线上版：壳 + 代码，数据走 data/ 按需加载（首屏 ~150 KB）
 *   index.offline.html  单文件版：数据全内嵌，双击即开、可离线（约 6 MB）
 *
 * 数据来自 data/：world.json / polity.bin.gz / relief.jpg
 */
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const rd = (...p) => readFileSync(join(root, ...p), 'utf8');

const shell = rd('src', 'shell.html');
const css = rd('src', 'app.css');
const app = rd('src', 'app.js');

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
const page = (atlasJson, reliefB64, polityB64) => {
  let h = shell;
  h = put(h, '/*CSS*/', css);
  h = put(h, '/*APP*/', app);
  h = put(h, '/*ATLAS*/', atlasJson);
  h = put(h, '/*RELIEF*/', reliefB64);
  h = put(h, '/*POLITY*/', polityB64);
  return h;
};

/* 线上版：数据外置 */
const online = page('', '', '');
writeFileSync(join(root, 'index.html'), online, 'utf8');

/* 单文件版：全部内嵌 */
const offline = page(
  JSON.stringify(world),
  readFileSync(join(root, 'data', 'relief.jpg')).toString('base64'),
  readFileSync(join(root, 'data', 'polity.bin.gz')).toString('base64'),
);
writeFileSync(join(root, 'index.offline.html'), offline, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`index.html          ${kb(statSync(join(root, 'index.html')).size)}   （数据外置，首屏只需 world.json）`);
console.log(`index.offline.html  ${kb(statSync(join(root, 'index.offline.html')).size)}   （全内嵌，双击可开）`);
console.log(`  data/world.json       ${kb(statSync(join(root, 'data/world.json')).size)}`);
console.log(`  data/polity.bin.gz    ${kb(statSync(join(root, 'data/polity.bin.gz')).size)}`);
console.log(`  data/relief.jpg       ${kb(statSync(join(root, 'data/relief.jpg')).size)}`);
console.log(`  年表 ${world.entries.length} 条 · 地区 ${world.regions.length} 个 · 国界 ${world.map.length} 块`);
