/* Real Chromium worker lifecycle in a scoped, switchable local preview. */
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdirSync,mkdtempSync,readFileSync,writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join,extname } = require('node:path');
const { ROOT,findBrowser,until,connectBrowser } = require('./harness');

const scope='/spacetime-globe/';
const types={'.html':'text/html; charset=utf-8','.json':'application/json','.js':'text/javascript',
  '.webmanifest':'application/manifest+json','.jpg':'image/jpeg','.png':'image/png'};
const revision = root => JSON.parse(readFileSync(join(root,'index.html'),'utf8')
  .match(/<script id="build-assets"[^>]+>(.*?)<\/script>/)[1]).revision;

async function main() {
  const [prototype,next,output] = process.argv.slice(2);
  const browser=findBrowser();
  assert(prototype && next && browser,'Pass the prototype archive and next-build fixture directories, with Edge or Chromium installed');
  const firstRevision=revision(ROOT), nextRevision=revision(next);
  assert.notEqual(firstRevision,nextRevision);
  let root=prototype, fault=null, online=true, optionalFailures=0, interrupted;
  const findings=[];
  const report=message=>{findings.push(message);console.log(message);};
  const server=createServer((req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if (!online) {req.socket.destroy();return;}
    if (path==='/blank') {res.end('<!doctype html><title>Outside worker scope</title>');return;}
    if (!path.startsWith(scope)) {res.writeHead(404).end();return;}
    const file=path.slice(scope.length)||'index.html';
    if (fault==='http' && file==='data/polity.bin') {res.writeHead(503).end();return;}
    if (fault==='network' && file==='data/polity.bin') {req.socket.destroy();return;}
    if (fault==='interrupt' && file==='data/polity.bin') {interrupted=res;return;}
    if (fault==='stale' && file==='data/world.json') {
      res.writeHead(200,{'Content-Type':'application/json'}).end(readFileSync(join(ROOT,file)));return;
    }
    if (fault==='optional' && /earth-detail|terrain-4k/.test(file)) {optionalFailures++;res.writeHead(503).end();return;}
    try {
      const body=readFileSync(join(root,file));
      res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const entry=origin+scope;
  const outside=origin+'/blank';
  const profile=mkdtempSync(join(tmpdir(),'spacetime-cache-'));
  let page;
  const js=expression=>page.js(expression);
  const asyncJS=async expression=>{
    const result=await page.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(result.result.description);
    return result.result.value;
  };
  const pause=(condition,label)=>until(()=>asyncJS(condition),label);
  const cacheName=id=>'spacetime-globe:'+encodeURIComponent(scope)+':'+id;
  const keyset=()=>asyncJS('caches.keys()');
  const reg='navigator.serviceWorker.getRegistration('+JSON.stringify(scope)+')';
  const boot=()=>until(()=>js('document.querySelector("#year-num") && !document.querySelector("#boot")'),'App did not boot');
  const load=async (url=entry)=>{
    await page.send('Page.navigate',{url});
    await until(()=>js('location.href==='+JSON.stringify(url) + ' && document.readyState==="complete"'),'Navigation did not complete');
    if(url===entry)await boot();
  };
  const build=()=>js('JSON.parse(document.querySelector("#build-assets").textContent).revision');
  const ready=()=>pause('document.querySelector("#offline-status").textContent.includes("已准备")','Offline readiness missing');
  const click=selector=>js('document.querySelector('+JSON.stringify(selector)+').click()');
  const closeView=async()=>{
    await page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await pause('document.querySelector("#view-panel").hidden','View panel did not close');
  };
  const update=()=>asyncJS(reg+'.then(r=>r.update()).then(()=>true)');
  const waiting=()=>pause(reg+'.then(r=>r?.waiting?.state==="installed")','Replacement worker not waiting');
  function candidateCache(id, present) {
    return pause('caches.keys().then(keys=>keys.includes('+JSON.stringify(cacheName(id))+')==='+present+')',
      'Unexpected cache state for '+id);
  }
  async function migrate(nextId) {
    await load(outside);
    await pause(reg+'.then(r=>r?.active?.state==="activated" && !r.waiting)','New worker did not activate');
    await load();
    assert.equal(await build(),nextId);
    await ready();
  }
  async function expectFailedUpdate() {
    await asyncJS(reg+'.then(r=>{window.failedInstall=new Promise(resolve=>r.addEventListener("updatefound",()=>{const w=r.installing;w.addEventListener("statechange",()=>{if(w.state==="redundant"||w.state==="installed")resolve(w.state);});},{once:true}));return true;})');
    await update();
    assert.equal(await asyncJS('window.failedInstall'),'redundant');
    await candidateCache(nextRevision,false);
  }

  try {
    page=await connectBrowser(browser,profile);
    await page.size(393,844,true,2);
    await load();
    // The tracked prototype only auto-registers on HTTPS. Register its exact script for loopback.
    await asyncJS('caches.open("unrelated-before-prototype").then(c=>c.put("/sentinel",new Response("sentinel")))');
    const prototypePrefs=await js(`(() => {
      const view=document.querySelector('#hud-view'), labels=document.querySelector('#toggle-labels'), grid=document.querySelector('#toggle-grid');
      if (!view || !labels || !grid) return null;
      view.click();labels.click();grid.click();
      return localStorage.getItem('globe.display.v4');
    })()`);
    assert(prototypePrefs,'Actual prototype display preference was not written');
    await asyncJS('navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).then(()=>true)');
    await pause('!!navigator.serviceWorker.controller','Legacy worker did not activate');
    assert(!(await keyset()).includes('unrelated-before-prototype'));
    const oldEntries=await asyncJS('caches.open("globe-v24-icons").then(c=>c.keys()).then(keys=>keys.map(x=>x.url))');
    assert(!oldEntries.some(url=>url.includes('polity.bin')),'Expected incomplete prototype precache on its first load');
    report('Prototype cfac746 reproduced incomplete map precache and unscoped activation deletion. Its real UI wrote globe.display.v4.');

    const other=['other-project-assets','spacetime-globe:%2Fother-project%2F:0000000000000000'];
    for(const key of other) await asyncJS('caches.open('+JSON.stringify(key)+').then(c=>c.put("/sentinel",new Response("safe")))');
    root=ROOT;
    fault='optional';
    await update();
    await waiting();
    await candidateCache(firstRevision,true);
    assert(!(await js('document.querySelector("#build-assets")')),'Legacy document must stay active');
    await migrate(firstRevision);
    assert.equal(await js('localStorage.getItem("globe.display.v4")'),prototypePrefs);
    assert.equal(await js('document.querySelector("#toggle-labels").getAttribute("aria-checked")'),'false');
    assert.equal(await js('document.querySelector("#toggle-grid").getAttribute("aria-checked")'),'true');
    for(const key of [...other,'globe-v24-icons'])assert((await keyset()).includes(key));
    report('Legacy → RC retained actual display preferences and old cache, isolated sibling caches, and prepared all core resources even with HD texture failures.');

    await page.send('Network.enable');
    await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await load();
    assert.equal(await build(),firstRevision);
    assert.match(await js('document.querySelector("#year-era").textContent'),/历史疆域/);
    await page.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});

    await asyncJS('caches.open('+JSON.stringify(cacheName(firstRevision))+').then(c=>c.keys().then(keys=>c.delete(keys.find(k=>k.url.includes("/data/world.json")))))');
    await js('document.querySelector("#hud-view").click()');
    await pause('!document.querySelector("#offline-retry").hidden','Deleted core resource still reported as ready');
    await js('document.querySelector("#offline-retry").click()');
    await ready();
    await closeView();
    report('Core eviction changed the status, and retry restored completeness. Offline reload used the full RC snapshot.');

    root=next;
    for(const mode of ['http','stale','network']) {
      fault=mode;
      await expectFailedUpdate();
      assert.equal(await build(),firstRevision);
      await load();
      assert.equal(await build(),firstRevision);
    }
    report('HTTP 503, a disconnected resource request, and the wrong world-data integrity rejected the update. The active RC snapshot still loaded.');

    fault=null;
    const quota=await asyncJS('navigator.storage.estimate().then(x=>x.usage)');
    await page.send('Storage.overrideQuotaForOrigin',{origin,quotaSize:quota+64*1024});
    await expectFailedUpdate();
    await page.send('Storage.overrideQuotaForOrigin',{origin});
    report('An overridden real browser quota rejected a partial install and kept the last usable cache.');

    fault='interrupt';
    await update();
    await until(()=>interrupted,'Update resource did not start');
    await page.close();
    page=null;
    interrupted.destroy();
    online=false;
    page=await connectBrowser(browser,profile);
    await page.size(393,844,true,2);
    await load();
    assert.equal(await build(),firstRevision);
    report('Closing the browser during an incomplete installation left the old version available on a disconnected restart.');

    fault=null;
    online=true;
    await load();
    const peer=await page.send('Target.createTarget',{url:entry+'?peer=1'});
    await pause(reg+'.then(r=>!!r.active)','Active worker missing before multi-tab update');
    await update();
    await waiting();
    await load(outside);
    assert.equal(await asyncJS(reg+'.then(r=>r.waiting?.state)'),'installed');
    await page.send('Target.closeTarget',peer);
    await pause(reg+'.then(r=>!r.waiting && r.active?.state==="activated")','Old tabs released but update did not activate');
    await load();
    assert.equal(await build(),nextRevision);
    await ready();
    await candidateCache(firstRevision,false);
    for(const key of [...other,'globe-v24-icons'])assert((await keyset()).includes(key));
    report('The waiting build could not take over while an older tab was open. Activation retired only the previous activated cache in this scope.');

    await page.close();
    page=null;
    online=false;
    page=await connectBrowser(browser,profile);
    await page.size(393,844,true,2);
    await page.send('Network.enable');
    await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await load();
    assert.equal(await build(),nextRevision);
    assert.equal(await js('document.querySelector("#year-num").textContent'),'1500');
    assert.match(await js('document.querySelector("#year-era").textContent'),/历史疆域/);
    assert.equal(await js('localStorage.getItem("globe.display.v4")'),prototypePrefs);
    await ready();
    for(const [w,h] of [[320,568],[844,390]]) {
      await page.size(w,h,true,2);
      await click('#hud-view');
      assert(await js('document.querySelector("#view-panel").getBoundingClientRect().bottom<=innerHeight'));
      await closeView();
    }
    await page.size(393,844,true,2);
    await click('#hud-view');
    if(output) {
      mkdirSync(output,{recursive:true});
      const {data}=await page.send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(output,'04-offline-ready.png'),Buffer.from(data,'base64'));
    }
    await closeView();
    await page.size(1366,768,false,1);
    await pause('document.querySelector("#globe").getBoundingClientRect().height===768','Desktop viewport did not settle');
    const l=110*Math.PI/180-1.65,b=34*Math.PI/180,r=768*.34;
    const x=1366/2+r*Math.cos(b)*Math.sin(l),y=768*.46-r*(Math.sin(b)*Math.cos(.42)-Math.cos(b)*Math.cos(l)*Math.sin(.42));
    for(const type of ['mousePressed','mouseReleased'])
      await page.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});
    await pause('document.querySelector("#sheet-identity-name").textContent==="明朝"','Cached map did not open Ming');
    await click('#sheet-toc');
    await click('[data-reading-detail=two-capitals]');
    await click('[data-subject-scene=yongle-capitals]');
    await click('[data-scene-step="2"]');
    assert.match(await js('document.querySelector("#event-map-year").textContent'),/1421/);
    await click('#event-map-return');
    await load();
    assert.equal(await js('document.querySelector("#reading-title").textContent'),'靖难以后，两座都城');
    report('Closed and restarted Edge with network disabled and the origin unavailable. The PWA restored its full map and legacy display preferences.');
    report('The cached app opened Ming and the Canal observation and recovered its reading chapter on a second disconnected load.');
    if(output) { mkdirSync(output,{recursive:true}); writeFileSync(join(output,'pwa.json'),JSON.stringify({firstRevision,nextRevision,optionalFailures,findings},null,2)+'\n'); }
  } finally {
    if(page)await page.close();
    server.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
