import {DEFAULT_FIREBASE_CONFIG} from './js/config.js';
import {connectRallySync, isSyncConfigured} from './js/api/rally-sync.js';
import {createPlayerApi} from './js/api/players.js';
import {pad2, calculateCastle, calculateDeparture} from './js/domain/timing.js';
import {lookupMarchTime} from './js/domain/march.js';
import {initLandingPage} from './js/ui/landing.js?v=20261024-refresh';
import {initSwitchPage} from './js/ui/switch.js?v=20261024-fast';

// UI composition root: DOM events, local settings and presentation state.
// Network transports and time formulas live in js/api and js/domain.
/* ======= ヘルパ ======= */

/* ======= 集結主名簿：Firebase Realtime Database でリアルタイム同期 =======
   指示役が現在入力している集結主名だけを候補として共有する。 */
let LIVE_MEMBER_ROSTER = [];
let rosterPublishTimer = null;
let firebaseRosterUnsubscribe = null;

/* ======= スイッチモードの行軍秒数一覧（時間編集ボトムシートと共有） ======= */
const SWITCH_MARCH_SECONDS = Object.freeze([55,50,45,40,39,36,35,33,32,30]);
const FROM_NOW_SECONDS = Object.freeze([30,40,60,80,90]);
const swRallyMinSel = document.getElementById('sw-rally-min');
const swFromNowInput = document.getElementById('sw-from-now');

function canonicalRosterName(name){
  const raw = String(name || '').trim();
  if(!raw) return null;
  const normalized = raw.toLocaleLowerCase('ja-JP');
  return LIVE_MEMBER_ROSTER.find(member => member.toLocaleLowerCase('ja-JP') === normalized) || raw;
}

function rosterFirebaseKey(name){
  const canonical = canonicalRosterName(name);
  return canonical ? encodeURIComponent(canonical) : null;
}

