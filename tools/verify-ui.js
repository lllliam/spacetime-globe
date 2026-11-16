#!/usr/bin/env node
/* 无头浏览器回归：真实交互 + 架构不变量检查。
 *   node tools/verify-ui.js
 *   EDGE=/path/to/chrome node tools/verify-ui.js
 *   NOGL=1 node tools/verify-ui.js      （强制 Canvas2D 兜底）
 * 退出码 0 = 全部通过。 */
const { spawn } = require('child_process');
const { findBrowser, buildHarness, startServer } = require('./harness.js');

const BROWSER = findBrowser();
if (!BROWSER) { console.error('找不到 Chromium / Edge'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  buildHarness();
  const { server, port } = await startServer(0);
  const url = `http://127.0.0.1:${port}/_harness.html`;
  const dcPort = 9600 + Math.floor(Math.random() * 200);
  const args = [
    '--headless=new', `--remote-debugging-port=${dcPort}`, `--user-data-dir=${require('os').tmpdir()}/globe-verify-prof`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=390,844', url,
  ];
  if (process.env.NOGL) args.push('--disable-webgl', '--disable-3d-apis');
  const proc = spawn(BROWSER, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dcPort}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1'));
    } catch { }
    if (!target) await sleep(250);
  }
  if (!target) { console.error('浏览器没起来'); proc.kill(); server.close(); process.exit(2); }

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
  await sleep(2500);
  /* 等真正启动完成（取数据 + 建材质可能需要几秒，别在启动阶段就跑断言） */
  for (let i = 0; i < 100; i++) {
    const ready = await send('Runtime.evaluate', {
      expression: '!!(window.__t && window.__t.rendererKind && window.__t.partition.shapes.length > 0 && !document.getElementById("boot"))',
      returnByValue: true,
    });
    if (ready.result.value) break;
    await sleep(250);
  }

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

  check('渲染器就绪', (await js('window.__t.rendererKind')) === (process.env.NOGL ? 'canvas2d' : 'webgl'), await js('window.__t.rendererKind'));
  check('世界数据已装载', await js('window.__t.partition.shapes.length > 100'), await js('window.__t.partition.shapes.length'));

  /* 拾取与画面一致 */
  const align = await js(`(() => {
    const t = window.__t; const bad = []; let n = 0;
    for (const [iso, lon, lat] of [['CN',110,34],['IN',78,22],['AU',134,-25],['EG',30,27],['FR',2,47],['RU',60,58],['BR',-52,-10],['ZA',24,-29]]) {
      const p = t.screenOf(lon*Math.PI/180, lat*Math.PI/180);
      if (!p.front) continue;
      n++;
      const id = t.pick(p.x, p.y);
      const s = id ? t.shapeOf(id) : null;
      if (!s || !s.iso) bad.push([iso, id]);
    }
    return { n, bad };
  })()`);
  check('点击命中与画面一致', align.bad.length === 0 && align.n >= 4, align);

  /* 点国家 */
  const p = await js(`(() => { const q = window.__t.screenOf(110*Math.PI/180, 34*Math.PI/180); return {x:q.x, y:q.y}; })()`);
  await tap(p.x, p.y);
  const sheet = await js(`({open: document.body.classList.contains('sheet-open'),
    title: (document.querySelector('#sheet h2')||{}).textContent,
    hasFacts: !!document.querySelector('#sheet .facts')})`);
  check('点国家打开档案（含事实行）', sheet.open && /中国/.test(sheet.title || '') && sheet.hasFacts, sheet);
  await js(`window.__t.closeSheet()`);
  await sleep(500);

  /* 拖动 */
  const y0 = await js('window.__t.state.yaw');
  await drag(300, 380, 160, 380, 12);
  await sleep(300);
  const y1 = await js('window.__t.state.yaw');
  check('拖动改变经度', Math.abs(y1 - y0) > 0.15, { y0: +y0.toFixed(2), y1: +y1.toFixed(2) });

  /* 时间轴 → 1900 */
  const tr = await js(`(() => { const b = document.getElementById('track').getBoundingClientRect(); return {x:b.x, y:b.y, w:b.width}; })()`);
  await tap(tr.x + 18 + (tr.w - 36) * 0.86, tr.y + 62);
  const yr = await js(`document.getElementById('year').textContent`);
  check('时间轴可定位年份', /年/.test(yr), yr);

  /* 切到政权层 */
  await js(`window.__t.setYear(1900)`);
  await js(`window.__t.setLayer('polity')`);
  await js(`window.__t.ensurePolity()`);
  for (let i = 0; i < 40; i++) { if (await js('window.__t.polityLoaded')) break; await sleep(250); }
  const pol = await js(`({loaded: window.__t.polityLoaded, shapes: window.__t.partition.shapes.length, entities: window.__t.summary.entities,
    hud: document.getElementById('sub').textContent})`);
  check('政权层已加载并栅格化', pol.loaded && pol.shapes > 20, pol);

  /* 点一个政权（1900 年 · 安纳托利亚） */
  await js(`(() => { const t = window.__t; t.state.yaw = -0.60; t.state.tilt = 0.35; t.redraw(); })()`);
  await sleep(200);
  const pp = await js(`(() => { const q = window.__t.screenOf(32*Math.PI/180, 39*Math.PI/180); return {x:q.x, y:q.y, front:q.front}; })()`);
  await tap(pp.x, pp.y);
  const polSheet = await js(`({
    open: document.body.classList.contains('sheet-open'),
    title: (document.querySelector('#sheet h2')||{}).textContent,
    era: (document.querySelector('#sheet .era')||{}).textContent,
    facts: [...document.querySelectorAll('#sheet .facts span')].map(e=>e.textContent).slice(0,4),
    entries: document.querySelectorAll('#sheet ul:not(.facts) li').length
  })`);
  check('点政权打开档案（存续/疆域/邻居/条目）',
    polSheet.open && /Empire|Kingdom|Khanate|Sultanate|Caliphate|Dynasty|Emirate|Republic|Confederation|帝国|王国|汗国|苏丹|共和国|王朝/i.test(polSheet.title || '') && polSheet.facts.length >= 2,
    polSheet);

  /* 回归：政权一本书不该把全世界都塞进来（曾经因为遮罩用了不透明黑底，判成整张地图） */
  const bookPol = await js(`(() => {
    const t = window.__t;
    const ent = t.entityByKey('polity', 23, 0) || null;
    const id = t.pick(t.screenOf(20*Math.PI/180, 48*Math.PI/180).x, t.screenOf(20*Math.PI/180, 48*Math.PI/180).y);
    const e2 = id ? t.entityById('polity', id) : null;
    const use = e2 || ent;
    if (!use) return null;
    const mask = t.polityMaskOf(use);
    let on = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) on++;
    return { name: use.name, entries: t.entriesForBook(use).length, maskPct: +(on / mask.length * 100).toFixed(2) };
  })()`);
  check('政权年表只收它自己的疆域', !!bookPol && bookPol.entries < 80 && bookPol.maskPct < 8, bookPol);

  /* 回归：换年份后抽屉仍然停在同一个实体（focus 存的是 key，不是 shape id） */
  const stable = await js(`(() => {
    const t = window.__t;
    const before = t.state.focus && t.state.focus.key;
    const titleBefore = (document.querySelector('#sheet-inner h2') || {}).textContent;
    t.setYear(1200);
    const titleAfter = (document.querySelector('#sheet-inner h2') || {}).textContent;
    return { before, after: t.state.focus && t.state.focus.key, titleBefore, titleAfter };
  })()`);
  check('换年份后抽屉不跳到别的实体', stable.before === stable.after && stable.titleBefore === stable.titleAfter, stable);

  /* 切回国家层 */
  await js(`window.__t.setLayer('country')`);
  const back = await js(`({shapes: window.__t.partition.shapes.length, iso: !!window.__t.shapeOf(1).iso})`);
  check('可切回国家层', back.shapes > 100 && back.iso, back);
  /* 抽屉三档：上拉应到 full，且内容变成可滚动的书 */
  await js(`window.__t.openEntity('country', window.__t.partition.shapes.find(s => s.iso === 'CN').id)`);
  await sleep(520);
  const half = await js('({ detent: window.__t.sheet.detent, hasBook: !!document.querySelector("#sheet .book article") })');
  await js('window.__t.openBook()');
  await sleep(560);
  const full = await js('({ detent: window.__t.sheet.detent, scrollable: getComputedStyle(document.getElementById("sheet-scroll")).overflowY, cls: document.getElementById("sheet").className })');
  check('抽屉上拉到全屏并显示正文', half.detent === 'half' && half.hasBook && full.detent === 'full' && full.scrollable === 'auto', { half, full });
  await js('window.__t.closeSheet()');
  await sleep(480);

  /* 放大 + 平移后：GL 球、矢量层、拾取必须仍然对齐（曾经的 bug 是 GL 忽略 pan） */
  await js(`(() => { const t = window.__t; t.state.zoom = 2.2; t.view.Rz = t.view.R * 2.2; t.state.panX = -60; t.state.panY = 30; t.redraw(); })()`);
  await sleep(320);
  const panned = await js(`(() => {
    const t = window.__t;
    const q = t.screenOf(110*Math.PI/180, 34*Math.PI/180);
    const id = t.pick(q.x, q.y);
    const s = id ? t.shapeOf(id) : null;
    return { screen: [Math.round(q.x), Math.round(q.y)], picked: s && s.iso, panX: t.state.panX, panY: t.state.panY };
  })()`);
  check('平移后拾取仍与画面一致', panned.picked === 'CN', panned);
  await js(`(() => { const t = window.__t; t.state.panX = 0; t.state.panY = 0; t.state.zoom = 1.9; t.view.Rz = t.view.R * 1.9; t.redraw(); })()`);

  /* 帧率 */
  await js(`window.__req = 0; (function t(){ window.__req++; requestAnimationFrame(t); })();`);
  await js(`window.__t.redraw()`);
  await sleep(1000);
  const fps = await js('window.__req');
  check('渲染循环在跑', fps > 12, { fps });

  const errs = await js('window.__errs');
  check('控制台无异常', errs.length === 0, errs.slice(0, 4));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? 'FAILED' : 'PASSED'} · ${results.length - failed}/${results.length}`);
  ws.close(); proc.kill(); server.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('verify 出错:', e.message); process.exit(2); });
