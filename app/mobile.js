/* CrewHarbor — eenvoudige app-weergave (Android-app)
 * Alleen: klokcode, taken, terugbellen, uren in het kort en je account. Al het andere gaat via de website.
 * Gebruikt de gedeelde staat en hulpjes uit app.js.
 */
'use strict';

const M = { tab: 'code', clock: null, clockAt: 0, next: null, cbOpen: null, taskOpen: null, busy: false, codeForm: false };
const SITE = (window.CREWDECK_CONFIG || {}).siteUrl || '';
const isMobileApp = () => !!APP && !!S.me && route() !== 'klok';

async function loadMobile() {
  const jobs = [loadCounts()];
  if (M.tab === 'code') jobs.push(loadClockCode());
  if (M.tab === 'uren') jobs.push(rpc('cd_hours_week', { p_member: null, p_week: addDays(mondayOf(today()), 7) }).then(d => { M.next = d; }));
  await Promise.all(jobs);
}
async function loadClockCode() {
  try { M.clock = await rpc('cd_clock_code'); M.clockAt = Date.now(); } catch (e) { M.clock = null; }
}
function secondsLeft() { return M.clock ? Math.max(0, M.clock.secondsLeft - Math.floor((Date.now() - M.clockAt) / 1000)) : 0; }

const MTABS = [['code', 'Klokcode', NI.prikklok], ['taken', 'Taken', NI.taken], ['bellen', 'Bellen', NI.terugbellen], ['uren', 'Uren', NI.uren], ['account', 'Account', NI.mensen]];
function viewMobile() {
  const openTasks = S.myTasks.filter(t => !t.done && !t.mineDone && !t.archived).length;
  const badges = { taken: openTasks, bellen: S.counts.mine };
  const views = { code: mCode, taken: mTasks, bellen: mCalls, uren: mHours, account: mAccount };
  return '<div class="m-app"><header class="m-top">' + LOGO(26) + '<span class="m-org">' + esc(S.org.name) + '</span></header>' +
    '<main class="m-main" id="m-main">' + (views[M.tab] || mCode)() + '</main>' +
    '<nav class="m-tabs" aria-label="Menu">' + MTABS.map(t => '<button class="' + (M.tab === t[0] ? 'on' : '') + '" data-mact="tab" data-v="' + t[0] + '"' + (M.tab === t[0] ? ' aria-current="page"' : '') + '>' +
      t[2] + '<span>' + t[1] + '</span>' + (badges[t[0]] ? '<i>' + badges[t[0]] + '</i>' : '') + '</button>').join('') + '</nav></div>';
}

// ---------- klokcode ----------
function mCode() {
  const R = S.running; const W = S.nowWeek;
  const todayShift = W ? W.shifts.find(s => s.date === W.today) : null;
  const code = M.clock ? M.clock.code : '--------';
  const left = secondsLeft();
  let h = '<section class="m-card m-codecard"><p class="m-label">Jouw klokcode</p>' +
    '<div class="m-code" id="m-code" aria-live="polite">' + esc(code.slice(0, 4)) + ' ' + esc(code.slice(4)) + '</div>' +
    '<div class="m-timer"><span id="m-bar" style="width:' + (left / ((M.clock && M.clock.period) || 20) * 100) + '%"></span></div>' +
    '<p class="m-sub" id="m-left">Nieuwe code over ' + left + ' sec</p>' +
    '<p class="m-help">Tik bij de prikklok op je naam en voer deze code in.</p></section>';
  h += '<section class="m-card m-status ' + (R ? 'in' : '') + '">' + (R
    ? '<span class="live-dot"></span><div><strong>Ingeklokt sinds ' + esc(R.start) + '</strong><span id="clock-elapsed" data-date="' + esc(R.date) + '" data-start="' + esc(R.start) + '">' + fmtHM(runningSince(R)) + '</span></div>'
    : '<div><strong>Niet ingeklokt</strong><span>' + (todayShift ? 'Vandaag ingepland ' + esc(todayShift.start + '–' + todayShift.end) : 'Vandaag niet ingepland') + '</span></div>') +
    (kioskOnly() ? '' : '<button class="btn small ' + (R ? 'dark' : 'primary') + '" data-mact="clock">' + (R ? 'Uitklokken' : 'Inklokken') + '</button>') + '</section>';
  return h;
}

