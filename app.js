/* ════════════════════════════════════════════
   TIMEFLOW — app.js
   Même fonctionnement que l'Annuaire KPI :
   • Login simple (nom/identifiant)
   • Stockage localStorage
   • Sync Firebase optionnelle via code
════════════════════════════════════════════ */

/* ── ÉTAT GLOBAL ── */
let currentUser = localStorage.getItem('tfUser');
let S = { punches:{}, contracts:[], settings:{ name:'', weekTarget:35, breakThreshold:6, breakDuration:30 }, badges:{} };
let calY, calM;
let _prevDayEarn = 0, _prevMonthEarn = 0;

/* ── DOM ── */
const loginScreen    = document.getElementById('loginScreen');
const appShell       = document.getElementById('appShell');
const loginBtn       = document.getElementById('loginBtn');
const usernameInput  = document.getElementById('usernameInput');
const logoutBtn      = document.getElementById('logoutBtn');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const toastEl        = document.getElementById('toast');
const syncSettingsBtn= document.getElementById('syncSettingsBtn');
const syncModal      = document.getElementById('syncModal');

/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
let _tt;
function showToast(msg, duration=2400) {
  clearTimeout(_tt);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  _tt = setTimeout(() => toastEl.classList.remove('show'), duration);
}

/* ════════════════════════════════════════════
   LOGIN / LOGOUT
════════════════════════════════════════════ */
function login(user) {
  currentUser = user;
  localStorage.setItem('tfUser', user);
  loginScreen.style.display = 'none';
  appShell.style.display = 'flex';
  document.getElementById('userInfo').textContent   = user;
  document.getElementById('userAvatar').textContent = user.charAt(0).toUpperCase();
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('collapsed');
  loadState();
  initApp();
  try { connectSync(false); } catch(e) { console.error('connectSync:', e); }
}

loginBtn.addEventListener('click', () => {
  const u = usernameInput.value.trim();
  if (!u) { usernameInput.focus(); return; }
  login(u);
});
usernameInput.addEventListener('keydown', e => { if (e.key==='Enter') loginBtn.click(); });

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('tfUser');
  currentUser = null;
  S = { punches:{}, contracts:[], settings:{ name:'', weekTarget:35, breakThreshold:6, breakDuration:30 }, badges:{} };
  appShell.style.display = 'none';
  loginScreen.style.display = 'flex';
  usernameInput.value = '';
});

/* ════════════════════════════════════════════
   SIDEBAR
════════════════════════════════════════════ */
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
  if (window.innerWidth <= 768)
    sidebarOverlay.classList.toggle('show', !sb.classList.contains('collapsed'));
}
sidebarOverlay?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('collapsed');
  sidebarOverlay.classList.remove('show');
});

/* ════════════════════════════════════════════
   PERSISTANCE LOCALE
════════════════════════════════════════════ */
const LS_KEY = () => 'tf_data_' + currentUser;

function saveState() {
  localStorage.setItem(LS_KEY(), JSON.stringify(S));
  scheduleAutoSync();
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY());
    if (raw) S = { ...S, ...JSON.parse(raw) };
  } catch(e) {}
}