function getCurrentDirectorRoster(){
  const seen = new Set();
  return Array.from(document.querySelectorAll('#players .member-row .name-text'))
    .map(el => (el.textContent || '').trim())
    .filter(name => {
      if(!name) return false;
      const key = name.toLocaleLowerCase('ja-JP');
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function refreshDeviceMemberOptions(){
  const selects = [document.getElementById('quick-device-member-select')].filter(Boolean);
  const current = localStorage.getItem('arrivalDeviceMemberName') || localStorage.getItem('rallyMemberId') || '';
  selects.forEach(select => {
    const selected = select.value || current;
    select.innerHTML = '';
    select.add(new Option('未設定', ''));
    LIVE_MEMBER_ROSTER.forEach(name => select.add(new Option(name, name)));
    if(LIVE_MEMBER_ROSTER.includes(selected)) select.value = selected;
  });
  if(current && LIVE_MEMBER_ROSTER.length && !LIVE_MEMBER_ROSTER.includes(current)){
    localStorage.removeItem('arrivalDeviceMemberName');
    localStorage.removeItem('rallyMemberId');
  }
  updateDeviceRegistrationUi();
}

function scheduleRosterPublish(){
  clearTimeout(rosterPublishTimer);
  rosterPublishTimer = setTimeout(publishCurrentRoster, 180);
}

async function publishCurrentRoster(){
  if(!firebaseSync) return;
  const roster = getCurrentDirectorRoster();
  try{
    await firebaseSync.publishRoster(roster);
  }catch(error){
    console.warn('集結主名簿を同期できませんでした', error);
  }
}

function subscribeLiveRoster(){
  if(!firebaseSync) return;
  if(firebaseRosterUnsubscribe) firebaseRosterUnsubscribe();
  firebaseRosterUnsubscribe = firebaseSync.subscribeRoster(names => {
    LIVE_MEMBER_ROSTER = names;
    refreshDeviceMemberOptions();
    if(currentInput) showAutocomplete(currentInput, getSuggestions((currentInput.textContent || '').trim()));
  });
}


/* 既存のSmart-testと同じFirebase Realtime Databaseを再利用 */
const FIREBASE_CONFIG = window.ARRIVAL_FIREBASE_CONFIG || DEFAULT_FIREBASE_CONFIG;

let firebaseSync = null;
let firebaseMemberUnsubscribe = null;
let currentRemoteDeparture = null;
let utcPipLastDeparture = null;

function firebaseNow(){
  return firebaseSync ? firebaseSync.now() : Date.now();
}

function firebaseIsConfigured(){
  return isSyncConfigured(FIREBASE_CONFIG);
}

function getRegisteredDeviceMember(){
  const currentName = canonicalRosterName(localStorage.getItem('arrivalDeviceMemberName'));
  if(currentName) return currentName;
  const legacyName = canonicalRosterName(localStorage.getItem('rallyMemberId'));
  if(legacyName){
    localStorage.setItem('arrivalDeviceMemberName', legacyName);
    return legacyName;
  }
  return null;
}

function updateDeviceRegistrationUi(){
  const registeredName = getRegisteredDeviceMember();
  const settingsButton = document.getElementById('app-settings-button');
  const quickName = document.getElementById('quick-sync-name');
  const quickSelect = document.getElementById('quick-device-member-select');
  if(quickSelect) quickSelect.value = registeredName || '';
  if(quickName) quickName.textContent = registeredName || '未設定';
  settingsButton?.classList.toggle('registered', Boolean(registeredName));
}

function clearDeviceCountdown(options = {}){
  currentRemoteDeparture = null;
  /* 時間切れのときだけ、0秒の残り表示をしばらく残す */
  if(!options.keepPipHold) utcPipLastDeparture = null;
}

function updateDeviceCountdown(){
  if(!currentRemoteDeparture) return;
  const remainingMs = currentRemoteDeparture.departureTime - firebaseNow();
  if(remainingMs > 0) return;
  const expiredKey = currentRemoteDeparture.key;
  clearDeviceCountdown({keepPipHold:true});
  if(firebaseSync && expiredKey){
    firebaseSync.removeMember(expiredKey).catch(()=>{});
  }
}

function subscribeRegisteredMember(){
  if(firebaseMemberUnsubscribe){
    firebaseMemberUnsubscribe();
    firebaseMemberUnsubscribe = null;
  }
  clearDeviceCountdown();
  const name = getRegisteredDeviceMember();
  const key = rosterFirebaseKey(name);
  if(!firebaseSync || !key) return;
  firebaseMemberUnsubscribe = firebaseSync.subscribeMember(key, value => {
    const departureTime = value?.departureTime;
    if(!value || (value.name && value.name !== name) || !Number.isFinite(departureTime)){
      clearDeviceCountdown();
      return;
    }
    if(departureTime <= firebaseNow()){
      clearDeviceCountdown();
      firebaseSync.removeMember(key).catch(()=>{});
      return;
    }
    currentRemoteDeparture = {key, name, departureTime};
    updateDeviceCountdown();
  });
}

async function initializeFirebaseSync(){
  updateDeviceRegistrationUi();
  if(!firebaseIsConfigured()) return;
  try{
    firebaseSync = await connectRallySync(FIREBASE_CONFIG);
    updateDeviceRegistrationUi();
    subscribeLiveRoster();
    subscribeRegisteredMember();
  }catch(error){
    console.warn('Firebase同期を開始できませんでした', error);
    showToast('Firebaseへ接続できません。設定と通信状態を確認してください。');
  }
}

async function publishRosterDepartureTimes(rowData){
  if(!firebaseSync) return;
  const departures = rowData.map(item => {
    const enteredName = (item.row.querySelector('.name-text')?.textContent || '').trim();
    const name = canonicalRosterName(enteredName);
    return {key:rosterFirebaseKey(name), name, departureTime:item.depTime};
  }).filter(item => item.name && item.key);
  try{
    await firebaseSync.publishDepartures(departures, LIVE_MEMBER_ROSTER.map(rosterFirebaseKey));
  }catch(error){
    console.warn('出発時刻を同期できませんでした', error);
    showToast('Firebase同期に失敗しました');
  }
}

const quickDeviceMemberSelect = document.getElementById('quick-device-member-select');


/* app-settings-button は時計横クイックメニューを開く */
const appSettingsButton = document.getElementById('app-settings-button');
const clockQuickMenu = document.getElementById('clock-quick-menu');
const quickSyncBtn = document.getElementById('quick-sync-btn');
const quickThemeBtn = document.getElementById('quick-theme-btn');
const deviceSyncModal = document.getElementById('device-sync-modal');
const deviceShortcutBtn = document.getElementById('device-shortcut-btn');
const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if(deviceShortcutBtn) deviceShortcutBtn.hidden = !isAppleMobile;

function setClockQuickMenu(open){
  if(!clockQuickMenu || !appSettingsButton) return;
  clockQuickMenu.classList.toggle('show', open);
  clockQuickMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
  appSettingsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  if(!open) clockQuickMenu.classList.remove('theme-open');
}

function openDeviceSync(){
  updateDeviceRegistrationUi();
  setClockQuickMenu(false);
  deviceSyncModal?.classList.add('show');
  if(deviceSyncModal){
    deviceSyncModal.style.visibility='visible';
    deviceSyncModal.style.pointerEvents='auto';
    deviceSyncModal.setAttribute('aria-hidden','false');
  }
  document.body.classList.add('modal-open');
}

function closeDeviceSync(){
  deviceSyncModal?.classList.remove('show');
  if(deviceSyncModal){
    deviceSyncModal.style.visibility='';
    deviceSyncModal.style.pointerEvents='';
    deviceSyncModal.setAttribute('aria-hidden','true');
  }
  document.body.classList.remove('modal-open');
  appSettingsButton?.focus();
}

appSettingsButton?.addEventListener('click', (event)=>{
  event.stopPropagation();
  updateDeviceRegistrationUi();
  setClockQuickMenu(!clockQuickMenu?.classList.contains('show'));
});
clockQuickMenu?.addEventListener('click', event=>event.stopPropagation());
document.addEventListener('click', ()=>setClockQuickMenu(false));
document.addEventListener('keydown', event=>{
  if(event.key === 'Escape'){
    setClockQuickMenu(false);
    if(deviceSyncModal?.classList.contains('show')) closeDeviceSync();
    closeThemeMenu();
  }
});
quickSyncBtn?.addEventListener('click', openDeviceSync);
deviceShortcutBtn?.addEventListener('click', ()=>{ location.href = 'https://www.icloud.com/shortcuts/4bd84513d0b3477ab6dca92e824cc7e7'; });
const themeOptions = Array.from(document.querySelectorAll('[data-theme-choice]'));
const quickThemeBack = document.getElementById('quick-theme-back');
const THEME_KEY = 'rallyThemeV3';
function normalizeTheme(theme){
  return theme === 'dark' ? 'dark' : 'light';
}
function applyTheme(theme,persist=true){
  const selected=normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme',selected);
  document.documentElement.style.colorScheme = selected === 'dark' ? 'dark' : 'light';
  document.body.setAttribute('data-theme',selected);
  themeOptions.forEach(btn=>btn.setAttribute('aria-checked',btn.dataset.themeChoice===selected?'true':'false'));
  if(persist) localStorage.setItem(THEME_KEY,selected);
  updateThemeMeta();
}
function updateThemeMeta(){
  const meta=document.querySelector('meta[name="theme-color"]');
  if(!meta) return;
  const selected=document.body.getAttribute('data-theme');
  const colors={light:'#F2F2F7',dark:'#101014'};
  meta.setAttribute('content',colors[selected] || colors.light);
}
function openThemeMenu(){ clockQuickMenu?.classList.add('theme-open'); }
function closeThemeMenu(){ clockQuickMenu?.classList.remove('theme-open'); }
quickThemeBtn?.addEventListener('click',openThemeMenu);
quickThemeBack?.addEventListener('click',closeThemeMenu);
themeOptions.forEach(btn=>btn.addEventListener('click',()=>applyTheme(btn.dataset.themeChoice,true)));
applyTheme(window.__initialTheme || localStorage.getItem(THEME_KEY) || localStorage.getItem('rallyThemeV2') || localStorage.getItem('rallyThemeV1'),false);
document.getElementById('device-sync-close')?.addEventListener('click', closeDeviceSync);
document.getElementById('device-sync-save')?.addEventListener('click', ()=>{
  const selectedName = canonicalRosterName(quickDeviceMemberSelect?.value);
  if(selectedName) localStorage.setItem('arrivalDeviceMemberName', selectedName);
  else localStorage.removeItem('arrivalDeviceMemberName');
  updateDeviceRegistrationUi();
  subscribeRegisteredMember();
  closeDeviceSync();
  showToast(selectedName ? `${selectedName}で端末登録しました` : '端末登録を解除しました');
});

setInterval(updateDeviceCountdown, 1000);
initializeFirebaseSync();

/* ======= UTC時計 ======= */
const utcClockTrigger = document.getElementById('utc-clock-trigger');
const utcClockOverlay = document.getElementById('utc-clock-overlay');
const utcClockOverlayClose = document.getElementById('utc-clock-overlay-close');
const utcPipCanvas = document.getElementById('utc-pip-canvas');
const utcPipVideo = document.getElementById('utc-pip-video');
const utcPipContext = utcPipCanvas?.getContext('2d');
let utcPipWindow = null;
let utcVideoPipStream = null;

/* PiPの比率。5.5 = 5.5:1 の細い横長バー。もっと平たくしたい場合は 6 などに変える */
const UTC_PIP_ASPECT = 5.5;
const UTC_PIP_BASE_HEIGHT = 180;
const UTC_PIP_HOLD_MS = 700;
const UTC_PIP_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';

if(utcPipCanvas){
  utcPipCanvas.width = Math.round(UTC_PIP_BASE_HEIGHT * UTC_PIP_ASPECT);
  utcPipCanvas.height = UTC_PIP_BASE_HEIGHT;
}

/* 60秒以上は分秒、59秒以下は秒だけで表す */
function formatRemainingSeconds(totalMs){
  const totalSeconds = Math.max(0, Math.ceil(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}分${pad2(seconds)}秒` : `${seconds}秒`;
}

function getUtcPipDepartureData(){
  if(currentRemoteDeparture){
    utcPipLastDeparture = {
      name:currentRemoteDeparture.name,
      departureTime:currentRemoteDeparture.departureTime
    };
  }
  if(!utcPipLastDeparture) return null;
  const remainingMs = utcPipLastDeparture.departureTime - firebaseNow();
  /* 0秒になっても少しの間は残り表示を出したままにする */
  if(remainingMs <= -UTC_PIP_HOLD_MS){
    utcPipLastDeparture = null;
    return null;
  }
  const departureDate = new Date(utcPipLastDeparture.departureTime);
  const departureTimeText = `${pad2(departureDate.getUTCHours())}:${pad2(departureDate.getUTCMinutes())}:${pad2(departureDate.getUTCSeconds())}`;
  return {
    name:utcPipLastDeparture.name,
    countdown:formatRemainingSeconds(remainingMs),
    departureTimeText
  };
}

/* 与えた幅に収まるまでフォントを縮める */
function fitPipFont(ctx, parts, maxWidth){
  let scale = 1;
  for(let i = 0; i < 8; i++){
    let total = 0;
    for(const part of parts){
      ctx.font = `${part.weight} ${Math.round(part.size * scale)}px ${UTC_PIP_FONT}`;
      total += ctx.measureText(part.text).width;
    }
    if(total <= maxWidth) break;
    scale *= maxWidth / total;
  }
  return scale;
}

/* 中央に横並びで描く */
function drawPipLine(ctx, parts, centerX, centerY, maxWidth){
  const scale = fitPipFont(ctx, parts, maxWidth);
  let total = 0;
  for(const part of parts){
    ctx.font = `${part.weight} ${Math.round(part.size * scale)}px ${UTC_PIP_FONT}`;
    part.width = ctx.measureText(part.text).width;
    total += part.width;
  }
  let x = centerX - total / 2;
  ctx.textAlign = 'left';
  for(const part of parts){
    ctx.font = `${part.weight} ${Math.round(part.size * scale)}px ${UTC_PIP_FONT}`;
    ctx.fillStyle = part.color;
    ctx.fillText(part.text, x, centerY);
    x += part.width;
  }
  ctx.textAlign = 'center';
}

/* 各サイズ・位置はキャンバスの高さ(H)に対する比率。比率を変えれば全体が追従する */
const UTC_PIP_LAYOUT = {
  sideMargin:0.02,      // 左右の余白（Hに対する比率）
  timeSize:0.85,        // 通常時の時刻
  unitSize:0.20,        // 通常時のUTC
  timeMillisSize:0.42,  // 通常時の時刻の小数部分
  timeY:0.5,
  labelSize:0.16,       // カウントダウン1行目
  labelY:0.22,
  valueSize:0.56,       // カウントダウンの数字
  secondSize:0.16,      // 「秒」
  valueY:0.68
};

function drawUtcVideoFrame(timeText, millisText, departureData){
  if(!utcPipContext || !utcPipCanvas) return;
  const ctx = utcPipContext;
  const W = utcPipCanvas.width;
  const H = utcPipCanvas.height;
  const L = UTC_PIP_LAYOUT;
  const inner = W - H * L.sideMargin * 2;
  ctx.fillStyle = '#1B2430';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  if(departureData){
    drawPipLine(ctx, [
      {text:departureData.name || '', size:H * L.labelSize, weight:700, color:'#ffffff'},
      {text:'　出発時刻　', size:H * L.labelSize, weight:400, color:'#9a9aa0'},
      {text:departureData.departureTimeText || '--:--:--', size:H * L.labelSize, weight:600, color:'#ffffff'},
      {text:' UTC', size:H * L.labelSize * 0.85, weight:600, color:'#9a9aa0'}
    ], W / 2, H * L.labelY, inner);
    drawPipLine(ctx, [
      {text:'残り　', size:H * L.secondSize, weight:500, color:'#9a9aa0'},
      {text:departureData.countdown, size:H * L.valueSize, weight:900, color:'#ffffff'}
    ], W / 2, H * L.valueY, inner);
    return;
  }
  drawPipLine(ctx, [
    {text:timeText, size:H * L.timeSize, weight:600, color:'#ffffff'},
    {text:millisText || '', size:H * L.timeMillisSize, weight:900, color:'#ffffff'},
    {text:' UTC', size:H * L.unitSize, weight:600, color:'#9a9aa0'}
  ], W / 2, H * L.timeY, inner);
}

function tickUTC(){
  const d=new Date(firebaseNow());
  const utcText = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  const millisText = (d.getUTCMilliseconds() / 1000).toFixed(1).slice(1);
  document.getElementById('utc-now').textContent = utcText;
  document.getElementById('utc-millis').textContent = millisText;
  const overlayTime = document.getElementById('utc-overlay-time');
  const overlayMillis = document.getElementById('utc-overlay-millis');
  if(overlayTime) overlayTime.textContent = utcText;
  if(overlayMillis) overlayMillis.textContent = millisText;
  const departureData = getUtcPipDepartureData();
  const overlayCountdown = document.getElementById('utc-overlay-countdown');
  if(overlayCountdown){
    overlayCountdown.hidden = !departureData;
    if(departureData){
      const overlayCountdownName = document.getElementById('utc-overlay-countdown-name');
      const overlayCountdownValue = document.getElementById('utc-overlay-countdown-value');
      const overlayCountdownTime = document.getElementById('utc-overlay-countdown-time');
      if(overlayCountdownName) overlayCountdownName.textContent = departureData.name || '';
      if(overlayCountdownValue) overlayCountdownValue.textContent = departureData.countdown;
      if(overlayCountdownTime) overlayCountdownTime.textContent = departureData.departureTimeText || '--:--:--';
    }
  }
  if(utcPipWindow && !utcPipWindow.closed){
    const pipDoc = utcPipWindow.document;
    const pipNormal = pipDoc.getElementById('utc-pip-normal');
    const pipTime = pipDoc.getElementById('utc-pip-time');
    const pipCountdown = pipDoc.getElementById('utc-pip-countdown');
    const pipCountdownName = pipDoc.getElementById('utc-pip-countdown-name');
    const pipCountdownValue = pipDoc.getElementById('utc-pip-countdown-value');
    const pipCountdownTime = pipDoc.getElementById('utc-pip-countdown-time');
    if(pipTime) pipTime.textContent = utcText;
    if(pipNormal) pipNormal.hidden = Boolean(departureData);
    if(pipCountdown){
      pipCountdown.hidden = !departureData;
      if(departureData){
        if(pipCountdownName) pipCountdownName.textContent = departureData.name || '';
        if(pipCountdownValue) pipCountdownValue.textContent = departureData.countdown;
        if(pipCountdownTime) pipCountdownTime.textContent = departureData.departureTimeText || '--:--:--';
      }
    }
  }
  drawUtcVideoFrame(utcText, millisText, departureData);
}

setInterval(tickUTC,33); tickUTC();

function initializeUtcVideoPipSource(){
  if(utcVideoPipStream) return true;
  if(!utcPipCanvas?.captureStream || !utcPipVideo) return false;
  try{
    utcVideoPipStream = utcPipCanvas.captureStream(30);
    utcPipVideo.srcObject = utcVideoPipStream;
    utcPipVideo.muted = true;
    utcPipVideo.autoplay = true;
    utcPipVideo.playsInline = true;
    utcPipVideo.disableRemotePlayback = true;
    utcPipVideo.play().catch(()=>{});
    return true;
  }catch(error){
    utcVideoPipStream = null;
    return false;
  }
}

async function openUtcVideoPip(){
  if(!initializeUtcVideoPipSource()) return false;
  const playPromise = utcPipVideo.play().catch(()=>{});

  /* iPhone Safariはタップ直後の同期呼び出しでないとPiPを拒否することがある */
  try{
    if(typeof utcPipVideo.webkitSetPresentationMode === 'function'){
      const supportsPip = typeof utcPipVideo.webkitSupportsPresentationMode !== 'function'
        || utcPipVideo.webkitSupportsPresentationMode('picture-in-picture');
      if(supportsPip){
        utcPipVideo.webkitSetPresentationMode('picture-in-picture');
        return true;
      }
    }
  }catch(error){
    // 標準PiP方式を続けて試す
  }

  try{
    await playPromise;
    /* 初回タップ時に再生準備が完了した端末向けにWebKit方式を再試行 */
    if(typeof utcPipVideo.webkitSetPresentationMode === 'function'){
      const supportsPip = typeof utcPipVideo.webkitSupportsPresentationMode !== 'function'
        || utcPipVideo.webkitSupportsPresentationMode('picture-in-picture');
      if(supportsPip){
        utcPipVideo.webkitSetPresentationMode('picture-in-picture');
        return true;
      }
    }
    if(document.pictureInPictureElement === utcPipVideo) return true;
    if(typeof utcPipVideo.requestPictureInPicture === 'function' && document.pictureInPictureEnabled !== false){
      await utcPipVideo.requestPictureInPicture();
      return true;
    }
  }catch(error){
    // 呼び出し元で通常オーバーレイへ切り替える
  }
  return false;
}

initializeUtcVideoPipSource();

function openUtcClockOverlay(){
  utcClockOverlay.classList.add('show');
  utcClockOverlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('utc-overlay-open');
  tickUTC();
  utcClockOverlayClose.focus();
}

async function openUtcPipWindow(){
  if(window.documentPictureInPicture?.requestWindow){
    try{
      if(utcPipWindow && !utcPipWindow.closed){
        utcPipWindow.focus();
        return true;
      }
      utcPipWindow = await window.documentPictureInPicture.requestWindow({width:240, height:Math.round(240 / UTC_PIP_ASPECT)});
      utcPipWindow.document.head.innerHTML = `<meta charset="UTF-8"><style>
        *{box-sizing:border-box} body{display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;margin:0;background:#1B2430;color:#fff;font-family:${UTC_PIP_FONT};overflow:hidden;font-variant-numeric:tabular-nums}
        [hidden]{display:none!important}
        .pip-line{display:flex;align-items:baseline;justify-content:center;gap:6px;white-space:nowrap}
        #utc-pip-time{font-size:9.5vh;font-weight:600;letter-spacing:-.02em}
        .pip-unit{color:#9a9aa0;font-size:4vh;font-weight:600}
        .pip-cd{text-align:center;line-height:1.2}
        .pip-cd-head{display:flex;align-items:baseline;justify-content:center;gap:.4em;color:#9a9aa0;font-size:3vh;font-weight:400;white-space:nowrap}
        .pip-cd-head b{color:#fff;font-weight:700}
        .pip-cd-head span{color:#fff;font-weight:600}
        .pip-cd-value-row{display:flex;align-items:baseline;justify-content:center;gap:.35em;white-space:nowrap}
        .pip-cd-label{color:#9a9aa0;font-size:3vh;font-weight:500}
        .pip-cd-value{color:#fff;font-size:8.4vh;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
        .pip-cd-value small{font-size:.45em;font-weight:600;color:#9a9aa0}
      

</style>`;
      utcPipWindow.document.body.innerHTML = '<div><div id="utc-pip-normal" class="pip-line"><span id="utc-pip-time">--:--:--</span><span class="pip-unit">UTC</span></div><div id="utc-pip-countdown" class="pip-cd" hidden><div class="pip-cd-head"><b id="utc-pip-countdown-name"></b><span>出発時刻</span><span id="utc-pip-countdown-time">--:--:--</span><span>UTC</span></div><div class="pip-cd-value-row"><span class="pip-cd-label">残り</span><span class="pip-cd-value"><span id="utc-pip-countdown-value">0秒</span></span></div></div></div>';
      utcPipWindow.addEventListener('pagehide', () => { utcPipWindow = null; });
      tickUTC();
      return true;
    }catch(e){
      utcPipWindow = null;
    }
  }
  return openUtcVideoPip();
}

/* タップ：まずPiPを試し、非対応の端末では画面内表示に切り替える */
async function handleUtcClockTap(){
  if(await openUtcPipWindow()) return;
  openUtcClockOverlay();
}

function closeUtcClockOverlay(){
  utcClockOverlay.classList.remove('show');
  utcClockOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('utc-overlay-open');
  utcClockTrigger.focus();
}

utcClockTrigger.addEventListener('click', handleUtcClockTap);
utcClockTrigger.addEventListener('keydown', event => {
  if(event.key === 'Enter' || event.key === ' '){
    event.preventDefault();
    handleUtcClockTap();
  }
});
utcClockOverlayClose.addEventListener('click', closeUtcClockOverlay);
utcClockOverlay.addEventListener('click', event => {
  if(event.target === utcClockOverlay) closeUtcClockOverlay();
});
document.addEventListener('keydown', event => {
  if(event.key === 'Escape' && utcClockOverlay.classList.contains('show')) closeUtcClockOverlay();
});


function isPetActiveForMember(memberName){
  const pets = loadPets();
  const now = Date.now();
  const pet = pets[memberName];
  return pet && pet.status === 'active' && pet.endTime && now < pet.endTime;
}

function updateMemberRowHighlights(){
  let marchChanged = false;
  document.querySelectorAll('#players .member-row-wrapper').forEach(wrapper => {
    const row = wrapper.querySelector('.member-row');
    if(!row) return;
    
    const nameEl = row.querySelector('.name-text');
    const name = (nameEl.textContent || '').trim();
    if(name && isPetActiveForMember(name)){
      row.classList.add('pet-active');
    } else {
      row.classList.remove('pet-active');
    }
    const beforeMarch = row.querySelector('.march-select')?.value;
    refreshMemberAutoMarch(row, {save:false});
    if(beforeMarch !== row.querySelector('.march-select')?.value) marchChanged = true;
  });
  if(marchChanged){
    saveSettings();
  }
}


/* ペットの残り時間は分単位で表す（例: 残り2時間00分 / 残り48分） */
function formatPetRemaining(remainingMs){
  const totalMinutes = Math.max(0, Math.ceil(remainingMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}時間${pad2(minutes)}分` : `${minutes}分`;
}

function updateMemberDepartureCountdowns(){
  const now = firebaseNow();
  document.querySelectorAll('#players .member-row').forEach(row => {
    const status = row.querySelector('.member-departure-status');
    if(!status) return;
    const departureTime = Number(row.dataset.departureTime || 0);
    status.classList.remove('counting', 'departed');
    if(!departureTime){
      status.textContent = '—';
      return;
    }
    const remainingMs = departureTime - now;
    if(remainingMs <= 0){
      status.textContent = '出発済';
      status.classList.add('departed');
      return;
    }
    status.textContent = formatRemainingSeconds(remainingMs);
    status.classList.add('counting');
  });
}

setInterval(updateMemberRowHighlights, 1000);
setInterval(updateMemberDepartureCountdowns, 50);

/* ======= 行軍時間オプション生成 ======= */
function marchLabel(i){
  const min = Math.floor(i / 60);
  const sec = i % 60;
  if(min === 0) return `${sec}秒`;
  if(sec === 0) return `${min}分`;
  return `${min}分${sec}秒`;
}
function generateMarchOptions(selectElement, defaultValue, minSec = 10, maxSec = 120){
  // defaultValueがnull/空なら、行軍時間が分からない状態として「未設定」のまま数値を仮定しない
  if(defaultValue === null || defaultValue === ''){
    let html = `<option value="" selected>未設定</option>`;
    for(let i=minSec; i<=maxSec; i++){
      html += `<option value="${i}">${marchLabel(i)}</option>`;
    }
    selectElement.innerHTML = html;
    selectElement.value = '';
    return;
  }
  const useDefault = parseInt(defaultValue) || minSec;
  let html = '';
  // 範囲外の現在値も先頭に追加して保持する
  if(useDefault < minSec){
    html += `<option value="${useDefault}" selected>${marchLabel(useDefault)}</option>`;
  }
  for(let i=minSec; i<=maxSec; i++){
    const selected = (i === useDefault) ? ' selected' : '';
    html += `<option value="${i}"${selected}>${marchLabel(i)}</option>`;
  }
  if(useDefault > maxSec){
    html += `<option value="${useDefault}" selected>${marchLabel(useDefault)}</option>`;
  }
  selectElement.innerHTML = html;
  selectElement.value = String(useDefault);
}
function updateAllMarchOptions(minSec = 10, maxSec = 120){
  document.querySelectorAll('.march-select').forEach(sel=>{
    // 現在値を必ず保存してから再生成（未選択なら未設定のまま維持する）
    const savedVal = sel.value === '' ? null : (parseInt(sel.value) || minSec);
    generateMarchOptions(sel, savedVal, minSec, maxSec);
  });
}
updateAllMarchOptions();

/* ======= 固定目標向け・行軍時間実測マスター ======= */
function refreshMemberAutoMarch(row, options = {}){
  if(!row) return null;
  const xInput = row.querySelector('.coord-x');
  const yInput = row.querySelector('.coord-y');
  const boostToggle = row.querySelector('.stat-boost-toggle');
  const marchSelect = row.querySelector('.march-select');
  const badge = row.querySelector('.march-auto-badge');
  const petToggle = row.querySelector('.member-settings-pet-toggle');
  const petRemaining = row.querySelector('.member-pet-remaining');
  if(!xInput || !yInput || !boostToggle || !marchSelect) return null;

  const name = (row.querySelector('.name-text')?.textContent || '').trim();
  const petRecord = name ? loadPets()[name] : null;
  const remainingPetMs = petRecord?.status === 'active' && petRecord.endTime
    ? petRecord.endTime - Date.now()
    : 0;
  const petActive = remainingPetMs > 0;
  if(petToggle) petToggle.checked = petActive;
  if(petRemaining){
    petRemaining.textContent = petActive ? `残り${formatPetRemaining(remainingPetMs)}` : '';
  }
  const coordX = xInput.value.trim();
  const coordY = yInput.value.trim();
  const hasCoordinates = coordX !== '' && coordY !== '';
  const autoSeconds = hasCoordinates
    ? lookupMarchTime(parseInt(coordX, 10), parseInt(coordY, 10), boostToggle.checked, petActive)
    : null;

  if(autoSeconds !== null){
    if(parseInt(marchSelect.value, 10) !== autoSeconds || marchSelect.dataset.autoMarch !== 'true'){
      generateMarchOptions(marchSelect, autoSeconds, 10, 300);
    }
    marchSelect.dataset.autoMarch = 'true';
    marchSelect.disabled = true;
    row.classList.add('auto-march-active');
    row.classList.remove('auto-march-missing');
    if(badge) badge.textContent = '自動';
    boostToggle.disabled = false;
    if(petToggle) petToggle.disabled = false;
  }else{
    marchSelect.dataset.autoMarch = 'false';
    marchSelect.disabled = false;
    row.classList.remove('auto-march-active');
    row.classList.toggle('auto-march-missing', hasCoordinates);
    if(badge) badge.textContent = '手動';
    boostToggle.disabled = true;
    if(petToggle) petToggle.disabled = true;
  }

  if(options.save !== false) saveSettings();
  return autoSeconds;
}

function refreshAllMemberAutoMarchTimes(options = {}){
  document.querySelectorAll('#players .member-row').forEach(row => {
    refreshMemberAutoMarch(row, {save:false});
  });
  if(options.save !== false) saveSettings();
}

/* ======= モード切替 ======= */
const rallyMinSel=document.getElementById('rally-min');
const actionBtn=document.getElementById('action-btn');
const impactDisplay=document.getElementById('impact-display');

function updateRallyMinOptions(){
  const currentVal = parseInt(rallyMinSel.value) || 5;
  const options = [{v:5, l:'5分'}, {v:10, l:'10分'}];
  const html = options.map(o => `<option value="${o.v}">${o.l}</option>`).join('');
  rallyMinSel.innerHTML = html;

  if(options.some(o => o.v == currentVal)){
    rallyMinSel.value = currentVal;
  }else{
    rallyMinSel.value = options[0].v;
  }
}

function updatePrepTimeOptions(){
  const currentVal = parseInt(prepTimeSel.value);
  const selectedVal = Number.isFinite(currentVal) ? currentVal : 30;
  let html = FROM_NOW_SECONDS.map(seconds => `<option value="${seconds}">${marchLabel(seconds)}</option>`).join('');
  if(!FROM_NOW_SECONDS.includes(selectedVal)) html += `<option value="${selectedVal}">${marchLabel(selectedVal)}</option>`;
  prepTimeSel.innerHTML = html;
  prepTimeSel.value = String(selectedVal);
}

const prepTimeSel = document.getElementById('prep-time');

/* 各メンバーの行軍時間を履歴から復元 */
function restoreMarchTimesFromHistory(){
  const key = getHistoryKey();
  const history = loadHistory();
  if(!history[key]) return;

  document.querySelectorAll('#players .member-row').forEach(row => {
    const nameEl = row.querySelector('.name-text');
    const sel = row.querySelector('.march-select');
    if(!nameEl || !sel) return;
    if(sel.dataset.autoMarch === 'true') return;
    const name = nameEl.textContent.trim();
    if(!name) return;
    const normalizedName = name.toLowerCase();
    const entry = history[key].find(item => item.name.toLowerCase() === normalizedName);
    if(entry){
      // 履歴にあればその値をセット（範囲外でも generateMarchOptions が保持）
      const currentMin = parseInt(sel.options[0]?.value) || 10;
      const currentMax = parseInt(sel.options[sel.options.length - 1]?.value) || 120;
      generateMarchOptions(sel, entry.marchSec, currentMin, currentMax);
    }
  });
}

function updateMode(){
  updateAllMarchOptions(10, 300);
  restoreMarchTimesFromHistory();
  updateRallyMinOptions();
  updatePrepTimeOptions();
}

/* ======= 出発時刻：時間編集ボトムシート ======= */
const departureEditModal = document.getElementById('departure-edit-modal');
const departureEditTitle = document.getElementById('departure-edit-title');
const departurePresetSection = document.getElementById('departure-preset-section');
const departurePresetListEl = document.getElementById('departure-preset-list');
const departureCustomSection = document.getElementById('departure-custom-section');
const departureEditFields = document.getElementById('departure-edit-fields');
const landingRallyMinSel = document.getElementById('l-rally-min');
const landingPrepTimeSel = document.getElementById('l-from-now');
const landingDiffMinSel = document.getElementById('l-diff-min');
const landingDiffSecSel = document.getElementById('l-diff-sec');
let currentDepartureEditor = null;
let currentDeparturePresetKind = null;

const DEFAULT_DEPARTURE_PRESETS = Object.freeze({
  'castle-rally':[5, 10],
  'landing-rally':[1, 2, 5, 10],
  'castle-prep':[...FROM_NOW_SECONDS],
  prep:[0, 10, 30, 60, 120],
  diff:[30, 60, 90, 120, 180],
  'switch-rally':[...SWITCH_MARCH_SECONDS],
  'switch-from-now':[...FROM_NOW_SECONDS]
});
const DEPARTURE_PRESET_KIND_BY_EDITOR = Object.freeze({
  rally:'castle-rally',
  'landing-rally':'landing-rally',
  prep:'castle-prep',
  'landing-prep':'prep',
  'landing-diff':'diff',
  'switch-rally':'switch-rally',
  'switch-from-now':'switch-from-now'
  // 'clock' は意図的に含めない -> プリセットなし -> 常にカスタム(ホイール)表示
});
const DEPARTURE_EDITOR_TITLES = Object.freeze({
  'landing-rally':'集結時間を編集',
  'landing-prep':'準備時間を編集',
  rally:'集結時間を編集',
  prep:'準備時間を編集',
  'landing-diff':'時差を編集',
  'switch-rally':'基準の行軍時間を編集',
  'switch-from-now':'今からを編集'
});

const DEPARTURE_PRESET_STORAGE_PREFIX = 'departurePresets:';

function loadDeparturePresets(kind){
  try{
    const raw = localStorage.getItem(DEPARTURE_PRESET_STORAGE_PREFIX + kind);
    if(raw){
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed)){
        const values = parsed
          .map(value => parseInt(value, 10))
          .filter(value => Number.isFinite(value) && value >= 0);
        if(values.length) return values;
      }
    }
  }catch(error){}
  return [...(DEFAULT_DEPARTURE_PRESETS[kind] || [])];
}

function saveDeparturePresets(kind, values){
  try{
    localStorage.setItem(DEPARTURE_PRESET_STORAGE_PREFIX + kind, JSON.stringify(values));
  }catch(error){}
}

function addDeparturePreset(kind, value){
  const values = loadDeparturePresets(kind);
  if(values.includes(value)) return;
  const descending = values.length > 1 && values[0] > values[values.length - 1];
  const next = [...values, value].sort((a, b) => descending ? b - a : a - b);
  saveDeparturePresets(kind, next);
}

function departurePresetLabel(kind, value){
  if(kind === 'castle-rally' || kind === 'landing-rally') return `${value}分`;
  return value === 0 ? 'なし' : marchLabel(value);
}

function ensureSelectOption(select, value, label){
  const stringValue = String(value);
  if(!Array.from(select.options).some(option => option.value === stringValue)){
    select.add(new Option(label, stringValue));
  }
  select.value = stringValue;
}

function createWheelHtml(id, values, selectedValue, unit, pad = false){
  const options = values.map(value => {
    const label = pad ? String(value).padStart(2, '0') : String(value);
    return `<button type="button" class="departure-wheel-option" data-value="${value}">${label}</button>`;
  }).join('');
  return `
    <div class="departure-wheel-group">
      <div id="${id}" class="departure-wheel" data-value="${selectedValue}">
        <div class="departure-wheel-spacer"></div>
        ${options}
        <div class="departure-wheel-spacer"></div>
      </div>
      <span class="departure-wheel-unit">${unit}</span>
    </div>`;
}

function createPresetHtml(kind, items){
  const rows = items.map(item =>
    `<div class="departure-preset-row" data-value="${item.value}">
      <span class="departure-preset-delete" aria-hidden="true">削除</span>
      <button type="button" class="departure-preset-option" data-value="${item.value}">${item.label}</button>
    </div>`
  ).join('');
  const customRow = `<div class="departure-preset-row departure-preset-row-static">
      <button type="button" class="departure-preset-option" data-role="custom">その他…</button>
    </div>`;
  return rows + customRow;
}

function getCurrentDepartureValue(editorType){
  if(editorType === 'landing-rally') return parseInt(landingRallyMinSel.value) || 0;
  if(editorType === 'rally') return parseInt(rallyMinSel.value) || 0;
  if(editorType === 'landing-prep') return parseInt(landingPrepTimeSel.value) || 0;
  if(editorType === 'prep') return parseInt(prepTimeSel.value) || 0;
  if(editorType === 'landing-diff') return (parseInt(landingDiffMinSel.value) || 0) * 60 + (parseInt(landingDiffSecSel.value) || 0);
  if(editorType === 'switch-rally') return parseInt(swRallyMinSel.value) || 0;
  if(editorType === 'switch-from-now') return parseInt(swFromNowInput.value) || 0;
  return null;
}

function syncDeparturePresetSelection(){
  const currentValue = getCurrentDepartureValue(currentDepartureEditor);
  departurePresetListEl.querySelectorAll('.departure-preset-option[data-value]').forEach(option => {
    option.classList.toggle('selected', parseInt(option.dataset.value, 10) === currentValue);
  });
}

function renderDeparturePresetSection(){
  if(!currentDeparturePresetKind) return;
  const items = loadDeparturePresets(currentDeparturePresetKind).map(value => ({
    value,
    label:departurePresetLabel(currentDeparturePresetKind, value)
  }));
  departurePresetListEl.innerHTML = createPresetHtml(currentDeparturePresetKind, items);
  initializeDeparturePresetRows();
  syncDeparturePresetSelection();
}

let presetSwipeGuardUntil = 0;

function resetPresetSwipe(rowEl){
  const button = rowEl.querySelector('.departure-preset-option');
  if(button){
    button.style.transition = 'transform .2s ease';
    button.style.transform = 'translateX(0)';
  }
  rowEl.classList.remove('swiping');
}

function deleteDeparturePresetRow(rowEl){
  const value = parseInt(rowEl.dataset.value, 10);
  const kind = currentDeparturePresetKind;
  if(!kind || !Number.isFinite(value)) return false;
  const remaining = loadDeparturePresets(kind).filter(item => item !== value);
  if(!remaining.length) return false;
  saveDeparturePresets(kind, remaining);
  rowEl.style.transition = 'all .25s ease';
  rowEl.style.opacity = '0';
  rowEl.style.height = '0';
  rowEl.style.overflow = 'hidden';
  setTimeout(renderDeparturePresetSection, 250);
  return true;
}

function attachPresetSwipe(rowEl){
  const button = rowEl.querySelector('.departure-preset-option');
  if(!button) return;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let isDragging = false;
  let swipeActivated = false;

  rowEl.addEventListener('touchstart', event => {
    departurePresetListEl.querySelectorAll('.departure-preset-row').forEach(other => {
      if(other !== rowEl) resetPresetSwipe(other);
    });
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    currentX = startX;
    isDragging = true;
    swipeActivated = false;
  }, {passive:true});

  rowEl.addEventListener('touchmove', event => {
    if(!isDragging) return;
    currentX = event.touches[0].clientX;
    const dx = currentX - startX;
    const dy = event.touches[0].clientY - startY;

    if(!swipeActivated){
      if(Math.abs(dx) >= 30 && Math.abs(dx) > Math.abs(dy)){
        swipeActivated = true;
        rowEl.classList.add('swiping');
        button.style.transition = 'none';
      }else{
        return;
      }
    }

    event.preventDefault();

    let diff = dx;
    if(diff > 0) diff = 0;
    if(diff < -80) diff = -80;
    button.style.transform = `translateX(${diff}px)`;
  }, {passive:false});

  rowEl.addEventListener('touchend', () => {
    if(!isDragging || !swipeActivated){
      isDragging = false;
      swipeActivated = false;
      resetPresetSwipe(rowEl);
      return;
    }
    presetSwipeGuardUntil = Date.now() + 350;
    if(currentX - startX >= -50 || !deleteDeparturePresetRow(rowEl)){
      resetPresetSwipe(rowEl);
    }
    isDragging = false;
    swipeActivated = false;
  });

  rowEl.addEventListener('touchcancel', () => {
    isDragging = false;
    swipeActivated = false;
    resetPresetSwipe(rowEl);
  });
}

function initializeDeparturePresetRows(){
  departurePresetListEl.querySelectorAll('.departure-preset-option').forEach(option => {
    option.addEventListener('click', () => {
      if(Date.now() < presetSwipeGuardUntil) return;
      if(option.dataset.role === 'custom'){
        showDepartureCustomView();
        return;
      }
      const value = parseInt(option.dataset.value, 10) || 0;
      applyEditorValue(currentDepartureEditor, value);
      closeDepartureEditor();
    });
  });
  departurePresetListEl.querySelectorAll('.departure-preset-row:not(.departure-preset-row-static)').forEach(attachPresetSwipe);
}

function getDepartureEditorValue(){
  if(currentDepartureEditor === 'landing-rally'){
    return parseInt(document.getElementById('departure-edit-landing-rally')?.dataset.value) || 0;
  }
  if(currentDepartureEditor === 'rally'){
    return parseInt(document.getElementById('departure-edit-rally')?.dataset.value) || 0;
  }
  if(currentDepartureEditor === 'landing-prep'){
    const minutes = parseInt(document.getElementById('departure-edit-landing-prep-min')?.dataset.value) || 0;
    const seconds = parseInt(document.getElementById('departure-edit-landing-prep-sec')?.dataset.value) || 0;
    return minutes * 60 + seconds;
  }
  if(currentDepartureEditor === 'prep'){
    const minutes = parseInt(document.getElementById('departure-edit-prep-min')?.dataset.value) || 0;
    const seconds = parseInt(document.getElementById('departure-edit-prep-sec')?.dataset.value) || 0;
    return minutes * 60 + seconds;
  }
  if(currentDepartureEditor === 'landing-diff'){
    const minutes = parseInt(document.getElementById('departure-edit-landing-diff-min')?.dataset.value) || 0;
    const seconds = parseInt(document.getElementById('departure-edit-landing-diff-sec')?.dataset.value) || 0;
    return minutes * 60 + seconds;
  }
  if(currentDepartureEditor === 'switch-rally'){
    return parseInt(document.getElementById('departure-edit-switch-rally')?.dataset.value) || 0;
  }
  if(currentDepartureEditor === 'switch-from-now'){
    const minutes = parseInt(document.getElementById('departure-edit-switch-from-now-min')?.dataset.value) || 0;
    const seconds = parseInt(document.getElementById('departure-edit-switch-from-now-sec')?.dataset.value) || 0;
    return minutes * 60 + seconds;
  }
  return null;
}

function setWheelValue(wheel, index){
  const options = wheel.querySelectorAll('.departure-wheel-option');
  const safeIndex = Math.max(0, Math.min(options.length - 1, index));
  options.forEach((option, optionIndex) => option.classList.toggle('selected', optionIndex === safeIndex));
  wheel.dataset.value = options[safeIndex].dataset.value;
}

function initializeDepartureWheels(){
  departureEditFields.querySelectorAll('.departure-wheel').forEach(wheel => {
    const options = Array.from(wheel.querySelectorAll('.departure-wheel-option'));
    const selectedIndex = Math.max(0, options.findIndex(option => option.dataset.value === wheel.dataset.value));
    setWheelValue(wheel, selectedIndex);
    requestAnimationFrame(() => { wheel.scrollTop = selectedIndex * 44; });

    let scrollTimer;
    wheel.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const index = Math.round(wheel.scrollTop / 44);
        setWheelValue(wheel, index);
        wheel.scrollTo({top:index * 44, behavior:'smooth'});
      }, 80);
    }, {passive:true});

    options.forEach((option, index) => {
      option.addEventListener('click', () => {
        setWheelValue(wheel, index);
        wheel.scrollTo({top:index * 44, behavior:'smooth'});
      });
    });
  });
}

function buildDepartureCustomFields(editorType){
  if(editorType === 'landing-rally'){
    const minutes = parseInt(landingRallyMinSel.value) || 5;
    departureEditFields.innerHTML = createWheelHtml(
      'departure-edit-landing-rally',
      Array.from({length:120}, (_, index) => index + 1),
      Math.min(120, minutes),
      '分'
    );
  }else if(editorType === 'landing-prep'){
    const totalSeconds = parseInt(landingPrepTimeSel.value) || 0;
    departureEditFields.innerHTML =
      createWheelHtml('departure-edit-landing-prep-min', Array.from({length:61}, (_, index) => index), Math.min(60, Math.floor(totalSeconds / 60)), '分') +
      createWheelHtml('departure-edit-landing-prep-sec', Array.from({length:60}, (_, index) => index), totalSeconds % 60, '秒', true);
  }else if(editorType === 'rally'){
    const minutes = parseInt(rallyMinSel.value) || 5;
    departureEditFields.innerHTML = createWheelHtml(
      'departure-edit-rally',
      Array.from({length:120}, (_, index) => index + 1),
      Math.min(120, minutes),
      '分'
    );
  }else if(editorType === 'prep'){
    const totalSeconds = parseInt(prepTimeSel.value) || 0;
    departureEditFields.innerHTML =
      createWheelHtml('departure-edit-prep-min', Array.from({length:61}, (_, index) => index), Math.min(60, Math.floor(totalSeconds / 60)), '分') +
      createWheelHtml('departure-edit-prep-sec', Array.from({length:60}, (_, index) => index), totalSeconds % 60, '秒', true);
  }else if(editorType === 'landing-diff'){
    const totalSeconds = (parseInt(landingDiffMinSel.value) || 0) * 60 + (parseInt(landingDiffSecSel.value) || 0);
    departureEditFields.innerHTML =
      createWheelHtml('departure-edit-landing-diff-min', Array.from({length:61}, (_, index) => index), Math.min(60, Math.floor(totalSeconds / 60)), '分') +
      createWheelHtml('departure-edit-landing-diff-sec', Array.from({length:60}, (_, index) => index), totalSeconds % 60, '秒', true);
  }else if(editorType === 'switch-rally'){
    const seconds = parseInt(swRallyMinSel.value) || SWITCH_MARCH_SECONDS[0];
    departureEditFields.innerHTML = createWheelHtml(
      'departure-edit-switch-rally',
      Array.from({length:180}, (_, index) => index + 1),
      Math.min(180, seconds),
      '秒'
    );
  }else if(editorType === 'switch-from-now'){
    const totalSeconds = Math.max(1, parseInt(swFromNowInput.value) || 30);
    departureEditFields.innerHTML =
      createWheelHtml('departure-edit-switch-from-now-min', Array.from({length:11}, (_, index) => index), Math.min(10, Math.floor(totalSeconds / 60)), '分') +
      createWheelHtml('departure-edit-switch-from-now-sec', Array.from({length:60}, (_, index) => index), totalSeconds % 60, '秒', true);
  }
  initializeDepartureWheels();
}

function showDeparturePresetView(){
  departurePresetSection.hidden = false;
  departureCustomSection.hidden = true;
}

function showDepartureCustomView(){
  if(departureEditFields.dataset.builtFor !== currentDepartureEditor){
    buildDepartureCustomFields(currentDepartureEditor);
    departureEditFields.dataset.builtFor = currentDepartureEditor;
  }
  departurePresetSection.hidden = true;
  departureCustomSection.hidden = false;
  requestAnimationFrame(() => {
    departureEditFields.querySelectorAll('.departure-wheel').forEach(wheel => {
      const options = Array.from(wheel.querySelectorAll('.departure-wheel-option'));
      const selectedIndex = Math.max(0, options.findIndex(option => option.dataset.value === wheel.dataset.value));
      wheel.scrollTop = selectedIndex * 44;
    });
  });
}

function openDepartureEditor(editorType){
  currentDepartureEditor = editorType;
  currentDeparturePresetKind = DEPARTURE_PRESET_KIND_BY_EDITOR[editorType] || null;
  departureEditTitle.textContent = DEPARTURE_EDITOR_TITLES[editorType] || '時間を編集';
  departureEditFields.dataset.builtFor = '';

  departureEditModal.classList.add('show');
  departureEditModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('departure-edit-open');
  departureEditModal.querySelector('.departure-edit-sheet').scrollTop = 0;

  if(currentDeparturePresetKind){
    renderDeparturePresetSection();
    showDeparturePresetView();
  }else{
    showDepartureCustomView();
  }
}

function closeDepartureEditor(){
  departureEditModal.classList.remove('show');
  departureEditModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('departure-edit-open');
  currentDepartureEditor = null;
  currentDeparturePresetKind = null;
}

function applyEditorValue(editorType, value){
  if(editorType === 'landing-rally'){
    const minutes = value || 1;
    ensureSelectOption(landingRallyMinSel, minutes, `${minutes}分`);
    landingRallyMinSel.dispatchEvent(new Event('change'));
    localStorage.setItem('landingRallyMin', String(minutes));
  }else if(editorType === 'landing-prep'){
    const totalSeconds = value || 0;
    ensureSelectOption(landingPrepTimeSel, totalSeconds, marchLabel(totalSeconds));
    landingPrepTimeSel.dispatchEvent(new Event('change'));
    localStorage.setItem('landingPrepTime', String(totalSeconds));
  }else if(editorType === 'rally'){
    const minutes = value || 1;
    ensureSelectOption(rallyMinSel, minutes, `${minutes}分`);
    rallyMinSel.dispatchEvent(new Event('change'));
  }else if(editorType === 'prep'){
    const totalSeconds = value || 0;
    ensureSelectOption(prepTimeSel, totalSeconds, marchLabel(totalSeconds));
    prepTimeSel.dispatchEvent(new Event('change'));
  }else if(editorType === 'landing-diff'){
    const totalSeconds = value || 0;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    ensureSelectOption(landingDiffMinSel, minutes, `${minutes}分`);
    ensureSelectOption(landingDiffSecSel, seconds, `${seconds}秒`);
    landingDiffMinSel.dispatchEvent(new Event('change'));
    landingDiffSecSel.dispatchEvent(new Event('change'));
    localStorage.setItem('landingDiffSeconds', String(totalSeconds));
  }else if(editorType === 'switch-rally'){
    const seconds = value || SWITCH_MARCH_SECONDS[0];
    ensureSelectOption(swRallyMinSel, seconds, marchLabel(seconds));
    swRallyMinSel.dispatchEvent(new Event('change'));
  }else if(editorType === 'switch-from-now'){
    const seconds = Math.max(1, value || 30);
    ensureSelectOption(swFromNowInput, seconds, marchLabel(seconds));
    swFromNowInput.dispatchEvent(new Event('change'));
  }

  saveSettings();
}

function wireDepartureRowTrigger(el, editorType){
  if(!el) return;
  el.addEventListener('click', () => openDepartureEditor(editorType));
  el.addEventListener('keydown', event => {
    if(event.key === 'Enter' || event.key === ' '){
      event.preventDefault();
      openDepartureEditor(editorType);
    }
  });
}

wireDepartureRowTrigger(document.getElementById('rally-row'), 'rally');
wireDepartureRowTrigger(document.getElementById('prep-input-group'), 'prep');
wireDepartureRowTrigger(document.getElementById('l-rally-row'), 'landing-rally');
wireDepartureRowTrigger(document.getElementById('l-prep-row'), 'landing-prep');
wireDepartureRowTrigger(document.getElementById('l-two-wave-section'), 'landing-diff');
wireDepartureRowTrigger(document.getElementById('sw-rally-row'), 'switch-rally');
wireDepartureRowTrigger(document.getElementById('sw-from-now-row'), 'switch-from-now');

const prepHelpButton = document.getElementById('prep-help-button');
const prepHelpPopover = document.getElementById('prep-help-popover');
function setPrepHelp(open){
  if(!prepHelpButton || !prepHelpPopover) return;
  prepHelpPopover.hidden = !open;
  prepHelpButton.setAttribute('aria-expanded', open ? 'true' : 'false');
}
prepHelpButton?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  setPrepHelp(prepHelpPopover?.hidden !== false);
});
prepHelpButton?.addEventListener('keydown', event => event.stopPropagation());
prepHelpPopover?.addEventListener('click', event => event.stopPropagation());
document.addEventListener('click', () => setPrepHelp(false));

document.querySelectorAll('.departure-edit-trigger').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openDepartureEditor(button.dataset.editor);
  });
});

