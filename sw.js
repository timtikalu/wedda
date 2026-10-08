// App-Shell offline verfügbar; Wetterdaten: Netzwerk zuerst, bei Funkloch der letzte Stand.
const VERSION = 'wetter-v2.3.4';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/detail.js', 'js/sheet.js', 'js/windmap.js', 'js/data.js', 'js/essence.js', 'js/icons.js', 'js/sky.js', 'js/radar.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];
const API = /(open-meteo\.com|brightsky\.dev|bigdatacloud\.net)/;
const TILES = /server\.arcgisonline\.com/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'wetter-data' && k !== 'wetter-tiles').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = request.url;

  if (API.test(url)) {
    if (/\/radar\?/.test(url)) return; // Radar ist nur frisch sinnvoll
    e.respondWith(fetch(request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open('wetter-data').then(c => c.put(request, copy)); }
      return res;
    }).catch(() => caches.match(request).then(r => r || Response.error())));
    return;
  }

  if (TILES.test(url)) {
    e.respondWith(caches.open('wetter-tiles').then(async c => {
      const hit = await c.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok) c.put(request, res.clone());
      return res;
    }));
    return;
  }

  // App-Shell: Netzwerk zuerst (Updates sofort), nach 3 s bzw. offline aus dem Cache
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const net = fetch(request).then(res => {
      if (res.ok && (url.startsWith(self.location.origin) || url.includes('cdnjs'))) cache.put(request, res.clone());
      return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, 3000));
    try {
      const res = await Promise.race([net, timeout]);
      if (res) return res;
    } catch { /* offline */ }
    return (await cache.match(request, { ignoreSearch: true })) || net;
  })());
});
