// ============================================================
// bOOmbOOm.NOW! — service-worker.js
// Full cache + fetch handling with offline fallbacks
// ============================================================

const CACHE_NAME = 'app-v2';
const ASSETS = [
    '/bbn/',
    '/bbn/donate',
    '/bbn/messages',
    '/bbn/favourites',
    '/bbn/profile',
    '/bbn/settings',
    '/bbn/assets/icons/icon-192.png',
    '/bbn/assets/icons/icon-512.png',
    '/bbn/assets/icons/icon-1024.png',
    '/bbn/scripts/app.js',
    '/bbn/scripts/api.js',
    '/bbn/scripts/auth.js',
    '/bbn/scripts/blocks.js',
    '/bbn/scripts/crypto-worker.js',
    '/bbn/scripts/crypto.js',
    '/bbn/scripts/favourites.js',
    '/bbn/scripts/geo.js',
    '/bbn/scripts/lock.js',
    '/bbn/scripts/map.js',
    '/bbn/scripts/opaque-client.js',
    '/bbn/scripts/opaque-client/opaque_client_wasm.js',
    '/bbn/scripts/profile.js',
    '/bbn/scripts/settings.js',
    '/bbn/scripts/warmup.js',
    '/bbn/styles/app.css',
    '/bbn/styles/colours.css',
    '/bbn/styles/fonts.css'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            for (const url of ASSETS) {
                try {
                    await cache.add(url);
                } catch (err) {
                    console.warn('Failed to cache:', url, err);
                }
            }
        }).then(() => self.skipWaiting())
    );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
    console.log('Service Worker activated');
});

// Fetch: cache first, network fallback, robust offline
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) return response;

                return fetch(event.request).catch(err => {
                    console.error('Fetch failed for:', event.request.url, err);

                    // Offline fallback for navigation requests
                    if (event.request.mode === 'navigate') {
                        return caches.match('/bbn/') || new Response('<h1>Offline</h1>', {
                            headers: { 'Content-Type': 'text/html' }
                        });
                    }

                    // Generic fallback for other requests
                    return new Response('', { status: 503, statusText: 'Service Unavailable' });
                });
            })
    );
});
