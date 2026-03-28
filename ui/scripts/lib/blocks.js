// ============================================================
// bOOmbOOm.NOW! — BlockModule (module version)
// ============================================================

let _pendingUserId = null;
let _pendingNickname = null;

function getModal() {
    return document.getElementById('blockModal');
}

export function promptBlock(userId, nickname) {
    _pendingUserId = userId;
    _pendingNickname = nickname;

    const nameEl = document.getElementById('blockTargetName');
    if (nameEl) nameEl.textContent = nickname || userId;

    const select = document.getElementById('blockReason');
    if (select) select.selectedIndex = 0;

    const errEl = document.getElementById('blockError');
    if (errEl) errEl.classList.add('d-none');

    const modal = getModal();
    if (modal && window.bootstrap) bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function submitBlock() {
    const userId = _pendingUserId;
    const reason = document.getElementById('blockReason')?.value;
    const errEl = document.getElementById('blockError');
    const confirmBtn = document.getElementById('blockConfirmBtn');

    if (!userId || !reason) return;
    if (errEl) errEl.classList.add('d-none');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        await window.Api.blockUser(userId, reason);
        const modal = getModal();
        if (modal && window.bootstrap) bootstrap.Modal.getInstance(modal)?.hide();
        document.dispatchEvent(new CustomEvent('bbm:user-blocked', { detail: { userId } }));
    } catch (err) {
        if (errEl) {
            errEl.textContent = err.message || 'Could not block user. Try again.';
            errEl.classList.remove('d-none');
        }
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

// Auto-attach submit handler after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const confirmBtn = document.getElementById('blockConfirmBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', submitBlock);
});