/* ════════════════════════════════════════════
   UTILS
════════════════════════════════════════════ */
const pad = (n,l=2) => String(n).padStart(l,'0');
const todayKey  = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`; };
const fmtDate   = d  => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fmtTime   = d  => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtTimeFull = d=> `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const parseT    = s  => { if(!s)return 0; const[h,m]=s.split(':').map(Number); return h*60+m; };
const minToHM   = m  => `${Math.floor(m/60)}h${pad(Math.floor(m%60))}`;
const secToHMS  = s  => `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;
const fmtMoney  = n  => n.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';

function calcDay(day, cfg) {
  cfg = cfg || S.settings;
  if (!day) return { gross:0, net:0, breakApplied:false, breakMin:0 };
  let g = 0;
  if (day.em&&day.sm) g += parseT(day.sm)-parseT(day.em);
  if (day.ea&&day.es) g += parseT(day.es)-parseT(day.ea);
  const thr=(parseFloat(cfg.breakThreshold)||6)*60, bDur=parseFloat(cfg.breakDuration)||30;
  const bA=g>=thr;
  return { gross:g, net:Math.max(0,g-(bA?bDur:0)), breakApplied:bA, breakMin:bA?bDur:0 };
}
function getContract(ds) {
  return S.contracts.find(c=>{
    return (!c.startDate||c.startDate<=ds)&&(!c.endDate||c.endDate>=ds);
  })||null;
}
function calcEarn(ds, day) {
  const c=getContract(ds); if(!c)return{earn:0,rate:0};
  const{net}=calcDay(day), h=net/60, rate=parseFloat(c.hourlyRate)||0;
  let earn=h*rate;
  const ot=parseFloat(c.overtimeThreshold)||0, or2=parseFloat(c.overtimeRate)||1.25;
  if(ot>0&&h>ot) earn=ot*rate+(h-ot)*rate*or2;
  return{earn,rate};
}
function calcStreak() {
  let s=0; const d=new Date();
  for(let i=0;i<400;i++){
    const k=fmtDate(d),dow=d.getDay();
    if(dow===0||dow===6){d.setDate(d.getDate()-1);continue;}
    if(S.punches[k]&&(S.punches[k].em||S.punches[k].es)){s++;d.setDate(d.getDate()-1);}
    else break;
  }
  return s;
}
const CONTRACT_TYPES=['CDI','CDD','Intérim','Freelance','Stage','Alternance','Autre'];

/* ════════════════════════════════════════════
   CLOCK — chaque seconde
════════════════════════════════════════════ */
setInterval(() => {
  const cl = document.getElementById('liveClock');
  if (cl) cl.textContent = fmtTimeFull(new Date());
  updateLiveCounters();
}, 1000);

/* ════════════════════════════════════════════
   LIVE COUNTERS
════════════════════════════════════════════ */
function calcLiveDayEarn() {
  const key=todayKey(), day=S.punches[key]||{};
  const c=getContract(key); if(!c)return 0;
  const rate=parseFloat(c.hourlyRate)||0; if(!rate)return 0;
  const now=new Date(), nowSec=now.getHours()*3600+now.getMinutes()*60+now.getSeconds();
  const bThreshSec=(parseFloat(S.settings.breakThreshold)||6)*3600;
  const bDurSec=(parseFloat(S.settings.breakDuration)||30)*60;
  let totalSec=0;
  if(day.em){const e=day.sm?parseT(day.sm)*60:nowSec;totalSec+=Math.max(0,(day.sm?e:nowSec)-parseT(day.em)*60);}
  if(day.ea){const e=day.es?parseT(day.es)*60:nowSec;totalSec+=Math.max(0,e-parseT(day.ea)*60);}
  if(totalSec>=bThreshSec)totalSec=Math.max(0,totalSec-bDurSec);
  const h=totalSec/3600, ot=parseFloat(c.overtimeThreshold)||0, or2=parseFloat(c.overtimeRate)||1.25;
  return Math.max(0, ot>0&&h>ot ? ot*rate+(h-ot)*rate*or2 : h*rate);
}

function calcLiveMonthEarn() {
  const now=new Date(), yr=now.getFullYear(), mo=now.getMonth(), todayStr=todayKey();
  let total=0;
  Object.entries(S.punches).forEach(([k,day])=>{
    const d=new Date(k);
    if(d.getFullYear()!==yr||d.getMonth()!==mo)return;
    total += k===todayStr ? calcLiveDayEarn() : calcEarn(k,day).earn;
  });
  if(!S.punches[todayStr])total+=calcLiveDayEarn();
  return total;
}

function updateLiveCounters() {
  const key=todayKey(), day=S.punches[key]||{};
  const now=new Date(), nowM=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
  let totalSec=0;
  if(day.em)totalSec+=((day.sm?parseT(day.sm):(day.es?parseT(day.es):nowM))-parseT(day.em))*60;
  if(day.ea)totalSec+=((day.es?parseT(day.es):nowM)-parseT(day.ea))*60;
  totalSec=Math.floor(Math.max(0,totalSec));
  let status='idle';
  if(day.es)status='done';else if(day.ea)status='working';else if(day.sm)status='paused';else if(day.em)status='working';

  const elEl=document.getElementById('elapsedDisp'), stEl=document.getElementById('heroStatus'), stTxt=document.getElementById('heroSTxt');
  if(elEl){elEl.className='elapsed'+(status==='working'?' active':'');elEl.textContent=secToHMS(totalSec);}
  if(stEl){
    stEl.className='hero-status hs-'+status;
    stTxt.textContent={idle:'En attente',working:'En cours',paused:'Pause déjeuner',done:'Journée terminée'}[status];
  }
  const dayEarn=calcLiveDayEarn(), monthEarn=calcLiveMonthEarn();
  const c=getContract(key), rate=c?parseFloat(c.hourlyRate)||0:0;
  const earnEl=document.getElementById('todayEarnLive');
  if(earnEl){
    earnEl.textContent=fmtMoney(dayEarn);
    if(status==='working'&&Math.floor(dayEarn*100)!==Math.floor(_prevDayEarn*100)){
      earnEl.classList.remove('ticking');void earnEl.offsetWidth;earnEl.classList.add('ticking');
    }
    _prevDayEarn=dayEarn;
  }
  const rateEl=document.getElementById('liveRateDisp');
  if(rateEl)rateEl.textContent=rate>0&&status==='working'?`${rate.toFixed(2)} €/h · +${(rate/3600).toFixed(4)} €/sec`:'';
  const monthEl=document.getElementById('sm-e');
  if(monthEl){
    monthEl.textContent=fmtMoney(monthEarn);
    if(status==='working'&&Math.floor(monthEarn*100)!==Math.floor(_prevMonthEarn*100)){
      monthEl.classList.remove('bump');void monthEl.offsetWidth;monthEl.classList.add('bump');
    }
    _prevMonthEarn=monthEarn;
  }
  const target=(parseFloat(S.settings.weekTarget)||35)*4*rate;
  const fill=document.getElementById('monthProgressFill');
  if(fill&&target>0)fill.style.width=Math.min(100,(monthEarn/target)*100)+'%';
  const smS=document.getElementById('sm-s');
  if(smS)smS.textContent=now.toLocaleString('fr-FR',{month:'long',year:'numeric'});
}

/* ════════════════════════════════════════════
   PUNCH
════════════════════════════════════════════ */
function punch(type, e) {
  const key=todayKey(), day=S.punches[key]||{};
  if(day[type]){showToast('⚠️ Déjà pointé !');return;}
  const t=fmtTime(new Date());
  S.punches[key]={...day,[type]:t,manual:false};
  saveState();
  const labs={em:'Entrée matin',sm:'Sortie midi',ea:'Entrée après-midi',es:'Sortie soir'};
  showToast(`✅ ${labs[type]} — ${t}`);
  confetti(e);
  updatePunchBtns();updateTimeline();updateDashStats();checkBadges();
}

function updatePunchBtns() {
  const day=S.punches[todayKey()]||{};
  const deps={em:[],sm:['em'],ea:['sm'],es:['ea']};
  ['em','sm','ea','es'].forEach(t=>{
    const btn=document.getElementById('btn-'+t),pt=document.getElementById('pt-'+t);
    if(!btn)return;
    if(day[t]){btn.disabled=true;btn.style.opacity='.55';if(pt)pt.textContent=day[t];}
    else{const ok=deps[t].every(d=>day[d]);btn.disabled=!ok;btn.style.opacity=ok?'1':'';if(pt)pt.textContent='';}
  });
}

/* ════════════════════════════════════════════
   TIMELINE
════════════════════════════════════════════ */
function updateTimeline() {
  const key=todayKey(),day=S.punches[key]||{};
  const el=document.getElementById('todayTL');
  if(!el)return;
  const items=[{k:'em',l:'Entrée matin',ic:'☀️',cls:'td-neon'},{k:'sm',l:'Sortie midi',ic:'🌤',cls:'td-gold'},{k:'ea',l:'Entrée après-midi',ic:'🌇',cls:'td-blue'},{k:'es',l:'Sortie soir',ic:'🌙',cls:'td-red'}];
  let html=items.map(i=>`<div class="tl-item"><div class="tl-dot ${day[i.k]?i.cls:'td-empty'}">${i.ic}</div><div class="tl-content"><div class="tl-lbl">${i.l}</div>${day[i.k]?`<div class="tl-time">${day[i.k]}</div>`:`<div class="tl-pend">— non pointé</div>`}</div></div>`).join('');
  if(day.em||day.es){
    const{net,breakApplied,breakMin}=calcDay(day),{earn}=calcEarn(key,day);
    html+=`<div style="margin-top:8px;background:var(--surface2);border-radius:9px;padding:9px 12px;border:1px solid var(--border2)"><div style="display:flex;justify-content:space-between"><span style="font-size:11px;color:var(--text2)">⏱ Net${breakApplied?` (−${breakMin}min)`:''}</span><span style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--neon)">${minToHM(net)}</span></div>${earn>0?`<div style="display:flex;justify-content:space-between;margin-top:3px"><span style="font-size:11px;color:var(--text2)">💰 Gains</span><span style="font-family:'Sora',sans-serif;font-weight:700;color:var(--gold)">${fmtMoney(earn)}</span></div>`:''}</div>`;
  }
  el.innerHTML=html;
}

