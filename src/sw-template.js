/* Generated as sw.js. The browser activates a new worker after old controlled pages close. */
const manifest = /*PRECACHE_MANIFEST*/;
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