// ---------- taken ----------
function mTasks() {
  const open = S.myTasks.filter(t => !t.done && !t.mineDone && !t.archived);
  const done = S.myTasks.filter(t => (t.done || t.mineDone) && !t.archived);
  let h = '<h1 class="m-h1">Mijn taken</h1>';
  if (!open.length) h += '<div class="m-empty">Niets meer te doen. Lekker bezig!</div>';
  h += open.map(t => mTask(t, false)).join('');
  if (done.length) h += '<h2 class="m-h2">Afgevinkt</h2>' + done.slice(0, 10).map(t => mTask(t, true)).join('');
  return h;
}
function mTask(t, done) {
  const open = same(M.taskOpen, t.id);
  return '<div class="m-item' + (done ? ' done' : '') + '"><button class="m-check' + (done ? ' on' : '') + '" data-mact="task-toggle" data-id="' + t.id + '" aria-label="' + (done ? 'Weer open zetten' : 'Afvinken') + ': ' + esc(t.title) + '">' + (done ? '✓' : '') + '</button>' +
    '<button class="m-item-body" data-mact="task-open" data-id="' + t.id + '"><strong>' + esc(t.title) + '</strong>' +
    '<span>' + (t.dueAt ? dueBadge(t.dueAt, 'taak') : '') + (t.assignees.length > 1 ? ' <span class="small muted">met ' + t.assignees.filter(a => !same(a.id, S.me.id)).map(a => esc(a.name.split(' ')[0])).join(', ') + '</span>' : '') + '</span>' +
    (open && t.desc ? '<p>' + esc(t.desc) + '</p>' : '') + (open ? '<small>Van ' + esc(t.createdByName || '') + '</small>' : '') + '</button></div>';
}

// ---------- terugbellen ----------
function mCalls() {
  if (M.cbOpen) {
    const c = S.myCbs.concat(S.poolCbs).find(x => same(x.id, M.cbOpen));
    if (c) return mCall(c);
    M.cbOpen = null;
  }
  let h = '<h1 class="m-h1">Terugbellen</h1>';
  h += S.myCbs.length ? S.myCbs.map(c => '<button class="m-item m-cb" data-mact="cb-open" data-id="' + c.id + '"><div class="m-item-body"><strong>' + esc(cbTitle(c)) + '</strong>' +
    '<span>' + dueBadge(c.dueAt, 'bel') + (c.attempts.length ? ' <span class="small muted">' + c.attempts.length + 'x geprobeerd</span>' : '') + '</span></div>' + ICON.right + '</button>').join('')
    : '<div class="m-empty">Geen open verzoeken voor jou.</div>';
  if (S.poolCbs.length) {
    h += '<h2 class="m-h2">Open pool</h2>' + S.poolCbs.map(c => '<div class="m-item m-cb"><button class="m-item-body" data-mact="cb-open" data-id="' + c.id + '"><strong>' + esc(cbTitle(c)) + '</strong><span>' + dueBadge(c.dueAt, 'bel') + '</span></button>' +
      '<button class="btn small" data-mact="cb-claim" data-id="' + c.id + '">Oppakken</button></div>').join('');
  }
  return h;
}
function mCall(c) {
  const mine = same(c.assignee, S.me.id);
  const tel = String(c.phone || '').replace(/[^\d+]/g, '');
  return '<button class="m-back" data-mact="cb-close">' + ICON.left + 'Terug</button>' +
    '<section class="m-card"><h1 class="m-h1" style="margin:0">' + esc(cbTitle(c)) + '</h1>' +
    (c.type === 'zakelijk' && c.contact ? '<p class="m-sub">' + esc(c.contact) + '</p>' : '') +
    '<div style="margin:10px 0">' + dueBadge(c.dueAt, 'bel') + (c.priority === 'hoog' ? ' <span class="badge red">Hoge prioriteit</span>' : '') + '</div>' +
    (tel ? '<a class="btn primary m-call" href="tel:' + esc(tel) + '">' + NI.terugbellen + 'Bel ' + esc(c.phone) + '</a>' : '') +
    '<dl class="m-dl">' + (c.order ? '<dt>Order</dt><dd>' + esc(c.order) + '</dd>' : '') + '<dt>Categorie</dt><dd>' + esc(c.category) + '</dd>' +
      (c.email ? '<dt>E-mail</dt><dd>' + esc(c.email) + '</dd>' : '') + (c.note ? '<dt>Notitie</dt><dd>' + esc(c.note) + '</dd>' : '') + '</dl>' +
    (c.attempts.length ? '<div class="m-attempts">' + c.attempts.map(a => '<div><time>' + esc(fmtDate(a.at)) + '</time> ' + esc(a.text) + '</div>').join('') + '</div>' : '') + '</section>' +
    (mine ? '<section class="m-card"><label class="m-label" for="m-note">Notitie bij het gesprek</label><input class="input" id="m-note" placeholder="Bijv. voicemail ingesproken" autocomplete="off">' +
      '<div class="chips" style="margin-top:8px">' + (settings().quick_notes || []).slice(0, 4).map(n => '<button class="chip quick" data-mact="cb-quick" data-v="' + esc(n) + '">' + esc(n) + '</button>').join('') + '</div>' +
      '<div class="m-actions"><button class="btn" data-mact="cb-attempt" data-id="' + c.id + '">Niet bereikt</button><button class="btn green" data-mact="cb-done" data-id="' + c.id + '">Afgerond</button></div></section>'
      : '<section class="m-card"><button class="btn primary" style="width:100%" data-mact="cb-claim" data-id="' + c.id + '">Oppakken</button></section>');
}

