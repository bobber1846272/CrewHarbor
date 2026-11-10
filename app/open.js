/* CrewHarbor · open diensten: de planner zet een dienst open, collega's reageren ("Ik wil deze"),
   de planner kiest (of: wie het eerst reageert, krijgt hem) */
'use strict';

// ---------- laden ----------
async function loadOpenMine() { try { S.openMine = await rpc('cd_open_mine'); } catch (e) { S.openMine = null; } }
async function loadOpenPlan(R) {
  if (!R || !R.canPlan || !R.weekStart) { S.openPlan = null; return; }
  try { S.openPlan = await rpc('cd_open_shifts', { p_from: R.weekStart, p_to: addDays(R.weekStart, 6) }); } catch (e) { S.openPlan = null; }
}
const osTime = o => o.start + '–' + o.end;
const osFn = (o, R) => { const f = o.functionId && funcOf(o.functionId, R); return f ? f.name : (o.functionName || ''); };

// ---------- medewerker: open diensten waar je op kunt reageren ----------
function openMineSection(mobile) {
  const L = S.openMine; if (!L || !L.length) return '';
  const st = {
    aangemeld: ['Je hebt gereageerd', 'orange'], gekozen: ['Jij werkt deze dienst', 'green'], niet_gekozen: ['Al vergeven aan iemand anders', ''], ingetrokken: ['', '']
  };
  const rows = L.map(o => {
    const mine = o.mine && o.mine !== 'ingetrokken' ? o.mine : null;
    const fn = osFn(o, S.roster || S.homeRo || (typeof M !== 'undefined' && M.plan) || null);
    const left = Math.max(0, (o.spots || 1) - (o.filled || 0));
    const dd = pd(o.date);
    const btn = mine === 'aangemeld' ? '<button class="btn small ghost" data-act="os-no" data-id="' + o.id + '">Toch niet</button>'
      : !mine && o.status === 'open' && !o.why ? '<button class="btn small primary" data-act="os-yes" data-id="' + o.id + '">' + (o.mode === 'eerst' ? 'Ik pak hem' : 'Ik wil deze') + '</button>' : '';
    return '<div class="os-row' + (mine ? ' ' + mine : '') + '"><div class="os-date"><span>' + esc(DAYS[dd.getDay()]) + '</span><strong>' + dd.getDate() + '</strong><span>' + esc(MONTHS[dd.getMonth()]) + '</span></div>' +
      '<div class="os-main"><strong>' + esc(osTime(o)) + ' <span class="os-dur">' + fmtHM(spanMin(o.start, o.end)) + ' uur</span></strong>' +
      '<span>' + esc([fn, o.note].filter(Boolean).join(' · ')) + (fn || o.note ? ' · ' : '') + (o.status === 'open' ? (left > 1 ? left + ' plekken' : '1 plek') + (o.mode === 'eerst' ? ' · wie het eerst reageert' : '') : '') + '</span>' +
      (mine && st[mine][0] ? '<span class="badge ' + st[mine][1] + '">' + st[mine][0] + '</span>' : '') + '</div>' + btn + '</div>';
  }).join('');
  const open = L.filter(o => o.status === 'open' && !o.mine).length;
  return '<section class="' + (mobile ? 'm-card os-card' : 'card os-card') + '"><div class="os-head"><h2>Open diensten</h2>' + (open ? '<span class="badge orange">' + open + ' nieuw</span>' : '') + '</div>' +
    '<p class="small muted" style="margin:0 0 10px">Er wordt iemand gezocht. Kun jij? Reageer en je leidinggevende plant je in.</p><div class="os-list">' + rows + '</div></section>';
}

// ---------- planner: open dienst-kaart in de kalender ----------
function openCard(R, o, pos) {
  const fn = osFn(o, R); const F = o.functionId && funcOf(o.functionId, R);
  const reps = (o.replies || []).filter(r => r.status === 'aangemeld');
  const filled = o.filled || 0;
  return '<div class="pl-card shift os-open' + (pos ? ' h' : '') + (o.status === 'gevuld' ? ' done' : '') + '" style="' + pos + (F && F.color ? '--fc:' + esc(F.color) + ';' : '') + '" data-act="os-view" data-id="' + o.id + '" title="Open dienst · klik voor de reacties">' +
    '<div class="pl-card-top"><strong>' + esc(plShort(o.start) + '–' + plShort(o.end)) + '</strong><span class="os-tag">' + (o.status === 'gevuld' ? '✓ Gevuld' : 'OPEN') + '</span>' + (fn ? '<span class="pl-card-sub">' + esc(fn) + '</span>' : '') + '</div>' +
    '<div class="os-card-info">' + (o.status === 'gevuld' ? filled + '/' + o.spots + ' ingevuld'
      : reps.length ? '<b>' + reps.length + '</b> ' + (reps.length === 1 ? 'reactie' : 'reacties') + ' · ' + esc(reps.slice(0, 3).map(r => r.name.split(' ')[0]).join(', '))
      : 'Nog geen reacties' + (o.mode === 'eerst' ? ' · eerste krijgt hem' : '')) + '</div></div>';
}

