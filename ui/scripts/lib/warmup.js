// ./lib/warmup.js

const WARM_KEY = 'bbn_Warm';
const WARM_TTL = 5 * 60 * 1000; // 5 min

export function warmUpBackend() {
  const last = parseInt(sessionStorage.getItem(WARM_KEY) || '0', 10);
  if (Date.now() - last < WARM_TTL) return;

  return fetch('/api/health')  // direct fetch, not through apiFetch
    .then((response) => {
      console.log(
        `[warm-up] ${response.status}${response.status === 503 ? ' (cold-start)' : ' — ready'}`
      );
      sessionStorage.setItem(WARM_KEY, Date.now());
    })
    .catch(() => {
      console.log('[warm-up] ping failed (network error)');
    });
}