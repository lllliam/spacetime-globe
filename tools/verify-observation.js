const assert = require('node:assert/strict');
const {mkdirSync,mkdtempSync,writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const {setTimeout:wait} = require('node:timers/promises');
const {buildHarness,findBrowser,startServer,connectBrowser,until} = require('./harness');

async function main() {
  const output = process.argv[2];
  if (output) mkdirSync(output,{recursive:true});
  const browser = findBrowser();
  assert(browser,'Edge / Chromium is required');
  buildHarness();
  const offline = pathToFileURL(buildHarness(true)).href;
  const http = await startServer();
  const url = 'http://127.0.0.1:' + http.port + '/_harness.html';
  let page;
  const js = expression=>page.js(expression);
  const click = selector=>js('document.querySelector('+JSON.stringify(selector)+').click()');
  const center = selector=>js('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');
  const text = selector=>js('document.querySelector('+JSON.stringify(selector)+').textContent.trim()');
  const opened = selector=>js('document.querySelector('+JSON.stringify(selector)+').open=true');
  const observe = () => js(`({mode:__t.session.mode, year:__t.state.year, stage:__t.session.observe?.phaseId,
    places:[...(__t.worldEvent?.points?.keys() || [])],routes:__t.worldEvent?.routes.map(r=>r.id),selected:__t.session.observe?.place,
    natural:__t.observationNatural,partition:__t.partition.year,yearExplore:__t.session.explore.year})`);
  const camera = () => js('(({yaw,tilt,zoom,panX,panY})=>[yaw,tilt,zoom,panX,panY])(__t.state)');
  const position = () => js('__t.captureReadingPosition()');
  const pressEscape = () => page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});
  const begin = (book,chapter) => js(`__t.beginReading(null,null,${JSON.stringify(chapter)},__t.subjectBooks.find(b=>b.id===${JSON.stringify(book)}))`);
  const scene = id => '[data-subject-scene=' + id + ']';
  const step = index => click('[data-scene-step="'+index+'"]');
  const capture = async name=>{
    if (!output) return;
    await wait(180);
    const {data} = await page.send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(output,name+'.png'),Buffer.from(data,'base64'));
  };
  try {
    page = await connectBrowser(browser,mkdtempSync(join(tmpdir(),'globe-observation-')));
    await page.size(393,844,true,2);
    await page.open(url);
    await until(()=>js('__t.polityLoaded'),'Historical map did not load');
    const original = await camera();
    await begin('achaemenid','darius-satrapy-royal-road');
    await click(scene('achaemenid-darius'));
    assert.deepEqual((await observe()).places,['susa','persepolis']);
    assert.match(await text('#event-map-question'),/两个/);
    assert.equal(await js('document.querySelector("#event-map-steps").hidden'),true);
    assert.deepEqual((await observe()).routes,[]);
    await capture('01-susa-and-persepolis');
    await pressEscape();
    await click('#reading-exit');

    await begin('ming','two-capitals');
    const plate = scene('yongle-capitals');
    await center(plate);
    const anchor = await position();
    await click(plate);
    assert.deepEqual((await observe()),{mode:'Observe',year:1411,stage:'huitong',places:['qingjiangpu','beijing'],routes:[],selected:null,natural:false,partition:1411,yearExplore:1500});
    assert.equal(await js('document.querySelector("[data-route-precision]")'),null);
    await capture('02-stage-without-route');
    await step(2);
    assert.equal((await observe()).routes.length,2);
    assert.match(await text('#event-map-legend'),/示意联系/);
    assert.match(await text('#event-map-distance'),/地理直线距离/);
    await capture('03-grain-network');
    const explanation = await text('#event-map-note');
    const frameCamera = await camera();
    assert.equal(await js('__t.globeSettled'),true);
    await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:280,y:405,deltaX:0,deltaY:-125});
    await until(async()=>{const next=await camera();return next[2]>frameCamera[2] && Math.abs(next[3])>2;},'Observation wheel did not zoom and pan');
    await click('#event-map-reset');
    assert.deepEqual(await camera(),frameCamera);
    await opened('#event-map-places');
    await click('[data-scene-place=qingjiangpu]');
    assert.equal((await observe()).selected,'qingjiangpu');
    assert.match(await text('#event-map-place-note'),/淮安运道节点/);
    assert.equal(await text('#event-map-note'),explanation);
    await js('document.querySelector("#event-map-places").open=false');
    await capture('04-place-and-stage');
    await click('#event-map-reset');
    assert.deepEqual(await camera(),frameCamera);
    assert.equal((await observe()).year,1421);
    await click('[data-scene-place=qingjiangpu]');
    assert.equal((await observe()).selected,null);
    assert.equal(await text('#event-map-note'),explanation);
    await opened('#event-map-sources');
    assert.match(await text('#event-map-source-content'),/示意联系.*通惠河/s);
    await js(`(() => {const panel=document.querySelector('#event-map-scroll');
      panel.scrollTop = document.querySelector('#event-map-sources summary').getBoundingClientRect().top - panel.getBoundingClientRect().top;
    })()`);
    await capture('05-source-and-precision');
    const rect = await js('document.querySelector("#event-map-panel").getBoundingClientRect().toJSON()');
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:170,y:rect.y+35}]});
    await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:171,y:rect.y+140}]});
    await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.equal((await observe()).mode,'Observe');
    await js('document.querySelector("#event-map-return").click();document.querySelector("#event-map-return").click()');
    assert.equal(await js('document.activeElement.dataset.subjectScene'),'yongle-capitals');
    assert.equal((await position()).blockId,anchor.blockId);
    assert.ok(Math.abs((await position()).top-anchor.top)<3);
    await capture('06-returned-to-text');

    const pin = '[data-pin-scene=yongle-capitals]';
    await center(pin);
    await click(pin);
    assert.equal((await observe()).stage,'qingjiangpu');
    assert.equal((await observe()).selected,'qingjiangpu');
    await step(0);
    assert.equal((await observe()).selected,null);
    await pressEscape();
    assert.equal(await js('document.activeElement.dataset.pinPlace'),'qingjiangpu');

    for (const [w,h,dpr] of [[320,568,2],[393,844,2],[430,932,3],[844,390,2],[1366,768,1],[1920,1080,1]]) {
      await page.size(w,h,w<1000,dpr);
      await js(`document.documentElement.style.setProperty('--safe-t','${w<450?34:0}px');
        document.documentElement.style.setProperty('--safe-b','${w<450?22:0}px');__t.layout()`);
      await click(plate);
      await step(2);
      const geometry = await js(`(() => {
        const panel=document.querySelector('#event-map-panel').getBoundingClientRect();
        const back=document.querySelector('#event-map-return').getBoundingClientRect();
        return {height:panel.height,top:panel.top,back:back.top,left:panel.left,right:panel.right,
          labels:[...document.querySelectorAll('#event-map-points .event-map-point:not([hidden]) button:not([hidden])')]
            .map(n=>n.getBoundingClientRect().toJSON())};
      })()`);
      assert(geometry.height<=h*.39 && geometry.top>h*.59 && geometry.back>=(w<450?34:0) && geometry.left>=0 && geometry.right<=w);
      for(const label of geometry.labels) assert(label.x>=0 && label.right<=w+1 && label.bottom<geometry.top);
      await pressEscape();
    }
    await click('#reading-exit');
    assert.equal((await observe()).year,1500);
    assert.deepEqual((await camera()).slice(0,3),original.slice(0,3));

    await begin('ming','two-capitals');
    const fixture = `({...__t.historicalScenes.get('yongle-capitals'),id:'fixture',steps:[
      {id:'supported',year:1421,title:'历史覆盖',note:'地图加载中'},
      {id:'no-coverage',year:2025,title:'覆盖之外',note:'只用自然底图',routes:[],places:[],focusPolities:[]}]})`;
    await js(`window.releaseMap=__t.holdPolity();__t.openReadingScene(${fixture},document.querySelector('${plate}'));`);
    assert.equal((await observe()).natural,true);
    await step(1);
    await js('window.releaseMap(true)');
    await wait(120);
    assert.equal((await observe()).natural,true);
    assert.equal((await observe()).year,2025);
    assert.deepEqual((await observe()).places,[]);
    assert.deepEqual((await observe()).routes,[]);
    await step(0);
    assert.equal((await observe()).natural,false);
    assert.equal((await observe()).partition,1421);
    await pressEscape();
    await js(`(() => {
      const scene=${fixture};
      const [south,north]=scene.routes;
      scene.routes=[{...south,precision:'attested'},{...north,precision:'approximate'},{...north,id:'unsafe',precision:'legacy'}];
      __t.openReadingScene(scene,document.querySelector('${plate}'));
    })()`);
    assert.deepEqual((await observe()).routes,['south-canal','north-canal']);
    assert.match(await text('#event-map-legend'),/有资料支持的路线.*近似路线/);
    const trace = await js('__t.traceObservationLines()');
    assert(trace.dashes.some(dash=>dash.join(',')==='7,4') && trace.dashes.some(dash=>dash.length===0));
    assert.equal(trace.arrows,0);
    await js(`__t.worldEvent.routes[1].directed=true;__t.worldEvent.routes[1].directionEvidence=[{sourceId:'fixture'}]`);
    assert.ok((await js('__t.traceObservationLines()')).arrows>0);
    await pressEscape();
    await page.send('Network.enable');
    await page.send('Network.setBypassServiceWorker',{bypass:true});
    await page.send('Network.setCacheDisabled',{cacheDisabled:true});
    await page.send('Network.setBlockedURLs',{urls:['*/data/polity.bin.gz','*/data/polity.bin']});
    await js(`__t.forgetPolity();__t.openReadingScene(${fixture},document.querySelector('${plate}'));`);
    await until(()=>js('!!__t.polityFailure'),'Map request did not fail as expected');
    assert.equal((await observe()).natural,true);
    assert.match(await text('#event-map-legend'),/自然地理底图/);
    await page.send('Network.setBlockedURLs',{urls:[]});
    await pressEscape();
    await click('#reading-exit');

    await page.size(1366,768,false,1);
    await begin('ming','silver');
    await click(scene('ming-global-silver'));
    await step(1);
    assert.deepEqual((await observe()).routes,['galleon-ports']);
    assert.match(await text('#event-map-year'),/16 世纪后期/);
    const pacific = await js(`(() => {
      const vectors=__t.resolveRouteVectors(__t.worldEvent.routes[0],__t.worldEvent.points);
      return vectors.every(v=>v.every(Number.isFinite)) && vectors.some(v=>Math.abs(Math.atan2(v[0],v[2]))>3.07);
    })()`);
    assert.equal(pacific,true);
    await capture('07-desktop-pacific');
    await pressEscape();
    await center('.reading-connections [data-subject-book=mughal]');
    assert.equal(await js(`document.querySelector('[data-subject-book=mughal]').closest('section').querySelector('h2').textContent`),'历史比较');
    await capture('08-historical-comparison');
    await click('#reading-exit');

    await begin('ming','two-capitals');
    await center('.reading-connections [data-subject-book=aztec]');
    assert.match(await text('.reading-connections h2'),/同一时期的世界/);
    await capture('09-contemporary');
    await click('#reading-exit');
    await begin('spain-portugal','conquistadors-silver-galleon');
    const relation = '[data-history-relation][data-subject-chapter=silver]';
    await center(relation);
    await opened('.relation-evidence');
    await capture('10-documented-link');
    const before = await position();
    await click(relation);
    assert.equal(await js('__t.reading.detail+":"+__t.reading.year'),'silver:1571');
    await pressEscape();
    assert.equal(await js('__t.reading.bookId'),'spain-portugal');
    assert.equal(await js('document.activeElement.dataset.subjectChapter'),'silver');
    assert.equal(await js('document.querySelector(".relation-evidence").open'),true);
    assert.ok(Math.abs((await position()).top-before.top)<3);
    await click('#reading-exit');

    const pausedChapter = await js(`__t.subjectBooks.find(book=>book.id==='germany-hre').chapters.find(chapter=>
      chapter.sceneRefs?.some(ref=>ref.id==='germany-central-europe')).id`);
    await begin('germany-hre',pausedChapter);
    assert.equal(await js('!!document.querySelector("[data-subject-scene=germany-central-europe]")'),false);
    await click('#reading-exit');
    await js('__t.setYear(1900)');
    await click('#vernier-events');
    await click('[data-world-topic=i-140]');
    await click(scene('boxer-crisis-1900'));
    assert.equal((await observe()).places.length,2);
    await pressEscape();
    assert.equal(await js('__t.reading.topicId+":"+__t.reading.detail'),'china-late-qing:boxers');
    await click('#reading-exit');
    assert.equal(await js('document.activeElement.dataset.worldTopic'),'i-140');
    await click('#overlay-close');
    await js('__t.setYear(1842)');
    await click('#vernier-events');
    await click('[data-event=i-138]');
    assert.equal((await observe()).places.length,6);
    assert.equal((await text('#event-map-return')).trim(),'返回史事');
    await page.open(url);
    assert.equal(await js('document.activeElement.dataset.event'),'i-138');
    assert.equal((await observe()).mode,'Explore');

    await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await page.open(offline);
    await begin('ming','two-capitals');
    await click(plate);
    await step(2);
    assert.equal((await observe()).routes.length,2);
    assert.match(await text('#event-map-source-content'),/大运河/);
    await page.open(offline);
    assert.equal((await observe()).mode,'Read');
    assert.equal(await js('__t.reading.detail'),'two-capitals');
    assert.deepEqual(await js('window.__errs'),[]);
    console.log('Observation browser: six viewports, precise phases and return, sources, date line, asynchronous and unavailable maps, real global relation, event lists, topic observation and offline recovery passed.');
  } finally {
    if (page) await page.close();
    http.server.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
