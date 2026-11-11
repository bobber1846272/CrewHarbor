/* CrewHarbor · rooster als weekkalender voor de roostermaker: diensten per dag op een tijdlijn,
   en een pop-up met alle mensen (vaste uren eerst) om snel in te plannen */
'use strict';

let PL_H = 50; // pixels per uur (groter in groot beeld)
const plEnd = s => { const a = toMin(s.start); const b = toMin(s.end); return b <= a ? 1440 : b; };
const plShort = t => String(t || '').replace(/:00$/, '');

// welk tijdvak laten we zien? openingstijden + diensten + vaste diensten, minimaal 09–18
function plRange(R, days) {
  let from = 9 * 60, to = 18 * 60;
  days.forEach(d => { const o = openFor(R, d); if (o) { from = Math.min(from, o.from); to = Math.max(to, Math.min(o.to, 1440)); } });
  R.shifts.forEach(s => { from = Math.min(from, toMin(s.start)); to = Math.max(to, plEnd(s)); });
  (R.templates || []).forEach(t => { from = Math.min(from, toMin(t.start)); to = Math.max(to, plEnd(t)); });
  return { from: Math.max(0, Math.floor(from / 60) * 60), to: Math.min(1440, Math.ceil(to / 60) * 60) };
}

// diensten van één dag gebundeld: zelfde tijden + functie + afdeling = één kaart met namen
function plGroups(R, d) {
  const map = new Map();
  R.shifts.filter(s => s.date === d).forEach(s => {
    const k = s.start + '|' + s.end + '|' + (s.functionId || '') + '|' + (s.departmentId || '');
    if (!map.has(k)) map.set(k, { key: k, start: s.start, end: s.end, functionId: s.functionId || '', departmentId: s.departmentId || '', shifts: [] });
    map.get(k).shifts.push(s);
  });
  // vaste diensten met een bezetting: laat zien hoeveel er nog nodig zijn, ook als er nog niemand staat
  coverage(R, d).items.forEach(it => {
    if (!it.tpl) return; const t = it.tpl;
    const g = [...map.values()].find(x => !x.tpl && x.shifts.some(s => tplMatch(R, t, s)));
    if (g) { g.tpl = t; g.need = it.need; g.have = it.have; }
    else map.set('t' + t.id, { key: 't' + t.id, start: t.start, end: t.end, functionId: t.functionId || '', departmentId: t.departmentId || '', shifts: [], tpl: t, need: it.need, have: 0 });
  });
  const list = [...map.values()].map(g => Object.assign(g, { a: toMin(g.start), b: plEnd(g) }));
  // open diensten (nog niemand gevonden) als eigen kaart
  const dpf = (S.roFilter || {}).dept;
  (S.openPlan || []).filter(o => o.date === d && o.status === 'open' && (!dpf || !o.departmentId || same(o.departmentId, dpf)))
    .forEach(o => list.push({ key: 'o' + o.id, open: o, start: o.start, end: o.end, a: toMin(o.start), b: plEnd(o), shifts: [] }));
  // naast elkaar zetten als ze overlappen
  list.sort((x, y) => x.a - y.a || y.b - x.b);
  let cluster = [], end = -1;
  const flush = () => { const lanes = []; cluster.forEach(g => { let i = lanes.findIndex(e => e <= g.a); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = g.b; g.lane = i; }); cluster.forEach(g => { g.lanes = lanes.length; }); cluster = []; };
  list.forEach(g => { if (cluster.length && g.a >= end) { flush(); end = -1; } cluster.push(g); end = Math.max(end, g.b); });
  if (cluster.length) flush();
  return list;
}

// functiekleur van een persoon: de functie van de dienst, anders de (eerste) functie van de persoon
function plFn(R, pid, fid) {
  const f = fid && funcOf(fid, R); if (f) return f;
  const p = R.people.find(x => same(x.id, pid)); if (!p) return null;
  const L = (p.functionIds || []).map(x => funcOf(x, R)).filter(Boolean);
  return L.find(x => x.color) || L[0] || null;
}
function plCard(R, g, d, top, pos) {
  if (g.open && typeof openCard === 'function') return openCard(R, g.open, pos || ('top:' + top + 'px;height:' + Math.max(34, (g.b - g.a) / 60 * PL_H - 3) + 'px;left:calc(' + (g.lane / g.lanes * 100) + '% + 3px);width:calc(' + (100 / g.lanes) + '% - 6px);'));
  const fn = funcOf(g.functionId, R), dp = deptOf(g.departmentId, R);
  const tp = g.tpl ? { i: (R.templates || []).indexOf(g.tpl) % 6, t: g.tpl } : (g.shifts[0] ? tplOf(R, g.shifts[0]) : null);
  const fc = fn && fn.color;
  const h = Math.max(34, (g.b - g.a) / 60 * PL_H - 3);
  const cov = g.need ? '<span class="pl-cov ' + (g.have >= g.need ? 'ok' : g.have ? 'half' : 'bad') + '" title="' + Math.min(g.have, g.need) + ' van ' + g.need + ' ingepland">' + Math.min(g.have, g.need) + '/' + g.need + '</span>' : '';
  const names = g.shifts.slice().sort((x, y) => x.memberName.localeCompare(y.memberName)).map(s => {
    const iss = shiftIssues(R, s);
    const pf = plFn(R, s.memberId, s.functionId);
    return '<button class="pl-name' + (iss.length ? ' warn' : '') + (pf ? ' has-fn' : '') + '"' + (pf ? ' style="--pf:' + esc(pf.color || '#475467') + '"' : '') + ' draggable="true" data-shift-drag="' + s.id + '" data-act="sh-edit" data-id="' + s.id + '" title="' + esc(s.memberName + (pf ? ' · ' + pf.name : '') + (s.note ? ' · ' + s.note : '') + (iss.length ? '\nLet op: ' + iss.join('; ') : '')) + '">' +
      (g.lanes > 2 && !pos ? '' : avatar(s.memberId, s.memberName, 'xs')) + '<span>' + esc(g.lanes > 1 || pos ? s.memberName.split(' ')[0] : s.memberName) + '</span>' + (pf && (pos || g.lanes < 3) ? '<em class="pl-name-fn">' + esc(pf.name) + '</em>' : '') + (iss.length ? '<b class="ro-warn">!</b>' : '') + '</button>';
  }).join('');
  const sub = tp || fn || dp ? (fn ? '<b class="func-tag">' + esc(fn.name) + '</b> ' : '') + esc([tp ? tp.t.name : '', dp && !(S.roFilter || {}).dept ? dp.name : ''].filter(Boolean).join(' · ')) : '';
  const spec = d + '|' + g.start + '|' + g.end + '|' + g.functionId + '|' + g.departmentId;
  const missing = g.need ? Math.max(0, g.need - g.have) : 0;
  const style = (pos || ('top:' + top + 'px;height:' + h + 'px;left:calc(' + (g.lane / g.lanes * 100) + '% + 3px);width:calc(' + (100 / g.lanes) + '% - 6px);')) + (fc ? '--fc:' + esc(fc) + ';' : '');
  return '<div class="pl-card shift' + (pos ? ' h' : '') + (fc ? ' has-fc' : tp ? ' t' + tp.i : '') + (!g.shifts.length ? ' empty' : '') + (missing ? ' short' : '') + '" style="' + style + '" data-act="pl-pick" data-v="' + esc(spec) + '">' +
    '<div class="pl-card-top"><strong>' + esc(plShort(g.start) + '–' + plShort(g.end)) + '</strong>' + cov + (pos && sub ? '<span class="pl-card-sub">' + sub + '</span>' : '') + '</div>' +
    (!pos && sub ? '<div class="pl-card-sub">' + sub + '</div>' : '') +
    '<div class="pl-names">' + names + '</div>' +
    '<button class="pl-add" data-act="pl-pick" data-v="' + esc(spec) + '">' + (g.lanes > 2 && !pos ? '+' + (missing ? ' ' + missing : '') : '+ ' + (missing ? 'nog ' + missing + ' nodig' : 'Inplannen')) + '</button></div>';
}

