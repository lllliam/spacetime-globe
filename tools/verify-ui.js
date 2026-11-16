#!/usr/bin/env node
/* 无头浏览器回归：把 index.html 复制一份、注入测试钩子，然后用 CDP 驱动真实交互。
 * 用法：node tools/verify-ui.js             （自动找 Chromium / Edge）
 *       EDGE=/path/to/chrome node tools/verify-ui.js
 *       NOGL=1 node tools/verify-ui.js      （强制走 Canvas2D 兜底）
 * 退出码 0 = 全部通过。 */
const { spawn } = require('child_process');
const { findBrowser, buildHarness } = require('./harness.js');

const BROWSER = findBrowser();
if (!BROWSER) {
  console.error('找不到 Chromium / Edge，可用 EDGE=... 指定可执行文件');
  process.exit(2);
}

const PORT = 9500 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { url, dir } = buildHarness();
  const args = [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}/profile`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=390,844', '--allow-file-access-from-files', url,
  ];
  if (process.env.NOGL) args.push('--disable-webgl', '--disable-3d-apis');
  const proc = spawn(BROWSER, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
    } catch { }
    if (!target) await sleep(250);
  }
  if (!target) { console.error('浏览器没有起来'); proc.kill(); process.exit(2); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let n = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const m = { id: ++n, method, params }; pending.set(m.id, { res, rej }); ws.send(JSON.stringify(m));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.reload');
  await sleep(2800);

  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
    return r.result.value;
  };
  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(320);
  };
  const drag = async (x0, y0, x1, y1, steps = 10) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, button: 'left', buttons: 1 });
      await sleep(16);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(360);
  };

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok });
    console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  };

  const kind = await js('window.__t.rendererKind');
  check('渲染器已就绪', kind === (process.env.NOGL ? 'canvas2d' : 'webgl'), kind);

  /* 画面 ↔ 拾取 一致：把已知经纬度投影到屏幕，再拾取回来 */
  const align = await js(`(() => {
    const t = window.__t; const bad = []; let n = 0;
    for (const [iso, lon, lat] of [['CN',110,34],['IN',78,22],['AU',134,-25],['EG',30,27],['FR',2,47],['RU',60,58],['BR',-52,-10],['US',-98,39],['ZA',24,-29],['JP',138,36]]) {
      const p = t.screenOf(lon*Math.PI/180, lat*Math.PI/180);
      if (!p.front) continue;
      n++;
      const got = t.isoOf(t.pick(p.x, p.y));
      if (got !== iso) bad.push([iso, got]);
    }
    return { n, bad };
  })()`);
  check('点击命中与画面一致', align.bad.length === 0 && align.n >= 4, align);

  const p = await js(`(() => { const q = window.__t.screenOf(110*Math.PI/180, 34*Math.PI/180); return {x:q.x, y:q.y}; })()`);
  await tap(p.x, p.y);
  const sheet = await js(`({open: document.getElementById('sheet').classList.contains('open'),
    title: (document.querySelector('#sheet h2')||{}).textContent})`);
  check('点中国打开抽屉', sheet.open && /中国/.test(sheet.title || ''), sheet);

  const y0 = await js('window.__t.state.yaw');
  await drag(300, 380, 160, 380, 12);
  await sleep(300);
  const y1 = await js('window.__t.state.yaw');
  check('拖动改变经度', Math.abs(y1 - y0) > 0.15, { y0: +y0.toFixed(3), y1: +y1.toFixed(3) });

  const tr = await js(`(() => { const b = document.getElementById('track').getBoundingClientRect(); return {x:b.x, y:b.y, w:b.width}; })()`);
  await tap(tr.x + 18 + (tr.w - 36) * 0.55, tr.y + 62);
  const mid = await js(`document.getElementById('year').textContent`);
  await tap(tr.x + 18 + (tr.w - 36) * 0.20, tr.y + 62);
  const early = await js(`document.getElementById('year').textContent`);
  check('时间轴可定位年份', mid !== early && /年/.test(mid) && /年/.test(early), { mid, early });

  await js(`document.getElementById('year').click()`);
  await sleep(320);
  const world = await js(`({visible: !document.getElementById('overlay').hidden,
    rows: document.querySelectorAll('.wrow').length,
    title: document.getElementById('overlay-title').textContent})`);
  check('年份 → 这一年世界列表', world.visible && world.rows > 0, world);

  const row = await js(`(() => { const e = document.querySelector('.wrow'); const b = e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; })()`);
  await tap(row.x, row.y);
  const fromRow = await js(`({hidden: document.getElementById('overlay').hidden,
    sheet: document.getElementById('sheet').classList.contains('open')})`);
  check('列表条目可跳到国家', fromRow.hidden && fromRow.sheet, fromRow);

  await js(`document.getElementById('globe').dispatchEvent(new WheelEvent('wheel',{deltaY:-400, clientX:195, clientY:380, bubbles:true, cancelable:true}))`);
  await sleep(450);
  const zoom = await js('window.__t.state.zoom');
  check('滚轮放大', zoom > 1.5, { zoom: +zoom.toFixed(2) });

  const align2 = await js(`(() => { const t = window.__t; const bad = []; let n = 0;
    for (const [iso, lon, lat] of [['CN',110,34],['IN',78,22],['AU',134,-25]]) {
      const q = t.screenOf(lon*Math.PI/180, lat*Math.PI/180);
      if (!q.front || q.x < 0 || q.y < 0 || q.x > innerWidth || q.y > innerHeight) continue;
      n++; if (t.isoOf(t.pick(q.x, q.y)) !== iso) bad.push(iso);
    } return { n, bad }; })()`);
  check('放大后仍点得准', align2.bad.length === 0 && align2.n > 0, align2);

  await js(`window.__req = 0; (function t(){ window.__req++; requestAnimationFrame(t); })();`);
  await js(`document.getElementById('globe').dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:200,clientY:400,pointerType:'touch',bubbles:true}))`);
  await sleep(1000);
  const fps = await js('window.__req');
  check('渲染循环在跑', fps > 12, { fps });

  const errs = await js('window.__errs');
  check('控制台无异常', errs.length === 0, errs.slice(0, 4));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? 'FAILED' : 'PASSED'} · ${results.length - failed}/${results.length}`);
  ws.close(); proc.kill();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('verify 出错:', e.message); process.exit(2); });
