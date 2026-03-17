// ============================================================
// bOOmbOOm.NOW! — map.js
// Map rendering only. Geolocation lives in app.js (GeoModule).
// Only runs when #map exists (index.html).
// Nearby users arrive via 'geo:nearby' CustomEvent pushed from
// the location WebSocket — no HTTP polling here.
// ============================================================

(function () {
  if (!document.getElementById('map')) return;

  let map             = null;
  let canvasRenderer  = null;   // shared canvas renderer — keeps radius circle fast
  let selfMarker      = null;
  let selfCircle      = null;
  let markers         = {};
  let favIds          = new Set();
  let favLines        = {}; // userId → { polyline }
  let lastNearbyUsers = [];
  let meetControl     = null;
  let lastBearing     = null; // cached so bearing survives setIcon() DOM replacement
  let lastSex         = undefined; // cached to avoid redundant setIcon() calls

  // Populated after auth resolves from /tiers/radius/nearby/:tier
  let viewRadius = 0;

  const TILE_URL     = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR    = '&copy; OpenStreetMap contributors &copy; CARTO';
  const DEFAULT_ZOOM = 17;

  // ── Helpers ──────────────────────────────────────────────────

  function markerIcon(sex, accountType) { if (accountType === 'venue') return null; return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊'; }
  function markerClass(sex, accountType) { if (accountType === 'venue') return 'venue'; return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest'; }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    const R    = 6_371_000;
    const toR  = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function fmtDist(m) {
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
  }

  // Geographic bearing self → target, clockwise from north (matches CSS rotate)
  function getBearing(lat1, lon1, lat2, lon2) {
    const toR = d => d * Math.PI / 180;
    const dLon = toR(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toR(lat2));
    const x = Math.cos(toR(lat1)) * Math.sin(toR(lat2)) -
              Math.sin(toR(lat1)) * Math.cos(toR(lat2)) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  // ── Quadratic Bezier curve ────────────────────────────────────
  // Returns interpolated path points + midpoint + tangent at t=0.5
  function bezierCurve(p1, p2, curvature, n) {
    curvature = curvature ?? 0.22;
    n         = n         ?? 40;
    const midLat = (p1[0] + p2[0]) / 2;
    const midLng = (p1[1] + p2[1]) / 2;
    const dLat   = p2[0] - p1[0];
    const dLng   = p2[1] - p1[1];
    // Control point: perpendicular to the chord at midpoint
    const cpLat  = midLat - dLng * curvature;
    const cpLng  = midLng + dLat * curvature;

    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t   = i / n;
      const u   = 1 - t;
      pts.push([
        u * u * p1[0] + 2 * u * t * cpLat + t * t * p2[0],
        u * u * p1[1] + 2 * u * t * cpLng + t * t * p2[1],
      ]);
    }

    // Tangent at t = 0.5 (derivative of quadratic Bezier)
    const t    = 0.5;
    const tLat = 2 * (t - 1) * p1[0] + (2 - 4 * t) * cpLat + 2 * t * p2[0];
    const tLng = 2 * (t - 1) * p1[1] + (2 - 4 * t) * cpLng + 2 * t * p2[1];

    // CSS angle from tangent vector (atan2 in lat/lng space)
    let angle = Math.atan2(tLng, tLat) * 180 / Math.PI;
    // Keep text upright — flip if it would read upside-down
    if (angle > 90)  angle -= 180;
    if (angle < -90) angle += 180;

    return { pts, mid: pts[Math.floor(n / 2)], angle };
  }

  // ── Marker icon ───────────────────────────────────────────────

  function makeLeafIcon(sex, isSelf, accountType) {
    const cls    = 'bbm-marker' + (isSelf ? ' self' : '') + ' ' + markerClass(sex, accountType);
    const size   = isSelf ? 46 : 38;
    const anchor = isSelf ? 23 : 19;
    return L.divIcon({
      html:      `<div class="${cls}" title="${isSelf ? 'You' : ''}">${accountType === 'venue' ? '<i class="bi bi-house-fill"></i>' : markerIcon(sex, accountType)}</div>`,
      className: '',
      iconSize:  [size, size],
      iconAnchor:[anchor, anchor],
    });
  }

  // ── Map init ──────────────────────────────────────────────────

  function initMap(lat, lng) {
    if (map) return;
    if (DEBUG) console.log('[Map] Initialising at', lat, lng);
    map = L.map('map', { center: [lat, lng], zoom: DEFAULT_ZOOM, zoomControl: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    canvasRenderer = L.canvas({ padding: 0.5 });
    placeSelfMarker(lat, lng);
  }

  // ── Self marker + radius circle ───────────────────────────────

  function placeSelfMarker(lat, lng) {
    const sex    = window.Auth?.getSex?.() || null;
    const radius = viewRadius;

    if (selfMarker) {
      selfMarker.setLatLng([lat, lng]);
      // Only rebuild the icon when sex changes — setIcon() replaces the DOM element,
      // wiping CSS variables (including --bbm-bearing) and resetting CSS transitions.
      // Rebuilding on every position update would prevent the compass from stabilising.
      if (sex !== lastSex) {
        lastSex = sex;
        selfMarker.setIcon(makeLeafIcon(sex, true));
        // Reapply cached bearing after DOM replacement.
        if (lastBearing !== null) setSelfBearing(lastBearing);
      }
    } else {
      lastSex = sex;
      selfMarker = L.marker([lat, lng], {
        icon:        makeLeafIcon(sex, true),
        zIndexOffset: -1000,   // render below all other markers so nearby pins stay clickable
      }).addTo(map);
    }

    // Translucent view-radius circle
    if (radius > 0) {
      const clr = sex === 'f' ? '#e8186d' : sex === 'm' ? '#0eb8e8' : '#ffd200';
      if (selfCircle) {
        selfCircle.setLatLng([lat, lng]);
        selfCircle.setRadius(radius);
        selfCircle.setStyle({ color: clr, fillColor: clr });
      } else {
        selfCircle = L.circle([lat, lng], {
          radius,
          color:       clr,
          fillColor:   clr,
          fillOpacity: 0.055,
          weight:      1.5,
          opacity:     0.38,
          interactive: false,
          renderer:    canvasRenderer,  // canvas >> SVG for large circles
        }).addTo(map);
      }
    } else if (selfCircle) {
      map.removeLayer(selfCircle);
      selfCircle = null;
    }
  }

  // ── Nearby markers ────────────────────────────────────────────

  function renderMarkers(users) {
    const seen = new Set();
    users.forEach(u => {
      const ulat = u.lat;
      const ulng = u.lon ?? u.lng;
      seen.add(u.userId);
      if (markers[u.userId]) {
        markers[u.userId].setLatLng([ulat, ulng]);
        return;
      }
      const m = L.marker([ulat, ulng], { icon: makeLeafIcon(u.sex, false, u.accountType) }).addTo(map);
      m.on('click', () => window.openPinModal?.(u));
      markers[u.userId] = m;
    });
    Object.keys(markers).forEach(uid => {
      if (!seen.has(uid)) { map.removeLayer(markers[uid]); delete markers[uid]; }
    });
  }

  // ── Fav connecting lines ──────────────────────────────────────

  function drawFavLines(selfPos, users) {
    if (!window.Auth?.isRegistered()) return;
    const sp       = [selfPos.lat, selfPos.lng];
    const activeIds = new Set();

    users.forEach(u => {
      if (!favIds.has(u.userId)) return;
      const up    = [u.lat, u.lon ?? u.lng];
      const { pts } = bezierCurve(sp, up);
      const favColor = u.sex === 'f'
        ? 'rgba(232,24,109,0.5)'
        : u.sex === 'm'
          ? 'rgba(14,184,232,0.5)'
          : 'rgba(255,255,255,0.3)';

      activeIds.add(u.userId);

      if (favLines[u.userId]) {
        // Update existing line
        favLines[u.userId].polyline.setLatLngs(pts);
      } else {
        // Create new curved polyline
        const polyline = L.polyline(pts, {
          color:     favColor,
          weight:    2,
          dashArray: '8 8',
          className: 'bbm-fav-line',
          interactive: false,
        }).addTo(map);

        favLines[u.userId] = { polyline };
      }
    });

    // Remove lines for users no longer nearby or no longer favs
    Object.keys(favLines).forEach(uid => {
      if (!activeIds.has(uid)) {
        map.removeLayer(favLines[uid].polyline);
        delete favLines[uid];
      }
    });
  }

  // ── Meeting mode ──────────────────────────────────────────────

  function getMeetingState() {
    try { return JSON.parse(localStorage.getItem('bbm_meet') || 'null'); } catch { return null; }
  }

  function updateMeetingMode(selfPos, users) {
    const meet = getMeetingState();

    if (!meet) {
      // No meeting mode — clear pill and reset marker rotation
      if (meetControl) { meetControl.remove(); meetControl = null; }
      setSelfBearing(null);
      return;
    }

    const partner   = users.find(u => u.userId === meet.uid);
    const targetSex = partner?.sex || meet.sex || null;

    // Create pill control if not yet added
    if (!meetControl) {
      meetControl = L.control({ position: 'topright' });
      meetControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'bbm-meet-pill');
        L.DomEvent.disableClickPropagation(div);
        return div;
      };
      meetControl.addTo(map);
    }

    // Update pill contents and apply target sex class for border colour
    const pillEl = meetControl.getContainer();
    pillEl.classList.remove('bbm-meet-pill--male', 'bbm-meet-pill--female');
    if (targetSex === 'm') pillEl.classList.add('bbm-meet-pill--male');
    else if (targetSex === 'f') pillEl.classList.add('bbm-meet-pill--female');
    const distHtml = partner
      ? `<span class="bbm-meet-dist">${fmtDist(haversineM(selfPos.lat, selfPos.lng, partner.lat, partner.lon ?? partner.lng))}</span>`
      : `<span class="bbm-meet-dist bbm-meet-absent">not visible</span>`;

    pillEl.innerHTML =
      `<span class="bbm-meet-icon">🧭</span>` +
      `<span class="bbm-meet-name">${escHtml(meet.nickname)}</span>` +
      distHtml +
      `<button class="bbm-meet-close" title="Cancel meeting">✕</button>`;

    pillEl.querySelector('.bbm-meet-close').addEventListener('click', function () {
      localStorage.removeItem('bbm_meet');
      const pos = window.GeoState?.pos;
      updateMeetingMode(pos || selfPos, lastNearbyUsers);
    });

    // Rotate self marker toward partner
    if (partner) {
      const bearing = getBearing(selfPos.lat, selfPos.lng, partner.lat, partner.lon ?? partner.lng);
      setSelfBearing(bearing);
    } else {
      setSelfBearing(null);
    }
  }

  function setSelfBearing(deg) {
    lastBearing = deg;
    const inner = selfMarker?.getElement()?.querySelector('.bbm-marker');
    if (!inner) return;
    inner.style.setProperty('--bbm-bearing', deg != null ? deg + 'deg' : '0deg');
  }

  // ── Public API ────────────────────────────────────────────────

  function refreshMarkers() {
    const pos = window.GeoState?.pos;
    if (map && pos) placeSelfMarker(pos.lat, pos.lng);
  }

  function centreOnSelf() {
    const pos = window.GeoState?.pos;
    if (map && pos) map.setView([pos.lat, pos.lng], DEFAULT_ZOOM, { animate: true });
  }

  function onGuestExpired() {
    Object.values(markers).forEach(m => map?.removeLayer(m));
    markers = {};
    Object.values(favLines).forEach(fl => {
      map?.removeLayer(fl.polyline);
    });
    favLines = {};
    if (selfMarker) { map?.removeLayer(selfMarker); selfMarker = null; }
    if (selfCircle) { map?.removeLayer(selfCircle); selfCircle = null; }
    if (meetControl) { meetControl.remove(); meetControl = null; }
  }

  function onLogout() {
    Object.values(markers).forEach(m => map?.removeLayer(m));
    markers = {};
    Object.values(favLines).forEach(fl => {
      map?.removeLayer(fl.polyline);
    });
    favLines = {};
    if (meetControl) { meetControl.remove(); meetControl = null; }
    lastNearbyUsers = [];
    favIds = new Set();
    viewRadius = 23_000;  // revert to guest radius immediately
  }

  function refreshSelf() {
    const pos = window.GeoState?.pos;
    if (pos && map) placeSelfMarker(pos.lat, pos.lng);
  }

  // ── Events ────────────────────────────────────────────────────

  window.addEventListener('geo:nearby', function (e) {
    if (!map) { if (DEBUG) console.warn('[Map] geo:nearby fired but map not ready — dropping'); return; }
    lastNearbyUsers = e.detail.users || [];
    if (DEBUG) console.log('[Map] rendering', lastNearbyUsers.length, 'nearby users', lastNearbyUsers);
    renderMarkers(lastNearbyUsers);
    const pos = window.GeoState?.pos;
    if (pos) {
      drawFavLines(pos, lastNearbyUsers);
      updateMeetingMode(pos, lastNearbyUsers);
    }
  });

  window.addEventListener('geo:position', function (e) {
    const { lat, lng } = e.detail;
    if (!map) initMap(lat, lng);
    else placeSelfMarker(lat, lng);
    // If geo:nearby already fired but pos was null at the time, the pill was skipped.
    // Catch that here: only when the pill doesn't exist yet and we have nearby data.
    if (!meetControl && lastNearbyUsers.length) {
      updateMeetingMode({ lat, lng }, lastNearbyUsers);
    }
  });

  // Sync meeting mode changes made from the favourites page
  window.addEventListener('storage', function (e) {
    if (e.key === 'bbm_meet' && map) {
      const pos = window.GeoState?.pos;
      if (pos) updateMeetingMode(pos, lastNearbyUsers);
    }
  });

  window.MapModule = { centreOnSelf, refreshMarkers, onGuestExpired, onLogout, refreshSelf };

  // GeoState may already have a position if geo resolved before map.js ran
  window.__authReady.then(function () {
    const tier = window.Auth?.getTier?.() || 'guest';
    window.Api.getNearbyRadius(tier).then(function (data) {
      // null means Infinity (no cap) — treat as no visible circle
      viewRadius = data.radiusM ?? 0;
      const pos = window.GeoState?.pos;
      if (map && pos) placeSelfMarker(pos.lat, pos.lng);
    }).catch(function () {});

    const pos = window.GeoState?.pos;
    if (pos) initMap(pos.lat, pos.lng);

    // Load favourite IDs for line drawing (registered users only)
    if (window.Auth?.isRegistered()) {
      window.Api.getFavourites().then(function (data) {
        favIds = new Set((data.favourites || []).map(f => f.userId));
      }).catch(function () {});
    }
  });

})();