document.getElementById('departure-edit-close').addEventListener('click', closeDepartureEditor);
document.getElementById('departure-preset-cancel').addEventListener('click', closeDepartureEditor);
document.querySelector('.departure-edit-backdrop').addEventListener('click', closeDepartureEditor);

document.getElementById('departure-edit-save').addEventListener('click', () => {
  const value = getDepartureEditorValue();
  const kind = currentDeparturePresetKind;
  if(kind && typeof value === 'number' && value > 0){
    addDeparturePreset(kind, value);
  }
  applyEditorValue(currentDepartureEditor, value);
  closeDepartureEditor();
});

/* ======= 行削除（グローバル関数） ======= */
function deleteThisRow(el){
  const wrapper = el.closest('.member-row-wrapper');
  if(wrapper){
    wrapper.style.transition = 'all 0.3s ease';
    wrapper.style.transform = 'translateX(-100%)';
    wrapper.style.opacity = '0';
    wrapper.style.height = '0';
    wrapper.style.marginBottom = '0';
    wrapper.style.overflow = 'hidden';
    setTimeout(() => {
      wrapper.remove();
      generateCopyMessage();
      saveSettings();
    }, 300);
  }
}

/* ======= スワイプ削除（rowを移動して削除背景を見せる） ======= */
function resetAllSwipeStates(){
  document.querySelectorAll('.member-row-wrapper').forEach(wrapper => {
    wrapper.classList.remove('swiping');
    const row = wrapper.querySelector('.member-row');
    if(row){
      row.style.transition = 'transform 0.2s ease';
      row.style.transform = 'translateX(0)';
    }
  });
}

