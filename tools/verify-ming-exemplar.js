/* Phase 08 reading, observation and same-origin compatibility with the tracked pre-Phase-08 build. */
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ROOT, buildHarness, findBrowser, startServer, until, connectBrowser } = require('./harness');

async function main() {
  const [baseline, output] = process.argv.slice(2);
  assert(baseline, 'Pass index.html from pre-Phase-08 commit 5323209');
  const browser = findBrowser();
  assert(browser, 'Edge or Chromium is required');
  const marker = '/* ───────────── 19. 启动 ───────────── */';
  const legacy = readFileSync(baseline, 'utf8');
  assert(legacy.includes(marker) && legacy.includes('data-block-id'), 'Expected a stable-block legacy build');
  writeFileSync(join(ROOT, '_harness.phase08-baseline.html'), legacy.replace(marker,
    'window.__t={state,openEntity,get partition(){return partition},get reading(){return reading},' +
    'subjectBooks,captureReadingPosition,saveVisibleSession};\n' + marker));
  buildHarness();
  if (output) mkdirSync(output, {recursive:true});
  const { server, port } = await startServer();
  const url = 'http://127.0.0.1:' + port;
  let page;
  const js = expression => page.js(expression);
  const click = selector => js('document.querySelector('+JSON.stringify(selector)+').click()');
  const scrollTo = selector => js('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');
  const snapshot = () => js('JSON.parse(localStorage.getItem("globe.session.v1"))');
  const position = () => js('__t.captureReadingPosition()');
  const camera = () => js('(({year,yaw,tilt,zoom,panX,panY})=>({year,yaw,tilt,zoom,panX,panY}))(__t.state)');
  const pickMing = () => js('__t.openEntity("polity",__t.partition.shapes.find(shape=>shape.ent.name==="Ming Dynasty").id)');
  const take = async name => {
    if (!output) return;
    const { data } = await page.send('Page.captureScreenshot', {format:'png'});
    writeFileSync(join(output, name + '.png'), Buffer.from(data, 'base64'));
  };
  try {
    page = await connectBrowser(browser, mkdtempSync(join(tmpdir(), 'globe-ming-exemplar-')));
    await page.size(1366,768,false,1);
    const legacyURL = url+'/_harness.phase08-baseline.html';
    const currentURL = url+'/_harness.html';
    await page.open(legacyURL);
    const original = await js('JSON.parse(JSON.stringify(__t.subjectBooks.find(book=>book.id==="ming")))');
    assert.deepEqual(original.chapters.map(ch=>ch.id), ['founding','two-capitals','mid-ming','silver','fall']);
    assert.equal(original.chapters.flatMap(ch=>ch.paragraphs).length, 31);
    let sceneCount = 0;
    for (const chapter of original.chapters) {
      await page.open(legacyURL);
      await js('Object.assign(__t.state,{yaw:-1.61,tilt:.39,zoom:1.4,panX:21,panY:12})');
      if (!await js('__t.reading.active')) {
        await pickMing();
        await click('#sheet-toc');
        if (await js('!!__t.reading.detail')) await click('#reading-index');
      } else if (!await js('__t.reading.directory')) await click('#reading-index');
      await click('.reading-row[data-reading-detail="'+chapter.id+'"]');
      const explore = await camera();
      const block = chapter.paragraphs[2].id;
      await js('(() => {const body=document.querySelector("#book-body"),' +
        'block=body.querySelector("p[data-block-id='+block+']"), box=block.getBoundingClientRect();' +
        'body.scrollTop+=box.top-body.getBoundingClientRect().top+box.height*.25; __t.saveVisibleSession();})()');
      const stored = await snapshot();
      assert.equal(stored.read.detail, chapter.id);
      assert.equal(stored.read.position.blockId, block);

      await page.open(currentURL);
      await until(() => js('__t.reading.detail===' + JSON.stringify(chapter.id)), 'Old chapter did not resume');
      const current = await position();
      assert.equal(current.blockId, block);
      assert.ok(Math.abs(current.offset-stored.read.position.offset)<.09, JSON.stringify({chapter:chapter.id,current,old:stored.read.position}));
      assert.deepEqual(await camera(), explore);
      const restored = await js('JSON.parse(JSON.stringify(__t.reading.subject.chapters.find(ch=>ch.id===__t.reading.detail)))');
      for (const paragraph of chapter.paragraphs) assert(restored.paragraphs.some(item=>item.id===paragraph.id &&
        (!paragraph.callout || item.callout?.id===paragraph.callout.id)), chapter.id+'/'+paragraph.id);
      for (const ref of chapter.sceneRefs || []) {
        assert.deepEqual(restored.sceneRefs.find(item=>item.id===ref.id), ref);
        const selector = '[data-subject-scene="'+ref.id+'"]';
        await scrollTo(selector);
        const before = await position();
        await click(selector);
        assert.equal(await js('__t.session.observe.id'), ref.id);
        const steps = await js('__t.historicalScenes.get(__t.session.observe.id).steps.map(({id,year})=>({id,year}))');
        for (const [index, step] of steps.entries()) {
          await js('__t.applySceneStep(__t.worldEvent,'+index+',{animate:false})');
          assert.equal(await js('__t.state.year'), step.year, ref.id+'/'+step.id);
        }
        await click('#event-map-return');
        const after = await position();
        assert.equal(after.block, before.block);
        assert.ok(Math.abs(after.offset-before.offset)<.09, ref.id);
        assert.equal(await js('document.activeElement.matches('+JSON.stringify(selector)+')'), true);
        sceneCount++;
      }
      await click('#reading-exit');
      assert.deepEqual(await camera(), explore);
      await js('__t.closeSheet()');
    }
    assert.equal(sceneCount, 8);
    const clear = await page.send('Page.addScriptToEvaluateOnNewDocument',{
      source:'localStorage.removeItem("globe.session.v1")',
    });
    await page.open(currentURL);
    await page.send('Page.removeScriptToEvaluateOnNewDocument',clear);
    await pickMing();
    await click('#sheet-toc');
    const ids = await js('[...document.querySelectorAll(".subject-outline .reading-row")].map(row=>row.dataset.readingDetail)');
    assert.equal(ids.length, 20);
    assert.equal(await js('document.querySelector(".reading-entry-year").dataset.readingDetail'), 'court-paperwork');
    await page.size(1366,2048,false,1);
    await until(() => js('[...document.querySelectorAll(".subject-outline .reading-row")].at(-1).getBoundingClientRect().bottom<innerHeight'),
      'Complete Ming directory did not fit the capture');
    await take('01-complete-directory');
    await page.size(1366,768,false,1);
    await take('03-year-1500');
    await click('[data-reading-restart]');
    assert.equal(await js('__t.reading.detail'), ids[0]);
    for (const id of ids.slice(1)) {
      const link = '.subject-chapter-next [data-reading-detail="'+id+'"]';
      await scrollTo(link);
      await click(link);
      assert.equal(await js('__t.reading.detail'), id);
      assert.equal(await js('__t.state.year'), 1500);
      assert.ok(await js('document.querySelector(".subject-prose > p:last-of-type").textContent.length>60'));
    }
    await page.size(320,568,true,2);
    for (const size of ['small','standard','large','extra']) {
      await click('#reading-settings');
      await click('[data-reading-size='+size+']');
      await click('#reading-settings');
      assert.equal(await js('document.querySelector("#book").dataset.size'), size);
      assert.equal(await js('document.querySelector("#book-body").clientWidth===document.querySelector("#book-body").scrollWidth'), true);
    }
    assert.deepEqual(await js('window.__errs'), []);
    console.log('Phase 08: 5 real legacy chapter sessions, 31 retained paragraphs, 8 scene entrances and returns, 20 sequential chapters, and 4 text sizes at 320px passed.');
  } finally {
    if (page) await page.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
