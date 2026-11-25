/* Product journey through the real HTML, hit targets and browser input. No app test hook. */
const assert=require('node:assert/strict');
const {mkdirSync,mkdtempSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {setTimeout:wait}=require('node:timers/promises');
const {findBrowser,startServer,until,connectBrowser}=require('./harness');

async function main() {
  const output=process.argv[2];
  const browser=findBrowser();
  assert(browser,'Edge or Chromium is required');
  if(output)mkdirSync(output,{recursive:true});
  const {server,port}=await startServer();
  const url='http://127.0.0.1:'+port+'/';
  const profile=mkdtempSync(join(tmpdir(),'spacetime-product-'));
  let page;
  const js=expression=>page.js(expression);
  const shown=selector=>js('!!document.querySelector('+JSON.stringify(selector)+')?.getClientRects().length');
  const text=selector=>js('document.querySelector('+JSON.stringify(selector)+')?.textContent.trim()');
  const clickAt=async (x,y)=>{
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
  };
  const click=async selector=>{
    await until(()=>shown(selector),'Not visible: '+selector);
    const rect=await js(`(() => {
      const node=document.querySelector(${JSON.stringify(selector)});
      node.scrollIntoView({block:'center',inline:'center'});
      return node.getBoundingClientRect().toJSON();
    })()`);
    await clickAt(rect.x+rect.width/2,rect.y+rect.height/2);
  };
  const key=async (name,code)=>{
    for(const type of ['rawKeyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:code});
  };
  const boot=()=>until(()=>js('Boolean(document.querySelector("#year-num")?.textContent && !document.querySelector("#boot"))'),'Real app startup');
  const shot=async name=>{
    if(!output)return;
    await wait(150);
    const {data}=await page.send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(output,name+'.png'),Buffer.from(data,'base64'));
  };
  const year=async value=>{
    await click('#year');
    await js('document.querySelector("#year-input").select()');
    await page.send('Input.insertText',{text:value});
    await click('#year-form button[type=submit]');
    await until(()=>js('document.querySelector("#year-form").hidden'),'Year form did not submit');
  };
  const snap=()=>js('JSON.parse(localStorage.getItem("globe.session.v1"))');
  const scroll=()=>js('document.querySelector("#book-body").scrollTop');
  const point=async (lon,lat)=>{
    // The page starts at its documented camera; this projects a known coordinate onto the visible globe.
    const l=lon*Math.PI/180-1.65, b=lat*Math.PI/180, radius=768*.34;
    await clickAt(683+radius*Math.cos(b)*Math.sin(l),768*.46-radius*(Math.sin(b)*Math.cos(.42)-Math.cos(b)*Math.cos(l)*Math.sin(.42)));
  };
  try {
    page=await connectBrowser(browser,profile);
    await page.size(1366,768,false,1);
    await page.send('Page.navigate',{url});
    await boot();
    assert.equal(await js('Boolean(window.__t)'),false);
    assert.equal(await text('#year-num'),'1500');
    assert.equal(await text('#year-era'),'历史疆域');
    assert.equal(await js('document.querySelector("#vernier-track").getAttribute("role")'),'slider');
    await shot('01-explore');

    await point(110,34);
    await until(async()=>await text('#sheet-identity-name')==='明朝','Did not pick Ming territory');
    await click('#sheet-toc');
    assert.equal(await text('#reading-title'),'明朝');
    assert.match(await text('.reading-entry-year'),/1500.*成化.*正德/);
    await click('[data-reading-restart]');
    assert.equal(await text('#reading-title'),'黄河决口以后');
    await click('#reading-index');
    await click('.reading-row[data-reading-detail=two-capitals]');
    assert.equal(await text('#reading-title'),'靖难以后，两座都城');
    await shot('02-read');
    const note='.subject-prose > p .reading-refs a';
    await click(note);
    assert.match(await text('#footnote-text'),/建文/);
    assert.equal(await js('document.activeElement.id'),'footnote-close');
    await key('Escape',27);
    assert.equal(await js('document.activeElement.matches('+JSON.stringify(note)+')'),true);
    const plate='[data-subject-scene=yongle-capitals]';
    await js('document.querySelector('+JSON.stringify(plate)+').scrollIntoView({block:"center"})');
    const beforeScene=await scroll();
    await click(plate);
    await click('[data-scene-step="1"]');
    assert.match(await text('#event-map-year'),/1415/);
    await click('#event-map-places summary');
    await click('[data-scene-place=qingjiangpu]');
    assert.match(await text('#event-map-place-note'),/淮安/);
    await click('#event-map-places summary');
    await click('[data-scene-step="2"]');
    assert.match(await text('#event-map-year'),/1421/);
    await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:665,y:340,deltaX:0,deltaY:-140});
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:650,y:340,button:'left',buttons:1,clickCount:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:706,y:357,button:'left',buttons:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:706,y:357,button:'left',buttons:0,clickCount:1});
    await click('#event-map-reset');
    await click('#event-map-sources summary');
    assert.match(await text('#event-map-source-content'),/示意联系.*明史/s);
    await click('#event-map-sources summary');
    await shot('03-observe');
    await click('#event-map-return');
    assert.equal(await text('#reading-title'),'靖难以后，两座都城');
    assert.ok(Math.abs(await scroll()-beforeScene)<3);
    assert.equal(await js('document.activeElement.matches('+JSON.stringify(plate)+')'),true);

    const relation='[data-subject-book=aztec][data-history-relation]';
    await js('document.querySelector('+JSON.stringify(relation)+').scrollIntoView({block:"center"})');
    const beforeBook=await scroll();
    await click(relation);
    assert.match(await text('.subject-book-label'),/阿兹特克/);
    await key('Escape',27);
    assert.equal(await text('#reading-title'),'靖难以后，两座都城');
    assert.ok(Math.abs(await scroll()-beforeBook)<3);
    await click('#reading-exit');
    assert.equal(await text('#year-num'),'1500');
    assert.equal(await text('#sheet-identity-name'),'明朝');
    await click('#sheet-toc');
    assert.equal(await text('#reading-title'),'靖难以后，两座都城');
    await click('#reading-exit');
    await click('#sheet-close');

    await year('前221');
    assert.equal(await text('#year-num'),'前221');
    await point(108,34);
    await until(async()=>await text('#sheet-identity-name')==='春秋与战国','Did not pick the Qin polity in the source map');
    await click('#sheet-toc');
    await click('#reading-library');
    await click('#book-body [data-subject-book=qin]');
    await click('.reading-row[data-reading-detail=first-emperor-system]');
    assert.match(await text('.subject-book-label'),/秦/);
    assert.equal(await text('#year-num'),'前221');
    await click('#reading-exit');
    await click('#sheet-close');

    await year('1842');
    await click('#vernier-events');
    await click('[data-event=i-138]');
    assert.match(await text('#event-map-year'),/1842/);
    await click('#event-map-return');
    assert.equal(await js('document.activeElement.dataset.event'),'i-138');
    await click('#overlay-close');

    await year('1900');
    await click('#vernier-events');
    await click('[data-world-topic=i-140]');
    assert.match(await text('#reading-title'),/义和团|八国联军/);
    await click('#reading-exit');
    await click('#overlay-close');
    await year('1500');
    await point(94,48);
    await until(async()=>await text('#sheet-toc')==='查看地图资料','Map-only entry missing in northern Asia');
    await click('#sheet-toc');
    assert.match(await text('.atlas-reading .lede'),/尚未收录/);
    await click('#reading-exit');
    await click('#sheet-close');
    await until(()=>js('!document.body.classList.contains("sheet-open")'),'Map-only summary did not close');
    await wait(300);
    await point(110,34);
    await until(async()=>await text('#sheet-identity-name')==='明朝','Did not return to Ming after the map-only subject');
    await click('#sheet-toc');
    assert.equal(await text('#reading-title'),'靖难以后，两座都城');
    await until(async()=>(await snap())?.read?.detail==='two-capitals','Reading state not committed');
    const history=await page.send('Page.getNavigationHistory');
    await page.send('Page.navigate',{url:'data:text/html,<title>Previous page check</title>'});
    await until(()=>js('document.title==="Previous page check"'),'Browser did not leave the app');
    await page.send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex].id});
    await boot();
    assert.equal(await text('#reading-title'),'靖难以后，两座都城');
    await page.close();page=null;
    page=await connectBrowser(browser,profile);
    await page.size(1366,768,false,1);
    await page.send('Page.navigate',{url});
    await boot();
    assert.equal(await text('#reading-title'),'靖难以后，两座都城');
    assert.equal(await js('Boolean(window.__t)'),false);
    console.log('Real HTML and CDP input: cold Explore → Ming → notes → Canal phases and camera → return → Aztec → resume, Qin −221, year event map and topic, and restart passed.');
  } finally {
    if(page)await page.close();
    server.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
