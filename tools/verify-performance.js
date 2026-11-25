/* Same-browser timing for the pre-Phase-09 build and the engineering candidate. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { buildHarness, findBrowser, startServer, until, connectBrowser } = require('./harness');

async function measure(page, url) {
  const before = await page.js('performance.timeOrigin');
  await page.send('Page.navigate', {url});
  await until(() => page.js('performance.timeOrigin!=='+before+' && !!window.phase09Boot && !!window.phase09History && window.__t?.partition.shapes.some(shape=>shape.ent?.name==="Ming Dynasty")'), 'Boot and historical map did not complete');
  return page.js(`(() => {
    const t=__t, shape=t.partition.shapes.find(s=>s.ent.name==='Ming Dynasty');
    const then=performance.now();
    t.openEntity('polity',shape.id);
    document.querySelector('#sheet-toc').click();
    const book=performance.now()-then;
    if (!t.reading.directory) document.querySelector('#reading-index').click();
    const clock=performance.now();
    document.querySelector('[data-reading-detail=two-capitals]').click();
    const chapter=performance.now()-clock;
    const button=document.querySelector('[data-subject-scene=yongle-capitals]');
    const start=performance.now();
    button.click();
    document.querySelector('#event-map-return').click();
    const roundTrip=performance.now()-start;
    const readerFramePending=t.globeFramePending;
    document.querySelector('#reading-exit').click();
    t.closeSheet();
    return {boot:window.phase09Boot, history:window.phase09History, response:performance.getEntriesByType('navigation')[0].responseEnd,
      htmlBytes:performance.getEntriesByType('navigation')[0].transferSize,
      renderer:t.rendererKind, book, chapter, roundTrip, readerFramePending, polity:t.polityLoaded, year:t.state.year,
      resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/data/')).map(r=>({name:new URL(r.name).pathname,ms:r.duration,bytes:r.transferSize}))};
  })()`);
}

async function main() {
  const [label,output] = process.argv.slice(2);
  assert(label && output, 'Pass the tested commit label and an output JSON path');
  const browser=findBrowser();
  assert(browser,'Edge or Chromium is required');
  const file=buildHarness();
  const html=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,html.replace('</head>',`<script>new MutationObserver((_,observer)=>{
    if(!window.phase09Boot && document.querySelector('#boot.gone')) window.phase09Boot=performance.now();
    if(!window.phase09History && document.querySelector('#year-era')?.textContent==='历史疆域') window.phase09History=performance.now();
    if(window.phase09Boot && window.phase09History) observer.disconnect();
  }).observe(document.documentElement,{attributes:true,childList:true,subtree:true});</script></head>`));
  const {server,port}=await startServer(0,{cacheControl:'public, max-age=300'});
  const url='http://127.0.0.1:'+port+'/_harness.html';
  const cold=[], warm=[];
  try {
    for(let i=0;i<5;i++) {
      const page=await connectBrowser(browser,fs.mkdtempSync(join(tmpdir(),'globe-perf-')));
      try {
        await page.size(1366,768,false,1);
        await page.send('Network.enable');
        await page.send('Network.setBypassServiceWorker',{bypass:true});
        await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'try { localStorage.removeItem("globe.session.v1"); } catch {}'});
        cold.push(await measure(page,url));
        await page.send('Page.navigate',{url:'about:blank'});
        await until(()=>page.js('location.href==="about:blank"'),'Navigation did not settle');
        warm.push(await measure(page,url));
      } finally { await page.close(); }
    }
  } finally { server.close(); }
  for(const item of [...cold,...warm]) assert(item.boot>0 && item.polity && item.year===1500);
  const summarize=samples=>Object.fromEntries(['boot','history','response','book','chapter','roundTrip'].map(key=>{
    const values=samples.map(item=>item[key]).sort((a,b)=>a-b);
    return [key,{median:values[2],slowest:values.at(-1)}];
  }));
  const data={label,browser,environment:'1366×768 DPR 1, Windows Chromium headless, GPU disabled, reduced motion, local HTTP, no network or CPU throttling. Warm repeat in the same browser/profile with HTTP cache, Service Worker bypassed.',cold,warm,summary:{cold:summarize(cold),warm:summarize(warm)}};
  fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
  console.log(JSON.stringify(data.summary));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
