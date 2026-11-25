/* Fullscreen reader regressions against the built app. Pass a directory to save actual screenshots. */
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { buildHarness, findBrowser, startServer, until, connectBrowser } = require('./harness');

async function main() {
  const browser = findBrowser();
  assert(browser, 'Edge or Chromium is required');
  const output = process.argv[2];
  if (output) mkdirSync(output, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'globe-reading-test-'));
  buildHarness();
  const http = await startServer();
  const url = 'http://127.0.0.1:' + http.port + '/_harness.html';
  let page;
  const js = expression => page.js(expression);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text = selector => js(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
  const focus = selector => js(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
  const press = async (key, modifiers = 0) => {
    const codes = { Escape:27, Enter:13, Tab:9 };
    const event = {key,modifiers,code:key,windowsVirtualKeyCode:codes[key],nativeVirtualKeyCode:codes[key]};
    await page.send('Input.dispatchKeyEvent', {type:'rawKeyDown',...event});
    if (key==='Enter') await page.send('Input.dispatchKeyEvent', {type:'char',...event,text:'\r',unmodifiedText:'\r'});
    await page.send('Input.dispatchKeyEvent', {type:'keyUp',...event});
  };
  const capture = async name => {
    if (!output) return;
    await wait(230);
    const { data } = await page.send('Page.captureScreenshot', {format:'png'});
    writeFileSync(join(output, name + '.png'), Buffer.from(data, 'base64'));
  };
  const info = () => js(`({ mode:__t.session.mode, year:__t.reading.year, map:__t.state.year, dir:__t.reading.directory,
    detail:__t.reading.detail, book:__t.reading.bookId, scene:__t.session.observe?.id, place:__t.session.observe?.place,
    explore:__t.session.explore, camera:[__t.state.yaw,__t.state.tilt,__t.state.zoom,__t.state.panX,__t.state.panY] })`);
  const anchor = () => js('__t.captureReadingPosition()');
  const assertAnchor = async position => {
    const current = await anchor();
    assert.equal(current.block, position.block, JSON.stringify({current,position}));
    assert.ok(Math.abs(current.offset - position.offset) < .09, JSON.stringify({current,position}));
  };
  const pickMing = () => js(`__t.openEntity('polity',__t.partition.shapes.find(s=>s.ent.name==='Ming Dynasty').id)`);
  const bodyAt = fraction => js(`(() => {
    const body = document.querySelector('#book-body'), p = body.querySelector('.subject-prose > p:nth-of-type(3)');
    const r = p.getBoundingClientRect();
    body.scrollTop += r.top - body.getBoundingClientRect().top + r.height * ${fraction};
  })()`);
  const placeInView = selector => js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  const size = async (w,h,mobile,dpr) => {
    await page.size(w,h,mobile,dpr);
    await js(`document.documentElement.style.setProperty('--safe-t','${mobile && h>w ? 47 : 0}px');
      document.documentElement.style.setProperty('--safe-b','${mobile && h>w ? 24 : 0}px');
      dispatchEvent(new Event('resize'))`);
    await until(() => js(`innerWidth===${w} && visualViewport.height===${h}`), 'Viewport did not settle');
    await wait(120);
  };
  try {
    page = await connectBrowser(browser, profile);
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    await page.size(393,844,true,2);
    await page.open(url);
    await js('__t.stopSpin()');
    await size(393,844,true,2);
    for (const [year, recommendation] of [[1400,'two-capitals'],[1600,'silver'],[1500,'mid-ming']]) {
      await js(`__t.setYear(${year})`);
      await pickMing();
      assert.equal(await text('#sheet-toc'),'阅读历史');
      await click('#sheet-toc');
      assert.equal((await info()).book,'ming');
      assert.equal((await info()).detail,null);
      assert.equal(await js("document.querySelector('.reading-entry-year').dataset.readingDetail"), recommendation);
      assert.equal(await js("document.querySelectorAll('.subject-outline .reading-row').length"),5);
      if (year!==1500) { await click('#reading-exit'); await click('#sheet-close'); }
    }
    const explore = (await info()).explore;
    await capture('01-ming-contents');
    await focus('[data-reading-restart]');
    await press('Enter');
    assert.equal((await info()).detail,'founding');
    await click('.subject-chapter-next [data-reading-detail=two-capitals]');
    assert.equal((await anchor()).top,0);
    assert.equal((await info()).detail,'two-capitals');
    assert.match(await text('.subject-book-label'), /第 2 章 \/ 共 5 章/);
    assert.equal(await js("!document.querySelector('#reading-grab,.chapter-ribbon,#split-globe-bar')"),true);
    assert.equal(await js("document.querySelector('.subject-secondary').querySelector('summary').textContent"),'空间线索');
    await capture('02-mobile-chapter');

    for (const [w,h,mobile,dpr] of [[320,568,true,2],[393,844,true,2],[430,932,true,3],[844,390,true,2],
      [1366,768,false,1],[1920,1080,false,1]]) {
      await size(w,h,mobile,dpr);
      const layout = await js(`(() => {
        const globe=document.querySelector('#globe'), book=document.querySelector('#book'), bar=document.querySelector('#book-bar');
        const b=book.getBoundingClientRect(), body=document.querySelector('#book-body'), p=body.querySelector('.subject-prose > p');
        const css=getComputedStyle(p);
        return {top:b.top,height:b.height,width:b.width,nav:bar.getBoundingClientRect().height,padding:getComputedStyle(bar).paddingTop,
          article:p.getBoundingClientRect().width, font:Number.parseFloat(css.fontSize),leading:Number.parseFloat(css.lineHeight),
          selectable:css.userSelect, paper:getComputedStyle(book).backgroundColor,
          fit:body.clientWidth>=body.scrollWidth,hidden:getComputedStyle(globe).visibility==='hidden',
          inert:globe.inert && globe.hasAttribute('aria-hidden'), still:!__t.globeFramePending && __t.globeSettled,
          touch:[...bar.querySelectorAll('button')].filter(node=>!node.hidden).every(node=>node.offsetWidth>=44 && node.offsetHeight>=44)}; })()`);
      assert.ok(layout.top===0 && layout.height===h && layout.width===w && layout.fit && layout.inert && layout.hidden &&
        layout.still && layout.touch && layout.selectable==='text' && layout.paper==='rgb(246, 242, 233)' &&
        layout.nav<=(mobile && h>w ? 99 : 51) && layout.padding===(mobile && h>w ? '47px' : '0px') &&
        layout.article<=681 && layout.article>=Math.min(w-54,640) && layout.leading/layout.font>=1.8,JSON.stringify({w,h,...layout}));
      assert.equal((await info()).map,1500);
      assert.deepEqual((await info()).explore,explore);
      if (w===1366) await capture('03-desktop-chapter');
      console.log(`${w}×${h} DPR ${dpr}: fullscreen, safe area, column, selectable text, 44px navigation and paused globe passed.`);
    }
    await page.send('DOM.enable');
    await page.send('CSS.enable');
    const { root } = await page.send('DOM.getDocument');
    const { nodeId } = await page.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.subject-prose > p'});
    const { fonts } = await page.send('CSS.getPlatformFontsForNode',{nodeId});
    assert.ok(fonts.some(font=>font.glyphCount>10 && !font.isCustomFont), JSON.stringify(fonts));
    await size(393,844,true,2);

    await bodyAt(.32);
    const initialAnchor = await anchor();
    assert.ok(initialAnchor.block && initialAnchor.top>0);
    await until(async () => /[1-9]\d*%$/.test(await text('#reading-progress')), 'Chapter location was not updated');
    await focus('#reading-index');
    await press('Enter');
    assert.equal((await info()).dir,true);
    assert.match(await text('[aria-current="location"] .chapter-status'), /正在阅读.*上次读到/);
    assert.match(await text('.reading-row[data-reading-detail=mid-ming] .chapter-status'), /入口年份/);
    await press('Escape');
    await assertAnchor(initialAnchor);
    assert.equal(await js('document.activeElement.id'),'reading-index');
    await click('#reading-index');
    await js(`(() => {
      const chapters=__t.reading.subject.chapters;
      chapters.push(...Array.from({length:29},(_,i)=>({...chapters[0],id:'test-chapter-'+i})));
    })()`);
    await click('#reading-back');
    await click('#reading-index');
    assert.equal(await js("document.querySelectorAll('.subject-outline .reading-row').length"),34);
    await placeInView('[data-reading-detail=test-chapter-28]');
    assert.equal(await js(`(() => {
      const r=document.querySelector('[data-reading-detail=test-chapter-28]').getBoundingClientRect();
      return r.bottom<=innerHeight && r.top>document.querySelector('#book-bar').getBoundingClientRect().bottom;
    })()`),true);
    await click('#reading-back');
    await js('__t.reading.subject.chapters.splice(5)');
    await assertAnchor(initialAnchor);
    await click('#reading-index');
    await click('.reading-row[data-reading-detail=mid-ming]');
    assert.equal((await anchor()).top,0);
    await click('#reading-index');
    assert.match(await text('.reading-row[data-reading-detail=two-capitals] .chapter-status'),/上次读到/);
    await click('[data-subject-resume]');
    await assertAnchor(initialAnchor);
    await click('#reading-settings');
    await capture('07-reading-size');
    await click('[data-reading-size=extra]');
    await assertAnchor(initialAnchor);
    await press('Escape');
    assert.equal(await js('document.activeElement.id'),'reading-settings');
    await capture('08-large-text');
    await size(320,568,true,2);
    assert.equal(await js("document.querySelector('#book-body').scrollWidth===document.querySelector('#book-body').clientWidth"),true);
    await assertAnchor(initialAnchor);
    await size(844,390,true,2);
    await assertAnchor(initialAnchor);
    await size(393,844,true,2);
    await assertAnchor(initialAnchor);
    await until(() => js("JSON.parse(localStorage.getItem('globe.session.v1')).read.position.block===__t.reading.position.block"),
      'Reading anchor was not saved');
    await page.close();
    page = await connectBrowser(browser,profile);
    await page.size(393,844,true,2);
    await page.open(url);
    await size(393,844,true,2);
    assert.equal(await js("document.querySelector('#book').dataset.size"),'extra');
    await assertAnchor(initialAnchor);
    assert.deepEqual((await info()).explore,explore);
    await click('#reading-settings');
    await click('[data-reading-size=standard]');
    await press('Escape');
    await assertAnchor(initialAnchor);
    console.log('Ming across three years, real and 34-chapter directories, keyboard, resumable anchors, typography and restart passed.');

    const footnote = '.subject-prose > p .reading-refs a';
    await placeInView(footnote);
    const expectedSource = await js(`(() => {
      const link=document.querySelector('${footnote}'), source=document.querySelector(link.hash);
      const chapter=__t.reading.subject.chapters.find(ch=>ch.id===__t.reading.detail);
      const ref=chapter.paragraphs[0].refs[0];
      return {url:__t.reading.subject.sources.find(source=>source.id===(typeof ref==='string'?ref:ref.sourceId)).url,
        dom:source.href,name:source.textContent.replace(/\\s*↗\\s*$/,'')}; })()`);
    assert.equal(expectedSource.dom,expectedSource.url);
    const beforeNote = await anchor();
    await focus(footnote);
    await press('Enter');
    assert.equal(await text('#footnote-text'),expectedSource.name);
    assert.equal(await js("document.querySelector('#footnote-link').href"),expectedSource.url);
    assert.equal(await js('document.activeElement.id'),'footnote-close');
    await press('Tab',8);
    assert.equal(await js('document.activeElement.id'),'footnote-link');
    await capture('09-source-note');
    await press('Escape');
    assert.equal(await js(`document.activeElement.matches('${footnote}')`),true);
    await assertAnchor(beforeNote);
    const selected = await js(`(() => {
      const p=document.querySelector('.subject-prose > p'), text=p.firstChild;
      const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(12,text.length));
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();
    })()`);
    assert.match(selected,/[^\x00-\x7f]/);
    console.log('Citation target and annotation focus passed.');
    const copied = await page.send('Runtime.evaluate',{userGesture:true,returnByValue:true,expression:`(() => {
      let copied;
      document.addEventListener('copy',event=>{
        copied={value:getSelection().toString(),trusted:event.isTrusted};
        event.preventDefault();
      },{once:true});
      document.execCommand('copy');
      return copied;
    })()`});
    assert.deepEqual(copied.result.value,{value:selected,trusted:true});
    await js('getSelection().removeAllRanges()');
    console.log('Trusted browser copy event passed without writing to the system clipboard.');

    await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const zoomBefore = (await info()).camera[2];
    const fingers = radius => [{x:196-radius,y:350,id:1},{x:196+radius,y:350,id:2}];
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:fingers(32)});
    for (const radius of [42,55,68,82,96]) {
      await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:fingers(radius)});
      await wait(24);
    }
    await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await until(() => js('visualViewport.scale>1.2'),'Native pinch did not zoom the reader');
    assert.equal((await info()).camera[2],zoomBefore);
    assert.equal((await info()).mode,'Read');
    await page.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});

    const scene = '[data-subject-scene=yongle-capitals]';
    await placeInView(scene);
    await capture('04-scene-in-article');
    const sceneAnchor = await anchor();
    for (let pass=0;pass<2;pass++) {
      await click(scene);
      assert.equal((await info()).scene,'yongle-capitals');
      assert.equal((await info()).mode,'Observe');
      if (!pass) await capture('05-independent-observation');
      await click('#event-map-return');
      assert.equal((await info()).detail,'two-capitals');
      assert.equal(await js(`document.activeElement.matches('${scene}')`),true);
      await assertAnchor(sceneAnchor);
    }
    await capture('06-returned-chapter');
    const pin = '[data-pin-scene=yongle-capitals]';
    await placeInView(pin);
    const beforePin = await anchor();
    const place = await js(`document.querySelector('${pin}').dataset.pinPlace`);
    await click(pin);
    assert.equal((await info()).place,place);
    await click('#event-map-return');
    await assertAnchor(beforePin);
    assert.equal(await js(`document.activeElement.matches('${pin}')`),true);

    await click('#reading-index');
    await click('.reading-row[data-reading-detail=fall]');
    assert.match(await text('.subject-chapter-next'), /已到书卷末尾.*返回目录.*上一章/s);
    await click('.subject-chapter-next [data-reading-index]');
    await press('Escape');
    const related = '.reading-connections [data-subject-book=qing]';
    await placeInView(related);
    const beforeCrossBook = await anchor();
    await click(related);
    await click('.reading-row[data-reading-detail=empire]');
    assert.equal((await info()).book,'qing');
    await press('Escape');
    await press('Escape');
    assert.equal((await info()).detail,'fall');
    await assertAnchor(beforeCrossBook);
    await click('#reading-library');
    assert.equal(await js("document.querySelectorAll('#book-body [data-subject-book]').length"),57);
    await capture('10-history-library');
    await click('[data-reading-catalog]');
    assert.equal(await js("document.querySelectorAll('#book-body [data-reading-topic]').length"),28);
    await press('Escape');
    await press('Escape');
    assert.equal((await info()).detail,'fall');
    await click('#reading-exit');
    assert.deepEqual((await info()).explore,explore);
    await click('#sheet-close');
    console.log('Sources, clipboard, native pinch, repeat observation, inline places, sequential and cross-volume navigation passed.');

    const legacy = await js(`(() => {
      const key='globe.session.v1', old=JSON.parse(localStorage.getItem(key));
      old.mode='Read';
      old.read.viewMode='half';
      old.read.trail=[{...old.read,viewMode:'half',detail:'founding',position:{top:0},trail:[]}];
      return JSON.stringify(old);
    })()`);
    const legacyScript = await page.send('Page.addScriptToEvaluateOnNewDocument',
      { source:`localStorage.setItem('globe.session.v1',${JSON.stringify(legacy)})` });
    await page.open(url);
    await page.send('Page.removeScriptToEvaluateOnNewDocument',legacyScript);
    assert.equal((await info()).mode,'Read');
    assert.equal((await info()).detail,'fall');
    assert.equal(await js("document.querySelector('#book').getBoundingClientRect().height===innerHeight"),true);
    assert.ok(await js("!Object.hasOwn(__t.session.serialize().read,'viewMode') && __t.reading.trail.length===1"));
    await click('#reading-exit');

    await click('#sheet-close');
    await js("__t.setYear(1900)");
    await click('#vernier-events');
    await click('[data-event=i-140]');
    await click('[data-place=tianjin]');
    const event = await info();
    await click('#event-map-read');
    assert.equal(await text('#reading-exit'),'返回观察');
    await click('[data-subject-scene=boxer-crisis-1900]');
    assert.equal((await info()).scene,'boxer-crisis-1900');
    await click('#event-map-return');
    assert.equal((await info()).detail,'reforms');
    await click('#reading-exit');
    assert.equal((await info()).place,'tianjin');
    assert.deepEqual((await info()).camera,event.camera);
    await click('#event-map-return');
    await click('[data-world-read=i-140]');
    assert.equal(await text('#reading-exit'),'返回史事');
    await click('#reading-exit');
    assert.equal(await js("document.activeElement.matches('[data-world-read=i-140]')"),true);
    await click('#overlay-close');

    await js(`__t.setLayer('country');__t.setYear(1980);__t.openEntity('country',__t.partition.shapes.find(s=>s.iso==='KZ').id)`);
    assert.equal(await text('#sheet-toc'),'查看地图资料');
    await click('#sheet-toc');
    assert.match(await text('.atlas-reading .lede'), /尚未收录/);
    assert.match(await text('.atlas-reading .reading-sources'),/Natural Earth/);
    await js("document.querySelector('.reading-sources').open=true");
    await capture('11-map-archive');
    assert.deepEqual(await js('window.__errs'),[]);
    console.log('Legacy half-view migration, nested event/scene return, event-list return and map-only archive passed. Installed reader fonts:',fonts.map(font=>font.familyName));
  } finally {
    try { await page?.close(); } finally { http.server.close(); }
  }
}

main().catch(error => { console.error(error); process.exitCode=1; });