function isAnyModalOpen(){
  return document.body.classList.contains('modal-open');
}

const swipeBoundRows = new WeakSet();
function attachSwipeToRow(row){
  const wrapper = row.closest('.member-row-wrapper');
  if(!wrapper) return;

  if(swipeBoundRows.has(wrapper)) return;
  swipeBoundRows.add(wrapper);

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let isDragging = false;
  let swipeActivated = false; // スワイプが有効になったか（閾値超え）

  wrapper.addEventListener('touchstart', e => {
    // モーダル表示中はスワイプ無効
    if(isAnyModalOpen()) return;
    
    // ツールバーからのタッチは無視
    if(e.target.closest('.app-toolbar')) return;
    
    // 他の行をリセット
    document.querySelectorAll('.member-row-wrapper .member-row').forEach(r => {
      if(r !== row){
        r.style.transition = 'transform 0.2s ease';
        r.style.transform = 'translateX(0)';
      }
    });

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = startX;
    isDragging = true;
    swipeActivated = false;
  }, { passive: true });

  wrapper.addEventListener('touchmove', e => {
    if(!isDragging || isAnyModalOpen()) {
      isDragging = false;
      swipeActivated = false;
      row.style.transition = 'transform 0.2s ease';
      row.style.transform = 'translateX(0)';
      return;
    }

    currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    // スワイプ閾値：水平方向30px以上かつ水平移動が垂直移動より大きい
    if(!swipeActivated){
      if(Math.abs(dx) >= 30 && Math.abs(dx) > Math.abs(dy)){
        swipeActivated = true;
        wrapper.classList.add('swiping');
        row.style.transition = 'none';
      } else {
        return; // まだスワイプとして認識しない
      }
    }

    e.preventDefault();

    let diff = dx;
    if(diff > 0) diff = 0;
    if(diff < -80) diff = -80;

    row.style.transform = `translateX(${diff}px)`;
  }, { passive: false });

  wrapper.addEventListener('touchend', () => {
    if(!isDragging || isAnyModalOpen() || !swipeActivated) {
      isDragging = false;
      swipeActivated = false;
      wrapper.classList.remove('swiping');
      row.style.transition = 'transform 0.2s ease';
      row.style.transform = 'translateX(0)';
      return;
    }

    const diff = currentX - startX;

    if(diff < -50){
      wrapper.style.transition = 'all 0.3s ease';
      wrapper.style.opacity = '0';
      wrapper.style.height = '0';
      wrapper.style.marginBottom = '0';
      wrapper.style.overflow = 'hidden';

      setTimeout(() => {
        wrapper.remove();
        generateCopyMessage();
        saveSettings();
      }, 300);
    } else {
      wrapper.classList.remove('swiping');
      row.style.transition = 'transform 0.2s ease';
      row.style.transform = 'translateX(0)';
    }

    isDragging = false;
    swipeActivated = false;
  });

  wrapper.addEventListener('touchcancel', () => {
    wrapper.classList.remove('swiping');
    row.style.transition = 'transform 0.2s ease';
    row.style.transform = 'translateX(0)';
    isDragging = false;
    swipeActivated = false;
  });
}

