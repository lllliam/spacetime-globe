/* Browser faults and long-running transitions against the built candidate. */
const assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {setTimeout:wait}=require('node:timers/promises');
const {buildHarness,findBrowser,startServer,until,connectBrowser}=require('./harness');

async function main() {
  const output=process.argv[2];
  const browser=findBrowser();
  assert(browser,'Edge or Chromium is required');
  buildHarness();
  const offline=pathToFileURL(buildHarness(true)).href;
  const {server,port}=await startServer();
  const online='http://127.0.0.1:'+port+'/_harness.html';
  const browserState=mkdtempSync(join(tmpdir(),'spacetime-resilience-'));
  let page;
  const js=expression=>page.js(expression);
  const asyncJS=async expression=>{
    const {result,exceptionDetails}=await page.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(exceptionDetails)throw new Error(result.description);
    return result.value;
  };
  const click=selector=>js('document.querySelector('+JSON.stringify(selector)+').click()');
  const waitFor=(expression,label)=>until(()=>js(expression),label);
  const camera=()=>js('(({year,yaw,tilt,zoom,panX,panY})=>({year,yaw,tilt,zoom,panX,panY}))(__t.state)');
  const reopen=async()=>{await page.close();page=await connectBrowser(browser,browserState);await page.size(1366,768,false,1);};
  const samples={};
  const renderFPS=()=>asyncJS(`new Promise(resolve=>{
    const start=performance.now();
    let frames=0;
    const draw=now=>{
      if(now-start>=1300){resolve(frames*1000/(now-start));return;}
      __t.state.yaw-=.003;
      __t.redraw();
      frames++;
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  })`);
  const enter=()=>js(`__t.beginReading(null,null,'two-capitals',__t.subjectBooks.find(book=>book.id==='ming'))`);
  try {
    page=await connectBrowser(browser,browserState);
    await page.size(1366,768,false,1);
    await page.send('Network.enable');
    await page.send('Network.setBlockedURLs',{urls:['*/data/world.json*']});
    await page.send('Page.navigate',{url:online});
    await waitFor('document.querySelector("#boot-retry") && !document.querySelector("#boot-retry").hidden','World failure did not expose a retry');
    assert.equal(await js('document.activeElement.id'),'boot-retry');
    await page.send('Network.setBlockedURLs',{urls:[]});
    await click('#boot-retry');
    await waitFor('window.__t?.polityLoaded && !document.querySelector("#boot")','Retry did not restore world');

    await page.send('Accessibility.enable');
    const {nodes}=await page.send('Accessibility.getFullAXTree');
    assert(nodes.some(n=>n.role.value==='slider'&&/探索年份/.test(n.name?.value)));
    assert(nodes.some(n=>n.role.value==='button'&&/1500/.test(n.name?.value)));
    assert(nodes.some(n=>n.role.value==='button'&&/地图图层/.test(n.name?.value)));
    await page.send('Accessibility.disable');

    const ext=await js(`(() => {
      const canvas=document.querySelector('#globe');
      const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
      window.phase09Lose=gl?.getExtension('WEBGL_lose_context');
      return !!window.phase09Lose;
    })()`);
    assert(ext,'WebGL context-loss extension unavailable');
    samples.renderer=await js(`(() => {
      const c=document.querySelector('#globe'),gl=c.getContext('webgl2')||c.getContext('webgl');
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL||gl.RENDERER);
    })()`);
    samples.webgl=[];
    samples.canvas2d=[];
    for(let i=0;i<3;i++) samples.webgl.push(await renderFPS());
    const previousCamera=await camera();
    await js('window.phase09Lose.loseContext()');
    await waitFor('__t.rendererKind==="canvas2d" && !document.querySelector("#globe-fallback").hidden','Failed to fall back after context loss');
    assert.deepEqual(await camera(),previousCamera);
    await enter();
    assert.equal(await js('__t.reading.detail'),'two-capitals');
    await click('#reading-exit');
    for(let i=0;i<3;i++) samples.canvas2d.push(await renderFPS());
    await js('window.phase09Lose.restoreContext()');
    await waitFor('__t.rendererKind==="webgl" && document.querySelector("#globe-fallback").hidden','WebGL context did not restore');

    await enter();
    const collect=async()=>{
      await wait(350);
      await page.send('HeapProfiler.collectGarbage');
      return page.send('Memory.getDOMCounters');
    };
    const trips=count=>js(`(() => {
      const begin=performance.now();
      for(let i=0;i<${count};i++){
        const plate=document.querySelector('[data-subject-scene=yongle-capitals]');
        plate.click();
        if(__t.session.mode!=='Observe')return {failure:'enter',i};
        document.querySelector('#event-map-return').click();
        if(__t.session.mode!=='Read'||__t.reading.detail!=='two-capitals'||__t.globeFramePending)return {failure:'return',i};
      }
      return {count:${count},ms:performance.now()-begin};
    })()`);
    assert.equal((await trips(1)).count,1);
    samples.start=await collect();
    samples.roundTrip=[];
    for(const checkpoint of ['mid','end']) {
      const result=await trips(25);
      assert.equal(result.count,25,JSON.stringify(result));
      samples.roundTrip.push(result);
      samples[checkpoint]=await collect();
    }
    assert(samples.end.documents<=samples.start.documents+1,JSON.stringify(samples));
    assert(samples.end.nodes<=samples.mid.nodes+20,JSON.stringify(samples));
    assert(samples.end.jsEventListeners<=samples.mid.jsEventListeners+10,JSON.stringify(samples));
    await page.send('Page.setWebLifecycleState',{state:'frozen'});
    await wait(1000);
    await page.send('Page.setWebLifecycleState',{state:'active'});
    assert.equal(await js('__t.reading.detail'),'two-capitals');
    assert.equal(await js('__t.globeFramePending'),false);
    await click('#reading-exit');
    await reopen();
    const noInflater=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.DecompressionStream=undefined'});
    await page.open(online);
    assert.equal(await js('__t.pk && __t.polityLoaded'),true);
    assert(await js('performance.getEntriesByType("resource").some(r=>new URL(r.name).pathname.endsWith("/polity.bin"))'));

    await page.send('Network.enable');
    await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await page.open(offline);
    assert.equal(await js('__t.polityLoaded'),true);
    assert.equal(await js('performance.getEntriesByType("resource").some(r=>!r.name.startsWith("data:"))'),false);
    await page.send('Page.removeScriptToEvaluateOnNewDocument',noInflater);
    assert.deepEqual(await js('window.__errs'),[]);

    await page.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:2*1024*1024,uploadThroughput:1024*1024});
    await page.open(online);
    await click('#hud-view');
    await click('[data-view=modern]');
    await click('#view-shade');
    await js('__t.saveVisibleSession()');
    let delayed;
    page.events.set('Fetch.requestPaused',event=>{ delayed=event.requestId; });
    await page.send('Fetch.enable',{patterns:[{urlPattern:'*/data/polity.bin.gz*',requestStage:'Request'}]});
    await page.open(online);
    await click('#hud-view');
    await click('[data-view=history]');
    await click('#view-shade');
    await until(()=>delayed,'No actual map request was intercepted');
    await js('__t.setYear(1400);__t.setYear(1600)');
    assert.equal(await js('__t.polityLoaded'),false);
    await enter();
    assert.equal(await js('__t.reading.year'),1600);
    await click('#reading-exit');
    assert.equal(await js('__t.state.year'),1600);
    await page.send('Fetch.continueRequest',{requestId:delayed});
    await waitFor('__t.polityLoaded && __t.partition.year===1600','Late map data did not use the latest year');
    await page.send('Fetch.disable');
    assert.deepEqual(await js('window.__errs'),[]);
    samples.slowNetwork={latencyMs:150,downloadBytesPerSecond:2*1024*1024,years:[1400,1600],returned:1600};
    if(output)writeFileSync(output,JSON.stringify(samples,null,2)+'\n');
    console.log('Real WebGL loss/restore and Canvas2D, world retry, AX names, 50 returns, freeze/resume, raw polity fallback, disconnected file:// and late map data passed.');
    console.log(JSON.stringify(samples));
  } finally {
    if(page)await page.close();
    server.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
