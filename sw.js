/**
 * ============================================================
 *  MasterCards — Service Worker
 * ============================================================
 *  Offline-First: precachea el app shell + Font Awesome y sirve
 *  cache-first. Las navegaciones usan network-first con fallback
 *  al índice (para que rutas offline sigan abriendo la app).
 *
 *  ACTUALIZACIÓN AUTOMÁTICA CONDICIONAL:
 *  Solo aplica `skipWaiting()` (y recarga) si la cola de
 *  sincronización (mc_syncQueue) está vacía. Si hay operaciones
 *  offline pendientes, esperamos: una recarga en mitad de una
 *  sync podría perder cambios. La nueva versión queda en
 *  "waiting" y se activará en la próxima oportunidad.
 * ============================================================
 */

const CACHE = 'mastercards-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
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
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => {
        // Si hay cambios offline pendientes, no recargamos las pestañas.
        let pending = 0;
        try {
          pending = JSON.parse(localStorage.getItem('mc_syncQueue') || '[]').length;
        } catch (e) { pending = 0; }
        if (pending === 0) {
          return self.clients.claim();
        }
      })
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
