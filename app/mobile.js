/* CrewHarbor — app-weergave voor personeel (Android-app)
 * Zo min mogelijk tikken: Vandaag (klokcode, in-/uitklokken, volgende dienst, snel verlof of ziek),
 * Rooster (komende diensten in één lijst), Verlof, Beschikbaar en Account.
 * Beheren en plannen gebeurt op de website. Hergebruikt schermen en knoppen (data-act) van app.js.
 */
'use strict';

const M = { tab: 'code', clock: null, clockAt: 0, plan: null, mine: null, leave: null, codeForm: false };
const SITE = (window.CREWDECK_CONFIG || {}).siteUrl || '';
const isMobileApp = () => !!APP && !!S.me && route() !== 'klok';
const PLAN_DAYS = 28;

async function loadMobile() {
  if (!mTabs().some(t => t[0] === M.tab)) M.tab = 'code';
  const jobs = [loadCounts()];
  if (M.tab === 'code') {
    jobs.push(loadClockCode(), loadPlan());
    if (selfOn('selfLeave')) {
      jobs.push(rpc('cd_absences', { p_scope: 'mine' }).then(d => { M.mine = d; }).catch(() => { M.mine = null; }));
      jobs.push(rpc('cd_leave_me').then(d => { M.leave = d; }).catch(() => { M.leave = null; }));
    }
  }
  if (M.tab === 'rooster') { jobs.push(loadPlan()); if (typeof loadSwaps === 'function') jobs.push(loadSwaps()); }
  if (M.tab === 'verlof') jobs.push(loadAbsences());
  if (M.tab === 'beschikbaar') jobs.push(loadAvailability());
  await Promise.all(jobs);
}
async function loadPlan() {
  try { M.plan = await rpc('cd_roster_range', { p_from: today(), p_to: addDays(today(), PLAN_DAYS - 1) }); } catch (e) { M.plan = null; }
}
async function loadClockCode() {
  try { M.clock = await rpc('cd_clock_code'); M.clockAt = Date.now(); } catch (e) { M.clock = null; }
}
function secondsLeft() { return M.clock ? Math.max(0, M.clock.secondsLeft - Math.floor((Date.now() - M.clockAt) / 1000)) : 0; }
function nowHM() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function myShifts() { return M.plan ? M.plan.shifts.filter(s => same(s.memberId, S.me.id)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)) : []; }
function dayWord(d) { return d === today() ? 'Vandaag' : d === addDays(today(), 1) ? 'Morgen' : dayLong(d); }
function openSick(list) { return (list || []).find(a => a.kind === 'ziek' && a.status === 'goedgekeurd' && !a.to); }

function mTabs() {
  return [['code', 'Vandaag', NI.prikklok], ['rooster', 'Rooster', NI.rooster],
    selfOn('selfLeave') && ['verlof', 'Verlof', NI.verlof], selfOn('selfAvail') && ['beschikbaar', 'Beschikbaar', NI.beschikbaar],
    ['account', 'Account', NI.mensen]].filter(Boolean);
}
function viewMobile() {
  const tabs = mTabs();
  if (!tabs.some(t => t[0] === M.tab)) M.tab = 'code';
  const views = { code: mToday, rooster: mRoster, verlof: mLeave, beschikbaar: mAvail, account: mAccount };
  // onzichtbare terugknop: de terugknop van Android klikt hierop (sluit eerst een formulier, dan naar Vandaag)
  const back = S.absForm || S.swOffer || M.codeForm || M.tab !== 'code';
  return '<div class="m-app"><header class="m-top">' + LOGO(26) + '<span class="m-org">' + esc(S.org.name) + '</span></header>' +
    '<main class="m-main" id="m-main">' + (views[M.tab] || mToday)() + '</main>' +
    (back ? '<button hidden aria-hidden="true" tabindex="-1" data-mact="cb-close"></button>' : '') +
    '<nav class="m-tabs" aria-label="Menu" style="grid-template-columns:repeat(' + tabs.length + ',1fr)">' + tabs.map(t => '<button class="' + (M.tab === t[0] ? 'on' : '') + '" data-mact="tab" data-v="' + t[0] + '"' + (M.tab === t[0] ? ' aria-current="page"' : '') + '>' +
      t[2] + '<span>' + t[1] + '</span></button>').join('') + '</nav></div>';
}

