// ============================================================
// bOOmbOOm.NOW! — BlockModule
// Global block flow. Requires #blockModal in the DOM
// (included in default layout). Works on any page.
// ============================================================

(function () {

  var _pendingUserId   = null;
  var _pendingNickname = null;

  function getModal() {
    return document.getElementById('blockModal');
  }

  function prompt(userId, nickname) {
    _pendingUserId   = userId;
    _pendingNickname = nickname;

    var nameEl = document.getElementById('blockTargetName');
    if (nameEl) nameEl.textContent = nickname || userId;

    var select = document.getElementById('blockReason');
    if (select) select.selectedIndex = 0;

    var errEl = document.getElementById('blockError');
    if (errEl) errEl.classList.add('d-none');

    var modal = getModal();
    if (modal && window.bootstrap) bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  async function submitBlock() {
    var userId     = _pendingUserId;
    var reason     = document.getElementById('blockReason')?.value;
    var errEl      = document.getElementById('blockError');
    var confirmBtn = document.getElementById('blockConfirmBtn');

    if (!userId || !reason) return;
    if (errEl) errEl.classList.add('d-none');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
      await window.Api.blockUser(userId, reason);
      var modal = getModal();
      if (modal && window.bootstrap) bootstrap.Modal.getInstance(modal)?.hide();
      document.dispatchEvent(new CustomEvent('bbm:user-blocked', { detail: { userId: userId } }));
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Could not block user. Try again.';
        errEl.classList.remove('d-none');
      }
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var confirmBtn = document.getElementById('blockConfirmBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', submitBlock);
  });

  window.BlockModule = { prompt: prompt };

})();
