const assert = require('node:assert/strict');
const {mkdirSync, mkdtempSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const {buildHarness, connectBrowser, findBrowser, startServer} = require('./harness');

async function main() {
  const browser = findBrowser();
  assert(browser, 'Edge or Chromium is required');
  const output = process.argv[2];
  if (output) mkdirSync(output,{recursive:true});
  buildHarness();
  const offlineFile = pathToFileURL(buildHarness(true)).href;
  const http = await startServer();
  let page;
  const click = selector => page.js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text = selector => page.js(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
  const begin = (book,chapter) => page.js(`__t.beginReading(null,null,${JSON.stringify(chapter)},__t.subjectBooks.find(item=>item.id===${JSON.stringify(book)}))`);
  const capture = async name => {
    if (!output) return;
    const {data} = await page.send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(output,name+'.png'),Buffer.from(data,'base64'));
  };
  const inspectFootnote = async () => {
    await begin('prc','reform');
    const paragraph = '.subject-prose > p[data-block-id="p-04"]';
    assert.match(await text(paragraph),/1989 年/);
    await page.js(`document.querySelector('${paragraph}').previousElementSibling.scrollIntoView({block:'center'})`);
    await click(paragraph + ' .reading-refs a');
    assert.match(await text('#footnote-text'),/解密|档案/);
    assert.match(await page.js('document.querySelector("#footnote-link").hostname'),/gwu\.edu$/);
  };

  try {
    page = await connectBrowser(browser,mkdtempSync(join(tmpdir(),'globe-editorial-')));
    await page.size(1000,820,false);
    await page.open('http://127.0.0.1:'+http.port+'/_harness.html');
    await inspectFootnote();
    await capture('citation-1989');
    await click('#footnote-close');
    await click('#reading-exit');

    await page.js(`__t.commitYear(__t.yearBounds.max);
      __t.openEntity('country',__t.partition.shapes.find(item=>item.iso==='IN').id)`);
    await click('#sheet-toc');
    assert.match(await text('.reading-cover .reading-note'),/现代印度地图定位/);
    await click('.reading-cover .subject-secondary summary');
    assert.equal(await text('.reading-cover .subject-secondary summary'),'叙事范围与资料');
    assert.match(await text('.reading-cover .subject-secondary[open] p'),/1947 年分治.*刊布边界/);
    await capture('india-map-and-scope');
    await click('#reading-exit');

    await begin('roman','crusades-commercial-bleed-1453');
    assert.match(await text('.subject-prose > p[data-block-id="p-06"]'),/1397 年.*1468 年/);
    const scene = '.subject-scene[data-subject-scene="ottoman-constantinople"]';
    assert.equal(await page.js(`document.querySelector('${scene}').closest('figure').previousElementSibling.dataset.blockId`),'aside-05');
    await click(scene);
    assert.equal(await page.js('__t.session.observe.id'),'ottoman-constantinople');
    assert.match(await page.js('__t.historicalScenes.get("ottoman-constantinople").limit'),/没有绘制 1453 年/);

    await page.send('Network.enable');
    await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await page.open(offlineFile);
    await inspectFootnote();
    assert.deepEqual(await page.js('window.__errs'),[]);
    console.log('Editorial browser: targeted source, map scope, book notice, revised scene anchor and offline footnotes passed.');
  } finally {
    await page?.close();
    await new Promise(resolve=>http.server.close(resolve));
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
