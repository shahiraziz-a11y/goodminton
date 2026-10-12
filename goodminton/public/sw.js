// Goodminton service worker. Match data is always fetched live; only the app
// shell's static files are cached, plus an offline page for when there's no signal.
const STATIC = 'goodminton-static-v1'
const OFFLINE = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(c => c.addAll([OFFLINE, '/icons/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== STATIC).map(k => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)))
    return
  }
  // Hashed build assets never change, so cache-first is safe.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(STATIC).then(c => c.put(req, res.clone()))
      return res
    })))
  }
})
