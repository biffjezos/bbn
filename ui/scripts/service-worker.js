const CACHE_NAME = 'app-v1';
const ASSETS = [
    '/index.html',
    '/donate',
    '/messages',
    '/favourites',
    '/profile',
    '/settings',
    '/scripts',
    '/assets',
    '/scripts/app.js',
    '/scripts/api.js',
    '/scripts/auth.js',
    '/scripts/blocks.js',
    '/scripts/crypto-worker.js',
    '/scripts/crypto.js',
    '/scripts/favourites.js',
    '/scripts/geo.js',
    '/scripts/lock.js',
    '/scripts/map.js',
    '/scripts/opaque-client.js',
    '/scripts/opaque-client/opaque_client_wasm.js',
    '/scripts/profile.js',
    '/scripts/settings.js',
    '/scripts/warmup.js',
    '/styles/app.css',
    '/styles/colours.css',
    '/stles/fonts.css'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
        );
    console.log('Service Worker installed');
});