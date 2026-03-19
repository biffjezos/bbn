// --- Debug console (activate with ?dbg in URL) --------------
(function () {
  if (!window.location.search.includes('dbg')) return;
  var logs = [];
  ['log','warn','error','info'].forEach(function(m){
    var orig = console[m].bind(console);
    console[m] = function(){
      orig.apply(console, arguments);
      var line = '['+m.toUpperCase()+'] ' + Array.from(arguments).map(function(a){
        try { return typeof a==='object' ? JSON.stringify(a) : String(a); } catch(e){ return String(a); }
      }).join(' ');
      logs.push(line);
      var el = document.getElementById('dbgOut');
      if(el) el.textContent = logs.join('\n');
    };
  });
  window.addEventListener('error', function(e){ console.error('Uncaught: '+e.message+' @ '+e.filename+':'+e.lineno); });
  window.addEventListener('unhandledrejection', function(e){ console.error('Promise rejected: '+e.reason); });
  document.addEventListener('DOMContentLoaded', function(){
    var div = document.createElement('div');
    div.innerHTML = '<div id="dbgBox" style="position:fixed;bottom:0;left:0;right:0;max-height:40vh;background:#000;color:#0f0;font-size:11px;font-family:monospace;z-index:99999;overflow-y:auto;border-top:2px solid #0f0;padding:4px"><div style="display:flex;justify-content:space-between;padding:2px 4px"><strong>🐛 DEBUG</strong><button onclick="document.getElementById(\'dbgBox\').style.display=\'none\'">✕</button></div><pre id="dbgOut" style="margin:0;white-space:pre-wrap;word-break:break-all"></pre></div>';
    document.body.appendChild(div);
    console.log('Debug ready — URL: ' + location.href);
  });
})();
// ------------------------------------------------------------
