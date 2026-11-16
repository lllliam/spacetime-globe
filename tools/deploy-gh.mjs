#!/usr/bin/env node
/* 用 GitHub Contents API 把本地文件推上去（不需要装 git）。
 *
 *   $env:GITHUB_TOKEN = "ghp_xxx"      # fine-grained 或 classic token，需要 repo contents 写权限
 *   node tools/deploy-gh.mjs --dry     # 只看会推哪些文件，不写
 *   node tools/deploy-gh.mjs           # 真推
 *
 * 每个文件一次 PUT，都会生成一次提交；想只要一次提交就用 git。
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const OWNER = process.env.GH_OWNER || 'lllliam';
const REPO = process.env.GH_REPO || 'spacetime-globe';
const TOKEN = process.env.GITHUB_TOKEN || '';
const DRY = process.argv.includes('--dry');
const MESSAGE = process.env.GH_MESSAGE || 'v1.0 重写：WebGL 球体渲染、拾取与画面一致、省电、离线更新';

const FILES = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'README.md',
  'package.json',
  'build.mjs',
  'icon.png',
  'icon-512.png',
  'src/shell.html',
  'src/app.css',
  'src/app.js',
  'data/atlas.json',
  'data/relief.jpg',
  'tools/harness.js',
  'tools/serve.mjs',
  'tools/shots.js',
  'tools/verify-ui.js',
  'tools/deploy-gh.mjs',
  'docs/today.png',
  'docs/year-1900.png',
  'docs/year-bc500.png',
  'docs/world-1500.png',
];

const API = 'https://api.github.com';
const headers = {
  'user-agent': 'spacetime-globe-deploy',
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
};
if (TOKEN) headers.authorization = 'Bearer ' + TOKEN;

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { }
  return { ok: res.ok, status: res.status, json, text };
}

if (!TOKEN && !DRY) {
  console.error('缺少 GITHUB_TOKEN。先执行：$env:GITHUB_TOKEN = "ghp_xxx"');
  process.exit(2);
}

const repo = await api(`/repos/${OWNER}/${REPO}`);
if (!repo.ok) {
  console.error(`拿不到仓库信息（${repo.status}）：${repo.text.slice(0, 200)}`);
  process.exit(2);
}
const branch = repo.json.default_branch || 'main';
console.log(`仓库 ${OWNER}/${REPO} · 默认分支 ${branch}${DRY ? ' · DRY RUN' : ''}\n`);

let changed = 0, skipped = 0, failed = 0;
for (const file of FILES) {
  const abs = join(ROOT, file);
  let buf;
  try { buf = readFileSync(abs); } catch { console.log(`  skip   ${file}（本地不存在）`); skipped++; continue; }
  const b64 = buf.toString('base64');

  const head = await api(`/repos/${OWNER}/${REPO}/contents/${encodeURI(file)}?ref=${branch}`);
  const remoteSize = head.ok && head.json ? head.json.size : -1;
  if (head.ok && remoteSize === buf.length && !process.env.GH_FORCE) {
    console.log(`  same   ${file}（${buf.length} B，远端一致，跳过）`);
    skipped++;
    continue;
  }
  if (DRY) {
    console.log(`  push   ${file}  ${buf.length} B${head.ok ? `（远端 ${remoteSize} B）` : '（远端没有）'}`);
    changed++;
    continue;
  }
  const body = {
    message: MESSAGE,
    content: b64,
    branch,
    ...(head.ok && head.json && head.json.sha ? { sha: head.json.sha } : {}),
  };
  const put = await api(`/repos/${OWNER}/${REPO}/contents/${encodeURI(file)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (put.ok) {
    console.log(`  ok     ${file}  ${buf.length} B`);
    changed++;
  } else {
    console.log(`  FAIL   ${file}  ${put.status} ${put.text.slice(0, 160)}`);
    failed++;
  }
  await new Promise((r) => setTimeout(r, 250)); // 别把 secondary rate limit 撞了
}

console.log(`\n${DRY ? '将推送' : '已推送'} ${changed} 个文件，跳过 ${skipped} 个，失败 ${failed} 个`);
if (!DRY && !failed) console.log('GitHub Pages 会在 1 分钟左右自动更新；手机端首页是网络优先，下拉刷新或重开即可。');
process.exit(failed ? 1 : 0);