// "eerst inplannen": vaste mensen die nog uren over hebben
function plFirstBar(R) {
  const list = R.people
    .filter(p => contractMin(p) && !(p.leavingOn && p.leavingOn < R.weekStart))
    .map(p => ({ p, left: contractMin(p) - weekMin(R, p.id) })).filter(x => x.left > 0).sort((a, b) => b.left - a.left);
  if (!list.length) return R.people.some(p => contractMin(p)) ? '<div class="pl-first ok"><span>✓ Iedereen met vaste uren heeft deze week zijn contracturen.</span></div>' : '';
  const tot = list.reduce((a, x) => a + x.left, 0);
  return '<div class="pl-first"><span class="pl-first-lab"><strong>Eerst inplannen</strong> · vaste uren nog ' + fmtHM(tot) + ' u <span class="pl-first-hint">· sleep een naam naar het rooster</span></span>' +
    list.slice(0, 12).map(x => { const pf = plFn(R, x.p.id); return '<button class="pl-first-chip' + (pf ? ' has-fn' : '') + '"' + (pf ? ' style="--pf:' + esc(pf.color || '#475467') + '"' : '') + ' draggable="true" data-person-drag="' + x.p.id + '" data-act="pl-person" data-id="' + x.p.id + '" title="' + esc((pf ? pf.name + ' · ' : '') + 'Sleep naar een dag of dienst om in te plannen, of klik') + '">' + avatar(x.p.id, x.p.name, 'xs') + esc(x.p.name.split(' ')[0]) + (pf ? '<em class="pl-name-fn">' + esc(pf.name) + '</em>' : '') + ' <b>' + fmtHM(x.left) + '</b></button>'; }).join('') +
    (list.length > 12 ? '<span class="small muted">+' + (list.length - 12) + '</span>' : '') + '</div>';
}

