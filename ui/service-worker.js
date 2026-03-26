const CACHE_NAME = 'app-v1';
const ASSETS = [
    '/bbn/',
    '/bbn/donate',
    '/bbn/messages',
    '/bbn/favourites',
    '/bbn/profile',
    '/bbn/settings',
    '/bbn/assets/icons/1024.png',
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
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
        );

    self.addEventListener('fetch', event => {
        event.respondWith(
            caches.match(event.request)
              .then(response => response || fetch(event.request))
        );
    });
    console.log('Service Worker installed');
});