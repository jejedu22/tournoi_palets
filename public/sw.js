// Service worker : met en cache uniquement les fichiers statiques et la page hors-ligne.
// Les pages HTML (authentifiées) ne sont jamais stockées, pour ne rien laisser sur un appareil partagé.
const VERSION = '__VERSION__';
const CACHE = `palets-${VERSION}`;
const ASSETS = [
  '/offline.html',
  `/static/app.css?v=${VERSION}`,
  `/static/app.js?v=${VERSION}`,
  `/static/icon.svg?v=${VERSION}`,
  `/static/icon-192.png?v=${VERSION}`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('palets-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    })));
  }
});