/* ════════════════════════════════════════════
   DASHBOARD STATS
════════════════════════════════════════════ */
function updateDashStats() {
  const now=new Date(),dow=now.getDay()||7;
  let wMin=0,wEarn=0,wDays=0;
  for(let i=1;i<=7;i++){
    const d=new Date(now);d.setDate(now.getDate()-dow+i);
    const k=fmtDate(d),day=S.punches[k];
    if(day&&(day.em||day.es)){wMin+=calcDay(day).net;wEarn+=calcEarn(k,day).earn;wDays++;}
  }
  const target=parseFloat(S.settings.weekTarget)||35;
  const swh=document.getElementById('sw-h');if(swh)swh.textContent=minToHM(wMin);
  const swt=document.getElementById('sw-t');if(swt)swt.textContent=`/ ${target}h objectif`;
  const swe=document.getElementById('sw-e');if(swe)swe.textContent=fmtMoney(wEarn);
  const swd=document.getElementById('sw-d');if(swd)swd.textContent=`${wDays} jour(s)`;
  const sv2=document.getElementById('streak-v');if(sv2)sv2.textContent=calcStreak()+'🔥';
  renderActiveContract();
}

function renderActiveContract() {
  const c=getContract(todayKey()),el=document.getElementById('activeContractInfo');
  if(!el)return;
  if(!c){el.innerHTML=`<div class="empty-state" style="padding:12px 0"><div class="empty-icon" style="font-size:22px">📋</div><p style="font-size:12px">Aucun contrat actif.</p></div>`;return;}
  const tCls='ct-'+(c.type||'Autre');
  el.innerHTML=`<div class="ctype-badge ${tCls}">${c.type||'Autre'}</div><div class="cname" style="font-size:12px">${c.name}</div><div class="cperiod">${c.startDate||'—'} → ${c.endDate||'En cours'}</div><div class="cchips"><div class="cchip rate">💰 ${c.hourlyRate} €/h</div><div class="cchip">⏸ ${c.breakDuration}min si ≥${c.breakThreshold}h</div>${c.overtimeThreshold?`<div class="cchip">🔥 ×${c.overtimeRate} après ${c.overtimeThreshold}h</div>`:''}<div class="cchip active">✅ Actif</div></div>`;
}

