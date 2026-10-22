import {pad2, calculateLanding} from '../domain/timing.js';

export function initLandingPage({landingRallyMinSel, landingPrepTimeSel, landingDiffMinSel, landingDiffSecSel, ensureSelectOption, marchLabel, copyText, flashResults, showToast}){
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

      const now    = new Date();
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
