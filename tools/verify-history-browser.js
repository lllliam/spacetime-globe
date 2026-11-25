/* Exercise the actual Phase 04 storage format and the rebuilt online/offline reader. */
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout:wait } = require('node:timers/promises');
const { ROOT,buildHarness,findBrowser,startServer,until,connectBrowser } = require('./harness');

async function main() {
  const [baseline,output] = process.argv.slice(2);
  assert(baseline,'Pass the Phase 04 index.html from commit 9c4f2ee as the first argument');
  const browser = findBrowser();
  assert(browser,'Chromium or Edge required');
  const old = readFileSync(baseline,'utf8');
  const marker = '/* ───────────── 19. 启动 ───────────── */';
  assert(old.includes(marker) && old.includes('subjectsByPolity') && !old.includes('data-block-id'), 'Expected Phase 04 build');
  writeFileSync(join(ROOT,'_harness.phase04.html'),old.replace(marker,`
window.__t = {state, openEntity, get partition(){return partition},captureReadingPosition,saveVisibleSession};
${marker}`));
  buildHarness();
  const offline = pathToFileURL(buildHarness(true)).href;
  if (output) mkdirSync(output,{recursive:true});
  const http = await startServer();
  const url = 'http://127.0.0.1:' + http.port;
  const bookBody = '#book-body';
  let page;
  const js = expression => page.js(expression);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text = selector => js(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
  const capture = async name => {
    if (!output) return;
    await wait(220);
    const {data} = await page.send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(output,name+'.png'),Buffer.from(data,'base64'));
  };
  const position = () => js('__t.captureReadingPosition()');
  const readSaved = () => js("JSON.parse(localStorage.getItem('globe.session.v1'))");
  const yearCamera = () => js("(({year,yaw,tilt,zoom,panX,panY})=>({year,yaw,tilt,zoom,panX,panY}))(__t.state)");
  const ming = () => js(`__t.openEntity('polity',__t.partition.shapes.find(shape=>shape.ent.name==='Ming Dynasty').id)`);
  const chapterIds = () => js(`[...document.querySelectorAll('.reading-row[data-reading-detail]')].map(b=>b.dataset.readingDetail)`);
  const p3 = '.subject-prose > p:nth-of-type(3)';
  const attachPoint = event => js(`(() => {
    const node = document.querySelector('[data-subject-scene="${event}"]').closest('figure');
    let previous=node.previousElementSibling;
    while(previous && !previous.matches('p[data-block-id]')) previous=previous.previousElementSibling;
    return previous?.dataset.blockId;
  })()`);
  const scrollToP3 = () => js(`(() => {
    const body=document.querySelector('${bookBody}'), box=body.querySelector('${p3}').getBoundingClientRect();
    body.scrollTop+=box.top-body.getBoundingClientRect().top+box.height*.28;
  })()`);

  try {
    page = await connectBrowser(browser,mkdtempSync(join(tmpdir(),'globe-history-')));
    await page.size(393,844,true,2);
    await page.open(url+'/_harness.phase04.html');
    await js('Object.assign(__t.state,{yaw:-1.61,tilt:.39,zoom:1.4,panX:21,panY:12})');
    await ming();
    const originalCamera = await yearCamera();
    await click('#sheet-toc');
    await click('.reading-row[data-reading-detail=two-capitals]');
    await scrollToP3();
    const legacyPosition = await position();
    assert.ok(legacyPosition.block && legacyPosition.top>0 && !Object.hasOwn(legacyPosition,'blockId'));
    await js('__t.saveVisibleSession()');
    const legacy = await readSaved();
    assert.equal(legacy.schemaVersion,1);
    assert.equal(legacy.read.detail,'two-capitals');
    assert.equal(legacy.read.position.block,legacyPosition.block);

    await page.open(url+'/_harness.html');
    assert.equal(await js('__t.reading.detail'),'two-capitals');
    assert.deepEqual(await yearCamera(),originalCamera);
    const migrated = await position();
    assert.equal(migrated.blockId,'p-03');
    assert.equal(migrated.block,legacyPosition.block);
    assert.ok(Math.abs(migrated.top-legacyPosition.top)<=2);
    await until(async ()=>(await readSaved()).read.position.blockId==='p-03','Legacy fingerprint not upgraded');
    assert.equal((await readSaved()).progress.find(([key])=>key==='subject:ming')[1].position.blockId,'p-03');
    await capture('03-phase04-session-restored');
    await click('#reading-index');
    assert.deepEqual(await chapterIds(),['founding','two-capitals','mid-ming','silver','fall']);
    await click('#reading-back');
    assert.equal((await position()).blockId,'p-03');
    const attached = await attachPoint('yongle-capitals');
    assert.ok(attached);
    const refSelector = 'p[data-block-id="p-03"] .reading-refs a';
    const sourceBefore = await js(`document.querySelector(document.querySelector('${refSelector}').hash).href`);

    await click('#reading-index');
    await js(`(() => {
      const book=__t.reading.subject, chapter=book.chapters.find(c=>c.id==='two-capitals');
      const p=chapter.paragraphs.splice(2,1)[0];
      p.text='重排试验。'+p.text;
      p.refs[0]={sourceId:p.refs[0],locator:'第 1 页'};
      chapter.paragraphs.splice(1,0,p);
      chapter.paragraphs.unshift({id:'test-insertion',text:'临时插入用段落。',refs:[]});
      book.sources.reverse();
    })()`);
    await click('#reading-back');
    assert.equal((await position()).blockId,'p-03');
    assert.ok(Math.abs((await position()).offset-migrated.offset)<.08);
    assert.equal(await attachPoint('yongle-capitals'),attached);
    await click(refSelector);
    assert.equal(await js("document.querySelector('#footnote-link').href"),sourceBefore);
    assert.match(await text('#footnote-text'),/第 1 页/);
    await click('#footnote-close');
    const beforeScene = await position();
    await click('[data-subject-scene=yongle-capitals]');
    assert.equal(await js('__t.session.observe.id'),'yongle-capitals');
    await click('#event-map-return');
    assert.equal((await position()).blockId,beforeScene.blockId);
    assert.ok(Math.abs((await position()).offset-beforeScene.offset)<.08);
    assert.deepEqual(await yearCamera(),originalCamera);

    const beforeDeletion = await position();
    await click('#reading-index');
    await js(`(() => {
      const chapter=__t.reading.subject.chapters.find(c=>c.id==='two-capitals');
      chapter.paragraphs=chapter.paragraphs.filter(p=>p.id!=='p-03');
      chapter.sceneRefs=chapter.sceneRefs.filter(ref=>ref.afterBlockId!=='p-03');
    })()`);
    await click('#reading-back');
    assert.equal(await js('__t.reading.detail'),'two-capitals');
    assert.notEqual((await position()).blockId,'p-03');
    assert.ok(Math.abs((await position()).top-beforeDeletion.top)<=2);
    await click('#reading-exit');
    assert.deepEqual(await yearCamera(),originalCamera);
    await click('#sheet-close');
    for (const year of [1400,1500,1600]) {
      await js(`__t.commitYear(${year})`);
      await ming();
      await click('#sheet-toc');
      assert.equal(await js('__t.reading.bookId'),'ming');
      await click('#reading-exit');
      await click('#sheet-close');
    }
    const targets = await js(`(() => {
      const book=__t.subjectBooks.find(b=>b.id==='ming');
      book.chapters[2].recommendation={priority:5,range:{from:1405,to:1405}};
      const inferred=__t.worldReadingTarget({id:'i-040'},1405);
      const explicit=__t.worldReadingTarget({id:'i-010'},1405);
      const gap=__t.worldReadingTarget({id:'i-075'},1400);
      return [inferred.chapter.id,explicit.chapter.id,gap.book.id,gap.chapter,gap.year];
    })()`);
    assert.deepEqual(targets,['mid-ming','two-capitals','aztec',null,1400]);

    const today = await js('__t.yearBounds.max');
    await js(`__t.commitYear(${today})`);
    for (const [iso,relation,chapter] of [
      ['IN','primary',null],['PK','related','independence-partition-republic'],['BD',null,null],
      ['LK','related','maurya-ashoka-kushan'],['IE','related','world-wars-post-imperial'],['GL','related','modern-canada-arctic'],
    ]) {
      await js(`__t.openEntity('country',__t.partition.shapes.find(s=>s.iso==='${iso}').id)`);
      assert.equal(await text('#sheet-toc'),relation==='primary' ? '阅读历史' : '查看地图资料');
      await click('#sheet-toc');
      if (relation==='primary') {
        assert.equal(await js('__t.reading.bookId'),'india-classical-modern');
        assert.match(await text('.reading-cover .reading-note'),/现代印度共和国/);
        await capture('01-india-primary');
      } else {
        assert.equal(await js('__t.reading.bookId'),null);
        assert.match(await text('.atlas-reading .lede'),/尚未收录/);
        if (relation==='related') {
          const related = '.atlas-reading .reading-connections [data-subject-book]';
          assert.equal(await text('.atlas-reading .reading-connections h2'),'相关历史');
          if (iso==='PK') await capture('02-pakistan-related');
          await click(related);
          assert.equal(await js('__t.reading.detail'),chapter);
          await click('#reading-back');
          assert.equal(await js('__t.reading.bookId'),null);
          assert.equal(await js('__t.reading.ent.iso'),iso);
        } else assert.equal(await js("Boolean(document.querySelector('.atlas-reading [data-subject-book]'))"),false);
      }
      await click('#reading-exit');
      await click('#sheet-close');
    }
    assert.deepEqual(await js('window.__errs'),[]);

    const injected = await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`
      try { localStorage.setItem('globe.session.v1',${JSON.stringify(JSON.stringify(legacy))}); } catch {}
    `});
    await page.send('Network.enable');
    await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await page.open(offline);
    await page.send('Page.removeScriptToEvaluateOnNewDocument',injected);
    assert.equal(await js('__t.reading.detail'),'two-capitals');
    assert.equal((await position()).blockId,'p-03');
    await click('#reading-index');
    await click('#reading-back');
    assert.equal((await position()).blockId,'p-03');
    await click('#reading-exit');
    assert.deepEqual(await yearCamera(),originalCamera);
    assert.deepEqual(await js('window.__errs'),[]);
    console.log('History browser: actual Phase 04 storage on same origin, stable positions after edit/reorder/delete, sources, scene placement and return, event defaults, six map entries and offline migration passed.');
  } finally {
    try { await page?.close(); } finally { http.server.close(); }
  }
}

main().catch(error => { console.error(error); process.exitCode=1; });