// ---------- uitleg: alles over het rooster op één plek ----------
function roHelp() {
  const sec = (ic, t, items) => '<div class="rh-sec"><h3><span>' + ic + '</span>' + t + '</h3><ul>' + items.map(i => '<li>' + i + '</li>').join('') + '</ul></div>';
  return '<section class="card stack ro-help" style="gap:16px;max-width:none"><div class="item-top"><div><h2 style="margin:0">Uitleg rooster</h2><p class="small muted" style="margin:4px 0 0">Alles wat je kunt doen, op één plek.</p></div><button class="icon-btn" data-act="pl-help-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<div class="rh-grid">' +
    sec('👀', 'Weergaven', ['<strong>Week</strong>: de week per dag, met de diensten op een tijdlijn. Kies rechtsboven <strong>Verticaal</strong> of <strong>Horizontaal</strong>.', '<strong>Per persoon</strong>: elke medewerker een rij, handig om uren per persoon te zien.', '<strong>Dag</strong>: één dag als tijdlijn. Klik op een dag in de kop om er snel heen te gaan.', '<strong>Groot beeld</strong>: het rooster over het hele scherm. Terug met <strong>Esc</strong>.']) +
    sec('➕', 'Inplannen', ['Klik in een <strong>lege plek</strong> van een dag, op <strong>+</strong> of op een blok. Je krijgt alle mensen te zien.', 'Bovenaan staan de mensen met <strong>vaste uren die nog uren over hebben</strong>, daarna flex die kan, daarna de rest.', 'Filter op <strong>Vaste uren</strong> of <strong>Flex</strong>, of zoek op naam.', 'Klik op een naam en hij staat erin. De pop-up blijft open, zodat je meer mensen kunt toevoegen.', 'De strook <strong>Eerst inplannen</strong> laat zien wie nog vaste uren over heeft deze week. Sleep een naam naar een dag of dienst.']) +
    sec('📣', 'Open diensten', ['Niemand gevonden? Klik in de pop-up op <strong>Zet open voor collega’s</strong>.', 'Iedereen die kan (juiste functie, geen verlof, werkt dan nog niet) krijgt een melding.', 'Kies <strong>Ik kies zelf</strong>: je ziet de reacties en plant met één klik in. Of <strong>Wie het eerst reageert</strong>: die staat er meteen in.', 'Een open dienst staat <span class="os-tag">OPEN</span> gestreept in het rooster. Klik erop voor de reacties of om hem in te trekken.']) +
    sec('✋', 'Slepen', ['Sleep een <strong>vaste dienst</strong> naar een dag: de pop-up opent al ingevuld.', 'Sleep een <strong>naam</strong> naar een andere dag om de dienst te verplaatsen.', 'Houd <strong>Ctrl</strong> ingedrukt tijdens het slepen om te kopiëren.', 'Klik op een naam om de dienst te wijzigen of te verwijderen.']) +
    sec('🎨', 'Kleuren en tekens', ['<span class="pl-cov ok">2/2</span> <span class="pl-cov half">1/2</span> <span class="pl-cov bad">0/2</span> hoeveel mensen er staan van het aantal dat nodig is.', '<span class="rh-sw dash"></span> Stippellijn: hier is nog niemand ingepland, maar er is wel iemand nodig.', '<span class="rh-sw closed"></span> Gearceerd: je bent dan dicht (Openingstijden).', '<span class="rh-sw gap"></span> Rode streep: tijdens openingstijden werkt er (te) weinig mensen.', '<span class="ro-warn">!</span> Let op: bijvoorbeeld dubbel ingepland, boven contracturen, heeft aangegeven niet te kunnen, of tegen de Arbeidstijdenwet (te lange dienst, te weinig rust, te veel uren per week; strenger voor jongeren onder 18).', '🎉 Feestdag: telt niet als werkdag (in te stellen bij Instellingen → Uren).', 'De kleur van een blok komt van de <strong>functie</strong> of de <strong>vaste dienst</strong>.']) +
    sec('⚙️', 'Instellen', ['<strong>Vaste diensten</strong>: diensten die vaak terugkomen, met tijden, functie en afdeling.', '<strong>Openingstijden</strong>: dan zie je gaten in het rooster.', '<strong>Bezetting per dienst</strong>: hoeveel mensen je per dienst nodig hebt, ook per functie.', '<strong>Afdelingen &amp; functies</strong>: met de afdelingsknoppen laat je alleen die afdeling zien.']) +
    sec('📤', 'Klaar en versturen', ['Een nieuwe week is een <strong>Concept</strong>: alleen planners zien hem.', 'Klik op <strong>Versturen</strong>: iedereen met een dienst krijgt een melding.', '<strong>Concept verwijderen</strong> haalt alle diensten van die week weg.', '<strong>Voorstel maken</strong> vult open plekken automatisch; jij vinkt aan wat je wilt.', 'Via <strong>Meer</strong>: vorige week kopiëren of een standaardweek gebruiken.']) +
    sec('⌨️', 'Sneltoetsen', ['<strong>Ctrl+Z</strong>: ongedaan maken. <strong>Ctrl+Shift+Z</strong>: opnieuw.', '<strong>Esc</strong>: pop-up sluiten of groot beeld uit.']) +
    '</div></section>';
}

// ---------- groot beeld: alleen het rooster, over het hele scherm ----------
function roBigBtn() { return '<button class="btn small ro-big-btn' + (S.roBig ? ' on' : '') + '" data-act="pl-big" aria-pressed="' + !!S.roBig + '" title="' + (S.roBig ? 'Terug naar normaal (Esc)' : 'Rooster op groot beeld') + '">' + (S.roBig ? '✕ Klein beeld' : '⛶ Groot beeld') + '</button>'; }
function roBigSet(on) {
  S.roBig = !!on;
  const fs = document.fullscreenElement;
  if (on && !fs && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { /* lukt niet overal, dan alleen de schermvullende weergave */ });
  if (!on && fs && document.exitFullscreen) document.exitFullscreen().catch(() => { /* */ });
  render(); window.scrollTo(0, 0);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.roBig) { S.roBig = false; render(); } else if (S.roBig) render(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.roBig && !document.querySelector('.modal-wrap') && !document.fullscreenElement) { S.roBig = false; render(); } });
