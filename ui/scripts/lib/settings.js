// ./lib/settings.js

// Preference keys
const PREF_MAP_ZOOM = 'bbn_pref_map_zoom';
const PREF_FAV_PINS = 'bbn_pref_show_fav_pins';

// ── Utilities ─────────────────────────────────────────────
function escHtml(str) { /* ...same as before... */ }
function sexClass(sex) { /* ...same as before... */ }
function parseJwt(token) { /* ...same as before... */ }
function parseBsonDate(val) { /* ...same as before... */ }
function formatDate(date) { /* ...same as before... */ }
function formatRadius(m) { /* ...same as before... */ }
function infoRow(label, value) { /* ...same as before... */ }

// ── Main initialization functions ─────────────────────────
export async function initAccountInfo() { /* ...same as before... */ }
export async function initAppLimits() { /* ...same as before... */ }
export async function initPreferences() { /* ...same as before... */ }
export async function initBlockedUsers() { /* ...wrap + unblock + renderBlocks code... */ }
export function initDangerZone() { /* ...same as before... */ }

// ── Top-level initializer ────────────────────────────────
export async function initSettings() {
  await initAccountInfo();
  await initAppLimits();
  await initPreferences();
  await initBlockedUsers();
  initDangerZone();
}