/* ════════════════════════════════════════════
   SAISIE MANUELLE
════════════════════════════════════════════ */
function fillManToday(){document.getElementById('manDate').value=todayKey();loadDayIntoForm();previewMan();}
function loadDayIntoForm(){
  const ds=document.getElementById('manDate').value;if(!ds)return;
  const day=S.punches[ds]||{};
  ['em','sm','ea','es'].forEach(k=>{document.getElementById('man-'+k).value=day[k]||'';});
  document.getElementById('btnDelDay').style.display=S.punches[ds]?'':'none';
}
function clearMan(){
  ['manDate','man-em','man-sm','man-ea','man-es'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('manPreview').innerHTML='';
  document.getElementById('btnDelDay').style.display='none';
}
function previewMan(){
  const ds=document.getElementById('manDate').value;
  const day={em:document.getElementById('man-em').value,sm:document.getElementById('man-sm').value,ea:document.getElementById('man-ea').value,es:document.getElementById('man-es').value};
  const{net,breakApplied,breakMin}=calcDay(day),{earn}=calcEarn(ds,day);
  const el=document.getElementById('manPreview');
  if(!ds||!el){if(el)el.innerHTML='';return;}
  el.innerHTML=`<div style="background:var(--surface);border-radius:9px;padding:10px 13px;border:1px solid rgba(56,189,248,.2)"><div style="font-size:11px;color:var(--blue);font-weight:600;margin-bottom:6px">📋 Aperçu</div><div style="display:flex;gap:14px;flex-wrap:wrap"><div><div style="font-size:10px;color:var(--text3)">Temps net</div><div style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--neon)">${minToHM(net)}</div></div>${breakApplied?`<div><div style="font-size:10px;color:var(--text3)">Pause</div><div style="font-size:12px;color:var(--text2)">−${breakMin}min</div></div>`:''}<div><div style="font-size:10px;color:var(--text3)">Gains</div><div style="font-family:'Sora',sans-serif;font-weight:700;color:var(--gold)">${earn>0?fmtMoney(earn):'—'}</div></div></div></div>`;
}

function saveManual(){
  const ds=document.getElementById('manDate').value;
  if(!ds){showToast('⚠️ Sélectionnez une date');return;}
  const em=document.getElementById('man-em').value,sm=document.getElementById('man-sm').value;
  const ea=document.getElementById('man-ea').value,es=document.getElementById('man-es').value;
  if(!em&&!sm&&!ea&&!es){showToast('⚠️ Renseignez au moins un horaire');return;}
  if(em&&sm&&parseT(sm)<=parseT(em)){showToast('❌ Sortie midi ≤ Entrée matin');return;}
  if(ea&&es&&parseT(es)<=parseT(ea)){showToast('❌ Sortie soir ≤ Entrée après-midi');return;}
  const newDay={manual:true,updatedAt:Date.now()};
  if(em)newDay.em=em;if(sm)newDay.sm=sm;if(ea)newDay.ea=ea;if(es)newDay.es=es;
  S.punches[ds]=newDay;
  saveState();
  showToast(`💾 ${ds} enregistré`);confettiCenter();checkBadges();
  if(ds===todayKey()){updatePunchBtns();updateTimeline();updateDashStats();}
  document.getElementById('btnDelDay').style.display='';
  renderManualList();
}

function deleteDayBtn(){
  const ds=document.getElementById('manDate').value;
  if(!ds||!confirm(`Supprimer le ${ds} ?`))return;
  delete S.punches[ds];saveState();clearMan();updateDashStats();renderHistory();renderManualList();
  showToast('🗑 Jour supprimé');
}

function renderManualList(){
  const el=document.getElementById('manualList');if(!el)return;
  const manual=Object.entries(S.punches).filter(([,d])=>d.manual).sort(([a],[b])=>b.localeCompare(a)).slice(0,20);
  if(!manual.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">✏️</div><p>Aucune saisie manuelle</p></div>`;return;}
  el.innerHTML=manual.map(([ds,day])=>{
    const d=new Date(ds+'T00:00:00'),{net}=calcDay(day),{earn}=calcEarn(ds,day);
    return `<div class="hist-item" onclick="loadManualItem('${ds}')"><div class="hist-date"><div class="hist-dm">${d.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'})}</div><div class="hist-ds">${ds}</div></div><div class="hist-chips">${day.em?`<span class="hchip hc-em">☀️ ${day.em}</span>`:''}${day.sm?`<span class="hchip hc-sm">🌤 ${day.sm}</span>`:''}${day.ea?`<span class="hchip hc-ea">🌇 ${day.ea}</span>`:''}${day.es?`<span class="hchip hc-es">🌙 ${day.es}</span>`:''}<span class="hchip hc-m">✏️</span></div><div class="hist-h">${minToHM(net)}</div><div class="hist-e">${earn>0?fmtMoney(earn):'—'}</div></div>`;
  }).join('');
}

function loadManualItem(ds){
  document.getElementById('manDate').value=ds;loadDayIntoForm();previewMan();
  document.querySelector('.manual-panel').scrollIntoView({behavior:'smooth'});
  showToast(`📋 ${ds} chargé`);
}

/* ════════════════════════════════════════════
   CALENDRIER
════════════════════════════════════════════ */
function renderCalendar(){
  const mN=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  document.getElementById('calLabel').textContent=`${mN[calM]} ${calY}`;
  const grid=document.getElementById('calGrid'),todayStr=todayKey();
  grid.innerHTML=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(n=>`<div class="cal-dname">${n}</div>`).join('');
  const firstDay=(new Date(calY,calM,1).getDay()||7)-1,dIM=new Date(calY,calM+1,0).getDate();
  for(let i=0;i<firstDay;i++)grid.innerHTML+=`<div class="cal-cell ec"></div>`;
  for(let day=1;day<=dIM;day++){
    const ds=`${calY}-${pad(calM+1)}-${pad(day)}`,d=S.punches[ds];
    let cls='';
    if(ds===todayStr)cls+=' today';
    if(d){cls+=(d.em&&d.es)?' complete':' partial';if(d.manual)cls+=' manual';}
    grid.innerHTML+=`<div class="cal-cell${cls}" onclick="showDayDetail('${ds}')">${day}${d?'<div class="cal-dot"></div>':''}</div>`;
  }
}
function calNav(dir){calM+=dir;if(calM>11){calM=0;calY++;}if(calM<0){calM=11;calY--;}renderCalendar();}
function calToday(){const n=new Date();calY=n.getFullYear();calM=n.getMonth();renderCalendar();}

function showDayDetail(ds){
  document.getElementById('calDetail').style.display='';
  const d=new Date(ds+'T00:00:00');
  document.getElementById('calDetailTitle').textContent=d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const day=S.punches[ds]||{},{net,breakApplied,breakMin,gross}=calcDay(day),{earn}=calcEarn(ds,day);
  const items=[{k:'em',l:'Entrée matin',ic:'☀️',cls:'td-neon'},{k:'sm',l:'Sortie midi',ic:'🌤',cls:'td-gold'},{k:'ea',l:'Entrée après-midi',ic:'🌇',cls:'td-blue'},{k:'es',l:'Sortie soir',ic:'🌙',cls:'td-red'}];
  document.getElementById('calDetailContent').innerHTML=`<div class="tl" style="margin-bottom:10px">${items.map(i=>`<div class="tl-item"><div class="tl-dot ${day[i.k]?i.cls:'td-empty'}">${i.ic}</div><div class="tl-content"><div class="tl-lbl">${i.l}</div>${day[i.k]?`<div class="tl-time">${day[i.k]}</div>`:`<div class="tl-pend">—</div>`}</div></div>`).join('')}</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:10px"><div style="background:var(--surface2);border-radius:8px;padding:9px;text-align:center"><div style="font-size:10px;color:var(--text3)">Brut</div><div style="font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px">${minToHM(gross)}</div></div><div style="background:rgba(16,245,160,.08);border:1px solid rgba(16,245,160,.2);border-radius:8px;padding:9px;text-align:center"><div style="font-size:10px;color:var(--text3)">Net${breakApplied?` (−${breakMin}m)`:''}</div><div style="font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;color:var(--neon)">${minToHM(net)}</div></div><div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:9px;text-align:center"><div style="font-size:10px;color:var(--text3)">Gains</div><div style="font-family:'Sora',sans-serif;font-weight:700;font-size:13px;color:var(--gold)">${fmtMoney(earn)}</div></div></div>${day.manual?'<span style="font-size:11px;color:var(--blue)">✏️ Saisie manuelle</span><br>':''}<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="loadManualItem('${ds}');sv('saisie',null)">✏️ Modifier</button><button class="btn btn-danger btn-sm" onclick="deleteDayFromCal('${ds}')">🗑 Supprimer</button></div>`;
  document.getElementById('calDetail').scrollIntoView({behavior:'smooth'});
}

function deleteDayFromCal(ds){
  if(!confirm(`Supprimer le ${ds} ?`))return;
  delete S.punches[ds];saveState();
  document.getElementById('calDetail').style.display='none';
  renderCalendar();renderHistory();updateDashStats();showToast('🗑 Jour supprimé');
}

/* ════════════════════════════════════════════
   HISTORIQUE
════════════════════════════════════════════ */
function renderHistory(){
  const el=document.getElementById('histList');if(!el)return;
  const f=document.getElementById('histFilter').value;
  const entries=Object.entries(S.punches).filter(([k])=>!f||k.startsWith(f)).sort(([a],[b])=>b.localeCompare(a));
  if(!entries.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><p>Aucun pointage</p></div>`;return;}
  el.innerHTML=entries.map(([ds,day])=>{
    const d=new Date(ds+'T00:00:00'),{net}=calcDay(day),{earn}=calcEarn(ds,day),ok=day.em&&day.es;
    return `<div class="hist-item" onclick="sv('calendar',null);showDayDetail('${ds}')"><div style="width:6px;height:6px;border-radius:50%;background:${ok?'var(--neon)':'var(--gold)'};flex-shrink:0;margin-top:4px"></div><div class="hist-date"><div class="hist-dm">${d.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'})}</div><div class="hist-ds">${ds}</div></div><div class="hist-chips">${day.em?`<span class="hchip hc-em">☀️ ${day.em}</span>`:''}${day.sm?`<span class="hchip hc-sm">🌤 ${day.sm}</span>`:''}${day.ea?`<span class="hchip hc-ea">🌇 ${day.ea}</span>`:''}${day.es?`<span class="hchip hc-es">🌙 ${day.es}</span>`:''}${day.manual?'<span class="hchip hc-m">✏️</span>':''}</div><div class="hist-h">${minToHM(net)}</div><div class="hist-e">${earn>0?fmtMoney(earn):'—'}</div></div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   STATS
════════════════════════════════════════════ */
let statOffset=0;
function statPeriodChange(){statOffset=0;renderStats();}
function statNav(d){statOffset=Math.min(0,statOffset+d);renderStats();}
function statToday(){statOffset=0;renderStats();}

function renderStats(){
  const period=document.getElementById('statPeriod').value,now=new Date();
  let entries=[],lbl='';
  const capMonth={month:'short'},capMonthY={month:'short',year:'numeric'};
  if(period==='week'){
    const ref=new Date(now);ref.setDate(now.getDate()+statOffset*7);
    const dow=ref.getDay()||7,start=new Date(ref);start.setDate(ref.getDate()-dow+1);
    for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);entries.push(fmtDate(d));}
    const end=new Date(start);end.setDate(start.getDate()+6);
    lbl=`Sem. du ${start.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})} au ${end.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}`;
  }
  else if(period==='month'){
    const ref=new Date(now.getFullYear(),now.getMonth()+statOffset,1);
    const days=new Date(ref.getFullYear(),ref.getMonth()+1,0).getDate();
    for(let i=1;i<=days;i++)entries.push(`${ref.getFullYear()}-${pad(ref.getMonth()+1)}-${pad(i)}`);
    lbl=ref.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
    lbl=lbl.charAt(0).toUpperCase()+lbl.slice(1);
  }
  else{
    const base=new Date(now.getFullYear(),now.getMonth()+statOffset*3,1);
    for(let mo=2;mo>=0;mo--){const d=new Date(base.getFullYear(),base.getMonth()-mo,1),days=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();for(let i=1;i<=days;i++){const dd=new Date(d.getFullYear(),d.getMonth(),i);if(dd<=now)entries.push(fmtDate(dd));}}
    const first=new Date(base.getFullYear(),base.getMonth()-2,1);
    lbl=`${first.toLocaleDateString('fr-FR',capMonth)} – ${base.toLocaleDateString('fr-FR',capMonthY)}`;
  }
  const lblEl=document.getElementById('statPeriodLbl');if(lblEl)lblEl.textContent=lbl;
  const nextBtn=document.getElementById('statNavNext');
  if(nextBtn){nextBtn.disabled=statOffset>=0;nextBtn.style.opacity=statOffset>=0?'.35':'1';nextBtn.style.pointerEvents=statOffset>=0?'none':'auto';}
  let tMin=0,tEarn=0,wDays=0,maxMin=0;const hD=[],eD=[];
  entries.forEach(ds=>{const day=S.punches[ds];if(day){const{net}=calcDay(day),{earn}=calcEarn(ds,day);tMin+=net;tEarn+=earn;if(net>0)wDays++;if(net>maxMin)maxMin=net;hD.push({date:ds,val:net});eD.push({date:ds,val:earn});}else{hD.push({date:ds,val:0});eD.push({date:ds,val:0});}});
  const avg=wDays>0?tMin/wDays:0;
  const sc=document.getElementById('statsCards');
  if(sc)sc.innerHTML=`<div class="stat-card"><div class="stat-label">⏱ Total</div><div class="stat-val v-neon">${minToHM(tMin)}</div><div class="stat-sub">${wDays} j. travaillé(s)</div></div><div class="stat-card"><div class="stat-label">💰 Gains</div><div class="stat-val v-gold">${fmtMoney(tEarn)}</div><div class="stat-sub">Sur la période</div></div><div class="stat-card"><div class="stat-label">📊 Moy./jour</div><div class="stat-val v-violet">${minToHM(avg)}</div><div class="stat-sub">Jours travaillés</div></div><div class="stat-card"><div class="stat-label">🏆 Meilleure J.</div><div class="stat-val">${minToHM(maxMin)}</div><div class="stat-sub">Record période</div></div>`;
  renderBar('hoursChart',hD,maxMin||480,'var(--violet)',v=>minToHM(v));
  renderBar('earnChart',eD,Math.max(...eD.map(d=>d.val),1),'var(--gold)',v=>v>0?Math.round(v)+'€':'');
}

function renderBar(id,data,maxV,color,lFn){
  const el=document.getElementById(id);if(!el)return;
  const show=data.length>14?data.filter((_,i,a)=>i%Math.ceil(a.length/14)===0):data;
  el.innerHTML=`<div class="bar-chart">${show.map(d=>{const pct=maxV>0?(d.val/maxV)*100:0,lbl=new Date(d.date+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});return`<div class="bar-col"><div class="bar-val">${d.val>0?lFn(d.val):''}</div><div class="bar-fill" style="height:${Math.max(pct,2)}%;background:linear-gradient(180deg,${color},${color}88)"></div><div class="bar-lbl">${lbl}</div></div>`;}).join('')}</div>`;
}

/* ════════════════════════════════════════════
   CONTRATS
════════════════════════════════════════════ */
function renderContracts(){
  const el=document.getElementById('contractsList');if(!el)return;
  if(!S.contracts.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">📄</div><p>Aucun contrat.<br>Cliquez sur "+ Nouveau".</p></div>`;return;}
  const today=todayKey();
  el.innerHTML=S.contracts.map((c,i)=>{
    const isA=(!c.startDate||c.startDate<=today)&&(!c.endDate||c.endDate>=today),tCls='ct-'+(c.type||'Autre');
    return `<div class="ccard ${isA?'is-active':''}"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px"><div style="flex:1;min-width:0"><div class="ctype-badge ${tCls}">${c.type||'Autre'}</div><div class="cname">${c.name}</div><div class="cperiod">${c.startDate||'Début non défini'} → ${c.endDate||'En cours'}</div></div><div style="display:flex;gap:4px;flex-shrink:0"><button class="btn btn-ghost btn-sm btn-icon" onclick="openContractModal(${i})">✏️</button><button class="btn btn-danger btn-sm btn-icon" onclick="delContract(${i})">🗑</button></div></div><div class="cchips"><div class="cchip rate">💰 ${c.hourlyRate} €/h</div><div class="cchip">⏸ ${c.breakDuration}min si ≥${c.breakThreshold}h</div>${c.overtimeThreshold?`<div class="cchip">🔥 ×${c.overtimeRate} après ${c.overtimeThreshold}h</div>`:''}${isA?`<div class="cchip active">✅ Actif</div>`:''}</div></div>`;
  }).join('');
}

function openContractModal(idx=null){
  const c=idx!==null?S.contracts[idx]:{};
  const typeOpts=CONTRACT_TYPES.map(t=>`<option value="${t}" ${c.type===t?'selected':''}>${t}</option>`).join('');
  document.getElementById('modalContent').innerHTML=`<div class="modal-head"><div class="modal-ttl">${idx!==null?'✏️ Modifier':'📄 Nouveau contrat'}</div><button class="modal-x" onclick="closeMod()">×</button></div><div class="frow" style="grid-template-columns:1fr"><div class="fgroup"><label>Nom du contrat</label><input type="text" id="cName" value="${c.name||''}" placeholder="Ex: CDI Développeur"></div></div><div class="frow"><div class="fgroup"><label>Type</label><select id="cType"><option value="">— Type —</option>${typeOpts}</select></div><div class="fgroup"><label>Taux horaire (€/h)</label><input type="number" id="cRate" value="${c.hourlyRate||''}" step="0.01" min="0" placeholder="15.50"></div></div><div class="frow"><div class="fgroup"><label>Date début</label><input type="date" id="cStart" value="${c.startDate||''}"></div><div class="fgroup"><label>Date fin (optionnel)</label><input type="date" id="cEnd" value="${c.endDate||''}"></div></div><div class="frow"><div class="fgroup"><label>Seuil pause (h)</label><input type="number" id="cBT" value="${c.breakThreshold||6}" step="0.5" min="0"></div><div class="fgroup"><label>Durée pause (min)</label><input type="number" id="cBD" value="${c.breakDuration||30}" min="0"></div></div><div class="frow"><div class="fgroup"><label>Seuil heures supp (h/j, 0=off)</label><input type="number" id="cOT" value="${c.overtimeThreshold||0}" step="0.5" min="0"></div><div class="fgroup"><label>Majoration (×)</label><input type="number" id="cOR" value="${c.overtimeRate||1.25}" step="0.05" min="1"></div></div><div style="display:flex;justify-content:flex-end;gap:7px;margin-top:6px"><button class="btn btn-ghost" onclick="closeMod()">Annuler</button><button class="btn btn-primary" onclick="saveContract(${idx})">💾 Sauvegarder</button></div>`;
  openMod();
}

function saveContract(idx){
  const c={name:document.getElementById('cName').value.trim()||'Contrat sans nom',type:document.getElementById('cType').value||'Autre',startDate:document.getElementById('cStart').value,endDate:document.getElementById('cEnd').value,hourlyRate:parseFloat(document.getElementById('cRate').value)||0,breakThreshold:parseFloat(document.getElementById('cBT').value)||6,breakDuration:parseFloat(document.getElementById('cBD').value)||30,overtimeThreshold:parseFloat(document.getElementById('cOT').value)||0,overtimeRate:parseFloat(document.getElementById('cOR').value)||1.25,id:idx!==null?(S.contracts[idx].id||Date.now()):Date.now()};
  if(idx!==null)S.contracts[idx]=c;else S.contracts.push(c);
  saveState();closeMod();renderContracts();renderActiveContract();
  showToast(`✅ Contrat "${c.name}" sauvegardé`);
}

function delContract(i){
  if(!confirm(`Supprimer "${S.contracts[i].name}" ?`))return;
  S.contracts.splice(i,1);saveState();renderContracts();showToast('🗑 Contrat supprimé');
}

/* ════════════════════════════════════════════
   BADGES
════════════════════════════════════════════ */
function checkBadges(){
  const all=Object.entries(S.punches),s=calcStreak();
  const tE=all.reduce((acc,[k,d])=>acc+calcEarn(k,d).earn,0);
  const now=new Date(),dow=now.getDay()||7;
  let fw=0;for(let i=1;i<=5;i++){const d=new Date(now);d.setDate(now.getDate()-dow+i);const k=fmtDate(d);if(S.punches[k]&&S.punches[k].em&&S.punches[k].es)fw++;}
  const checks=[['first_punch',all.length>=1],['first_manual',all.some(([,d])=>d.manual)],['first_contract',S.contracts.length>=1],['first_week',all.length>=7],['streak_3',s>=3],['streak_5',s>=5],['streak_10',s>=10],['streak_20',s>=20],['earn_100',tE>=100],['earn_500',tE>=500],['earn_1000',tE>=1000],['full_week',fw===5],['early_bird',all.some(([,d])=>d.em&&parseT(d.em)<7*60+30)],['night_owl',all.some(([,d])=>d.es&&parseT(d.es)>20*60)]];
  let changed=false;
  checks.forEach(([id,cond])=>{if(cond&&!S.badges[id]){S.badges[id]=true;changed=true;const labs={first_punch:'👆 Premier pointage !',first_manual:'✏️ Saisie manuelle',first_contract:'📄 Premier contrat',first_week:'📅 Première semaine',streak_3:'🔥 En feu ! 3 jours',streak_5:'🔥🔥 Blazing ! 5 jours',streak_10:'⚡ Inarrêtable ! 10j',streak_20:'💎 Diamant ! 20 jours',earn_100:'💰 100€ gagnés',earn_500:'💰💰 500€ gagnés',earn_1000:'🤑 1000€ gagnés',full_week:'🏅 Semaine parfaite',early_bird:'🌅 Lève-tôt',night_owl:'🦉 Noctambule'};showToast(`🏆 Badge : ${labs[id]||id}`,3000);}});
  if(changed)saveState();
}

/* ════════════════════════════════════════════
   EXPORT
════════════════════════════════════════════ */
function getExpData(){const f=document.getElementById('expFrom').value,t=document.getElementById('expTo').value;return Object.entries(S.punches).filter(([k])=>(!f||k>=f)&&(!t||k<=t)).sort(([a],[b])=>a.localeCompare(b));}
function exportCSV(){
  const data=getExpData();if(!data.length){showToast('⚠️ Aucune donnée');return;}
  const hdr='Date,Type,Entrée matin,Sortie midi,Entrée après-midi,Sortie soir,Heures brutes,Heures nettes,Pause,Contrat,Type contrat,Taux (€/h),Gains (€)\n';
  const rows=data.map(([k,d])=>{const{gross,net,breakApplied,breakMin}=calcDay(d),{earn,rate}=calcEarn(k,d),c=getContract(k);return`${k},${d.manual?'Manuel':'Auto'},${d.em||''},${d.sm||''},${d.ea||''},${d.es||''},${minToHM(gross)},${minToHM(net)},${breakApplied?breakMin+'min':''},${c?c.name:''},${c?c.type:''},${rate.toFixed(2)},${earn.toFixed(2)}`;}).join('\n');
  dl('timeflow_export.csv','text/csv','\ufeff'+hdr+rows);showToast('📊 CSV téléchargé');
}
function exportTxt(){
  const data=getExpData();if(!data.length){showToast('⚠️ Aucune donnée');return;}
  let txt=`${'═'.repeat(37)}\n    FEUILLE DE TEMPS — TimeFlow\n    ${currentUser}\n${'═'.repeat(37)}\n\n`;
  let tMin=0,tEarn=0;
  data.forEach(([k,d])=>{const dd=new Date(k+'T00:00:00'),{net}=calcDay(d),{earn}=calcEarn(k,d);tMin+=net;tEarn+=earn;txt+=`${dd.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}${d.manual?' [Manuel]':''}\n  ☀️ ${d.em||'—'} → ${d.sm||'—'}   🌇 ${d.ea||'—'} → ${d.es||'—'}\n  ⏱ ${minToHM(net)}   💰 ${fmtMoney(earn)}\n\n`;});
  txt+=`${'═'.repeat(37)}\nTOTAL : ${minToHM(tMin)}   GAINS : ${fmtMoney(tEarn)}\n`;
  dl('timeflow_rapport.txt','text/plain',txt);showToast('📄 Rapport téléchargé');
}
function exportJSON(){dl('timeflow_backup.json','application/json',JSON.stringify({...S,exportDate:new Date().toISOString(),user:currentUser},null,2));showToast('🗄 Backup JSON téléchargé');}
function importJSON(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const imp=JSON.parse(ev.target.result);
      if(!imp.punches&&!imp.contracts){showToast('❌ Fichier invalide');return;}
      if(!confirm('Remplacer toutes vos données ?'))return;
      if(imp.punches)S.punches={...imp.punches};
      if(imp.contracts)S.contracts=[...imp.contracts];
      if(imp.settings)S.settings={...S.settings,...imp.settings};
      if(imp.badges)S.badges={...imp.badges};
      saveState();initApp();showToast(`✅ ${Object.keys(S.punches).length} jours importés`);
    }catch(err){showToast('❌ Erreur : '+err.message);}
  };
  r.readAsText(f);
}
function dl(name,type,content){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();}

/* ════════════════════════════════════════════
   MODAL GÉNÉRIQUE
════════════════════════════════════════════ */
function openMod(){document.getElementById('modalBg').classList.add('open');}
function closeMod(e){if(!e||e.target===document.getElementById('modalBg'))document.getElementById('modalBg').classList.remove('open');}

/* ════════════════════════════════════════════
   CONFETTI
════════════════════════════════════════════ */
function confetti(e){spawn(e?.clientX||window.innerWidth/2,e?.clientY||window.innerHeight/2);}
function confettiCenter(){spawn(window.innerWidth/2,window.innerHeight/3);}
function spawn(x,y){['#7C3AED','#10F5A0','#F59E0B','#38BDF8','#F43F5E','#FB923C'].forEach(color=>{for(let i=0;i<3;i++){const p=document.createElement('div');p.className='cfp';p.style.cssText=`left:${x+(Math.random()-.5)*90}px;top:${y}px;width:${5+Math.random()*6}px;height:${5+Math.random()*6}px;background:${color};animation-delay:${Math.random()*.22}s;animation-duration:${.7+Math.random()*.55}s`;document.body.appendChild(p);setTimeout(()=>p.remove(),1400);}});}

/* ════════════════════════════════════════════
   VIEW SWITCHING
════════════════════════════════════════════ */
const TITLES={dashboard:'Tableau de bord',saisie:'Saisie manuelle',calendar:'Calendrier',history:'Historique',stats:'Statistiques',contracts:'Contrats',export:'Export'};
const SUBS={
  dashboard:()=>new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}),
  saisie:()=>'Saisie pour n\'importe quelle date',
  calendar:()=>'Vue mensuelle de vos pointages',
  history:()=>'Tous vos pointages enregistrés',
  stats:()=>'Analyse de vos heures & gains',
  contracts:()=>'Vos contrats de travail',
  export:()=>'Téléchargez vos feuilles de temps',
};
function sv(name,clickedEl){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(n=>n.classList.remove('active'));
  const v=document.getElementById('view-'+name);if(v)v.classList.add('active');
  document.querySelectorAll(`[data-view="${name}"]`).forEach(el=>el.classList.add('active'));
  const tt=document.getElementById('topTitle');if(tt)tt.textContent=TITLES[name]||name;
  const ts=document.getElementById('topSub');if(ts)ts.textContent=SUBS[name]?SUBS[name]():'';
  if(name==='calendar')renderCalendar();
  if(name==='history')renderHistory();
  if(name==='stats')renderStats();
  if(name==='contracts')renderContracts();
  if(name==='saisie')renderManualList();
  if(window.innerWidth<=768){document.getElementById('sidebar').classList.add('collapsed');sidebarOverlay.classList.remove('show');}
}

