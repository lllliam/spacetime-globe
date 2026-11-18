// 离线缓存：index.html 网络优先（改完部署下次打开就是新版），数据与图标缓存优先。
const CACHE = 'globe-v16-year-control';
const PRECACHE = [
  './', './index.html', './manifest.webmanifest?v=3', './icon.png?v=3', './icon-192.png?v=3', './icon-512.png?v=3', './favicon.png?v=3',
  './data/world.json', './data/relief.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const networkFirst = (req, fallback) =>
  fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() => caches.match(req).then((hit) => hit || caches.match(fallback)));

const cacheFirst = (req) =>
  caches.match(req).then((hit) => {
    if (hit) return hit;
    return fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    });
  });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(networkFirst(req, url.pathname.endsWith('/index.offline.html') ? './index.offline.html' : './index.html'));
    return;
  }
  e.respondWith(cacheFirst(req));
});
