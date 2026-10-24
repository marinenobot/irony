import {pad2, calculateLanding} from '../domain/timing.js';

const RALLY_PRESET_STORAGE_KEY = 'rallyPresetMinutesV1';
const DEFAULT_RALLY_PRESETS = Object.freeze([1, 2, 5, 10]);

function normalizeRallyPresets(values){
  const normalized = Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => parseInt(value, 10))
    .filter(value => Number.isFinite(value) && value >= 1 && value <= 120)))
    .slice(0, 4);

  DEFAULT_RALLY_PRESETS.forEach(value => {
    if(normalized.length < 4 && !normalized.includes(value)) normalized.push(value);
  });
  return normalized.slice(0, 4);
}

function loadRallyPresets(){
  try{
    const raw = localStorage.getItem(RALLY_PRESET_STORAGE_KEY);
    if(raw) return normalizeRallyPresets(JSON.parse(raw));
  }catch(_){}
  return [...DEFAULT_RALLY_PRESETS];
}

function saveRallyPresets(values){
  const presets = normalizeRallyPresets(values);
  try{
    localStorage.setItem(RALLY_PRESET_STORAGE_KEY, JSON.stringify(presets));
  }catch(_){}
  return presets;
}

function createRallyPresetEditor(onSave){
  let backdrop = document.getElementById('rally-preset-editor');
  if(backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.id = 'rally-preset-editor';
  backdrop.className = 'rally-preset-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="rally-preset-sheet" role="dialog" aria-modal="true" aria-label="集結時間プリセット設定">
      <div class="rally-preset-sheet-head">
        <button type="button" data-role="cancel">キャンセル</button>
        <strong>集結時間プリセット</strong>
        <button type="button" class="rally-preset-save" data-role="save">保存</button>
      </div>
      <div class="rally-preset-editor">
        ${[1,2,3,4].map(index => `<div class="rally-preset-editor-row"><label>プリセット ${index}</label><input type="number" inputmode="numeric" min="1" max="120" step="1" data-preset-index="${index - 1}"><span>分</span></div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => { backdrop.hidden = true; };
  backdrop.querySelector('[data-role="cancel"]').addEventListener('click', close);
  backdrop.addEventListener('click', event => { if(event.target === backdrop) close(); });
  backdrop.querySelector('[data-role="save"]').addEventListener('click', () => {
    const values = Array.from(backdrop.querySelectorAll('[data-preset-index]')).map(input => input.value);
    onSave(saveRallyPresets(values));
    close();
  });
  return backdrop;
}

function installRallyPresetCards({landingRallyMinSel, ensureSelectOption}){
  const castleRallyMinSel = document.getElementById('rally-min');
  const targets = [
    {row:document.getElementById('rally-row'), select:castleRallyMinSel, storageKey:null},
    {row:document.getElementById('l-rally-row'), select:landingRallyMinSel, storageKey:'landingRallyMin'}
  ].filter(target => target.row && target.select);
  if(!targets.length) return;

  let presets = loadRallyPresets();
  const cards = [];

  const ensurePresetOptions = target => {
    presets.forEach(value => ensureSelectOption(target.select, value, `${value}分`));
  };

  const selectPreset = (target, value) => {
    ensureSelectOption(target.select, value, `${value}分`);
    target.select.value = String(value);
    if(target.storageKey) localStorage.setItem(target.storageKey, String(value));
    target.select.dispatchEvent(new Event('change', {bubbles:true}));
  };

  const renderCards = () => {
    targets.forEach(ensurePresetOptions);
    cards.forEach(({card, target}) => {
      const grid = card.querySelector('.rally-preset-grid');
      grid.innerHTML = presets.map(value => `<button type="button" class="rally-preset-button" data-value="${value}">${value}分</button>`).join('');
      grid.querySelectorAll('.rally-preset-button').forEach(button => {
        button.addEventListener('click', event => {
          event.stopPropagation();
          selectPreset(target, parseInt(button.dataset.value, 10));
          renderCards();
        });
      });
      const selected = parseInt(target.select.value, 10);
      grid.querySelectorAll('.rally-preset-button').forEach(button => {
        button.classList.toggle('selected', parseInt(button.dataset.value, 10) === selected);
      });
    });
  };

  const editor = createRallyPresetEditor(next => {
    presets = next;
    renderCards();
  });

  const openEditor = () => {
    editor.querySelectorAll('[data-preset-index]').forEach((input, index) => { input.value = presets[index] ?? ''; });
    editor.hidden = false;
  };

  const quickMenuMain = document.querySelector('#clock-quick-menu .clock-quick-menu-main');
  if(quickMenuMain && !document.getElementById('quick-rally-presets-btn')){
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'quick-rally-presets-btn';
    button.className = 'clock-quick-menu-item';
    button.setAttribute('role', 'menuitem');
    button.innerHTML = '<span class="clock-quick-menu-title">集結時間プリセット</span><span class="clock-quick-menu-chevron" aria-hidden="true">›</span>';
    quickMenuMain.appendChild(button);
    button.addEventListener('click', () => {
      const menu = document.getElementById('clock-quick-menu');
      const settingsButton = document.getElementById('app-settings-button');
      menu?.classList.remove('show');
      menu?.setAttribute('aria-hidden', 'true');
      settingsButton?.setAttribute('aria-expanded', 'false');
      openEditor();
    });
  }

  targets.forEach(target => {
    if(target.row.previousElementSibling?.classList.contains('rally-preset-card')) return;
    const card = document.createElement('div');
    card.className = 'rally-preset-card';
    card.innerHTML = '<div class="rally-preset-title">集結時間</div><div class="rally-preset-grid"></div>';
    target.row.parentElement.insertBefore(card, target.row);
    target.row.hidden = true;
    target.select.addEventListener('change', renderCards);
    cards.push({card, target});
  });

  renderCards();
}

export function initLandingPage({nowMs = Date.now, landingRallyMinSel, landingPrepTimeSel, landingDiffMinSel, landingDiffSecSel, ensureSelectOption, marchLabel, copyText, flashResults, showToast}){
  const savedLandingRally = parseInt(localStorage.getItem('landingRallyMin'));
  const savedLandingPrep = parseInt(localStorage.getItem('landingPrepTime'));
  const savedLandingDiff = parseInt(localStorage.getItem('landingDiffSeconds'));
  if(Number.isFinite(savedLandingRally)){
    ensureSelectOption(landingRallyMinSel, savedLandingRally, `${savedLandingRally}分`);
  }
  if(Number.isFinite(savedLandingPrep)){
    ensureSelectOption(landingPrepTimeSel, savedLandingPrep, marchLabel(savedLandingPrep));
  }
  if(Number.isFinite(savedLandingDiff)){
    const diffMinutes = Math.floor(savedLandingDiff / 60);
    const diffSeconds = savedLandingDiff % 60;
    ensureSelectOption(landingDiffMinSel, diffMinutes, `${diffMinutes}分`);
    ensureSelectOption(landingDiffSecSel, diffSeconds, `${diffSeconds}秒`);
  }
  landingRallyMinSel.addEventListener('change', () => localStorage.setItem('landingRallyMin', landingRallyMinSel.value));
  landingPrepTimeSel.addEventListener('change', () => localStorage.setItem('landingPrepTime', landingPrepTimeSel.value));
  const saveLandingDiff = () => {
    const totalSeconds = (parseInt(landingDiffMinSel.value) || 0) * 60 + (parseInt(landingDiffSecSel.value) || 0);
    localStorage.setItem('landingDiffSeconds', String(totalSeconds));
  };
  landingDiffMinSel.addEventListener('change', saveLandingDiff);
  landingDiffSecSel.addEventListener('change', saveLandingDiff);

  installRallyPresetCards({landingRallyMinSel, ensureSelectOption});

  // コピー共通処理
  async function doCopy(timeStr, timeStr2){
    const rallyMin = parseInt(document.getElementById('l-rally-min').value) || 1;
    let text;
    if(timeStr2){
      text = `${rallyMin}分集結お願いします。🙇‍♂️\n①【${timeStr} UTC】着弾\n②【${timeStr2} UTC】着弾`;
    } else {
      text = `${rallyMin}分集結お願いします。🙇‍♂️\n【${timeStr} UTC】着弾\u3000`;
    }
    if(await copyText(text)){
      flashResults('#l-result');
      showToast();
    }
  }

  // 計算ボタン：計算＋自動コピー
  document.getElementById('l-action-btn').addEventListener('click', function(){
    const btn = this;
    btn.textContent = '計算中...';
    btn.disabled = true;

    setTimeout(function(){
      const prepValue = parseInt(document.getElementById('l-from-now').value, 10);
      const fromNow = Number.isFinite(prepValue) && prepValue >= 0 ? prepValue : 30;
      const rallyMin = parseInt(document.getElementById('l-rally-min').value) || 1;
      const diffMin  = parseInt(document.getElementById('l-diff-min').value) || 0;
      const diffSec  = parseInt(document.getElementById('l-diff-sec').value) || 0;
      const diffTotalSeconds = diffMin * 60 + diffSec;
      const twoWave  = diffTotalSeconds !== 0;

      const now    = new Date(nowMs());
      const target = new Date(calculateLanding(now.getTime(), fromNow, rallyMin));
      const timeStr = `${pad2(target.getUTCHours())}:${pad2(target.getUTCMinutes())}:${pad2(target.getUTCSeconds())}`;

      // 1発目ラベル切替
      document.getElementById('l-result-label').textContent = twoWave ? '① 着弾' : '着弾時刻';
      document.getElementById('l-result-time').textContent = timeStr;
      document.getElementById('l-result').style.display = 'block';

      // 2発目
      let timeStr2 = null;
      if(twoWave){
        const target2 = new Date(target.getTime() + diffTotalSeconds * 1000);
        timeStr2 = `${pad2(target2.getUTCHours())}:${pad2(target2.getUTCMinutes())}:${pad2(target2.getUTCSeconds())}`;
        document.getElementById('l-result-time2').textContent = timeStr2;
        document.getElementById('l-result2-row').style.display = 'block';
      } else {
        document.getElementById('l-result2-row').style.display = 'none';
      }

      btn.textContent = '計算開始';
      btn.disabled = false;

      doCopy(timeStr, timeStr2);
    }, 0);
  });
}