/* ════════════════════════════════════════════
   SETTINGS (via modal contrat / Export)
════════════════════════════════════════════ */

/* ════════════════════════════════════════════
   SYNCHRONISATION CLOUD — même système que l'Annuaire KPI
════════════════════════════════════════════ */
const LS_SYNC = 'tfSyncConfig';
const getSyncConfig = () => { try{ return JSON.parse(localStorage.getItem(LS_SYNC)); }catch{ return null; } };
const setSyncConfig = cfg => cfg ? localStorage.setItem(LS_SYNC,JSON.stringify(cfg)) : localStorage.removeItem(LS_SYNC);

let fbApp=null,fbDb=null,fbUnsub=null,syncDebounceHandle=null,lastSyncPushAt=0,lastAppliedSyncAt=0,connectedSyncCode=null,applyingRemoteSync=false;

function setSyncStatusUI(state,detail){
  const el=document.getElementById('syncStatus');if(!el)return;
  const map={off:{text:'⚪ Synchronisation non configurée',cls:''},connected:{text:'🟢 Connecté — synchronisation active',cls:'connected'},syncing:{text:'🔄 Synchronisation…',cls:'syncing'},error:{text:'🔴 Erreur : '+(detail||'voir console'),cls:'error'}};
  const s=map[state]||map.off;el.textContent=s.text;el.className='sync-status '+s.cls;
}
function syncDocRef(code){return fbDb.collection('tf_pointage').doc(code);}
function buildSyncPayload(){return{punches:S.punches,contracts:S.contracts,settings:S.settings,badges:S.badges,user:currentUser,updatedAt:Date.now()};}

