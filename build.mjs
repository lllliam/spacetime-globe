#!/usr/bin/env node
/* 把 src/ 与 data/ 打包成单文件 index.html（零依赖、可离线、GitHub Pages 直接托管） */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const rd = (...p) => readFileSync(join(root, ...p), 'utf8');

const shell = rd('src', 'shell.html');
const css = rd('src', 'app.css');
const app = rd('src', 'app.js');
const atlas = JSON.parse(rd('data', 'atlas.json'));
const relief = readFileSync(join(root, 'data', 'relief.jpg')).toString('base64');

/* 数据合法性检查：拼错一个字段就会让整页白屏，宁可在构建时报错 */
const problems = [];
if (!Array.isArray(atlas.regions) || !atlas.regions.length) problems.push('atlas.regions 为空');
if (!Array.isArray(atlas.entries) || !atlas.entries.length) problems.push('atlas.entries 为空');
if (!Array.isArray(atlas.map) || !atlas.map.length) problems.push('atlas.map 为空');
const regionIds = new Set(atlas.regions.map((r) => r.id));
for (const e of atlas.entries) {
  if (!e.id) problems.push('条目缺少 id');
  if (!regionIds.has(e.region)) problems.push(`条目 ${e.id} 指向不存在的地区 ${e.region}`);
  if (typeof e.start !== 'number') problems.push(`条目 ${e.id} start 不是数字`);
  if (!e.point && typeof e.end !== 'number') problems.push(`条目 ${e.id} end 不是数字`);
  if (!e.point && e.end < e.start) problems.push(`条目 ${e.id} end < start`);
}
for (const [iso, path] of atlas.map) {
  if (typeof iso !== 'string' || typeof path !== 'string' || !path.trim()) problems.push('map 项格式错误');
  if (!/^M/.test(path.trim())) problems.push(`map ${iso} 的 path 不以 M 开头`);
}
if (problems.length) {
  console.error('数据有问题：\n  ' + [...new Set(problems)].slice(0, 20).join('\n  '));
  process.exit(1);
}

/* 用函数式替换，避免 $& 之类被当成替换模式 */
const put = (hay, needle, value) => {
  const i = hay.indexOf(needle);
  if (i < 0) throw new Error('模板缺少占位符 ' + needle);
  return hay.slice(0, i) + value + hay.slice(i + needle.length);
};

let html = shell;
html = put(html, '/*CSS*/', css);
html = put(html, '/*APP*/', app);
html = put(html, '/*ATLAS*/', JSON.stringify(atlas));
html = put(html, '/*RELIEF*/', relief);

const out = join(root, 'index.html');
writeFileSync(out, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`index.html  ${kb(statSync(out).size)}`);
console.log(`  年表 ${atlas.entries.length} 条 · 地区 ${atlas.regions.length} 个 · 国界 ${atlas.map.length} 块`);
console.log(`  浮雕 ${kb(relief.length * 0.75)} · 代码 ${kb(app.length)} · 样式 ${kb(css.length)}`);
