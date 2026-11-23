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
    const swipe = async (target, dy, { pause = 0, cancel = false, dx = 0 } = {}) => {
      const start = typeof target === 'string' ? await center(target) : target;
      await touch('touchStart', start);
      for (let i = 1; i <= 12; i++) {
        await touch('touchMove', { x:start.x + dx * i / 12, y:start.y + dy * i / 12 });
        await wait(30);
      }
      await wait(pause);
      await touch(cancel ? 'touchCancel' : 'touchEnd');
      await wait(400);
    };
    await send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:2 });
    await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'reduce' }] });
    await size(874);
    await send('Page.navigate', { url });
    await until(() => js(`document.querySelector('#globe') && !document.querySelector('#boot')`), 'Globe did not load');
    assert.equal(await js('navigator.maxTouchPoints'), 2);
    await tap('#hud-view');
    assert.equal(await js(`document.querySelector('#view-panel').hidden`), false);
    await tap('[data-view="modern"]');
    await tap('#view-close');
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
    assert.equal((await report()).theme, '#0a1016');
    console.log('Map-only archive: viewport resize, catalog/back, canceled pull, grip and body pulls, close button');

    await tap('#sheet-toc');
    await tap('#sheet-toc');
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
    await tap('#year');
    assert.equal(await js(`document.querySelector('#year-form').hidden`), false);
    await tap('#year-events');
    assert.equal(await js(`document.querySelector('#overlay').hidden`), false);
    await tap('#overlay-close');
    assert.equal(await js(`document.querySelector('#overlay').hidden`), true);
    console.log('Map and timeline: view switching, preview dismissal, year events and return');

    await tap({ x:281, y:372 });
    await until(() => js(`document.body.classList.contains('sheet-open')`), 'China did not open');
    await tap('#sheet-toc');
    assert.equal(await js(`document.body.classList.contains('reading-split')`), true);
    await swipe('#grab', -175);
    assert.equal((await fillsViewport()).sheet, 0);
    await tap('#book-body [data-reading-detail]');
    await swipe({ x:201, y:547 }, -175);
    const scroll = await js(`document.querySelector('#book-body').scrollTop`);
    assert(scroll > 0, 'Long chapter must scroll normally');
    await swipe({ x:201, y:370 }, 65);
    assert.equal((await fillsViewport()).sheet, 0);
    await tap('#sheet-toc');
    assert.equal(await js(`document.querySelector('#reading-title').textContent`), '中华人民共和国');
    await swipe('#grab', 175, { pause:150 });
    assert.equal(await js(`document.body.classList.contains('reading-split')`), true);
    await fillsViewport();
    await tap('#sheet-close');
    await assertPreview();
    console.log('Full book: half/full transitions, chapter scrolling, table of contents and exit');
  } finally {
    ws?.close();
    proc.kill();
    local?.server.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
