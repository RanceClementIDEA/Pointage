/* ════════════════════════════════════════════
   TIMEFLOW — app.js
   Firebase Auth + Firestore + Compteurs LIVE
════════════════════════════════════════════ */

/* ── STATE ── */
let db = null, auth = null, currentUser = null, firebaseReady = false;
let S = {
  punches: {},
  contracts: [],
  settings: { name:'', weekTarget:35, breakThreshold:6, breakDuration:30 },
  badges: {}
};
let calY, calM;
let unsubPunches = null, unsubContracts = null, unsubSettings = null;

// Compteurs live
let _prevDayEarn  = 0;  // pour détecter les changements et animer
let _prevMonthEarn = 0;

/* ════════════════════════════════════════════
   FIREBASE INIT
════════════════════════════════════════════ */
function initFirebase() {
  try {
    if (!FIREBASE_CONFIG || FIREBASE_CONFIG.apiKey === 'VOTRE_API_KEY') {
      console.warn('⚠️ Firebase non configuré — mode local actif');
      document.getElementById('configNote').style.display = 'block';
      firebaseReady = false;
      return false;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    db   = firebase.firestore();
    auth = firebase.auth();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    firebaseReady = true;
    auth.onAuthStateChanged(user => {
      if (user) { currentUser = user; onUserLogin(user); }
      else       { currentUser = null; showLogin(); }
    });
    return true;
  } catch(e) {
    console.error('Firebase init:', e);
    firebaseReady = false;
    return false;
  }
}

/* ── Paths ── */
const userDoc      = () => `users/${currentUser.uid}`;
const punchesCol   = () => `${userDoc()}/punches`;
const contractsCol = () => `${userDoc()}/contracts`;

/* ════════════════════════════════════════════
   AUTH
════════════════════════════════════════════ */
let authMode = 'login';

function switchTab(mode) {
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode==='login');
  document.getElementById('tabRegister').classList.toggle('active', mode==='register');
  document.getElementById('nameField').style.display = mode==='register' ? '' : 'none';
  document.getElementById('authBtnLabel').textContent = mode==='login' ? 'Se connecter' : "S'inscrire";
  document.getElementById('authError').classList.remove('show');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

async function authSubmit() {
  const email = document.getElementById('authEmail').value.trim();
  const pass  = document.getElementById('authPassword').value;
  const name  = document.getElementById('authName').value.trim();
  if (!email || !pass) { showAuthError('Veuillez remplir tous les champs'); return; }
  const btn = document.getElementById('btnAuthSubmit');
  btn.disabled = true;

  if (!firebaseReady) {
    currentUser = { uid:'local_'+email, email, displayName:name||email.split('@')[0] };
    onUserLogin(currentUser);
    btn.disabled = false;
    return;
  }
  try {
    if (authMode === 'login') {
      await auth.signInWithEmailAndPassword(email, pass);
    } else {
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      if (name) await cred.user.updateProfile({ displayName: name });
    }
  } catch(e) {
    const msgs = {
      'auth/wrong-password':'Mot de passe incorrect',
      'auth/user-not-found':'Aucun compte avec cet email',
      'auth/email-already-in-use':'Email déjà utilisé — connectez-vous',
      'auth/weak-password':'Mot de passe trop court (6 car. min.)',
      'auth/invalid-email':'Email invalide',
      'auth/network-request-failed':'Erreur réseau',
    };
    showAuthError(msgs[e.code] || e.message);
    btn.disabled = false;
  }
}

async function authGoogle() {
  if (!firebaseReady) { showAuthError('Firebase non configuré'); return; }
  try {
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch(e) { showAuthError(e.message); }
}

async function logout() {
  unsubAll();
  if (firebaseReady && auth) await auth.signOut();
  currentUser = null;
  S = { punches:{}, contracts:[], settings:{ name:'', weekTarget:35, breakThreshold:6, breakDuration:30 }, badges:{} };
  showLogin();
  toast('info','🚪 Déconnecté');
}

function showLogin() {
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginScreen').classList.remove('hidden');
}

/* ════════════════════════════════════════════
   AFTER LOGIN
════════════════════════════════════════════ */
function onUserLogin(user) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').style.display = 'flex';
  const init = (user.displayName || user.email || '?').charAt(0).toUpperCase();
  document.getElementById('navAvatar').textContent    = init;
  document.getElementById('drawerName').textContent   = user.displayName || 'Utilisateur';
  document.getElementById('drawerEmail').textContent  = user.email || '';
  if (firebaseReady) subscribeAll();
  else { loadLocal(); initApp(); }
}

/* ════════════════════════════════════════════
   FIRESTORE LISTENERS
════════════════════════════════════════════ */
function subscribeAll() {
  setSyncStatus('syncing', 'Chargement…');

  unsubSettings = db.doc(userDoc()).onSnapshot(snap => {
    if (snap.exists) {
      const d = snap.data();
      if (d.settings) S.settings = { ...S.settings, ...d.settings };
      if (d.badges)   S.badges   = d.badges;
    }
    updateDashStats();
  }, e => console.error('settings:', e));

  unsubPunches = db.collection(punchesCol()).onSnapshot(snap => {
    S.punches = {};
    snap.forEach(doc => { S.punches[doc.id] = doc.data(); });
    updatePunchBtns();
    updateTimeline();
    updateLiveCounters();
    updateDashStats();
    renderHistory();
    renderManualList();
    setSyncStatus('synced', 'Synchronisé');
  }, e => { setSyncStatus('offline','Hors-ligne'); console.error('punches:', e); });

  unsubContracts = db.collection(contractsCol()).orderBy('createdAt','asc').onSnapshot(snap => {
    S.contracts = [];
    snap.forEach(doc => { S.contracts.push({ id:doc.id, ...doc.data() }); });
    renderActiveContract();
    renderContracts();
    updateLiveCounters();
  }, e => console.error('contracts:', e));
}

function unsubAll() {
  if (unsubPunches)   { unsubPunches();   unsubPunches   = null; }
  if (unsubContracts) { unsubContracts(); unsubContracts = null; }
  if (unsubSettings)  { unsubSettings();  unsubSettings  = null; }
}

/* ════════════════════════════════════════════
   SYNC STATUS
════════════════════════════════════════════ */
function setSyncStatus(status, txt) {
  const el = document.getElementById('syncInd');
  el.className = 'sync-indicator ' + status;
  document.getElementById('syncTxt').textContent = txt;
}

function manualSync() {
  if (!firebaseReady) { toast('warning','⚠️ Firebase non configuré'); return; }
  setSyncStatus('syncing','Sync…');
  setTimeout(() => setSyncStatus('synced','Synchronisé'), 600);
  toast('success','☁️ Synchronisé en temps réel');
}

/* ════════════════════════════════════════════
   LOCAL STORAGE (mode sans Firebase)
════════════════════════════════════════════ */
const LS_KEY = 'timeflow_v3';
function saveLocal() { localStorage.setItem(LS_KEY, JSON.stringify(S)); }
function loadLocal() {
  try { const r = localStorage.getItem(LS_KEY); if (r) S = { ...S, ...JSON.parse(r) }; } catch(e) {}
}

/* ════════════════════════════════════════════
   UTILS
════════════════════════════════════════════ */
const pad = (n, l=2) => String(n).padStart(l,'0');
const todayKey  = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`; };
const fmtDate   = d  => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fmtTime   = d  => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtTimeFull = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const parseT    = s  => { if(!s) return 0; const[h,m]=s.split(':').map(Number); return h*60+m; };
const minToHM   = m  => `${Math.floor(m/60)}h${pad(Math.floor(m%60))}`;
const secToHMS  = s  => `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;
const fmtMoney  = n  => n.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';

function calcDay(day, cfg) {
  cfg = cfg || S.settings;
  if (!day) return { gross:0, net:0, breakApplied:false, breakMin:0 };
  let g = 0;
  if (day.em && day.sm) g += parseT(day.sm) - parseT(day.em);
  if (day.ea && day.es) g += parseT(day.es) - parseT(day.ea);
  const thr  = (parseFloat(cfg.breakThreshold)||6)*60;
  const bDur = parseFloat(cfg.breakDuration)||30;
  const bA   = g >= thr;
  return { gross:g, net:Math.max(0,g-(bA?bDur:0)), breakApplied:bA, breakMin:bA?bDur:0 };
}

function getContract(ds) {
  return S.contracts.find(c => {
    const ok1 = !c.startDate || c.startDate <= ds;
    const ok2 = !c.endDate   || c.endDate   >= ds;
    return ok1 && ok2;
  }) || null;
}

function calcEarn(ds, day) {
  const c = getContract(ds);
  if (!c) return { earn:0, rate:0 };
  const { net } = calcDay(day);
  const h = net / 60, rate = parseFloat(c.hourlyRate)||0;
  let earn = h * rate;
  const ot  = parseFloat(c.overtimeThreshold)||0;
  const or2 = parseFloat(c.overtimeRate)||1.25;
  if (ot > 0 && h > ot) earn = ot*rate + (h-ot)*rate*or2;
  return { earn, rate };
}

/* Calcul gain journalier en temps réel (secondes écoulées depuis entrée) */
function calcLiveDayEarn() {
  const key = todayKey();
  const day = S.punches[key] || {};
  const c = getContract(key);
  if (!c) return 0;
  const rate = parseFloat(c.hourlyRate)||0;
  if (!rate) return 0;

  const now = new Date();
  const nowSec = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();

  let totalSec = 0;
  const bThresholdSec = (parseFloat(S.settings.breakThreshold)||6)*3600;
  const bDurSec       = (parseFloat(S.settings.breakDuration)||30)*60;

  if (day.em) {
    const startSec = parseT(day.em)*60;
    const endSec   = day.sm ? parseT(day.sm)*60 : (day.es ? parseT(day.es)*60 : nowSec);
    if (!day.sm) totalSec += Math.max(0, nowSec - startSec); // matin en cours
    else         totalSec += Math.max(0, endSec - startSec);
  }
  if (day.ea) {
    const startSec = parseT(day.ea)*60;
    const endSec   = day.es ? parseT(day.es)*60 : nowSec;
    totalSec += Math.max(0, (day.es ? endSec : nowSec) - startSec);
  }

  // Déduire pause si seuil atteint
  if (totalSec >= bThresholdSec) totalSec = Math.max(0, totalSec - bDurSec);

  // Heures supp
  const ot  = parseFloat(c.overtimeThreshold)||0;
  const or2 = parseFloat(c.overtimeRate)||1.25;
  const hours = totalSec / 3600;
  let earn = 0;
  if (ot > 0 && hours > ot) earn = ot*rate + (hours-ot)*rate*or2;
  else earn = hours * rate;
  return Math.max(0, earn);
}

/* Calcul gain mensuel incluant le live du jour */
function calcLiveMonthEarn() {
  const now = new Date();
  const yr  = now.getFullYear(), mo = now.getMonth();
  const todayStr = todayKey();
  let total = 0;
  Object.entries(S.punches).forEach(([k, day]) => {
    const d = new Date(k);
    if (d.getFullYear()!==yr || d.getMonth()!==mo) return;
    if (k === todayStr) total += calcLiveDayEarn(); // live pour aujourd'hui
    else                total += calcEarn(k, day).earn;
  });
  // Si aujourd'hui pas encore dans punches mais en cours
  if (!S.punches[todayStr]) total += calcLiveDayEarn();
  return total;
}

function calcStreak() {
  let s = 0;
  const d = new Date();
  for (let i=0; i<400; i++) {
    const k = fmtDate(d), dow = d.getDay();
    if (dow===0||dow===6) { d.setDate(d.getDate()-1); continue; }
    if (S.punches[k]&&(S.punches[k].em||S.punches[k].es)) { s++; d.setDate(d.getDate()-1); }
    else break;
  }
  return s;
}

const CONTRACT_TYPES = ['CDI','CDD','Intérim','Freelance','Stage','Alternance','Autre'];

/* ════════════════════════════════════════════
   CLOCK — toutes les secondes
════════════════════════════════════════════ */
setInterval(() => {
  document.getElementById('liveClock').textContent = fmtTimeFull(new Date());
  updateLiveCounters();
}, 1000);

/* ════════════════════════════════════════════
   LIVE COUNTERS (jour + mois, chaque seconde)
════════════════════════════════════════════ */
function updateLiveCounters() {
  const key  = todayKey();
  const day  = S.punches[key] || {};
  const now  = new Date();
  const nowM = now.getHours()*60 + now.getMinutes() + now.getSeconds()/60;

  /* ── Timer ── */
  let totalSec = 0;
  if (day.em) totalSec += ((day.sm ? parseT(day.sm) : (day.es ? parseT(day.es) : nowM)) - parseT(day.em)) * 60;
  if (day.ea) totalSec += ((day.es ? parseT(day.es) : nowM) - parseT(day.ea)) * 60;
  totalSec = Math.floor(Math.max(0, totalSec));

  let status = 'idle';
  if (day.es) status='done'; else if(day.ea) status='working'; else if(day.sm) status='paused'; else if(day.em) status='working';

  const elEl  = document.getElementById('elapsedDisp');
  const stEl  = document.getElementById('heroStatus');
  const stTxt = document.getElementById('heroSTxt');
  if (elEl) {
    elEl.className = 'elapsed' + (status==='working'?' active':'');
    elEl.textContent = secToHMS(totalSec);
  }
  if (stEl) {
    stEl.className = 'hero-status hs-'+status;
    stTxt.textContent = { idle:'En attente', working:'En cours', paused:'Pause déjeuner', done:'Journée terminée' }[status];
  }

  /* ── Gain journalier LIVE ── */
  const dayEarn   = calcLiveDayEarn();
  const monthEarn = calcLiveMonthEarn();
  const c         = getContract(key);
  const rate      = c ? parseFloat(c.hourlyRate)||0 : 0;

  const earnEl = document.getElementById('todayEarnLive');
  if (earnEl) {
    const wasOld = _prevDayEarn;
    earnEl.textContent = fmtMoney(dayEarn);
    if (status==='working' && Math.floor(dayEarn*100) !== Math.floor(wasOld*100)) {
      earnEl.classList.remove('ticking');
      void earnEl.offsetWidth; // reflow
      earnEl.classList.add('ticking');
    }
    _prevDayEarn = dayEarn;
  }

  // Afficher le taux en cours
  const rateEl = document.getElementById('liveRateDisp');
  if (rateEl) {
    rateEl.textContent = rate > 0 && status==='working'
      ? `${rate.toFixed(2)} €/h · +${(rate/3600).toFixed(4)} €/sec`
      : '';
  }

  /* ── Gain mensuel LIVE ── */
  const monthEl = document.getElementById('sm-e');
  if (monthEl) {
    monthEl.textContent = fmtMoney(monthEarn);
    if (status==='working' && Math.floor(monthEarn*100) !== Math.floor(_prevMonthEarn*100)) {
      monthEl.classList.remove('bump');
      void monthEl.offsetWidth;
      monthEl.classList.add('bump');
    }
    _prevMonthEarn = monthEarn;
  }

  // Barre de progression mois vs objectif semaine×4
  const target = (parseFloat(S.settings.weekTarget)||35) * 4 * rate;
  const fill   = document.getElementById('monthProgressFill');
  if (fill && target > 0) fill.style.width = Math.min(100, (monthEarn/target)*100) + '%';
  const smSub = document.getElementById('sm-s');
  if (smSub) smSub.textContent = now.toLocaleString('fr-FR',{month:'long',year:'numeric'});
}

/* ════════════════════════════════════════════
   PUNCH
════════════════════════════════════════════ */
async function punch(type, e) {
  const key = todayKey();
  const day = S.punches[key] || {};
  if (day[type]) { toast('warning','Déjà pointé !'); return; }
  const t = fmtTime(new Date());
  const newDay = { ...day, [type]:t, manual:false };
  S.punches[key] = newDay;
  updatePunchBtns(); updateTimeline(); updateLiveCounters();

  if (firebaseReady) {
    try {
      await db.collection(punchesCol()).doc(key).set(newDay, { merge:true });
      setSyncStatus('synced','Synchronisé');
    } catch(err) { setSyncStatus('offline','Hors-ligne'); console.error(err); }
  } else { saveLocal(); }

  const labs = { em:'Entrée matin', sm:'Sortie midi', ea:'Entrée après-midi', es:'Sortie soir' };
  toast('success', `${labs[type]} — ${t}`);
  confetti(e);
  updateDashStats();
  checkBadges();
}

function updatePunchBtns() {
  const day  = S.punches[todayKey()] || {};
  const deps = { em:[], sm:['em'], ea:['sm'], es:['ea'] };
  ['em','sm','ea','es'].forEach(t => {
    const btn = document.getElementById('btn-'+t);
    const pt  = document.getElementById('pt-'+t);
    if (!btn) return;
    if (day[t]) { btn.disabled=true; btn.style.opacity='.55'; if(pt) pt.textContent=day[t]; }
    else {
      const ok = deps[t].every(d => day[d]);
      btn.disabled = !ok; btn.style.opacity = ok?'1':'';
      if (pt) pt.textContent = '';
    }
  });
}

/* ════════════════════════════════════════════
   TIMELINE
════════════════════════════════════════════ */
function updateTimeline() {
  const key = todayKey(), day = S.punches[key] || {};
  const el  = document.getElementById('todayTL');
  const items = [
    {k:'em',l:'Entrée matin',ic:'☀️',cls:'td-neon'},
    {k:'sm',l:'Sortie midi',ic:'🌤',cls:'td-gold'},
    {k:'ea',l:'Entrée après-midi',ic:'🌇',cls:'td-blue'},
    {k:'es',l:'Sortie soir',ic:'🌙',cls:'td-red'},
  ];
  let html = items.map(i => `
    <div class="tl-item">
      <div class="tl-dot ${day[i.k]?i.cls:'td-empty'}">${i.ic}</div>
      <div class="tl-content">
        <div class="tl-lbl">${i.l}</div>
        ${day[i.k]
          ? `<div class="tl-time">${day[i.k]}</div>`
          : `<div class="tl-pend">— non pointé</div>`}
      </div>
    </div>`).join('');
  if (day.em || day.es) {
    const { net, breakApplied, breakMin } = calcDay(day);
    const { earn } = calcEarn(key, day);
    html += `
      <div style="margin-top:8px;background:var(--surface2);border-radius:10px;padding:10px 12px;border:1px solid var(--border2)">
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:11px;color:var(--text2)">⏱ Net${breakApplied?` (pause ${breakMin}min)`:''}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--neon)">${minToHM(net)}</span>
        </div>
        ${earn>0?`
        <div style="display:flex;justify-content:space-between;margin-top:4px">
          <span style="font-size:11px;color:var(--text2)">💰 Gains</span>
          <span style="font-family:'Sora',sans-serif;font-weight:700;color:var(--gold)">${fmtMoney(earn)}</span>
        </div>`:''}
      </div>`;
  }
  el.innerHTML = html;
}

/* ════════════════════════════════════════════
   DASHBOARD STATS
════════════════════════════════════════════ */
function updateDashStats() {
  const now = new Date(), dow = now.getDay()||7;
  let wMin=0, wEarn=0, wDays=0;
  for (let i=1; i<=7; i++) {
    const d = new Date(now); d.setDate(now.getDate()-dow+i);
    const k = fmtDate(d), day = S.punches[k];
    if (day&&(day.em||day.es)) {
      wMin  += calcDay(day).net;
      wEarn += calcEarn(k,day).earn;
      wDays++;
    }
  }
  const target = parseFloat(S.settings.weekTarget)||35;
  document.getElementById('sw-h').textContent = minToHM(wMin);
  document.getElementById('sw-t').textContent = `/ ${target}h objectif`;
  document.getElementById('sw-e').textContent = fmtMoney(wEarn);
  document.getElementById('sw-d').textContent = `${wDays} jour(s)`;

  const s = calcStreak();
  document.getElementById('streak-v').textContent = s + '🔥';
  renderActiveContract();
}

function renderActiveContract() {
  const c = getContract(todayKey());
  const el = document.getElementById('activeContractInfo');
  if (!c) {
    el.innerHTML = `<div class="empty-state" style="padding:16px 0"><div class="empty-icon" style="font-size:24px">📋</div><p style="font-size:12px">Aucun contrat actif.</p></div>`;
    return;
  }
  const tCls = 'ct-' + (c.type||'Autre');
  el.innerHTML = `
    <div class="ctype-badge ${tCls}">${c.type||'Autre'}</div>
    <div class="cname" style="font-size:13px">${c.name}</div>
    <div class="cperiod">${c.startDate||'—'} → ${c.endDate||'En cours'}</div>
    <div class="cchips">
      <div class="cchip rate">💰 ${c.hourlyRate} €/h</div>
      <div class="cchip">⏸ ${c.breakDuration}min si ≥${c.breakThreshold}h</div>
      ${c.overtimeThreshold?`<div class="cchip">🔥 ×${c.overtimeRate} après ${c.overtimeThreshold}h</div>`:''}
      <div class="cchip active">✅ Actif</div>
    </div>`;
}

/* ════════════════════════════════════════════
   SAISIE MANUELLE
════════════════════════════════════════════ */
function fillManToday() {
  document.getElementById('manDate').value = todayKey();
  loadDayIntoForm(); previewMan();
}

function loadDayIntoForm() {
  const ds  = document.getElementById('manDate').value;
  if (!ds) return;
  const day = S.punches[ds] || {};
  ['em','sm','ea','es'].forEach(k => {
    document.getElementById('man-'+k).value = day[k] || '';
  });
  document.getElementById('btnDelDay').style.display = S.punches[ds] ? '' : 'none';
}

function clearMan() {
  ['manDate','man-em','man-sm','man-ea','man-es'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('manPreview').innerHTML = '';
  document.getElementById('btnDelDay').style.display = 'none';
}

function previewMan() {
  const ds  = document.getElementById('manDate').value;
  const day = {
    em: document.getElementById('man-em').value,
    sm: document.getElementById('man-sm').value,
    ea: document.getElementById('man-ea').value,
    es: document.getElementById('man-es').value,
  };
  const { net, breakApplied, breakMin } = calcDay(day);
  const { earn } = calcEarn(ds, day);
  if (!ds) { document.getElementById('manPreview').innerHTML = ''; return; }
  document.getElementById('manPreview').innerHTML = `
    <div style="background:var(--surface);border-radius:10px;padding:12px 14px;border:1px solid rgba(56,189,248,.2)">
      <div style="font-size:11px;color:var(--blue);font-weight:600;margin-bottom:8px">📋 Aperçu du calcul</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div><div style="font-size:10px;color:var(--text3)">Temps net</div>
          <div style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--neon)">${minToHM(net)}</div></div>
        ${breakApplied?`<div><div style="font-size:10px;color:var(--text3)">Pause</div>
          <div style="font-size:12px;color:var(--text2)">-${breakMin}min</div></div>`:''}
        <div><div style="font-size:10px;color:var(--text3)">Gains</div>
          <div style="font-family:'Sora',sans-serif;font-weight:700;color:var(--gold)">${earn>0?fmtMoney(earn):'—'}</div></div>
      </div>
    </div>`;
}

async function saveManual() {
  const ds = document.getElementById('manDate').value;
  if (!ds) { toast('warning','Sélectionnez une date'); return; }
  const em = document.getElementById('man-em').value;
  const sm = document.getElementById('man-sm').value;
  const ea = document.getElementById('man-ea').value;
  const es = document.getElementById('man-es').value;
  if (!em&&!sm&&!ea&&!es) { toast('warning','Renseignez au moins un horaire'); return; }
  if (em&&sm&&parseT(sm)<=parseT(em)) { toast('error','Sortie midi ≤ Entrée matin'); return; }
  if (ea&&es&&parseT(es)<=parseT(ea)) { toast('error','Sortie soir ≤ Entrée après-midi'); return; }
  const newDay = { manual:true, updatedAt:new Date().toISOString() };
  if (em) newDay.em=em; if (sm) newDay.sm=sm; if (ea) newDay.ea=ea; if (es) newDay.es=es;
  S.punches[ds] = newDay;
  if (firebaseReady) {
    try {
      await db.collection(punchesCol()).doc(ds).set(newDay);
      setSyncStatus('synced','Synchronisé');
      toast('success',`☁️ ${ds} enregistré dans le cloud`);
    } catch(err) { setSyncStatus('offline','Hors-ligne'); toast('error','Erreur: '+err.message); }
  } else { saveLocal(); toast('success',`💾 ${ds} enregistré`); }
  confettiCenter();
  checkBadges();
  if (ds===todayKey()) { updatePunchBtns(); updateTimeline(); updateDashStats(); }
  document.getElementById('btnDelDay').style.display = '';
  renderManualList();
}

async function deleteDayBtn() {
  const ds = document.getElementById('manDate').value;
  if (!ds || !confirm(`Supprimer le ${ds} ?`)) return;
  delete S.punches[ds];
  if (firebaseReady) { try { await db.collection(punchesCol()).doc(ds).delete(); } catch(e) {} }
  else saveLocal();
  clearMan(); updateDashStats(); renderHistory(); renderManualList();
  toast('info','🗑 Jour supprimé');
}

function renderManualList() {
  const el = document.getElementById('manualList');
  const manual = Object.entries(S.punches)
    .filter(([,d]) => d.manual)
    .sort(([a],[b]) => b.localeCompare(a))
    .slice(0,20);
  if (!manual.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">✏️</div><p>Aucune saisie manuelle</p></div>`;
    return;
  }
  el.innerHTML = manual.map(([ds,day]) => {
    const d = new Date(ds+'T00:00:00');
    const { net } = calcDay(day);
    const { earn } = calcEarn(ds, day);
    return `<div class="hist-item" onclick="loadManualItem('${ds}')">
      <div class="hist-date">
        <div class="hist-dm">${d.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'})}</div>
        <div class="hist-ds">${ds}</div>
      </div>
      <div class="hist-chips">
        ${day.em?`<span class="hchip hc-em">☀️ ${day.em}</span>`:''}
        ${day.sm?`<span class="hchip hc-sm">🌤 ${day.sm}</span>`:''}
        ${day.ea?`<span class="hchip hc-ea">🌇 ${day.ea}</span>`:''}
        ${day.es?`<span class="hchip hc-es">🌙 ${day.es}</span>`:''}
        <span class="hchip hc-m">✏️</span>
      </div>
      <div class="hist-h">${minToHM(net)}</div>
      <div class="hist-e">${earn>0?fmtMoney(earn):'—'}</div>
    </div>`;
  }).join('');
}

function loadManualItem(ds) {
  document.getElementById('manDate').value = ds;
  loadDayIntoForm(); previewMan();
  document.querySelector('.manual-panel').scrollIntoView({behavior:'smooth'});
  toast('info',`📋 ${ds} chargé`);
}

/* ════════════════════════════════════════════
   CALENDAR
════════════════════════════════════════════ */
function renderCalendar() {
  const mNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  document.getElementById('calLabel').textContent = `${mNames[calM]} ${calY}`;
  const grid = document.getElementById('calGrid');
  const todayStr = todayKey();
  grid.innerHTML = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(n=>`<div class="cal-dname">${n}</div>`).join('');
  const firstDay = (new Date(calY,calM,1).getDay()||7)-1;
  const dIM = new Date(calY,calM+1,0).getDate();
  for (let i=0; i<firstDay; i++) grid.innerHTML += `<div class="cal-cell ec"></div>`;
  for (let day=1; day<=dIM; day++) {
    const ds = `${calY}-${pad(calM+1)}-${pad(day)}`;
    const d  = S.punches[ds];
    let cls  = '';
    if (ds===todayStr) cls += ' today';
    if (d) { cls += (d.em&&d.es)?' complete':' partial'; if(d.manual) cls+=' manual'; }
    grid.innerHTML += `<div class="cal-cell${cls}" onclick="showDayDetail('${ds}')">${day}${d?'<div class="cal-dot"></div>':''}</div>`;
  }
}

function calNav(dir) {
  calM += dir;
  if (calM>11) { calM=0; calY++; }
  if (calM<0)  { calM=11; calY--; }
  renderCalendar();
}
function calToday() {
  const n = new Date(); calY=n.getFullYear(); calM=n.getMonth();
  renderCalendar();
}

function showDayDetail(ds) {
  document.getElementById('calDetail').style.display = '';
  const d = new Date(ds+'T00:00:00');
  document.getElementById('calDetailTitle').textContent = d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const day = S.punches[ds] || {};
  const { net, breakApplied, breakMin, gross } = calcDay(day);
  const { earn } = calcEarn(ds, day);
  const items = [
    {k:'em',l:'Entrée matin',ic:'☀️',cls:'td-neon'},{k:'sm',l:'Sortie midi',ic:'🌤',cls:'td-gold'},
    {k:'ea',l:'Entrée après-midi',ic:'🌇',cls:'td-blue'},{k:'es',l:'Sortie soir',ic:'🌙',cls:'td-red'}
  ];
  document.getElementById('calDetailContent').innerHTML = `
    <div class="tl" style="margin-bottom:12px">
      ${items.map(i=>`<div class="tl-item"><div class="tl-dot ${day[i.k]?i.cls:'td-empty'}">${i.ic}</div>
        <div class="tl-content"><div class="tl-lbl">${i.l}</div>
        ${day[i.k]?`<div class="tl-time">${day[i.k]}</div>`:`<div class="tl-pend">—</div>`}
        </div></div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:10px;color:var(--text3)">Brut</div>
        <div style="font-family:'JetBrains Mono',monospace;font-weight:600">${minToHM(gross)}</div>
      </div>
      <div style="background:rgba(16,245,160,.08);border:1px solid rgba(16,245,160,.2);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:10px;color:var(--text3)">Net${breakApplied?` (-${breakMin}m)`:''}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--neon)">${minToHM(net)}</div>
      </div>
      <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:10px;color:var(--text3)">Gains</div>
        <div style="font-family:'Sora',sans-serif;font-weight:700;color:var(--gold)">${fmtMoney(earn)}</div>
      </div>
    </div>
    ${day.manual?'<span style="font-size:11px;color:var(--blue)">✏️ Saisie manuelle</span><br>':''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-ghost btn-sm" onclick="loadManualItem('${ds}');sv('saisie',null)">✏️ Modifier</button>
      <button class="btn btn-danger btn-sm" onclick="deleteDayFromCal('${ds}')">🗑 Supprimer</button>
    </div>`;
  document.getElementById('calDetail').scrollIntoView({behavior:'smooth'});
}

async function deleteDayFromCal(ds) {
  if (!confirm(`Supprimer le ${ds} ?`)) return;
  delete S.punches[ds];
  if (firebaseReady) { try { await db.collection(punchesCol()).doc(ds).delete(); } catch(e) {} }
  else saveLocal();
  document.getElementById('calDetail').style.display = 'none';
  renderCalendar(); renderHistory(); updateDashStats();
  toast('info','🗑 Jour supprimé');
}

/* ════════════════════════════════════════════
   HISTORY
════════════════════════════════════════════ */
function renderHistory() {
  const el = document.getElementById('histList');
  const f  = document.getElementById('histFilter').value;
  const entries = Object.entries(S.punches)
    .filter(([k]) => !f || k.startsWith(f))
    .sort(([a],[b]) => b.localeCompare(a));
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>Aucun pointage</p></div>`;
    return;
  }
  el.innerHTML = entries.map(([ds,day]) => {
    const d  = new Date(ds+'T00:00:00');
    const { net }  = calcDay(day);
    const { earn } = calcEarn(ds, day);
    const ok = day.em && day.es;
    return `<div class="hist-item" onclick="sv('calendar',null);showDayDetail('${ds}')">
      <div style="width:7px;height:7px;border-radius:50%;background:${ok?'var(--neon)':'var(--gold)'};flex-shrink:0;margin-top:4px"></div>
      <div class="hist-date">
        <div class="hist-dm">${d.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'})}</div>
        <div class="hist-ds">${ds}</div>
      </div>
      <div class="hist-chips">
        ${day.em?`<span class="hchip hc-em">☀️ ${day.em}</span>`:''}
        ${day.sm?`<span class="hchip hc-sm">🌤 ${day.sm}</span>`:''}
        ${day.ea?`<span class="hchip hc-ea">🌇 ${day.ea}</span>`:''}
        ${day.es?`<span class="hchip hc-es">🌙 ${day.es}</span>`:''}
        ${day.manual?'<span class="hchip hc-m">✏️</span>':''}
      </div>
      <div class="hist-h">${minToHM(net)}</div>
      <div class="hist-e">${earn>0?fmtMoney(earn):'—'}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   STATS
════════════════════════════════════════════ */
function renderStats() {
  const period = document.getElementById('statPeriod').value;
  const now = new Date();
  let entries = [];
  if (period==='week') {
    const dow = now.getDay()||7;
    for (let i=1; i<=7; i++) { const d=new Date(now); d.setDate(now.getDate()-dow+i); entries.push(fmtDate(d)); }
  } else if (period==='month') {
    const days = new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    for (let i=1; i<=days; i++) entries.push(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(i)}`);
  } else {
    for (let mo=2; mo>=0; mo--) {
      const d = new Date(now.getFullYear(),now.getMonth()-mo,1);
      const days = new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
      for (let i=1; i<=days; i++) { const dd=new Date(d.getFullYear(),d.getMonth(),i); if(dd<=now) entries.push(fmtDate(dd)); }
    }
  }
  let tMin=0, tEarn=0, wDays=0, maxMin=0;
  const hD=[], eD=[];
  entries.forEach(ds => {
    const day = S.punches[ds];
    if (day) {
      const { net } = calcDay(day);
      const { earn } = calcEarn(ds, day);
      tMin+=net; tEarn+=earn; if(net>0)wDays++; if(net>maxMin)maxMin=net;
      hD.push({date:ds,val:net}); eD.push({date:ds,val:earn});
    } else { hD.push({date:ds,val:0}); eD.push({date:ds,val:0}); }
  });
  const avg = wDays>0 ? tMin/wDays : 0;
  document.getElementById('statsCards').innerHTML = `
    <div class="stat-card"><div class="stat-label">⏱ Total</div><div class="stat-val v-neon">${minToHM(tMin)}</div><div class="stat-sub">${wDays} j. travaillé(s)</div></div>
    <div class="stat-card"><div class="stat-label">💰 Gains</div><div class="stat-val v-gold">${fmtMoney(tEarn)}</div><div class="stat-sub">Sur la période</div></div>
    <div class="stat-card"><div class="stat-label">📊 Moy./jour</div><div class="stat-val v-violet">${minToHM(avg)}</div><div class="stat-sub">Jours travaillés</div></div>
    <div class="stat-card"><div class="stat-label">🏆 Meilleure J.</div><div class="stat-val">${minToHM(maxMin)}</div><div class="stat-sub">Record période</div></div>`;
  renderBar('hoursChart', hD, maxMin||480, 'var(--violet)', v => minToHM(v));
  renderBar('earnChart',  eD, Math.max(...eD.map(d=>d.val),1), 'var(--gold)', v => v>0?Math.round(v)+'€':'');
}

function renderBar(id, data, maxV, color, lFn) {
  const el   = document.getElementById(id);
  const show = data.length>14 ? data.filter((_,i,a)=>i%Math.ceil(a.length/14)===0) : data;
  el.innerHTML = `<div class="bar-chart">${show.map(d => {
    const pct = maxV>0 ? (d.val/maxV)*100 : 0;
    const lbl = new Date(d.date+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});
    return `<div class="bar-col">
      <div class="bar-val">${d.val>0?lFn(d.val):''}</div>
      <div class="bar-fill" style="height:${Math.max(pct,2)}%;background:linear-gradient(180deg,${color},${color}88)"></div>
      <div class="bar-lbl">${lbl}</div>
    </div>`;
  }).join('')}</div>`;
}

/* ════════════════════════════════════════════
   CONTRACTS
════════════════════════════════════════════ */
function renderContracts() {
  const el = document.getElementById('contractsList');
  if (!S.contracts.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📄</div><p>Aucun contrat.<br>Cliquez sur "+ Nouveau".</p></div>`;
    return;
  }
  const today = todayKey();
  el.innerHTML = S.contracts.map((c,i) => {
    const isA = (!c.startDate||c.startDate<=today) && (!c.endDate||c.endDate>=today);
    const tCls = 'ct-'+(c.type||'Autre');
    return `<div class="ccard ${isA?'is-active':''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="ctype-badge ${tCls}">${c.type||'Autre'}</div>
          <div class="cname">${c.name}</div>
          <div class="cperiod">${c.startDate||'Début non défini'} → ${c.endDate||'En cours'}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openContractModal(${i})">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="delContract(${i})">🗑</button>
        </div>
      </div>
      <div class="cchips">
        <div class="cchip rate">💰 ${c.hourlyRate} €/h</div>
        <div class="cchip">⏸ ${c.breakDuration}min si ≥${c.breakThreshold}h</div>
        ${c.overtimeThreshold?`<div class="cchip">🔥 ×${c.overtimeRate} après ${c.overtimeThreshold}h</div>`:''}
        ${isA?`<div class="cchip active">✅ Actif</div>`:''}
      </div>
    </div>`;
  }).join('');
}

function openContractModal(idx=null) {
  const c = idx!==null ? S.contracts[idx] : {};
  const typeOpts = CONTRACT_TYPES.map(t=>`<option value="${t}" ${c.type===t?'selected':''}>${t}</option>`).join('');
  document.getElementById('modalContent').innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${idx!==null?'✏️ Modifier':'📄 Nouveau contrat'}</div>
      <button class="modal-close" onclick="closeMod()">×</button>
    </div>
    <div class="frow" style="grid-template-columns:1fr">
      <div class="fgroup"><label>Nom du contrat</label><input type="text" id="cName" value="${c.name||''}" placeholder="Ex: CDI Développeur"></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Type de contrat</label><select id="cType"><option value="">— Sélectionner —</option>${typeOpts}</select></div>
      <div class="fgroup"><label>Taux horaire (€/h)</label><input type="number" id="cRate" value="${c.hourlyRate||''}" step="0.01" min="0" placeholder="Ex: 15.50"></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Date de début</label><input type="date" id="cStart" value="${c.startDate||''}"></div>
      <div class="fgroup"><label>Date de fin (optionnel)</label><input type="date" id="cEnd" value="${c.endDate||''}"></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Seuil pause (h)</label><input type="number" id="cBT" value="${c.breakThreshold||6}" step="0.5" min="0"></div>
      <div class="fgroup"><label>Durée pause (min)</label><input type="number" id="cBD" value="${c.breakDuration||30}" min="0"></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Seuil heures supp (h/j, 0=off)</label><input type="number" id="cOT" value="${c.overtimeThreshold||0}" step="0.5" min="0"></div>
      <div class="fgroup"><label>Majoration (×)</label><input type="number" id="cOR" value="${c.overtimeRate||1.25}" step="0.05" min="1"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeMod()">Annuler</button>
      <button class="btn btn-primary" onclick="saveContract(${idx})">💾 Sauvegarder</button>
    </div>`;
  openMod();
}

async function saveContract(idx) {
  const c = {
    name:             document.getElementById('cName').value.trim() || 'Contrat sans nom',
    type:             document.getElementById('cType').value || 'Autre',
    startDate:        document.getElementById('cStart').value,
    endDate:          document.getElementById('cEnd').value,
    hourlyRate:       parseFloat(document.getElementById('cRate').value)||0,
    breakThreshold:   parseFloat(document.getElementById('cBT').value)||6,
    breakDuration:    parseFloat(document.getElementById('cBD').value)||30,
    overtimeThreshold:parseFloat(document.getElementById('cOT').value)||0,
    overtimeRate:     parseFloat(document.getElementById('cOR').value)||1.25,
    createdAt:        idx!==null ? (S.contracts[idx].createdAt||Date.now()) : Date.now(),
  };
  if (firebaseReady) {
    try {
      const col = db.collection(contractsCol());
      if (idx!==null && S.contracts[idx].id) await col.doc(S.contracts[idx].id).set(c);
      else await col.add(c);
      toast('success',`☁️ Contrat "${c.name}" sauvegardé`);
    } catch(err) { toast('error','Erreur : '+err.message); }
  } else {
    if (idx!==null) S.contracts[idx] = {...c, id:S.contracts[idx].id};
    else S.contracts.push({...c, id:'local_'+Date.now()});
    saveLocal(); renderContracts(); renderActiveContract();
    toast('success',`✅ Contrat "${c.name}" sauvegardé`);
  }
  closeMod();
}

async function delContract(i) {
  if (!confirm(`Supprimer "${S.contracts[i].name}" ?`)) return;
  if (firebaseReady && S.contracts[i].id) {
    try { await db.collection(contractsCol()).doc(S.contracts[i].id).delete(); } catch(e) {}
  } else { S.contracts.splice(i,1); saveLocal(); renderContracts(); }
  toast('info','🗑 Contrat supprimé');
}

/* ════════════════════════════════════════════
   BADGES
════════════════════════════════════════════ */
const BADGES_DEF = [
  {id:'first_punch',  ic:'👆', name:'Premier pointage',  desc:'Vous avez pointé pour la première fois !'},
  {id:'first_manual', ic:'✏️', name:'Saisie manuelle',   desc:'Premier jour saisi manuellement'},
  {id:'first_contract',ic:'📄',name:'Premier contrat',    desc:'Premier contrat créé'},
  {id:'first_week',   ic:'📅', name:'Première semaine',  desc:'7 jours enregistrés'},
  {id:'streak_3',     ic:'🔥', name:'En feu !',           desc:'3 jours consécutifs'},
  {id:'streak_5',     ic:'🔥🔥',name:'Blazing',           desc:'5 jours consécutifs'},
  {id:'streak_10',    ic:'⚡', name:'Inarrêtable',        desc:'10 jours consécutifs'},
  {id:'streak_20',    ic:'💎', name:'Diamant',            desc:'20 jours consécutifs'},
  {id:'earn_100',     ic:'💰', name:'100€ gagnés',        desc:'Total cumulé ≥ 100 €'},
  {id:'earn_500',     ic:'💰💰',name:'500€ gagnés',       desc:'Total cumulé ≥ 500 €'},
  {id:'earn_1000',    ic:'🤑', name:'1000€ gagnés',       desc:'Total cumulé ≥ 1 000 €'},
  {id:'full_week',    ic:'🏅', name:'Semaine parfaite',   desc:'5 jours complets en 1 semaine'},
  {id:'early_bird',   ic:'🌅', name:'Lève-tôt',           desc:'Entrée matin avant 7h30'},
  {id:'night_owl',    ic:'🦉', name:'Noctambule',         desc:'Sortie après 20h'},
  {id:'multi_contract',ic:'📋',name:'Multi-contrats',     desc:'2 types de contrats différents'},
];

async function checkBadges() {
  const all = Object.entries(S.punches);
  const s   = calcStreak();
  const tE  = all.reduce((acc,[k,d]) => acc+calcEarn(k,d).earn, 0);
  const now = new Date(), dow = now.getDay()||7;
  let fw = 0;
  for (let i=1; i<=5; i++) {
    const d=new Date(now); d.setDate(now.getDate()-dow+i);
    const k=fmtDate(d); if(S.punches[k]&&S.punches[k].em&&S.punches[k].es) fw++;
  }
  const ctypes = [...new Set(S.contracts.map(c=>c.type))];
  const checks = [
    ['first_punch',   all.length>=1],
    ['first_manual',  all.some(([,d])=>d.manual)],
    ['first_contract',S.contracts.length>=1],
    ['first_week',    all.length>=7],
    ['streak_3',  s>=3], ['streak_5',s>=5], ['streak_10',s>=10], ['streak_20',s>=20],
    ['earn_100',tE>=100], ['earn_500',tE>=500], ['earn_1000',tE>=1000],
    ['full_week',   fw===5],
    ['early_bird',  all.some(([,d])=>d.em&&parseT(d.em)<7*60+30)],
    ['night_owl',   all.some(([,d])=>d.es&&parseT(d.es)>20*60)],
    ['multi_contract', ctypes.length>=2],
  ];
  let newOnes = [];
  checks.forEach(([id,cond]) => { if(cond&&!S.badges[id]) { S.badges[id]=true; newOnes.push(id); } });
  if (newOnes.length) {
    if (firebaseReady) { try { await db.doc(userDoc()).set({badges:S.badges},{merge:true}); } catch(e){} }
    else saveLocal();
    newOnes.forEach(id => {
      const b = BADGES_DEF.find(b=>b.id===id);
      if (b) toast('gold',`🏆 Badge débloqué : ${b.name}`);
    });
    renderBadges();
  }
}

function renderBadges() {
  const s    = calcStreak();
  const best = Math.max(s, parseInt(localStorage.getItem('tf_best')||'0'));
  if (s > parseInt(localStorage.getItem('tf_best')||'0')) localStorage.setItem('tf_best',s);
  document.getElementById('streakBig').textContent   = s;
  document.getElementById('bestStreak').textContent  = best;
  const earned = BADGES_DEF.filter(b=>S.badges[b.id]);
  document.getElementById('badgeCount').textContent  = `${earned.length}/${BADGES_DEF.length}`;
  document.getElementById('badgeGrid').innerHTML = BADGES_DEF.map(b => {
    const isE = !!S.badges[b.id];
    return `<div class="badge-item ${isE?'earned':'badge-locked'}">
      <div class="badge-ic">${b.ic}</div>
      <div class="badge-info">
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>
      ${isE?'<span style="color:var(--gold);font-size:16px">✓</span>':'<span style="color:var(--text3);font-size:16px">🔒</span>'}
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════ */
function loadSettings() {
  document.getElementById('sName').value = S.settings.name||'';
  document.getElementById('sWeek').value = S.settings.weekTarget||35;
  document.getElementById('sBT').value   = S.settings.breakThreshold||6;
  document.getElementById('sBD').value   = S.settings.breakDuration||30;

  const el = document.getElementById('cloudStatusContent');
  if (firebaseReady && currentUser) {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:var(--neon);box-shadow:0 0 8px rgba(16,245,160,.6)"></div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--neon)">Connecté à Firestore</div>
          <div style="font-size:11px;color:var(--text3)">${currentUser.email}</div>
          <div style="font-size:11px;color:var(--text3)">UID : ${currentUser.uid}</div>
        </div>
      </div>
      <p style="margin-top:8px;font-size:11px;color:var(--text2)">Données synchronisées en temps réel sur tous vos appareils.</p>`;
  } else {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:var(--gold)"></div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--gold)">Mode local</div>
          <div style="font-size:11px;color:var(--text3)">Données dans ce navigateur uniquement.</div>
        </div>
      </div>`;
  }
}

async function saveSettings() {
  S.settings.name            = document.getElementById('sName').value.trim();
  S.settings.weekTarget      = parseFloat(document.getElementById('sWeek').value)||35;
  S.settings.breakThreshold  = parseFloat(document.getElementById('sBT').value)||6;
  S.settings.breakDuration   = parseFloat(document.getElementById('sBD').value)||30;
  if (firebaseReady) {
    try { await db.doc(userDoc()).set({settings:S.settings},{merge:true}); toast('success','☁️ Paramètres sauvegardés'); }
    catch(e) { toast('error','Erreur : '+e.message); }
  } else { saveLocal(); toast('success','✅ Paramètres sauvegardés'); }
  updateDashStats();
}

/* ════════════════════════════════════════════
   EXPORT
════════════════════════════════════════════ */
function getExpData() {
  const f = document.getElementById('expFrom').value;
  const t = document.getElementById('expTo').value;
  return Object.entries(S.punches)
    .filter(([k]) => (!f||k>=f) && (!t||k<=t))
    .sort(([a],[b]) => a.localeCompare(b));
}
function exportCSV() {
  const data = getExpData(); if(!data.length){toast('warning','Aucune donnée');return;}
  const hdr = 'Date,Type,Entrée matin,Sortie midi,Entrée après-midi,Sortie soir,Heures brutes,Heures nettes,Pause,Contrat,Type contrat,Taux (€/h),Gains (€)\n';
  const rows = data.map(([k,d]) => {
    const{gross,net,breakApplied,breakMin}=calcDay(d), {earn,rate}=calcEarn(k,d), c=getContract(k);
    return `${k},${d.manual?'Manuel':'Auto'},${d.em||''},${d.sm||''},${d.ea||''},${d.es||''},${minToHM(gross)},${minToHM(net)},${breakApplied?breakMin+'min':''},${c?c.name:''},${c?c.type:''},${rate.toFixed(2)},${earn.toFixed(2)}`;
  }).join('\n');
  dl('timeflow_export.csv','text/csv','\ufeff'+hdr+rows);
  toast('success','📊 CSV téléchargé');
}
function exportTxt() {
  const data = getExpData(); if(!data.length){toast('warning','Aucune donnée');return;}
  let txt = `═══════════════════════════════════\n    FEUILLE DE TEMPS — TimeFlow\n`;
  if (currentUser) txt += `    ${currentUser.displayName||currentUser.email}\n`;
  txt += `═══════════════════════════════════\n\n`;
  let tMin=0, tEarn=0;
  data.forEach(([k,d]) => {
    const dd=new Date(k+'T00:00:00'), {net}=calcDay(d), {earn}=calcEarn(k,d);
    tMin+=net; tEarn+=earn;
    txt += `${dd.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}${d.manual?' [Manuel]':''}\n`;
    txt += `  ☀️ ${d.em||'—'} → ${d.sm||'—'}   🌇 ${d.ea||'—'} → ${d.es||'—'}\n`;
    txt += `  ⏱ ${minToHM(net)}   💰 ${fmtMoney(earn)}\n\n`;
  });
  txt += `═══════════════════════════════════\nTOTAL : ${minToHM(tMin)}   GAINS : ${fmtMoney(tEarn)}\n`;
  dl('timeflow_rapport.txt','text/plain',txt);
  toast('success','📄 Rapport téléchargé');
}
function exportJSON() {
  dl('timeflow_backup.json','application/json', JSON.stringify({...S, exportDate:new Date().toISOString(), user:currentUser?.email},null,2));
  toast('success','🗄 Backup JSON téléchargé');
}
async function importJSON(e) {
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload = async ev => {
    try {
      const imp = JSON.parse(ev.target.result);
      if (!imp.punches&&!imp.contracts) { toast('error','❌ Fichier invalide'); return; }
      if (!confirm('Remplacer toutes vos données ?')) return;
      if (imp.punches)   S.punches   = {...imp.punches};
      if (imp.contracts) S.contracts = [...imp.contracts];
      if (imp.settings)  S.settings  = {...S.settings,...imp.settings};
      if (imp.badges)    S.badges    = {...imp.badges};
      if (firebaseReady) {
        setSyncStatus('syncing','Import…');
        const batch = db.batch();
        Object.entries(S.punches).forEach(([k,d]) => { batch.set(db.collection(punchesCol()).doc(k),d); });
        batch.set(db.doc(userDoc()),{settings:S.settings,badges:S.badges},{merge:true});
        await batch.commit();
        for (const c of S.contracts) { await db.collection(contractsCol()).add(c); }
        setSyncStatus('synced','Synchronisé');
        toast('success',`☁️ ${Object.keys(S.punches).length} jours importés`);
      } else { saveLocal(); toast('success',`✅ ${Object.keys(S.punches).length} jours importés`); }
      initApp();
    } catch(err) { toast('error','❌ Erreur : '+err.message); }
  };
  r.readAsText(f);
}
function dl(name, type, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type}));
  a.download = name; a.click();
}

/* ════════════════════════════════════════════
   RESET
════════════════════════════════════════════ */
async function resetTodayC() {
  if (!confirm('Réinitialiser aujourd\'hui ?')) return;
  const k = todayKey(); delete S.punches[k];
  if (firebaseReady) { try { await db.collection(punchesCol()).doc(k).delete(); } catch(e){} }
  else saveLocal();
  updatePunchBtns(); updateTimeline(); updateDashStats(); updateLiveCounters();
  toast('info','🗑 Journée réinitialisée');
}
async function resetAllC() {
  if (!confirm('⚠️ TOUT effacer ?')) return;
  if (!confirm('Vraiment tout effacer définitivement ?')) return;
  if (firebaseReady) {
    const snap = await db.collection(punchesCol()).get();
    const batch = db.batch();
    snap.forEach(d => batch.delete(d.ref));
    const cs = await db.collection(contractsCol()).get();
    cs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await db.doc(userDoc()).set({badges:{}},{merge:true});
  }
  S = { punches:{}, contracts:[], settings:{...S.settings}, badges:{} };
  if (!firebaseReady) saveLocal();
  initApp();
  toast('error','💣 Données effacées');
}

/* ════════════════════════════════════════════
   USER MENU
════════════════════════════════════════════ */
function openUserMenu() {
  document.getElementById('modalContent').innerHTML = `
    <div class="modal-header">
      <div class="modal-title">👤 Mon compte</div>
      <button class="modal-close" onclick="closeMod()">×</button>
    </div>
    <div style="text-align:center;padding:16px 0">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--violet-d);color:white;font-weight:700;font-size:24px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;border:2px solid rgba(124,58,237,.4)">
        ${(currentUser?.displayName||currentUser?.email||'?').charAt(0).toUpperCase()}
      </div>
      <div style="font-family:'Sora',sans-serif;font-weight:700;font-size:16px">${currentUser?.displayName||'Utilisateur'}</div>
      <div style="font-size:12px;color:var(--text3);margin-top:4px">${currentUser?.email||'Mode local'}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeMod();sv('settings',null)">⚙️ Paramètres</button>
      <button class="btn btn-danger" onclick="closeMod();logout()">🚪 Déconnexion</button>
    </div>`;
  openMod();
}

/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
let _tt;
function toast(type, msg) {
  clearTimeout(_tt);
  document.getElementById('ti').textContent = {success:'✅',warning:'⚠️',error:'❌',info:'ℹ️',gold:'🏆'}[type]||'';
  document.getElementById('tm').textContent = msg.replace(/^[✅⚠️❌ℹ️🏆🗑💣📊📄🗄☁️]\s?/,'');
  document.getElementById('toast').className = 'show';
  _tt = setTimeout(() => document.getElementById('toast').className='', 3000);
}

/* ════════════════════════════════════════════
   CONFETTI
════════════════════════════════════════════ */
function confetti(e) { spawn(e?.clientX||window.innerWidth/2, e?.clientY||window.innerHeight/2); }
function confettiCenter() { spawn(window.innerWidth/2, window.innerHeight/3); }
function spawn(x, y) {
  ['#7C3AED','#10F5A0','#F59E0B','#38BDF8','#F43F5E','#FB923C'].forEach(color => {
    for (let i=0; i<3; i++) {
      const p = document.createElement('div');
      p.className = 'cfp';
      p.style.cssText = `left:${x+(Math.random()-.5)*100}px;top:${y}px;width:${5+Math.random()*7}px;height:${5+Math.random()*7}px;background:${color};animation-delay:${Math.random()*.25}s;animation-duration:${.7+Math.random()*.6}s`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1400);
    }
  });
}

/* ════════════════════════════════════════════
   MODAL
════════════════════════════════════════════ */
function openMod() { document.getElementById('modalBg').classList.add('open'); }
function closeMod(e) {
  if (!e || e.target===document.getElementById('modalBg'))
    document.getElementById('modalBg').classList.remove('open');
}

/* ════════════════════════════════════════════
   DRAWER
════════════════════════════════════════════ */
let drawerOpen = false;
function toggleDrawer() {
  drawerOpen = !drawerOpen;
  document.getElementById('drawer').classList.toggle('open', drawerOpen);
}

/* ════════════════════════════════════════════
   VIEW SWITCHING
════════════════════════════════════════════ */
const TITLES = {
  dashboard:'Tableau de bord', saisie:'Saisie manuelle', calendar:'Calendrier',
  history:'Historique', stats:'Statistiques', contracts:'Contrats',
  badges:'Badges', export:'Export', settings:'Paramètres'
};
const SUBS = {
  dashboard:  () => new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}),
  saisie:     () => 'Saisie pour n\'importe quelle date',
  calendar:   () => 'Vue mensuelle',
  history:    () => 'Tous vos pointages',
  stats:      () => 'Analyse heures & gains',
  contracts:  () => 'Vos contrats de travail',
  badges:     () => 'Récompenses & streak',
  export:     () => 'Téléchargez vos feuilles',
  settings:   () => 'Configuration & compte',
};

function sv(name, clickedEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item,.bnav-item,.drawer-item').forEach(n => n.classList.remove('active'));
  const v = document.getElementById('view-'+name);
  if (v) v.classList.add('active');
  document.querySelectorAll(`[data-v="${name}"]`).forEach(el => el.classList.add('active'));
  document.getElementById('topTitle').textContent = TITLES[name]||name;
  document.getElementById('topSub').textContent   = SUBS[name] ? SUBS[name]() : '';
  if (name==='calendar')  renderCalendar();
  if (name==='history')   renderHistory();
  if (name==='stats')     renderStats();
  if (name==='contracts') renderContracts();
  if (name==='badges')    renderBadges();
  if (name==='settings')  loadSettings();
  if (name==='saisie')    renderManualList();
}

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
function initApp() {
  const now = new Date();
  calY = now.getFullYear(); calM = now.getMonth();
  document.getElementById('heroDate').textContent =
    now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
       .replace(/^\w/, c => c.toUpperCase());
  document.getElementById('topSub').textContent   = SUBS.dashboard();
  document.getElementById('expFrom').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
  document.getElementById('expTo').value   = fmtDate(now);
  document.getElementById('manDate').value = fmtDate(now);
  updatePunchBtns();
  updateTimeline();
  updateDashStats();
  updateLiveCounters();
  checkBadges();
}

/* ── Boot ── */
initFirebase();