function scheduleAutoSync(){
  const cfg=getSyncConfig();
  if(!cfg||!cfg.enabled||!fbDb||applyingRemoteSync)return;
  clearTimeout(syncDebounceHandle);
  syncDebounceHandle=setTimeout(()=>pushToCloud(false),1500);
}

async function pushToCloud(manual){
  const cfg=getSyncConfig();if(!cfg||!fbDb)return;
  setSyncStatusUI('syncing');
  try{
    const payload=buildSyncPayload();lastSyncPushAt=payload.updatedAt;
    await syncDocRef(cfg.code).set(payload);
    setSyncStatusUI('connected');
    if(manual)showToast('Synchronisé ☁️ — données envoyées',2500);
  }catch(err){setSyncStatusUI('error',err.message);if(manual)showToast('❌ Erreur de synchronisation',3000);}
}

function applyRemoteData(payload,fromSync){
  applyingRemoteSync=true;
  if(payload.punches)   {S.punches=payload.punches;   localStorage.setItem(LS_KEY(),JSON.stringify(S));}
  if(payload.contracts) S.contracts=payload.contracts;
  if(payload.settings)  S.settings={...S.settings,...payload.settings};
  if(payload.badges)    S.badges=payload.badges;
  applyingRemoteSync=false;
  // Ne pas appeler saveState() ici pour éviter la boucle de sync
  localStorage.setItem(LS_KEY(),JSON.stringify(S));
  updatePunchBtns();updateTimeline();updateDashStats();updateLiveCounters();
  renderHistory();renderManualList();
  if(!fromSync)showToast('✅ Données récupérées depuis le cloud',2500);
}