window.addEventListener('resize', () => { if (S.roBig && route() === 'rooster') { clearTimeout(S.roBigT); S.roBigT = setTimeout(render, 150); } });
function plDir() { if (!S.plDir) { try { S.plDir = localStorage.getItem('ch-pl-dir') || 'v'; } catch (e) { S.plDir = 'v'; } } return S.plDir; }
function plDirSwitch() {
  const d = plDir();
  return '<div class="seg small pl-dir" role="group" aria-label="Richting">' + [['v', '↕ Verticaal'], ['h', '↔ Horizontaal']].map(o => '<button class="' + (d === o[0] ? 'on' : '') + '" aria-pressed="' + (d === o[0]) + '" data-act="pl-dir" data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
}
function plDayHead(R, d) {
  const l = R.shifts.filter(s => s.date === d); const n = new Set(l.map(s => String(s.memberId))).size;
  const c = coverage(R, d), o = openFor(R, d), G = gaps(R, d);
  const off = R.people.filter(p => blockedAbs(R, p.id, d));
  let st = '';
  if (!o && Object.keys(R.opening || {}).length) st = '<span class="ro-gap closed">Dicht</span>';
  else if (G.length) st = '<span class="ro-gap" title="' + esc('Nog niemand (genoeg) ingepland: ' + G.map(gapTxt).join(', ')) + '">Gat ' + esc(gapTxt(G[0])) + (G.length > 1 ? ' +' + (G.length - 1) : '') + '</span>';
  else if (c.need) st = '<span class="ro-gap ' + (c.have >= c.need ? 'ok' : '') + '">' + (c.have >= c.need ? '✓ ' : '') + c.have + '/' + c.need + ' bezet</span>';
  else if (o) st = '<span class="ro-gap ok">✓ ' + hhmm(o.from) + '–' + hhmm(o.to) + '</span>';
  return '<div class="pl-dh' + (d === today() ? ' today' : '') + (d < today() ? ' past' : '') + '"><button class="pl-dh-top" data-act="rx-day" data-v="' + d + '" title="Dagweergave"><span>' + esc(dayShort(d).split(' ')[0]) + '</span><b>' + pd(d).getDate() + '</b></button>' +
    (typeof holidayTag === 'function' ? holidayTag(R, d) : '') +
    '<div class="pl-dh-info"><span>' + n + (n === 1 ? ' persoon' : ' mensen') + ' · ' + fmtHM(l.reduce((a, s) => a + shiftMin(s), 0)) + ' u</span>' + st +
    (off.length ? '<span class="pl-off" title="' + esc('Verlof of ziek: ' + off.map(p => p.name).join(', ')) + '">' + off.length + ' vrij/ziek</span>' : '') + '</div>' +
    '<button class="pl-dh-add" data-act="pl-new" data-v="' + d + '" aria-label="Dienst inplannen op ' + esc(dayShort(d)) + '">+</button></div>';
}
function rosterCal(R) {
  const tail = (S.plPick ? modal(plPopup(R), 'pl-x') : '') + (S.osView && typeof openViewModal === 'function' ? modal(openViewModal(R), 'os-view-x') : '');
  return plFirstBar(R) + (plDir() === 'h' ? rosterCalH(R) : rosterCalV(R)) + tail;
}
// horizontaal: elke dag een rij, de uren van links naar rechts
const PL_LANE = 62;
function rosterCalH(R) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(R.weekStart, i));
  const rg = plRange(R, days); const span = rg.to - rg.from;
  const x = m => ((Math.max(rg.from, Math.min(rg.to, m)) - rg.from) / span * 100).toFixed(3) + '%';
  const w = (a, b) => ((Math.min(b, rg.to) - Math.max(a, rg.from)) / span * 100).toFixed(3) + '%';
  const hours = []; for (let m = rg.from; m <= rg.to; m += 60) hours.push(m);
  const nowM = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  let h = '<div class="pl-scroll"><div class="plh"><div class="plh-head"><div class="plh-corner"></div><div class="plh-hours">' + hours.map((m, i) => '<span style="left:' + x(m) + '"' + (i === hours.length - 1 ? ' class="last"' : i === 0 ? ' class="first"' : '') + '>' + String(m / 60).padStart(2, '0') + ':00</span>').join('') + '</div></div>';
  h += days.map(d => {
    const G = plGroups(R, d);
    // per dag onder elkaar stapelen als diensten overlappen
    const lane = []; G.slice().sort((p, q) => p.a - q.a || q.b - p.b).forEach(g => { let i = lane.findIndex(e => e <= g.a); if (i < 0) { i = lane.length; lane.push(0); } lane[i] = g.b; g.row = i; });
    const rows = Math.max(1, lane.length);
    const o = openFor(R, d);
    const shade = o ? '<span class="pl-closed" style="top:0;bottom:0;left:0;width:' + x(o.from) + '"></span><span class="pl-closed" style="top:0;bottom:0;left:' + x(o.to) + ';right:0"></span>' + gaps(R, d).map(g => '<span class="pl-gap h" style="left:' + x(g.from) + ';width:' + w(g.from, g.to) + '" title="Nog niet gevuld ' + gapTxt(g) + '"></span>').join('')
      : (Object.keys(R.opening || {}).length ? '<span class="pl-closed" style="top:0;bottom:0;left:0;right:0"></span>' : '');
    return '<div class="plh-row' + (d === today() ? ' today' : '') + '">' + plDayHead(R, d) +
      '<div class="pl-col plh-track" data-act="pl-hclick" data-pl-day="' + d + '" data-from="' + rg.from + '" data-span="' + span + '" style="height:' + (rows * PL_LANE + 8) + 'px">' +
        hours.map(m => '<i class="pl-line v" style="left:' + x(m) + '"></i>').join('') + shade +
        (d === today() && nowM > rg.from && nowM < rg.to ? '<span class="pl-now v" style="left:' + x(nowM) + '"></span>' : '') +
        G.map(g => plCard(R, g, d, 0, 'left:calc(' + x(g.a) + ' + 2px);width:calc(' + w(g.a, g.b) + ' - 4px);top:' + (g.row * PL_LANE + 5) + 'px;height:' + (PL_LANE - 6) + 'px;')).join('') +
      '</div></div>';
  }).join('');
  return h + '</div></div>';
}
function rosterCalV(R) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(R.weekStart, i));
  const rg = plRange(R, days); const span = rg.to - rg.from;
  // groot beeld: de dag vult de hoogte van het scherm
  PL_H = S.roBig ? Math.max(50, Math.floor((window.innerHeight - 330) / (span / 60))) : 50;
  const H = span / 60 * PL_H;
  const y = m => (Math.max(rg.from, Math.min(rg.to, m)) - rg.from) / 60 * PL_H;
  const hours = []; for (let m = rg.from; m <= rg.to; m += 60) hours.push(m);
  const nowM = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const head = d => plDayHead(R, d);
  let h = '<div class="pl-scroll"><div class="pl"><div class="pl-head"><div class="pl-corner"></div>' + days.map(head).join('') + '</div>' +
    '<div class="pl-body" style="height:' + H + 'px"><div class="pl-axis">' + hours.map(m => '<span style="top:' + y(m) + 'px">' + String(m / 60).padStart(2, '0') + ':00</span>').join('') + '</div>' +
    days.map(d => {
      const o = openFor(R, d);
      const shade = o ? '<span class="pl-closed" style="top:0;height:' + y(o.from) + 'px"></span><span class="pl-closed" style="top:' + y(o.to) + 'px;bottom:0"></span>' + gaps(R, d).map(g => '<span class="pl-gap" style="top:' + y(g.from) + 'px;height:' + (y(g.to) - y(g.from)) + 'px" title="Nog niet gevuld ' + gapTxt(g) + '"></span>').join('')
        : (Object.keys(R.opening || {}).length ? '<span class="pl-closed" style="top:0;bottom:0"></span>' : '');
      return '<div class="pl-col' + (d === today() ? ' today' : '') + '" data-act="pl-col" data-pl-day="' + d + '" data-from="' + rg.from + '" data-ph="' + PL_H + '">' +
        hours.map(m => '<i class="pl-line" style="top:' + y(m) + 'px"></i>').join('') + shade +
        (d === today() && nowM > rg.from && nowM < rg.to ? '<span class="pl-now" style="top:' + y(nowM) + 'px"></span>' : '') +
        plGroups(R, d).map(g => plCard(R, g, d, y(g.a) + 1)).join('') + '</div>';
    }).join('') + '</div></div></div>';
  return h;
}