// 既存の行にスワイプを付与
document.querySelectorAll('#players .member-row').forEach(attachSwipeToRow);

/* ======= 行イベント（入力・選択用） ======= */
/* ======= ID からプレイヤー名・アイコンを取得 ======= */
const playerApi = createPlayerApi();
const PLAYER_ID_PATTERN = /^\d{5,12}$/;

function renderMemberAvatar(row){
  const avatar = row.querySelector('.member-avatar');
  if(!avatar) return;
  const url = row.dataset.avatar || '';
  avatar.classList.toggle('has-image', !!url);
  avatar.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : '';
}

function setPlayerOnRow(row, fid, nickname, avatarUrl){
  row.dataset.fid = fid || '';
  row.dataset.nickname = nickname || '';
  row.dataset.avatar = avatarUrl || '';
  renderMemberAvatar(row);
}

function clearPlayerIfRenamed(row){
  if(!row.dataset.fid) return;
  const text = (row.querySelector('.name-text').textContent || '').trim();
  if(text === row.dataset.nickname) return;
  setPlayerOnRow(row, '', '', '');
}

async function lookupPlayerForRow(row){
  const nameInput = row.querySelector('.name-text');
  const avatar = row.querySelector('.member-avatar');
  const id = (nameInput.textContent || '').trim().replace(/\s/g, '');
  if(!PLAYER_ID_PATTERN.test(id)) return;
  if(row.dataset.lookingUp === id) return;

  row.dataset.lookingUp = id;
  avatar?.classList.add('loading');
  try{
    const player = await playerApi.getPlayer(id);
    if(!player){
      showToast('IDが見つかりません');
      return;
    }
    const nickname = (player.name || '').trim();
    if(!nickname){
      showToast('名前を取得できませんでした');
      return;
    }
    if((nameInput.textContent || '').trim().replace(/\s/g, '') !== id) return;

    const duplicate = Array.from(document.querySelectorAll('#players .member-row'))
      .some(r => r !== row && (r.querySelector('.name-text').textContent || '').trim().toLowerCase() === nickname.toLowerCase());
    if(duplicate){
      showToast('同じ名前が既に存在します');
      return;
    }

    nameInput.textContent = nickname;
    setPlayerOnRow(row, id, nickname, player.avatar || '');
    refreshMemberAutoMarch(row, {save:false});
    saveSettings();
  }catch(error){
    showToast('取得できませんでした');
  }finally{
    delete row.dataset.lookingUp;
    avatar?.classList.remove('loading');
  }
}

