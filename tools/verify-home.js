/* Explore regressions against the built application, with optional real page captures. */
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { buildHarness, findBrowser, startServer, until, connectBrowser } = require('./harness');

async function main() {
  const browser = findBrowser();
  assert(browser, 'Chromium / Edge is required');
  const output = process.argv[2];
  if (output) mkdirSync(output, { recursive:true });
  const profile = mkdtempSync(join(tmpdir(), 'globe-home-test-'));
  buildHarness();
  const http = await startServer();
  const url = `http://127.0.0.1:${http.port}/_harness.html`;
  let page;
  const js = expression => page.js(expression);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text = selector => js(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
  const key = (key, target = '#globe') => js(`document.querySelector(${JSON.stringify(target)}).dispatchEvent(
    new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
  const info = () => js(`({ year:__t.state.year, layer:__t.partition.layerId, mapYear:__t.partition.year,
    shapes:__t.partition.shapes.length, mode:__t.session.mode, camera:[__t.state.yaw,__t.state.tilt,__t.state.zoom,__t.state.panX,__t.state.panY],
    hidden:document.querySelector('#vernier').hidden })`);
  const selectYear = async input => {
    await click('#year');
    await js(`document.querySelector('#year-input').value=${JSON.stringify(String(input))};
      document.querySelector('#year-form').requestSubmit();`);
    return info();
  };
  const capture = async name => {
    if (!output) return;
    await wait(260);
    const { data } = await page.send('Page.captureScreenshot', { format:'png' });
    writeFileSync(join(output, name + '.png'), Buffer.from(data,'base64'));
  };
  const tapAt = async point => {
    await page.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[point] });
    await page.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    await wait(350);
  };

  try {
    page = await connectBrowser(browser, profile);
    await page.size(393,844,true,2);
    await page.send('Emulation.setTouchEmulationEnabled', {enabled:true, maxTouchPoints:2});
    let paused;
    page.events.set('Fetch.requestPaused', event => { paused = event.requestId; });
    await page.send('Fetch.enable', { patterns:[{urlPattern:'*/data/polity.bin.gz'}] });
    await page.send('Page.navigate', { url });
    await until(() => paused,'Cold start did not request the historical package');
    const loading = await info();
    assert.equal(loading.year,1500);
    assert.equal(loading.layer,'polity');
    assert.equal(loading.shapes,0);
    assert.equal(await js("!document.querySelector('#boot').classList.contains('gone')"),true);
    assert.match(await text('#boot p'), /1500.*历史疆域/);
    await page.send('Fetch.continueRequest',{requestId:paused});
    await until(() => js("!document.querySelector('#boot') && __t.polityLoaded"),'Historical startup did not finish');
    await page.send('Fetch.disable');
    const initial = await info();
    assert.equal(initial.year,1500);
    assert.equal(initial.mapYear,1500);
    assert.ok(initial.shapes > 20);
    assert.equal(await text('#year-era'),'历史疆域');
    assert.equal(await js("__t.partition.shapes.some(shape=>shape.ent.name==='Ming Dynasty')"),true);
    await capture('01-home-1500');

    for (const [w,h,mobile,dpr] of [[320,568,true,2],[393,844,true,2],[430,932,true,3],
      [844,390,true,2],[1366,768,false,1],[1920,1080,false,1]]) {
      await page.size(w,h,mobile,dpr);
      await js(`document.documentElement.style.setProperty('--safe-t','${mobile && h > w ? 47 : 0}px');
        document.documentElement.style.setProperty('--safe-b','${mobile && h > w ? 24 : 0}px');
        dispatchEvent(new Event('resize'))`);
      await until(() => js(`__t.view.w===${w} && __t.view.h===${h}`),'Viewport did not settle');
      const layout = await js(`(() => {
        const last = document.querySelector('#vernier').getBoundingClientRect();
        return { radius:__t.view.R, globeBottom:__t.view.cy+__t.view.R, timeline:Math.round(last.top),
          timelineBottom:Math.round(last.bottom), yearTop:Math.round(document.querySelector('#year').getBoundingClientRect().top),
          dpr:__t.view.dpr,
          interactive:['#year','#hud-view','#vernier-track','#vernier-events'].every(selector=>{
            const node=document.querySelector(selector), r=node.getBoundingClientRect();
            return r.width>0 && r.left>=0 && r.right<=innerWidth+.5 &&
              node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
          }) };
      })()`);
      assert.ok(layout.interactive && layout.radius>80 && layout.globeBottom<layout.timeline &&
        layout.timelineBottom<=h && layout.yearTop>=(mobile && h>w ? 47 : 0) && layout.dpr===dpr, JSON.stringify({w,h,...layout}));
      await click('#year');
      assert.equal(await js(`(() => {const box=document.querySelector('#year-form').getBoundingClientRect();
        return box.left>=0 && box.right<=innerWidth+.5 && box.bottom<=visualViewport.height;})()`), true);
      await key('Escape','#year-input');
      if (w===1366) await capture('08-desktop-home');
      console.log(`Viewport ${w}×${h} DPR ${dpr}: globe, safe area, controls and year picker passed.`);
    }

    await page.size(393,844,true,2);
    await js("document.documentElement.style.removeProperty('--safe-t');document.documentElement.style.removeProperty('--safe-b');dispatchEvent(new Event('resize'))");
    await until(() => js('__t.view.w===393 && __t.view.safeTop===0'),'Mobile viewport did not return');
    await key('F2');
    assert.equal(await js("document.activeElement.id==='year-input' && document.querySelector('#year-input').value==='1500'"),true);
    assert.equal(await js("!document.querySelector('#year-strip') && !document.querySelector('#toolbar')"),true);
    await capture('02-year-picker');
    await key('Escape','#year-input');
    for (const value of ['前221','公元前221年','-221']) {
      const result = await selectYear(value);
      assert.equal(result.year,-221);
      assert.equal(result.mapYear,-221);
      assert.equal(result.layer,'polity');
    }
    await capture('03-bce-map');
    for (const value of ['0','公元前0年','3.14','1 500','公元前3501年']) {
      assert.equal((await selectYear(value)).year,-221);
      assert.match(await text('#year-error'),/没有公元 0 年/);
      await key('Escape','#year-input');
    }
    assert.equal((await selectYear('公元前1年')).year,-1);
    await key('ArrowRight','#vernier-track');
    assert.equal((await info()).year,1);
    await key('ArrowLeft','#vernier-track');
    assert.equal((await info()).year,-1);
    await key('Home','#vernier-track');
    const earliest = await info();
    assert.equal(earliest.year,-3500);
    assert.equal(earliest.mapYear,-3500);
    assert.equal(earliest.layer,'polity');
    assert.equal(earliest.shapes,0);
    assert.match(await text('#year-era'),/暂无收录疆域/);
    await click('#year');
    await click('[data-year-jump="1453"]');
    assert.equal((await info()).mapYear,1453);
    assert.equal(await js("__t.concreteEventStarts().has(1453) && document.querySelectorAll('#vernier-ticks span')[13].classList.contains('has-event')"),true);
    await key('End','#vernier-track');
    const current = await js('__t.yearBounds.max');
    assert.equal((await info()).year,current);
    assert.match(await text('#year-era'),/现代参考边界.*2024/);
    await click('#vernier-events');
    assert.equal(await text('#overlay-title'), current + ' 年');
    assert.equal(await js("document.querySelector('#overlay').textContent.includes('近年')"),false);
    assert.equal(await js(`(() => {
      const { events,background } = __t.yearEventGroups(${current});
      return [...events,...background].every(event => event.start<=${current} &&
        (event.point ? event.start : event.end)>=${current});
    })()`),true);
    await click('#overlay-close');

    await selectYear('前3500');
    for (const hasBackground of [true,false]) {
      if (!hasBackground) await js('__t.clearTimelineEntries()');
      assert.equal(await text('#vernier-events'),'这一年');
      await click('#vernier-events');
      assert.match(await text('.wempty'),/暂无收录/);
      assert.equal(await js("[...document.querySelectorAll('#overlay-body summary')].some(node=>node.textContent==='长期背景')"),hasBackground);
      await click('#overlay-close');
    }
    await page.open(url);
    await selectYear(1900);
    const eventHeading = await text('#vernier-events');
    await click('#vernier-events');
    const counts = await js(`(() => {
      const groups=__t.yearEventGroups(1900), background=[...document.querySelectorAll('#overlay-body > details [data-event]')];
      return { expected:groups.events.length, rendered:document.querySelectorAll('#overlay-body > section [data-event]').length,
        background:background.length, expectedBackground:groups.background.length };
    })()`);
    assert.equal(counts.expected,counts.rendered);
    assert.equal(counts.background,counts.expectedBackground);
    assert.equal(eventHeading,'这一年 · '+counts.rendered+' 件史事');
    await capture('06-year-events');
    const outer = await info();
    for (const [selector, mode, target] of [['[data-event=i-140]','Observe','#event-map-return'],
      ['[data-world-read=i-140]','Read','#reading-exit']]) {
      const scroll = await js(`document.querySelector('${selector}').scrollIntoView({block:'center'});document.querySelector('#overlay-body').scrollTop`);
      await click(selector);
      assert.equal((await info()).mode,mode);
      await click(target);
      const returned = await info();
      assert.equal(returned.mode,'Explore');
      assert.equal(returned.year,outer.year);
      assert.deepEqual(returned.camera,outer.camera);
      assert.equal(await js("document.querySelector('#overlay-body').scrollTop"),scroll);
      assert.equal(await js(`document.activeElement.matches('${selector}')`),true);
    }
    await click('#overlay-close');
    console.log('Year formats, calendar limits, actual map years, event categories and return context passed.');

    await selectYear(1500);
    const point = await js('__t.screenOf(115*Math.PI/180,33*Math.PI/180)');
    await tapAt({x:point.x,y:point.y});
    assert.equal(await text('#sheet-identity-name'),'明朝');
    assert.equal(await text('#sheet-toc'),'阅读历史');
    assert.equal(await js("document.querySelectorAll('[data-read-subject]').length"),1);
    assert.equal((await info()).hidden,true);
    await capture('04-ming-summary');
    await click('#sheet-toc');
    await click('[data-reading-detail=two-capitals]');
    await page.open(url);
    assert.equal((await info()).mode,'Read');
    assert.equal(await js('__t.reading.detail'),'two-capitals');
    await click('#reading-exit');
    assert.equal(await text('#sheet-toc'),'继续阅读');
    await click('#sheet-toc');
    assert.equal(await js('__t.reading.detail'),'two-capitals');
    await click('#reading-exit');
    await click('#sheet-close');
    await tapAt({x:20,y:360});
    assert.equal((await info()).hidden,false);
    assert.equal(await js("getComputedStyle(document.querySelector('#hud')).opacity"),'1');

    await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await page.size(1366,768,false);
    const desktopPoint = await until(() => js(`__t.view.w===1366 && __t.sheetSettled &&
      document.elementFromPoint(683,360)?.id==='globe' && !document.querySelector('#globe').inert && {x:683,y:360}`),
      'Desktop globe was not interactive');
    const originalYaw = (await info()).camera[0];
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...desktopPoint,button:'left',buttons:1,clickCount:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:desktopPoint.x+55,y:desktopPoint.y,button:'left',buttons:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:desktopPoint.x+55,y:desktopPoint.y,button:'left',clickCount:1});
    assert.ok(Math.abs((await info()).camera[0]-originalYaw)>.1,'Desktop mouse drag did not rotate');
    await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',...desktopPoint,deltaX:0,deltaY:-240});
    await until(async () => (await info()).camera[2]>1.25,'Wheel did not zoom');
    await click('#hud-view');
    await click('#reset-view');
    assert.equal((await info()).year,1500);
    assert.equal((await info()).camera[2],1);

    await page.size(393,844,true,2);
    await until(() => js('__t.view.w===393'),'Mobile viewport did not return for settings');
    await click('#hud-view');
    await capture('05-view-settings');
    await click('#reset-view');
    await click('#year');
    await click('#year-today');
    assert.equal((await info()).year,current);
    assert.equal((await info()).layer,'country');
    await capture('07-modern-map');
    await selectYear(1453);
    await click('#hud-view');
    await click('[data-view=modern]');
    await key('Escape','[data-view=modern]');
    await page.open(url);
    assert.equal((await info()).year,1453);
    assert.equal((await info()).layer,'country');
    assert.match(await text('#year-era'),/现代参考边界.*Natural Earth/);
    assert.deepEqual(await js('window.__errs'),[]);
    console.log('Historical picking, explicit reading/resume, camera reset, modern reference and saved preferences passed.');
  } finally {
    try { await page?.close(); } finally { http.server.close(); }
  }
}

main().catch(error => { console.error(error); process.exitCode=1; });