// ---------- pop-up: wie plan je in? ----------
function plStatus(R, p, P) {
  const d = P.date;
  if (p.leavingOn && d > p.leavingOn) return { cat: 'nee', why: 'Uit dienst' };
  const ab = absFor(R.absences, p.id, d);
  if (ab && ab.status === 'goedgekeurd') return { cat: 'nee', why: ab.kind === 'ziek' ? 'Ziek' : ab.kindLabel };
  const has = (R.allShifts || R.shifts).filter(s => same(s.memberId, p.id) && s.date === d);
  const av = availOf(R, p.id, d);
  const left = contractMin(p) ? contractMin(p) - weekMin(R, p.id) : null;
  const why = [];
  if (has.length) return { cat: 'al', why: 'Staat al ingepland ' + has.map(s => s.start + '–' + s.end).join(', '), left, av };
  if (P.functionId && !hasFunc(p, P.functionId)) { const f = funcOf(P.functionId, R); return { cat: 'liever', why: 'Heeft de functie ' + (f ? f.name : '') + ' niet', left, av }; }
  if (av && av.status === 'kan_niet') return { cat: 'liever', why: 'Kan niet' + (av.note ? ' (' + av.note + ')' : ''), left, av };
  if (av && av.status === 'kan' && av.start && (P.start < av.start || P.end > av.end)) return { cat: 'liever', why: 'Kan alleen ' + av.start + '–' + av.end, left, av };
  if (typeof atwIssues === 'function' && P.start && P.end) { const at = atwIssues(R, p.id, d, P.start, P.end); if (at.length) return { cat: 'liever', why: at[0].charAt(0).toUpperCase() + at[0].slice(1), left, av }; }
  if (ab && ab.status === 'aangevraagd') why.push('verlof aangevraagd');
  if (left != null && left <= 0) return { cat: 'vol', why: 'Contracturen zijn vol', left, av };
  if (left != null) return { cat: 'eerst', why: why.join(' · '), left, av };
  return { cat: av && av.status === 'kan' ? 'kan' : 'leeg', why: why.join(' · '), left, av };
}
// hoe vaak staat iemand deze week al ingepland, en op welke dagen?
function plWeekTag(R, pid, d) {
  const L = (R.allShifts || R.shifts).filter(s => same(s.memberId, pid)).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  if (!L.length) return '<span class="pl-wk none">Nog niet ingepland</span>';
  const days = [...new Set(L.map(s => s.date))];
  const tip = L.map(s => dayShort(s.date) + ' ' + s.start + '–' + s.end).join('\n');
  return '<span class="pl-wk" title="' + esc('Deze week ingepland:\n' + tip) + '"><b>' + L.length + '×</b> ingepland<small>' + days.map(x => '<i class="' + (x === d ? 'here' : '') + '">' + esc(dayShort(x).split(' ')[0]) + '</i>').join('') + '</small></span>';
}
function plPopup(R) {
  const P = S.plPick;
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(R.weekStart, i));
  const T = R.templates || [];
  const fn = funcOf(P.functionId, R), dp = deptOf(P.departmentId, R);
  const q = (P.q || '').trim().toLowerCase();
  const ct = P.ct || 'alle';
  const ff = P.fn || '';
  const people = R.people.filter(p => (!q || p.name.toLowerCase().includes(q)) && (ct === 'alle' || (ct === 'vast' ? p.contractType === 'vast' : p.contractType !== 'vast')) && (!ff || (ff === '-' ? !(p.functionIds || []).length : hasFunc(p, ff))))
    .filter(p => !(S.roFilter || {}).dept || !R.people.some(x => (x.departmentIds || []).length) || (p.departmentIds || []).some(x => same(x, S.roFilter.dept)) || !(p.departmentIds || []).length);
  const rows = people.map(p => Object.assign({ p }, plStatus(R, p, P)));
  const sorted = (cat, fn2) => rows.filter(r => r.cat === cat).sort(fn2 || ((a, b) => a.p.name.localeCompare(b.p.name)));
  const gross = spanMin(P.start, P.end), brk = breakAuto(gross, false), dur = Math.max(0, gross - brk);
  const groups = [
    ['eerst', 'Eerst inplannen · vaste uren over', 'Hebben een vast contract en nog uren over deze week.', sorted('eerst', (a, b) => ((b.av && b.av.status === 'kan') - (a.av && a.av.status === 'kan')) || b.left - a.left)],
    ['kan', 'Flex · heeft aangegeven te kunnen', '', sorted('kan', (a, b) => weekMin(R, a.p.id) - weekMin(R, b.p.id))],
    ['leeg', 'Flex · nog niet ingevuld', '', sorted('leeg', (a, b) => weekMin(R, a.p.id) - weekMin(R, b.p.id))],
    ['vol', 'Vaste uren al vol', 'Inplannen kan, maar dan gaan ze boven hun contract.', sorted('vol')],
    ['al', 'Werkt al op deze dag', '', sorted('al')],
    ['liever', 'Liever niet', '', sorted('liever')],
    ['nee', 'Kan niet (verlof, ziek of uit dienst)', '', sorted('nee')]
  ];
  const row = r => {
    const p = r.p; const wm = weekMin(R, p.id), ch = contractMin(p);
    const avTag = r.av && r.cat !== 'liever' ? '<span class="pl-av ' + r.av.status + '">' + (r.av.status === 'kan' ? 'Kan' + (r.av.start ? ' ' + esc(r.av.start + '–' + r.av.end) : '') : 'Kan niet') + '</span>' : '';
    const fns = (p.functionIds || []).map(f => funcOf(f, R)).filter(Boolean);
    const fnTags = fns.map(f => '<span class="pl-fn' + (P.functionId && same(f.id, P.functionId) ? ' match' : '') + '" style="--fc:' + esc(f.color || '#475467') + '">' + esc(f.name) + '</span>').join('') +
      (p.departmentIds || []).map(x => deptOf(x, R)).filter(Boolean).map(dp => '<span class="pl-dp" style="--c:' + esc(dp.color || '#7FC4CF') + '"><i></i>' + esc(dp.name) + '</span>').join('');
    const hasUnits = UNITS(R).functions.length;
    const over = ch && wm + dur > ch;
    return '<button class="pl-row ' + r.cat + '" ' + (r.cat === 'nee' ? 'disabled' : 'data-act="pl-add" data-id="' + p.id + '"') + '>' + avatar(p.id, p.name, 'sm2') +
      '<span class="pl-row-main"><strong>' + esc(p.name) + '</strong><small>' + esc([contractShort(p), p.roleName || ''].filter(Boolean).join(' · ')) + (r.why ? ' · ' + esc(r.why) : '') + '</small>' +
        (fnTags || hasUnits ? '<span class="pl-row-fn">' + (fnTags || '<span class="pl-fn none">Geen functie</span>') + '</span>' : '') + '</span>' +
      plWeekTag(R, p.id, P.date) + avTag +
      '<span class="pl-row-hrs">' + (ch ? '<b>' + (r.left > 0 ? 'nog ' + fmtHM(r.left) : fmtHM(wm) + ' / ' + fmtHM(ch)) + '</b><span class="ro-bar' + (wm > ch ? ' over' : '') + '"><span style="width:' + Math.min(100, wm / ch * 100) + '%"></span></span>' : '<b>' + fmtHM(wm) + ' u</b><small>deze week</small>') + '</span>' +
      (r.cat === 'nee' ? '' : '<span class="pl-row-btn' + (over ? ' over' : '') + '">' + (over ? 'Toch inplannen' : 'Inplannen') + '</span>') + '</button>';
  };
  const vastLeft = R.people.filter(p => contractMin(p)).reduce((a, p) => a + Math.max(0, contractMin(p) - weekMin(R, p.id)), 0);
  const cnt = k => k === 'alle' ? R.people.length : R.people.filter(p => (p.contractType === 'vast') === (k === 'vast')).length;
  return '<section class="card stack pl-pop" style="gap:14px;max-width:none">' +
    '<div class="item-top"><div><h2 style="margin:0">Wie plan je in?</h2><p class="small muted" style="margin:4px 0 0">' + esc(dayLong(P.date)) + ' · ' + esc(P.start + '–' + P.end) + ' (' + fmtHM(dur) + ' u' + (brk ? ', ' + brk + ' min pauze' : '') + ')' + (fn ? ' · ' + esc(fn.name) : '') + (dp ? ' · ' + esc(dp.name) : '') + '</p></div><button class="icon-btn" data-act="pl-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<div class="pl-pick">' +
      '<div class="pl-days" role="group" aria-label="Dag">' + days.map(d => '<button class="' + (d === P.date ? 'on' : '') + '" data-act="pl-day" data-v="' + d + '" aria-pressed="' + (d === P.date) + '"' + (typeof holidayOn === 'function' && holidayOn(R, d) ? ' title="' + esc(holidayOn(R, d)) + '"' : '') + '>' + esc(dayShort(d).split(' ')[0]) + '<b>' + pd(d).getDate() + '</b>' + (typeof holidayOn === 'function' && holidayOn(R, d) ? '<i class="hol-dot">🎉</i>' : '') + '</button>').join('') + '</div>' +
      '<div class="pl-shifts">' + T.map((t, i) => { const on = t.start === P.start && t.end === P.end && same(t.functionId || '', P.functionId || '') && same(t.departmentId || '', P.departmentId || ''); const f = funcOf(t.functionId, R);
        return '<button class="shift ' + (f && f.color ? 'has-fc' : 't' + (i % 6)) + (on ? ' on' : '') + '"' + (f && f.color ? ' style="--fc:' + esc(f.color) + '"' : '') + ' data-act="pl-tpl" data-id="' + t.id + '" aria-pressed="' + on + '">' + esc(t.name) + '<small>' + esc(t.start + '–' + t.end) + (f ? ' · ' + esc(f.name) : '') + '</small></button>'; }).join('') +
        '<span class="pl-times"><label class="sr-only" for="pl-s">Begin</label><input class="input" type="time" id="pl-s" data-pl="start" value="' + esc(P.start) + '"><span>–</span><label class="sr-only" for="pl-e">Eind</label><input class="input" type="time" id="pl-e" data-pl="end" value="' + esc(P.end) + '"></span></div>' +
    '</div>' +
    (typeof openForm === 'function' ? openForm(R) : '') +
    '<div class="pl-filter"><div class="seg small" role="group" aria-label="Contract">' + [['alle', 'Iedereen'], ['vast', 'Vaste uren'], ['flex', 'Flex']].map(o => '<button class="' + (ct === o[0] ? 'on' : '') + '" aria-pressed="' + (ct === o[0]) + '" data-act="pl-ct" data-v="' + o[0] + '">' + o[1] + ' <span class="muted">' + cnt(o[0]) + '</span></button>').join('') + '</div>' +
      (UNITS(R).functions.length ? '<label class="sr-only" for="pl-fn">Functie</label><select class="input pl-fnsel" id="pl-fn" data-plfn="1"><option value="">Alle functies</option>' + UNITS(R).functions.map(f => '<option value="' + f.id + '"' + (same(ff, f.id) ? ' selected' : '') + '>' + esc(f.name) + ' (' + R.people.filter(p => hasFunc(p, f.id)).length + ')</option>').join('') + '<option value="-"' + (ff === '-' ? ' selected' : '') + '>Zonder functie</option></select>' : '') +
      '<input class="input" id="pl-q" data-pl="q" placeholder="Zoek op naam" value="' + esc(P.q || '') + '" aria-label="Zoek op naam" autocomplete="off">' +
      (vastLeft ? '<span class="small muted">Vaste uren nog te verdelen deze week: <strong>' + fmtHM(vastLeft) + ' u</strong></span>' : '') + '</div>' +
    '<div class="pl-list">' + (groups.filter(g => g[3].length).map(g => '<div class="pl-grp ' + g[0] + '"><div class="pl-grp-h"><strong>' + esc(g[1]) + '</strong><span class="muted"> · ' + g[3].length + '</span>' + (g[2] ? '<small>' + esc(g[2]) + '</small>' : '') + '</div>' + g[3].map(row).join('') + '</div>').join('') || '<div class="empty">Niemand gevonden.</div>') + '</div>' +
    '</section>';
}

