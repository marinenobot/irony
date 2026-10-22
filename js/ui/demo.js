import {pad2} from '../domain/timing.js';

export function initGuidedDemo({formatRemainingSeconds, setClockQuickMenu}){
  const finger = document.getElementById('demo-finger');
  const caption = document.getElementById('demo-caption');
  const skipBtn = document.getElementById('demo-skip');
  const replayBtn = document.getElementById('demo-replay');
  const miniClock = document.getElementById('demo-mini-clock');
  const miniTime = document.getElementById('demo-mini-time');
  const miniCountdown = document.getElementById('demo-mini-countdown');
  const miniName = document.getElementById('demo-mini-name');
  const miniValue = document.getElementById('demo-mini-value');
  const syncList = document.getElementById('demo-sync-list');
  const syncListItem = syncList ? syncList.querySelector('.demo-sync-list-item') : null;
  if(!finger || !caption || !skipBtn || !replayBtn || !miniClock || !syncList || !syncListItem) return;

  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || location.search.includes('forceDemo=1');
  const seenKey = 'rallyGuidedDemoSeenV1';
  if(!isIOS) return;

  const DEMO_NAME = 'マリン';

  let playToken = 0;
  let clockTimerId = null;

  function wait(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
  function centerOf(el){ const r = el.getBoundingClientRect(); return {x:r.left + r.width/2, y:r.top + r.height/2}; }
  function moveFingerTo(x,y){ finger.style.left = x+'px'; finger.style.top = y+'px'; }
  function tapFinger(){ finger.classList.remove('tap'); void finger.offsetWidth; finger.classList.add('tap'); }
  function showCaption(text){ caption.textContent = text; caption.classList.add('show'); }
  function hideCaption(){ caption.classList.remove('show'); }

  function startMiniClockTicker(){
    stopMiniClockTicker();
    const tick = () => {
      const d = new Date();
      miniTime.textContent = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
    };
    tick();
    clockTimerId = setInterval(tick, 1000);
  }
  function stopMiniClockTicker(){
    if(clockTimerId){ clearInterval(clockTimerId); clockTimerId = null; }
  }

  function morphClockToPip(){
    const clock = document.getElementById('utc-clock-trigger');
    const rect = clock.getBoundingClientRect();
    miniClock.style.transition = 'none';
    miniClock.style.top = rect.top + 'px';
    miniClock.style.left = rect.left + 'px';
    miniClock.style.width = rect.width + 'px';
    miniClock.style.height = rect.height + 'px';
    miniClock.style.borderRadius = '18px';
    miniClock.style.background = '#ffffff';
    miniTime.style.color = '#1c1c1e';
    miniClock.classList.add('show');
    startMiniClockTicker();
    void miniClock.getBoundingClientRect();
    requestAnimationFrame(() => {
      miniClock.style.transition = '';
      const w = 128, h = 76;
      miniClock.style.top = (window.innerHeight - h - Math.max(28, window.innerHeight * 0 + 28)) + 'px';
      miniClock.style.left = (window.innerWidth - w - 16) + 'px';
      miniClock.style.width = w + 'px';
      miniClock.style.height = h + 'px';
      miniClock.style.borderRadius = '16px';
      miniClock.style.background = '#1c1c1e';
      miniTime.style.color = '#ffffff';
    });
  }

  function swapMiniClockToCountdown(){
    stopMiniClockTicker();
    miniTime.hidden = true;
    miniCountdown.hidden = false;
    miniName.textContent = DEMO_NAME;
  }

  function positionSyncListNear(el){
    const r = el.getBoundingClientRect();
    syncList.style.left = 'auto';
    syncList.style.right = (window.innerWidth - r.right) + 'px';
    syncList.style.top = (r.bottom + 6) + 'px';
  }

  function runFastCountdown(token){
    return new Promise(resolve => {
      let v = 9.8;
      miniValue.textContent = formatRemainingSeconds(v * 1000);
      const id = setInterval(() => {
        if(token !== playToken){ clearInterval(id); resolve(); return; }
        v -= 0.35 + Math.random() * 0.3;
        if(v <= 0.4){
          miniValue.textContent = formatRemainingSeconds(400);
          clearInterval(id);
          resolve();
          return;
        }
        miniValue.textContent = formatRemainingSeconds(v * 1000);
      }, 90);
    });
  }

  function resetVisualState(){
    finger.classList.remove('show', 'tap');
    miniClock.classList.remove('show');
    miniClock.removeAttribute('style');
    miniTime.removeAttribute('style');
    miniTime.hidden = false;
    miniCountdown.hidden = true;
    syncList.classList.remove('show');
    syncList.removeAttribute('style');
    hideCaption();
    stopMiniClockTicker();
    if(typeof setClockQuickMenu === 'function') setClockQuickMenu(false);
  }

  function endDemo(){
    resetVisualState();
    skipBtn.hidden = true;
    replayBtn.hidden = false;
    localStorage.setItem(seenKey, '1');
  }

  async function play(){
    const myToken = ++playToken;
    const alive = () => myToken === playToken;

    resetVisualState();
    skipBtn.hidden = false;
    replayBtn.hidden = true;

    await wait(500); if(!alive()) return;

    const clock = document.getElementById('utc-clock-trigger');
    let p = centerOf(clock);
    moveFingerTo(p.x, p.y);
    finger.classList.add('show');
    await wait(650); if(!alive()) return;
    tapFinger();
    await wait(300); if(!alive()) return;

    morphClockToPip();
    showCaption('時計をタップすると小窓（PiP）表示になります');
    await wait(1700); if(!alive()) return;
    hideCaption();

    const menuBtn = document.getElementById('app-settings-button');
    p = centerOf(menuBtn);
    moveFingerTo(p.x, p.y);
    await wait(550); if(!alive()) return;
    tapFinger();
    if(typeof setClockQuickMenu === 'function') setClockQuickMenu(true);
    await wait(350); if(!alive()) return;

    const syncBtn = document.getElementById('quick-sync-btn');
    p = centerOf(syncBtn);
    moveFingerTo(p.x, p.y);
    showCaption('「…」から端末同期でメンバーと出発時刻を合わせられます');
    await wait(650); if(!alive()) return;
    tapFinger();
    await wait(250); if(!alive()) return;
    if(typeof setClockQuickMenu === 'function') setClockQuickMenu(false);
    positionSyncListNear(menuBtn);
    syncList.classList.add('show');
    await wait(400); if(!alive()) return;

    p = centerOf(syncListItem);
    moveFingerTo(p.x, p.y);
    hideCaption();
    await wait(600); if(!alive()) return;
    tapFinger();
    await wait(250); if(!alive()) return;
    syncList.classList.remove('show');
    finger.classList.remove('show');

    swapMiniClockToCountdown();
    showCaption('同期が完了すると出発までのカウントダウン表示に変わります');
    await runFastCountdown(myToken); if(!alive()) return;

    await wait(1600); if(!alive()) return;
    endDemo();
  }

  skipBtn.addEventListener('click', () => { playToken++; endDemo(); });
  replayBtn.addEventListener('click', () => { play(); });

  if(localStorage.getItem(seenKey) !== '1'){
    requestAnimationFrame(() => { play(); });
  }
}
