// ./lib/debug.js

let logs = [];

export function initDebugConsole() {
  if (!window.location.search.includes('dbg')) return;

  ['log', 'warn', 'error', 'info'].forEach((m) => {
    const orig = console[m].bind(console);
    console[m] = function (...args) {
      orig.apply(console, args);
      const line = `[${m.toUpperCase()}] ` + args.map((a) => {
        try {
          return typeof a === 'object' ? JSON.stringify(a) : String(a);
        } catch (e) {
          return String(a);
        }
      }).join(' ');

      logs.push(line);
      const el = document.getElementById('dbgOut');
      if (el) el.textContent = logs.join('\n');
    };
  });

  window.addEventListener('error', (e) => {
    console.error(`Uncaught: ${e.message} @ ${e.filename}:${e.lineno}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error(`Promise rejected: ${e.reason}`);
  });

  document.addEventListener('DOMContentLoaded', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="dbgBox" style="position:fixed;bottom:0;left:0;right:0;max-height:40vh;background:#000;color:#0f0;font-size:11px;font-family:monospace;z-index:99999;overflow-y:auto;border-top:2px solid #0f0;padding:4px">
        <div style="display:flex;justify-content:space-between;padding:2px 4px">
          <strong>🐛 DEBUG</strong>
          <button onclick="document.getElementById('dbgBox').style.display='none'">✕</button>
        </div>
        <pre id="dbgOut" style="margin:0;white-space:pre-wrap;word-break:break-all"></pre>
      </div>`;
    document.body.appendChild(div);
    console.log(`Debug ready — URL: ${location.href}`);
  });
}