function plOpen(over) {
  const R = S.roster; const T = R.templates || [];
  const t = T[0];
  S.plPick = Object.assign({ date: mondayOf(today()) === R.weekStart ? today() : R.weekStart, start: t ? t.start : '09:00', end: t ? t.end : '17:00', functionId: t ? t.functionId || '' : '', departmentId: t ? t.departmentId || (S.roFilter || {}).dept || '' : (S.roFilter || {}).dept || '', ct: 'alle', q: '' }, over || {});
  render(); setTimeout(() => { const f = document.getElementById('pl-q'); if (f && !('ontouchstart' in window)) f.focus(); }, 30);
}

// ---------- klikken ----------
document.getElementById('app').addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled || !el.dataset.act.startsWith('pl-')) return;
  const act = el.dataset.act, v = el.dataset.v, id = el.dataset.id; const R = S.roster; if (!R) return;
  try {
    switch (act) {
      case 'pl-x': S.plPick = null; render(); return;
      case 'pl-pick': { const [d, a, b, f, dp] = v.split('|'); plOpen({ date: d, start: a, end: b, functionId: f || '', departmentId: dp || '' }); return; }
      case 'pl-new': plOpen({ date: v }); return;
      case 'pl-person': { const p = R.people.find(x => same(x.id, id)); plOpen({ q: p ? p.name : '', ct: 'alle' }); return; }
      case 'pl-col': {
        const r = el.getBoundingClientRect(); const m = Number(el.dataset.from) + Math.floor((e.clientY - r.top) / Number(el.dataset.ph || PL_H)) * 60;
        const T = R.templates || [];
        const t = T.find(x => toMin(x.start) <= m && plEnd(x) > m);
        if (t) plOpen({ date: el.dataset.plDay, start: t.start, end: t.end, functionId: t.functionId || '', departmentId: t.departmentId || (S.roFilter || {}).dept || '' });
        else plOpen({ date: el.dataset.plDay, start: hhmm(m), end: hhmm(Math.min(m + 4 * 60, 1439)), functionId: '', departmentId: (S.roFilter || {}).dept || '' });
        return;
      }
      case 'pl-hclick': {
        const r = el.getBoundingClientRect(); const m = Number(el.dataset.from) + Math.floor((e.clientX - r.left) / r.width * Number(el.dataset.span) / 60) * 60;
        const T = R.templates || [];
        const t = T.find(x => toMin(x.start) <= m && plEnd(x) > m);
        if (t) plOpen({ date: el.dataset.plDay, start: t.start, end: t.end, functionId: t.functionId || '', departmentId: t.departmentId || (S.roFilter || {}).dept || '' });
        else plOpen({ date: el.dataset.plDay, start: hhmm(m), end: hhmm(Math.min(m + 4 * 60, 1439)), functionId: '', departmentId: (S.roFilter || {}).dept || '' });
        return;
      }
      case 'pl-help': { const dd = el.closest('details'); if (dd) dd.open = false; S.roHelp = true; render(); return; }
      case 'pl-help-x': S.roHelp = false; render(); return;
      case 'pl-big': roBigSet(!S.roBig); return;
      case 'pl-dir': S.plDir = v; try { localStorage.setItem('ch-pl-dir', v); } catch (err) { /* */ } render(); return;
      case 'pl-day': S.plPick.date = v; render(); return;
      case 'pl-ct': S.plPick.ct = v; render(); return;
      case 'pl-tpl': { const t = (R.templates || []).find(x => same(x.id, id)); Object.assign(S.plPick, { start: t.start, end: t.end, functionId: t.functionId || '', departmentId: t.departmentId || (S.roFilter || {}).dept || '' }); render(); return; }
      case 'pl-add': {
        S.plTimeDirty = false;
        const P = S.plPick; if (!P || !P.start || !P.end) return;
        el.disabled = true;
        const sp = { memberId: id, date: P.date, start: P.start, end: P.end, note: '', locationId: S.locFilter || memberLoc(id), departmentId: P.departmentId || '', functionId: P.functionId || '' };
        const s = await roCreate(sp);
        roDone(opCreate([sp], 'Dienst ingepland', [s.id]), s.memberName.split(' ')[0] + ' ingepland ' + dayShort(P.date) + ' ' + P.start + '–' + P.end);
        const sc = document.querySelector('.pl-list'); const top = sc ? sc.scrollTop : 0;
        await roReload();
        const sc2 = document.querySelector('.pl-list'); if (sc2) sc2.scrollTop = top;
        return;
      }
      default: return;
    }
  } catch (err) { toast(err.message, true); el.disabled = false; }
});
document.getElementById('app').addEventListener('input', e => {
  const el = e.target; if (!el.dataset.pl || !S.plPick) return;
  const k = el.dataset.pl;
  if (k === 'q') { S.plPick.q = el.value; clearTimeout(S.plqT); S.plqT = setTimeout(() => renderKeepFocus(), 200); return; }
});
document.getElementById('app').addEventListener('change', e => { const el = e.target; if (el.dataset.plfn && S.plPick) { S.plPick.fn = el.value; render(); } });
// tijden: tijdens het typen niets opnieuw tekenen (anders springt de cursor weg); pas bij verlaten van het veld
function plTimeSub() {
  const P = S.plPick; const el = document.querySelector('.pl-pop .item-top p'); if (!P || !el || !P.start || !P.end) return;
  const R = S.roster; const fn = funcOf(P.functionId, R), dp = deptOf(P.departmentId, R);
  const g = spanMin(P.start, P.end), b = breakAuto(g, false);
  el.textContent = dayLong(P.date) + ' · ' + P.start + '–' + P.end + ' (' + fmtHM(g - b) + ' u' + (b ? ', ' + b + ' min pauze' : '') + ')' + (fn ? ' · ' + fn.name : '') + (dp ? ' · ' + dp.name : '');
}
['change', 'input'].forEach(ev => document.getElementById('app').addEventListener(ev, e => {
  const el = e.target; if (!el.dataset.pl || el.dataset.pl === 'q' || !S.plPick || !el.value) return;
  if (S.plPick[el.dataset.pl] !== el.value) { S.plPick[el.dataset.pl] = el.value; S.plTimeDirty = true; plTimeSub(); }
}));
document.getElementById('app').addEventListener('focusout', e => {
  const el = e.target; if (!el.dataset || (el.dataset.pl !== 'start' && el.dataset.pl !== 'end') || !S.plPick) return;
  // naar het andere tijdveld? dan nog niet tekenen
  // naar een knop in de pop-up? die tekent zelf opnieuw (zo gaat de klik niet verloren)
  const to = e.relatedTarget; if (to && to.closest && to.closest('.pl-pop')) return;
  if (S.plTimeDirty) { S.plTimeDirty = false; setTimeout(() => { if (S.plPick) render(); }, 0); }
});
document.addEventListener('keydown', e => {
  const el = e.target; if (e.key === 'Enter' && el.dataset && (el.dataset.pl === 'start' || el.dataset.pl === 'end')) { e.preventDefault(); el.blur(); }
}, true);

