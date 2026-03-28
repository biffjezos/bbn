// ============================================================
// i18n.js — manages translations for the entire app
// ============================================================

var i18n = (function() {
  var _translations = {};
  var _lang = 'en';

  // Detect browser language (or fallback to en)
  function detectLang() {
    var lang = navigator.language || navigator.userLanguage;
    return (lang ? lang.split('-')[0] : 'en');
  }

  // Load JSON file for the given language
  function load(lang) {
    _lang = lang || detectLang();
    return fetch('/i18n/' + _lang + '.json')
      .then(r => r.ok ? r.json() : fetch('/i18n/en.json').then(r=>r.json()))
      .then(data => { _translations = data; });
  }

  // Access translation by nested key: "btn.login"
  function t(key) {
    return key.split('.').reduce((obj, k) => obj && obj[k], _translations) || key;
  }

  // Replace all elements with data-i18n
  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
  }

  // Optional: manually change language at runtime
  function setLang(lang) {
    return load(lang).then(() => apply());
  }

  return {
    load: load,
    t: t,
    apply: apply,
    setLang: setLang,
    lang: function() { return _lang; }
  };
})();