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
  const profile = require('path').join(require('os').tmpdir(), 'globe-verify-' + process.pid);
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=390,844', url,
  ];
  if (process.env.NOGL) args.push('--disable-webgl', '--disable-3d-apis');
  const proc = spawn(BROWSER, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const dcPort = Number(require('fs').readFileSync(require('path').join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);
      const list = await (await fetch(`http://127.0.0.1:${dcPort}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url === url);
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
  const readingShot = async (name) => {
    if (!process.env.READING_SHOTS) return;
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(require('path').join(process.env.READING_SHOTS, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
  await send('Page.reload');
  await sleep(2500);
  /* 等真正启动完成（取数据 + 建材质可能需要几秒，别在启动阶段就跑断言） */
  for (let i = 0; i < 100; i++) {
    const ready = await send('Runtime.evaluate', {
      expression: '!!(window.__t && window.__t.rendererKind && window.__t.partition.shapes.length > 0 && !document.getElementById("boot"))',
      returnByValue: true,
    });
    if (ready.result.value) break;
    const errors=await send('Runtime.evaluate',{expression:'window.__errs',returnByValue:true});
    if (errors.result.value?.length) {
      console.error('启动失败',errors.result.value);
      ws.close();proc.kill();server.close();process.exit(2);
    }
    await sleep(250);
  }

  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
    return r.result.value;
  };
  const waitReader = async () => {
    for (let i = 0; i < 40 && !await js('__t.readerSettled'); i++) await sleep(40);
  };
  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(500);
    for (let i=0;i<40;i++) { if (await js('__t.sheetSettled')) break; await sleep(75); }
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

  const fs = require('fs'), path = require('path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.webmanifest'), 'utf8'));
  const iconSizes = [['icon.png',180],['icon-192.png',192],['icon-512.png',512],['favicon.png',64]];
  check('主屏幕与浏览器图标尺寸正确且为不透明 PNG', iconSizes.every(([f,n])=>{
    const b=fs.readFileSync(path.join(__dirname,'..',f));
    return b.readUInt32BE(16)===n && b.readUInt32BE(20)===n && b[25]===2;
  }));
  check('PWA 图标引用含新版本与 maskable 支持', manifest.icons.every(i=>i.src.endsWith('?v=3')) && manifest.icons.some(i=>i.purpose.includes('maskable')));

  check('渲染器就绪', (await js('window.__t.rendererKind')) === (process.env.NOGL ? 'canvas2d' : 'webgl'), await js('window.__t.rendererKind'));
  check('世界数据已装载', await js('window.__t.partition.shapes.length > 100'), await js('window.__t.partition.shapes.length'));

  const camera = () => js('({yaw:__t.state.yaw, zoom:__t.state.zoom, x:__t.state.panX, y:__t.state.panY})');
  const initialCloud = await js('__t.cloudDrift');
  const initial = await camera();
  await sleep(350);
  check('独立云层随自转缓慢移动', (await js('__t.cloudDrift')) > initialCloud);
  check('默认倍率下地球慢速自转', Math.abs((await camera()).yaw - initial.yaw) > 0.004);
  const finger = (type, x, y, halfGap = 40) => send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{x:x-halfGap,y,id:1},{x:x+halfGap,y,id:2}],
  });
  await finger('touchStart', 201, 450);
  const yawWhilePressed = (await camera()).yaw;
  await finger('touchMove', 248, 480);
  const elasticFit = await camera();
  await sleep(150);
  check('双指平移时有阻尼并暂停自转', elasticFit.x > 5 && elasticFit.x < 47 && elasticFit.zoom === 1 &&
    (await camera()).yaw === yawWhilePressed, elasticFit);
  await finger('touchEnd');
  await sleep(600);
  const returned = await camera();
  check('默认倍率松手后回到居中并恢复自转', Math.hypot(returned.x, returned.y) < 0.1 &&
    Math.abs(returned.yaw - yawWhilePressed) > 0.003, returned);

  await finger('touchStart', 201, 450);
  await finger('touchMove', 201, 450, 85);
  await finger('touchMove', 224, 471, 85);
  await sleep(120);
  const localView = await camera();
  await finger('touchEnd');
  await sleep(450);
  const heldView = await camera();
  check('放大平移后保留正在看的区域并停止自转', heldView.zoom > 2 && Math.hypot(heldView.x, heldView.y) > 10 &&
    Math.hypot(heldView.x - localView.x, heldView.y - localView.y) < 0.1 && heldView.yaw === localView.yaw, heldView);

  await finger('touchStart', 201, 450, 85);
  await finger('touchMove', 299, 730, 85);
  await finger('touchMove', 299, 820, 85);
  await sleep(120);
  const beforeEdgeReturn = await camera();
  await finger('touchEnd');
  await sleep(420);
  const edge = await camera();
  check('放大后拉出边界只回弹到可视范围', Math.hypot(edge.x, edge.y) > 80 &&
    Math.hypot(beforeEdgeReturn.x, beforeEdgeReturn.y) - Math.hypot(edge.x, edge.y) > 4 &&
    !!(await js('__t.mapPointAt(__t.view.cx,__t.view.cy)')), edge);

  await finger('touchStart', 201, 450, 85);
  await finger('touchMove', 201, 450, 40);
  await finger('touchEnd');
  await sleep(500);
  const fit = await camera();
  check('缩小到默认倍率后重新自转', fit.zoom === 1 && Math.hypot(fit.x, fit.y) < .1 &&
    Math.abs(fit.yaw - heldView.yaw) > .003, fit);
  await js('__t.stopSpin(); document.getElementById("reset-view").click()');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(250);

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
    entries: document.querySelectorAll('#sheet [data-read-topic]').length})`);
  check('点国家打开只有一个阅读入口的摘要', sheet.open && sheet.title === '中国' && sheet.entries === 1, sheet);
  await js(`window.__t.closeSheet()`);
  await sleep(500);
  // Canvas 兜底在繁忙机器上可能少帧，等待实际弹簧位置而非固定延迟。
  for (let i=0;i<60;i++) {
    if (await js('Math.abs(__t.sheet.offset-innerHeight)<1')) break;
    await sleep(50);
  }

  /* 拖动 */
  const y0 = await js('window.__t.state.yaw');
  await drag(300, 380, 160, 380, 12);
  await sleep(300);
  const y1 = await js('window.__t.state.yaw');
  check('拖动改变经度', Math.abs(y1 - y0) > 0.15, { y0: +y0.toFixed(2), y1: +y1.toFixed(2) });

  /* 同一年份的轻点与长按，以及地球自己的观察入口。 */
  const pointOf = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const hold = async (point, touch=false) => {
    const {x,y}=point;
    if(touch) await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    else await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    await sleep(600);
    if(touch) await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    else await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
    await sleep(350);
  };
  check('首页没有常驻图层按钮，时间轴默认隐藏', await js("!document.querySelector('#view-toggle,#classic-link,#hint') && document.getElementById('dock').inert"));
  await js("__t.setYear(1900)");
  await tap(...Object.values(await pointOf('#year')));
  check('轻点年份打开当年全球事件表', await js("!document.getElementById('overlay').hidden && document.getElementById('overlay-title').textContent==='1900 年' && document.querySelectorAll('.wrow').length>0"));
  await js("document.getElementById('overlay-close').click()");
  await hold(await pointOf('#year'),true);
  check('触屏长按年份仅展开时间轴', await js("!document.getElementById('dock').inert && document.getElementById('overlay').hidden"));
  const tr = await js("(()=>{const r=document.getElementById('track').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width}})()");
  await drag(tr.x + tr.w * .94,tr.y + 42,tr.x + tr.w * .78,tr.y + 42);
  await js("__t.ensurePolity()");
  for(let i=0;i<40;i++){if(await js("__t.polityLoaded"))break;await sleep(200);}
  check('拖动时间轴自动显示当年历史疆域', await js("__t.state.layerId==='polity' && __t.state.year<1900 && __t.partition.shapes.length>0"));
  const historySignature = await js("JSON.stringify(__t.partition.shapes.map(s=>[s.ent.name,s.pathId]))");
  await js("document.getElementById('time-input-toggle').click();document.getElementById('year-input').value=1900;document.getElementById('year-form').requestSubmit()");
  check('输入历史年份改变真实边界几何',await js("__t.state.year===1900 && JSON.stringify(__t.partition.shapes.map(s=>[s.ent.name,s.pathId]))!=="+JSON.stringify(historySignature)));
  const designShot = async name => {
    if (process.env.ATLAS_SHOTS !== '1' && process.env.ATLAS_SHOTS !== name) return;
    const shot=await send('Page.captureScreenshot',{format:'png'});
    require('fs').writeFileSync(require('path').join(__dirname,'../docs/design',name+'.png'),Buffer.from(shot.data,'base64'));
  };
  await designShot('timeline');
  await js("document.getElementById('time-play').click()");
  await sleep(850);
  check('播放推进年份并保持时间轴',await js("__t.state.year===1910 && document.getElementById('time-play').getAttribute('aria-pressed')==='true'"));
  await js("document.getElementById('time-play').click()");
  await sleep(6900);
  check('闲置自动收起时间轴且保留年份',await js("document.getElementById('dock').inert && __t.state.year===1910"));
  await send('Emulation.setDeviceMetricsOverride', {width:402,height:874,deviceScaleFactor:3,mobile:true});
  await js("__t.setYear(1900);document.activeElement.blur()");
  await sleep(350);
  await designShot('globe');
  check('首页保留球下留白',await js("!document.getElementById('home-story') && getComputedStyle(document.body).backgroundColor==='rgb(5, 8, 13)'"));
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:2,mobile:true});
  await sleep(300);
  const globePoint = await js("({x:__t.view.cx,y:__t.view.cy})");
  await hold(globePoint,true);
  check('长按球体只打开观察方式',await js("!document.getElementById('view-panel').hidden && __t.sheet.detent==='hidden'"));
  await designShot('views');
  await js("document.querySelector('[data-view=nature]').click()");
  check('自然地理表面关闭行政着色', await js("__t.partition.lut.every(v=>v===0)"));
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...globePoint,button:'right',buttons:2,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...globePoint,button:'right',buttons:0,clickCount:1});
  check('桌面右键可打开观察方式',await js("!document.getElementById('view-panel').hidden"));
  await js("document.querySelector('[data-view=modern]').click()");
  await hold(await pointOf('#year'));
  await js("document.querySelectorAll('[data-year-step]')[0].click()");
  check('手动选择现代国家后，调年份保留现代边界',await js("__t.state.layerId==='country' && __t.state.year===1890"));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});

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
  await sleep(220);
  const polSheet = await js(`({
    open: document.body.classList.contains('sheet-open'),
    title: (document.querySelector('#sheet h2')||{}).textContent,
    era: (document.querySelector('#sheet .era')||{}).textContent,
    entries: document.querySelectorAll('#sheet [data-read-topic]').length
  })`);
  check('点政权打开对应年份的摘要',
    polSheet.open && /Empire|Kingdom|Khanate|Sultanate|Caliphate|Dynasty|Emirate|Republic|Confederation|帝国|王国|汗国|苏丹|共和国|王朝/i.test(polSheet.title || '') &&
    polSheet.entries === 1 && polSheet.era.includes('1900'),
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
  const half = await js('({ detent: window.__t.sheet.detent, hasEntry: !!document.querySelector("#sheet [data-read-topic]"), hasLongText: !!document.querySelector("#sheet .book article") })');
  await js('window.__t.openBook()');
  await sleep(560);
  const full = await js('({ open: !document.getElementById("book").hidden, scrollable: getComputedStyle(document.getElementById("book-body")).overflowY, cards: document.querySelectorAll("#book .reading-card").length })');
  check('抽屉进入独立阅读层，摘要不摊开长文', half.detent === 'half' && half.hasEntry && !half.hasLongText && full.open && full.scrollable === 'auto', { half, full });
  await js('window.__t.closeReader()');
  await js('window.__t.closeSheet()');
  await sleep(480);

  /* 回归：往下拉不能把抽屉拉到时间轴底下（抓手必须还在可点区域） */
  await js(`(() => { const t = window.__t; const q = t.screenOf(110*Math.PI/180, 34*Math.PI/180); t.openEntity('country', t.pick(q.x, q.y)); })()`);
  await sleep(620);
  const grabPt = await js(`(() => { const r = document.getElementById('grab').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grabPt.x, y: grabPt.y, button: 'left', clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 10; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grabPt.x, y: grabPt.y + 30 * i, button: 'left', buttons: 1 });
    await sleep(30);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grabPt.x, y: grabPt.y + 300, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(700);
  const afterDrag = await js(`(() => {
    const sh = document.getElementById('sheet'), gr = document.getElementById('grab').getBoundingClientRect();
    const r = sh.getBoundingClientRect();
    const reachable = r.top < innerHeight - 100 && gr.y > -10 && gr.y < innerHeight - 100;
    return { detent: window.__t.sheet.detent, top: Math.round(r.top), grabY: Math.round(gr.y), reachable };
  })()`);
  check('抽屉往下拉不会藏进时间轴下面', afterDrag.detent === 'hidden' || afterDrag.reachable, afterDrag);
  await js('window.__t.closeSheet()');
  await sleep(420);

  /* 手势结果明确：小幅回弹、快扫触发、长拖展开/关闭，不留下自由位置。 */
  const openCountry = async (iso='CN') => {
    await js(`__t.openEntity('country', __t.partition.shapes.find(s=>s.iso===${JSON.stringify(iso)}).id)`);
    for (let i=0;i<40;i++) { if (await js('__t.sheetSettled')) break; await sleep(75); }
  };
  const sheetGesture = async (dy, interval=32, steps=8, touch=false, target='grab', cancel=false, pause=0) => {
    const pt = await js(`(()=>{const r=document.querySelector(${JSON.stringify(target==='grab'?'#grab':'.sheet-overview')}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(r.height/2,24)}})()`);
    const base = Date.now()/1000;
    if(touch) await send('Input.dispatchTouchEvent',{type:'touchStart',timestamp:base,touchPoints:[{x:pt.x,y:pt.y}]});
    else await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pt.x,y:pt.y,button:'left',buttons:1,clickCount:1});
    for(let i=1;i<=steps;i++) {
      const y=pt.y+dy*i/steps;
      if(touch) await send('Input.dispatchTouchEvent',{type:'touchMove',timestamp:base+i*interval/1000,touchPoints:[{x:pt.x,y}]});
      else await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pt.x,y,button:'left',buttons:1});
      await sleep(interval);
    }
    if(pause) await sleep(pause);
    const following=await js('({offset:__t.sheet.offset,start:__t.sheet.startOffset,dragging:__t.sheet.dragging,velocity:__t.sheet.vy,intent:document.getElementById("sheet").dataset.gesture})');
    if(touch) await send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',timestamp:base+(steps*interval+pause+12)/1000,touchPoints:[]});
    else await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pt.x,y:pt.y+dy,button:'left',buttons:0,clickCount:1});
    for (let i=0;i<40;i++) { if (await js('__t.sheetSettled')) break; await sleep(75); }
    return {...following,...await js('({detent:__t.sheet.detent,finalOffset:__t.sheet.offset,reading:!document.getElementById("book").hidden})')};
  };
  await openCountry();
  if(process.env.UPDATE_SHOTS) {
  const popupShot = await send('Page.captureScreenshot', {format:'png'});
  require('fs').writeFileSync(require('path').join(__dirname,'../docs/sheet-gestures.png'),Buffer.from(popupShot.data,'base64'));
  }
  const soft=await sheetGesture(26,65,6,true);
  check('触摸小幅下拖跟手，松手回弹半屏', soft.dragging && Math.abs(soft.offset-soft.start-26)<3 && soft.detent==='half' && Math.abs(soft.finalOffset-soft.start)<2,soft);
  const cancel=await sheetGesture(-150,30,8,true,'grab',true);
  check('系统取消手势只回弹，不误触全屏', !cancel.reading && cancel.detent==='half' && Math.abs(cancel.finalOffset-cancel.start)<2,cancel);
  const expand=await sheetGesture(-155,60,10,true,'header');
  check('摘要头上拖过阈值进入全屏', expand.reading && expand.intent==='expand',expand);
  await js('__t.closeReader()');
  await sleep(200);
  const down=await sheetGesture(155,60,10,true);
  check('缓慢下拖过阈值隐藏半窗', down.detent==='hidden' && !down.reading,down);
  await openCountry('IN');
  const flickUp=await sheetGesture(-60,8,4,true);
  check('短距离快速上扫也能全屏', flickUp.reading,flickUp);
  await js('__t.closeReader()');
  await sleep(200);
  const flickDown=await sheetGesture(60,8,4,true);
  check('短距离快速下扫也能关闭', flickDown.detent==='hidden',flickDown);
  await openCountry();
  const held=await sheetGesture(-60,8,4,true,'grab',false,240);
  check('拖动后停住再松手不会沿用旧速度', !held.reading && held.detent==='half',held);
  // 阅读入口的区域保留原生手势，不把掠过按钮的滑动当成点击。
  await send('Emulation.setDeviceMetricsOverride', {width:320,height:480,deviceScaleFactor:2,mobile:true});
  await sleep(240);
  await openCountry();
  await js('document.getElementById("sheet-scroll").scrollTop=0');
  const row=await js(`(()=>{const r=document.querySelector('.topic-entry').getBoundingClientRect();return {x:r.x+r.width/2,y:r.top+r.height/2}})()`);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:row.x,y:row.y}]});
  for(let i=1;i<=6;i++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:row.x,y:row.y-i*18}]});await sleep(30);}
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(350);
  const scroll=await js('({top:document.getElementById("sheet-scroll").scrollTop,reading:__t.reading.active,detent:__t.sheet.detent})');
  check('滑过摘要入口不会误触全屏', !scroll.reading && scroll.detent==='half',scroll);
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:2,mobile:true});
  // 动画中途接住：按下不应跳到弹簧目标值。
  await js('__t.closeSheet()');
  await sleep(600);
  await js(`__t.openEntity('country', __t.partition.shapes.find(s=>s.iso==='CN').id)`);
  await sleep(100);
  const catchState=await js(`(()=>{
    const t=__t, g=document.getElementById('grab'), before=t.sheet.offset;
    g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:55,pointerType:'mouse',buttons:1,isPrimary:true,clientY:before+15}));
    const after=t.sheet.offset, dragging=t.sheet.dragging;
    document.getElementById('sheet').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:55}));
    return {before,after,dragging};
  })()`);
  check('动画中途可接住，按下不跳位置',catchState.dragging && Math.abs(catchState.before-catchState.after)<1,catchState);
  await sleep(650);
  await js('__t.closeSheet()');
  await sleep(600);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await openCountry();
  // 聚焦抓手后，再验证键盘与减少动态效果。
  await js('document.getElementById("grab").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',windowsVirtualKeyCode:40});
  check('减少动态效果时即时收起，抓手支持键盘',await js('__t.sheet.detent==="hidden" && __t.sheet.offset===innerHeight'));
  await send('Emulation.setEmulatedMedia',{features:[]});
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


  /* 阅读交互：独立时间、详情返回、地图往返、手机与离线。 */
  await js(`(() => { const t=window.__t; t.setYear(1900); t.state.yaw=-1.42; t.state.tilt=.3; t.state.zoom=2.8; t.state.panX=12; t.state.panY=8; t.openEntity('country', t.partition.shapes.find(s=>s.iso==='CN').id); })()`);
  await sleep(500);
  const original = await js('JSON.stringify({year:__t.state.year,layer:__t.state.layerId,yaw:__t.state.yaw,tilt:__t.state.tilt,zoom:__t.state.zoom,panX:__t.state.panX,panY:__t.state.panY,focus:__t.state.focus.key})');
  await js(`document.querySelector('[data-read-topic]').click()`);
  const topic = await js(`({open:!document.getElementById('book').hidden,title:document.getElementById('reading-title').textContent,cards:document.querySelectorAll('[data-reading-detail].reading-card').length,dock:getComputedStyle(document.getElementById('dock')).visibility})`);
  check('晚清专题有八个节点且收起时间轴', topic.open && topic.cards===8 && topic.dock==='hidden' && /晚清/.test(topic.title), topic);
  await waitReader();
  await readingShot('late-qing');
  await js(`document.getElementById('book-body').scrollTop=240`);
  const indexScroll = await js('document.getElementById("book-body").scrollTop');
  await js(`document.querySelector('[data-reading-detail="boxers"]').click()`);
  check('节点打开解释与独立来源', await js(`document.querySelectorAll('#book-body article').length>=5 && document.querySelectorAll('.reading-sources a').length>0`));
  await js(`document.getElementById('book-body').scrollTop=180`);
  const detailScroll = await js('document.getElementById("book-body").scrollTop');
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowLeft',windowsVirtualKeyCode:37});
  check('阅读时方向键不改变地球年份', await js('__t.state.year===1900'));
  await js(`document.getElementById('reading-map').click()`);
  await waitReader();
  const mapPreview = await js(`({preview:__t.reading.preview,hidden:document.getElementById('book').hidden,resume:!document.getElementById('reading-resume').hidden,year:__t.state.year,
    sheet:document.getElementById('sheet').getBoundingClientRect().top, height:innerHeight, focus:__t.state.focus,
    pin:document.getElementById('reading-pin').textContent, pinVisible:!document.getElementById('reading-pin').hidden,
    point:__t.mapPointAt(__t.view.cx,__t.view.cy)})`);
  check('地点预览显示北京标记，旧摘要完全退出', mapPreview.preview && mapPreview.hidden && mapPreview.resume &&
    mapPreview.year===1900 && mapPreview.sheet>=mapPreview.height-1 && !mapPreview.focus && mapPreview.pinVisible &&
    /北京/.test(mapPreview.pin) && Math.abs(mapPreview.point.x-(.5+116.4/360)*1000)<1 &&
    Math.abs(mapPreview.point.y-(.5-39.9/180)*500)<1, mapPreview);
  await readingShot('beijing-place');
  const pinBefore = await js('document.getElementById("reading-pin").style.transform');
  await drag(170, 410, 220, 415, 6);
  check('旋转地球时标记跟随经纬度，摘要保持收起', await js(`
    document.getElementById('reading-pin').style.transform !== ${JSON.stringify(pinBefore)} && __t.sheet.detent==='hidden' && !__t.state.focus
  `));
  await js(`document.getElementById('reading-resume').click()`);
  await waitReader();
  check('从地图返回同一篇与同一位置', await js(`!document.getElementById('book').hidden && __t.reading.detail==='boxers' && Math.abs(document.getElementById('book-body').scrollTop-${detailScroll})<2`));
  await js(`document.getElementById('reading-back').click()`);
  check('详情返回专题恢复滚动位置', await js(`__t.reading.detail===null && Math.abs(document.getElementById('book-body').scrollTop-${indexScroll})<2`));
  await js(`document.getElementById('reading-grab').click()`);
  await waitReader();
  const restored = await js('JSON.stringify({year:__t.state.year,layer:__t.state.layerId,yaw:__t.state.yaw,tilt:__t.state.tilt,zoom:__t.state.zoom,panX:__t.state.panX,panY:__t.state.panY,focus:__t.state.focus.key})');
  check('退出阅读恢复原年份相机与选中地区', original===restored, {original,restored});
  await js(`document.querySelector('[data-read-topic]').click()`);
  check('重新进入保留专题进度', await js(`Math.abs(document.getElementById('book-body').scrollTop-${indexScroll})<2`));
  /* 全球内容：年代选择、跨洲导航、目录与阅读栈都不改变地球。 */
  const eraMatches = await js(`[
    ['CN',-221,'china-early'],['CN',1200,'east-asia-networks'],['CN',1900,'china-late-qing'],
    ['EG',-2500,'nile-civilizations'],['ML',1500,'west-africa'],['PE',1500,'mesoamerica-andes'],
    ['US',1150,'north-america-indigenous'],['AU',1788,'oceania'],['IN',2026,null]
  ].map(([iso,year,expected])=>({iso,year,expected,actual:(__t.topicForEntity({kind:'country',iso},year)||{}).id||null}))`);
  check('六洲专题按地区和真实覆盖年代推荐',eraMatches.every(x=>x.actual===x.expected),eraMatches);
  check('新增区域轮廓可点击并有中文名称',await js(`(()=>{const s=__t.partition.shapes.find(s=>s.iso==='ML');const e=__t.entityById('country',s.id);return !!e&&e.name!=='ML'})()`));
  const polityMatches=await js(`[['Qing Dynasty',1900,'china-late-qing'],['Ottoman Empire',1600,'ottoman-persia'],['Mali Empire',1400,'west-africa'],['Aztec Triple Alliance',1500,'mesoamerica-andes']].map(([name,year,expected])=>({name,expected,actual:(__t.topicForEntity({kind:'polity',name},year)||{}).id}))`);
  check('历史政权使用数据包实际名称匹配',polityMatches.every(x=>x.actual===x.expected),polityMatches);
  await js(`document.querySelector('[data-reading-detail="boxers"]').click();document.getElementById('book-body').scrollTop=420`);
  const linkedScroll=await js('document.getElementById("book-body").scrollTop');
  check('正文段落来源索引可以定位出处',await js(`(()=>{const a=document.querySelector('.reading-refs a');return !!a&&!!document.getElementById(a.getAttribute('href').slice(1))})()`));
  await js(`document.querySelector('[data-reading-topic="east-asia-modern"]').click()`);
  check('跨专题直接进入相关篇章且地球不跳年',await js(`__t.reading.topic.id==='east-asia-modern' && __t.reading.detail==='meiji' && __t.state.year===1900`));
  await js(`document.getElementById('reading-back').click()`);
  check('返回上篇恢复原章节和阅读位置',await js(`__t.reading.topic.id==='china-late-qing' && __t.reading.detail==='boxers' && Math.abs(document.getElementById('book-body').scrollTop-${linkedScroll})<2`));
  await js(`document.querySelector('[data-reading-catalog]').click()`);
  check('全球目录可达且没有地图定位入口',await js(`__t.reading.catalog && document.querySelectorAll('[data-reading-topic]').length===28 && !document.getElementById('reading-map')`));
  await js(`document.querySelector('[data-reading-continent="非洲"]').click()`);
  const africaCatalog=await js(`({ids:[...document.querySelectorAll('[data-reading-topic]')].map(b=>b.dataset.readingTopic),filter:document.querySelector('[data-reading-continent="非洲"]').getAttribute('aria-pressed')})`);
  check('目录按大洲筛选并保留跨洲专题',africaCatalog.ids.includes('west-africa')&&africaCatalog.ids.includes('islamic-networks')&&!africaCatalog.ids.includes('china-early')&&africaCatalog.filter==='true',africaCatalog);
  await js(`document.getElementById('book-body').scrollTop=350`);
  const catalogScroll=await js('document.getElementById("book-body").scrollTop');
  await js(`document.querySelector('[data-reading-topic="west-africa"]').click()`);
  check('目录可进入非洲专题，保持原地球状态',await js(`__t.reading.topic.id==='west-africa'&&!__t.reading.catalog&&__t.state.year===1900`));
  await js(`document.getElementById('reading-back').click()`);
  check('从专题返回原大洲目录与位置',await js(`__t.reading.catalog&&__t.reading.catalogContinent==='非洲'&&Math.abs(document.getElementById('book-body').scrollTop-${catalogScroll})<2`));
  await js(`document.getElementById('reading-back').click()`);
  check('目录返回原文，不丢失章节',await js(`__t.reading.detail==='boxers'&&!__t.reading.catalog`));
  await js(`document.getElementById('reading-back').click()`);
  // 窄屏截图与横屏：无水平溢出，返回按钮仍可触达。
  await send('Emulation.setDeviceMetricsOverride', {width:320,height:740,deviceScaleFactor:2,mobile:true});
  await sleep(300);
  check('320px 手机阅读无横向溢出', await js(`document.getElementById('book-body').scrollWidth<=document.getElementById('book-body').clientWidth && document.getElementById('book-bar').scrollWidth<=innerWidth`));
  await js(`document.querySelector('[data-reading-catalog]').click()`);
  check('320px 全球目录筛选与卡片无横向溢出',await js(`document.getElementById('book-body').scrollWidth<=document.getElementById('book-body').clientWidth && document.querySelector('.reading-filters').scrollWidth<=document.getElementById('book-body').clientWidth`));
  const catalogShot=await send('Page.captureScreenshot',{format:'png'});
  if(process.env.UPDATE_SHOTS) require('fs').writeFileSync(require('path').join(__dirname,'../docs/reading-world.png'),Buffer.from(catalogShot.data,'base64'));
  await js(`document.getElementById('reading-back').click()`);
  await js(`document.getElementById('book-body').scrollTop=0;document.activeElement.blur()`);
  const shot = await send('Page.captureScreenshot', {format:'png'});
  if(process.env.UPDATE_SHOTS) require('fs').writeFileSync(require('path').join(__dirname,'../docs/reading-topic.png'), Buffer.from(shot.data,'base64'));
  await js(`document.querySelector('[data-reading-detail="ports"]').click()`);
  const detailShot = await send('Page.captureScreenshot', {format:'png'});
  if(process.env.UPDATE_SHOTS) require('fs').writeFileSync(require('path').join(__dirname,'../docs/reading-detail.png'), Buffer.from(detailShot.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride', {width:844,height:390,deviceScaleFactor:2,mobile:true});
  await sleep(300);
  check('横屏阅读与返回按钮有效', await js(`document.getElementById('book-body').clientHeight>150 && document.getElementById('reading-back').getBoundingClientRect().top>=0`));
  await js('__t.closeReader(); __t.closeSheet(); __t.setYear(2026)');
  await send('Emulation.setDeviceMetricsOverride', {width:402,height:874,deviceScaleFactor:3,mobile:true});
  await js(`__t.openEntity('country',__t.partition.shapes.find(s=>s.iso==='IN').id)`);
  await sleep(450);
  await js(`document.querySelector('[data-read-topic]').click()`);
  const yearBeforeReading = await js('__t.state.year');
  const genericBefore = await js('document.querySelector(".reading-meta .when").textContent');
  await js(`document.querySelector('[data-reading-period]').click()`);
  check('其他地区有时期阅读且切换不改地球年份', await js(`__t.state.year===${yearBeforeReading} && document.querySelector('.reading-meta .when').textContent!==${JSON.stringify(genericBefore)}`));
  await js('__t.closeReader(); __t.closeSheet()');
  // 真正手势：从抓手向上拉打开阅读，再退出时恢复半屏。
  await js(`__t.openEntity('country',__t.partition.shapes.find(s=>s.iso==='CN').id)`);
  await sleep(500);
  const grab = await js(`(()=>{const r=document.getElementById('grab').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+13}})()`);
  await drag(grab.x,grab.y,grab.x,4,14);
  await waitReader();
  check('抓手上拉打开中国近现代年表', await js(`!document.getElementById('book').hidden && document.getElementById('reading-title').textContent==='中国近现代年表'`));
  check('中国年表用一条时间线串起记录', await js(`
    document.querySelectorAll('#book-body ol').length===1 &&
    document.querySelector('.reading-timeline .reading-row small').textContent==='1900' &&
    [...document.querySelectorAll('.reading-timeline .reading-row')].map(row=>row.dataset.readingDetail).join(',')==='i-140,i-042,i-033,i-084,i-085' &&
    !document.querySelector('#book-body .reading-note')
  `));
  await readingShot('china-timeline');
  const touchReader = async (target, distance, cancel = false, horizontal = false) => {
    const start = await js(`(()=>{const el=document.querySelector(${JSON.stringify(target)}),r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+(el.id==='book-body'?220:22)}})()`);
    if (horizontal) start.x = 20;
    await send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[start]});
    for (let i=1;i<=6;i++) {
      const moved = distance*i/6;
      await send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:start.x+(horizontal?moved:0),y:start.y+(horizontal?0:moved)}]});
      await sleep(48);
    }
    const during = await js(`({top:document.getElementById('book').getBoundingClientRect().top,left:document.getElementById('book').getBoundingClientRect().left,
      summary:Number(getComputedStyle(document.getElementById('sheet-scroll')).opacity),
      article:Number(getComputedStyle(document.getElementById('book-body')).opacity),
      sameSurface:document.getElementById('book').parentElement===document.getElementById('sheet')})`);
    await send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
    await waitReader();
    return { ...during, ...await js(`({hidden:document.getElementById('book').hidden,offset:__t.sheet.offset,detent:__t.sheet.detent,scroll:document.getElementById('book-body').scrollTop})`) };
  };
  const softRead = await touchReader('#reading-grab', 30);
  check('全屏小幅下拉跟手，松手后回弹', Math.abs(softRead.top-30)<2 && !softRead.hidden, softRead);
  const cancelledRead = await touchReader('#reading-grab', 150, true);
  check('系统取消全屏拖动后仍保留阅读', Math.abs(cancelledRead.top-150)<2 && !cancelledRead.hidden, cancelledRead);
  await js(`document.querySelector('.reading-row[data-reading-detail="i-140"]').click()`);
  check('通用条目提供正文出处与精选延伸阅读', await js(`!!document.querySelector('.reading-sources a') && !!document.querySelector('[data-reading-chapter="boxers"]') && !document.getElementById('reading-map')`));
  const shortBack = await touchReader('#book-body', 35, false, true);
  check('左边缘小幅右划回弹，仍留在原条目', shortBack.left>10 && await js(`__t.reading.detail==='i-140'`), shortBack);
  await sleep(190);
  const edgeBack = await touchReader('#book-body', 135, false, true);
  check('从左边缘右划返回同一份年表', edgeBack.left>45 && !edgeBack.hidden && await js(`__t.reading.detail===null`), edgeBack);
  await sleep(190);
  const edgeCollapse = await touchReader('#book-body', 135, false, true);
  check('在年表首页右划收回半窗', edgeCollapse.hidden && edgeCollapse.detent==='half', edgeCollapse);
  await js(`document.querySelector('[data-read-topic]').click()`);
  await waitReader();
  await js(`document.querySelector('.reading-row[data-reading-detail="i-140"]').click()`);
  await js(`document.querySelector('[data-reading-chapter="boxers"]').click()`);
  await readingShot('reading-article');
  const scrollRead = await touchReader('#book-body', -160);
  check('全屏正文原生滚动，正文滑动不收起', scrollRead.top===0 && !scrollRead.hidden && scrollRead.scroll>0, scrollRead);
  const scrollBack = await touchReader('#book-body', 100);
  check('正文未到顶时下拉仍然滚动', scrollBack.top===0 && !scrollBack.hidden && scrollBack.scroll<scrollRead.scroll, scrollBack);
  await js(`document.getElementById('reading-map').click()`);
  await waitReader();
  check('从2026年阅读跳到1900年地点时保持地图年份一致', await js(`__t.state.year===1900 && document.getElementById('year').textContent==='1900' && !__t.state.focus`));
  await js(`document.getElementById('reading-resume').click()`);
  await waitReader();
  const startHalf = await js('({offset:__t.reading.snapshot.offset,year:__t.state.year,key:__t.state.focus.key})');
  await js(`document.getElementById('book-body').scrollTop=0`);
  const collapse = await touchReader('#book-body', 310);
  check('拖动中在同一抽屉内衔接正文与摘要', collapse.sameSurface && collapse.summary>.1 && collapse.article>.1, collapse);
  check('从正文下拉回到原半窗、年份与地区', collapse.hidden && collapse.detent==='half' && Math.abs(collapse.offset-startHalf.offset)<2 &&
    await js(`__t.state.year===${startHalf.year} && __t.state.focus.key===${JSON.stringify(startHalf.key)}`),collapse);
  await js('__t.closeSheet()');

  /* 帧率 */
  await js(`window.__req = 0; (function t(){ window.__req++; requestAnimationFrame(t); })();`);
  await js(`window.__t.redraw()`);
  await sleep(1000);
  const fps = await js('window.__req');
  check('渲染循环在跑', fps > 12, { fps });


  const offlineFile = buildHarness(true);
  await send('Network.enable');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await send('Page.navigate',{url:require('url').pathToFileURL(offlineFile).href});
  for(let i=0;i<80;i++) {
    if(await js('!!(window.__t && __t.partition.shapes.length && !document.getElementById("boot"))')) break;
    await sleep(200);
  }
  await js(`__t.setYear(1900);__t.openEntity('country',__t.partition.shapes.find(s=>s.iso==='CN').id);__t.openBook()`);
  check('离线单文件可打开晚清专题', await js(`document.querySelectorAll('[data-reading-detail].reading-card').length===8 && !document.getElementById('book').hidden`));
  check('离线单文件图标已内嵌', await js(`document.querySelector('link[rel="icon"]').href.startsWith('data:image/png;base64,') && document.querySelector('link[rel="apple-touch-icon"]').href.startsWith('data:image/png;base64,')`));
  await js(`document.querySelector('[data-reading-catalog]').click()`);
  const offlineAll=await js(`(()=>{
    const bad=[];let count=0;
    for(const t of __t.topics){
      document.querySelector('[data-reading-topic="'+t.id+'"]').click();
      for(const c of t.chapters){
        const b=document.querySelector('[data-reading-detail="'+c.id+'"]');
        if(!b){bad.push(t.id+'/'+c.id+': navigation');break;}
        b.click(); count++;
        const body=document.getElementById('book-body');
        if(__t.reading.detail!==c.id||body.querySelectorAll('article').length<4||body.querySelectorAll('.reading-sources a').length<2||body.scrollWidth>body.clientWidth)bad.push(t.id+'/'+c.id+': body');
      }
      document.getElementById('reading-back').click();
      document.getElementById('reading-back').click();
      if(!__t.reading.catalog){bad.push(t.id+': return');break;}
    }
    return {count,bad,topics:__t.topics.length};
  })()`);
  check('全部117篇可断网逐篇导航、显示来源并返回目录',offlineAll.count===117&&offlineAll.topics===28&&!offlineAll.bad.length,offlineAll);

  const errs = await js('window.__errs');
  check('控制台无异常', errs.length === 0, errs.slice(0, 4));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? 'FAILED' : 'PASSED'} · ${results.length - failed}/${results.length}`);
  await Promise.race([send('Browser.close').catch(()=>{}),sleep(1500)]);
  ws.close(); proc.kill(); server.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('verify 出错:', e.message); process.exit(2); });