// ---------- planner: pop-up met reacties ----------
function openViewModal(R) {
  const o = (S.openPlan || []).find(x => same(x.id, S.osView)); if (!o) return '';
  const fn = osFn(o, R);
  const reps = o.replies || [];
  const RS = { aangemeld: ['Wil deze werken', 'orange'], gekozen: ['Ingepland', 'green'], niet_gekozen: ['Niet gekozen', ''] };
  const row = r => {
    const p = R.people.find(x => same(x.id, r.memberId)) || { id: r.memberId, name: r.name, contractType: 'flex' };
    const wm = typeof weekMin === 'function' ? weekMin(R, p.id) : 0; const ch = typeof contractMin === 'function' ? contractMin(p) : 0;
    return '<div class="os-rep"><span class="os-rep-who">' + avatar(p.id, r.name, 'sm2') + '<span><strong>' + esc(r.name) + '</strong><small>' + esc(contractShort(p)) + ' · deze week ' + fmtHM(wm) + (ch ? ' van ' + fmtHM(ch) : '') + ' u · reageerde ' + esc(fmtDate(r.at)) + '</small></span></span>' +
      (r.status === 'aangemeld' && o.status === 'open' ? '<button class="btn small primary" data-act="os-pick" data-id="' + o.id + '" data-v="' + r.memberId + '">Inplannen</button>' : '<span class="badge ' + RS[r.status][1] + '">' + RS[r.status][0] + '</span>') + '</div>';
  };
  return '<section class="card stack" style="gap:14px;max-width:none"><div class="item-top"><div><span class="os-tag big">OPEN DIENST</span><h2 style="margin:6px 0 0">' + esc(dayLong(o.date)) + ' · ' + esc(osTime(o)) + '</h2>' +
    '<p class="small muted" style="margin:4px 0 0">' + esc([fn, o.note, (o.spots > 1 ? o.spots + ' plekken' : '1 plek'), o.mode === 'eerst' ? 'wie het eerst reageert, krijgt hem' : 'jij kiest wie', o.createdByName ? 'geplaatst door ' + o.createdByName : ''].filter(Boolean).join(' · ')) + '</p></div>' +
    '<button class="icon-btn" data-act="os-view-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    (reps.length ? '<div class="os-reps">' + reps.map(row).join('') + '</div>' : '<div class="empty">Nog niemand heeft gereageerd. Iedereen die kan, heeft een melding gekregen.</div>') +
    '<div class="row">' + (o.status === 'open' ? '<button class="btn small danger" data-act="os-cancel" data-id="' + o.id + '">Open dienst intrekken</button>' : '') +
    '<button class="btn small ghost" data-act="os-view-x" style="margin-left:auto">Sluiten</button></div></section>';
}

