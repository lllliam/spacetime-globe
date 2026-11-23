/* Touch regression in a real Chromium page. Optionally pass a published URL. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { findBrowser, startServer } = require('./harness');

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
  const url = targetUrl || `http://127.0.0.1:${local.port}/`;
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
    await tap('#hud-view');
    assert.equal(await js(`document.querySelector('#view-panel').hidden`), false);
    await tap('[data-view="modern"]');
    await tap({ x:30, y:300 });
    await until(() => js(`document.querySelector('#view-panel').hidden`), 'View chooser did not close');
    await tap({ x:175, y:353 });
    await until(() => js(`document.body.classList.contains('sheet-open')`), 'Kazakhstan did not open');
    assert.match(await js(`document.querySelector('#sheet-identity-name').textContent`), /中亚丝路/);
    await swipe('#grab', 90);
    await until(() => js(`!document.body.classList.contains('sheet-open')`), 'Central Asia preview did not dismiss');
    await goToYear(1980);
    await tap({ x:175, y:353 });
    await until(() => js(`document.body.classList.contains('sheet-open')`), 'Map tap did not open an archive');
    console.log('Map tap:', await js(`document.querySelector('#sheet-identity-name').textContent`));
    await tap('#sheet-toc');
    assert.match(await js(`document.querySelector('#book-body').innerText`), /尚未收录/);
    const report = () => js(`({ reader:!document.querySelector('#book').hidden,
      sheet:Math.round(document.querySelector('#sheet').getBoundingClientRect().top),
      book:Math.round(document.querySelector('#book').getBoundingClientRect().bottom),
      viewport:Math.round(visualViewport.height), toc:document.querySelector('#sheet-toc').textContent,
      theme:document.querySelector('meta[name="theme-color"]').content })`);
    const fillsViewport = async () => {
      const info = await report();
      assert.equal(info.book, info.viewport, JSON.stringify(info));
      return info;
    };
    const assertPreview = async () => {
      assert.equal((await report()).reader, false, 'A deliberate downward pull must close a map-only archive');
      assert.equal(await js(`document.querySelector('#sheet').classList.contains('peek')`), true);
    };
    const archiveTitle = await js(`document.querySelector('#reading-title').textContent`);
    assert.equal((await fillsViewport()).theme, '#f6f2e9');
    await size(812);
    await until(() => js(`document.querySelector('#book').getBoundingClientRect().bottom === 812`), 'Open archive did not resize');
    await fillsViewport();
    await size(568, 320);
    await until(() => js(`document.querySelector('#book').getBoundingClientRect().bottom === 568`), 'Archive did not fit compact screen');
    await fillsViewport();
    await size(874);
    await until(() => js(`document.querySelector('#book').getBoundingClientRect().bottom === 874`), 'Archive did not recover after resize');
    await tap('#sheet-toc');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), '历史书目');
    await tap('#reading-back');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), archiveTitle);
    await swipe('#grab', 170, { cancel:true });
    assert.equal((await report()).reader, true);
    await swipe('#grab', 170, { pause:150 });
    await assertPreview();
    await tap('#sheet-toc');
    await swipe({ x:194, y:520 }, 175, { pause:150 });
    await assertPreview();
    await tap('#sheet-toc');
    await tap('#sheet-close');
    await assertPreview();
    assert.equal((await report()).theme, '#f6f2e9');
    console.log('Map-only archive: viewport resize, catalog/back, canceled pull, grip and body pulls, close button');

    await tap('#sheet-toc');
    await tap('#sheet-toc');
    assert.equal(await js(`document.querySelectorAll('#book-body [data-subject-book]').length`), 57);
    await js(`document.querySelector('[data-subject-book="ming"]').scrollIntoView({block:'center'})`);
    await tap('[data-subject-book="ming"]');
    await tap('#book-body [data-reading-detail]');
    const scene = '#book-body [data-subject-scene]';
    await js(`document.querySelector('${scene}').scrollIntoView({block:'center'})`);
    const sceneType = await js(`document.querySelector('${scene}').dataset.subjectScene`);
    const chapterTitle = await js(`document.querySelector('#reading-title').textContent`);
    const readingPosition = await js(`document.querySelector('#book-body').scrollTop`);
    await tap(scene);
    assert.equal(await js(`document.querySelector('#event-map-panel').hidden`), false);
    await tap('#event-map-return');
    await until(() => js(`document.querySelector('#book-body [data-subject-scene="${sceneType}"]')`), 'Scene did not return to its chapter');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), chapterTitle);
    assert.equal(await js(`document.querySelector('#book-body').scrollTop`), readingPosition);
    await tap('#sheet-close');
    await assertPreview();
    console.log('Historical scene: open from chapter and return to the same reading position');

    await swipe('#grab', 90);
    await until(() => js(`!document.body.classList.contains('sheet-open')`), 'Preview did not dismiss');
    await tap('#vernier-events');
    assert.equal(await js(`document.querySelector('#overlay').hidden`), false);
    await tap('#overlay-close');
    assert.equal(await js(`document.querySelector('#overlay').hidden`), true);
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
    await tap({ x:281, y:340 });
    await until(() => js(`document.body.classList.contains('sheet-open')`), 'China did not open');
    assert.equal(await js(`getComputedStyle(document.querySelector('#sheet')).overflow`), 'hidden');
    assert.equal(await js(`(() => {
      const sheet = document.querySelector('#sheet');
      const {left,top} = sheet.getBoundingClientRect();
      return sheet.contains(document.elementFromPoint(left + 2, top + 2));
    })()`), false, 'The square header must not cover the rounded corner');
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundColor`), 'rgb(246, 242, 233)');
    const peek = (await report()).sheet;
    await swipe('#grab', -20, { pause:150 });
    assert.equal((await report()).sheet, peek);
    await swipe('.subject-sheet-summary', -110, { cancel:true });
    assert.equal((await report()).sheet, peek);
    await swipe('.subject-sheet-summary', -110, { pause:150 });
    assert.equal(await js(`document.body.classList.contains('reading-split')`), true);
    await tap('#sheet-close');
    await swipe('#sheet-identity-name', -110, { pause:150 });
    assert.equal(await js(`document.body.classList.contains('reading-split')`), true);
    await tap('#sheet-close');
    await swipe('#grab', -485, { pause:150 });
    assert.equal((await fillsViewport()).sheet, 0, 'A long pull from the preview should open full reading');
    assert.equal(await js(`getComputedStyle(document.querySelector('#sheet-top')).paddingTop`), '65px');
    await tap('#sheet-close');
    await tap('#sheet-toc');
    assert.equal(await js(`document.body.classList.contains('reading-split')`), true);
    assert.equal(await js(`getComputedStyle(document.querySelector('#sheet-top')).paddingTop`), '3px');
    assert.equal(await js(`getComputedStyle(document.querySelector('#book-bar')).display`), 'none');
    assert.equal(await js(`getComputedStyle(document.documentElement).backgroundColor`), 'rgb(246, 242, 233)');
    await fillsViewport();
    await swipe('#grab', -175);
    assert.equal((await fillsViewport()).sheet, 0);
    await tap('#book-body [data-reading-detail]');
    await swipe({ x:201, y:547 }, -175);
    const scroll = await js(`document.querySelector('#book-body').scrollTop`);
    assert(scroll > 0, 'Long chapter must scroll normally');
    await swipe({ x:201, y:370 }, 65);
    assert.equal((await fillsViewport()).sheet, 0);
    const assertChapterEnd = async padding => {
      const end = await js(`(() => {
        const body = document.querySelector('#book-body');
        const lastSource = body.querySelector('.reading-sources a:last-child');
        body.scrollTop = body.scrollHeight;
        return {padding:getComputedStyle(body).paddingBottom, last:Math.round(lastSource.getBoundingClientRect().bottom),
          edge:Math.round(body.getBoundingClientRect().bottom)};
      })()`);
      assert.equal(end.padding, padding + 'px');
      assert.equal(end.edge - end.last, padding, 'The last source must scroll fully above the viewport edge');
    };
    await assertChapterEnd(16);
    await size(874);
    await until(() => js(`document.documentElement.style.getPropertyValue('--usable-safe-b') === '34px'`),
      'A full-height viewport still needs the system inset');
    await assertChapterEnd(50);
    await size(812);
    await until(() => js(`document.documentElement.style.getPropertyValue('--usable-safe-b') === '0px'`),
      'Reader must recover the short viewport layout');
    await tap('#sheet-toc');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), '中华人民共和国');
    const globeBackdrop = await js(`getComputedStyle(document.body).backgroundImage`);
    assert.match(globeBackdrop, /radial-gradient/);
    await swipe('#grab', 175, { pause:150, during:async () => {
      assert((await report()).sheet >= 150, 'The test must inspect the sheet while the globe is exposed');
      assert.equal(await js(`getComputedStyle(document.body).backgroundImage`), globeBackdrop);
      assert.equal(await js(`document.documentElement.classList.contains('reader-paper')`), false);
      assert.equal(await js(`getComputedStyle(document.querySelector('#sheet-top')).paddingTop`), '3px');
    } });
    assert.equal(await js(`document.body.classList.contains('reading-split')`), true);
    await fillsViewport();
    await tap('#book-body [data-reading-detail]');
    await assertChapterEnd(16);
    await tap('#sheet-close');
    await assertPreview();
    console.log('Full book: half/full transitions, chapter scrolling, table of contents and exit');

    await swipe('#grab', 90);
    await until(() => js(`!document.body.classList.contains('sheet-open')`), 'Preview did not dismiss');
    await goToYear(1453);
    await tap('#vernier-events');
    const yearLink = '[data-world-read="i-tr-constantinople-1453"]';
    await js(`document.querySelector('${yearLink}').scrollIntoView({block:'center'})`);
    await tap(yearLink);
    assert.match(await js(`document.querySelector('#reading-title').textContent`), /最后一道城墙/);
    console.log('Updated library: 57 volumes, Central Asia map entry, and 1453 event links to the rewritten Roman chapter');

    await tap('#sheet-close');
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
    const point = await center('#vernier-track');
    const time = Date.now() / 1000;
    await send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[point], timestamp:time});
    for (let i = 1; i <= 3; i++) {
      await send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:point.x - 20*i,y:point.y}], timestamp:time + .025*i});
    }
    await send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[], timestamp:time + .085});
    await until(async () => {
      const settled = await timeline();
      return settled.selected > 1460 && settled.selected === settled.preview;
    }, 'A quick flick should glide past its release point and settle on the same year as the globe');
    await swipe('#vernier-track', -65);
    assert.equal(await js(`document.querySelector('#overlay').hidden`), false);
    console.log('Timeline: fractional tracking, fixed height, snap, cancel, single-year keys, momentum and swipe-up');
  } finally {
    ws?.close();
    proc.kill();
    local?.server.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
