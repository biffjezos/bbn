// ============================================================
// bOOmbOOm.NOW! — Favourites page module
// ============================================================

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sexAvatarClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }
function sexEmoji(sex)        { return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👤'; }

export async function renderFavourites() {
  const wrap = document.getElementById('favListWrap');
  if (!wrap) return;

  if (!window.Auth.isRegistered()) {
    wrap.innerHTML = `
      <div class="bbm-empty">
        <i class="bi bi-star"></i>
        <p>Log in to see your favourites.</p>
        <button class="btn btn-bbm-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">
          Log In
        </button>
      </div>`;
    return;
  }

  try {
    const { favourites = [] } = await window.Api.getFavourites();

    if (favourites.length === 0) {
      wrap.innerHTML = `
        <div class="bbm-empty">
          <i class="bi bi-star"></i>
          <p>No favourites yet.<br>Tap a user on the map to add them.</p>
        </div>`;
      return;
    }

    const items = favourites.map(f => {
      const cls       = sexAvatarClass(f.sex);
      const emoji     = sexEmoji(f.sex);
      const profileHref = `/profile/view/?uid=${encodeURIComponent(f.userId)}&name=${encodeURIComponent(f.nickname)}`;
      const threadHref  = `/messages/thread/?uid=${encodeURIComponent(f.userId)}&name=${encodeURIComponent(f.nickname)}`;
      const onlineBadge = f.online
        ? '<span class="badge badge-online ms-2">online</span>'
        : '<span class="badge badge-offline ms-2">offline</span>';

      return `
        <div class="fav-item" data-userid="${escHtml(f.userId)}">
          <a href="${profileHref}" class="fav-avatar ${cls}" style="text-decoration:none">${emoji}</a>
          <div class="flex-grow-1 min-w-0">
            <a href="${profileHref}" class="fav-name text-decoration-none text-white">
              ${escHtml(f.nickname)}
            </a>${onlineBadge}
          </div>
          <div class="fav-actions">
            <a href="${threadHref}" class="btn btn-bbm-outline-pink btn-sm" title="Message">
              <i class="bi bi-chat-dots"></i>
            </a>
            <button
              class="btn btn-bbm-ghost btn-sm fav-remove-btn"
              data-userid="${escHtml(f.userId)}"
              title="Remove from favourites"
            >
              <i class="bi bi-star-fill text-pink"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    wrap.innerHTML = items;

    // Remove handlers
    wrap.querySelectorAll('.fav-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await window.Api.removeFavourite(btn.dataset.userid);
          await renderFavourites();
        } catch (err) {
          alert('Error: ' + err.message);
        }
      });
    });

  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger mt-3">${escHtml(err.message)}</div>`;
  }
}
