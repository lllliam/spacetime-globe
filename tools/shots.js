/* 重新生成 README 用的截图：node tools/shots.js */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT, findBrowser, buildHarness } = require('./harness.js');

const BROWSER = findBrowser();
if (!BROWSER) { console.error('找不到 Chromium / Edge'); process.exit(2); }
const PORT = 9800 + Math.floor(Math.random() * 100);
const OUT = path.join(ROOT, 'docs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { url, dir } = buildHarness('shots');
  const proc = spawn(BROWSER, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}/profile-shots`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=390,844', '--hide-scrollbars', '--allow-file-access-from-files', url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
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
  await sleep(2800);

  const js = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name) => {
    await sleep(500);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('docs/' + name + '.png');
  };

  /* 静音自转、藏起引导，再逐张拍 */
  await js(`(()=>{ window.__t.stopSpin(); const h=document.getElementById('hint'); h.style.transition='none'; h.classList.add('gone'); })()`);
  await shot('today');

  await js(`(()=>{ window.__t.setYear(1900); window.__t.state.yaw = -1.60; window.__t.state.tilt = 0.30; window.__t.redraw(); })()`);
  await shot('year-1900');

  await js(`(()=>{ window.__t.setYear(-500); window.__t.state.yaw = -0.30; window.__t.state.tilt = 0.42; window.__t.redraw(); })()`);
  await shot('year-bc500');

  await js(`window.__t.setYear(1500)`);
  await sleep(250);
  await js(`document.getElementById('year').click()`);
  await shot('world-1500');

  ws.close(); proc.kill();
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
