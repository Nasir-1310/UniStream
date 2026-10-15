// UniStream Downloader service worker: the installed app's offline page.
//
// Pages always come from the network, so a new deploy shows up at once;
// only when there is no connection does a page load get the cached offline
// page instead of the browser's error screen. API calls, the download
// progress stream and file downloads are never touched.
const CACHE = 'unistream-offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)))
      // Start the page request while the worker boots (faster page loads).
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse
        if (preloaded) return preloaded
        return await fetch(event.request)
      } catch {
        const cache = await caches.open(CACHE)
        return (await cache.match(OFFLINE_URL)) || Response.error()
      }
    })(),
  )
})