function attachRowEvents(row){
  if(row.dataset.eventsAttached) return;
  row.dataset.eventsAttached = 'true';

  const nameInput = row.querySelector('.name-text');
  renderMemberAvatar(row);

  nameInput.addEventListener('input', function(){
    clearPlayerIfRenamed(row);
    saveSettings();
    refreshMemberAutoMarch(row, {save:false});
    const text = (this.textContent || '').trim();
    showAutocomplete(this, getSuggestions(text));
  });

  nameInput.addEventListener('focus', function(){
    showAutocomplete(this, getSuggestions((this.textContent || '').trim()));
  });

  nameInput.addEventListener('blur', function(){
    lookupPlayerForRow(row);
    refreshMemberAutoMarch(row, {save:false});
    saveSettings();
    setTimeout(hideAutocomplete, 120);
  });

  nameInput.addEventListener('keydown', function(ev){
    if(!currentDropdown){
      if(ev.key === 'Enter'){
        ev.preventDefault();
        this.blur();
      }
      return;
    }
    const items = currentDropdown.querySelectorAll('.autocomplete-item');
    if(ev.key === 'ArrowDown'){
      ev.preventDefault();
      selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
      updateSelectedItem(currentDropdown);
    }else if(ev.key === 'ArrowUp'){
      ev.preventDefault();
      selectedIndex = Math.max(0, selectedIndex - 1);
      updateSelectedItem(currentDropdown);
    }else if(ev.key === 'Enter'){
      ev.preventDefault();
      if(selectedIndex >= 0) items[selectedIndex].dispatchEvent(new MouseEvent('mousedown'));
    }else if(ev.key === 'Escape'){
      hideAutocomplete();
    }
  });

  row.querySelector('.march-select').addEventListener('change', function(){
    saveSettings();
  });

  row.querySelectorAll('.coord-input').forEach(input => {
    input.addEventListener('input', function(){
      this.value = this.value.replace(/\D/g, '').slice(0, 4);
      refreshMemberAutoMarch(row);
    });
    input.addEventListener('change', () => refreshMemberAutoMarch(row));
  });

  row.querySelector('.stat-boost-toggle').addEventListener('change', () => {
    refreshMemberAutoMarch(row);
  });

  row.querySelector('.member-settings-pet-toggle').addEventListener('change', function(event){
    event.stopPropagation();
    const name = (row.querySelector('.name-text').textContent || '').trim();
    if(!name){
      showToast('先に集結主名を入力してください');
      this.checked = false;
      return;
    }
    if(this.checked){
      activatePet(name);
    }else{
      resetPetForMember(name);
    }
    refreshMemberAutoMarch(row);
  });

  function toggleMemberSettings(){
    const settings = row.querySelector('.member-auto-settings');
    const toggle = row.querySelector('.member-settings-toggle');
    const willOpen = settings.hidden;
    settings.hidden = !willOpen;
    toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if(willOpen) refreshMemberAutoMarch(row, {save:false});
  }

  /* 名前は編集したいので、名前部分のタップでは開閉しない */
  row.querySelector('.member-identity-row').addEventListener('click', function(event){
    if(event.target.closest('.name-text')) return;
    if(event.target.closest('.member-settings-toggle')) return;
    toggleMemberSettings();
  });

  row.querySelector('.member-settings-toggle').addEventListener('click', function(event){
    event.preventDefault();
    event.stopPropagation();
    toggleMemberSettings();
  });
}
document.querySelectorAll('#players .member-row').forEach(attachRowEvents);