// ---------- vandaag ----------
function mToday() {
  const R = S.running; const W = S.nowWeek; const kiosk = kioskOnly();
  const code = M.clock ? M.clock.code : '--------';
  const left = secondsLeft();
  const hm = nowHM();
  const shifts = myShifts();
  const todayShift = shifts.find(s => s.date === today());
  const next = shifts.find(s => s.date > today() || (s.date === today() && s.end > hm && !(R && s.start <= hm)));
  const sick = openSick(M.mine);

  // klokcode + klokken in één kaart
  let h = '<section class="m-card m-codecard"><p class="m-label">Jouw klokcode</p>' +
    '<div class="m-code" id="m-code" aria-live="polite">' + esc(code.slice(0, 4)) + ' ' + esc(code.slice(4)) + '</div>' +
    '<div class="m-timer"><span id="m-bar" style="width:' + (left / ((M.clock && M.clock.period) || 20) * 100) + '%"></span></div>' +
    '<p class="m-sub" id="m-left">Nieuwe code over ' + left + ' sec · voer in bij de prikklok</p>' +
    '<div class="m-clockrow' + (R ? ' in' : '') + '">' + (R
      ? '<span class="live-dot"></span><div><strong>Ingeklokt</strong><span>sinds ' + esc(R.start) + ' · <b id="clock-elapsed" data-date="' + esc(R.date) + '" data-start="' + esc(R.start) + '">' + fmtHM(runningSince(R)) + '</b> uur</span></div>'
      : '<div><strong>Niet ingeklokt</strong><span>' + (todayShift ? 'Vandaag ' + esc(todayShift.start + '–' + todayShift.end) : 'Vandaag vrij') + '</span></div>') +
    (kiosk ? '' : '<button class="btn ' + (R ? 'sand-out' : 'sand') + '" data-mact="clock">' + (R ? 'Uitklokken' : 'Inklokken') + '</button>') + '</div></section>';

  // ziek: één tik om beter te melden
  if (sick) h += '<section class="m-card m-sick"><div><strong>Je bent ziek gemeld</strong><span>Sinds ' + esc(dayLong(sick.from).toLowerCase()) + '. Beterschap!</span></div>' +
    '<button class="btn primary" data-mact="beter" data-id="' + sick.id + '">Ik ben beter</button></section>';

  // volgende dienst
  h += '<button class="m-card m-next" data-mact="tab" data-v="rooster"><div><p class="m-label">Volgende dienst</p>' + (next
    ? '<strong>' + esc(dayWord(next.date)) + ' · ' + esc(next.start + '–' + next.end) + '</strong>' + (next.note ? '<span>' + esc(next.note) + '</span>' : '')
    : '<strong>Niets ingepland</strong><span>De komende 4 weken heb je geen diensten.</span>') + '</div>' + ICON.right + '</button>';

  // in één oogopslag: uren en verlof
  const tiles = [];
  if (W && selfOn('selfHours')) {
    const ch = W.member.contractType === 'vast' ? Number(W.member.contractHours) * 60 : 0;
    tiles.push('<div class="m-tile"><span>Gewerkt deze week</span><strong>' + fmtHM(W.totalMin) + '</strong>' + (ch ? '<small>van ' + fmtHM(ch) + '</small>' : '<small>uur</small>') + '</div>');
  }
  const st = M.leave && M.leave.status;
  if (st && st.tracked) tiles.push('<button class="m-tile" data-mact="tab" data-v="verlof"><span>Verlof over</span><strong class="' + (st.left < 0 ? 'neg' : '') + '">' + esc(hrsTxt(st.left)) + '</strong><small>' + (st.pending ? esc(hrsTxt(st.pending)) + ' aangevraagd' : 'in ' + st.year) + '</small></button>');
  if (tiles.length) h += '<div class="m-tiles">' + tiles.join('') + '</div>';

  // snelle knoppen
  if (selfOn('selfLeave')) h += '<div class="m-quick"><button class="btn" data-mact="leave-new">Verlof aanvragen</button>' +
    (sick ? '' : '<button class="btn" data-mact="sick">Ziek melden</button>') + '</div>';
  return h;
}

