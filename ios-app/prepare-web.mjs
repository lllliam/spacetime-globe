import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const source = new URL('../index.offline.html', import.meta.url);
const web = new URL('./web/', import.meta.url);
const html = readFileSync(source, 'utf8');
const assets = html.match(/<script id="build-assets"[^>]*>([^<]*)<\/script>/)?.[1];

if (assets !== '{}' || !html.includes('data:image/jpeg;base64,')) {
  throw new Error('Run node build.mjs and use its self-contained offline output.');
}

mkdirSync(web, { recursive: true });
copyFileSync(source, new URL('index.html', web));