// ---------- slepen in de kalender: naar een andere dag, of een persoon uit "Eerst inplannen" ----------
document.getElementById('app').addEventListener('dragstart', e => {
  const c = e.target.closest && e.target.closest('[data-person-drag]'); if (!c) return;
  roDrag = { type: 'person', id: c.dataset.personDrag };
  e.dataTransfer.effectAllowed = 'copy';
  try { e.dataTransfer.setData('text/plain', 'person:' + c.dataset.personDrag); } catch (err) { /* */ }
  c.classList.add('dragging'); document.body.classList.add('ro-dragging');
});
// welke tijd hoort bij de plek waar je loslaat?
function plDropMin(col, e) {
  const r = col.getBoundingClientRect(); const from = Number(col.dataset.from);
  if (col.dataset.span) return from + Math.floor((e.clientX - r.left) / r.width * Number(col.dataset.span) / 60) * 60;
  return from + Math.floor((e.clientY - r.top) / Number(col.dataset.ph || PL_H)) * 60;
}
async function plDropPerson(pid, col, e) {
  const R = S.roster; const d = col.dataset.plDay;
  const p = R.people.find(x => same(x.id, pid)); if (!p) return;
  let spec = null;
  const card = e.target.closest('.pl-card');
  if (card) { const [, a, b, f, dp] = card.dataset.v.split('|'); spec = { start: a, end: b, functionId: f || '', departmentId: dp || '' }; }
  else {
    const m = plDropMin(col, e);
    const t = (R.templates || []).find(x => toMin(x.start) <= m && plEnd(x) > m && (!x.functionId || hasFunc(p, x.functionId)));
    if (t) spec = { start: t.start, end: t.end, functionId: t.functionId || '', departmentId: t.departmentId || (S.roFilter || {}).dept || '' };
  }
  // geen dienst op die plek: kies zelf de tijden in de pop-up
  if (!spec) { plOpen({ date: d, q: p.name, start: hhmm(plDropMin(col, e)), end: hhmm(Math.min(plDropMin(col, e) + 4 * 60, 1439)), functionId: '', departmentId: (S.roFilter || {}).dept || '' }); return; }
  const off = blockedAbs(R, p.id, d);
  if (off) { toast(p.name.split(' ')[0] + ' is ' + (off.kind === 'ziek' ? 'ziek' : 'met ' + off.kindLabel.toLowerCase()) + ' op ' + dayShort(d) + '.', true); return; }
  const sp = Object.assign({ memberId: p.id, date: d, note: '', locationId: S.locFilter || memberLoc(p.id) }, spec);
  const s = await roCreate(sp);
  roDone(opCreate([sp], 'Dienst ingepland', [s.id]), p.name.split(' ')[0] + ' ingepland ' + dayShort(d) + ' ' + spec.start + '–' + spec.end);
  await roReload();
}
document.getElementById('app').addEventListener('dragover', e => {
  if (typeof roDrag === 'undefined' || !roDrag) return; const c = e.target.closest('.pl-col'); if (!c) return;
  e.preventDefault(); e.dataTransfer.dropEffect = roDrag.type === 'tpl' || roDrag.type === 'person' || e.ctrlKey || e.altKey || e.metaKey ? 'copy' : 'move';
  document.querySelectorAll('.pl-col.drop-over').forEach(x => { if (x !== c) x.classList.remove('drop-over'); }); c.classList.add('drop-over');
  const card = roDrag.type === 'person' ? e.target.closest('.pl-card') : null;
  document.querySelectorAll('.pl-card.drop-over').forEach(x => { if (x !== card) x.classList.remove('drop-over'); }); if (card) card.classList.add('drop-over');
});
document.getElementById('app').addEventListener('drop', async e => {
  if (typeof roDrag === 'undefined' || !roDrag) return; const c = e.target.closest('.pl-col'); if (!c) return;
  e.preventDefault(); c.classList.remove('drop-over');
  const D = roDrag; roDrag = null; document.body.classList.remove('ro-dragging');
  const d = c.dataset.plDay; const R = S.roster;
  try {
    if (D.type === 'person') { await plDropPerson(D.id, c, e); return; }
    if (D.type === 'tpl') {
      const t = R.templates.find(x => same(x.id, D.id));
      plOpen({ date: d, start: t.start, end: t.end, functionId: t.functionId || '', departmentId: t.departmentId || (S.roFilter || {}).dept || '' });
      return;
    }
    const s = R.shifts.find(x => same(x.id, D.id)); if (!s) return;
    const copy = e.ctrlKey || e.altKey || e.metaKey;
    if (!copy && s.date === d) return;
    if (copy) {
      const sp = specOf(s, { date: d }); const n = await roCreate(sp);
      roDone(opCreate([sp], 'Dienst gekopieerd', [n.id]), n.memberName.split(' ')[0] + ' gekopieerd naar ' + dayShort(d));
    } else {
      const old = { memberId: s.memberId, date: s.date, start: s.start, end: s.end, note: s.note || '', departmentId: s.departmentId || '', functionId: s.functionId || '' };
      const nw = Object.assign({}, old, { date: d });
      const n = await rpc('cd_shift_save', { p_id: s.id, p: nw });
      roDone(opMove(s.id, old, nw), n.memberName.split(' ')[0] + ' verplaatst naar ' + dayShort(d));
    }
    await roReload();
  } catch (err) { toast(err.message, true); }
});
document.getElementById('app').addEventListener('dragend', () => { document.querySelectorAll('.pl-first-chip.dragging').forEach(c => c.classList.remove('dragging')); document.querySelectorAll('.pl-card.drop-over').forEach(c => c.classList.remove('drop-over')); document.querySelectorAll('.pl-col.drop-over').forEach(c => c.classList.remove('drop-over')); });