// ---------- rooster: komende diensten in één lijst ----------
function mRoster() {
  const P = M.plan; if (!P) return '<div class="m-empty">Rooster laden…</div>';
  const shifts = myShifts();
  const cur = mondayOf(today());
  const weekName = wk => wk === cur ? 'Deze week' : wk === addDays(cur, 7) ? 'Volgende week' : weekLabel(wk);
  // dagen met een dienst of afwezigheid, per week
  const days = [];
  for (let d = today(); d <= addDays(today(), PLAN_DAYS - 1); d = addDays(d, 1)) {
    const list = shifts.filter(s => s.date === d);
    const ab = absFor(P.absences, S.me.id, d);
    if (!list.length && ab) {
      // aaneengesloten verlof of ziekte (in dezelfde week) samenvoegen tot één regel
      const prev = days[days.length - 1];
      if (prev && !prev.list.length && prev.ab && same(prev.ab.id, ab.id) && addDays(prev.to, 1) === d && mondayOf(prev.d) === mondayOf(d)) { prev.to = d; continue; }
    }
    if (list.length || ab) days.push({ d, to: d, list, ab });
  }
  let h = '<h1 class="m-h1">Mijn diensten</h1>';
  if (!days.length) return h + '<div class="m-empty">Je hebt de komende 4 weken geen diensten.</div>';
  let wk = null;
  days.forEach(x => {
    const w = mondayOf(x.d);
    if (w !== wk) {
      if (wk) h += '</div>';
      wk = w;
      const min = shifts.filter(s => mondayOf(s.date) === w).reduce((a, s) => a + spanMin(s.start, s.end), 0);
      h += '<div class="m-weekhead"><strong>' + esc(weekName(w)) + '</strong>' + (min ? '<span>' + fmtHM(min) + ' uur</span>' : '') + '</div><div class="m-list">';
    }
    const dd = pd(x.d);
    const date = '<div class="m-date' + (x.d === today() ? ' today' : '') + '"><span>' + esc(DAYS[dd.getDay()]) + '</span><strong>' + dd.getDate() + '</strong><span>' + esc(MONTHS[dd.getMonth()]) + '</span></div>';
    if (!x.list.length) { h += '<div class="m-shift off">' + date + '<div class="m-shift-main">' + absChip(x.ab) + '<span>' + (x.to !== x.d ? 't/m ' + esc(dayShort(x.to)) : 'hele dag') + (x.ab.status === 'aangevraagd' ? ' · nog niet goedgekeurd' : '') + '</span></div></div>'; return; }
    x.list.forEach(s => {
      h += '<div class="m-shift' + (x.d === today() ? ' today' : '') + '">' + date + '<div class="m-shift-main"><strong>' + esc(s.start + ' – ' + s.end) + '</strong>' +
        '<span>' + fmtHM(spanMin(s.start, s.end)) + ' uur' + (s.note ? ' · ' + esc(s.note) : '') + '</span>' + (x.ab ? absChip(x.ab) : '') + '</div>' +
        (typeof swapBtn === 'function' ? '<div class="m-shift-act">' + swapBtn(s) + '</div>' : '') + '</div>';
    });
  });
  h += '</div>';
  // ruilen van collega's alleen tonen als er iets te doen is
  const D = typeof SW === 'function' ? SW() : null;
  if (D && (D.open.length || D.mine.some(w => w.status === 'open' || w.status === 'aangevraagd')) && typeof swapsSection === 'function') h += swapsSection(P);
  if (S.swOffer && typeof swapOfferModal === 'function') h += modal(swapOfferModal(P), 'sw-offer-x');
  return h;
}