async function pullFromCloud(manual){
  const cfg=getSyncConfig();if(!cfg||!fbDb)return;
  setSyncStatusUI('syncing');
  try{
    const snap=await syncDocRef(cfg.code).get();
    if(!snap.exists){setSyncStatusUI('connected');if(manual)showToast('Aucune donnée cloud pour ce code',2800);return;}
    applyRemoteData(snap.data(),false);setSyncStatusUI('connected');
  }catch(err){setSyncStatusUI('error',err.message);if(manual)showToast('❌ Erreur de synchronisation',3000);}
}

function listenForRemoteChanges(code){
  if(fbUnsub){fbUnsub();fbUnsub=null;}
  fbUnsub=syncDocRef(code).onSnapshot(snap=>{
    if(!snap.exists)return;
    const payload=snap.data();
    if(!payload||!payload.updatedAt)return;
    if(payload.updatedAt===lastSyncPushAt||payload.updatedAt===lastAppliedSyncAt)return;
    lastAppliedSyncAt=payload.updatedAt;
    applyRemoteData(payload,true);
    showToast('☁️ Données mises à jour depuis un autre appareil',2800);
  },err=>setSyncStatusUI('error',err.message));
}

function connectSync(manual){
  try{
    const cfg=getSyncConfig();
    if(!cfg||!cfg.config||!cfg.code){setSyncStatusUI('off');return;}
    if(typeof firebase==='undefined'){setSyncStatusUI('error','Librairie Firebase non chargée.');return;}
    if(fbDb&&fbUnsub&&connectedSyncCode===cfg.code){setSyncStatusUI('connected');if(manual)showToast('Déjà connecté ☁️',2200);return;}
    if(!fbApp){
      fbApp=firebase.apps&&firebase.apps.length?firebase.apps[0]:firebase.initializeApp(cfg.config);
      fbDb=firebase.firestore();
    }
    listenForRemoteChanges(cfg.code);
    connectedSyncCode=cfg.code;setSyncStatusUI('connected');
    if(manual)showToast('Connecté ☁️ — code : '+cfg.code,2800);
  }catch(err){console.error('connectSync:',err);setSyncStatusUI('error',err.message);if(manual)showToast('❌ Échec de connexion',3000);}
}

