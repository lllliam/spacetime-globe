/* Run against the generated online and single-file builds with an isolated browser profile. */
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { buildHarness, findBrowser, startServer, until, connectBrowser } = require('./harness');

const storeKey = 'globe.session.v1';
const profile = mkdtempSync(join(tmpdir(), 'globe-session-test-'));
async function main() {
  const browser = findBrowser();
  assert(browser, 'Chromium / Edge is required');
  const offline = pathToFileURL(buildHarness(true)).href;
  buildHarness();
  const http = await startServer();
  const url = `http://127.0.0.1:${http.port}/_harness.html`;
  let page;
  const js = expression => page.js(expression);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const esc = () => js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  const session = () => js('({mode:__t.session.mode,ex:__t.session.explore,book:__t.reading.bookId,detail:__t.reading.detail,' +
    'readYear:__t.reading.year,ob:__t.session.observe && {id:__t.session.observe.id,year:__t.session.observe.year,phase:__t.session.observe.phase,place:__t.session.observe.place}})');
  const camera = () => js('(({year,layerId,yaw,tilt,zoom,panX,panY})=>({year,layerId,yaw,tilt,zoom,panX,panY}))(__t.state)');
  const ready = () => until(() => js('__t.polityLoaded'), 'Historical boundaries did not load');
  const saved = () => js(`JSON.parse(localStorage.getItem('${storeKey}'))`);
  const setYear = async year => {
    await click('#year');
    await js(`document.querySelector('#year-input').value=${JSON.stringify(String(year))};document.querySelector('#year-form').requestSubmit();`);
    assert.equal((await camera()).year, year);
  };
  const select = (layer, match) => js(`__t.openEntity(${JSON.stringify(layer)},__t.partition.shapes.find(${match}).id)`);
  const ming = () => select('polity', "shape => shape.ent?.name === 'Ming Dynasty'");
  const china = () => select('country', "shape => shape.iso === 'CN'");
  const chapter = id => click(`[data-reading-detail="${id}"]`);
  const scroll = () => js("document.querySelector('#book-body').scrollTop");
  const locus = () => js(`(() => {
    const body=document.querySelector('#book-body'), p=body.querySelector('.subject-prose > p:nth-of-type(3)');
    return (body.getBoundingClientRect().top-p.getBoundingClientRect().top)/p.getBoundingClientRect().height;
  })()`);
  try {
    page = await connectBrowser(browser, profile);
    await page.open(url);
    assert.equal((await session()).mode, 'Explore');
    assert.equal((await camera()).year, 1500);
    assert.equal((await camera()).layerId, 'polity');
    await setYear(1500);
    await ready();
    await js('Object.assign(__t.state,{yaw:-1.6,tilt:.38,zoom:2,panX:48,panY:-21});__t.redraw()');
    await ming();
    const outer = await camera();
    await until(async () => (await saved())?.explore.selection?.name === 'Ming Dynasty', 'Exploration selection was not saved');
    await page.open(url);
    await until(() => js("__t.state.focus?.key === __t.session.explore.selection?.key && Boolean(__t.state.focus)"), 'Selection was not restored after refresh');
    assert.deepEqual(await camera(), outer);
    assert.equal(await js("document.querySelector('#sheet-identity-name').textContent"), '明朝');
    await click('[data-read-subject]');
    assert.equal((await session()).mode, 'Read');
    await chapter('two-capitals');
    await click('.reading-refs a');
    await esc();
    assert.equal(await js("document.querySelector('#footnote-popover').hidden && document.activeElement.matches('.reading-refs a')"), true);
    assert.equal((await session()).detail, 'two-capitals');
    await esc();
    assert.equal((await session()).detail, null);
    await chapter('fall');
    await js("document.querySelector('.subject-secondary [data-subject-book=qing]').closest('details').open=true");
    await click('.subject-secondary [data-subject-book=qing]');
    assert.equal((await session()).book, 'qing');
    const qingFirst = await js('document.querySelector("[data-reading-detail]").dataset.readingDetail');
    await chapter(qingFirst);
    await js("document.querySelector('#book-body').scrollTop=480");
    await esc();
    await esc();
    assert.equal((await session()).book, 'ming');
    assert.equal((await session()).detail, 'fall');
    await esc();
    await chapter('two-capitals');
    await js(`(() => {
      const body=document.querySelector('#book-body'), p=body.querySelector('.subject-prose > p:nth-of-type(3)');
      const box=p.getBoundingClientRect(); body.scrollTop += box.top-body.getBoundingClientRect().top + box.height*.35;
    })()`);
    const originalScroll = await scroll();
    const originalLocus = await locus();
    for (let attempt = 0; attempt < 2; attempt++) {
      await click('[data-subject-scene=yongle-capitals]');
      const initial = await session();
      assert.equal(initial.mode, 'Observe');
      assert.equal(initial.ex.year, 1500);
      assert.equal(initial.readYear, 1500);
      assert.equal(initial.ob.year, 1421);
      await click('#event-map-steps [data-scene-step="0"]');
      await click('[data-scene-place=qingjiangpu]');
      assert.deepEqual((await session()).ob, { id:'yongle-capitals', year:1411, phase:0, place:'qingjiangpu' });
      await click('#event-map-next');
      assert.notEqual((await session()).ob.id, 'yongle-capitals');
      await js("document.querySelector('#event-map-return').click();document.querySelector('#event-map-return').click()");
      assert.equal((await session()).mode, 'Read');
      assert.equal((await session()).detail, 'two-capitals');
      assert.ok(Math.abs(await scroll() - originalScroll) <= 2);
      assert.equal(await js('document.activeElement.dataset.subjectScene'), 'yongle-capitals');
    }
    await page.size(824, 460);
    await wait(300);
    assert.ok(Math.abs(await locus() - originalLocus) < .08);
    await page.size(402, 874);
    await wait(300);
    assert.ok(Math.abs(await locus() - originalLocus) < .08);
    const readCamera = await camera();
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await js(`document.querySelector('[data-subject-scene=yongle-capitals]').click();
      document.querySelector('#event-map-return').click();
      document.querySelector('[data-subject-scene=jingnan-campaign]').click();`);
    await wait(720);
    assert.equal((await session()).ob.id, 'jingnan-campaign');
    await click('#event-map-return');
    await until(() => js('__t.globeSettled && __t.sheetSettled'), 'Scene return did not settle');
    assert.deepEqual(await camera(), readCamera);
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    console.log('Read ↔ Observe, phase and place selection, repeated and interrupted returns, cross-book navigation, Escape and reflow passed.');

    await click('[data-subject-scene=yongle-capitals]');
    await page.open(url);
    assert.equal((await session()).mode, 'Read');
    assert.equal((await session()).detail, 'two-capitals');
    assert.ok(Math.abs(await scroll() - originalScroll) <= 2);
    await page.size(1320, 840, false);
    await wait(350);
    assert.equal(await js(`(() => {
      const book=document.querySelector('#book').getBoundingClientRect(), globe=document.querySelector('#globe');
      return !document.querySelector('#book').hidden && book.width===innerWidth && book.height===innerHeight &&
        globe.inert && getComputedStyle(globe).visibility==='hidden' && !__t.globeFramePending;
    })()`), true);
    assert.equal((await session()).ex.year, 1500);
    assert.equal((await camera()).year, 1500);
    await page.size(402, 874);
    await wait(300);
    await click('#reading-exit');
    await until(async () => (await session()).mode === 'Explore', 'Reader did not close');
    await until(() => js('Boolean(__t.state.focus)'), 'Original subject did not return');
    assert.deepEqual(await camera(), outer);
    await esc();
    await setYear(1900);
    const eventCamera = await camera();
    await click('#vernier-events');
    await js("document.querySelector('[data-event=i-140]').scrollIntoView({block:'center'})");
    const eventScroll = await js("document.querySelector('#overlay-body').scrollTop");
    await click('[data-event=i-140]');
    assert.equal((await session()).mode, 'Observe');
    await esc();
    assert.equal((await session()).mode, 'Explore');
    assert.deepEqual(await camera(), eventCamera);
    assert.equal(await js("document.querySelector('#overlay-body').scrollTop"), eventScroll);
    assert.equal(await js('document.activeElement.dataset.event'), 'i-140');
    await click('[data-event=i-140]');
    await page.open(url);
    assert.equal((await session()).mode, 'Explore');
    assert.equal(await js("document.querySelector('#overlay').hidden && document.querySelector('#event-map-panel').hidden"), true);
    assert.deepEqual(await camera(), eventCamera);

    await page.size(1320, 840, false);
    await wait(300);
    await click('#vernier-events');
    await click('[data-event=i-140]');
    await click('#event-map-points button[data-place=tianjin]');
    const eventPlaceCamera = await camera();
    await click('#event-map-read');
    assert.equal((await session()).mode, 'Read');
    await click('#reading-exit');
    assert.equal((await session()).ob.place, 'tianjin');
    assert.deepEqual(await camera(), eventPlaceCamera);
    assert.equal(await js("document.querySelector('#event-map-points button[data-place=tianjin]').getAttribute('aria-pressed')"), 'true');
    await esc();
    await page.size(402, 874);
    await wait(300);
    await esc();
    await click('#vernier-events');
    await click('[data-world-read=i-140]');
    assert.equal((await session()).readYear, 1900);
    assert.equal((await session()).book, 'qing');
    await js("document.querySelector('#book-body').scrollTop=630");
    await until(async () => Math.abs((await saved()).read?.position.top - 630) <= 3,
      'Latest event reading position was not saved');
    await page.close();
    page = await connectBrowser(browser, profile);
    await page.open(url);
    assert.equal((await session()).mode, 'Read');
    assert.equal((await session()).book, 'qing');
    const restartedScroll = await scroll();
    assert.ok(Math.abs(restartedScroll - 630) <= 3, `Reading returned to ${restartedScroll}, expected 630`);
    const persisted = await saved();
    assert.ok(persisted.progress.some(([key]) => key === 'subject:ming'));
    assert.ok(persisted.progress.some(([key]) => key === 'subject:qing'));
    await click('#reading-exit');
    assert.equal(await js("!document.querySelector('#overlay').hidden && document.activeElement.dataset.worldRead==='i-140'"), true);
    console.log('Reload and real browser restart, latest reading position, desktop fullscreen isolation and event-list return passed.');

    for (const [record, expectedMode, detail] of [
      ['{bad', 'Explore', null],
      [JSON.stringify({ ...persisted, schemaVersion: 999 }), 'Explore', null],
      [JSON.stringify({ ...persisted, read: { ...persisted.read, bookId: 'missing' } }), 'Explore', null],
      [JSON.stringify({ ...persisted, read: { ...persisted.read, detail: 'missing' } }), 'Read', null],
      [JSON.stringify({ ...persisted, mode: 'Explore', explore: { year: 0, camera: { zoom: 'invalid', tilt: 99 } } }), 'Explore', null],
    ]) {
      await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `try{localStorage.setItem('${storeKey}',${JSON.stringify(record)})}catch{}`,
      }).then(async ({ identifier }) => {
        await page.open(url);
        await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
      });
      assert.equal((await session()).mode, expectedMode);
      if (expectedMode === 'Read') assert.equal((await session()).detail, detail);
      assert.ok(Object.values(await camera()).filter(value => typeof value === 'number').every(Number.isFinite));
      assert.notEqual((await camera()).year, 0);
      assert.deepEqual(await js('window.__errs'), []);
    }

    const { identifier: blocked } = await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source:"Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})",
    });
    await page.open(url);
    await setYear(1930);
    assert.equal((await session()).mode, 'Explore');
    assert.deepEqual(await js('window.__errs'), []);
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked });

    await ready();
    const mingKey = await js("__t.pk.entities.find(entity=>entity.name==='Ming Dynasty').id");
    const pendingExplore = { ...persisted, mode:'Explore', explore: { ...persisted.explore, year:1500, layerId:'polity',
      selection: { layerId:'polity', key:mingKey, name:'Ming Dynasty' } } };
    const { identifier: delayed } = await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source:`localStorage.setItem('${storeKey}',${JSON.stringify(JSON.stringify(pendingExplore))})`,
    });
    let request;
    page.events.set('Fetch.requestPaused', data => { request = data.requestId; });
    await page.send('Fetch.enable', { patterns: [{ urlPattern:'*/data/polity.bin.gz' }] });
    await page.open(url);
    await until(() => request, 'Did not intercept the historical geometry load');
    await setYear(1900);
    await page.send('Fetch.continueRequest', { requestId:request });
    await ready();
    await page.send('Fetch.disable');
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier:delayed });
    assert.equal((await camera()).year, 1900);
    assert.equal(await js('__t.state.focus'), null);
    assert.deepEqual(await js('window.__errs'), []);
    console.log('Invalid schema and IDs, blocked storage and stale asynchronous selection protection passed.');

    await click('#hud-view');
    await click('[data-view=modern]');
    await click('#toggle-grid');
    await esc();
    await page.open(url);
    const display = await session();
    assert.equal(display.ex.followTime, false);
    assert.equal(display.ex.layerId, 'country');
    assert.equal(display.ex.grid, true);
    assert.equal(await js("document.querySelector('#view-panel').hidden"), true);

    await page.send('Network.enable');
    await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await page.open(offline);
    const fileStore = await js(`(() => {try{localStorage.setItem('globe-test-probe','ok');return localStorage.getItem('globe-test-probe')==='ok'}catch{return false}})()`);
    await setYear(await js('__t.yearBounds.max'));
    await china();
    await click('[data-read-subject]');
    await chapter('state-making');
    assert.equal((await session()).book, 'prc');
    await page.open(offline);
    if (fileStore) {
      assert.equal((await session()).mode, 'Read');
      assert.equal((await session()).detail, 'state-making');
      await esc();
      await click('#reading-library');
      await click('[data-reading-catalog]');
      await click('[data-reading-topic=china-late-qing]');
      await chapter('ports');
      await js("document.querySelector('#book-body').scrollTop=340");
      await page.open(offline);
      assert.equal(await js('__t.reading.topicId'), 'china-late-qing');
      assert.equal((await session()).detail, 'ports');
      assert.ok(Math.abs(await scroll() - 340) <= 2);
      const progress = (await saved()).progress.map(([key]) => key);
      assert.ok(progress.includes('subject:prc') && progress.includes('topic:china-late-qing'));
    } else assert.equal((await session()).mode, 'Explore');
    assert.deepEqual(await js('window.__errs'), []);
    console.log(fileStore ? 'file:// Edge with network disabled: local reading session persisted.' : 'file:// storage unavailable: safe startup and reading passed.');
  } finally {
    try { await page?.close(); } finally { http.server.close(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
