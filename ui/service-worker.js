const CACHE_NAME = 'app-v1';
const ASSETS = [
    '/bbn/',
    '/bbn/donate',
    '/bbn/messages',
    '/bbn/favourites',
    '/bbn/profile',
    '/bbn/settings',
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

// Install event: cache all assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS); // FAILS CLEANLY if any asset can't be fetched
        }).then(() => self.skipWaiting())
    );
});

// Activate event: clean up old caches + claim clients
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
    console.log('Service Worker activated');
});

// Fetch event: respond with cache first, network fallback with error handling
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) return response;

                // Catch fetch errors
                return fetch(event.request).catch(err => {
                    console.error('Fetch failed for:', event.request.url, err);

                    // Only fallback for navigation requests (HTML pages)
                    if (event.request.mode === 'navigate') {
                        return caches.match('/bbn/');
                    }
                });
            })
    );
});