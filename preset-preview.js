const STORAGE_KEY='arrivalPresetPreview:rallyMinutes';
const DEFAULT_PRESETS=[1,2,5,10];
let presets=loadPresets();
let selected={landing:5,castle:5};
let prepSeconds=55;
let diffSeconds=0;
let fromNowSeconds=30;

function loadPresets(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(Array.isArray(raw) && raw.length===4 && raw.every(v=>Number.isFinite(Number(v)) && Number(v)>0)) return raw.map(Number);
  }catch(_){}
  return [...DEFAULT_PRESETS];
}
function savePresets(values){
  presets=values;
  localStorage.setItem(STORAGE_KEY,JSON.stringify(values));
  if(!presets.includes(selected.landing)) selected.landing=presets[0];
  if(!presets.includes(selected.castle)) selected.castle=presets[0];
  renderPresetBars();
}
function formatMinutes(value){
  const total=Math.round(Number(value)*60);
  const m=Math.floor(total/60),s=total%60;
  if(s===0) return `${m}分`;
  if(m===0) return `${s}秒`;
  return `${m}分${s}秒`;
}
function formatSeconds(value){
  const sign=value<0?'−':'';
  const abs=Math.abs(value),m=Math.floor(abs/60),s=abs%60;
  if(m&&s) return `${sign}${m}分${s}秒`;
  if(m) return `${sign}${m}分`;
  return `${sign}${s}秒`;
}
function renderPresetBar(id,page){
  const el=document.getElementById(id);
  el.innerHTML='';
  presets.forEach(value=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='preset-btn'+(selected[page]===value?' active':'');
    btn.textContent=formatMinutes(value);
    btn.addEventListener('click',()=>{selected[page]=value;renderPresetBars();});
    el.appendChild(btn);
  });
}
function renderPresetBars(){
  renderPresetBar('landingPresetBar','landing');
  renderPresetBar('castlePresetBar','castle');
}
function renderValues(){
  document.getElementById('prepValue').textContent=formatSeconds(prepSeconds);
  document.getElementById('diffValue').textContent=formatSeconds(diffSeconds);
  document.getElementById('fromNowValue').textContent=`${formatSeconds(fromNowSeconds)}後`;
}
function formatUtc(date){
  return [date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
}
function calculate(page){
  const now=Date.now();
  let seconds=selected[page]*60;
  if(page==='landing') seconds+=prepSeconds+diffSeconds;
  if(page==='castle') seconds+=fromNowSeconds;
  document.getElementById(page+'Result').textContent=formatUtc(new Date(now+seconds*1000));
}
function openSettings(){
  const editor=document.getElementById('presetEditor');
  editor.innerHTML='';
  presets.forEach((value,index)=>{
    const row=document.createElement('div');
    row.className='preset-row';
    row.innerHTML=`<label>プリセット ${index+1}</label><input type="number" inputmode="decimal" min="0.1" step="0.1" value="${value}" aria-label="プリセット${index+1}の分数"><span>分</span>`;
    editor.appendChild(row);
  });
  document.getElementById('settingsSheet').hidden=false;
}
function closeSettings(){document.getElementById('settingsSheet').hidden=true;}

document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el===btn));
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===btn.dataset.page));
}));
document.querySelectorAll('[data-step]').forEach(btn=>btn.addEventListener('click',()=>{
  const dir=Number(btn.dataset.dir);
  if(btn.dataset.step==='prep') prepSeconds=Math.max(0,prepSeconds+dir*5);
  if(btn.dataset.step==='diff') diffSeconds=Math.max(-300,Math.min(300,diffSeconds+dir*5));
  if(btn.dataset.step==='fromNow') fromNowSeconds=Math.max(0,fromNowSeconds+dir*5);
  renderValues();
}));
document.getElementById('landingCalc').addEventListener('click',()=>calculate('landing'));
document.getElementById('castleCalc').addEventListener('click',()=>calculate('castle'));
document.getElementById('settingsBtn').addEventListener('click',openSettings);
document.getElementById('settingsClose').addEventListener('click',closeSettings);
document.getElementById('settingsSave').addEventListener('click',()=>{
  const values=[...document.querySelectorAll('#presetEditor input')].map(input=>Number(input.value));
  if(values.some(v=>!Number.isFinite(v)||v<=0)) return;
  savePresets(values);
  closeSettings();
});
document.getElementById('resetPresets').addEventListener('click',()=>{
  [...document.querySelectorAll('#presetEditor input')].forEach((input,i)=>input.value=DEFAULT_PRESETS[i]);
});
document.getElementById('settingsSheet').addEventListener('click',e=>{if(e.target.id==='settingsSheet') closeSettings();});

function tick(){
  const now=new Date();
  document.getElementById('utcClock').textContent=formatUtc(now);
}
renderPresetBars();
renderValues();
tick();
setInterval(tick,1000);