function disconnectSync(){
  if(fbUnsub){fbUnsub();fbUnsub=null;}
  connectedSyncCode=null;setSyncConfig(null);setSyncStatusUI('off');
  showToast('Synchronisation désactivée',2200);
}

function initSyncModal(){
  const cfg=getSyncConfig();
  // Pré-remplir avec la config Firebase du projet si aucune config sauvegardée
  const defaultConfig={
    apiKey:"AIzaSyBOuUwspRnbMhwt1kU66zZ4U5rzDfv7FI8",
    authDomain:"pointage-e9591.firebaseapp.com",
    projectId:"pointage-e9591",
    storageBucket:"pointage-e9591.firebasestorage.app",
    messagingSenderId:"967658174113",
    appId:"1:967658174113:web:defe0e59d70afe6cc562e0"
  };
  document.getElementById('syncConfigInput').value=cfg?.config?JSON.stringify(cfg.config,null,2):JSON.stringify(defaultConfig,null,2);
  document.getElementById('syncCodeInput').value=cfg?.code||'';
  document.getElementById('syncEnabledToggle').checked=!!cfg?.enabled;
  if(cfg&&cfg.config&&cfg.code)connectSync(false);else setSyncStatusUI('off');
}

syncSettingsBtn?.addEventListener('click',()=>{initSyncModal();syncModal.classList.remove('hidden');});
document.getElementById('closeSyncModalBtn')?.addEventListener('click',()=>syncModal.classList.add('hidden'));
syncModal?.addEventListener('click',e=>{if(e.target===syncModal)syncModal.classList.add('hidden');});

document.getElementById('connectSyncBtn')?.addEventListener('click',()=>{
  let parsedConfig;
  try{parsedConfig=JSON.parse(document.getElementById('syncConfigInput').value.trim());}
  catch{return showToast('❌ Configuration invalide (JSON)',3000);}
  const code=document.getElementById('syncCodeInput').value.trim();
  if(!code)return showToast('Choisissez un code de synchronisation',2800);
  fbApp=null;fbDb=null;connectedSyncCode=null;
  setSyncConfig({config:parsedConfig,code,enabled:true});
  connectSync(true);
});

document.getElementById('syncEnabledToggle')?.addEventListener('change',function(){
  const c=getSyncConfig();if(!c)return;
  c.enabled=this.checked;setSyncConfig(c);
  showToast(c.enabled?'Synchronisation activée':'Synchronisation en pause',2200);
});

document.getElementById('pushSyncBtn')?.addEventListener('click',()=>pushToCloud(true));
document.getElementById('pullSyncBtn')?.addEventListener('click',()=>{if(confirm('Remplacer vos données locales par celles du cloud ?'))pullFromCloud(true);});
document.getElementById('disconnectSyncBtn')?.addEventListener('click',()=>{if(confirm('Désactiver la synchronisation ?'))disconnectSync();});

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
function initApp(){
  const now=new Date();
  calY=now.getFullYear();calM=now.getMonth();
  const hd=document.getElementById('heroDate');
  if(hd)hd.textContent=now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).replace(/^\w/,c=>c.toUpperCase());
  const tt=document.getElementById('topTitle');if(tt)tt.textContent='Tableau de bord';
  const ts=document.getElementById('topSub');if(ts)ts.textContent=SUBS.dashboard();
  const ef=document.getElementById('expFrom');if(ef)ef.value=`${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
  const et=document.getElementById('expTo');if(et)et.value=fmtDate(now);
  const md=document.getElementById('manDate');if(md)md.value=fmtDate(now);
  // Activer la nav dashboard
  document.querySelectorAll('.nav-btn').forEach(n=>n.classList.remove('active'));
  document.querySelector('[data-view="dashboard"]')?.classList.add('active');
  updatePunchBtns();updateTimeline();updateDashStats();updateLiveCounters();checkBadges();
}

/* ════════════════════════════════════════════
   PWA — Service Worker
════════════════════════════════════════════ */
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./service-worker.js')
      .then(()=>console.log('✅ Service worker enregistré'))
      .catch(err=>console.warn('SW non enregistré :',err));
  });
}

/* ════════════════════════════════════════════
   AUTO-LOGIN (session mémorisée)
   Placé en tout dernier — même pattern que l'Annuaire KPI
════════════════════════════════════════════ */
if(currentUser){
  try{login(currentUser);}
  catch(err){
    console.error('Erreur reconnexion auto :',err);
    showToast('⚠️ Erreur au chargement — reconnectez-vous');
    loginScreen.style.display='flex';
    appShell.style.display='none';
  }
}
