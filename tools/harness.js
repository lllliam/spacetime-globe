/* 测试基础设施（不参与构建）
 * - findBrowser()   找 Chromium / Edge
 * - buildHarness()  把 index.html 复制成 _harness.html 并注入调试钩子（同目录，data/ 相对路径可用）
 * - startServer()   起一个静态服务器（应用现在走 fetch 取数据，必须 http 而不是 file://）
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const CANDIDATES = [
  process.env.EDGE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  for (const p of CANDIDATES) {
    try { if (fs.statSync(p).isFile()) return p; } catch { }
  }
  return null;
}

const HOOK = `
/* ===== TEST HOOK ===== */
window.__t = {
  get state(){ return state }, get view(){ return view }, get partition(){ return partition },
  get pk(){ return pk }, get summary(){ return summary },
  get rendererKind(){ const r = glr || fallback; return r && r.kind },
  get polityLoaded(){ return !!(pk && polityState.loaded) },
  pick: pickAt, mapPointAt, setLayer, ensurePolity,
  openEntity, openBook, closeBook, loadStories, closeSheet,
  get sheet(){ return sheetState },
  get sheetSettled(){ return !sheetMotion },
  get cloudDrift(){ return cloudDrift },
  entriesForBook, polityMaskOf, entityById, entityByKey, focusKeyOf,
  get stories(){ return stories },
  get reading(){ return reading },
  get readerSettled(){ return !readerMotion },
  get topics(){return TOPICS}, topicsForEntity, topicForEntity,
  readingGoBack, closeReader,
  get worldEvent(){ return worldEvent },
  get vecCount(){ return vecShapes.length },
  get vecShapes(){ return vecShapes },
  prepareVector, drawVector, svgRings, rotation,
  setYear(y){ state.year = y; onYearChanged(); },
  stopSpin(){ spinning = false; },
  redraw(){ invalidate(); },
  shapeOf(id){ return partition.shapes.find(s => s.id === id) || null; },
  decodeShape(pathId){ return polityShape(pk, pathId); },
  screenOf(lon, lat){
    const st = state, v = view;
    const ct = Math.cos(st.tilt), stt = Math.sin(st.tilt);
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    const pm = [Math.cos(lat)*Math.sin(lon), Math.sin(lat), Math.cos(lat)*Math.cos(lon)];
    const x1 = cy*pm[0] + sy*pm[2], z1 = -sy*pm[0] + cy*pm[2];
    const y2 = ct*pm[1] - stt*z1, z2 = stt*pm[1] + ct*z1;
    const Rz = v.R*st.zoom;
    return { x: v.cx + st.panX + x1*Rz, y: v.cy + st.panY - y2*Rz, front: z2 > 0 };
  },
};
`;

function buildHarness(offline = false) {
  let html = fs.readFileSync(path.join(ROOT, offline ? 'index.offline.html' : 'index.html'), 'utf8');
  const marker = '/* ───────────── 19. 启动 ───────────── */';
  if (!html.includes(marker)) throw new Error('index.html 里找不到启动标记，先跑 npm run build');
  html = html.replace(marker, HOOK + '\n' + marker);
  html = html.replace('</head>', `<script>window.__errs=[];
addEventListener('error',(e)=>window.__errs.push('error: '+(e.message||e.type)+' @'+(e.lineno||0)),true);
addEventListener('unhandledrejection',(e)=>window.__errs.push('rej: '+(e.reason&&e.reason.message||String(e.reason))));
</script></head>`);
  const file = path.join(ROOT, offline ? '_harness.offline.html' : '_harness.html');
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gz': 'application/gzip', '.bin': 'application/octet-stream',
};

function startServer(port = 0) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://x');
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
        const file = path.resolve(ROOT, rel);
        if (!file.startsWith(ROOT)) throw new Error('bad');
        const data = fs.readFileSync(file);
        res.writeHead(200, {
          'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
          'content-length': data.length,
          'cache-control': 'no-cache',
        });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('404');
      }
    });
    srv.listen(port, '127.0.0.1', () => resolve({ server: srv, port: srv.address().port }));
  });
}

module.exports = { ROOT, findBrowser, buildHarness, startServer };
