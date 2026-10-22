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

function injectRallyPresetStyles(){
  if(document.getElementById('rally-preset-style')) return;
  const style = document.createElement('style');
  style.id = 'rally-preset-style';
  style.textContent = `
    .rally-preset-card{margin-bottom:10px;padding:14px;background:var(--card-bg,#fff);border:1px solid var(--border-color,#d8d8dc);border-radius:12px}
    .rally-preset-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .rally-preset-title{font-size:13px;font-weight:700;color:inherit}
    .rally-preset-settings{border:0;background:transparent;padding:4px 2px;color:#777;font-size:12px;font-weight:600}
    .rally-preset-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
    .rally-preset-button{min-width:0;height:42px;border:1px solid #cfcfd4;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;white-space:nowrap}
    .rally-preset-button.selected{background:#1d1d1f;border-color:#1d1d1f;color:#fff}
    #rally-row[hidden],#l-rally-row[hidden]{display:none!important}
    .rally-preset-backdrop{position:fixed;inset:0;z-index:2200;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.28)}
    .rally-preset-backdrop[hidden]{display:none}
    .rally-preset-sheet{width:min(100%,430px);background:#f7f7f9;border-radius:18px 18px 0 0;padding:12px 14px max(22px,env(safe-area-inset-bottom));box-shadow:0 -10px 32px rgba(0,0,0,.14)}
    .rally-preset-sheet-head{display:grid;grid-template-columns:60px 1fr 60px;align-items:center;height:38px}
    .rally-preset-sheet-head strong{text-align:center;font-size:16px}
    .rally-preset-sheet-head button{border:0;background:transparent;font:inherit;font-size:13px;color:#666;padding:6px 0}
    .rally-preset-sheet-head .rally-preset-save{font-weight:700;color:inherit}
    .rally-preset-editor{display:grid;gap:8px;margin-top:12px}
    .rally-preset-editor-row{display:grid;grid-template-columns:74px 1fr 26px;align-items:center;gap:8px;padding:8px 10px;background:#fff;border:1px solid #dedee3;border-radius:10px}
    .rally-preset-editor-row label{font-size:13px;color:#777}
    .rally-preset-editor-row input{width:100%;height:36px;border:1px solid #d0d0d5;border-radius:8px;background:#fff;color:#1d1d1f;padding:0 10px;font:inherit;text-align:right}
    .rally-preset-editor-row span{font-size:13px;color:#777}
    [data-theme="dark"] .rally-preset-card{background:#1c1c1e;border-color:#343438}
    [data-theme="dark"] .rally-preset-button{border-color:#4a4a4f}
    [data-theme="dark"] .rally-preset-button.selected{background:#f2f2f7;border-color:#f2f2f7;color:#111}
    [data-theme="dark"] .rally-preset-sheet{background:#18181b;color:#f5f5f7}
    [data-theme="dark"] .rally-preset-editor-row{background:#242428;border-color:#3a3a3f}
    [data-theme="dark"] .rally-preset-editor-row input{background:#18181b;border-color:#48484d;color:#f5f5f7}
  `;
  document.head.appendChild(style);
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
  injectRallyPresetStyles();
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

  targets.forEach(target => {
    if(target.row.previousElementSibling?.classList.contains('rally-preset-card')) return;
    const card = document.createElement('div');
    card.className = 'rally-preset-card';
    card.innerHTML = `<div class="rally-preset-head"><span class="rally-preset-title">集結時間</span><button type="button" class="rally-preset-settings">設定</button></div><div class="rally-preset-grid"></div>`;
    target.row.parentElement.insertBefore(card, target.row);
    target.row.hidden = true;
    card.querySelector('.rally-preset-settings').addEventListener('click', event => {
      event.stopPropagation();
      openEditor();
    });
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
    }, 600);
  });

}
