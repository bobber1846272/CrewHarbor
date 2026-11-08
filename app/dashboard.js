/* CrewHarbor · dashboard voor de eigenaar: alles in één oogopslag */
'use strict';

async function loadDashboard() { try { S.dash = await rpc('cd_owner_dashboard'); S.dashErr = null; } catch (e) { S.dash = null; S.dashErr = e.message; } }
const dNum = n => String(Math.round(Number(n || 0) * 10) / 10).replace('.', ',');

function viewDashboard() {
  const D = S.dash;
  let h = '<header class="page-head"><div><h1>Dashboard</h1><p>' + esc(dayLong(today())) + ' · hoe staat je bedrijf ervoor?</p></div></header>';
  if (!D) return h + (S.dashErr ? '<div class="alert error"><span>' + esc(S.dashErr) + '</span></div>' : '<p class="muted">Laden…</p>');
  const T = D.today, W = D.week, M = D.team, todo = D.todo;
  const tile = (label, big, sub, to) => '<' + (to ? 'a href="#/' + to + '"' : 'div') + ' class="db-tile">' + '<span class="db-label">' + label + '</span><strong class="db-big">' + big + '</strong>' + (sub ? '<span class="db-sub">' + sub + '</span>' : '') + '</' + (to ? 'a' : 'div') + '>';
  h += '<div class="db-tiles">' +
    tile('Vandaag aan het werk', T.working, T.clockedIn ? '<span class="live-dot"></span> ' + T.clockedIn + ' nu ingeklokt' : 'Nog niemand ingeklokt', 'rooster') +
    tile('Afwezig vandaag', T.sick + T.leave, (T.sick ? T.sick + ' ziek' : 'Niemand ziek') + (T.leave ? ' · ' + T.leave + ' met verlof' : ''), 'verlof') +
    tile('Uren deze week', dNum(W.workedHours) + '<small> u</small>', 'gewerkt, van ' + dNum(W.plannedHours) + ' u ingepland', 'urenoverzicht') +
    tile('Team', M.active, M.vast + ' vast · ' + M.flex + ' flex', 'mensen') + '</div>';

  // actie nodig
  const acts = [
    [todo.hours, todo.hours === 1 ? 'urenregel wacht op goedkeuring' : 'urenregels wachten op goedkeuring', 'goedkeuren'],
    [todo.leave, todo.leave === 1 ? 'verlofaanvraag' : 'verlofaanvragen', 'verlof'],
    [todo.swaps, todo.swaps === 1 ? 'ruilverzoek' : 'ruilverzoeken', 'rooster', 'db-swaps'],
    [todo.callbacksLate, todo.callbacksLate === 1 ? 'terugbelverzoek is te laat' : 'terugbelverzoeken zijn te laat', 'terugbellen'],
    [todo.tasksLate, todo.tasksLate === 1 ? 'taak is te laat' : 'taken zijn te laat', 'taken']
  ].filter(a => a[0] > 0);
  const roster = [];
  if (!W.published) roster.push(['Het rooster van deze week is nog niet verstuurd.', W.start]);
  if (!W.nextPublished) roster.push(['Volgende week' + (W.nextPlannedHours ? ': ' + dNum(W.nextPlannedHours) + ' uur ingepland, nog niet verstuurd.' : ' is nog niet ingepland.'), addDays(W.start, 7)]);
  h += '<div class="db-cols"><section class="card db-todo"><h2>Actie nodig</h2>' +
    (acts.length || roster.length ? '<div class="db-list">' + acts.map(a => '<a class="db-row" href="#/' + a[2] + '"' + (a[3] ? ' data-act="' + a[3] + '"' : '') + '><b class="db-count">' + a[0] + '</b><span>' + a[1] + '</span><span class="db-go" aria-hidden="true">→</span></a>').join('') +
      roster.map(r => '<button class="db-row" data-act="db-week" data-v="' + r[1] + '"><b class="db-count warn">!</b><span>' + esc(r[0]) + '</span><span class="db-go" aria-hidden="true">→</span></button>').join('') + '</div>'
      : '<p class="db-ok">✓ Alles is bijgewerkt. Lekker bezig!</p>') +
    (todo.callbacksOpen && !todo.callbacksLate ? '<p class="small muted" style="margin:0">' + todo.callbacksOpen + ' terugbelverzoek' + (todo.callbacksOpen === 1 ? '' : 'en') + ' open, op tijd.</p>' : '') + '</section>' +
    '<section class="card"><h2>Verlof de komende 2 weken</h2>' + (D.upcomingLeave.length ? '<div class="mini-list">' + D.upcomingLeave.map(a => '<div class="mini-row"><span>' + esc(a.name) + '</span><span class="small muted">' + esc(dayShort(a.from)) + (a.to && a.to !== a.from ? ' – ' + esc(dayShort(a.to)) : '') + '</span></div>').join('') + '</div>' : '<p class="muted" style="margin:0">Niemand met verlof.</p>') + '</section></div>';

  // trend: ingepland en gewerkt per week
  const tr = D.trend || []; const max = Math.max(1, ...tr.map(t => Math.max(Number(t.planned), Number(t.worked))));
  h += '<section class="card db-chart"><div class="db-chart-head"><h2>Uren per week</h2><div class="db-legend"><span><i class="sw-p"></i>Ingepland</span><span><i class="sw-w"></i>Gewerkt</span></div></div>' +
    '<div class="db-bars" role="img" aria-label="' + esc('Uren per week, laatste 8 weken: ' + tr.map(t => 'week ' + weekNo(t.week) + ' ingepland ' + dNum(t.planned) + ', gewerkt ' + dNum(t.worked)).join('; ')) + '">' +
    tr.map((t, i) => '<div class="db-wk" tabindex="0"><div class="db-pair"><span class="db-bar p" style="height:' + (Number(t.planned) / max * 100) + '%"></span><span class="db-bar w" style="height:' + (Number(t.worked) / max * 100) + '%"></span></div>' +
      '<span class="db-x">wk ' + weekNo(t.week) + '</span><span class="db-tip"><b>Week ' + weekNo(t.week) + '</b>Ingepland ' + dNum(t.planned) + ' u<br>Gewerkt ' + dNum(t.worked) + ' u</span>' + (i === tr.length - 1 ? '<span class="db-val">' + dNum(t.worked) + ' u</span>' : '') + '</div>').join('') + '</div>' +
    (tr.every(t => !Number(t.planned) && !Number(t.worked)) ? '<p class="small muted" style="margin:0">Nog geen uren. Zodra er gepland en geklokt wordt, zie je het hier.</p>' : '') + '</section>';

  // abonnement
  if (D.billing) {
    const B = D.billing;
    const st = { trial: 'Proefperiode', active: 'Actief', free: 'Gratis', expired: 'Proefperiode verlopen', past_due: 'Betaling mislukt' }[B.status] || B.status;
    h += '<section class="card db-bill"><div><span class="db-label">Abonnement</span><strong>' + esc(D.plan ? D.plan.name : '—') + '</strong><span class="small muted">' + esc(st) + (B.status === 'trial' && B.trialEndsAt ? ' tot ' + esc(dayLong(String(B.trialEndsAt).slice(0, 10)).toLowerCase()) : '') + '</span></div>' +
      '<div><span class="db-label">Medewerkers</span><strong>' + B.members + (D.plan && D.plan.maxMembers ? '<small> / ' + D.plan.maxMembers + '</small>' : '') + '</strong></div>' +
      '<div><span class="db-label">Per maand</span><strong>' + (B.amountCents ? '€ ' + (B.amountCents / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2 }) : '€ 0') + '</strong><span class="small muted">excl. btw</span></div>' +
      '<a class="btn small" href="#/instellingen" data-act="go-abonnement">Abonnement</a></section>';
  }
  return h;
}

document.getElementById('app').addEventListener('click', e => {
  const el = e.target.closest('[data-act^="db-"],[data-act="go-abonnement"]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'db-week') { e.preventDefault(); S.rosterView = 'week'; S.rosterWeek = el.dataset.v; go('rooster'); }
  if (act === 'db-swaps') { S.rosterView = 'week'; S.swReview = true; }
  if (act === 'go-abonnement') S.setTab = 'abonnement';
});
