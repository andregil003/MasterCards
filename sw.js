/**
 * ============================================================
 *  MasterCards — Service Worker
 * ============================================================
 *  Offline-First: precachea el app shell + Font Awesome y sirve
 *  cache-first. Las navegaciones usan network-first con fallback
 *  al índice (para que rutas offline sigan abriendo la app).
 *
 *  ACTUALIZACIÓN AUTOMÁTICA:
 *  skipWaiting() en install + clients.claim() en activate para
 *  que la nueva versión tome control de inmediato. La cola de
 *  sincronización (mc_syncQueue) persiste en localStorage y no
 *  se ve afectada por el cambio de SW.
 * ============================================================
 */

const CACHE = 'mastercards-v16';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/config.js',
  './js/i18n.js',
  './js/utils.js',
  './js/store.js',
  './js/auth.js',
  './js/sync-engine.js',
  './js/srs.js',
  './js/ui.js',
  './js/pwa.js',
  './js/qr.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/favicon.png',
  './assets/fontawesome/css/all.min.css',
  './assets/fontawesome/webfonts/fa-solid-900.woff2',
  './assets/fontawesome/webfonts/fa-regular-400.woff2',
  './assets/fontawesome/webfonts/fa-brands-400.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => {
        return Promise.allSettled(
          ASSETS.map((url) => cache.add(url).catch(() => {}))
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo interceptamos requests http(s). Las de chrome-extension:// u otros
  // esquemas no se pueden guardar en Cache API (darían TypeError) y no las
  // necesitamos para el modo offline.
  let protocol = '';
  try { protocol = new URL(req.url).protocol; } catch (e) { protocol = ''; }
  if (protocol !== 'http:' && protocol !== 'https:') return;

  // No cachear peticiones al backend GAS ni a Google OAuth
  const urlStr = req.url;
  if (urlStr.includes('script.google.com') || urlStr.includes('googleapis.com')) return;

  // Navegaciones: network-first con fallback al índice (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Assets: cache-first, con almacenamiento en runtime si se descubren nuevos.
  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // POST (sync al backend) siempre va a la red.
});
