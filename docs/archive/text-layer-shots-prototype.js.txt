/* 文本层截图：时期卡片 + 分节说明 + 政权中文名 */
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const { findBrowser, buildHarness, startServer } = require('./harness.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  buildHarness();
  const { server, port } = await startServer(0);
  const dc = 9980;
  const proc = spawn(findBrowser(), [
    '--headless=new', `--remote-debugging-port=${dc}`, `--user-data-dir=${os.tmpdir()}/globe-text`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=390,844',
    `http://127.0.0.1:${port}/_harness.html`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let t = null;
  for (let i = 0; i < 100 && !t; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${dc}/json/list`)).json(); t = l.find((x) => x.type === 'page' && x.url.includes('_harness')); } catch { }
    if (!t) await sleep(200);
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(Error(JSON.stringify(m.error))) : p.r(m.result); } };
  const send = (method, params = {}) => new Promise((r, j) => { const m = { id: ++n, method, params }; pend.set(m.id, { r, j }); ws.send(JSON.stringify(m)); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.reload');
  const js = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { THREW: r.exceptionDetails.text, d: (r.exceptionDetails.exception || {}).description };
    return r.result.value;
  };
  for (let i = 0; i < 140; i++) { if (await js('!!(window.__t && window.__t.partition.shapes.length && !document.getElementById("boot"))')) break; await sleep(250); }
  const shot = async (name) => { await sleep(700); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('docs/' + name + '.png', Buffer.from(r.data, 'base64')); console.log('docs/' + name + '.png'); };

  await js('window.__t.stopSpin()');
  await js('window.__t.loadStories()');
  await sleep(1200);
  await js(`window.__t.setLayer('polity')`);
  for (let i = 0; i < 60; i++) { if (await js('window.__t.polityLoaded === true')) break; await sleep(250); }
  await js('window.__t.setYear(1550)');
  await sleep(500);
  await js(`(() => { const t = window.__t; const q = t.screenOf(26*Math.PI/180, 41*Math.PI/180); t.openEntity('polity', t.pick(q.x, q.y)); })()`);
  await sleep(900);
  await js('window.__t.openBook()');
  await sleep(1100);
  console.log('文本抽查', JSON.stringify(await js(`(() => {
    const b = document.getElementById('sheet-inner');
    return {
      title: (b.querySelector('h2') || {}).textContent,
      eracard: (b.querySelector('.eracard b') || {}).textContent + ' / ' + ((b.querySelector('.eracard p') || {}).textContent || '').slice(0, 40),
      secnotes: [...b.querySelectorAll('.secnote')].slice(0, 3).map(x => x.textContent),
      lede: ((b.querySelector('.lede') || {}).textContent || '').slice(0, 60),
      noProse: b.querySelectorAll('.noprose').length,
      articles: b.querySelectorAll('article').length,
    };
  })()`), null, 1));
  await js('document.getElementById("sheet-scroll").scrollTop = 0');
  await shot('book-top');
  await js('document.getElementById("sheet-scroll").scrollTop = 620');
  await shot('polity-book');
  ws.close(); proc.kill(); server.close();
})();
