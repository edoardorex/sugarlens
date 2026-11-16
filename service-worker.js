const CACHE = 'sugarlens-d98c640921da5b78';
const ASSETS = ["./","./index.html","./manifest.webmanifest","./icon.svg","./icon-192.png","./icon-512.png","./assets/index-xvlqb5Lp.css","./assets/index-h39lxjPU.js","./assets/esm-DDGD1VIp.js","./assets/esm-DSN73KLr.js"];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('sugarlens-') && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // These are static app files; module requests can add an Origin header.
    const cached = await cache.match(event.request.mode === 'navigate' ? new URL('index.html', scope).href : event.request, { ignoreVary: true });
    return cached || fetch(event.request);
  })());
});
