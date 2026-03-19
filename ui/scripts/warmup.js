// Pre-warm all backend services (they may be sleeping on Railway free tier).
// Skipped if already pinged in this browser session (sessionStorage flag).
(function () {
  var WARM_KEY = 'bbm_warm';
  var WARM_TTL = 5 * 60 * 1000; // 5 min — re-warm if tab is idle for a long time
  var last = parseInt(sessionStorage.getItem(WARM_KEY) || '0', 10);
  if (Date.now() - last < WARM_TTL) return;
  fetch((window.BOOMBOOM_API_URL) + '/health')
    .then(function (r) {
      console.log('[warm-up] ' + r.status + (r.status === 503 ? ' (cold-start)' : ' — ready'));
      sessionStorage.setItem(WARM_KEY, Date.now());
    })
    .catch(function () { console.log('[warm-up] ping failed (network error)'); });
})();
