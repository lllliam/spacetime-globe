/* 常见操作冒烟测试（状态驱动，避免时序假失败） */
const { spawn } = require('child_process');
const os = require('os');
const { findBrowser, buildHarness, startServer } = require('./harness.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  buildHarness();
  const { server, port } = await startServer(0);
  const profile = require('path').join(os.tmpdir(), 'globe-smoke-' + process.pid);
  const startUrl = `http://127.0.0.1:${port}/_harness.html`;
  const proc = spawn(findBrowser(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=390,844',
    startUrl,
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let t = null;
  for (let i = 0; i < 100 && !t; i++) {
    try {
      const dc = Number(require('fs').readFileSync(require('path').join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);
      const l = await (await fetch(`http://127.0.0.1:${dc}/json/list`)).json();
      t = l.find((x) => x.type === 'page' && x.url === startUrl);
    } catch { }
    if (!t) await sleep(200);
  }
  if (!t) { proc.kill(); server.close(); throw Error('测试浏览器启动失败'); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0; const pend = new Map(); const errs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(Error(JSON.stringify(m.error))) : p.r(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map((a) => a.value).join(' '));
  };
  const send = (method, params = {}) => new Promise((r, j) => { const m = { id: ++n, method, params }; pend.set(m.id, { r, j }); ws.send(JSON.stringify(m)); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.reload');
  const js = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { THREW: r.exceptionDetails.text, d: (r.exceptionDetails.exception || {}).description };
    return r.result.value;
  };
  for (let i = 0; i < 140; i++) {
    if (await js('!!(window.__t && window.__t.partition.shapes.length && !document.getElementById("boot"))')) break;
    await sleep(250);
  }
  const st = () => js(`(() => {
    const s = document.getElementById('sheet');
    return { detent: window.__t.sheet.detent, offset: window.__t.sheet.offset, tf: s.style.transform,
      open: document.body.classList.contains('sheet-open'),
      focus: window.__t.state.focus && window.__t.state.focus.key,
      year: window.__t.state.year, layer: window.__t.state.layerId,
      title: (document.querySelector('#sheet-inner h2') || {}).textContent || null };
  })()`);
  const waitFor = async (expr, ms = 2500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr)) return true; await sleep(120); } return false; };
  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(650);
  };
  const at = (lon, lat) => js(`(() => { const q = window.__t.screenOf(${lon}*Math.PI/180, ${lat}*Math.PI/180); return { x: Math.round(q.x), y: Math.round(q.y), front: q.front }; })()`);
  let pass = 0, fail = 0;
  const ok = (name, cond, detail) => { (cond ? pass++ : fail++); console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };

  await js('window.__t.stopSpin()');
  await js('window.__t.setYear(1900)');
  await sleep(400);

  /* 1. 点 → 开；点暗处 → 关；连做两次 */
  for (let i = 0; i < 2; i++) {
    const p = await at(110, 34);
    await tap(p.x, p.y);
    const s1 = await st();
    ok(`点中国开抽屉（第${i + 1}次）`, s1.open && s1.focus === 'CN', { focus: s1.focus, detent: s1.detent });
    await waitFor('!document.body.classList.contains("sheet-open")', 200).then(() => null).catch(() => null);
    await tap(195, 110);
    const s2 = await st();
    ok(`点暗处关抽屉（第${i + 1}次）`, !s2.open, { detent: s2.detent });
    await sleep(300);
  }

  /* 2. 专题节点与阅读返回 */
  const p2 = await at(110, 34);
  await tap(p2.x, p2.y);
  await js(`document.querySelector('[data-read-topic]').click()`);
  await sleep(400);
  ok('专题入口打开独立阅读', await js(`!document.getElementById('book').hidden && document.querySelectorAll('[data-reading-detail].reading-card').length===8`));
  await js(`document.querySelector('[data-reading-detail]').click()`);
  ok('专题节点包含解释与来源', await js(`document.querySelectorAll('#book-body article').length>=5 && document.querySelectorAll('.reading-sources a').length>=2`));
  await js(`document.getElementById('reading-back').click();document.getElementById('reading-back').click()`);
  ok('返回地球恢复原抽屉与年份', await js(`document.getElementById('book').hidden && __t.state.year===1900 && __t.sheet.detent==='half'`));
  await js('__t.closeSheet()');
  await sleep(500);

  /* 4. 政权层 + 点政权 */
  await js(`window.__t.setLayer('polity')`);
  await waitFor('window.__t.polityLoaded === true', 8000);
  await sleep(500);
  const p3 = await at(26, 41);
  await tap(p3.x, p3.y);
  const polSheet = await st();
  ok('政权层点开抽屉', polSheet.open && /[A-Za-z]/.test(polSheet.title || ''), { title: polSheet.title, detent: polSheet.detent });

  /* 5. 展开时间轴后直接拖动，再返回地图 */
  const yearBefore = polSheet.year;
  await js("document.getElementById('year').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}))");
  await sleep(350);
  const trackBox=await js("(()=>{const r=document.getElementById('track').getBoundingClientRect();return {x:r.x+r.width*.62,y:r.y+42}})()");
  await tap(trackBox.x,trackBox.y);
  const afterScrub=await st();
  ok('时间轴定位后显示新年份',afterScrub.year!==yearBefore&&!afterScrub.open,{before:yearBefore,after:afterScrub.year});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});

  /* 6. 切图层：抽屉应收起且不留残影 */
  await js(`window.__t.setLayer('country')`);
  await sleep(700);
  const cross = await st();
  ok('切图层收起抽屉不留残影', !cross.open && cross.layer === 'country', { open: cross.open, layer: cross.layer });

  /* 7. 缩放 + 拖动 */
  const yaw0 = await js('window.__t.state.yaw');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 420 }] });
  for (let i = 1; i <= 6; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + 18 * i, y: 420 }] }); await sleep(26); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(350);
  const yaw1 = await js('window.__t.state.yaw');
  ok('拖动地球转经度', Math.abs(yaw1 - yaw0) > 0.1, { from: +yaw0.toFixed(2), to: +yaw1.toFixed(2) });

  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 400 }, { x: 220, y: 400 }] });
  for (let i = 1; i <= 6; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180 - 8 * i, y: 400 }, { x: 220 + 8 * i, y: 400 }] }); await sleep(26); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(350);
  ok('双指放大生效', (await js('window.__t.state.zoom')) > 1.2, { zoom: +(await js('window.__t.state.zoom')).toFixed(2) });

  /* 8. 年份按钮 → 全景列表 → 关 */
  await js("document.getElementById('year').click()");
  await sleep(400);
  const ov = await js(`({ open: !document.getElementById('overlay').hidden, h: document.getElementById('overlay-body').innerHTML.length })`);
  ok('年份轻点打开全景列表', ov.open && ov.h > 200, ov);
  await js(`document.getElementById('overlay-close').click()`);
  await sleep(400);
  ok('全景列表可关闭', await js(`document.getElementById('overlay').hidden`), null);

  /* 9. 转屏 */
  await js(`(() => { const t = window.__t; const q = t.screenOf(110*Math.PI/180, 34*Math.PI/180); t.openEntity('country', t.pick(q.x, q.y)); })()`);
  await sleep(600);
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  const land = await st();
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  const port2 = await st();
  ok('转屏后抽屉仍有效', Number.isFinite(land.offset) && Number.isFinite(port2.offset) && !/NaN/.test(port2.tf), { land: land.offset, port: port2.offset });

  /* 10. Esc */
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(600);
  ok('Esc 收起抽屉', !(await st()).open);

  ok('全程无控制台异常', errs.length === 0, errs.slice(0, 3));
  console.log(`\n${fail === 0 ? 'PASSED' : 'FAILED'} · ${pass}/${pass + fail}`);
  await Promise.race([send('Browser.close').catch(()=>{}),sleep(1500)]);
  ws.close(); proc.kill(); server.close();
  process.exitCode = fail ? 1 : 0;
})();
