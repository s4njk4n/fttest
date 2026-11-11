/* Fair Tickets: offline helper. Keeps the apps opening on patchy fair Wi-Fi.
   Network first (so updates arrive straight away), falling back to the saved copy. */
const CACHE = 'fair-tickets-v3';
const CORE = [
  './', './index.html', './config.js',
  './shared/app.css', './shared/core.js', './shared/staff.js', './shared/contracts.js',
  './shared/vendor/ethers.umd.min.js', './shared/vendor/jsQR.js', './shared/vendor/qrcode.js',
  './family/', './family/app.js', './booth/', './booth/app.js', './stall/', './stall/app.js',
  './organiser/', './organiser/app.js', './tally/',
  '/assets/fonts/instrument-sans.woff2', '/assets/favicon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('/analytics.js') || url.pathname.endsWith('/goatcounter-count.js')) return;
  const key = url.origin + url.pathname; // one saved copy per page, whatever the ?fair= link
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(req, { signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    } catch (err) {
      const hit = (await cache.match(key)) || (await cache.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      throw err;
    }
  })());
});