// ---------- verlof ----------
function mLeave() {
  const A = S.abs; if (!A) return '<div class="m-empty">Verlof laden…</div>';
  const sick = openSick(A.mine);
  let h = '<h1 class="m-h1">Verlof</h1>';
  if (sick) h += '<section class="m-card m-sick"><div><strong>Je bent ziek gemeld</strong><span>Sinds ' + esc(dayLong(sick.from).toLowerCase()) + '. Beterschap!</span></div>' +
    '<button class="btn primary" data-mact="beter" data-id="' + sick.id + '">Ik ben beter</button></section>';
  h += leaveSaldoCard();
  if (S.absForm) h += '<div class="m-form">' + absenceForm() + '</div>';
  else h += '<div class="m-quick"><button class="btn primary" data-mact="leave-new">Verlof aanvragen</button>' + (sick ? '' : '<button class="btn" data-mact="sick">Ziek melden</button>') + '</div>';
  // alleen wat nog speelt; oud verlof staat op de website
  const now = A.mine.filter(a => a.status !== 'ingetrokken' && (!a.to || a.to >= today()) && (a.status !== 'afgewezen' || a.from >= today()));
  h += '<h2 class="m-h2">Gepland en aangevraagd</h2>' + (now.length ? myAbsList(now) : '<div class="m-empty">Niets gepland.</div>');
  return h;
}

// ---------- beschikbaarheid ----------
function mAvail() {
  const v = viewAvailability();
  return v ? '<div class="m-avail">' + v + '</div>' : '<div class="m-empty">Beschikbaarheid laden…</div>';
}

// ---------- account ----------
function mAccount() {
  let h = '<h1 class="m-h1">Account</h1><section class="m-card m-me">' + avatar(S.me.id, S.me.name, 'lg') + '<div><strong>' + esc(S.me.name) + '</strong><span>' + esc(S.roleName) + ' · ' + esc(S.org.name) + '</span>' +
    '<span>' + (S.me.legacy ? 'Bedrijfscode: ' + esc(S.org.slug) : esc(S.me.email || '')) + '</span><span>' + esc(contractText(S.me)) + '</span></div></section>';
  if (S.me.legacy) h += '<section class="m-card"><p class="m-label">Koppel je e-mailadres</p><p class="small" style="margin:0">Inloggen met een code verdwijnt. Koppel op de website bij Instellingen je e-mailadres en kies een wachtwoord.</p></section>';
  const pw = !S.me.legacy;
  h += '<section class="m-card">' + (M.codeForm
    ? (pw ? '<p class="m-label">Nieuw wachtwoord (minstens 10 tekens)</p><input type="email" autocomplete="username" value="' + esc(S.me.email || '') + '" hidden><input class="input" id="m-c1" type="password" autocomplete="new-password" placeholder="Nieuw wachtwoord">' +
        '<input class="input" id="m-c2" type="password" autocomplete="new-password" placeholder="Herhaal" style="margin-top:8px">'
      : '<p class="m-label">Nieuwe code (6 tot 12 cijfers)</p><input class="input code-input" id="m-c1" type="password" inputmode="numeric" autocomplete="new-password" placeholder="Nieuwe code">' +
        '<input class="input code-input" id="m-c2" type="password" inputmode="numeric" autocomplete="new-password" placeholder="Herhaal" style="margin-top:8px">') +
      '<div class="m-actions"><button class="btn ghost" data-mact="code-cancel">Annuleren</button><button class="btn dark" data-mact="code-save">Opslaan</button></div>'
    : '<button class="m-link" data-mact="code-open">' + (pw ? 'Wachtwoord wijzigen' : 'Inlogcode wijzigen') + ICON.right + '</button>') +
    '<button class="m-link" data-mact="sound">Geluid bij meldingen<span>' + (prefs.sound ? 'aan' : 'uit') + '</span></button>' +
    (SITE ? '<a class="m-link" href="' + esc(SITE) + '" target="_blank" rel="noopener">Naar de website' + ICON.right + '</a>' : '') +
    '<button class="m-link danger" data-mact="logout">Uitloggen</button></section>';
  h += '<p class="m-site">Een product van <strong>Spark Apps</strong></p>';
  return h;
}

