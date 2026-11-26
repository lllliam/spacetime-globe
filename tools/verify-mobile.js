/* Touch regression in a real Chromium page. Optionally pass a published URL. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { buildHarness, findBrowser, startServer } = require('./harness');

async function until(check, label, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    const value = await check();
    if (value) return value;
    await wait(125);
  }
  throw new Error(label);
}

async function main() {
  const browser = findBrowser();
  assert(browser, 'Chromium / Edge is required');
  const targetUrl = process.argv[2];
  const local = targetUrl ? null : await startServer();
  if (local) buildHarness();
  const url = targetUrl || `http://127.0.0.1:${local.port}/_harness.html`;
  const profile = mkdtempSync(join(tmpdir(), 'globe-mobile-'));
  const proc = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', 'about:blank'], { windowsHide:true, stdio:'ignore' });
  let ws;
  try {
    const target = await until(async () => {
      try {
        const port = parseInt(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8'), 10);
        return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
      } catch { return null; }
    }, 'Browser did not start');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const js = async expression => {
      const reply = await send('Runtime.evaluate', { expression, returnByValue:true });
      if (reply.exceptionDetails) throw new Error(reply.result?.description || expression);
      return reply.result.value;
    };
    const size = (height, width = 402) => send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor:3, mobile:true, screenWidth:width, screenHeight:874,
    });
    const touch = (type, point) => send('Input.dispatchTouchEvent', { type, touchPoints:point ? [point] : [] });
    const center = selector => js(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x:r.x + r.width / 2, y:r.y + r.height / 2 };
    })()`);
    const tap = async target => {
      const point = typeof target === 'string' ? await center(target) : target;
      await touch('touchStart', point);
      await touch('touchEnd');
      await wait(250);
    };
    const swipe = async (target, dy, { pause = 0, cancel = false, dx = 0, during } = {}) => {
      const start = typeof target === 'string' ? await center(target) : target;
      await touch('touchStart', start);
      for (let i = 1; i <= 12; i++) {
        await touch('touchMove', { x:start.x + dx * i / 12, y:start.y + dy * i / 12 });
        await wait(30);
      }
      await during?.();
      await wait(pause);
      await touch(cancel ? 'touchCancel' : 'touchEnd');
      await wait(400);
    };
    const goToYear = async year => {
      await tap('#year');
      await js(`document.querySelector('#year-input').select()`);
      await send('Input.insertText', { text:String(year) });
      await tap('#year-form button[type="submit"]');
      assert.match(await js(`document.querySelector('#year-num').textContent`), new RegExp(String(year)));
    };
    await send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:2 });
    await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'reduce' }] });
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source:`Object.defineProperty(navigator, 'standalone', { value:true });` });
    await size(874);
    await send('Page.navigate', { url });
    await until(() => js(`document.querySelector('#globe') && !document.querySelector('#boot')`), 'Globe did not load');
    assert.equal(await js('navigator.maxTouchPoints'), 2);
    assert.equal(await js('navigator.standalone'), true);
    const timelineVisible = () => js(`!document.querySelector('#vernier').hidden`);
    const mapCamera = () => js(`window.__t && (({year,yaw,tilt,zoom,panX,panY}) =>
      ({year,yaw,tilt,zoom,panX,panY}))(window.__t.state)`);
    const location = (lon, lat, fallback) => js(`window.__t?.screenOf(${lon}*Math.PI/180,${lat}*Math.PI/180) || ${JSON.stringify(fallback)}`);
    assert.equal(await timelineVisible(), true);
    const ming = await location(114, 34, { x:252, y:415 });
    await touch('touchStart', ming);
    await wait(380);
    await touch('touchEnd');
    await until(() => js(`document.querySelector('#sheet.peek')`),
      'A stationary press released before the long-press menu must select the land');
    assert.match(await js(`document.querySelector('#sheet-identity-name').textContent`), /明朝/);
    await js(`window.zoomSamples = []; visualViewport.addEventListener('resize', () => zoomSamples.push(visualViewport.scale));`);
    const pair = (spread) => [{id:1,x:201-spread,y:400}, {id:2,x:201+spread,y:400}];
    await send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:pair(45) });
    for (let spread = 50; spread <= 105; spread += 5) {
      await send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:pair(spread) });
      await wait(15);
    }
    await touch('touchEnd');
    await wait(250);
    assert.ok(await js(`visualViewport.scale === 1 && zoomSamples.every(scale => scale === 1) &&
      document.querySelector('#sheet').classList.contains('peek')`), 'Pinching over the map scrim must leave the page and preview intact');
    await tap({ x:201, y:400 });
    await until(timelineVisible, 'A single tap on the map scrim must still dismiss the preview');
    const beforeClose = await mapCamera();
    await tap('#hud-view');
    await tap('#view-close');
    assert.equal(await js(`document.querySelector('#view-panel').hidden && document.activeElement.id === 'hud-view'`), true);
    assert.deepEqual(await mapCamera(), beforeClose, 'Closing the chooser must preserve the camera');
    await touch('touchStart', ming);
    await wait(650);
    await touch('touchEnd');
    assert.equal(await js(`document.querySelector('#view-panel').hidden`), false, 'Continuing to hold must still open the chooser');
    await tap('#view-close');
    console.log('Stationary touch, map-scrim pinch and dismiss, and chooser close focus passed.');
    await tap('#hud-view');
    assert.equal(await js(`document.querySelector('#view-panel').hidden`), false);
    assert.equal(await timelineVisible(), false);
    await tap('[data-view="modern"]');
    await tap({ x:30, y:300 });
    await until(() => js(`document.querySelector('#view-panel').hidden`), 'View chooser did not close');
    assert.equal(await timelineVisible(), true);
    await goToYear(await js('new Date().getFullYear()'));
    const kazakhstan = await location(68, 47, { x:145, y:373 });
    await tap(kazakhstan);
    await until(() => js(`document.body.classList.contains('sheet-open')`), 'Kazakhstan did not open');
    assert.equal(await js(`document.querySelector('#sheet-identity-name').textContent`), '哈萨克斯坦');
    assert.match(await js(`document.querySelector('#sheet [data-open-sheet-book]')?.textContent || ''`), /中亚丝路帝国/);
    assert.equal(await timelineVisible(), false);
    const timelineTop = () => js(`Math.round(document.querySelector('#vernier').getBoundingClientRect().top)`);
    const tuckedTimelineTop = await timelineTop();
    await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'no-preference' }] });
    await swipe('#grab', 90, { during:async () => assert.equal(await timelineVisible(), false) });
    await until(timelineVisible, 'Timeline did not return after the preview closed');
    assert.equal(await timelineTop(), tuckedTimelineTop, 'The timeline should return to the same position');
    await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'reduce' }] });
    await goToYear(1980);
    await tap(kazakhstan);
    await until(() => js(`document.body.classList.contains('sheet-open')`), 'Map tap did not open an archive');
    assert.equal(await timelineVisible(), false);
    assert.equal(await js(`document.querySelector('#vernier').inert`), true);
    assert.match(await js(`document.querySelector('.map-sheet-summary a').textContent`), /Cliopatria|Natural Earth/);
    console.log('Map tap:', await js(`document.querySelector('#sheet-identity-name').textContent`));
    await tap('#sheet-toc');
    assert.match(await js(`document.querySelector('#book-body').innerText`), /尚未收录/);
    const report = () => js(`({ reader:!document.querySelector('#book').hidden,
      sheet:Math.round(document.querySelector('#sheet').getBoundingClientRect().top),
      book:Math.round(document.querySelector('#book').getBoundingClientRect().bottom),
      top:Math.round(document.querySelector('#book').getBoundingClientRect().top),
      viewport:Math.round(visualViewport.height), toc:document.querySelector('#sheet-toc').textContent,
      theme:document.querySelector('meta[name="theme-color"]').content })`);
    const fillsViewport = async () => {
      const info = await report();
      assert.equal(info.top, 0, JSON.stringify(info));
      assert.equal(info.book, info.viewport, JSON.stringify(info));
      assert.equal(await js(`document.querySelector('#globe').inert && getComputedStyle(document.querySelector('#globe')).visibility==='hidden'`), true);
      return info;
    };
    const assertPreview = async () => {
      assert.equal((await report()).reader, false, 'Closing reading must restore the exploration preview');
      assert.equal(await js(`document.querySelector('#sheet').classList.contains('peek')`), true);
      assert.equal(await timelineVisible(), false, 'Returning to the preview should keep the timeline hidden');
    };
    const archiveTitle = await js(`document.querySelector('#reading-title').textContent`);
    assert.equal((await fillsViewport()).theme, '#0a1016');
    assert.equal((await fillsViewport()).reader, true, 'Map-only archives also use fullscreen reading');
    await size(812);
    await until(() => js(`document.querySelector('#book').getBoundingClientRect().bottom === 812`), 'Open archive did not resize');
    await fillsViewport();
    await size(568, 320);
    await until(() => js(`document.querySelector('#book').getBoundingClientRect().bottom === 568`), 'Archive did not fit compact screen');
    await fillsViewport();
    await size(874);
    await until(() => js(`document.querySelector('#book').getBoundingClientRect().bottom === 874`), 'Archive did not recover after resize');
    await tap('#reading-library');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), '历史书目');
    await tap('#reading-back');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), archiveTitle);
    await swipe('#book-body', 170, { cancel:true });
    await fillsViewport();
    await swipe('#book-bar', 170, { pause:150 });
    await fillsViewport();
    await swipe({ x:194, y:520 }, 175, { pause:150 });
    await fillsViewport();
    await tap('#reading-exit');
    await assertPreview();
    assert.equal((await report()).theme, '#0a1016');
    console.log('Map-only archive: fullscreen, viewport resize, catalog/back, gesture isolation and explicit close.');

    await tap('#sheet-toc');
    await tap('#reading-library');
    assert.equal(await js(`document.querySelectorAll('#book-body [data-subject-book]').length`), 57);
    await js(`document.querySelector('[data-subject-book="ming"]').scrollIntoView({block:'center'})`);
    await tap('[data-subject-book="ming"]');
    await js(`document.querySelector('[data-reading-detail=founding]').scrollIntoView({block:'center'})`);
    await tap('[data-reading-detail=founding]');
    const scene = '#book-body [data-subject-scene]';
    await js(`document.querySelector('${scene}').scrollIntoView({block:'center'})`);
    const sceneType = await js(`document.querySelector('${scene}').dataset.subjectScene`);
    const chapterTitle = await js(`document.querySelector('#reading-title').textContent`);
    const readingPosition = await js(`document.querySelector('#book-body').scrollTop`);
    const beforeScene = await mapCamera();
    await tap(scene);
    assert.equal(await js(`document.querySelector('#event-map-panel').hidden`), false);
    await tap('#event-map-return');
    await until(() => js(`document.querySelector('#book-body [data-subject-scene="${sceneType}"]')`), 'Scene did not return to its chapter');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), chapterTitle);
    assert.equal(await js(`document.querySelector('#book-body').scrollTop`), readingPosition);
    assert.deepEqual(await mapCamera(), beforeScene, 'Return from observation must restore camera and year');
    await tap('#reading-exit');
    await assertPreview();
    console.log('Historical scene: open from chapter and return to the same reading position');

    await swipe('#grab', 90);
    await until(() => js(`!document.body.classList.contains('sheet-open')`), 'Preview did not dismiss');
    assert.equal(await timelineVisible(), true);
    await tap('#vernier-events');
    assert.equal(await js(`document.querySelector('#overlay').hidden`), false);
    assert.equal(await timelineVisible(), false);
    await tap('#overlay-close');
    assert.equal(await js(`document.querySelector('#overlay').hidden`), true);
    assert.equal(await timelineVisible(), true);
    console.log('Map and timeline: view switching, preview dismissal, year events and return');

    await size(812);
    await js(`document.documentElement.style.setProperty('--safe-t','62px');
      document.documentElement.style.setProperty('--safe-b','34px');
      dispatchEvent(new Event('resize'));`);
    await until(() => js(`document.documentElement.style.getPropertyValue('--usable-safe-b') === '0px'`),
      'The short standalone viewport already excludes its bottom inset');
    await js(`Object.defineProperty(visualViewport, 'height', { value:760, configurable:true });
      dispatchEvent(new Event('resize'));`);
    await until(() => js(`document.querySelector('#globe').getBoundingClientRect().bottom === 760`),
      'Globe must follow the smaller visual viewport');
    assert.equal(await js(`Math.round(document.querySelector('#vernier').getBoundingClientRect().bottom)`), 712);
    await js(`delete visualViewport.height; dispatchEvent(new Event('resize'));`);
    await until(() => js(`document.querySelector('#globe').getBoundingClientRect().bottom === 812`),
      'Globe must recover its viewport');
    await tap(await location(114, 34, { x:251, y:382 }));
    await until(() => js(`document.body.classList.contains('sheet-open')`), 'China did not open');
    assert.equal(await js(`getComputedStyle(document.querySelector('#sheet')).overflow`), 'hidden');
    assert.equal(await js(`(() => {
      const sheet = document.querySelector('#sheet');
      const {left,top} = sheet.getBoundingClientRect();
      return sheet.contains(document.elementFromPoint(left + 2, top + 2));
    })()`), false, 'The square header must not cover the rounded corner');
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundColor`), 'rgb(10, 16, 22)');
    const peek = (await report()).sheet;
    const mapBeforeReading = await mapCamera();
    await swipe('#grab', -20, { pause:150 });
    assert.equal((await report()).sheet, peek);
    await swipe('.subject-sheet-summary', -110, { cancel:true });
    assert.equal((await report()).sheet, peek);
    const grip = await center('#grab');
    await touch('touchStart', grip);
    await touch('touchMove', {x:grip.x, y:grip.y-78});
    await wait(55);
    const pulled = (await report()).sheet;
    await touch('touchMove', {x:grip.x, y:grip.y-24});
    await wait(150);
    const reversed = (await report()).sheet;
    await touch('touchEnd');
    await wait(130);
    assert(Math.abs(pulled - (peek - 78)) < 3 && Math.abs(reversed - (peek - 24)) < 3,
      'A slow reversal must track the finger in both directions');
    assert.equal((await report()).sheet, peek, 'Release after reversing must settle at the preview');
    await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'no-preference' }] });
    const t0 = Date.now() / 1000;
    await send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[grip], timestamp:t0});
    for (let i = 1; i <= 3; i++) {
      await send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:grip.x,y:grip.y-i*11}], timestamp:t0+i*.014});
    }
    await send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[], timestamp:t0+.05});
    await until(async () => (await report()).reader, 'A short, fast flick must open reading');
    await fillsViewport();
    await wait(400);
    await tap('#reading-exit');
    await until(async () => !(await report()).reader, 'Reader did not close to the preview');
    await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'reduce' }] });
    for (const [target, distance] of [['.subject-sheet-summary',-110],['#sheet-identity-name',-110],['#grab',-485]]) {
      await swipe(target, distance, { pause:150 });
      await fillsViewport();
      await tap('#reading-exit');
      await assertPreview();
    }
    await tap('#sheet-toc');
    await fillsViewport();
    assert.deepEqual(await mapCamera(), mapBeforeReading, 'Opening the chapter list must preserve the map camera');
    assert.equal(await js(`getComputedStyle(document.querySelector('#book-bar')).paddingTop`), '62px');
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundColor`), 'rgb(10, 16, 22)');
    assert.equal(await js(`getComputedStyle(document.querySelector('#book'), '::before').height`), '62px');
    assert.equal(await js(`getComputedStyle(document.querySelector('#book'), '::before').backgroundColor`), 'rgb(10, 16, 22)');
    assert.equal(await js(`getComputedStyle(document.querySelector('#book'), '::before').backgroundImage`), 'none');
    await swipe('#book-bar', 175, { pause:150 });
    await fillsViewport();
    await tap('.reading-row[data-reading-detail]');
    assert.deepEqual(await mapCamera(), mapBeforeReading, 'Opening a chapter must preserve the map camera');
    await swipe({ x:201, y:547 }, -175);
    const scroll = await js(`document.querySelector('#book-body').scrollTop`);
    assert(scroll > 0, 'Long chapter must scroll normally');
    await swipe({ x:201, y:370 }, 65);
    await fillsViewport();
    const assertChapterEnd = async padding => {
      const end = await js(`(() => {
        const body = document.querySelector('#book-body');
        const sources = body.querySelector('.reading-sources');
        sources.open = true;
        const lastSource = sources.querySelector('li:last-child a');
        body.scrollTop = body.scrollHeight;
        return {padding:getComputedStyle(body).paddingBottom, last:Math.round(lastSource.getBoundingClientRect().bottom),
          edge:Math.round(body.getBoundingClientRect().bottom), max:body.scrollHeight-body.clientHeight, scroll:body.scrollTop};
      })()`);
      assert.equal(end.padding, padding + 'px');
      assert.ok(end.edge - end.last >= padding && Math.abs(end.max-end.scroll)<2,
        'The last source must scroll fully above the safe area');
    };
    await assertChapterEnd(44);
    await size(874);
    await until(() => js(`document.documentElement.style.getPropertyValue('--usable-safe-b') === '34px'`),
      'A full-height viewport still needs the system inset');
    await assertChapterEnd(78);
    await size(812);
    await until(() => js(`document.documentElement.style.getPropertyValue('--usable-safe-b') === '0px'`),
      'Reader must recover the short viewport layout');
    const lastChapter = await js('__t.reading.detail');
    await tap('#reading-index');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), '中华人民共和国');
    await swipe('#book-bar', 175, { pause:150 });
    await fillsViewport();
    await tap('#reading-back');
    assert.equal(await js('__t.reading.detail'),lastChapter);
    await assertChapterEnd(44);
    await tap('#reading-exit');
    await assertPreview();
    console.log('Full book: auxiliary summary entry gestures, stable fullscreen, ordinary scrolling, safe-area and directory return.');

    await swipe('#grab', 90);
    await until(() => js(`!document.body.classList.contains('sheet-open')`), 'Preview did not dismiss');
    await goToYear(1453);
    await tap('#vernier-events');
    const yearLink = '[data-world-read="i-tr-constantinople-1453"]';
    await js(`document.querySelector('${yearLink}').scrollIntoView({block:'center'})`);
    await tap(yearLink);
    assert.equal(await js('__t.reading.detail'), 'crusades-commercial-bleed-1453');
    assert.match(await js(`document.querySelector('#reading-title').textContent`), /1453 年/);
    console.log('Updated library: 57 volumes, Central Asia map entry, and 1453 event links to the rewritten Roman chapter');

    await tap('#reading-exit');
    await tap('#overlay-close');
    const timeline = () => js(`({selected:Number(document.querySelector('#year-num').textContent),
      preview:Number(document.querySelector('#vernier-track').getAttribute('aria-valuenow')),
      top:Math.round(document.querySelector('#vernier-track').getBoundingClientRect().top),
      offset:document.querySelector('#vernier-ticks').style.transform})`);
    const start = await timeline();
    await js(`window.testVernierTick = document.querySelector('#vernier-ticks span')`);
    await swipe('#vernier-track', 0, { dx:-7, during:async () => {
      const dragging = await timeline();
      assert.notEqual(dragging.offset, start.offset, 'A sub-year pull must move the tick marks');
      assert.equal(dragging.preview, start.selected);
    } });
    await swipe('#vernier-track', 0, { dx:-36, during:async () => {
      const dragging = await timeline();
      assert.equal(dragging.preview, 1455);
      assert.equal(dragging.selected, 1453, 'Follow the finger without changing the globe mid-drag');
      assert.match(await js("document.querySelector('#vernier-era').textContent"), /预览.*地图 1453/);
      assert.equal(dragging.top, start.top);
    } });
    assert.equal((await timeline()).selected, 1455);
    assert.equal((await timeline()).top, start.top, 'The events button must not move the timeline');
    assert.equal(await js(`window.testVernierTick === document.querySelector('#vernier-ticks span')`), true);
    await swipe('#vernier-track', 0, { dx:-64, cancel:true });
    assert.equal((await timeline()).selected, 1455);
    await js(`document.querySelector('#vernier-track').focus()`);
    await send('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
    await send('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
    assert.equal((await timeline()).selected, 1456, 'The timeline arrow key should advance exactly one year');

    await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'no-preference' }] });
    const flick = async (dx, interval, releaseDelay = .01) => {
      const { selected } = await timeline();
      const point = await center('#vernier-track');
      const time = Date.now() / 1000;
      await send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[point], timestamp:time});
      for (let i = 1; i <= 3; i++) {
        const sample = {x:point.x + dx * i / 3,y:point.y};
        await send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[sample], timestamp:time + interval*i});
      }
      await send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[], timestamp:time + 3*interval + releaseDelay});
      return await until(async () => {
        const settled = await timeline();
        return settled.selected !== selected && settled.selected === settled.preview && settled.selected - selected;
      }, 'The timeline and globe should settle on the same year');
    };
    const medium = await flick(-60, .025);
    const fast = -await flick(60, .012);
    const paused = await flick(-60, .012, .14);
    assert(medium > paused && medium < 40, 'A moderate flick should coast a short distance');
    assert(fast >= 75 && fast <= 124 && fast > medium, 'A faster flick travels farther but remains bounded');
    assert.equal(paused, 4, 'Pausing before release should keep only the years dragged');
    console.log('Timeline distance for a 60px gesture:', {medium, fast, paused});
    await swipe('#vernier-track', -65);
    assert.equal(await js(`document.querySelector('#overlay').hidden`), true);
    await tap('#vernier-events');
    assert.equal(await js(`document.querySelector('#overlay').hidden`), false);
    console.log('Timeline: fractional tracking, fixed height, snap, cancel, single-year keys, bounded momentum and explicit events');

    await tap('#overlay-close');
    await until(() => js(`document.querySelector('#overlay').hidden`), 'Overlay did not close');

    // Four-state top & bottom safe-area regression in split standalone viewport (html=874px, visualViewport=812px)
    await size(874);
    await js(`
      document.documentElement.style.setProperty('--safe-t', '62px');
      document.documentElement.style.setProperty('--safe-b', '34px');
      Object.defineProperty(visualViewport, 'height', { value: 812, configurable: true });
      dispatchEvent(new Event('resize'));
    `);
    await until(() => js(`document.documentElement.style.getPropertyValue('--app-height') === '812px' &&
      document.documentElement.clientHeight === 874 &&
      document.documentElement.style.getPropertyValue('--usable-safe-b') === '34px'`),
      'Standalone split viewport did not apply --app-height: 812px');

    const safeSurface = () => js(`(() => {
      const root = document.documentElement;
      const rootStyle = getComputedStyle(root);
      const afterStyle = getComputedStyle(root, '::after');
      const book = document.querySelector('#book');
      const bookBefore = getComputedStyle(book, '::before');
      const panel = document.querySelector('#event-map-panel');
      const sheet = document.querySelector('#sheet');
      return {
        mode: __t.session.mode,
        rootBg: rootStyle.backgroundColor,
        themeColor: document.querySelector('meta[name="theme-color"]').content,
        appHeight: root.style.getPropertyValue('--app-height'),
        usableSafeB: root.style.getPropertyValue('--usable-safe-b'),
        htmlH: Math.round(root.getBoundingClientRect().height),
        bodyBottom: Math.round(document.body.getBoundingClientRect().bottom),
        bottomPaper: root.classList.contains('bottom-paper'),
        bottomObserve: root.classList.contains('bottom-observe-panel'),
        afterTop: Math.round(parseFloat(afterStyle.top)),
        afterHeight: Math.round(parseFloat(afterStyle.height)),
        afterWidth: Math.round(parseFloat(afterStyle.width)),
        afterBg: afterStyle.backgroundColor,
        bookBeforeHeight: bookBefore.height,
        bookBeforeBg: bookBefore.backgroundColor,
        bookBeforeImg: bookBefore.backgroundImage,
        bookBottom: book.hidden ? null : Math.round(book.getBoundingClientRect().bottom),
        sheetOpen: document.body.classList.contains('sheet-open'),
        sheetTop: Math.round(sheet.getBoundingClientRect().top),
        panelVisible: !panel.hidden,
        panelBottom: panel.hidden ? null : Math.round(panel.getBoundingClientRect().bottom),
        panelWidth: panel.hidden ? null : Math.round(panel.getBoundingClientRect().width),
        hudTop: Math.round(document.querySelector('#hud').getBoundingClientRect().top),
        vernierBottom: Math.round(document.querySelector('#vernier').getBoundingClientRect().bottom),
        observeTopPad: getComputedStyle(document.querySelector('#event-map-top')).paddingTop,
      };
    })()`);

    // 1. Explore: top cosmos + bottom cosmos (no light fill)
    const exp = await safeSurface();
    assert.equal(exp.rootBg, 'rgb(10, 16, 22)');
    assert.equal(exp.themeColor, '#0a1016');
    assert.equal(exp.htmlH, 874);
    assert.equal(exp.bodyBottom, 812);
    assert.equal(exp.usableSafeB, '34px');
    assert.equal(exp.bottomPaper, false);
    assert.equal(exp.bottomObserve, false);
    assert.equal(exp.afterBg, 'rgba(0, 0, 0, 0)');
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundImage`), 'none');
    assert.ok(exp.hudTop >= 62 && exp.vernierBottom <= 812);

    // 2. Sheet: top stays cosmos + bottom fills 812..874 with rice-paper (#f6f2e9)
    await tap(await location(114, 34, { x: 251, y: 382 }));
    await until(() => js(`document.body.classList.contains('sheet-open')`), 'Sheet did not open for China');
    const sh = await safeSurface();
    assert.equal(sh.rootBg, 'rgb(10, 16, 22)');
    assert.equal(sh.themeColor, '#0a1016');
    assert.equal(sh.bottomPaper, true);
    assert.equal(sh.bottomObserve, false);
    assert.equal(sh.afterTop, 812);
    assert.equal(sh.afterHeight, 62);
    assert.equal(sh.afterBg, 'rgb(246, 242, 233)');
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundSize`), '100% 200%');
    assert.ok(sh.sheetTop >= 500, 'Peek sheet must leave top cosmos undisturbed');

    // Also verify short standalone viewport (html=812, screenHeight=874, usable-safe-b=0px):
    // top remains #0a1016 while html background-image supplies 50%..100% (#f6f2e9 below 812px).
    await js(`delete visualViewport.height`);
    await size(812);
    await until(() => js(`document.documentElement.style.getPropertyValue('--usable-safe-b') === '0px'`),
      'Short standalone sheet viewport must reserve 0px bottom inset');
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundColor`), 'rgb(10, 16, 22)');
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundSize`), '100% 200%');
    assert.equal(await js(`document.querySelector('meta[name="theme-color"]').content`), '#0a1016');
    await size(874);
    await js(`Object.defineProperty(visualViewport, 'height', { value: 812, configurable: true });
      dispatchEvent(new Event('resize'));`);
    await until(() => js(`document.documentElement.style.getPropertyValue('--app-height') === '812px' &&
      document.documentElement.style.getPropertyValue('--usable-safe-b') === '34px'`),
      'Split standalone viewport did not restore --app-height: 812px and --usable-safe-b: 34px');

    // 3. Read: top solid #0a1016 safe-t + bottom fills 812..874 with rice-paper (#f6f2e9)
    await tap('#sheet-toc');
    await fillsViewport();
    const rd = await safeSurface();
    assert.equal(rd.rootBg, 'rgb(10, 16, 22)');
    assert.equal(rd.themeColor, '#0a1016');
    assert.equal(rd.bookBeforeHeight, '62px');
    assert.equal(rd.bookBeforeBg, 'rgb(10, 16, 22)');
    assert.equal(rd.bookBeforeImg, 'none');
    assert.equal(rd.bookBottom, 812);
    assert.equal(rd.bottomPaper, true);
    assert.equal(rd.bottomObserve, false);
    assert.equal(rd.afterTop, 812);
    assert.equal(rd.afterHeight, 62);
    assert.equal(rd.afterBg, 'rgb(246, 242, 233)');

    // Return to Explore cleanly (verify zero residual classes/colors)
    await tap('#reading-exit');
    await assertPreview();
    await swipe('#grab', 90);
    await until(() => js(`!document.body.classList.contains('sheet-open')`), 'Sheet did not dismiss');
    const backExp = await safeSurface();
    assert.equal(backExp.bottomPaper, false);
    assert.equal(backExp.afterBg, 'rgba(0, 0, 0, 0)');

    // 4. Observe: top cosmos + bottom matches #event-map-panel (#f6f2e9) seamlessly down to 874px
    await goToYear(1453);
    await tap('#vernier-events');
    await until(() => js(`!document.querySelector('#overlay').hidden`), 'Year overlay did not open');
    const ov = await safeSurface();
    assert.equal(ov.rootBg, 'rgb(10, 16, 22)');
    assert.equal(ov.bottomPaper, true);
    assert.equal(ov.afterBg, 'rgb(246, 242, 233)');
    await tap('[data-event]');
    await until(() => js(`__t.session.mode === 'Observe' && !document.querySelector('#event-map-panel').hidden`),
      'Observe panel did not open');
    const obs = await safeSurface();
    assert.equal(obs.rootBg, 'rgb(10, 16, 22)');
    assert.equal(obs.themeColor, '#0a1016');
    assert.equal(obs.bottomPaper, false);
    assert.equal(obs.bottomObserve, true);
    assert.equal(obs.panelVisible, true);
    assert.equal(obs.panelBottom, 812);
    assert.equal(obs.afterTop, 812);
    assert.equal(obs.afterHeight, 62);
    assert.equal(obs.afterWidth, obs.panelWidth);
    assert.equal(obs.afterBg, 'rgb(246, 242, 233)');
    assert.ok(parseFloat(obs.observeTopPad) >= 62);

    await tap('#event-map-return');
    await until(() => js(`__t.session.mode === 'Explore'`), 'Did not return from Observe');
    await tap('#overlay-close');
    await until(() => js(`document.querySelector('#overlay').hidden`), 'Overlay did not close after Observe');
    const finalExp = await safeSurface();
    assert.equal(finalExp.bottomPaper, false);
    assert.equal(finalExp.bottomObserve, false);
    assert.equal(finalExp.afterBg, 'rgba(0, 0, 0, 0)');

    await js(`delete visualViewport.height; dispatchEvent(new Event('resize'));`);
    console.log('Four-state top & bottom safe-area surfaces: Explore, Sheet, Read, Observe verified');

    // Long-title reading navbar responsiveness (393x852 and 320x568 with extra font size)
    for (const [w, h] of [[393, 852], [320, 568]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
      await js(`(() => { const topic = __t.topics.find(t => t.id === 'china-late-qing');
        __t.beginReading(null, topic, 'boxers', null, { source: { kind: 'events', year: 1900, eventId: 'i-cn-boxer', action: 'topic', scroll: 0, disclosures: [] } });
        document.querySelector('[data-reading-size="extra"]')?.click(); })()`);
      await until(() => js(`!document.querySelector('#book').hidden && document.querySelector('#reading-exit')?.textContent.trim() === '返回史事'`),
        `Boxer topic did not open cleanly at ${w}x${h}`);
      const m = await js(`(() => {
        const box = id => { const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
        const book = document.getElementById('book'), body = document.getElementById('book-body');
        return {
          vw: innerWidth,
          bookSW: book.scrollWidth, bookCW: book.clientWidth,
          bodySW: body.scrollWidth, bodyCW: body.clientWidth,
          bar: box('book-bar'), back: box('reading-back'), exit: box('reading-exit'),
          idx: box('reading-index'), lib: box('reading-library'), settings: box('reading-settings'),
        };
      })()`);
      assert.ok(m.bookSW <= m.bookCW && m.bodySW <= m.bodyCW, `Horizontal overflow at ${w}x${h}: ${JSON.stringify(m)}`);
      assert.ok([m.bar, m.back, m.idx, m.lib, m.settings, m.exit].every(b => b.left >= 0 && b.right <= m.vw),
        `Navbar button clipped at ${w}x${h}: ${JSON.stringify(m)}`);
      assert.ok(m.exit.width >= 44 && m.exit.height >= 44, `Exit target too small at ${w}x${h}: ${JSON.stringify(m.exit)}`);
      await js(`document.querySelector('[data-reading-size="medium"]')?.click();__t.closeReader();`);
    }
    console.log('Long-title mobile reading navbar (393x852, 320x568) verified without clipping or overflow');

    if (!await js(`document.querySelector('#overlay').hidden`)) await tap('#overlay-close');
    await size(402, 874);
    await tap('#year');
    await js(`document.documentElement.style.setProperty('--safe-t', '0px');
      document.documentElement.style.setProperty('--safe-b', '21px');
      Object.defineProperty(visualViewport, 'height', { value:155, configurable:true });
      dispatchEvent(new Event('resize'));`);
    await until(() => js(`document.documentElement.style.getPropertyValue('--app-height') === '155px'`), 'Short keyboard viewport did not apply');
    await send('Input.insertText', { text:'0' });
    await tap('#year-form button[type="submit"]');
    assert.ok(await js(`(() => {
      const error = document.querySelector('#year-error');
      const form = document.querySelector('#year-form').getBoundingClientRect();
      const box = error.getBoundingClientRect();
      return /没有公元 0 年/.test(error.textContent) && box.top >= form.top &&
        box.bottom <= form.bottom + 1 && box.bottom <= visualViewport.height;
    })()`), 'Invalid-year feedback must be visible above the simulated keyboard');
    console.log('Invalid-year feedback fits a short landscape keyboard viewport.');
  } finally {
    ws?.close();
    proc.kill();
    local?.server.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