// ---------- uren ----------
function mHours() {
  const W = S.nowWeek; if (!W) return '';
  const ct = W.member.contractType, ch = Number(W.member.contractHours) * 60;
  let h = '<h1 class="m-h1">Uren</h1><section class="m-card"><p class="m-label">Deze week · ' + weekLabel(W.weekStart) + '</p>' +
    '<div class="m-big">' + fmtHM(W.totalMin) + '<small>' + (ct === 'vast' && ch ? ' van ' + fmtHM(ch) : ct === 'flex' ? ' · flex' : '') + '</small></div>' +
    (ct === 'vast' && ch ? '<div class="progress" style="margin:8px 0 0"><span style="width:' + Math.min(100, W.totalMin / ch * 100) + '%"></span></div>' : '') + '</section>';
  h += '<section class="m-card"><div class="m-days">' + [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDays(W.weekStart, i);
    const es = W.entries.filter(e => e.date === d); const ss = W.shifts.filter(s => s.date === d);
    const ab = (W.absences || []).find(a => absCovers(a, d));
    const tot = es.reduce((a, e) => a + (e.minutes || 0), 0);
    if (!es.length && !ss.length && !ab) return '';
    const st = es.find(e => e.status === 'afgekeurd') ? 'afgekeurd' : es.find(e => e.status === 'concept' || e.status === 'open') ? 'concept' : es.find(e => e.status === 'ingediend') ? 'ingediend' : es.length ? 'goedgekeurd' : '';
    return '<div class="m-day' + (d === W.today ? ' today' : '') + '"><span class="m-dname">' + esc(dayShort(d)) + '</span>' +
      '<span class="m-dplan">' + (ab ? absChip(ab) : '') + (ss.length ? esc(ss.map(s => s.start + '–' + s.end).join(', ')) : '') + '</span>' +
      '<span class="m-dtot">' + (tot ? fmtHM(tot) : es.some(e => e.status === 'open') ? 'bezig' : '–') + '</span>' + (st ? hBadge(st) : '<span></span>') + '</div>';
  }).join('') + '</div>' + (W.entries.length || W.shifts.length ? '' : '<p class="m-sub" style="margin:0">Nog niets deze week.</p>') + '</section>';
  if (M.next && M.next.shifts.length) {
    h += '<section class="m-card"><p class="m-label">Volgende week</p>' + M.next.shifts.map(s => '<div class="m-row"><span>' + esc(dayShort(s.date)) + '</span><strong>' + esc(s.start + '–' + s.end) + '</strong>' + (s.note ? '<span class="small muted">' + esc(s.note) + '</span>' : '') + '</div>').join('') + '</section>';
  }
  h += '<p class="m-site">Uren aanpassen of indienen, verlof aanvragen en het hele rooster: ' + (SITE ? '<a href="' + esc(SITE) + '" target="_blank" rel="noopener">open de website</a>' : 'via de website van CrewHarbor') + '.</p>';
  return h;
}

