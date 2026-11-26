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
  const profile = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'globe-verify-'));
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source:"Object.defineProperty(navigator,'standalone',{value:true,configurable:true})" });
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
    for (let i = 0; i < 40 && !await js('__t.sheetSettled && __t.globeSettled'); i++) await sleep(40);
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
  const manifestVersion = await js(`new URL(document.querySelector('link[rel="manifest"]').href).search`);
  check('PWA 图标引用与清单查询版本一致并包含 maskable 资源', /^\?v=\d+$/.test(manifestVersion) &&
    manifest.icons.every(icon => icon.src.endsWith(manifestVersion) && fs.existsSync(path.join(__dirname, '..', icon.src.split('?')[0]))) &&
    manifest.icons.some(icon => icon.purpose.includes('maskable')));

  check('渲染器就绪', (await js('window.__t.rendererKind')) === (process.env.NOGL ? 'canvas2d' : 'webgl'), await js('window.__t.rendererKind'));
  check('冷启动使用 1500 年且历史疆域数据已装载', await js("__t.state.year===1500 && __t.state.layerId==='polity' && __t.polityLoaded && __t.partition.shapes.length>20"));
  await js('__t.commitYear(__t.yearBounds.max)');
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
  let returned = await camera();
  for (let i=0; i<22 && (Math.hypot(returned.x, returned.y)>=.1 || Math.abs(returned.yaw-yawWhilePressed)<=.003); i++) {
    await sleep(100);
    returned = await camera();
  }
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
  let fit = await camera();
  for (let i = 0; i < 10 && Math.abs(fit.yaw - heldView.yaw) <= .003; i++) {
    await sleep(100);
    fit = await camera();
  }
  check('缩小到默认倍率后重新自转', fit.zoom === 1 && Math.hypot(fit.x, fit.y) < .1 &&
    Math.abs(fit.yaw - heldView.yaw) > .003, fit);
  await js(`__t.stopSpin(); document.getElementById('globe').dispatchEvent(new KeyboardEvent('keydown',{key:'r',bubbles:true}));`);
  await sleep(480);
  check('键盘复位恢复默认镜头', await js('__t.state.zoom===1 && Math.abs(__t.state.yaw-__t.homeCamera.yaw)<.01'));
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
    title: document.querySelector('#sheet-identity-name').textContent,
    bookLink: document.querySelector('#sheet [data-open-sheet-book]')?.textContent || '',
    entries: document.querySelectorAll('#sheet [data-read-subject]').length})`);
  check('点当下的中国清晰显示现代国家名并附相关书卷入口',
    sheet.open && sheet.title === '中国' && sheet.bookLink.includes('中华人民共和国') && sheet.entries === 1, sheet);
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
  check('首页保留显式年份、时间游标、史事和视图入口', await js(`['#year','#hud-view','#vernier-track','#vernier-events'].every(id=>document.querySelector(id).getClientRects().length) &&
    !document.querySelector('#year-strip,#toolbar,#view-toggle,#classic-link,#dock,#track')`));
  await js("__t.setYear(1900)");
  await tap(...Object.values(await pointOf('#year')));
  check('轻点年份打开精确输入且不会打开事件列表', await js("!document.getElementById('year-form').hidden && document.getElementById('overlay').hidden && document.activeElement.id==='year-input'"));
  await js(`document.querySelector('#year-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  await tap(...Object.values(await pointOf('#vernier-events')));
  check('底部史事打开当年事件与阅读入口', await js("!document.getElementById('overlay').hidden && document.getElementById('overlay-title').textContent==='1900 年' && document.querySelector('[data-world-read=i-140]')"));
  const worldView = () => js('JSON.stringify([__t.state.year,__t.state.layerId,__t.state.yaw,__t.state.tilt,__t.state.zoom,__t.state.panX,__t.state.panY])');
  const originalWorldView = await worldView();
  await readingShot('year-discovery');
  const directRead = '[data-world-read=i-140]';
  const directScroll = await js(`document.querySelector('${directRead}').scrollIntoView({block:'center'});document.getElementById('overlay-body').scrollTop`);
  await tap(...Object.values(await pointOf(directRead)));
  await waitReader();
  check('从年份事件直接打开清朝对应章，保持地球年份与镜头',originalWorldView===await worldView() && await js(`
    __t.reading.subject?.id==='qing' && __t.reading.detail==='reforms' && !__t.worldEvent && document.getElementById('overlay').hidden`));
  await js(`document.getElementById('reading-exit').click()`);
  await waitReader();
  check('收起由年份进入的书卷，原事件仍在同一位置并恢复焦点',await js(`
    !document.getElementById('overlay').hidden && document.getElementById('overlay-body').scrollTop===${directScroll} &&
      document.activeElement.matches('${directRead}')`));
  check('长期背景折叠，与具体事件区分，而且可进入书卷',await js(`(() => {
    const row=document.querySelector('[data-event=i-kr-empire]');
    const background=row.closest('details');
    const link=background.querySelector('[data-world-read=i-041]');
    return !background.open && background.querySelector('summary').textContent==='长期背景' && link.textContent.includes('清朝');
  })()`));
  const worldRow = 'button[data-event="i-140"]';
  await js(`document.querySelector('${worldRow}').scrollIntoView({block:'center'})`);
  const worldScroll = await js('document.getElementById("overlay-body").scrollTop');
  await tap(...Object.values(await pointOf(worldRow)));
  const eventMap = await js(`({chapter:__t.worldEvent?.target?.chapter.id,year:__t.state.year,
    panel:!document.getElementById('event-map-panel').hidden,world:document.getElementById('overlay').hidden,
    labels:[...document.querySelectorAll('.event-map-point:not([hidden]) button:not([hidden])')].map(b=>b.textContent),
    participants:document.getElementById('event-participant-names').textContent})`);
  check('世界表打开事件地球，呈现北京、天津和参与方',eventMap.chapter==='boxers' && eventMap.year===1900 && eventMap.panel && eventMap.world &&
    eventMap.labels.join(',')==='北京,天津' && eventMap.participants==='清朝、义和团、八国联军',eventMap);
  await readingShot('world-event');
  await tap(...Object.values(await pointOf('#event-map-participants summary')));
  check('展开参与方显示角色和全部八国',await js(`document.getElementById('event-map-participants').open &&
    document.querySelectorAll('#event-participant-roles dt').length===3 &&
    document.querySelector('#event-participant-roles dd span').textContent==='英国、法国、德国、俄国、日本、美国、意大利、奥匈帝国'`));
  await readingShot('world-event-participants');
  await tap(...Object.values(await pointOf('#event-map-participants summary')));
  const pinBefore = await js('document.querySelector(".event-map-point").style.transform');
  const eventExplanation = await js('document.getElementById("event-map-note").textContent');
  await tap(...Object.values(await pointOf('.event-map-point button[data-place="tianjin"]')));
  check('点天津补充其作用并保留事件说明',await js(`document.getElementById('event-map-place-note').textContent.includes('天津') &&
    document.getElementById('event-map-note').textContent===${JSON.stringify(eventExplanation)} &&
    document.querySelector('button[data-place="tianjin"]').getAttribute('aria-pressed')==='true'`));
  await drag(110, 380, 185, 385, 6);
  check('旋转地球时地点跟随经纬度',await js(`document.querySelector('.event-map-point').style.transform!==${JSON.stringify(pinBefore)} &&
    __t.sheet.detent==='hidden' && !__t.state.focus`));
  await js(`document.getElementById('event-map-read').click()`);
  await waitReader();
  check('从事件进入正文',await js(`__t.reading.subject.id==='qing' && __t.reading.detail==='reforms' && document.getElementById('event-map-panel').inert`));
  await js('__t.closeReader()');
  await waitReader();
  check('收起正文回到同一事件与地点',await js(`!document.getElementById('event-map-panel').inert && __t.session.observe.place==='tianjin'`));
  await js(`document.getElementById('event-map-return').click()`);
  check('返回世界表恢复原年份、镜头、列表位置与焦点',originalWorldView===await worldView() && await js(`
    !document.getElementById('overlay').hidden && document.getElementById('overlay-body').scrollTop===${worldScroll} &&
    document.activeElement.dataset.event==='i-140'`));
  for (const year of [1842, 1839]) {
    await js(`document.getElementById('overlay-close').click();__t.setYear(${year});document.getElementById('vernier-events').click();
      document.querySelector('[data-event="i-138"]').click()`);
    await waitReader();
    if (year===1842) {
      const ports = await js(`(() => {
        const markers=[...document.querySelectorAll('.event-map-point')];
        return { chapter:__t.worldEvent.target.chapter.id, names:markers.map(mark=>mark.querySelector('button').textContent),
          projected:markers.filter(mark=>!mark.hidden && mark.style.transform).length,
          readable:markers.some(mark=>!mark.hidden && !mark.querySelector('button').hidden),
          signatories:document.getElementById('event-participant-names').textContent };
      })()`);
      check('1842 年在地球投影条约地点及五处口岸，并显示签约方', ports.chapter==='ports' && ports.projected===6 &&
        ports.names.join(',')==='南京,上海,宁波,福州,厦门,广州' && ports.readable && ports.signatories==='清朝、英国', ports);
      await readingShot('world-event-ports');
    } else {
      check('只有地区资料时显示区域范围',await js(`!__t.worldEvent.target && __t.worldEvent.regionVector &&
        document.getElementById('event-map-points').hidden && document.getElementById('event-map-participants').hidden &&
        document.getElementById('event-map-note').textContent.startsWith('相关地区')`));
    }
    await js(`document.getElementById('event-map-return').click()`);
  }
  await js('__t.setYear(1900)');
  await js("document.getElementById('overlay-close').click()");
  const touchYear = (point, type) => send('Input.dispatchTouchEvent', {
    type, touchPoints: ['touchEnd','touchCancel'].includes(type) ? [] : [point],
  });
  const waitYear = async () => {
    for(let i=0;i<30 && await js('__t.timeline.moving');i++)await sleep(30);
  };
  const topYearPoint = await pointOf('#year');
  await touchYear(topYearPoint,'touchStart');
  await sleep(560);
  check('顶部年份长按不会打开第二时间轴', await js("!document.querySelector('#year-strip') && document.querySelector('#overlay').hidden && __t.state.year===1900"));
  await touchYear({x:topYearPoint.x+85,y:topYearPoint.y},'touchMove');
  await touchYear(topYearPoint,'touchEnd');
  check('拖动顶部年份不改变地图年份', await js('__t.state.year===1900 && __t.timeline.year===1900'));
  await js("if(!document.querySelector('#year-form').hidden)document.querySelector('#year').click()");
  const yearPoint = await pointOf('#vernier-track');
  const yearCamera = await js('JSON.stringify([__t.state.yaw,__t.state.tilt,__t.state.zoom,__t.state.panX,__t.state.panY])');
  await touchYear(yearPoint,'touchStart');
  await touchYear({x:yearPoint.x+16,y:yearPoint.y},'touchMove');
  await sleep(100);
  const smallChange = await js('__t.timeline.position');
  check('底部拖动时明确区分预览年份和生效地图年份',Math.round(smallChange)===1899 &&
    await js("__t.state.year===1900 && document.querySelector('#vernier-era').textContent.includes('地图 1900')"),smallChange);
  await sleep(150);
  await touchYear(yearPoint,'touchEnd');
  await waitYear();
  await js('__t.ensurePolity()');
  for(let i=0;i<40;i++){if(await js('__t.polityLoaded'))break;await sleep(200);}
  check('小幅拖动停稳后切换一年和真实疆域，镜头固定',await js("__t.state.layerId==='polity' && __t.state.year===1899 && __t.partition.shapes.length>0") &&
    yearCamera===await js('JSON.stringify([__t.state.yaw,__t.state.tilt,__t.state.zoom,__t.state.panX,__t.state.panY])'));
  const historySignature = await js('JSON.stringify(__t.partition.shapes.map(s=>[s.ent.name,s.pathId]))');
  await touchYear(yearPoint,'touchStart');
  await touchYear({x:yearPoint.x+96,y:yearPoint.y},'touchMove');
  const wideChange = 1899 - await js('__t.timeline.position');
  check('底部游标连续移动，长拖跨越更多年份',wideChange>5 && wideChange>1900-smallChange,wideChange);
  await sleep(150);
  await touchYear(yearPoint,'touchEnd');
  await waitYear();
  check('放慢后松手只吸附到最近年份',await js('__t.state.year===Math.round(1899-'+wideChange+')'));
  await touchYear(yearPoint,'touchStart');
  await touchYear({x:yearPoint.x-130,y:yearPoint.y},'touchMove');
  const flickPosition = await js('__t.timeline.position');
  await touchYear({x:yearPoint.x-175,y:yearPoint.y},'touchMove');
  await touchYear(yearPoint,'touchEnd');
  await waitYear();
  check('快速向左拨动继续滑入后续年份',await js('__t.state.year>Math.round('+flickPosition+')+1'));
  const flickYear = await js('__t.state.year');
  await touchYear(yearPoint,'touchStart');
  await touchYear({x:yearPoint.x+170,y:yearPoint.y},'touchMove');
  await touchYear(yearPoint,'touchCancel');
  await waitYear();
  check('系统取消手势后恢复上次所选年份',await js(`__t.state.year===${flickYear} && __t.timeline.year===${flickYear}`));
  await tap(24,160);
  check('点击空白保留年份、视图设置和时间游标',await js(`__t.sheet.detent==='hidden' && __t.state.year===${flickYear} &&
    !document.querySelector('#vernier').hidden && document.elementFromPoint(25,32)?.closest('#year')`));
  await touchYear(topYearPoint,'touchStart');
  await touchYear(topYearPoint,'touchEnd');
  await sleep(330);
  check('触屏轻点就地输入，世界表保持关闭',await js("!document.getElementById('year-form').hidden && document.getElementById('overlay').hidden && document.activeElement.id==='year-input'"));
  await readingShot('year-input');
  await js("document.getElementById('year-input').value='1900';document.getElementById('year-form').requestSubmit()");
  check('输入历史年份改变真实边界几何',await js("__t.state.year===1900 && JSON.stringify(__t.partition.shapes.map(s=>[s.ent.name,s.pathId]))!=="+JSON.stringify(historySignature)));
  const yearKey = (key, target = '#year') => js(`document.querySelector('${target}').dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true}))`);
  await yearKey('F2');
  await js("document.getElementById('year-input').value='公元 0 年';document.getElementById('year-form').requestSubmit()");
  check('键盘可输入年份，公元 0 年有就地错误提示',await js("__t.state.year===1900 && document.getElementById('year-input').getAttribute('aria-invalid')==='true'"));
  await js("document.getElementById('year-input').value='公元前 1 年';document.getElementById('year-form').requestSubmit()");
  check('公元前年份可输入，时间游标准确对应公元前一年',await js('__t.state.year===-1 && __t.timeline.year===-1'));
  await yearKey('ArrowRight','#vernier-track');
  check('键盘逐年移动跨过公元 0 年',await js('__t.state.year===1'));
  await yearKey('Escape');
  const designShot = async name => {
    if (process.env.ATLAS_SHOTS !== '1' && process.env.ATLAS_SHOTS !== name) return;
    const shot=await send('Page.captureScreenshot',{format:'png'});
    require('fs').writeFileSync(require('path').join(__dirname,'../docs/design',name+'.png'),Buffer.from(shot.data,'base64'));
  };
  await send('Emulation.setDeviceMetricsOverride', {width:402,height:874,deviceScaleFactor:3,mobile:true});
  await js("__t.setYear(1900);document.activeElement.blur()");
  await sleep(350);
  await designShot('globe');
  check('首页保留球下留白与深色舞台',await js("!document.getElementById('home-story') && __t.view.h-(__t.view.cy+__t.view.R)>100 && getComputedStyle(document.body).backgroundImage.includes('radial-gradient')"));
  check('加载层与页面边缘同色，收起的抽屉停止绘制',await js(`getComputedStyle(document.documentElement).backgroundColor===__t.bootBackground &&
    getComputedStyle(document.getElementById('sheet')).visibility==='hidden'`));
  const mapCamera = await js(`(() => {
    const s = __t.state;
    const camera = {yaw:s.yaw,tilt:s.tilt,zoom:s.zoom,panX:s.panX,panY:s.panY};
    __t.setLayer('country');
    Object.assign(s,{yaw:-1.8,tilt:.55,zoom:4.8,panX:0,panY:0});
    Object.defineProperty(navigator,'standalone',{value:true,configurable:true});
    return camera;
  })()`);
  const phoneSize = {width:402,height:812,screenWidth:402,screenHeight:874,deviceScaleFactor:3,mobile:true};
  await send('Emulation.setDeviceMetricsOverride',phoneSize);
  await js("document.documentElement.style.setProperty('--safe-t','62px');document.documentElement.style.setProperty('--safe-b','34px');window.dispatchEvent(new Event('resize'))");
  await sleep(300);
  check('短主屏幕视口按实际画布绘制且不会重复扣除安全区',await js(`(() => {
    const globe=document.getElementById('globe'), vec=document.getElementById('vec');
    const surface=__t.rendererKind==='canvas2d' ? document.getElementById('globe-fallback') : globe;
    return document.documentElement.style.getPropertyValue('--usable-safe-b') === '0px' && __t.view.h===812 &&
      globe.getBoundingClientRect().height===812 && surface.height===2436 && vec.height===2436;
  })()`));
  await readingShot('globe-short-viewport');
  await send('Emulation.setDeviceMetricsOverride',{...phoneSize,height:874});
  await js(`window.__viewportHeightDescriptor=Object.getOwnPropertyDescriptor(window,'innerHeight');
    Object.defineProperty(window,'innerHeight',{value:812,configurable:true});window.dispatchEvent(new Event('pageshow'))`);
  await sleep(300);
  check('恢复全高时采用实际画布和正常安全区',await js(`__t.view.h===874 && document.getElementById('vec').height===2622 &&
    document.documentElement.style.getPropertyValue('--usable-safe-b') === '34px'`));
  const labelAvoidance = await js(`(() => {
    const ctx = document.getElementById('vec').getContext('2d'), hud = document.getElementById('hud');
    const drawText = ctx.fillText;
    let labels=[];
    ctx.fillText = function(name,x,y){labels.push({name,x,y,width:this.measureText(name).width});};
    try {
      const rect = document.getElementById('year').getBoundingClientRect();
      const x = (rect.left+rect.right)/2,y = (rect.top+rect.bottom)/2;
      hud.style.visibility='hidden';
      __t.drawVector();
      const candidate = labels.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];
      if(!candidate) return {before:false,after:false};
      __t.state.panX += x-candidate.x;
      __t.state.panY += y-candidate.y;
      labels=[];
      __t.drawVector();
      const before = labels.some((label)=>label.name===candidate.name && Math.abs(label.y-y)<1);
      hud.style.visibility='';
      labels=[];
      __t.drawVector();
      const after = labels.some((label)=>label.name===candidate.name);
      return {name:candidate.name,before,after,remaining:labels.length};
    } finally {
      ctx.fillText=drawText;
      hud.style.visibility='';
      __t.redraw();
    }
  })()`);
  check('地名与实测年份框相交时避让，其他地名保留',labelAvoidance.before && !labelAvoidance.after && labelAvoidance.remaining>0,labelAvoidance);
  await sleep(80);
  await readingShot('globe-year-labels');
  await js(`if(window.__viewportHeightDescriptor) Object.defineProperty(window,'innerHeight',window.__viewportHeightDescriptor);
    else delete window.innerHeight;
    delete window.__viewportHeightDescriptor;document.documentElement.style.removeProperty('--safe-t');document.documentElement.style.removeProperty('--safe-b');
    Object.assign(__t.state,${JSON.stringify(mapCamera)});window.dispatchEvent(new Event('pageshow'));`);
  await js("__t.setLayer('polity')");
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:2,mobile:true});
  await sleep(300);
  const globePoint = await js("({x:__t.view.cx,y:__t.view.cy})");
  await hold(globePoint,true);
  const panelOpened = await js(`({visible:!document.getElementById('view-panel').hidden,detent:__t.sheet.detent,
    focus:document.activeElement.dataset.view,point:!!__t.mapPointAt(${globePoint.x},${globePoint.y})})`);
  check('长按松手后保持地球视图打开，不触发地区摘要',panelOpened.visible && panelOpened.detent==='hidden' && panelOpened.focus==='history',panelOpened);
  await designShot('views');
  await readingShot('globe-view-sheet');
  const mapBeforeSwitch = await camera();
  await js("document.querySelector('[data-view=nature]').click()");
  check('地形立刻关闭行政着色，面板留在原处', await js("__t.partition.lut.every(v=>v===0) && !document.getElementById('view-panel').hidden") &&
    JSON.stringify(await camera())===JSON.stringify(mapBeforeSwitch));
  await js("document.getElementById('toggle-grid').click()");
  check('经纬线开关即时生效并保存，地形暂禁地名切换',await js(`document.getElementById('toggle-grid').getAttribute('aria-checked')==='true' &&
    JSON.parse(localStorage.getItem('globe.display.v4')).grid && document.getElementById('toggle-labels').disabled`));
  await js("document.getElementById('toggle-grid').click()");
  const panel = await pointOf('#view-panel');
  await drag(panel.x,panel.y,panel.x,panel.y+28);
  check('面板内手势保留预览且不拖动地球',await js("!document.getElementById('view-panel').hidden") && JSON.stringify(await camera())===JSON.stringify(mapBeforeSwitch));
  await js("document.querySelector('#view-shade').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,button:0,pointerType:'touch'}))");
  await sleep(250);
  check('点面板外关闭视图并把焦点交回地球',await js("document.getElementById('view-panel').hidden && document.activeElement.id==='globe'"));
  await tap(globePoint.x,globePoint.y);
  check('地形视图轻点球体不会打开看不见的国家边界',await js("__t.sheet.detent==='hidden'"));
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...globePoint,button:'right',buttons:2,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...globePoint,button:'right',buttons:0,clickCount:1});
  check('桌面右键可打开观察方式',await js("!document.getElementById('view-panel').hidden"));
  await js("document.querySelector('[data-view=modern]').click();document.getElementById('globe').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
  await sleep(230);
  await yearKey('ArrowLeft','#vernier-track');
  check('手动选择现代国家后，调年份保留现代边界',await js("__t.state.layerId==='country' && __t.state.year===1899"));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});
  await js("document.getElementById('globe').dispatchEvent(new KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true}));document.querySelector('[data-view=history]').click()");
  check('随年份可在原年份恢复历史疆域，并把该方式作为当前选择',await js(`__t.state.year===1899 && __t.state.layerId==='polity' &&
    document.querySelector('[data-view=history]').getAttribute('aria-pressed')==='true'`));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});
  await sleep(260);

  /* 切到政权层 */
  await js(`window.__t.setYear(1900)`);
  await js(`window.__t.setLayer('polity')`);
  await js(`window.__t.ensurePolity()`);
  for (let i = 0; i < 40; i++) { if (await js('window.__t.polityLoaded')) break; await sleep(250); }
  const pol = await js(`({loaded: window.__t.polityLoaded, shapes: window.__t.partition.shapes.length, entities: window.__t.summary.entities,
    hud: document.getElementById('year-era').textContent})`);
  check('政权层已加载并栅格化', pol.loaded && pol.shapes > 20, pol);

  /* 点一个政权（1900 年 · 安纳托利亚） */
  await js(`(() => { const t = window.__t; t.state.yaw = -0.60; t.state.tilt = 0.35; t.redraw(); })()`);
  await sleep(200);
  const pp = await js(`(() => { const q = window.__t.screenOf(32*Math.PI/180, 39*Math.PI/180); return {x:q.x, y:q.y, front:q.front}; })()`);
  await tap(pp.x, pp.y);
  await sleep(220);
  const polSheet = await js(`({
    open: document.body.classList.contains('sheet-open'),
    title: document.querySelector('#sheet-identity-name').textContent,
    era: document.querySelector('#sheet-identity-years').textContent,
    entries: document.querySelectorAll('#sheet [data-read-subject]').length
  })`);
  check('点政权打开对应年份的摘要',
    polSheet.open && /Empire|Kingdom|Khanate|Sultanate|Caliphate|Dynasty|Emirate|Republic|Confederation|帝国|王国|汗国|苏丹|共和国|王朝/i.test(polSheet.title || '') &&
    polSheet.entries === 1 && polSheet.era.includes('1922'),
    polSheet);

  /* 回归：换年份后抽屉仍然停在同一个实体（focus 存的是 key，不是 shape id） */
  const stable = await js(`(() => {
    const t = window.__t;
    const before = t.state.focus && t.state.focus.key;
    const titleBefore = document.querySelector('#sheet-identity-name').textContent;
    t.setYear(1901);
    const after = t.state.focus && t.state.focus.key, titleAfter = document.querySelector('#sheet-identity-name').textContent;
    t.setYear(1200);
    return { before, after, titleBefore, titleAfter, unavailable:t.state.focus===null };
  })()`);
  check('换年份后保留仍有效的主体，无疆域时关闭旧选区', stable.before === stable.after && stable.titleBefore === stable.titleAfter && stable.unavailable, stable);

  /* 切回国家层 */
  await js(`__t.setLayer('country');__t.setYear(__t.yearBounds.max)`);
  const back = await js(`({shapes: window.__t.partition.shapes.length, iso: !!window.__t.shapeOf(1).iso})`);
  check('可切回国家层', back.shapes > 100 && back.iso, back);
  /* 抽屉三档：上拉应到 full，且内容变成可滚动的书 */
  await js(`window.__t.openEntity('country', window.__t.partition.shapes.find(s => s.iso === 'CN').id)`);
  await sleep(520);
  const half = await js('({ detent: window.__t.sheet.detent, hasEntry: !!document.querySelector("#sheet [data-read-subject]"), hasLongText: !!document.querySelector("#sheet .book article") })');
  await js('window.__t.openBook()');
  await sleep(560);
  const full = await js('({ open: !document.getElementById("book").hidden, scrollable: getComputedStyle(document.getElementById("book-body")).overflowY, cards: document.querySelectorAll("#book .reading-card").length })');
  check('抽屉从短摘要进入独立阅读层，摘要不摊开长文', half.detent === 'peek' && half.hasEntry && !half.hasLongText &&
    full.open && full.scrollable === 'auto' && full.cards > 0, { half, full });
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
    const pt = await js(`(()=>{const r=document.querySelector(${JSON.stringify(target==='grab'?'#grab':'#sheet-identity')}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(r.height/2,24)}})()`);
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
    await waitReader();
    return {...following,...await js('({detent:__t.sheet.detent,finalOffset:__t.sheet.offset,reading:!document.getElementById("book").hidden})')};
  };
  await openCountry();
  if(process.env.UPDATE_SHOTS) {
  const popupShot = await send('Page.captureScreenshot', {format:'png'});
  require('fs').writeFileSync(require('path').join(__dirname,'../docs/sheet-gestures.png'),Buffer.from(popupShot.data,'base64'));
  }
  const soft=await sheetGesture(26,65,6,true,'grab',false,150);
  check('触摸小幅下拖跟手，松手回弹摘要', soft.dragging && Math.abs(soft.offset-soft.start-26)<3 && soft.detent==='peek' && Math.abs(soft.finalOffset-soft.start)<2,soft);
  const cancel=await sheetGesture(-150,30,8,true,'grab',true);
  check('系统取消手势只回弹，不误触阅读', !cancel.reading && cancel.detent==='peek' && Math.abs(cancel.finalOffset-cancel.start)<2,cancel);
  const expand=await sheetGesture(-510,45,10,true,'header');
  check('摘要头长拖进入全屏', expand.reading && await js("document.getElementById('book').getBoundingClientRect().top===0 && document.getElementById('globe').inert"),expand);
  await js('__t.closeReader()');
  await sleep(200);
  const down=await sheetGesture(155,60,10,true);
  check('缓慢下拖过阈值隐藏摘要', down.detent==='hidden' && !down.reading,down);
  await openCountry();
  const flickUp=await sheetGesture(-60,8,4,true);
  check('摘要短距离快速上扫进入阅读', flickUp.reading && await js("document.getElementById('book').getBoundingClientRect().height===innerHeight"),flickUp);
  await js('__t.closeReader()');
  await sleep(200);
  const flickDown=await sheetGesture(60,8,4,true);
  check('短距离快速下扫也能关闭', flickDown.detent==='hidden',flickDown);
  await openCountry();
  const held=await sheetGesture(-60,8,4,true,'grab',false,240);
  check('拖动后停住再松手不会沿用旧速度', !held.reading && held.detent==='peek',held);
  // 阅读入口的区域保留原生手势，不把掠过按钮的滑动当成点击。
  await send('Emulation.setDeviceMetricsOverride', {width:320,height:480,deviceScaleFactor:2,mobile:true});
  await sleep(240);
  await openCountry();
  await js('document.getElementById("sheet-scroll").scrollTop=0');
  const row=await pointOf('#sheet-toc');
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:row.x,y:row.y}]});
  for(let i=1;i<=6;i++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:row.x,y:row.y-i*18}]});await sleep(30);}
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(350);
  const scroll=await js('({top:document.getElementById("sheet-scroll").scrollTop,reading:__t.reading.active,detent:__t.sheet.detent})');
  check('滑过可见摘要入口不会误触阅读', !scroll.reading && scroll.detent==='peek',scroll);
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


  /* 同一历史主体跨年份开启同一卷，阅读与地图分别保留位置。 */
  const cameraSnapshot = () => js('JSON.stringify([__t.state.year,__t.state.layerId,__t.state.yaw,__t.state.tilt,__t.state.zoom,__t.state.panX,__t.state.panY,__t.state.focus?.key])');
  const openMing = async (year) => {
    for (let i=0;i<30 && !await js('__t.sheetSettled');i++) await sleep(40);
    await js(`(() => { const t=__t; t.setLayer('polity'); t.setYear(${year});
      Object.assign(t.state,{yaw:-1.77,tilt:.35,zoom:1.9,panX:0,panY:0}); t.view.Rz=t.view.R*1.9; t.redraw(); })()`);
    const point = await js(`(() => {const p=__t.screenOf(115*Math.PI/180,33*Math.PI/180);return [p.x,p.y]})()`);
    await tap(...point);
    const action = await js("document.querySelector('#sheet-toc').textContent");
    await tap(...Object.values(await pointOf('#sheet-toc')));
    await waitReader();
    return action;
  };
  await openMing(1500);
  const original = await cameraSnapshot();
  const readOutline = () => js(`({title:document.getElementById('reading-title').textContent,
    anchor:document.querySelector('.reading-entry-year')?.dataset.readingDetail,
    chapters:[...document.querySelectorAll('.reading-row')].map(b=>b.dataset.readingDetail)})`);
  const ming1500=await readOutline();
  check('1500 年点明朝疆域打开明朝全卷与弘治前后章节',ming1500.title==='明朝' && ming1500.anchor==='court-paperwork' && ming1500.chapters.length===20,ming1500);
  await readingShot('ming-book');
  await js(`document.querySelector('[data-reading-detail=founding]').click()`);
  check('正文从王朝建立讲起并可查看段落出处',await js(`document.querySelector('.subject-prose').textContent.includes('朱元璋') &&
    !!document.querySelector('.reading-refs a') && !!document.querySelector('.reading-sources a')`));
  await js(`document.querySelector('.subject-chapter-next [data-reading-detail=households-garrisons]').click()`);
  check('正文可沿章节顺读，地球不自动跳年',await js(`__t.reading.detail==='households-garrisons' && __t.state.year===1500`));
  await js(`document.querySelector('#reading-index').click();document.querySelector('[data-reading-detail=two-capitals]').click()`);
  const jingnan = '[data-subject-scene=jingnan-campaign]';
  const yongle = '[data-subject-scene=yongle-capitals]';
  check('本章地图图版分别跟随数据指定的正文段落，移动阅读时不会自动打开',await js(`(() => {
    const prose=document.querySelector('.subject-prose'), paragraphs=[...prose.querySelectorAll(':scope > p')];
    const refs=__t.reading.subject.chapters.find(chapter=>chapter.id==='two-capitals').sceneRefs;
    return !__t.worldEvent && refs.every(ref=>{
      const card=prose.querySelector('[data-subject-scene="'+ref.id+'"]');
      return card && paragraphs.findLast(p=>p.compareDocumentPosition(card)&Node.DOCUMENT_POSITION_FOLLOWING)
        ?.dataset.blockId===ref.afterBlockId;
    });
  })()`));
  await js(`document.querySelector('${jingnan}').scrollIntoView({block:'center'})`);
  await readingShot('ming-inline-scene');
  const chapterScroll = await js('document.getElementById("book-body").scrollTop');
  await js(`document.querySelector('${jingnan}').click()`);
  await sleep(300);
  check('进入靖难第一阶段，固定年份与返回正文在顶部，只有当前地点', await js(`
    __t.worldEvent.sceneId==='jingnan-campaign' && __t.state.year===1399 && __t.state.layerId==='polity' &&
    !__t.reading.active && document.getElementById('event-map-year').textContent.includes('1399') &&
    document.getElementById('event-map-return').textContent.trim()==='返回正文' &&
    getComputedStyle(document.getElementById('hud')).visibility==='hidden' &&
    [...__t.worldEvent.points.keys()].join(',')==='beiping'`));
  check('靖难第一阶段没有路线和跨阶段距离',await js(`document.getElementById('event-map-distance').hidden &&
    __t.worldEvent.routes.length===0`));
  await js(`document.querySelector('[data-scene-step="2"]').click()`);
  await sleep(350);
  await readingShot('ming-observation');
  await js(`document.querySelector('.event-map-point button[data-place=nanjing]').click()`);
  check('点选南京时补充历史作用并保留阶段解释',await js(`document.getElementById('event-map-place-note').textContent.includes('建文朝廷都城') &&
    document.getElementById('event-map-note').textContent.includes('皇位归属') &&
    document.getElementById('event-map-participants').hidden && document.getElementById('event-map-read').hidden`));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',windowsVirtualKeyCode:39});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'F2',windowsVirtualKeyCode:113});
  const beforeSceneDrag=await camera();
  await drag(115,285,171,295);
  check('观察可旋转，键盘不会改变历史场景年份或进入输入', (await camera()).yaw!==beforeSceneDrag.yaw &&
    await js(`__t.state.year===1402 && document.getElementById('year-form').hidden`));
  await js(`document.getElementById('event-map-return').click()`);
  await waitReader();
  check('从地图返回原章和原滚动位置，同时恢复地球镜头',original===await cameraSnapshot() &&
    await js(`__t.reading.detail==='two-capitals' && Math.abs(document.getElementById('book-body').scrollTop-${chapterScroll})<2 &&
      __t.reading.year===1500 && document.activeElement.matches('${jingnan}')`));
  await js(`document.querySelector('${yongle}').click()`);
  await js(`document.querySelector('[data-scene-step="2"]').click()`);
  await sleep(300);
  check('同章可进入迁都场景，四处地点可辨并替换上一场景的距离',await js(`
    __t.state.year===1421 && __t.worldEvent.sceneId==='yongle-capitals' &&
    document.getElementById('event-map-title').textContent==='永乐双都与大运河动脉' &&
    !document.getElementById('event-map-distance').hidden &&
    document.getElementById('event-map-distance').textContent.startsWith('南京至北京 · 地理直线距离约') &&
    ['苏州','南京','清江浦','北京'].every(name=>[...document.querySelectorAll('#event-map-place-chips button strong')].some(node=>node.textContent===name))`));
  await js(`document.querySelector('.event-map-point button[data-place=qingjiangpu]').click()`);
  check('打开清江浦可读到它在淮安运道的作用',await js(`document.getElementById('event-map-place-note').textContent.includes('淮安运道节点')`));
  await js(`document.getElementById('event-map-return').click()`);
  await waitReader();
  await js('__t.closeReader();__t.closeSheet()');
  const mingAction = await openMing(1600);
  check('已读主体摘要直接继续原章',mingAction==='继续阅读' && await js("__t.reading.detail==='two-capitals'"));
  await js("document.querySelector('#reading-index').click()");
  const ming1600=await readOutline();
  check('1600 年仍打开同一卷，只切换轻量时间定位',ming1600.title===ming1500.title && ming1600.anchor==='wanli-imjin' &&
    ming1600.chapters.join()===ming1500.chapters.join(),ming1600);
  await js(`document.querySelector('[data-subject-resume]').click()`);
  check('跨年份进入后可继续上次章节',await js(`__t.state.year===1600 && __t.reading.detail==='two-capitals'`));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',windowsVirtualKeyCode:37});
  check('阅读方向键不改变地球年份',await js('__t.state.year===1600'));
  for (const id of ['canal-labor','indian-ocean','renxuan','mid-ming'])
    await js(`document.querySelector('.subject-chapter-next [data-reading-detail=${id}]').click()`);
  check('从迁都顺读到中期，北京守卫、江南市场与沿海贸易进入同一章',await js(`
    __t.reading.detail==='mid-ming' && ['土木','景德镇','双屿'].every(name=>document.querySelector('.subject-prose').textContent.includes(name))`));
  await js(`document.querySelector('#reading-index').click();document.querySelector('[data-reading-detail=silver]').click()`);
  for (const [scene, year, places] of [['imjin-frontier',1592,['釜山','平壤','义州']],
    ['ming-beijing-1644',1644,['北京','西安']]]) {
    const selector = '[data-subject-scene=' + scene + ']';
    await js(`document.querySelector('${selector}').scrollIntoView({block:'center'})`);
    const scroll = await js('document.getElementById("book-body").scrollTop');
    await js(`document.querySelector('${selector}').click()`);
    await sleep(300);
    check(year+' 年场景列表仅包含当前阶段地点',await js(`
      __t.state.year===${year} && ${JSON.stringify(places)}.every(name=>
        [...document.querySelectorAll('#event-map-place-chips button strong')].some(n=>n.textContent===name))`));
    await js(`document.getElementById('event-map-return').click()`);
    await waitReader();
    check('返回 '+year+' 年场景对应正文的原位置',await js(`
      __t.state.year===1600 && document.activeElement.matches('${selector}') &&
      Math.abs(document.getElementById('book-body').scrollTop-${scroll})<2`));
    if (year === 1592) await js(`document.querySelector('#reading-index').click();document.querySelector('[data-reading-detail=fall]').click()`);
  }
  await js(`document.querySelector('.subject-chapter-next [data-reading-detail=southern-ming]').click()`);
  check('末章交代北京失守后的延续和影响',await js(`
    ['弘光','永历','郑成功','1683 年'].every(name=>document.querySelector('.subject-prose').textContent.includes(name))`));
  await js(`document.querySelector('.subject-chapter-next [data-reading-detail=fall]').click()`);
  await js(`document.querySelector('.reading-connections [data-subject-book=qing]').click()`);
  check('由明朝结尾顺着关系打开清朝卷，仍停在 1600 年',await js(`__t.reading.subject.id==='qing' && __t.state.year===1600`));
  await js(`document.getElementById('reading-back').click()`);
  check('跨卷返回保留前一本的章节',await js(`__t.reading.subject.id==='ming' && __t.reading.detail==='fall'`));
  const identities = await js(`[
    ['Qing Dynasty',1750,'qing'],['Ottoman Empire',1600,'ottoman'],['Roman Empire',100,'roman'],
    ['Byzantine Empire',1100,'roman'],["People's Republic of China",2000,'prc'],['Kingdom of France',1500,'france'],
    ['Tang Dynasty',750,'tang'],['Han Dynasty',100,'han'],['Tokugawa Shogunate',1750,'tokugawa'],
    ['Mughal Empire',1650,'mughal'],['Khmer Empire',1100,'khmer'],['Mali Empire',1400,'mali'],
    ['Achaemenid Empire',-500,'achaemenid'],['Aztec Triple Alliance',1480,'aztec'],['Inca Empire',1500,'inca'],
    ['Songhai Empire',1500,'songhai']
  ].map(([name,year,expected])=>{const ent=__t.pk.entities.find(e=>e.name===name);return {name,expected,
    actual:__t.subjectBookForEntity(__t.entityByKey('polity',ent.id),year)?.id||null}})`);
  check('各卷按稳定的书卷身份绑定来源数据中的历史主体',identities.every(x=>x.actual===x.expected),identities);
  await js(`__t.closeReader();__t.closeSheet();__t.setYear(1500)`);
  const localized = await js(`(() => {
    const shapes=__t.partition.shapes;
    const aztec=shapes.find(s=>s.ent.name==='Aztec Triple Alliance');
    __t.openEntity('polity',aztec.id);
    const sheet=document.querySelector('#sheet-identity-name').textContent;
    __t.openBook();
    return {sheet,book:__t.reading.subject.id,anchor:document.querySelector('.reading-entry-year')?.dataset.readingDetail,
      aztecLabel:__t.vecShapes.some(s=>s.name==='阿兹特克三方同盟'),
      chineseLabels:__t.vecShapes.every(s=>!s.name||/[\\u3400-\\u9fff]/.test(s.name)),
      zapotec:__t.polityNames.get('Zapotec Civilization'),
      relationInNames:__t.polityNames.has('Allegiance of Joseon to Ming Dynasty'),
      relationMeta:__t.polityRelations.get('Allegiance of Joseon to Ming Dynasty')?.description,
      noRelationShapes:!shapes.some(s=>__t.polityRelations.has(s.ent.name)),
      mingLabel:__t.vecShapes.some(s=>s.name==='明朝'),
      joseonLabel:__t.vecShapes.some(s=>s.name==='朝鲜王朝')};
  })()`);
  check('同一份中文名称用于历史地图，关系记录不作为主体标签并保留明朝与朝鲜王朝',localized.sheet==='阿兹特克三方同盟' && localized.book==='aztec' &&
    localized.anchor==='tribute-grid-pochteca' && localized.aztecLabel && localized.chineseLabels && localized.zapotec==='萨波特克文明' &&
    !localized.relationInNames && localized.relationMeta==='朝鲜王朝向明朝效忠' && localized.noRelationShapes &&
    localized.mingLabel && localized.joseonLabel,localized);
  await js(`__t.closeReader();__t.closeSheet();__t.setYear(1400)`);
  check('待核定主体保留地图点击，原始名称只在可展开的底图资料中显示',await js(`(() => {
    const shape=__t.partition.shapes.find(s=>s.ent.name==='Bahrani Dynasty');
    __t.openEntity('polity',shape.id);
    __t.openBook();
    const raw=[...document.querySelectorAll('.subject-secondary')].find(n=>n.querySelector('summary')?.textContent==='底图原名');
    return document.getElementById('reading-title').textContent.startsWith('中文名待考') &&
      raw?.textContent.includes('Bahrani Dynasty') && !raw.open && !__t.vecShapes.some(s=>s.name==='Bahrani Dynasty');
  })()`));
  await send('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:2,mobile:true});
  await sleep(300);
  check('320px 手机正文无横向溢出',await js(`document.getElementById('book-body').scrollWidth<=document.getElementById('book-body').clientWidth`));
  await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:2,mobile:true});
  await sleep(300);
  check('横屏阅读与关闭按钮有效',await js(`(() => {
    const close=document.querySelector('#reading-exit').getBoundingClientRect(), body=document.querySelector('#book-body');
    return body.clientHeight>100 && close.height>0 && close.top>=0 && close.bottom<=visualViewport.height;
  })()`));
  await js(`__t.closeReader();__t.closeSheet();__t.setLayer('country');__t.setYear(1980)`);
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:3,mobile:true});
  await js(`__t.openEntity('country',__t.partition.shapes.find(s=>s.iso==='KZ').id)`);
  await sleep(450);
  await js(`document.querySelector('[data-read-subject]').click()`);
  check('无独立卷的主体如实提供地图资料',await js(`!__t.reading.subject && document.querySelector('.lede').textContent.includes('尚未收录') &&
    !document.querySelector('.reading-row') && !!document.querySelector('.reading-sources a')`));
  await js(`__t.closeReader();__t.closeSheet();__t.setYear(__t.yearBounds.max);__t.openEntity('country',__t.partition.shapes.find(s=>s.iso==='CN').id)`);
  await sleep(500);
  const grab = await js(`(()=>{const r=document.getElementById('grab').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+13}})()`);
  await drag(grab.x,grab.y,grab.x,4,14);
  await waitReader();
  check('抓手上拉打开中华人民共和国卷，现存主体无终年',await js(`__t.reading.subject.id==='prc' &&
    document.querySelector('.reading-meta .when').textContent==='1949 年至今'`));
  const touchReader = async (target, distance, cancel = false, horizontal = false) => {
    const rect = await js(`document.querySelector(${JSON.stringify(target)}).getBoundingClientRect().toJSON()`);
    const start = { x:horizontal ? 20 : rect.x+rect.width/2, y:rect.y+(target==='#book-body'?200:rect.height/2) };
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
    for (let i=1;i<=6;i++) {
      const moved = distance*i/6;
      await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(horizontal?moved:0),y:start.y+(horizontal?0:moved)}]});
      await sleep(48);
    }
    await send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
    await sleep(180);
    return js(`({ top:document.getElementById('book').getBoundingClientRect().top,
      reader:__t.reading.active, scroll:document.getElementById('book-body').scrollTop,
      inert:document.getElementById('globe').inert, isolated:document.getElementById('book').parentElement===document.body })`);
  };
  const shortPull = await touchReader('#book-bar', 65);
  check('全屏顶栏下拉不改变阅读高度',shortPull.top===0 && shortPull.reader && shortPull.isolated,shortPull);
  const cancelledRead = await touchReader('#book-bar', 150, true);
  check('系统取消触摸时仍保留全屏阅读', cancelledRead.top===0 && cancelledRead.reader && cancelledRead.inert,cancelledRead);
  await js(`document.querySelector('.reading-row[data-reading-detail="state-making"]').click()`);
  check('正文直接叙述，史料索引落在同一章节',await js(`document.querySelector('.subject-prose p').textContent.includes('1949 年') &&
    !!document.getElementById(document.querySelector('.reading-refs a').hash.slice(1))`));
  const shortBack = await touchReader('#book-body', 35, false, true);
  check('移动端小幅横滑仍留在原章节', shortBack.reader && shortBack.top===0 && await js(`__t.reading.detail==='state-making'`), shortBack);
  const escape = () => js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await escape();
  check('Escape 从正文返回同一卷目录', await js("__t.session.mode==='Read' && __t.reading.subject.id==='prc' && __t.reading.detail===null"));
  await escape();
  check('Escape 从卷目录收回原摘要', await js("__t.session.mode==='Explore' && __t.sheet.detent==='peek' && __t.state.focus.key==='CN'"));
  await js('__t.openBook()');
  await js(`document.querySelector('.reading-row[data-reading-detail="mass-mobilization"]').click()`);
  const scrollRead = await touchReader('#book-body', -160);
  check('全屏正文原生滚动，正文滑动不收起', scrollRead.top===0 && scrollRead.reader && scrollRead.scroll>0, scrollRead);
  const scrollBack = await touchReader('#book-body', 100);
  check('正文未到顶时下拉仍然滚动', scrollBack.top===0 && scrollBack.reader && scrollBack.scroll<scrollRead.scroll, scrollBack);
  const prior = await js('({offset:__t.session.explore.summary.offset,detent:__t.session.explore.summary.detent,year:__t.session.explore.year,key:__t.session.explore.selection.key})');
  await js(`document.getElementById('book-body').scrollTop=0`);
  const pull = await touchReader('#book-body', 500);
  check('正文到顶继续下拉不会露出地图或摘要',pull.reader && pull.inert && pull.top===0 && pull.scroll===0,pull);
  await js("document.getElementById('reading-exit').click()");
  check('合上正文回到原摘要、年份与地区',await js(`!__t.reading.active && __t.sheet.detent===${JSON.stringify(prior.detent)} &&
    Math.abs(__t.sheet.offset-${prior.offset})<2 && __t.state.year===${prior.year} && __t.state.focus.key===${JSON.stringify(prior.key)}`));
  await js('__t.closeSheet()');

  /* P1 · 历史主体与编辑书卷身份分离（1453 帖木儿帝国 / 1500 明朝同名不重复 / 未核年代待核标记） */
  await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:3,mobile:true});
  await js(`__t.setLayer('polity');__t.setYear(1453);
    const t= __t.partition.shapes.find(s=>s.ent.name==='Timurid Empire');
    __t.openEntity('polity',t.id);`);
  await sleep(450);
  const timuridSheet = await js(`(() => {
    const bookBtn = document.querySelector('#sheet [data-open-sheet-book]');
    return {
      name: document.querySelector('#sheet-identity-name')?.textContent,
      years: document.querySelector('#sheet-identity-years')?.textContent,
      bookText: bookBtn?.textContent?.trim(),
      bookId: bookBtn?.dataset.openSheetBook,
      sheetBottom: Math.round(document.getElementById('sheet').getBoundingClientRect().bottom),
      peekBtnBottom: Math.round((bookBtn || document.querySelector('#sheet-toc'))?.getBoundingClientRect().bottom || 0),
    };
  })()`);
  check('1453 帖木儿帝国主体身份与《中亚丝路帝国》书卷入口分离且不贴边裁切',
    timuridSheet.name==='帖木儿帝国' && timuridSheet.years==='1370—1507 年 · 历史政权' &&
    timuridSheet.bookId==='central-asia-silk-road' && timuridSheet.bookText.includes('中亚丝路帝国') &&
    timuridSheet.bookText.includes('公元前 209 年至今') && timuridSheet.peekBtnBottom <= 840, timuridSheet);
  await js(`document.querySelector('#sheet [data-open-sheet-book]').click()`);
  await waitReader();
  const timuridReader = await js(`(() => ({
    bookId: __t.reading.subject?.id,
    ctx: document.querySelector('.subject-entry-context')?.textContent?.trim(),
    yearRec: document.querySelector('.reading-entry-year')?.textContent?.trim(),
    hasRecChapter: !!document.querySelector('.reading-row[data-reading-detail]'),
  }))()`);
  check('从帖木儿帝国打开《中亚丝路帝国》保留主体来源语境并推荐 1453 年章节',
    timuridReader.bookId==='central-asia-silk-road' && timuridReader.ctx?.includes('帖木儿帝国') &&
    timuridReader.yearRec?.includes('1453 年') && timuridReader.hasRecChapter, timuridReader);
  await js(`__t.closeReader();__t.closeSheet();__t.setYear(1500);
    __t.openEntity('polity',__t.partition.shapes.find(s=>s.ent.name==='Ming Dynasty').id);`);
  await sleep(450);
  const mingSheet = await js(`(() => ({
    name: document.querySelector('#sheet-identity-name')?.textContent,
    dupBookBtn: !!document.querySelector('#sheet [data-open-sheet-book]'),
    tocText: document.querySelector('#sheet-toc')?.textContent?.trim(),
  }))()`);
  check('同名主体明朝与《明朝》书卷不重复展示入口',
    mingSheet.name==='明朝' && !mingSheet.dupBookBtn && ['阅读历史','继续阅读'].includes(mingSheet.tocText), mingSheet);
  const unverifiedSample = await js(`(() => {
    const s = __t.partition.shapes.find(sh => {
      const ent = __t.entityByKey('polity', sh.ent.id);
      return ent && __t.subjectBookForEntity(ent, 1500) && !__t.historySubjectFor(ent);
    });
    if (!s) return null;
    __t.openEntity('polity', s.id);
    return {
      name: document.querySelector('#sheet-identity-name')?.textContent,
      years: document.querySelector('#sheet-identity-years')?.textContent,
      hasBookBtn: !!document.querySelector('#sheet [data-open-sheet-book]'),
    };
  })()`);
  check('未进主体台账的有书卷政权显示存续年代待核', unverifiedSample && unverifiedSample.years?.includes('存续年代待核') && unverifiedSample.years?.includes('底图记录'), unverifiedSample);

  /* P1 · 历史事件身份去重（1453 君士坦丁堡陷落、1500 卡布拉尔、1960 冷战） */
  await js(`__t.closeSheet();__t.setYear(1453);`);
  await sleep(250);
  await js(`document.getElementById('vernier-events').click()`);
  await sleep(250);
  const ev1453 = await js(`(() => {
    const rows = [...document.querySelectorAll('#overlay-body .witem')].map(el => ({
      title: el.querySelector('.wrow strong')?.textContent,
      meta: el.querySelector('.wrow small')?.textContent,
      books: [...el.querySelectorAll('[data-world-book]')].map(b => ({ book: b.dataset.worldBook, text: b.textContent.trim() })),
    }));
    const constRows = rows.filter(r => r.title === '君士坦丁堡陷落');
    const cabral = __t.yearEventGroups(1500).events.filter(e => e.start === 1500 && e.point);
    const coldwar = __t.yearEventGroups(1960).background.filter(e => /冷战/.test(e.zh || '') && e.start === 1947);
    return {
      label: document.getElementById('vernier-events')?.textContent?.trim(),
      constRows,
      cabralCount: cabral.length,
      coldwarCount: coldwar.length,
      groupCount: __t.yearEventGroups(1453).events.length + __t.yearEventGroups(1453).background.length,
      renderedCount: rows.length,
    };
  })()`);
  check('1453 年君士坦丁堡陷落合并为单条并保留罗马与奥斯曼双书卷入口',
    ev1453.constRows.length===1 && ev1453.constRows[0].meta.includes('土耳其') && ev1453.constRows[0].meta.includes('希腊') &&
    ev1453.constRows[0].books.some(b=>b.book==='roman') && ev1453.constRows[0].books.some(b=>b.book==='ottoman') &&
    ev1453.cabralCount===1 && ev1453.coldwarCount===1 && ev1453.groupCount===ev1453.renderedCount, ev1453);
  await js(`document.querySelector('#overlay [data-world-book="ottoman"]').click()`);
  await waitReader();
  const ottomanBookId = await js(`__t.reading.subject?.id`);
  check('从合并史事卡可直达奥斯曼帝国对应章节', ottomanBookId==='ottoman', ottomanBookId);

  /* P2 · 移动端顶栏响应式排版（393x852 / 320x568 / 430x932，含长标题义和团危机与八国联军及加大字号） */
  const boxerCheck = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});
    await sleep(160);
    return js(`(() => {
      const box = id => { const el = document.getElementById(id); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), text: el.textContent.trim() }; };
      const body = document.getElementById('book-body');
      const book = document.getElementById('book');
      return {
        vw: innerWidth,
        bookSW: book.scrollWidth, bookCW: book.clientWidth,
        bodySW: body.scrollWidth, bodyCW: body.clientWidth,
        bar: box('book-bar'), back: box('reading-back'), name: box('reading-book-name'),
        idx: box('reading-index'), lib: box('reading-library'), size: box('reading-settings'), exit: box('reading-exit'),
      };
    })()`);
  };
  await js(`(() => { __t.closeReader();
    const topic = __t.topics.find(t => t.id === 'china-late-qing');
    __t.beginReading(null, topic, 'boxers', null, { source: { kind: 'events', year: 1900, eventId: 'i-cn-boxer', action: 'topic', scroll: 0, disclosures: [] } });
    document.querySelector('[data-reading-size="extra"]')?.click(); })()`);
  await sleep(250);
  const bx393 = await boxerCheck(393, 852);
  const bx320 = await boxerCheck(320, 568);
  const bx430 = await boxerCheck(430, 932);
  const fitsNav = s => s.bookSW <= s.bookCW && s.bodySW <= s.bodyCW &&
    [s.bar, s.back, s.idx, s.lib, s.size, s.exit].filter(Boolean).every(b => b.l >= 0 && b.r <= s.vw) &&
    s.exit && s.exit.w >= 44 && s.exit.h >= 44 && s.exit.text === '返回史事';
  check('393px/320px/430px 阅读长标题专题与加大字号时顶栏及退出按钮完整不溢出',
    fitsNav(bx393) && fitsNav(bx320) && fitsNav(bx430), { bx393, bx320, bx430 });
  await js(`document.querySelector('[data-reading-size="medium"]')?.click();__t.closeReader();
    const ovClose = document.getElementById('overlay-close'); if (ovClose && !document.getElementById('overlay').hidden) ovClose.click();`);

  /* P2 · 1x 默认缩放探索标签可见性与 HUD 避让 */
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:3,mobile:true});
  await js(`__t.setLayer('polity');__t.setYear(1500);__t.state.zoom=1;__t.state.yaw=-1.65;__t.state.tilt=0.45;__t.state.focus=null;`);
  await sleep(250);
  const zoomOneLabels = await js(`(() => {
    const ctx = document.getElementById('vec').getContext('2d');
    const orig = ctx.fillText;
    const drawn = [];
    ctx.fillText = function(text, x, y) { drawn.push({ text, x: Math.round(x), y: Math.round(y) }); return orig.apply(this, arguments); };
    try { __t.drawVector([{ left: 0, top: 0, right: innerWidth, bottom: 130 }, { left: 0, top: innerHeight - 130, right: innerWidth, bottom: innerHeight }]); }
    finally { ctx.fillText = orig; }
    return drawn;
  })()`);
  check('默认 1x 缩放主动展示克制数量的历史政权标签且避让 HUD 区域',
    zoomOneLabels.length >= 2 && zoomOneLabels.length <= 5 &&
    zoomOneLabels.every(l => l.y > 130 && l.y < 744), zoomOneLabels);

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
  let offlineReady = false;
  for(let i=0;i<80;i++) {
    if(await js('location.protocol === "file:" && !!(window.__t && __t.partition.shapes.length && !document.getElementById("boot"))')) {
      offlineReady = true;
      break;
    }
    await sleep(200);
  }
  if (!offlineReady) throw new Error('断网单文件页面未完成启动');
  await js(`__t.setYear(__t.yearBounds.max);__t.openEntity('country',__t.partition.shapes.find(s=>s.iso==='CN').id);__t.openBook()`);
  check('离线单文件可打开中华人民共和国卷',await js(`__t.reading.subject.id==='prc' && document.querySelectorAll('.reading-row').length===4`));
  check('离线单文件图标已内嵌',await js(`document.querySelector('link[rel="icon"]').href.startsWith('data:image/png;base64,') && document.querySelector('link[rel="apple-touch-icon"]').href.startsWith('data:image/png;base64,')`));
  await js(`document.querySelector('#reading-library').click()`);
  const offlineBooks = await js(`(() => {
    let count=0;const bad=[];
    for(const book of __t.subjectBooks){
      document.querySelector('[data-subject-book="'+book.id+'"]').click();
      for(const chapter of book.chapters){
        const row=document.querySelector('.reading-row[data-reading-detail="'+chapter.id+'"]');
        if(!row){bad.push(book.id+'/'+chapter.id);break;}
        row.click(); count++;
        const prose=document.querySelectorAll('.subject-prose > p');
        if(prose.length!==chapter.paragraphs.length || !document.querySelector('.reading-sources a') ||
          (chapter.sceneRefs || []).some(ref=>Boolean(document.querySelector('[data-subject-scene="'+ref.id+'"]'))!==( __t.historicalScenes.get(ref.id).status==='available')))
          bad.push(book.id+'/'+chapter.id);
        document.getElementById('reading-back').click();
      }
      document.getElementById('reading-back').click();
    }
    return {count,bad,expected:__t.subjectBooks.reduce((total,book)=>total+book.chapters.length,0),books:__t.subjectBooks.length};
  })()`);
  check('全部书卷均可断网逐章阅读、显示来源与章节地图入口',offlineBooks.count===243 && offlineBooks.count===offlineBooks.expected &&
    offlineBooks.books===57 && !offlineBooks.bad.length,offlineBooks);
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
