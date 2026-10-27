// Goodminton service worker. Match data is always fetched live; only the app
// shell's static files are cached, plus an offline page for when there's no signal.
const STATIC = 'goodminton-static-v3'
const OFFLINE = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(c => c.addAll([OFFLINE, '/icons/icon-192.png', '/icons/logo.svg'])))
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

// Push alerts from the server: { title, body, url, tag }.
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Goodminton', body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(data.title || 'Goodminton', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  }))
})

// Tapping an alert opens (or focuses) the app on that match.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
    const same = wins.find(w => w.url === target)
    if (same) return same.focus()
    const any = wins.find(w => new URL(w.url).origin === self.location.origin)
    if (any) return any.navigate(target).then(w => (w || any).focus())
    return self.clients.openWindow(target)
  }))
})