// ---------- knoppen ----------
async function mGo(tab) { M.tab = tab; M.codeForm = false; S.absForm = null; S.swOffer = null; S.avSel = {}; render(); window.scrollTo(0, 0); await loadMobile(); render(); }
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-mact]');
  if (!el || el.disabled || !isMobileApp()) return;
  const a = el.dataset.mact, id = el.dataset.id, num = id != null ? Number(id) : null;
  try {
    switch (a) {
      case 'tab': await mGo(el.dataset.v); return;
      case 'cb-close': // de terugknop van Android
        if (S.swOffer) S.swOffer = null;
        else if (S.absForm) S.absForm = null;
        else if (M.codeForm) M.codeForm = false;
        else if (M.tab !== 'code') { await mGo('code'); return; }
        render(); window.scrollTo(0, 0); return;
      case 'clock': {
        el.disabled = true;
        const e2 = await rpc('cd_hours_clock', { p_action: S.running ? 'out' : 'in' });
        toast(e2.status === 'open' ? 'Ingeklokt. Fijne dienst!' : 'Uitgeklokt: ' + fmtHM(e2.minutes) + ' gewerkt.'); break;
      }
      case 'leave-new':
        await mGo('verlof');
        S.absForm = { kind: 'verlof', from: '', to: '', note: '', memberId: '' }; render();
        { const f = document.getElementById('abs-from'); if (f) f.focus(); }
        return;
      case 'sick': {
        if (!confirm('Ziek melden vanaf vandaag?\nJe leidinggevende krijgt meteen een melding.')) return;
        el.disabled = true;
        await rpc('cd_absence_save', { p: { kind: 'ziek', from: today(), to: '', note: '', memberId: null, hours: null } });
        toast('Ziek gemeld. Beterschap!'); break;
      }
      case 'beter': {
        if (!confirm('Weer beter en vandaag aan het werk?')) return;
        el.disabled = true;
        await rpc('cd_absence_action', { p_id: num, p_action: 'beter', p_date: today() });
        toast('Fijn dat je weer beter bent!'); break;
      }
      case 'code-open': M.codeForm = true; render(); return;
      case 'code-cancel': M.codeForm = false; render(); return;
      case 'code-save': {
        if (!S.me.legacy) {
          const p1 = document.getElementById('m-c1').value, p2 = document.getElementById('m-c2').value;
          const pr = window.CHMFA.passwordProblem(p1, S.me.email); if (pr) { toast(pr, true); return; }
          if (p1 !== p2) { toast('De twee wachtwoorden zijn niet hetzelfde.', true); return; }
          const { error } = await sb.auth.updateUser({ password: p1 });
          if (error) throw new Error(error.message);
          M.codeForm = false; toast('Je nieuwe wachtwoord is opgeslagen.'); render(); return;
        }
        const c1 = document.getElementById('m-c1').value.trim(), c2 = document.getElementById('m-c2').value.trim();
        if (!/^\d{6,12}$/.test(c1)) { toast('Een code bestaat uit 6 tot 12 cijfers.', true); return; }
        if (c1 !== c2) { toast('De twee codes zijn niet hetzelfde.', true); return; }
        await svc('member-code', { memberId: S.me.id, code: c1 }); M.codeForm = false; toast('Je nieuwe code is opgeslagen.'); render(); return;
      }
      case 'sound': prefs.sound = !prefs.sound; savePrefs(); unlockAudio(); if (prefs.sound) beep(); render(); return;
      case 'logout': if (!confirm('Uitloggen?')) return; await sb.auth.signOut(); S.me = null; S.seen = null; location.hash = '#/login'; render(); return;
      default: return;
    }
    S.quiet = true; try { await loadMobile(); } finally { S.quiet = false; }
    render();
  } catch (err) { toast(err.message, true); if (el.isConnected) el.disabled = false; }
});

// klokcode live bijwerken
setInterval(async () => {
  if (!isMobileApp() || M.tab !== 'code') return;
  const left = secondsLeft();
  if (!M.clock || left <= 0) { await loadClockCode(); render(); return; }
  const l = document.getElementById('m-left'); if (l) l.textContent = 'Nieuwe code over ' + left + ' sec · voer in bij de prikklok';
  const b = document.getElementById('m-bar'); if (b) b.style.width = (left / ((M.clock && M.clock.period) || 20) * 100) + '%';
}, 1000);