// ---------- account ----------
function mAccount() {
  let h = '<h1 class="m-h1">Account</h1><section class="m-card m-me">' + avatar(S.me.id, S.me.name, 'lg') + '<div><strong>' + esc(S.me.name) + '</strong><span>' + esc(S.roleName) + ' · ' + esc(S.org.name) + '</span>' +
    '<span>' + (S.me.legacy ? 'Bedrijfscode: ' + esc(S.org.slug) : esc(S.me.email || '')) + '</span></div></section>';
  if (S.me.legacy) h += '<section class="m-card"><p class="m-label">Koppel je e-mailadres</p><p class="small" style="margin:0">Inloggen met een code verdwijnt. Koppel op de website bij Instellingen je e-mailadres en kies een wachtwoord.</p></section>';
  h += '<section class="m-card"><p class="m-label">Contract</p><strong>' + esc(contractText(S.me)) + '</strong></section>';
  const pw = !S.me.legacy;
  h += '<section class="m-card">' + (M.codeForm
    ? (pw ? '<p class="m-label">Nieuw wachtwoord (minstens 10 tekens)</p><input type="email" autocomplete="username" value="' + esc(S.me.email || '') + '" hidden><input class="input" id="m-c1" type="password" autocomplete="new-password" placeholder="Nieuw wachtwoord">' +
        '<input class="input" id="m-c2" type="password" autocomplete="new-password" placeholder="Herhaal" style="margin-top:8px">'
      : '<p class="m-label">Nieuwe code (6 tot 12 cijfers)</p><input class="input code-input" id="m-c1" type="password" inputmode="numeric" autocomplete="new-password" placeholder="Nieuwe code">' +
        '<input class="input code-input" id="m-c2" type="password" inputmode="numeric" autocomplete="new-password" placeholder="Herhaal" style="margin-top:8px">') +
      '<div class="m-actions"><button class="btn ghost" data-mact="code-cancel">Annuleren</button><button class="btn dark" data-mact="code-save">Opslaan</button></div>'
    : '<button class="m-link" data-mact="code-open">' + (pw ? 'Wachtwoord wijzigen' : 'Inlogcode wijzigen') + ICON.right + '</button>') +
    '<button class="m-link" data-mact="sound">Geluid bij nieuw werk<span>' + (prefs.sound ? 'aan' : 'uit') + '</span></button>' +
    (SITE ? '<a class="m-link" href="' + esc(SITE) + '" target="_blank" rel="noopener">Naar de website' + ICON.right + '</a>' : '') +
    '<button class="m-link danger" data-mact="logout">Uitloggen</button></section>';
  h += '<p class="m-site">Een product van <strong>Spark Apps</strong></p>';
  return h;
}

// ---------- knoppen ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-mact]');
  if (!el || el.disabled || !isMobileApp()) return;
  const a = el.dataset.mact, id = el.dataset.id, num = id != null ? Number(id) : null;
  try {
    switch (a) {
      case 'tab': M.tab = el.dataset.v; M.cbOpen = null; M.taskOpen = null; M.codeForm = false; render(); window.scrollTo(0, 0); await loadMobile(); render(); return;
      case 'clock': {
        const e2 = await rpc('cd_hours_clock', { p_action: S.running ? 'out' : 'in' });
        toast(e2.status === 'open' ? 'Ingeklokt. Fijne dienst!' : 'Uitgeklokt: ' + fmtHM(e2.minutes) + ' gewerkt.'); break;
      }
      case 'task-toggle': await rpc('cd_task_action', { p_id: num, p_action: 'toggle' }); break;
      case 'task-open': M.taskOpen = same(M.taskOpen, num) ? null : num; render(); return;
      case 'cb-open': M.cbOpen = num; render(); window.scrollTo(0, 0); return;
      case 'cb-close': M.cbOpen = null; render(); return;
      case 'cb-quick': { const inp = document.getElementById('m-note'); inp.value = inp.value.trim() ? inp.value.trim() + ' · ' + el.dataset.v : el.dataset.v; return; }
      case 'cb-claim': await rpc('cd_callback_action', { p_id: num, p_action: 'claim' }); toast('Opgepakt.'); M.cbOpen = num; break;
      case 'cb-attempt': {
        const note = (document.getElementById('m-note') || {}).value || '';
        await rpc('cd_callback_action', { p_id: num, p_action: 'attempt', p_text: note ? 'Niet bereikt · ' + note : 'Niet bereikt' }); toast('Belpoging genoteerd.'); break;
      }
      case 'cb-done': await rpc('cd_callback_action', { p_id: num, p_action: 'done', p_text: (document.getElementById('m-note') || {}).value || '' }); toast('Afgerond. Goed gedaan!'); M.cbOpen = null; break;
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
  } catch (err) { toast(err.message, true); }
});

// klokcode live bijwerken
setInterval(async () => {
  if (!isMobileApp() || M.tab !== 'code') return;
  const left = secondsLeft();
  if (!M.clock || left <= 0) { await loadClockCode(); render(); return; }
  const l = document.getElementById('m-left'); if (l) l.textContent = 'Nieuwe code over ' + left + ' sec';
  const b = document.getElementById('m-bar'); if (b) b.style.width = (left / ((M.clock && M.clock.period) || 20) * 100) + '%';
}, 1000);