/* ======= メンバー追加 ======= */
function escapeMemberText(value){
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMemberRowHtml(member = {}){
  const name = escapeMemberText(member.name || '');
  const coordX = escapeMemberText(member.coordX ?? '');
  const coordY = escapeMemberText(member.coordY ?? '');
  const boostChecked = member.statBoost ? ' checked' : '';
  const fid = escapeMemberText(member.fid || '');
  const avatar = escapeMemberText(member.avatar || '');
  return `
    <div class="delete-bg">削除</div>
    <div class="member-row" data-fid="${fid}" data-avatar="${avatar}" data-nickname="${fid ? name : ''}">
      <div class="member-identity-row">
        <span class="member-avatar" aria-hidden="true"></span>
        <span class="name-text" contenteditable="true" data-placeholder="名前・ID">${name}</span>
        <span class="member-departure-inline"><span class="member-departure-status">—</span><span class="dep" hidden>-</span></span>
        <button type="button" class="member-settings-toggle" aria-expanded="false" aria-label="集結主設定"></button>
      </div>
      <div class="member-auto-settings" hidden>
        <div class="member-setting-pair"><div class="member-setting-row"><span class="member-setting-value member-coordinates"><span class="coord-axis">X</span><input class="coord-input coord-x" inputmode="numeric" pattern="[0-9]*" placeholder="598" aria-label="X座標" value="${coordX}"><span class="coord-axis">Y</span><input class="coord-input coord-y" inputmode="numeric" pattern="[0-9]*" placeholder="606" aria-label="Y座標" value="${coordY}"></span></div><div class="member-setting-row"><span class="member-setting-value march-control"><select class="march-select"></select><small class="march-auto-badge">手動</small></span></div></div><label class="member-setting-row stat-boost-control"><span class="member-setting-label">ステ強化</span><span class="member-setting-value"><input type="checkbox" class="stat-boost-toggle"${boostChecked}><span class="stat-boost-switch"></span></span></label><label class="member-setting-row member-settings-pet-control"><span class="member-setting-label">ペット</span><span class="member-setting-value"><span class="member-pet-remaining"></span><input type="checkbox" class="member-settings-pet-toggle"><span class="stat-boost-switch"></span></span></label>
      </div>
    </div>`;
}

function addMemberRow(name = '', marchSec = null, memberSettings = {}){
  const container=document.querySelector('#players');
  const wrapper=document.createElement('div');
  wrapper.classList.add('member-row-wrapper');
  wrapper.innerHTML=buildMemberRowHtml({name, ...memberSettings});
  const row = wrapper.querySelector('.member-row');
  container.appendChild(wrapper);
  const minSec = 10;
  const maxSec = 300;
  generateMarchOptions(row.querySelector('.march-select'), marchSec, minSec, maxSec);
  attachRowEvents(row);
  attachSwipeToRow(row);
  refreshMemberAutoMarch(row, {save:false});
  saveSettings();
  return row;
}

document.getElementById('add-member').addEventListener('click',()=>{
  addMemberRow();
});

/* ======= コピー用メッセージ生成 ======= */
function generateCopyMessage(sortedRowData){
  const rallyMin = rallyMinSel.value;
  const commonImpactTime = document.getElementById('common-impact-time').textContent;

  const rows = sortedRowData
    ? sortedRowData.map(item => item.row)
    : [...document.querySelectorAll('#players .member-row')];
  const entries = rows.map(row => ({
    name:(row.querySelector('.name-text').textContent||'').trim(),
    dep:row.querySelector('.dep').textContent.trim()||'-'
  }));
  const namedEntries = entries.filter(entry => entry.name);
  const sameDeparture = namedEntries.length > 0 && namedEntries.every(entry => entry.dep === namedEntries[0].dep);

  const lines=[];
  if(sameDeparture){
    lines.push(`${rallyMin}分集結お願いします`);
    lines.push('');
    lines.push(`着弾時刻:${commonImpactTime} UTC`);
    lines.push('');
    namedEntries.forEach(entry => lines.push(`・${entry.name}`));
  }else{
    lines.push(`${rallyMin}分集結お願いします！🙇‍♂️🙇‍♂️✨`);
    lines.push('');
    entries.forEach(entry => lines.push(`${entry.name || '集結主'} → ${entry.dep} UTC`));
    lines.push('━━━━━━━━━━━');
    lines.push(`着弾時刻：${commonImpactTime} UTC`);
  }
  const msg = lines.join('\n');
  document.getElementById('copy').textContent = msg;
  
  // プレビュー更新
  const previewText = document.getElementById('preview-text');
  if(previewText){
    previewText.textContent = msg;
  }
}

/* ======= コピーボタン（トースト通知） ======= */
const toast = document.getElementById('toast');
function showToast(text='✓ コピーしました'){
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(()=>toast.classList.remove('show'),1500);
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(error){
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try{
      return document.execCommand('copy');
    }catch(error){
      return false;
    }finally{
      textarea.remove();
    }
  }
}

function flashResults(selector){
  document.querySelectorAll(`${selector} .impact-display-inner`).forEach(target => {
    if(target.offsetParent === null) return;
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
    setTimeout(()=>target.classList.remove('flash'), 800);
  });
}

/* ======= 出発時刻計算 ======= */
const impactTime= document.getElementById('common-impact-time');

actionBtn.addEventListener('click',()=>{
  actionBtn.classList.add('calculating');
  actionBtn.disabled = true;
  actionBtn.textContent = '計算中...';

  const now=new Date(firebaseNow());

  // 最長行軍（メンバー行から自動スキャン）
  let maxMarch = 0;
  document.querySelectorAll('#players .member-row').forEach(row=>{
    const march = parseInt(row.querySelector('.march-select').value,10) || 0;
    if(march > maxMarch) maxMarch = march;
  });

  let arriveUtc;
  const prepSec = parseInt(prepTimeSel.value,10);

  const rallyMin = parseInt(rallyMinSel.value,10);

  // 今から：現在時刻 + 準備時間 + 集結時間 + 最長行軍
  const timing = calculateCastle({nowMs:now.getTime(), prepSeconds:prepSec, rallyMinutes:rallyMin, maxMarchSeconds:maxMarch});
  arriveUtc=new Date(timing.impactTime);

  const arriveStr=`${pad2(arriveUtc.getUTCHours())}:${pad2(arriveUtc.getUTCMinutes())}:${pad2(arriveUtc.getUTCSeconds())}`;
  impactTime.textContent=arriveStr;

  // 着弾時刻は両モードで表示
  impactDisplay.style.display='block';

  // 各人の出発時刻
  const rowData=[];
  document.querySelectorAll('#players .member-row-wrapper').forEach(wrapper=>{
    const row = wrapper.querySelector('.member-row');
    const march=parseInt(row.querySelector('.march-select').value,10)||0;
    let dep;

    // 今から：現在時刻 + 準備時間 + (最長行軍 - 個人行軍)
    dep = new Date(calculateDeparture(timing.firstDepartureTime, maxMarch, march));

    const depTime = dep.getTime();
    row.dataset.departureTime = String(depTime);
    row.querySelector('.dep').textContent =
      `${pad2(dep.getUTCHours())}:${pad2(dep.getUTCMinutes())}:${pad2(dep.getUTCSeconds())}`;
    row.classList.add('has-departure');
    rowData.push({wrapper, row, depTime});
  });
  updateMemberDepartureCountdowns();
  publishRosterDepartureTimes(rowData);

  // 出発時刻が早い順にソート
  rowData.sort((a, b) => a.depTime - b.depTime);

  // ソートされた順序でテーブルを並び替え（wrapperごと移動）
  const tbody = document.querySelector('#players');
  rowData.forEach(item => {
    tbody.appendChild(item.wrapper);
  });

  generateCopyMessage(rowData);

  // 履歴に記録
  document.querySelectorAll('#players .member-row').forEach(row=>{
    const name = (row.querySelector('.name-text').textContent||'').trim();
    const march = parseInt(row.querySelector('.march-select').value, 10);
    if(name && march){
      recordHistory(name, march);
    }
  });

  // 最後に解除してコピー実行
  setTimeout(async ()=>{
    actionBtn.textContent='計算開始';
    actionBtn.classList.remove('calculating');
    actionBtn.disabled=false;
    
    // 自動コピー
    const txt = document.getElementById('copy').textContent;
    flashResults('#impact-display');
    await copyText(txt);
    showToast();
  }, 0);
});

/* ======= 履歴管理 ======= */
const MAX_HISTORY_PER_KEY = 50;

function getHistoryKey(){
  return 'all';
}

function loadHistory(){
  try{
    const raw = localStorage.getItem('memberHistory');
    if(!raw) return {};
    const data = JSON.parse(raw);
    if(!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).map(([key, items]) => [key,
      Array.isArray(items) ? items.filter(item =>
        item && typeof item.name === 'string' && item.name.trim() &&
        Number.isFinite(Number(item.marchSec)) && Number(item.marchSec) > 0
      ).map(item => ({...item, marchSec:Number(item.marchSec)})) : []
    ]));
  }catch(e){
    return {};
  }
}

function saveHistory(historyData){
  try{
    localStorage.setItem('memberHistory', JSON.stringify(historyData));
  }catch(e){
    console.error('履歴の保存に失敗しました', e);
  }
}

function recordHistory(name, marchSec){
  if(!name || !name.trim()) return;

  const key = getHistoryKey();
  const history = loadHistory();

  if(!history[key]){
    history[key] = [];
  }

  const normalizedName = name.trim().replace(/\s+/g, ' ');
  // 同じ名前・同じ秒数の重複チェック（ペット状態は無視）
  const existingIndex = history[key].findIndex(item => 
    item.name.toLowerCase() === normalizedName.toLowerCase() && 
    item.marchSec === marchSec
  );

  const entry = {
    name: normalizedName,
    marchSec: marchSec,
    lastUsed: Date.now()
  };

  if(existingIndex >= 0){
    // 既存エントリを更新
    history[key][existingIndex] = entry;
  }else{
    history[key].push(entry);
  }

  history[key].sort((a, b) => b.lastUsed - a.lastUsed);

  if(history[key].length > MAX_HISTORY_PER_KEY){
    history[key] = history[key].slice(0, MAX_HISTORY_PER_KEY);
  }

  saveHistory(history);
}

function getSuggestions(inputText){
  const normalizedInput = String(inputText || '').trim().toLocaleLowerCase('ja-JP');
  const used = new Set(Array.from(document.querySelectorAll('#players .member-row .name-text'))
    .filter(el => el !== currentInput)
    .map(el => (el.textContent || '').trim().toLocaleLowerCase('ja-JP'))
    .filter(Boolean));
  return LIVE_MEMBER_ROSTER
    .filter(name => name.toLocaleLowerCase('ja-JP').includes(normalizedInput))
    .filter(name => !used.has(name.toLocaleLowerCase('ja-JP')))
    .map(name => ({name, marchSec:null}))
    .slice(0, 24);
}


/* ======= オートコンプリートドロップダウン ======= */
let currentDropdown = null;
let currentInput = null;
let selectedIndex = -1;

function showAutocomplete(inputElement, suggestions){
  hideAutocomplete();

  if(!suggestions || suggestions.length === 0) return;

  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown show';

  suggestions.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'autocomplete-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'autocomplete-name';
    nameSpan.textContent = item.name;

    const marchSpan = document.createElement('span');
    marchSpan.className = 'autocomplete-march';
    marchSpan.textContent = '同期';

    div.appendChild(nameSpan);
    div.appendChild(marchSpan);

    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSuggestion(inputElement, item);
    });

    div.addEventListener('mouseenter', () => {
      selectedIndex = index;
      updateSelectedItem(dropdown);
    });

    dropdown.appendChild(div);
  });

  const rect = inputElement.getBoundingClientRect();
  dropdown.style.top = (rect.bottom + window.scrollY) + 'px';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = rect.width + 'px';

  document.body.appendChild(dropdown);
  currentDropdown = dropdown;
  currentInput = inputElement;
  selectedIndex = -1;
}

function hideAutocomplete(){
  if(currentDropdown){
    currentDropdown.remove();
    currentDropdown = null;
    currentInput = null;
    selectedIndex = -1;
  }
}

function updateSelectedItem(dropdown){
  const items = dropdown.querySelectorAll('.autocomplete-item');
  items.forEach((item, index) => {
    if(index === selectedIndex){
      item.classList.add('selected');
    }else{
      item.classList.remove('selected');
    }
  });
}

function selectSuggestion(inputElement, item){
  const row = inputElement.closest('.member-row');
  if(!row) return;

  // 重複チェック（自分自身は除く）
  const currentName = (inputElement.textContent || '').trim().toLowerCase();
  const newName = item.name.trim().toLowerCase();
  
  if(currentName !== newName){
    const existingRows = document.querySelectorAll('#players .member-row');
    for(const r of existingRows){
      if(r === row) continue;
      const existingName = (r.querySelector('.name-text').textContent || '').trim().toLowerCase();
      if(existingName === newName){
        showToast('同じ名前が既に存在します');
        hideAutocomplete();
        return;
      }
    }
  }

  inputElement.textContent = item.name;
  clearPlayerIfRenamed(row);

  const marchSelect = row.querySelector('.march-select');
  if(marchSelect && Number.isFinite(Number(item.marchSec))){
    marchSelect.value = item.marchSec;
  }

  refreshMemberAutoMarch(row, {save:false});
  hideAutocomplete();
  saveSettings();
}


