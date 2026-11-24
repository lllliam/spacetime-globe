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
      title: document.querySelector('#sheet-identity-name').textContent };
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
  await js('__t.commitYear(__t.yearBounds.max)');
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

  /* 2. 同一年份的历史疆域进入一卷书，再回到原地区。 */
  await js("__t.setLayer('polity');__t.setYear(1500)");
  await waitFor('__t.polityLoaded',8000);
  const p2 = await at(110, 34);
  await tap(p2.x, p2.y);
  const beforeRead = await st();
  await js(`document.querySelector('[data-read-subject]').click()`);
  await sleep(400);
  ok('明朝疆域打开主体书卷', await js(`!document.getElementById('book').hidden && __t.reading.subject?.id==='ming' && document.querySelectorAll('[data-reading-detail].reading-card').length===5`));
  await js(`document.querySelector('[data-reading-detail]').click()`);
  ok('第一章包含连续正文与来源', await js(`document.querySelectorAll('#book-body .subject-prose p').length>=3 && document.querySelectorAll('.reading-sources a').length>=2`));
  await js(`document.getElementById('reading-back').click();document.getElementById('reading-grab').click()`);
  for (let i = 0; i < 40 && !await js('__t.readerSettled'); i++) await sleep(40);
  const afterRead = await st();
  ok('返回地球恢复原抽屉、主体与年份', beforeRead.open && afterRead.open && afterRead.year === 1500 &&
    afterRead.focus === beforeRead.focus && afterRead.detent === beforeRead.detent && await js('__t.session.mode==="Explore"'), afterRead);
  await js('__t.closeSheet()');
  await sleep(500);

  /* 4. 政权层 + 点政权 */
  await js(`window.__t.setLayer('polity');window.__t.setYear(1900)`);
  await waitFor('window.__t.polityLoaded === true', 8000);
  await sleep(500);
  const p3 = await at(32, 39);
  await tap(p3.x, p3.y);
  const polSheet = await st();
  ok('政权层点开抽屉', polSheet.open && polSheet.title==='奥斯曼帝国', { title: polSheet.title, detent: polSheet.detent });

  /* 5. 底部时间轴支持逐年键盘选择。 */
  const yearBefore = polSheet.year;
  await js("document.getElementById('sheet-close').click()");
  await waitFor('window.__t.sheetSettled && !document.getElementById("vernier").hidden');
  await js("document.getElementById('vernier-track').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',windowsVirtualKeyCode:39});
  await waitFor("window.__t.sheetSettled && !document.body.classList.contains('sheet-open')");
  const afterScrub=await st();
  ok('时间游标用右方向键前进一年',afterScrub.year===yearBefore+1&&!afterScrub.open,{before:yearBefore,after:afterScrub.year});
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

  /* 8. 顶部选年与底部史事都是显式入口。 */
  await js("document.getElementById('year').click()");
  await sleep(400);
  ok('年份轻点打开精确输入', await js('!document.getElementById("year-form").hidden && document.activeElement.id === "year-input"'));
  await js(`document.querySelector('#year-input').value='1900';document.querySelector('#year-form').requestSubmit();`);
  await js(`document.querySelector('#vernier-events').click()`);
  const ov = await js(`({ open: !document.getElementById('overlay').hidden, h: document.getElementById('overlay-body').innerHTML.length })`);
  ok('底部史事打开所选年份的事件列表', ov.open && ov.h > 200 && await js(`document.querySelector('#overlay-title').textContent==='1900 年'`), ov);
  await js(`document.getElementById('overlay-close').click()`);
  await sleep(400);
  ok('全景列表可关闭', await js(`document.getElementById('overlay').hidden`), null);

  /* 9. 转屏 */
  await js(`__t.setLayer('country');__t.openEntity('country', __t.partition.shapes.find(shape => shape.iso === 'CN').id)`);
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
  ok('Esc 收起抽屉', port2.open && !(await st()).open && (await st()).detent === 'hidden');

  ok('全程无控制台异常', errs.length === 0, errs.slice(0, 3));
  console.log(`\n${fail === 0 ? 'PASSED' : 'FAILED'} · ${pass}/${pass + fail}`);
  await Promise.race([send('Browser.close').catch(()=>{}),sleep(1500)]);
  ws.close(); proc.kill(); server.close();
  process.exitCode = fail ? 1 : 0;
})();
