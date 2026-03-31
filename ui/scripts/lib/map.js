// map.js
// ============================================================
// bOOmbOOm.NOW! — ES6 Module
// Map rendering only. Geolocation lives in GeoModule.
// Nearby users arrive via 'geo:nearby' CustomEvent pushed from GeoModule.
// ============================================================

import { GeoState } from './geo.js';

let map = null;
let canvasRenderer = null;
let selfMarker = null;
let selfCircle = null;
let markers = {};
let favIds = new Set();
let favOnline = new Map();
let favLines = {};
let lastNearbyUsers = [];
let meetControl = null;
let lastBearing = null;
let lastSex = undefined;
let viewRadius = 0;

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; OpenStreetMap contributors &copy; CARTO';
const DEFAULT_ZOOM = 17;

function getZoom() { return window.BbnPrefs?.mapZoom?.() ?? DEFAULT_ZOOM; }
function showFavPins() { return window.BbnPrefs?.showFavPins?.() ?? true; }

function markerEmoji(sex) { return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊'; }
function markerClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest'; }

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m) { return m < 1000 ? Math.round(m) + ' m' : (m/1000).toFixed(1) + ' km'; }

function getBearing(lat1, lon1, lat2, lon2) {
  const toR = d => d * Math.PI / 180;
  const dLon = toR(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toR(lat2));
  const x = Math.cos(toR(lat1)) * Math.sin(toR(lat2)) - Math.sin(toR(lat1)) * Math.cos(toR(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function bezierCurve(p1, p2, curvature = 0.22, n = 40) {
  const midLat = (p1[0]+p2[0])/2;
  const midLng = (p1[1]+p2[1])/2;
  const dLat = p2[0]-p1[0];
  const dLng = p2[1]-p1[1];
  const cpLat = midLat - dLng*curvature;
  const cpLng = midLng + dLat*curvature;

  const pts = [];
  for (let i=0;i<=n;i++){
    const t = i/n, u = 1-t;
    pts.push([
      u*u*p1[0] + 2*u*t*cpLat + t*t*p2[0],
      u*u*p1[1] + 2*u*t*cpLng + t*t*p2[1]
    ]);
  }

  const t = 0.5;
  const tLat = 2*(t-1)*p1[0] + (2-4*t)*cpLat + 2*t*p2[0];
  const tLng = 2*(t-1)*p1[1] + (2-4*t)*cpLng + 2*t*p2[1];
  let angle = Math.atan2(tLng,tLat)*180/Math.PI;
  if(angle>90) angle-=180;
  if(angle<-90) angle+=180;

  return { pts, mid: pts[Math.floor(n/2)], angle };
}

function makeLeafIcon(sex, isSelf, accountType){
  const isVenue = accountType==='venue';
  const cls = 'bbn-marker' + (isSelf?' self':'') + (isVenue?' venue':' '+markerClass(sex));
  const size = isSelf?46:38;
  const anchor = isSelf?23:19;
  const inner = isVenue?`<i class="bi bi-house-fill"></i>`:markerEmoji(sex);
  return L.divIcon({
    html:`<div class="${cls}" title="${isSelf?'You':''}">${inner}</div>`,
    className:'',
    iconSize:[size,size],
    iconAnchor:[anchor,anchor]
  });
}

function getSelfAccountType() {
  try{
    const t = window.Auth?.getToken?.();
    return t?JSON.parse(atob(t.split('.')[1])).account_type:null;
  } catch { return null; }
}

function initMap(lat,lng){
  if(map) return;
  if(!document.getElementById('map')) return;
  map = L.map('map',{center:[lat,lng], zoom:getZoom(), zoomControl:true});
  L.tileLayer(TILE_URL,{attribution:TILE_ATTR,maxZoom:19}).addTo(map);
  canvasRenderer = L.canvas({padding:0.5});
  placeSelfMarker(lat,lng);
}

function placeSelfMarker(lat,lng){
  const isRegistered = window.Auth?.isRegistered?.();
  const sex = isRegistered ? (window.Auth?.getSex?.() ?? null) : null;
  const accountType = isRegistered ? getSelfAccountType() : null;
  const isVenue = accountType==='venue';
  const radius = viewRadius;

  // Self marker (sex-aware personal icon) — registered users only.
  // Guests are not identified on the map — no personal marker.
  if (!isRegistered) {
    if (selfMarker) { map?.removeLayer(selfMarker); selfMarker = null; }
  } else {
    if(selfMarker){
      selfMarker.setLatLng([lat,lng]);
      if(sex!==lastSex){
        lastSex = sex;
        selfMarker.setIcon(makeLeafIcon(sex,true,accountType));
        if(lastBearing!==null) setSelfBearing(lastBearing);
      }
    } else {
      lastSex = sex;
      selfMarker = L.marker([lat,lng],{
        icon: makeLeafIcon(sex,true,accountType),
        zIndexOffset:-1000
      }).addTo(map);
    }
  }

  // Radius circle — shown for both guests and registered users when viewRadius > 0.
  if(radius>0){
    const clr = isRegistered
      ? (isVenue?'rgba(255,255,255,0.45)':sex==='f'?'#e8186d':sex==='m'?'#0eb8e8':'#ffd200')
      : '#ffd200'; // guest uses neutral yellow
    if(selfCircle){
      selfCircle.setLatLng([lat,lng]);
      selfCircle.setRadius(radius);
      selfCircle.setStyle({color:clr,fillColor:clr});
    } else {
      selfCircle = L.circle([lat,lng],{
        radius, color:clr, fillColor:clr, fillOpacity:0.055, weight:1.5, opacity:0.38, interactive:false, renderer:canvasRenderer
      }).addTo(map);
    }
  } else if(selfCircle){
    map.removeLayer(selfCircle);
    selfCircle=null;
  }
}

function renderMarkers(users){
  const seen = new Set();
  users.forEach(u=>{
    const ulat = u.lat, ulng = u.lon ?? u.lng;
    seen.add(u.userId);
    if(markers[u.userId]){
      markers[u.userId].setLatLng([ulat,ulng]);
      return;
    }
    const m = L.marker([ulat,ulng],{icon:makeLeafIcon(u.sex,false,u.accountType)}).addTo(map);
    m.on('click',()=>window.openPinModal?.(u));
    markers[u.userId] = m;
  });
  Object.keys(markers).forEach(uid=>{
    if(!seen.has(uid)){ map.removeLayer(markers[uid]); delete markers[uid]; }
  });
}

function drawFavLines(selfPos, users){
  if(!window.Auth?.isRegistered()) return;
  if(!showFavPins()){
    Object.keys(favLines).forEach(uid=>{ map.removeLayer(favLines[uid].polyline); delete favLines[uid]; });
    return;
  }
  const sp = [selfPos.lat,selfPos.lng];
  const activeIds = new Set();
  users.forEach(u=>{
    if(!favIds.has(u.userId)) return;
    const up = [u.lat,u.lon ?? u.lng];
    const {pts} = bezierCurve(sp,up);
    const favColor = u.sex==='f'?'rgba(232,24,109,0.5)':u.sex==='m'?'rgba(14,184,232,0.5)':'rgba(255,255,255,0.3)';
    activeIds.add(u.userId);
    if(favLines[u.userId]){ favLines[u.userId].polyline.setLatLngs(pts); }
    else {
      const polyline = L.polyline(pts,{color:favColor,weight:2,dashArray:'8 8',className:'bbn-fav-line',interactive:false}).addTo(map);
      favLines[u.userId]={polyline};
    }
  });
  Object.keys(favLines).forEach(uid=>{
    if(!activeIds.has(uid)){ map.removeLayer(favLines[uid].polyline); delete favLines[uid]; }
  });
}

function getMeetingState(){
  try { return JSON.parse(localStorage.getItem('bbn_meet')||'null'); } catch { return null; }
}

function updateMeetingMode(selfPos, users){
  const meet = getMeetingState();
  if(!meet){ if(meetControl){meetControl.remove();meetControl=null;} setSelfBearing(null); return; }
  const partner = users.find(u=>u.userId===meet.uid);
  const targetSex = partner?.sex ?? null;
  if(!meetControl){
    meetControl = L.control({position:'topright'});
    meetControl.onAdd=function(){
      const div=L.DomUtil.create('div','bbn-meet-pill');
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    meetControl.addTo(map);
  }
  const pillEl = meetControl.getContainer();
  pillEl.classList.remove('bbn-meet-pill--male','bbn-meet-pill--female');
  if(targetSex==='m') pillEl.classList.add('bbn-meet-pill--male');
  else if(targetSex==='f') pillEl.classList.add('bbn-meet-pill--female');

  const distHtml = partner
    ? `<span class="bbn-meet-dist">${fmtDist(haversineM(selfPos.lat,selfPos.lng,partner.lat,partner.lon??partner.lng))}</span>`
    : `<span class="bbn-meet-dist bbn-meet-absent">${favOnline.get(meet.uid)===false?'offline':'out of range'}</span>`;
  pillEl.innerHTML = `<span class="bbn-meet-icon">🧭</span>`+
                      `<span class="bbn-meet-name">${escHtml(meet.nickname)}</span>`+
                      distHtml+
                      `<button class="bbn-meet-close" title="Cancel meeting">✕</button>`;
  pillEl.querySelector('.bbn-meet-close').addEventListener('click',()=>{ 
    localStorage.removeItem('bbn_meet');
    updateMeetingMode(selfPos, lastNearbyUsers);
  });
  if(partner){ setSelfBearing(getBearing(selfPos.lat,selfPos.lng,partner.lat,partner.lon??partner.lng)); }
  else setSelfBearing(null);
}

function setSelfBearing(deg){
  lastBearing=deg;
  const inner=selfMarker?.getElement()?.querySelector('.bbn-marker');
  if(!inner) return;
  inner.style.setProperty('--bbn-bearing',deg!=null?deg+'deg':'0deg');
}

// ── Public API ────────────────────────────────────────────────

function refreshMarkers(){ if(map && GeoState.pos) placeSelfMarker(GeoState.pos.lat,GeoState.pos.lng); }
function centreOnSelf(){ if(map && GeoState.pos) map.setView([GeoState.pos.lat,GeoState.pos.lng],getZoom(),{animate:true}); }
function onGuestExpired(){
  Object.values(markers).forEach(m=>map?.removeLayer(m)); markers={};
  Object.values(favLines).forEach(fl=>map?.removeLayer(fl.polyline)); favLines={};
  if(selfMarker){map?.removeLayer(selfMarker);selfMarker=null;}
  if(selfCircle){map?.removeLayer(selfCircle);selfCircle=null;}
  if(meetControl){meetControl.remove();meetControl=null;}
}
function onLogout(){
  Object.values(markers).forEach(m=>map?.removeLayer(m)); markers={};
  Object.values(favLines).forEach(fl=>map?.removeLayer(fl.polyline)); favLines={};
  if(selfMarker){map?.removeLayer(selfMarker);selfMarker=null;}
  if(selfCircle){map?.removeLayer(selfCircle);selfCircle=null;}
  if(meetControl){meetControl.remove();meetControl=null;}
  lastNearbyUsers=[]; favIds=new Set(); favOnline=new Map();
  lastSex=undefined; viewRadius=0;
  setSelfBearing(null);
  refreshRadius(); // fetch guest tier radius so circle redraws for guest
}
function refreshSelf(){ if(map && GeoState.pos) placeSelfMarker(GeoState.pos.lat,GeoState.pos.lng); }
function refreshRadius(){
  const tier=window.Auth?.getTier?.()||'guest';
  window.Api.getNearbyRadius(tier).then(data=>{
    viewRadius=data.radiusM??0;
    if(map && GeoState.pos) placeSelfMarker(GeoState.pos.lat,GeoState.pos.lng);
  }).catch(()=>{});
}

// ── Event listeners ───────────────────────────────────────────

window.addEventListener('geo:nearby', e=>{
  lastNearbyUsers = e.detail.users || [];
  if(!map) return;
  renderMarkers(lastNearbyUsers);
  if(GeoState.pos){
    drawFavLines(GeoState.pos,lastNearbyUsers);
    updateMeetingMode(GeoState.pos,lastNearbyUsers);
  }
});

window.addEventListener('geo:position', e=>{
  const {lat,lng}=e.detail;
  if(!map) initMap(lat,lng);
  else placeSelfMarker(lat,lng);
  if(lastNearbyUsers.length){
    drawFavLines({lat,lng},lastNearbyUsers);
    updateMeetingMode({lat,lng},lastNearbyUsers);
  }
});

window.addEventListener('storage', e=>{
  if(e.key==='bbn_meet' && map && GeoState.pos) updateMeetingMode(GeoState.pos,lastNearbyUsers);
});

// Called by boomboom.js after auth resolves (avoids window.__authReady timing issues)
function loadFavourites(){
  if(!window.Auth?.isRegistered()) return;
  window.Api.getFavourites().then(data=>{
    favIds=new Set((data.favourites||[]).map(f=>f.userId));
    favOnline=new Map((data.favourites||[]).map(f=>[f.userId,f.online]));
    if(map && GeoState.pos && lastNearbyUsers.length) drawFavLines(GeoState.pos,lastNearbyUsers);
  }).catch(()=>{});
}

export const MapModule = { centreOnSelf, refreshMarkers, onGuestExpired, onLogout, refreshSelf, refreshRadius, loadFavourites };