/* ======= 設定の保存/復元 ======= */
function saveSettings(){
  const members=[];
  document.querySelectorAll('#players .member-row').forEach(row=>{
    members.push({
      name: row.querySelector('.name-text').textContent||'',
      march: row.querySelector('.march-select').value,
      coordX: row.querySelector('.coord-x')?.value || '',
      coordY: row.querySelector('.coord-y')?.value || '',
      statBoost: !!row.querySelector('.stat-boost-toggle')?.checked,
      fid: row.dataset.fid || '',
      avatar: row.dataset.avatar || ''
    });
  });

  const data={
    rallyMin:rallyMinSel.value,
    prepTime:prepTimeSel.value,
    members: members
  };
  localStorage.setItem('arrivalMarineSettings', JSON.stringify(data));
  scheduleRosterPublish();
}
function loadSettings(){
  const raw=localStorage.getItem('arrivalMarineSettings'); if(!raw) return;
  try{
    const d=JSON.parse(raw);
    if(!d || typeof d !== 'object' || Array.isArray(d)) return;

    const savedRally = Number(d.rallyMin);
    if(Number.isInteger(savedRally) && savedRally >= 1 && savedRally <= 120){
      ensureSelectOption(rallyMinSel, savedRally, `${savedRally}分`);
    }
    const savedPrep = Number(d.prepTime);
    if(d.prepTime !== null && d.prepTime !== '' && Number.isInteger(savedPrep) && savedPrep >= 0 && savedPrep <= 3659){
      ensureSelectOption(prepTimeSel, savedPrep, marchLabel(savedPrep));
    }

    const members = Array.isArray(d.members) ? d.members.filter(m => m && typeof m === 'object' && typeof m.name === 'string') : [];
    if(members.length>0){
      const container=document.querySelector('#players');
      container.innerHTML='';
      const minSec = 10, maxSec = 300;
      members.forEach(m=>{
        const wrapper=document.createElement('div');
        wrapper.classList.add('member-row-wrapper');
        wrapper.innerHTML=buildMemberRowHtml(m);
        container.appendChild(wrapper);
        const row = wrapper.querySelector('.member-row');
        // 保存値を優先渡し（範囲外でも generateMarchOptions が保持する）
        generateMarchOptions(row.querySelector('.march-select'), m.march, minSec, maxSec);
        attachRowEvents(row);
        attachSwipeToRow(row);
        refreshMemberAutoMarch(row, {save:false});
      });
    }
  }catch(e){}
}
['rally-min','prep-time']
.forEach(id=>{
  const el=document.getElementById(id);
  if(el) ['change','input'].forEach(ev=>el.addEventListener(ev,saveSettings));
});

// 旧形式で分かれていた履歴を1つに統合
function migrateHistoryData(){
  const history = loadHistory();
  const mergedItems = [];

  Object.entries(history).forEach(([key, items]) => {
    if(Array.isArray(items)) mergedItems.push(...items);
  });

  const unique = new Map();
  mergedItems.forEach(item => {
    if(!item || !item.name) return;
    const id = `${item.name.trim().toLowerCase()}|${item.marchSec}`;
    const previous = unique.get(id);
    if(!previous || (item.lastUsed || 0) > (previous.lastUsed || 0)) unique.set(id, item);
  });

  const unified = Array.from(unique.values())
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
    .slice(0, MAX_HISTORY_PER_KEY);
  saveHistory({all: unified});
}

updateMode();
loadSettings();
migrateHistoryData();
updateMemberRowHighlights(); // ペット発動中の行ハイライト初期化

window.addEventListener('scroll', hideAutocomplete, {passive:true});

// スワイプ状態をリセット（他の場所をタップした時）
document.addEventListener('click', (e) => {
  if(!e.target.closest('.autocomplete-dropdown') && !e.target.closest('.name-text')) hideAutocomplete();
  if(!e.target.closest('.member-row-wrapper') && !e.target.closest('.delete-bg')){
    document.querySelectorAll('#players .member-row').forEach(r => {
      if(r.style.transform && r.style.transform !== 'translateX(0px)'){
        r.style.transition = 'transform 0.2s ease';
        r.style.transform = 'translateX(0)';
      }
    });
  }
});


/* ======= プレビュー折りたたみ ======= */
const previewToggle = document.getElementById('preview-toggle');
const previewContent = document.getElementById('preview-content');
const previewArrow = document.getElementById('preview-arrow');
let previewExpanded = false;

previewContent.addEventListener('transitionend', function(){
  if(previewExpanded){
    previewContent.style.height = 'auto';
  }
});

previewToggle.addEventListener('click', function(){
  if(previewExpanded){
    // 閉じる
    const currentHeight = previewContent.scrollHeight;
    previewContent.style.height = currentHeight + 'px';
    previewContent.offsetHeight; // 強制リフロー
    previewContent.style.height = '0';
    previewContent.setAttribute('aria-hidden','true');
    previewArrow.classList.remove('is-open');
  }else{
    // 開く
    generateCopyMessage();
    const targetHeight = previewContent.scrollHeight;
    previewContent.style.height = targetHeight + 'px';
    previewContent.setAttribute('aria-hidden','false');
    previewArrow.classList.add('is-open');
  }
  previewExpanded = !previewExpanded;
});

// プレビュー本体タップでコピー（開閉トグルはヘッダー側のみが担当するため競合しない）
const previewInner = document.querySelector('#preview-content .collapsible-content-inner');
if(previewInner){
  previewInner.addEventListener('click', async function(){
    const previewText = document.getElementById('preview-text');
    const text = previewText ? previewText.textContent : '';
    if(!text) return;
    if(await copyText(text)) showToast();
  });
}

/* ======= ペット管理 ======= */
// ペットデータの構造: { name: string, status: 'waiting'|'active'|'ended', endTime?: timestamp }
function loadPets(){
  try{
    const data = JSON.parse(localStorage.getItem('pets') || '{}');
    if(!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, pet]) =>
      pet && typeof pet === 'object' && !Array.isArray(pet) &&
      ['waiting', 'active', 'ended'].includes(pet.status) &&
      (pet.status !== 'active' || (Number.isFinite(pet.endTime) && pet.endTime > 0))
    ));
  }catch(error){
    return {};
  }
}

function savePets(pets){
  localStorage.setItem('pets', JSON.stringify(pets));
}

function activatePet(name){
  resetAllSwipeStates();
  const pets = loadPets();
  const now = Date.now();
  const duration = 2 * 60 * 60 * 1000; // 2時間
  const endTime = now + duration;

  pets[name] = {
    status: 'active',
    endTime: endTime
  };
  
  savePets(pets);
  refreshAllMemberAutoMarchTimes();
  resetAllSwipeStates();
  showToast(`${name} ペット発動`);
}

function resetPetForMember(name){
  resetAllSwipeStates();
  const pets = loadPets();
  pets[name] = { status: 'waiting' };
  savePets(pets);
  refreshAllMemberAutoMarchTimes();
  resetAllSwipeStates();
  showToast(`${name} リセット`);
}


/* ======= ページ切り替え ======= */
function switchPage(pageId){
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.page-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  const btn = document.querySelector(`.page-tab-btn[data-page="${pageId}"]`);
  if(btn) btn.classList.add('active');
  document.body.classList.toggle('landing-active', pageId === 'page-landing');
  window.scrollTo(0, 0);
}

document.querySelectorAll('.page-tab-btn').forEach(btn => {
  btn.addEventListener('click', function(){
    switchPage(this.dataset.page);
  });
});

/* ======= 着弾時刻発行ページ ======= */
initLandingPage({nowMs:firebaseNow, landingRallyMinSel, landingPrepTimeSel, landingDiffMinSel, landingDiffSecSel, ensureSelectOption, marchLabel, copyText, flashResults, showToast});

/* ======= スイッチページ ======= */
initSwitchPage({nowMs:firebaseNow, swRallyMinSel, swFromNowInput, SWITCH_MARCH_SECONDS, copyText, flashResults, showToast});

/* ======= ペット通知システム ======= */
const petNotificationTimers = {};


function sendPetNotification(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  
  try {
    new Notification(title, {
      body: body,
      icon: '/dog-icon.png',
      badge: '/icon.png',
      tag: 'pet-timer-' + Date.now(),
      requireInteraction: false
    });
  } catch(e) {
    console.log('通知エラー:', e);
  }
}

function schedulePetNotifications(name, endTime) {
  cancelPetNotifications(name);
  
  const now = Date.now();
  const fiveMinBefore = endTime - (5 * 60 * 1000);
  
  petNotificationTimers[name] = [];
  
  if (fiveMinBefore > now) {
    const timer5min = setTimeout(() => {
      sendPetNotification(
        'ペット終了まであと5分',
        `${name} のペットスキルが5分後に終了します`
      );
    }, fiveMinBefore - now);
    petNotificationTimers[name].push(timer5min);
  }
  
  if (endTime > now) {
    const timerEnd = setTimeout(() => {
      sendPetNotification(
        'ペットスキル終了',
        `${name} のペットスキルが終了しました`
      );
    }, endTime - now);
    petNotificationTimers[name].push(timerEnd);
  }
}

function cancelPetNotifications(name) {
  if (petNotificationTimers[name]) {
    petNotificationTimers[name].forEach(timer => clearTimeout(timer));
    delete petNotificationTimers[name];
  }
}

function restoreNotificationsOnLoad() {
  const pets = loadPets();
  const now = Date.now();
  
  for (const name in pets) {
    const pet = pets[name];
    if (pet.status === 'active' && pet.endTime && pet.endTime > now) {
      schedulePetNotifications(name, pet.endTime);
    }
  }
}

const originalActivatePet = activatePet;
activatePet = function(name){
  if(!confirm(`${name}\nペット発動しますか？`)) return;
  originalActivatePet(name);
  const pets = loadPets();
  if(pets[name] && pets[name].endTime){
    schedulePetNotifications(name, pets[name].endTime);
  }
};

const originalResetPetForMember = resetPetForMember;
resetPetForMember = function(name){
  if(!confirm(`${name}\nリセットしますか？`)) return;
  cancelPetNotifications(name);
  originalResetPetForMember(name);
};

window.addEventListener('load', function() {
  restoreNotificationsOnLoad();
});

(function(){
  const players=document.getElementById('players');
  if(!players) return;
  function activate(wrapper){
    players.querySelectorAll('.member-row-wrapper.is-editing').forEach(el=>{ if(el!==wrapper) el.classList.remove('is-editing'); });
    wrapper?.classList.add('is-editing');
  }
  players.addEventListener('focusin',e=>activate(e.target.closest('.member-row-wrapper')));
  players.addEventListener('pointerdown',e=>activate(e.target.closest('.member-row-wrapper')));
  document.addEventListener('pointerdown',e=>{ if(!e.target.closest('#players')) players.querySelectorAll('.member-row-wrapper.is-editing').forEach(el=>el.classList.remove('is-editing')); },true);
})();


// Delegation covers both initial rows and rows added after settings restoration.
document.getElementById('players').addEventListener('click', event => {
  const deleteButton = event.target.closest('.delete-bg');
  if(deleteButton) deleteThisRow(deleteButton);
});
