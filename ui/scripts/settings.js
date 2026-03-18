// ============================================================
// bOOmbOOm.NOW! — Settings page
// ============================================================

(function () {

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function sexClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }

  var wrap = null;

  async function unblock(userId, nickname, btn) {
    btn.disabled = true;
    try {
      await window.Api.unblockUser(userId);
      var card = document.getElementById('block-' + userId);
      if (card) card.remove();
      if (!wrap.querySelector('.bbm-user-card')) renderEmpty();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = err.message || 'Error';
    }
  }

  function renderEmpty() {
    wrap.innerHTML = '<p class="text-muted-bb small">No blocked users.</p>';
  }

  function renderBlocks(blocks) {
    if (!blocks.length) { renderEmpty(); return; }

    wrap.innerHTML = blocks.map(function (b) {
      var cls      = escHtml(sexClass(b.sex));
      var nickname = escHtml(b.nickname || b.userId);
      var reason   = escHtml(b.reason || '');
      var uid      = escHtml(b.userId);
      return [
        '<div class="bbm-user-card mb-2 d-flex align-items-center justify-content-between" id="block-' + uid + '">',
        '  <div>',
        '    <span class="bbm-nick ' + cls + '">' + nickname + '</span>',
        reason ? '    <span class="text-muted-bb small ms-2">' + reason + '</span>' : '',
        '  </div>',
        '  <button class="btn btn-sm btn-bbm-ghost unblock-btn" data-uid="' + uid + '" data-nick="' + nickname + '">Unblock</button>',
        '</div>',
      ].join('');
    }).join('');

    wrap.querySelectorAll('.unblock-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        unblock(btn.dataset.uid, btn.dataset.nick, btn);
      });
    });
  }

  function initDangerZone() {
    var dangerWrap = document.getElementById('dangerZoneWrap');
    var deleteBtn  = document.getElementById('deleteAccountBtn');
    if (!dangerWrap || !deleteBtn) return;

    // Only show for registered users
    if (window.Auth && window.Auth.getToken && window.Auth.getToken()) {
      dangerWrap.style.display = '';
    }

    deleteBtn.addEventListener('click', function () {
      var input = document.getElementById('deleteNicknameInput');
      if (input) input.value = '';
      var confirmBtn = document.getElementById('confirmDeleteBtn');
      if (confirmBtn) confirmBtn.disabled = true;
      new bootstrap.Modal(document.getElementById('deleteConfirmModal')).show();
    });
  }

  async function init() {
    wrap = document.getElementById('blocksWrap');
    if (!wrap) return;

    wrap.innerHTML = '<p class="text-muted-bb small">Loading…</p>';

    try {
      var data = await window.Api.getBlocks();
      renderBlocks(data.blocks || []);
    } catch (err) {
      wrap.innerHTML = '<p class="text-muted-bb small">Could not load blocked users.</p>';
    }

    initDangerZone();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
