/* 测试基础设施（不参与构建）
 * - findBrowser()   找 Chromium / Edge
 * - buildHarness()  把 index.html 复制成 _harness.html 并注入调试钩子（同目录，data/ 相对路径可用）
 * - startServer()   起一个静态服务器（应用现在走 fetch 取数据，必须 http 而不是 file://）
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');

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
  bootBackground: getComputedStyle(bootEl).backgroundColor,
  get pk(){ return pk }, get summary(){ return summary },
  get rendererKind(){ const r = glr || fallback; return r && r.kind },
  get polityLoaded(){ return !!(pk && polityState.loaded) },
  pick: pickAt, mapPointAt, ensurePolity,
  setLayer(id){ chrome.followTime = id === 'polity'; chrome.natural = false; setLayer(id); syncHud(); },
  openEntity, openBook, closeBook, closeSheet,
  get sheet(){ return sheetState },
  get sheetSettled(){ return !sheetMotion },
  get cloudDrift(){ return cloudDrift },
  entityById, entityByKey, focusKeyOf,
  polityNames, polityRelations, historySubjects, subjectEntityName, historySubjectFor, subjectIdentitySubtitle,
  get reading(){ return reading },
  get session(){ return session },
  get canonicalEntries(){ return canonicalEntries }, get canonicalEventById(){ return canonicalEventById },
  get globeFramePending(){ return !!rafId },
  get globeSettled(){ return !globeFlyRaf },
  captureReadingPosition,
  get topics(){return TOPICS}, subjectBooks, subjectBookForEntity, historyBindingsFor, recommendChapters, worldReadingTarget, worldReadingTargets,
  readingGoBack, closeReader,
  get worldEvent(){ return worldEvent },
  historicalScenes, beginReading, openReadingScene, applySceneStep, resolveRouteVectors, drawSceneRoutes, readingPlaceVector, layout,
  holdPolity() {
    const original = ensurePolity;
    polityState.loaded = false;
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    ensurePolity = () => pending;
    return loaded => { ensurePolity = original; polityState.loaded = loaded; resolve(); };
  },
  forgetPolity() { polityState.loaded = false; },
  get polityFailure(){return !polityState.loading && polityState.error},
  get observationNatural(){ return chrome.natural },
  traceObservationLines() {
    const dashes = [];
    let arrows = 0;
    const set = vctx.setLineDash, fill = vctx.fill;
    vctx.setLineDash = function(pattern){ dashes.push(pattern); return set.call(this,pattern); };
    vctx.fill = function(...args){ arrows++; return fill.apply(this,args); };
    try { drawSceneRoutes(worldEvent,rotation()); }
    finally { vctx.setLineDash=set; vctx.fill=fill; }
    return {dashes,arrows};
  },
  get timeline(){ return { position: vernierPosition, year: yearAtIndex(vernierPosition), moving: !!vernierGlideFrame }; },
  get homeCamera(){ return HOME_CAMERA; },
  get yearBounds(){ return { min:YMIN, max:YMAX, historicalMin:POLITY_START, historicalMax:POLITY_END }; },
  get vecCount(){ return vecShapes.length },
  get vecShapes(){ return vecShapes },
  prepareVector, drawVector, svgRings, rotation,
  commitYear, saveVisibleSession,
  setYear: commitYear, parseYear, yearEventGroups, concreteEventStarts,
  clearTimelineEntries(){ entries = []; updateVernier(); },
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

function startServer(port = 0, {cacheControl = 'no-cache'} = {}) {
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
          'cache-control': cacheControl,
        });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('404');
      }
    });
    srv.listen(port, '127.0.0.1', () => resolve({ server: srv, port: srv.address().port }));
  });
}

async function until(check, label, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    const result = await check();
    if (result) return result;
    await wait(100);
  }
  throw new Error(label);
}

async function connectBrowser(browser, profile) {
  const proc = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let ws;
  try {
    const endpoint = await until(async () => {
      try {
        const port = parseInt(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'), 10);
        const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        return tabs.find(tab => tab.type === 'page')?.webSocketDebuggerUrl;
      } catch { return null; }
    }, 'Test browser did not start');
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const pending = new Map(), events = new Map();
    let next = 0;
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method) { events.get(message.method)?.(message.params); return; }
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
    };
    ws.onclose = () => { for (const call of pending.values()) call.reject(new Error('Browser disconnected')); pending.clear(); };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params }));
    });
    const js = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.result.description || expression);
      return result.result.value;
    };
    const size = (width, height, mobile = true, deviceScaleFactor = 1) => send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile, screenWidth:width, screenHeight:height,
    });
    const open = async url => {
      const previous = await js('performance.timeOrigin');
      await send('Page.navigate', { url });
      await until(async () => {
        try { return await js('performance.timeOrigin !== ' + previous + ' && !!window.__t && !document.querySelector("#boot")'); }
        catch { return false; }
      }, 'Page did not finish initialization');
    };
    const close = async () => {
      const exited = new Promise(resolve => proc.once('exit', resolve));
      await Promise.race([send('Browser.close').catch(() => {}), wait(1800)]);
      await Promise.race([exited, wait(2500)]);
      ws.close();
      if (proc.exitCode === null) proc.kill();
      await exited;
    };
    await send('Page.enable');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await size(402, 874);
    return { send, js, size, open, close, events };
  } catch (error) {
    ws?.close();
    proc.kill();
    throw error;
  }
}

module.exports = { ROOT, findBrowser, buildHarness, startServer, until, connectBrowser };
