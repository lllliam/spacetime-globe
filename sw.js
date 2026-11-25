/* Generated as sw.js. The browser activates a new worker after old controlled pages close. */
const manifest = {
  "revision": "2a3d63346f79a6e1",
  "entry": "index.html?sg=2a3d63346f79a6e1",
  "resources": [
    {
      "url": "index.html?sg=2a3d63346f79a6e1",
      "integrity": "sha256-KPlCwv04KCJLvIh+31wWfZocFQkjle0qqI9o+mirKA8=",
      "core": true
    },
    {
      "url": "apple-touch-icon.png?v=4",
      "integrity": "sha256-z979MbGwdTFRJGH8wLGSjb+1W3kQTxqYLWyLK0RrX/s=",
      "core": true
    },
    {
      "url": "manifest.webmanifest?v=4",
      "integrity": "sha256-LBNeh35pixMiII7jMYQXu+rj2mFgnu4Oyoh47taO2jw=",
      "core": true
    },
    {
      "url": "favicon-32.png?v=4",
      "integrity": "sha256-5QAzvZHEPxglzVxJ0WeYLB3bJmSAw2X9d5ILfYziCpE=",
      "core": true
    },
    {
      "url": "favicon.ico?v=4",
      "integrity": "sha256-t6jDu//MHVwtH5SMkSLVbjBqbjwM7DmNe/QLojK9A9E=",
      "core": true
    },
    {
      "url": "icon-192.png?v=4",
      "integrity": "sha256-TDPqLT0Fdz0vsIbKqLVc69KZGlp2mrwlohkjhBmq31Q=",
      "core": true
    },
    {
      "url": "icon-512.png?v=4",
      "integrity": "sha256-um1XuwrcAP0v/e1v6jx7X6MgrA6/hLPUcF/EqY4RkWY=",
      "core": true
    },
    {
      "url": "icon-512-maskable.png?v=4",
      "integrity": "sha256-VSYKO7E4sKJx7BrL20YWIK0Ttg1Pl6fao1uMhetjFtI=",
      "core": true
    },
    {
      "url": "data/world.json?sg=8369564100d4b69f",
      "integrity": "sha256-g2lWQQDUtp+RCTN0YXVvfpmOKxTOxJQZ/VvHuZxl1IE=",
      "core": true
    },
    {
      "url": "data/polity.bin.gz?sg=83edfd11bef9d6ec",
      "integrity": "sha256-g+39Eb751uxZ4KVMiKHszDDo8lll+3cRqAyL080tsWc=",
      "core": true
    },
    {
      "url": "data/polity.bin?sg=750a2d15c305282c",
      "integrity": "sha256-dQotFcMFKCzHuFr8IqTF5B+p3PGRKI9HAUN81Zmo8Ms=",
      "core": true
    },
    {
      "url": "data/relief.jpg?sg=9d3c0462bdfbc306",
      "integrity": "sha256-nTwEYr37wwagJzSPBSMJq9t+bi3Fw26obHLWKt+y1GE=",
      "core": true
    },
    {
      "url": "data/earth-detail.jpg?sg=cc15231d43895983",
      "integrity": "sha256-zBUjHUOJWYNBGfdJd/nDe3UyPNF52DlJwOJMDYy+8fw=",
      "core": false
    },
    {
      "url": "data/terrain-4k-v1.png?sg=2e488e8c7b035611",
      "integrity": "sha256-LkiOjHsDVhEJoF5bs2L30Qe+UvFrs1QCms0g8T890CU=",
      "core": false
    }
  ]
};
const scope = new URL(self.registration.scope);
const prefix = 'spacetime-globe:' + encodeURIComponent(scope.pathname) + ':';
const name = prefix + manifest.revision;
const absolute = relative => new URL(relative, scope).href;
const entry = absolute(manifest.entry);
const complete = absolute('.spacetime-core-ready');
const activated = absolute('.spacetime-activated');
const assets = new Map(manifest.resources.map(asset => [absolute(asset.url), asset]));
const core = [...assets].filter(([,asset]) => asset.core);
let preparation;

async function fetchAsset(url, asset) {
  const response = await fetch(url, {cache:'reload', redirect:'error', integrity:asset.integrity});
  if (!response.ok || response.status !== 200) throw new Error('HTTP ' + response.status);
  return response;
}

async function isReady(cache) {
  return Boolean(await cache.match(complete)) && (await Promise.all(core.map(([url])=>cache.match(url)))).every(Boolean);
}

function prepare() {
  if (!preparation) preparation = (async () => {
    const cache = await caches.open(name);
    if (await isReady(cache)) return;
    await cache.delete(complete);
    // Settle all writes before install cleanup, including when one request or put fails.
    const results = await Promise.allSettled(core.map(async ([url,asset]) => {
      if (!await cache.match(url)) await cache.put(url, await fetchAsset(url,asset));
    }));
    const failure = results.find(result=>result.status==='rejected');
    if (failure) throw failure.reason;
    await cache.put(complete, new Response(manifest.revision));
    if (!await isReady(cache)) throw new Error('Incomplete cache');
  })().finally(() => { preparation = null; });
  return preparation;
}

self.addEventListener('install', event => {
  event.waitUntil(prepare().catch(async error => {
    await caches.delete(name);
    throw error;
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(name);
    await cache.put(activated,new Response(manifest.revision));
    for (const key of await caches.keys()) {
      if (key===name || !key.startsWith(prefix) || !/^[a-f0-9]{16}$/.test(key.slice(prefix.length))) continue;
      const retired = await caches.open(key);
      if (await retired.match(activated)) await caches.delete(key);
    }
  })().catch(() => {}));
});

async function serveAsset(url, asset) {
  const cache = await caches.open(name).catch(() => null);
  const hit = await cache?.match(url).catch(() => null);
  if (hit) return hit;
  const response = await fetchAsset(url,asset);
  await cache?.put(url,response.clone()).catch(() => {});
  return response;
}

async function navigate(request) {
  try { return await serveAsset(entry, assets.get(entry)); }
  catch {
    // Evicted old versions can fetch a current page. Its own versioned data URLs
    // and integrity metadata stay independent of the older worker.
    try {
      const response = await fetch(request);
      if (response.ok) return response;
    } catch {}
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>时空地球</title><p>离线资料暂不可用。请联网后重新打开时空地球。</p>',
      {status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
  }
}

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method!=='GET') return;
  const url = new URL(request.url);
  if (url.origin!==scope.origin) return;
  if (request.mode==='navigate' && (url.pathname===scope.pathname || url.pathname===new URL(entry).pathname)) {
    event.respondWith(navigate(request));
  } else if (assets.has(url.href)) {
    event.respondWith(serveAsset(url.href,assets.get(url.href)).catch(() => Response.error()));
  }
});

self.addEventListener('message', event => {
  const type = event.data?.type;
  const port = event.ports[0];
  if (!port || (type!=='offline-status' && type!=='offline-prepare')) return;
  event.waitUntil((async () => {
    const response = {revision:manifest.revision, ready:false};
    try {
      if (type==='offline-prepare') await prepare();
      response.ready = await isReady(await caches.open(name));
    } catch {}
    port.postMessage(response);
  })());
});
