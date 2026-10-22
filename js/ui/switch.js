import {pad2, calculateSwitchImpact} from '../domain/timing.js';

export function initSwitchPage({swRallyMinSel, swFromNowInput, SWITCH_MARCH_SECONDS, copyText, flashResults, showToast}){
  const swActionBtn = document.getElementById('sw-action-btn');
  if(!swActionBtn || !swRallyMinSel || !swFromNowInput) return;

  // 前回設定の復元
  const savedSwBase = parseInt(localStorage.getItem('switchBaseMarchSeconds'), 10);
  if(SWITCH_MARCH_SECONDS.includes(savedSwBase)){
    swRallyMinSel.value = String(savedSwBase);
  }
  const savedSwFromNow = parseInt(localStorage.getItem('switchFromNowSeconds'), 10);
  if(Number.isFinite(savedSwFromNow) && savedSwFromNow >= 1){
    swFromNowInput.value = String(savedSwFromNow);
  }
  swRallyMinSel.addEventListener('change', () => localStorage.setItem('switchBaseMarchSeconds', swRallyMinSel.value));
  swFromNowInput.addEventListener('change', () => localStorage.setItem('switchFromNowSeconds', swFromNowInput.value));

  function formatSwitchUtc(date){
    return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
  }

  function buildSwitchPreview(impactDate, entries){
    const lines = [];
    lines.push('今からスイッチします！');
    lines.push('該当の時刻に王城へ1軍部隊を送ってください。');
    lines.push('');
    lines.push('王城までの行軍 → 出発時刻');
    lines.push('');
    entries.forEach(e => {
      lines.push(`${`${e.march}秒`.padEnd(6, ' ')}→ ${e.timeStr} UTC`);
    });
    lines.push('━━━━━━━━━━━');
    lines.push(`着弾時刻：${formatSwitchUtc(impactDate)} UTC`);
    lines.push('');
    lines.push('端末を同期すると、');
    lines.push('ゲーム内で時計やカウントダウンを利用できます。');
    return lines.join('\n');
  }

  // 計算ボタン：計算＋プレビュー生成＋自動コピー
  swActionBtn.addEventListener('click', function(){
    const btn = this;
    const originalLabel = btn.textContent;
    btn.textContent = '計算中...';
    btn.disabled = true;

    setTimeout(async function(){
      const baseMarch = SWITCH_MARCH_SECONDS.includes(parseInt(swRallyMinSel.value, 10))
        ? parseInt(swRallyMinSel.value, 10) : 55;
      // 基準出発時刻が必ず未来になるよう最低1秒を確保
      const fromNowSec = Math.max(1, parseInt(swFromNowInput.value, 10) || 30);

      // 1. 押した瞬間のUTCを取得
      const now = new Date();
      // 2. 基準出発時刻 = 現在UTC + 今から○秒後
      const impact = new Date(calculateSwitchImpact(now.getTime(), fromNowSec, baseMarch));
      // 4. 各行軍秒数の出発時刻 = 着弾時刻 - 各行軍秒数
      const entries = SWITCH_MARCH_SECONDS.map(march => ({
        march,
        timeStr: formatSwitchUtc(new Date(impact.getTime() - march * 1000))
      }));

      document.getElementById('sw-impact-time').textContent = formatSwitchUtc(impact);
      document.getElementById('sw-result').style.display = 'block';

      // 5. チャット貼り付け用プレビューを生成
      const previewMsg = buildSwitchPreview(impact, entries);
      const previewText = document.getElementById('sw-preview-text');
      if(previewText) previewText.textContent = previewMsg;

      btn.textContent = originalLabel;
      btn.disabled = false;
      flashResults('#sw-result');

      // 6. プレビュー全文を自動でクリップボードにコピー
      const copied = await copyText(previewMsg);
      if(copied) showToast('✓ コピーしました');
    }, 600);
  });

  // プレビュー本体タップでコピー（開閉トグルはヘッダー側のみが担当するため競合しない）
  const swPreviewInner = document.querySelector('#sw-preview-content .collapsible-content-inner');
  if(swPreviewInner){
    swPreviewInner.addEventListener('click', async function(){
      const previewText = document.getElementById('sw-preview-text');
      const text = previewText ? previewText.textContent : '';
      if(!text) return;
      const copied = await copyText(text);
      if(copied) showToast('✓ コピーしました');
    });
  }

  // プレビュー折りたたみ（page-calcの実装と同じ挙動を独立実装）
  const swPreviewToggle = document.getElementById('sw-preview-toggle');
  const swPreviewContent = document.getElementById('sw-preview-content');
  const swPreviewArrow = document.getElementById('sw-preview-arrow');
  let swPreviewExpanded = false;
  if(swPreviewToggle && swPreviewContent && swPreviewArrow){
    swPreviewContent.addEventListener('transitionend', function(){
      if(swPreviewExpanded) swPreviewContent.style.height = 'auto';
    });
    swPreviewToggle.addEventListener('click', function(){
      if(swPreviewExpanded){
        const currentHeight = swPreviewContent.scrollHeight;
        swPreviewContent.style.height = currentHeight + 'px';
        swPreviewContent.offsetHeight; // 強制リフロー
        swPreviewContent.style.height = '0';
        swPreviewContent.setAttribute('aria-hidden','true');
        swPreviewArrow.classList.remove('is-open');
      }else{
        const targetHeight = swPreviewContent.scrollHeight;
        swPreviewContent.style.height = targetHeight + 'px';
        swPreviewContent.setAttribute('aria-hidden','false');
        swPreviewArrow.classList.add('is-open');
      }
      swPreviewExpanded = !swPreviewExpanded;
    });
  }
}