// ---------- planner: "zet open" vanuit de pop-up "Wie plan je in?" ----------
function openForm(R) {
  const P = S.plPick; if (!P) return '';
  const F = P.osForm;
  const fn = funcOf(P.functionId, R);
  // ruwe schatting: wie krijgt een melding?
  const n = R.people.filter(p => !same(p.id, S.me.id) && !(p.leavingOn && P.date > p.leavingOn) && (!P.functionId || hasFunc(p, P.functionId)) && !blockedAbs(R, p.id, P.date)
    && !(R.allShifts || R.shifts).some(s => same(s.memberId, p.id) && s.date === P.date && s.start < P.end && P.start < s.end)).length;
  if (!F) return '<div class="os-cta"><span><strong>Niemand beschikbaar of geen zin om te bellen?</strong> Zet de dienst open: ' + n + ' collega’s krijgen een melding en kunnen reageren.</span>' +
    '<button class="btn small" data-act="os-form">📣 Zet open voor collega’s</button></div>';
  return '<div class="os-form"><div class="item-top"><strong>📣 Open dienst plaatsen</strong><button class="icon-btn small" data-act="os-form-x" aria-label="Annuleren">' + ICON.x + '</button></div>' +
    '<p class="small" style="margin:0">' + esc(dayLong(P.date)) + ' · ' + esc(P.start + '–' + P.end) + (fn ? ' · alleen voor ' + esc(fn.name) : '') + ' · <strong>' + n + '</strong> ' + (n === 1 ? 'collega krijgt' : 'collega’s krijgen') + ' een melding.</p>' +
    '<div class="os-form-row"><div class="field"><label for="os-spots">Hoeveel mensen?</label><select class="input" id="os-spots" data-os="spots">' + [1, 2, 3, 4, 5].map(k => '<option' + (Number(F.spots) === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></div>' +
      '<fieldset class="field os-mode"><legend>Wie krijgt hem?</legend>' +
        '<label class="check"><input type="radio" name="os-mode" data-os="mode" value="kiezen"' + (F.mode !== 'eerst' ? ' checked' : '') + '> Ik kies zelf uit de reacties</label>' +
        '<label class="check"><input type="radio" name="os-mode" data-os="mode" value="eerst"' + (F.mode === 'eerst' ? ' checked' : '') + '> Wie het eerst reageert</label></fieldset></div>' +
    '<div class="field"><label for="os-note">Notitie <span class="muted" style="font-weight:400">(optioneel)</span></label><input class="input" id="os-note" data-os="note" maxlength="200" value="' + esc(F.note || '') + '" placeholder="Bijv. inval voor zieke collega"></div>' +
    '<div class="row"><button class="btn primary small" data-act="os-save">Plaatsen en collega’s laten weten</button></div></div>';
}

// ---------- klikken ----------
document.getElementById('app').addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled || !el.dataset.act.startsWith('os-')) return;
  const act = el.dataset.act, id = el.dataset.id;
  try {
    switch (act) {
      case 'os-yes': case 'os-no': {
        el.disabled = true;
        const o = await rpc('cd_open_reply', { p_id: Number(id), p_on: act === 'os-yes' });
        toast(act === 'os-no' ? 'Reactie ingetrokken.' : o.mine === 'gekozen' ? 'Je bent ingepland. Bedankt!' : 'Gereageerd! Je hoort het als je bent ingepland.');
        await loadOpenMine();
        if (typeof isMobileApp === 'function' && isMobileApp()) { await loadMobile(); }
        else if (route() === 'rooster') { await loadRoster(); }
        else if (typeof loadHomeRo === 'function') await loadHomeRo();
        render(); return;
      }
      case 'os-view': S.osView = Number(id); render(); return;
      case 'os-view-x': S.osView = null; render(); return;
      case 'os-pick': {
        el.disabled = true; await rpc('cd_open_shift_pick', { p_id: Number(id), p_member: el.dataset.v });
        toast('Ingepland. De anderen horen dat de dienst vergeven is als alle plekken vol zijn.'); await roReload(); return;
      }
      case 'os-cancel': {
        if (!confirm('Deze open dienst intrekken? Wie al reageerde krijgt een melding.')) return;
        el.disabled = true; await rpc('cd_open_shift_cancel', { p_id: Number(id) }); S.osView = null; toast('Open dienst ingetrokken.'); await roReload(); return;
      }
      case 'os-form': S.plPick.osForm = { spots: 1, mode: 'kiezen', note: '' }; render(); return;
      case 'os-form-x': S.plPick.osForm = null; render(); return;
      case 'os-save': {
        const P = S.plPick; const F = P.osForm; el.disabled = true;
        const o = await rpc('cd_open_shift_save', { p: { date: P.date, start: P.start, end: P.end, functionId: P.functionId || '', departmentId: P.departmentId || '', locationId: S.locFilter || '', spots: Number(F.spots) || 1, mode: F.mode, note: F.note || '' } });
        S.plPick = null; toast('Open dienst geplaatst. ' + o.asked + ' ' + (o.asked === 1 ? 'collega heeft' : 'collega’s hebben') + ' een melding gekregen.'); await roReload(); return;
      }
      default: return;
    }
  } catch (err) { toast(err.message, true); el.disabled = false; }
});
['input', 'change'].forEach(ev => document.getElementById('app').addEventListener(ev, e => {
  const el = e.target; if (!el.dataset.os || !S.plPick || !S.plPick.osForm) return;
  if (el.type === 'radio' && !el.checked) return;
  S.plPick.osForm[el.dataset.os] = el.value;
}));
