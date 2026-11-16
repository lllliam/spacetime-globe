/* 生成 README 用截图：node tools/shots.js */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ROOT, findBrowser, buildHarness, startServer } = require('./harness.js');

const BROWSER = findBrowser();
if (!BROWSER) { console.error('找不到 Chromium / Edge'); process.exit(2); }
const OUT = path.join(ROOT, 'docs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  buildHarness();
  const { server, port } = await startServer(0);
  const dc = 9950 + Math.floor(Math.random() * 40);
  const proc = spawn(BROWSER, [
    '--headless=new', `--remote-debugging-port=${dc}`, `--user-data-dir=${os.tmpdir()}/globe-shots`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=390,844', '--hide-scrollbars',
    `http://127.0.0.1:${port}/_harness.html`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dc}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.includes('_harness'));
    } catch { }
    if (!target) await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let n = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const m = { id: ++n, method, params }; pending.set(m.id, { res, rej }); ws.send(JSON.stringify(m));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.reload');
  await sleep(3000);

  const js = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name) => {
    await sleep(600);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('docs/' + name + '.png');
  };

  await js(`(()=>{ const t=window.__t; t.stopSpin(); const h=document.getElementById('hint'); h.style.transition='none'; h.classList.add('gone'); })()`);
  await shot('today');

  /* 国家层 · 1900 */
  await js(`(()=>{ const t=window.__t; t.setYear(1900); t.state.yaw=-1.60; t.state.tilt=0.30; t.redraw(); })()`);
  await shot('year-1900');

  /* 政权层 · 1550 */
  await js(`window.__t.ensurePolity()`);
  for (let i = 0; i < 40; i++) { if (await js('window.__t.polityLoaded')) break; await sleep(250); }
  await js(`(()=>{ const t=window.__t; t.setLayer('polity'); t.setYear(1550); t.state.yaw=-0.55; t.state.tilt=0.42; t.redraw(); })()`);
  await shot('polity-1550');

  /* 政权层 · 1900 */
  await js(`(()=>{ const t=window.__t; t.setYear(1900); t.state.yaw=-1.60; t.state.tilt=0.30; t.redraw(); })()`);
  await shot('polity-1900');

  /* 点奥斯曼 */
  await js(`(()=>{ const t=window.__t; t.state.yaw=-0.62; t.state.tilt=0.36; t.redraw(); })()`);
  await sleep(250);
  const p = await js(`(() => { const q = window.__t.screenOf(33*Math.PI/180, 39*Math.PI/180); return {x:q.x,y:q.y}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 0 });
  await shot('polity-sheet');

  /* 这一年·世界（回到国家层） */
  await js(`(()=>{ const t=window.__t; t.setLayer('country'); t.setYear(1500); })()`);
  await sleep(300);
  await js(`document.getElementById('year').click()`);
  await shot('world-1500');

  ws.close(); proc.kill(); server.close();
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
