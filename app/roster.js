/* CrewHarbor · rooster voor planners: slepen, snel inplannen, bezetting, open plekken, voorstel, standaardweek, dagweergave, ongedaan maken */
'use strict';

// ---------- hulpjes ----------
const isoDow = d => pd(d).getDay() || 7;
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
const shiftMin = s => spanMin(s.start, s.end);
function needsFor(R, d) { return (R.needs || {})[String(isoDow(d))] || {}; }
function coverage(R, d) {
  const N = needsFor(R, d); const dayShifts = R.shifts.filter(s => s.date === d);
  let need = 0, have = 0; const items = [];
  Object.keys(N).forEach(k => {
    const n = Number(N[k]) || 0; if (!n) return;
    let h;
    if (k === 'dag') h = new Set(dayShifts.map(s => String(s.memberId))).size;
    else { const t = (R.templates || []).find(x => String(x.id) === k); if (!t) return; h = dayShifts.filter(s => tplMatch(R, t, s)).length; }
    need += n; have += Math.min(h, n);
    items.push({ key: k, tpl: k === 'dag' ? null : (R.templates || []).find(x => String(x.id) === k), need: n, have: h });
  });
  return { need, have, items };
}
// telt een dienst mee voor deze vaste dienst? Zelfde tijden, zelfde afdeling (als ingesteld) en zelfde functie.
// Een vaste dienst zonder functie telt diensten zonder functie, of met een functie waarvoor geen eigen vaste dienst op die tijden is.
function tplMatch(R, t, s) {
  if (s.start !== t.start || s.end !== t.end) return false;
  if (t.departmentId && !same(s.departmentId, t.departmentId)) return false;
  if (t.functionId) return same(s.functionId, t.functionId);
  return !s.functionId || !(R.templates || []).some(o => o !== t && o.functionId && o.start === t.start && o.end === t.end && same(o.functionId, s.functionId) && (!o.departmentId || same(o.departmentId, s.departmentId)));
}
function tplTags(R, t) {
  const f = t.functionId && funcOf(t.functionId, R), dp = t.departmentId && deptOf(t.departmentId, R);
  return (dp ? '<span class="nd-tag dept" style="--dept:' + esc(dp.color || '#7FC4CF') + '">' + esc(dp.name) + '</span>' : '') + (f ? '<span class="nd-tag func">' + esc(f.name) + '</span>' : '');
}
// openingstijden en gaten
const hhmm = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function openFor(R, d) {
  const o = (R.opening || {})[String(isoDow(d))];
  if (!o || !o.open) return null;
  const f = toMin(o.from); let t = toMin(o.to); if (t <= f) t += 1440;
  return { from: f, to: t, min: Number(o.min) || 1 };
}
function gaps(R, d) {
  const o = openFor(R, d); if (!o) return [];
  const list = R.shifts.filter(s => s.date === d).map(s => { const a = toMin(s.start); let b = toMin(s.end); if (b <= a) b += 1440; return [a, b]; });
  const out = [];
  for (let m = o.from; m < o.to; m += 15) {
    const n = list.filter(([a, b]) => a < m + 15 && b > m).length;
    if (n < o.min) { const last = out[out.length - 1]; if (last && last.to === m && last.have === n) last.to = m + 15; else out.push({ from: m, to: m + 15, have: n, need: o.min }); }
  }
  return out;
}
const gapTxt = g => hhmm(g.from) + '–' + hhmm(g.to);
function weekMin(R, pid, exceptId) { return (R.allShifts || R.shifts).filter(s => same(s.memberId, pid) && !same(s.id, exceptId)).reduce((a, s) => a + shiftMin(s), 0); }
function contractMin(p) { return p && p.contractType === 'vast' ? Number(p.contractHours) * 60 : 0; }
function availOf(R, pid, d) { return (R.availability || []).find(a => same(a.memberId, pid) && a.date === d); }
function shiftIssues(R, s) {
  const out = [];
  const p = R.people.find(x => same(x.id, s.memberId));
  const other = R.shifts.filter(x => same(x.memberId, s.memberId) && x.date === s.date && !same(x.id, s.id));
  if (other.some(o => toMin(o.start) < toMin(s.end) && toMin(s.start) < toMin(o.end))) out.push('Dubbel ingepland: overlapt met een andere dienst');
  const av = availOf(R, s.memberId, s.date);
  if (av && av.status === 'kan_niet') out.push('Heeft aangegeven niet te kunnen');
  else if (av && av.status === 'kan' && av.start && (s.start < av.start || s.end > av.end)) out.push('Kan alleen ' + av.start + '–' + av.end);
  const ab = absFor(R.absences, s.memberId, s.date);
  if (ab && ab.status === 'aangevraagd') out.push('Heeft verlof aangevraagd');
  if (s.functionId && p && !hasFunc(p, s.functionId)) { const f = funcOf(s.functionId, R); out.push('Heeft de functie ' + (f ? f.name : '') + ' niet'); }
  const ch = contractMin(p);
  if (ch && weekMin(R, s.memberId) > ch) out.push('Boven contracturen deze week (' + fmtHM(weekMin(R, s.memberId)) + ' van ' + fmtHM(ch) + ')');
  return out;
}
async function roReload() { S.quiet = true; try { await loadRoster(); } finally { S.quiet = false; } render(); }
// ---------- ongedaan maken (Ctrl+Z) en opnieuw (Ctrl+Shift+Z) ----------
const RO_UNDO = [], RO_REDO = [];
function roPush(op) { RO_UNDO.push(op); if (RO_UNDO.length > 50) RO_UNDO.shift(); RO_REDO.length = 0; }
const specOf = (x, over) => Object.assign({ memberId: x.memberId, date: x.date, start: x.start, end: x.end, note: x.note || '', locationId: x.locationId || '', departmentId: x.departmentId || '', functionId: x.functionId || '' }, over || {});
async function roCreate(spec) {
  const s = await rpc('cd_shift_save', { p_id: null, p: { memberId: spec.memberId, date: spec.date, start: spec.start, end: spec.end, note: spec.note || '', departmentId: spec.departmentId || '', functionId: spec.functionId || '' } });
  if (spec.locationId && LOCS().length) { try { await rpc('cd_shift_location', { p_id: s.id, p_location: spec.locationId }); } catch (e) { /* */ } }
  return s;
}
function opCreate(specs, label, ids) {
  const st = { ids: ids.slice(), specs: specs.map(x => specOf(x)) };
  return { label, undo: async () => { for (const id of st.ids) { try { await rpc('cd_shift_delete', { p_id: id }); } catch (e) { /* */ } } },
    redo: async () => { st.ids = []; for (const sp of st.specs) { try { st.ids.push((await roCreate(sp)).id); } catch (e) { /* */ } } } };
}
function opDelete(shift) {
  const st = { id: shift.id, spec: specOf(shift) };
  return { label: 'Dienst verwijderd', undo: async () => { st.id = (await roCreate(st.spec)).id; }, redo: async () => { await rpc('cd_shift_delete', { p_id: st.id }); } };
}
function opMove(id, from, to) {
  return { label: 'Dienst verplaatst', undo: async () => { await rpc('cd_shift_save', { p_id: id, p: from }); }, redo: async () => { await rpc('cd_shift_save', { p_id: id, p: to }); } };
}
let roBusy = false;
document.addEventListener('keydown', async e => {
  if (!(e.ctrlKey || e.metaKey) || route() !== 'rooster' || !S.roster || !S.roster.canPlan) return;
  const k = e.key.toLowerCase(); if (k !== 'z' && k !== 'y') return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  e.preventDefault(); if (roBusy) return;
  const redo = k === 'y' || e.shiftKey; const from = redo ? RO_REDO : RO_UNDO, to = redo ? RO_UNDO : RO_REDO;
  const op = from.pop(); if (!op) { toast(redo ? 'Niets om opnieuw te doen.' : 'Niets om ongedaan te maken.'); return; }
  roBusy = true;
  try { await (redo ? op.redo() : op.undo()); to.push(op); toast((redo ? 'Opnieuw: ' : 'Ongedaan: ') + op.label.toLowerCase() + '.'); await roReload(); }
  catch (err) { toast(err.message, true); } finally { roBusy = false; }
});
function roDone(op, msg) { roPush(op); toast(msg + ' · Ctrl+Z = terug'); }
function tplSpec(t, pid, d) { return { memberId: pid, date: d, start: t.start, end: t.end, note: t.note || '', locationId: S.locFilter || memberLoc(pid), departmentId: t.departmentId || (S.roFilter || {}).dept || '', functionId: t.functionId || '' }; }
const hasFunc = (p, fid) => !fid || (p.functionIds || []).some(f => same(f, fid));
function canGetShift(R, p, d, tpl) {
  if (p.leavingOn && d > p.leavingOn) return null;
  if (tpl && tpl.functionId && !hasFunc(p, tpl.functionId)) return null;
  if (blockedAbs(R, p.id, d)) return null;
  if ((R.allShifts || R.shifts).some(s => same(s.memberId, p.id) && s.date === d)) return null;
  const av = availOf(R, p.id, d);
  if (av && av.status === 'kan_niet') return null;
  if (tpl && av && av.status === 'kan' && av.start && (tpl.start < av.start || tpl.end > av.end)) return null;
  const left = contractMin(p) ? contractMin(p) - weekMin(R, p.id) : null;
  return { p, kan: !!(av && av.status === 'kan'), left };
}
function candidates(R, d, tpl) {
  return R.people.map(p => canGetShift(R, p, d, tpl)).filter(Boolean)
    .sort((a, b) => ((b.left > 0) - (a.left > 0)) || (b.kan - a.kan) || ((b.left == null ? -1 : b.left) - (a.left == null ? -1 : a.left)) || a.p.name.localeCompare(b.p.name));
}

// afdelingsfilter: laat alleen diensten (en vaste diensten) van die afdeling zien
function roView(R) {
  const dept = (S.roFilter || {}).dept; if (!dept || !R.canPlan) return R;
  const inDept = x => same(x.departmentId, dept);
  return Object.assign({}, R, { allShifts: R.shifts, shifts: R.shifts.filter(inDept), templates: (R.templates || []).filter(t => !t.departmentId || inDept(t)) });
}
// ---------- weekweergave voor planners ----------
function deptBar(R) {
  const U = UNITS(R); if (!U.departments.length) return '';
  const F = S.roFilter || {};
  const cnt = id => (R.allShifts || R.shifts).filter(s => same(s.departmentId, id)).length;
  return '<div class="ro-depts" role="group" aria-label="Afdeling"><button class="dept-chip' + (!F.dept ? ' on' : '') + '" data-act="rx-dept" data-v="">Alle afdelingen</button>' +
    U.departments.map(d => '<button class="dept-chip' + (same(F.dept, d.id) ? ' on' : '') + '" style="--c:' + esc(d.color) + '" data-act="rx-dept" data-v="' + d.id + '"><i></i>' + esc(d.name) + ' <span class="muted">' + cnt(d.id) + '</span></button>').join('') + '</div>';
}
function rosterToolbar(R, cal) {
  if (!R.canPlan) return '';
  const tpls = R.templates || [];
  const F = S.roFilter || {};
  return deptBar(R) + '<div class="ro-tools">' +
    '<div class="ro-palette">' + (tpls.length ? '<span class="small muted">' + (cal ? 'Sleep naar een dag:' : 'Sleep naar een vakje:') + '</span>' + tpls.map(t => { const i = tpls.indexOf(t) % 6;
      const dp = deptOf(t.departmentId, R), fn = funcOf(t.functionId, R);
      const fc = fn && fn.color;
      return '<span class="shift ' + (fc ? 'has-fc' : 't' + i) + ' ro-drag" draggable="true" data-tpl-drag="' + t.id + '" style="' + (dp ? 'box-shadow:inset 4px 0 0 ' + esc(dp.color) + ';' : '') + (fc ? '--fc:' + esc(fc) : '') + '"' + ' title="Sleep naar een medewerker en dag">' + esc(t.name) + '<small>' + esc(t.start + '–' + t.end) + (fn ? ' · ' + esc(fn.name) : '') + '</small></span>'; }).join('')
      + '<button class="ro-tpl-edit" data-act="tpl-open" title="Vaste diensten toevoegen of aanpassen">✎ Aanpassen</button>'
      : '<span class="small muted">Nog geen vaste diensten.</span><button class="btn small" data-act="tpl-open">+ Vaste dienst maken</button>') + '</div>' +
    '<div class="ro-actions">' +
      (cal ? '<button class="btn small primary" data-act="pl-new" data-v="' + (mondayOf(today()) === R.weekStart ? today() : R.weekStart) + '">👥 Mensen inplannen</button>' : '<div class="seg small" role="group" aria-label="Contract">' + [['alle', 'Iedereen'], ['vast', 'Vaste uren'], ['flex', 'Flex']].map(o => { const n = o[0] === 'alle' ? R.people.length : R.people.filter(p => (p.contractType === 'vast') === (o[0] === 'vast')).length;
        return '<button class="' + ((F.ct || 'alle') === o[0] ? 'on' : '') + '" aria-pressed="' + ((F.ct || 'alle') === o[0]) + '" data-act="rx-ct" data-v="' + o[0] + '">' + o[1] + ' <span class="muted">' + n + '</span></button>'; }).join('') + '</div>' +
      '<input class="input ro-search" data-in="roq" placeholder="Zoek medewerker" value="' + esc(F.q || '') + '" aria-label="Zoek medewerker">' +
      '<label class="check small"><input type="checkbox" data-in="roleft"' + (F.left ? ' checked' : '') + '> Alleen met uren over</label>') +
      '<button class="btn small" data-act="rx-open">Open plekken</button>' +
      '<button class="btn small" data-act="rx-propose">Voorstel maken</button>' +
      '<details class="ro-more"><summary class="btn small">Instellen ▾</summary><div class="ro-menu">' +
        '<button class="link-btn" data-act="tpl-open">Vaste diensten</button>' +
        '<button class="link-btn" data-act="rx-hours">Openingstijden</button>' +
        '<button class="link-btn" data-act="rx-needs">Bezetting per dienst</button>' +
        '<button class="link-btn" data-act="rx-units">Afdelingen &amp; functies</button></div></details>' +
      '<details class="ro-more"><summary class="btn small">Meer ▾</summary><div class="ro-menu">' +
        '<button class="link-btn" data-act="rx-std-apply"' + (R.standardCount ? '' : ' disabled') + '>Standaardweek invullen' + (R.standardCount ? ' (' + R.standardCount + ' diensten)' : '') + '</button>' +
        '<button class="link-btn" data-act="rx-std-save">Deze week opslaan als standaardweek</button>' +
        '<button class="link-btn" data-act="ro-copy">Vorige week kopiëren</button></div></details>' +
      (cal ? '' : roBigBtn()) +
    '</div></div>';
}
function rosterPeople(R) {
  const F = S.roFilter || {}; const q = (F.q || '').trim().toLowerCase();
  if (F.dept && R.people.some(p => (p.departmentIds || []).length)) {
    const busy = new Set(R.shifts.map(s => String(s.memberId)));
    R = Object.assign({}, R, { people: R.people.filter(p => (p.departmentIds || []).some(x => same(x, F.dept)) || busy.has(String(p.id))) });
  }
  const ct = F.ct || 'alle';
  return R.people.filter(p => (!q || p.name.toLowerCase().includes(q)) && (!F.left || !contractMin(p) || weekMin(R, p.id) < contractMin(p))
      && (ct === 'alle' || (ct === 'vast' ? p.contractType === 'vast' : p.contractType !== 'vast')))
    .slice().sort((a, b) => ((a.contractType === 'vast' ? 0 : 1) - (b.contractType === 'vast' ? 0 : 1)) || a.name.localeCompare(b.name));
}
function rosterWeek(R) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(R.weekStart, i));
  const people = R.canPlan ? rosterPeople(R) : R.people;
  const head = d => {
    let x = '<button class="ro-dayhead" data-act="rx-day" data-v="' + d + '" title="Dagweergave">' + esc(dayShort(d)) + '</button>';
    if (R.canPlan) {
      const c = coverage(R, d);
      const o = openFor(R, d), G = gaps(R, d);
      if (!o && Object.keys(R.opening || {}).length) x += '<span class="ro-gap closed">Dicht</span>';
      else if (o) x += G.length ? '<span class="ro-gap" title="' + esc('Nog niemand (genoeg) ingepland: ' + G.map(gapTxt).join(', ')) + '">Gat ' + esc(gapTxt(G[0])) + (G.length > 1 ? ' +' + (G.length - 1) : '') + '</span>' : '<span class="ro-gap ok" title="Open ' + hhmm(o.from) + '–' + hhmm(o.to) + '">✓ ' + hhmm(o.from) + '–' + hhmm(o.to) + '</span>';
      if (c.need) x += '<span class="ro-covs">' + c.items.map(it => { const cls = it.have >= it.need ? 'ok' : it.have ? 'half' : 'bad';
        const fn = it.tpl && it.tpl.functionId && funcOf(it.tpl.functionId, R);
        const lab = it.tpl ? (fn ? fn.name + ' ' : '') + it.tpl.start.replace(/:00$/, '') + '–' + it.tpl.end.replace(/:00$/, '') : 'Mensen';
        return '<span class="ro-cov2 ' + cls + '" title="' + esc((it.tpl ? it.tpl.name + (fn ? ' (' + fn.name + ')' : '') + ' ' + it.tpl.start + '–' + it.tpl.end : 'Mensen') + ': ' + Math.min(it.have, it.need) + ' van ' + it.need + ' ingepland' + (it.have > it.need ? ' (+' + (it.have - it.need) + ' extra)' : '')) + '"><span>' + esc(lab) + '</span><b>' + Math.min(it.have, it.need) + '/' + it.need + '</b></span>'; }).join('') + '</span>';
    }
    return x;
  };
  let h = '<div class="roster-scroll"><table class="roster ro2"><thead><tr><th class="ro-namecol">Medewerker</th>' + days.map(d => '<th class="' + (d === today() ? 'is-today' : '') + '">' + head(d) + '</th>').join('') + '<th>Totaal</th></tr></thead><tbody>';
  let grp = null;
  h += people.map(p => {
    const g = p.contractType === 'vast' ? 'vast' : 'flex';
    let sep = '';
    if (R.canPlan && g !== grp) {
      grp = g; const list = people.filter(x => (x.contractType === 'vast' ? 'vast' : 'flex') === g);
      const need = list.reduce((a, x) => a + Math.max(0, contractMin(x) - weekMin(R, x.id)), 0);
      sep = '<tr class="ro-group"><th colspan="9"><span>' + (g === 'vast' ? 'Vaste uren' : 'Flex / 0-uren') + ' · ' + list.length + '</span>' + (g === 'vast' ? (need ? ' <span class="ro-group-note">nog ' + fmtHM(need) + ' uur in te plannen</span>' : ' <span class="ro-group-note ok">iedereen heeft zijn contracturen ✓</span>') : '') + '</th></tr>';
    }
    const mine = R.shifts.filter(s => same(s.memberId, p.id));
    const tot = mine.reduce((a, s) => a + shiftMin(s), 0); const ch = contractMin(p);
    return sep + '<tr class="' + (same(p.id, S.me.id) ? 'me' : '') + '"><td class="pad ro-namecol"><div class="ro-name">' + avatar(p.id, p.name, 'sm2') + '<div><strong>' + esc(p.name) + '</strong><div class="small muted">' + esc(contractShort(p)) + '</div></div></div>' + leaveTag(p.leavingOn, true) + '</td>' +
      days.map(d => {
        const gone = p.leavingOn && d > p.leavingOn;
        const dayShifts = mine.filter(s => s.date === d);
        const ab = absFor(R.absences, p.id, d);
        const av = R.canPlan ? availOf(R, p.id, d) : null;
        const blocked = ab && ab.status === 'goedgekeurd';
        const cls = 'rc' + (d === today() ? ' is-today' : '') + (gone ? ' gone' : '') + (blocked ? ' absent' : '') + (av && !blocked ? ' av-' + av.status : '');
        const key = p.id + '|' + d;
        return '<td class="' + cls + '"' + (R.canPlan && !gone && !blocked ? ' data-cell="' + key + '"' : '') + '>' +
          (ab ? absChip(ab) : '') + (av && !dayShifts.length ? '<span class="av-tag ' + av.status + (av.source === 'vast' ? ' vast' : '') + '" title="' + esc((av.source === 'vast' ? 'Vaste beschikbaarheid' : 'Doorgegeven voor deze dag') + (av.note ? ': ' + av.note : '')) + '"><span class="av-dot ' + av.status + '"></span>' + (av.status === 'kan' ? (av.start ? esc(av.start + '–' + av.end) : 'Kan') : 'Kan niet') + '</span>' : '') +
          dayShifts.map(s => shiftChip(R, s, false)).join('') + (S.rosterCompare ? workedCell(R, p, d, dayShifts) : '') +
          (gone ? '<span class="gone-txt">Uit dienst</span>' : blocked ? '' : R.canPlan ? (S.roMenu === key ? quickMenu(R, p, d) : '<button class="cell-add" data-act="rx-menu" data-v="' + key + '" aria-label="Dienst inplannen voor ' + esc(p.name) + ' op ' + esc(dayShort(d)) + '">+</button>') : '') + '</td>';
      }).join('') +
      '<td class="pad"><strong>' + fmtHM(tot) + '</strong>' + (ch ? '<div class="small muted">van ' + fmtHM(ch) + '</div><div class="ro-bar' + (tot > ch ? ' over' : '') + '"><span style="width:' + Math.min(100, tot / ch * 100) + '%"></span></div>' : '') +
        (S.rosterCompare ? '<div class="small" style="margin-top:4px">Gewerkt <strong>' + fmtHM((R.worked || []).filter(w => same(w.memberId, p.id)).reduce((a, w) => a + (w.minutes || 0), 0)) + '</strong></div>' : '') + '</td></tr>';
  }).join('');
  if (!people.length) h += '<tr><td colspan="9" class="pad muted">Niemand gevonden met dit filter.</td></tr>';
  // totalen per dag
  const dayTot = d => { const l = R.shifts.filter(s => s.date === d); return { min: l.reduce((a, s) => a + shiftMin(s), 0), n: new Set(l.map(s => String(s.memberId))).size }; };
  const wk = R.shifts.reduce((a, s) => a + shiftMin(s), 0);
  h += '</tbody><tfoot><tr><th class="ro-namecol">Totaal</th>' + days.map(d => { const t = dayTot(d); return '<td class="ro-foot"><strong>' + fmtHM(t.min) + '</strong><span>' + t.n + (t.n === 1 ? ' persoon' : ' personen') + '</span></td>'; }).join('') +
    '<td class="ro-foot"><strong>' + fmtHM(wk) + '</strong><span>deze week</span></td></tr></tfoot></table></div>';
  return h;
}
function quickMenu(R, p, d) {
  const key = p.id + '|' + d;
  return '<div class="ro-quick" role="menu">' + (R.templates || []).map((t, i) => '<button class="shift t' + (i % 6) + '" role="menuitem" data-act="rx-quick" data-id="' + t.id + '" data-v="' + key + '">' + esc(t.name) + '<small>' + esc(t.start + '–' + t.end) + '</small></button>').join('') +
    '<button class="btn small" data-act="sh-new" data-id="' + p.id + '" data-v="' + d + '">Anders…</button><button class="btn small ghost" data-act="rx-menu" data-v="">Sluiten</button></div>';
}
function shiftChip(R, s, withName) {
  const tp = tplOf(R, s);
  const issues = R.canPlan ? shiftIssues(R, s) : [];
  const label = (withName ? '<b>' + esc(s.memberName.split(' ')[0]) + '</b> ' : '') + esc(s.start + '–' + s.end) + (issues.length ? ' <span class="ro-warn" aria-label="Let op">!</span>' : '');
  const dp = deptOf(s.departmentId, R), fn = funcOf(s.functionId, R);
  const note = s.note || tp || fn || (dp && !(S.roFilter || {}).dept) ? '<small>' + (fn ? '<b class="func-tag">' + esc(fn.name) + '</b> ' : '') + esc([dp && !(S.roFilter || {}).dept ? dp.name : '', tp ? tp.t.name : '', s.note || ''].filter(Boolean).join(' · ')) + '</small>' : '';
  const fc = fn && fn.color;
  const cls = 'shift' + (tp && !fc ? ' t' + tp.i : '') + (fc ? ' has-fc' : '') + (issues.length ? ' warn' : '') + (dp ? ' has-dept' : '');
  const title = s.memberName + (s.note ? ' · ' + s.note : '') + (issues.length ? '\nLet op: ' + issues.join('; ') : '');
  const st = dp || fc ? ' style="' + (dp ? '--dept:' + esc(dp.color) + ';' : '') + (fc ? '--fc:' + esc(fc) : '') + '"' : '';
  return R.canPlan ? '<button class="' + cls + '"' + st + ' draggable="true" data-shift-drag="' + s.id + '" data-act="sh-edit" data-id="' + s.id + '" title="' + esc(title) + '">' + label + note + '</button>'
    : '<span class="' + cls + '"' + st + ' title="' + esc(s.memberName) + '">' + label + note + '</span>';
}

// ---------- panelen: bezetting, open plekken, voorstel, ongedaan maken ----------
function rosterPanels(R) {
  if (!R.canPlan) return '';
  let h = '';
  if (S.roNeedsEdit) h += modal(needsEditor(R), 'rx-needs-x');
  else if (S.roHoursEdit) h += modal(hoursEditor(), 'rx-hours-x');
  else if (S.roUnitsEdit) h += modal(unitsEditor(), 'rx-units-x');
  else if (S.roOpenPanel) h += modal(openSpots(R), 'rx-open-x');
  else if (S.roProposal) h += modal(proposalPanel(R), 'rx-propose-x');
  return h;
}
const DEPT_COLORS = ['#1D9BAE', '#16A34A', '#F59E0B', '#DC2626', '#7C3AED', '#2563EB', '#DB2777', '#EA580C', '#0F766E', '#64748B'];
function unitsEditor() {
  const E = S.roUnitsEdit;
  const dRow = (d, i) => '<div class="ue-row"><input type="color" value="' + esc(d.color) + '" data-ue="d|' + i + '|color" aria-label="Kleur"><input class="input" data-ue="d|' + i + '|name" value="' + esc(d.name) + '" maxlength="30" placeholder="Bijv. Kassa"><button class="icon-btn small" data-act="rx-ue-del" data-v="d|' + i + '" aria-label="Weghalen">' + ICON.x + '</button></div>';
  const fRow = (f, i) => '<div class="ue-row">' + (f.color ? '<input type="color" value="' + esc(f.color) + '" data-ue="f|' + i + '|color" aria-label="Kleur"><button class="link-btn small" data-act="rx-ue-nocolor" data-v="' + i + '" title="Kleur weghalen">geen</button>' : '<button class="ue-nocol" data-act="rx-ue-color" data-v="' + i + '" title="Kleur geven">+ kleur</button>') + '<input class="input" data-ue="f|' + i + '|name" value="' + esc(f.name) + '" maxlength="30" placeholder="Bijv. HOKA"><button class="icon-btn small" data-act="rx-ue-del" data-v="f|' + i + '" aria-label="Weghalen">' + ICON.x + '</button></div>';
  return '<section class="card stack" style="gap:14px;max-width:none"><div class="item-top"><h2 style="margin:0">Afdelingen &amp; functies</h2><button class="icon-btn small" data-act="rx-units-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<div class="ue-cols"><div class="stack" style="gap:8px"><strong>Afdelingen</strong><span class="small muted">Waar wordt gewerkt? Bijv. Kassa, Groente, Vers. Elke afdeling krijgt een kleur in het rooster.</span>' + E.departments.map(dRow).join('') +
      '<button class="btn small ghost" data-act="rx-ue-add" data-v="d">+ Afdeling</button></div>' +
    '<div class="stack" style="gap:8px"><strong>Functies</strong><span class="small muted">Wat mag iemand doen? Bijv. HOKA of Sleutelhouder. Zet een functie op een dienst, dan kun je alleen mensen met die functie inplannen. Wie welke functie heeft, stel je in bij Mensen. Geef je een functie een kleur, dan krijgen diensten met die functie die kleur in het rooster.</span>' + E.functions.map(fRow).join('') +
      '<button class="btn small ghost" data-act="rx-ue-add" data-v="f">+ Functie</button></div></div>' +
    (!E.departments.length && !E.functions.length ? '<button class="btn small" data-act="rx-ue-example">Voorbeeld supermarkt invullen</button>' : '') +
    '<div class="row"><button class="btn primary" data-act="rx-units-save">Opslaan</button><button class="btn ghost" data-act="rx-units-x">Annuleren</button></div></section>';
}
function hoursEditor() {
  const E = S.roHoursEdit;
  return '<section class="card stack" style="gap:12px;max-width:none"><div class="item-top"><h2 style="margin:0">Openingstijden</h2><button class="icon-btn small" data-act="rx-hours-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    '<p class="small muted" style="margin:0">Wanneer ben je open, en hoeveel mensen moeten er dan minimaal zijn? Boven elke dag zie je dan welke uren nog niet gevuld zijn. Sluit je na middernacht, vul dan bijvoorbeeld 18:00 tot 02:00 in.</p>' +
    '<div class="oh-grid">' + [1, 2, 3, 4, 5, 6, 7].map(wd => { const o = E[wd] || { open: false };
      return '<div class="oh-row' + (o.open ? '' : ' closed') + '"><label class="check"><input type="checkbox" data-oh="' + wd + '|open"' + (o.open ? ' checked' : '') + '> <strong>' + WD[wd - 1] + '</strong></label>' +
        (o.open ? '<input class="input" type="time" data-oh="' + wd + '|from" value="' + esc(o.from || '08:00') + '" aria-label="' + WD[wd - 1] + ' open vanaf"><span class="muted">tot</span><input class="input" type="time" data-oh="' + wd + '|to" value="' + esc(o.to || '21:00') + '" aria-label="' + WD[wd - 1] + ' open tot">' +
          '<label class="small oh-min">Minimaal <input class="input" inputmode="numeric" data-oh="' + wd + '|min" value="' + esc(o.min || 1) + '"> pers.</label>' : '<span class="muted">Dicht</span>') + '</div>'; }).join('') + '</div>' +
    '<div class="row"><button class="btn small ghost" data-act="rx-hours-copy">Maandag naar ma t/m vr kopiëren</button></div>' +
    '<div class="row"><button class="btn primary" data-act="rx-hours-save">Opslaan</button><button class="btn ghost" data-act="rx-hours-x">Annuleren</button></div></section>';
}
function needsEditor(R) {
  const E = S.roNeedsEdit; const T = (R.templates || []).slice().sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || String(a.name).localeCompare(String(b.name)));
  const hasFunc = T.some(t => t.functionId);
  const val = (wd, k) => ((E[wd] || {})[k]) || '';
  const cells = (key, label) => [1, 2, 3, 4, 5, 6, 7].map(wd => '<td class="nd-cell' + (wd > 5 ? ' we' : '') + '"><input class="input nd-in" inputmode="numeric" maxlength="2" placeholder="–" data-need="' + wd + '|' + key + '" value="' + esc(val(wd, key)) + '" aria-label="' + esc(label + ', ' + WD[wd - 1]) + '"></td>').join('');
  const tot = key => [1, 2, 3, 4, 5, 6, 7].reduce((a, wd) => a + (Number(val(wd, key)) || 0), 0);
  const row = (key, label, nameHtml) => '<tr><th class="nd-row">' + nameHtml + '</th>' + cells(key, label) +
    '<td class="nd-tot"><b>' + (tot(key) || '–') + '</b><button type="button" class="nd-fill" data-act="rx-need-fill" data-v="' + esc(key) + '" title="Waarde van maandag op alle dagen zetten">Ma → alle</button></td></tr>';
  const head = '<thead><tr><th class="nd-row"></th>' + WD.map((w, i) => '<th class="nd-day' + (i > 4 ? ' we' : '') + '">' + w.slice(0, 2) + '</th>').join('') + '<th class="nd-day">Week</th></tr></thead>';
  let body = '';
  if (!T.length) body = row('dag', 'Aantal mensen', '<strong>Aantal mensen</strong>');
  else {
    const groups = [];
    T.forEach(t => { const k = t.start + '–' + t.end; let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, list: [] }); g.list.push(t); });
    body = groups.map(g => '<tr class="nd-grp"><th colspan="9"><span class="nd-time">' + esc(g.k) + '</span></th></tr>' +
      g.list.map(t => row(String(t.id), t.name + ' ' + t.start + '–' + t.end,
        '<div class="nd-name"><strong>' + esc(t.name) + '</strong><span class="nd-tags">' + (tplTags(R, t) || '<span class="nd-tag any">Iedereen</span>') + '</span></div>')).join('')).join('');
  }
  return '<section class="card stack needs-ed" style="gap:16px;max-width:none"><div class="item-top"><div><h2 style="margin:0">Bezetting per dienst</h2><p class="muted" style="margin:4px 0 0">Hoeveel mensen heb je per dienst nodig? Leeg = niet bijhouden.</p></div><button class="icon-btn" data-act="rx-needs-x" aria-label="Sluiten">' + ICON.x + '</button></div>' +
    (T.length && !hasFunc ? '<div class="nd-tip">Tip: geef een vaste dienst een <strong>functie</strong> (bij Vaste diensten). Dan kun je per functie aangeven hoeveel mensen je nodig hebt, bijvoorbeeld 1 Hoka en 3 gewone mensen.</div>' : '') +
    '<div class="table-wrap nd-wrap"><table class="nd-table">' + head + '<tbody>' + body + '</tbody></table></div>' +
    '<div class="row nd-foot"><button class="btn primary" data-act="rx-needs-save">Opslaan</button><button class="btn ghost" data-act="rx-needs-x">Annuleren</button><span class="small muted" style="margin-left:auto">Een dienst telt mee als de tijden gelijk zijn' + (hasFunc ? ' en de functie klopt' : '') + '.</span></div></section>';
}
function openList(R) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(R.weekStart, i));
  const out = [];
  days.forEach(d => { if (d < today()) return; coverage(R, d).items.forEach(i => { if (i.have < i.need) out.push({ d, item: i, missing: i.need - i.have }); }); });
  return out;
}
function gapList(R) {
  const out = [];
  [0, 1, 2, 3, 4, 5, 6].map(i => addDays(R.weekStart, i)).forEach(d => { if (d < today()) return; gaps(R, d).forEach(g => out.push({ d, g })); });
  return out;
}
function openSpots(R) {
  const L = openList(R), GL = gapList(R);
  let h = '<section class="card stack" style="gap:12px;max-width:none"><div class="item-top"><h2 style="margin:0">Open plekken deze week</h2><button class="icon-btn small" data-act="rx-open-x" aria-label="Sluiten">' + ICON.x + '</button></div>';
  if (!Object.keys(R.needs || {}).length && !Object.keys(R.opening || {}).length) return h + '<p class="small muted" style="margin:0">Stel eerst je <strong>Openingstijden</strong> in, of hoeveel mensen je per dienst nodig hebt (<strong>Bezetting instellen</strong>).</p></section>';
  h += GL.map(o => {
    const t = { start: hhmm(o.g.from), end: hhmm(o.g.to) };
    const c = candidates(R, o.d, t).slice(0, 8);
    return '<div class="ro-open"><div><strong>' + esc(dayShort(o.d)) + ' · ' + esc(gapTxt(o.g)) + '</strong><span class="badge red">' + (o.g.have ? 'nog ' + (o.g.need - o.g.have) + ' nodig' : 'niemand ingepland') + '</span></div>' +
      '<div class="who-list">' + (c.length ? c.map(x => '<button class="who-chip ' + (x.kan ? 'kan' : 'leeg') + '" data-act="rx-fillgap" data-id="' + x.p.id + '" data-v="' + o.d + '|' + t.start + '|' + t.end + '"><strong>' + esc(x.p.name) + '</strong><small>' + (x.kan ? 'kan' : 'niet ingevuld') + (x.left != null ? ' · nog ' + fmtHM(Math.max(0, x.left)) + ' u' : '') + '</small></button>').join('') : '<span class="small muted">Niemand beschikbaar.</span>') + '</div></div>';
  }).join('');
  if (!L.length && !GL.length) return h + '<p style="margin:0">Alles is gevuld. 🎉</p></section>';
  h += L.map(o => {
    const c = candidates(R, o.d, o.item.tpl).slice(0, 8);
    return '<div class="ro-open"><div><strong>' + esc(dayShort(o.d)) + ' · ' + esc(o.item.tpl ? o.item.tpl.name + ' ' + o.item.tpl.start + '–' + o.item.tpl.end : 'Mensen') + '</strong>' + (o.item.tpl ? tplTags(R, o.item.tpl) : '') + '<span class="badge orange">nog ' + o.missing + ' nodig</span></div>' +
      '<div class="who-list">' + (c.length ? c.map(x => '<button class="who-chip ' + (x.kan ? 'kan' : 'leeg') + '" data-act="rx-fill" data-id="' + x.p.id + '" data-v="' + o.d + '|' + (o.item.tpl ? o.item.tpl.id : '') + '"><strong>' + esc(x.p.name) + '</strong><small>' + (x.kan ? 'kan' : 'niet ingevuld') + (x.left != null ? ' · nog ' + fmtHM(Math.max(0, x.left)) + ' u' : '') + '</small></button>').join('') : '<span class="small muted">Niemand beschikbaar.</span>') + '</div></div>';
  }).join('');
  return h + '<p class="small muted" style="margin:0">Klik op een naam om diegene meteen in te plannen. Groen = heeft aangegeven te kunnen.</p></section>';
}
function makeProposal(R) {
  const work = Object.assign({}, R, { shifts: R.shifts.slice(), allShifts: (R.allShifts || R.shifts).slice() });
  const out = [];
  openList(R).forEach(o => {
    for (let k = 0; k < o.missing; k++) {
      const tpl = o.item.tpl || (R.templates || [])[0] || { start: '09:00', end: '17:00', name: '' };
      const c = candidates(work, o.d, o.item.tpl).filter(x => x.left == null || x.left >= shiftMin(tpl) || x.kan)[0];
      if (!c) break;
      const s = { id: 'p' + out.length, memberId: c.p.id, memberName: c.p.name, date: o.d, start: tpl.start, end: tpl.end, note: '', tplName: tpl.name, departmentId: tpl.departmentId || (S.roFilter || {}).dept || '', functionId: tpl.functionId || '', why: c.kan ? 'kan' : 'niet ingevuld' };
      work.shifts.push(s); work.allShifts.push(s); out.push(s);
    }
  });
  // gaten in de openingstijden: per gat één persoon voor precies die uren (minimaal 1 uur)
  for (let round = 0; round < 3; round++) {
    gapList(work).forEach(o => {
      if (o.g.to - o.g.from < 60) return;
      const t = { start: hhmm(o.g.from), end: hhmm(o.g.to) };
      const c = candidates(work, o.d, t)[0]; if (!c) return;
      const s = { id: 'p' + out.length, memberId: c.p.id, memberName: c.p.name, date: o.d, start: t.start, end: t.end, note: '', tplName: 'openingstijden', departmentId: (S.roFilter || {}).dept || '', why: c.kan ? 'kan' : 'niet ingevuld' };
      work.shifts.push(s); work.allShifts.push(s); out.push(s);
    });
  }
  return out;
}
function proposalPanel(R) {
  const P = S.roProposal;
  let h = '<section class="card stack" style="gap:12px;max-width:none"><div class="item-top"><h2 style="margin:0">Voorstel</h2><button class="icon-btn small" data-act="rx-propose-x" aria-label="Sluiten">' + ICON.x + '</button></div>';
  if (!Object.keys(R.needs || {}).length && !Object.keys(R.opening || {}).length) return h + '<p class="small muted" style="margin:0">Stel eerst je <strong>Openingstijden</strong> of de <strong>Bezetting</strong> in. Dan kan CrewHarbor een voorstel maken.</p></section>';
  if (!P.length) return h + '<p style="margin:0">Er zijn geen open plekken om te vullen, of er is niemand beschikbaar.</p></section>';
  h += '<p class="small muted" style="margin:0">CrewHarbor geeft eerst mensen met een vast contract hun uren, daarna vult het op met wie heeft aangegeven te kunnen (flex). Vink uit wat je niet wilt.</p>' +
    '<div class="ro-prop">' + P.map((s, i) => '<label class="check"><input type="checkbox" data-prop="' + i + '"' + (s.off ? '' : ' checked') + '> <span><strong>' + esc(dayShort(s.date)) + '</strong> · ' + esc(s.memberName) + ' · ' + esc(s.start + '–' + s.end) + (s.tplName ? ' (' + esc(s.tplName) + ')' : '') + ' <span class="small muted">' + esc(s.why) + '</span></span></label>').join('') + '</div>' +
    '<div class="row"><button class="btn primary" data-act="rx-propose-apply">' + P.filter(s => !s.off).length + ' diensten inplannen</button><button class="btn ghost" data-act="rx-propose-x">Annuleren</button></div></section>';
  return h;
}

// ---------- dagweergave (tijdlijn) ----------
function rosterDayView(R) {
  const d = S.rosterDay || today();
  const list = R.shifts.filter(s => s.date === d);
  const OH = openFor(R, d), DG = gaps(R, d);
  let from = OH ? Math.min(OH.from, 8 * 60) : 6 * 60, to = OH ? Math.max(OH.to, 18 * 60) : 23 * 60;
  list.forEach(s => { from = Math.min(from, toMin(s.start)); const e = toMin(s.end) <= toMin(s.start) ? 24 * 60 : toMin(s.end); to = Math.max(to, e); });
  from = Math.floor(from / 60) * 60; to = Math.min(OH && OH.to > 1440 ? OH.to : 24 * 60, Math.ceil(to / 60) * 60);
  const span = to - from; const pos = m => (Math.max(0, Math.min(1, (m - from) / span)) * 100).toFixed(2) + '%';
  const hours = []; for (let m = from; m <= to; m += 60) hours.push(m);
  const people = R.canPlan ? rosterPeople(R) : R.people.filter(p => list.some(s => same(s.memberId, p.id)));
  // aantal mensen per uur
  const perHour = hours.slice(0, -1).map(m => list.filter(s => { const a = toMin(s.start), b = toMin(s.end) <= a ? 24 * 60 : toMin(s.end); return a < m + 60 && b > m; }).length);
  const max = Math.max(1, ...perHour);
  let h = '<div class="ro-daynav"><button class="icon-btn" data-act="rx-day" data-v="' + addDays(d, -1) + '" aria-label="Vorige dag">' + ICON.left + '</button><strong>' + esc(dayLong(d)) + '</strong>' +
    '<button class="icon-btn" data-act="rx-day" data-v="' + addDays(d, 1) + '" aria-label="Volgende dag">' + ICON.right + '</button>' + (d !== today() ? '<button class="btn small ghost" data-act="rx-day" data-v="' + today() + '">Vandaag</button>' : '') + '</div>';
  if (OH) h += DG.length ? '<div class="alert warn"><p style="margin:0">Open ' + hhmm(OH.from) + '–' + hhmm(OH.to) + '. Nog niet gevuld: <strong>' + esc(DG.map(gapTxt).join(', ')) + '</strong>' + (OH.min > 1 ? ' (minimaal ' + OH.min + ' mensen)' : '') + '. Kijk bij <strong>Open plekken</strong> wie er kan.</p></div>'
    : '<div class="alert info"><span>Open ' + hhmm(OH.from) + '–' + hhmm(OH.to) + '. Alle openingsuren zijn gevuld.</span></div>';
  else if (Object.keys(R.opening || {}).length) h += '<div class="alert info"><span>Op deze dag ben je dicht.</span></div>';
  const shade = OH ? '<span class="tl-closed" style="left:0;width:' + pos(OH.from) + '"></span><span class="tl-closed" style="left:' + pos(OH.to) + ';right:0"></span>' + DG.map(g => '<span class="tl-gap" style="left:' + pos(g.from) + ';width:' + ((g.to - g.from) / span * 100) + '%"></span>').join('') : '';
  h += '<div class="tl card"><div class="tl-row tl-head"><div class="tl-name"></div><div class="tl-track">' + hours.map(m => '<span class="tl-hour" style="left:' + pos(m) + '">' + String(m / 60).padStart(2, '0') + '</span>').join('') + '</div></div>' +
    '<div class="tl-row tl-load"><div class="tl-name small muted">Aan het werk</div><div class="tl-track">' + shade + perHour.map((n, i) => '<span class="tl-bar-n' + (n === 0 ? ' zero' : '') + '" style="left:' + pos(hours[i]) + ';width:' + (60 / span * 100) + '%;opacity:' + (0.25 + 0.75 * n / max) + '" title="' + String(hours[i] / 60).padStart(2, '0') + ':00 · ' + n + (n === 1 ? ' persoon' : ' personen') + '">' + n + '</span>').join('') + '</div></div>';
  h += people.map(p => {
    const mine = list.filter(s => same(s.memberId, p.id));
    const av = R.canPlan ? availOf(R, p.id, d) : null; const ab = absFor(R.absences, p.id, d);
    const avBand = av && av.status === 'kan' ? '<span class="tl-av" style="left:' + pos(av.start ? toMin(av.start) : from) + ';width:' + (((av.end ? toMin(av.end) : to) - (av.start ? toMin(av.start) : from)) / span * 100) + '%" title="Kan werken"></span>' : '';
    return '<div class="tl-row' + (av && av.status === 'kan_niet' ? ' niet' : '') + (ab && ab.status === 'goedgekeurd' ? ' abs' : '') + '"><div class="tl-name">' + avatar(p.id, p.name, 'sm2') + '<span>' + esc(p.name) + (ab ? ' ' + absChip(ab) : '') + '</span></div><div class="tl-track">' + avBand +
      mine.map(s => { const a = toMin(s.start), b = toMin(s.end) <= a ? 24 * 60 : toMin(s.end); const tp = tplOf(R, s);
        return '<button class="tl-shift shift' + (tp ? ' t' + tp.i : '') + '"' + (R.canPlan ? ' data-act="sh-edit" data-id="' + s.id + '"' : '') + ' style="left:' + pos(a) + ';width:' + ((b - a) / span * 100) + '%" title="' + esc(s.memberName + ' ' + s.start + '–' + s.end + (s.note ? ' · ' + s.note : '')) + '">' + esc(s.start + '–' + s.end) + (tp ? ' · ' + esc(tp.t.name) : '') + '</button>'; }).join('') +
      (R.canPlan && !mine.length && !(ab && ab.status === 'goedgekeurd') && !(p.leavingOn && d > p.leavingOn) ? '<button class="tl-add" data-act="sh-new" data-id="' + p.id + '" data-v="' + d + '">+ inplannen</button>' : '') + '</div></div>';
  }).join('');
  return h + '</div><p class="small muted">Groene achtergrond = heeft aangegeven te kunnen. De bovenste balk laat per uur zien hoeveel mensen er werken.</p>';
}

// ---------- klikken ----------
document.getElementById('app').addEventListener('click', async e => {
  const el = e.target.closest('[data-act^="rx-"]'); if (!el || el.disabled) return;
  const act = el.dataset.act, v = el.dataset.v, id = el.dataset.id;
  const R = S.roster;
  try {
    switch (act) {
      case 'rx-menu': S.roMenu = v || null; render(); return;
      case 'rx-dept': S.roFilter = Object.assign({}, S.roFilter, { dept: v || '' }); S.roMenu = null; render(); return;
      case 'rx-units': { const dd = el.closest('details'); if (dd) dd.open = false; const U = UNITS(R); S.roUnitsEdit = { departments: U.departments.map(d => Object.assign({}, d)), functions: U.functions.map(f => Object.assign({}, f)) }; S.roHoursEdit = null; S.roNeedsEdit = null; S.roOpenPanel = false; S.roProposal = null; render(); return; }
      case 'rx-units-x': S.roUnitsEdit = null; render(); return;
      case 'rx-ue-add': { const E = S.roUnitsEdit; if (v === 'd') E.departments.push({ name: '', color: DEPT_COLORS[E.departments.length % DEPT_COLORS.length] }); else E.functions.push({ name: '' }); render(); const ins = document.querySelectorAll('[data-ue^="' + v + '|"][data-ue$="|name"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
      case 'rx-ue-color': { const F = S.roUnitsEdit.functions; F[Number(v)].color = DEPT_COLORS[(Number(v) + 3) % DEPT_COLORS.length]; render(); return; }
      case 'rx-ue-nocolor': { S.roUnitsEdit.functions[Number(v)].color = ''; render(); return; }
      case 'rx-ue-del': { const [k, i] = v.split('|'); (k === 'd' ? S.roUnitsEdit.departments : S.roUnitsEdit.functions).splice(Number(i), 1); render(); return; }
      case 'rx-ue-example': {
        S.roUnitsEdit.departments = ['Kassa', 'Groente & fruit', 'Vers', 'Vries', 'DKW', 'Vakkenvullen'].map((n, i) => ({ name: n, color: DEPT_COLORS[i] }));
        S.roUnitsEdit.functions = ['HOKA', 'Leidinggevende', 'Sleutelhouder'].map(n => ({ name: n })); render(); return;
      }
      case 'rx-units-save': {
        el.disabled = true; const u = await rpc('cd_units_save', { p: S.roUnitsEdit });
        S.roster.units = u; S.roUnitsEdit = null; if (S.roFilter && S.roFilter.dept && !u.departments.some(d => same(d.id, S.roFilter.dept))) S.roFilter.dept = '';
        toast('Afdelingen en functies opgeslagen.'); await roReload(); return;
      }
      case 'rx-ct': S.roFilter = Object.assign({}, S.roFilter, { ct: v }); render(); return;
      case 'rx-quick': {
        const [pid, d] = v.split('|'); const t = R.templates.find(x => same(x.id, id));
        el.disabled = true;
        const sp = tplSpec(t, pid, d); const s = await roCreate(sp);
        S.roMenu = null; roDone(opCreate([sp], 'Dienst ingepland', [s.id]), s.memberName.split(' ')[0] + ' ingepland ' + dayShort(d));
        await roReload(); return;
      }
      case 'rx-day': S.rosterView = 'dag'; S.rosterDay = v; S.roMenu = null; if (mondayOf(v) !== S.rosterWeek) { S.rosterWeek = mondayOf(v); await roReload(); } else render(); return;
      case 'rx-needs': { const dd = el.closest('details'); if (dd) dd.open = false; } S.roNeedsEdit = JSON.parse(JSON.stringify(R.needs || {})); S.roHoursEdit = null; S.roOpenPanel = false; S.roProposal = null; render(); return;
      case 'rx-needs-x': S.roNeedsEdit = null; render(); return;
      case 'rx-need-fill': { const E = S.roNeedsEdit; const m = (E['1'] || {})[v] || ''; [2, 3, 4, 5, 6, 7].forEach(wd => { E[wd] = E[wd] || {}; E[wd][v] = m; }); render(); return; }
      case 'rx-needs-save': {
        el.disabled = true; const v2 = await rpc('cd_roster_needs_save', { p: S.roNeedsEdit });
        S.roster.needs = v2; S.roNeedsEdit = null; render(); toast('Bezetting opgeslagen. Boven elke dag zie je nu hoeveel plekken gevuld zijn.'); return;
      }
      case 'rx-hours': { const dd = el.closest('details'); if (dd) dd.open = false; } S.roHoursEdit = JSON.parse(JSON.stringify(R.opening || {})); S.roNeedsEdit = null; S.roOpenPanel = false; S.roProposal = null; render(); return;
      case 'rx-hours-x': S.roHoursEdit = null; render(); return;
      case 'rx-hours-copy': { const m = S.roHoursEdit['1'] || { open: false }; [2, 3, 4, 5].forEach(wd => { S.roHoursEdit[wd] = Object.assign({}, m); }); render(); return; }
      case 'rx-hours-save': {
        el.disabled = true; const v2 = await rpc('cd_opening_hours_save', { p: S.roHoursEdit });
        S.roster.opening = v2; S.roHoursEdit = null; render(); toast('Openingstijden opgeslagen. Boven elke dag zie je nu of er nog gaten zijn.'); return;
      }
      case 'rx-fillgap': {
        const [d, a, b] = v.split('|');
        const sp = { memberId: id, date: d, start: a, end: b, note: '', locationId: S.locFilter || memberLoc(id), departmentId: (S.roFilter || {}).dept || '' };
        el.disabled = true; const s = await roCreate(sp);
        roDone(opCreate([sp], 'Dienst ingepland', [s.id]), s.memberName.split(' ')[0] + ' ingepland ' + dayShort(d) + ' ' + a + '–' + b);
        await roReload(); return;
      }
      case 'rx-open': S.roOpenPanel = !S.roOpenPanel; S.roProposal = null; S.roNeedsEdit = null; S.roHoursEdit = null; render(); return;
      case 'rx-open-x': S.roOpenPanel = false; render(); return;
      case 'rx-fill': {
        const [d, tid] = v.split('|'); const t = tid ? R.templates.find(x => same(x.id, tid)) : (R.templates[0] || { start: '09:00', end: '17:00' });
        const sp = tplSpec(t, id, d); el.disabled = true; const s = await roCreate(sp);
        roDone(opCreate([sp], 'Dienst ingepland', [s.id]), s.memberName.split(' ')[0] + ' ingepland ' + dayShort(d));
        await roReload(); return;
      }
      case 'rx-propose': S.roProposal = makeProposal(roView(R)); S.roOpenPanel = false; S.roNeedsEdit = null; S.roHoursEdit = null; render(); return;
      case 'rx-propose-x': S.roProposal = null; render(); return;
      case 'rx-propose-apply': {
        const todo = S.roProposal.filter(s => !s.off); if (!todo.length) return;
        el.disabled = true; const made = []; let fail = 0;
        const okSpecs = [];
        for (const x of todo) { const sp = specOf(x, { note: '', locationId: S.locFilter || memberLoc(x.memberId) }); try { made.push((await roCreate(sp)).id); okSpecs.push(sp); } catch (err) { fail++; } }
        S.roProposal = null; roPush(opCreate(okSpecs, made.length + ' diensten uit het voorstel', made));
        toast(made.length + ' diensten ingepland.' + (fail ? ' ' + fail + ' lukten niet.' : '') + ' · Ctrl+Z = terug', !!fail); await roReload(); return;
      }
      case 'rx-std-save': {
        el.closest('details').open = false;
        if (!confirm('Deze week (' + R.shifts.length + ' diensten) opslaan als standaardweek? Een eerdere standaardweek wordt vervangen.')) return;
        const d = await rpc('cd_roster_standard_save', { p_week: R.weekStart }); toast('Standaardweek opgeslagen (' + d.count + ' diensten).'); await roReload(); return;
      }
      case 'rx-std-apply': {
        el.closest('details').open = false;
        if (!confirm('De standaardweek invullen in week ' + weekNo(R.weekStart) + '? Diensten die er al staan blijven staan.')) return;
        const before = new Set(R.shifts.map(s => String(s.id)));
        const d = await rpc('cd_roster_standard_apply', { p_week: R.weekStart });
        await roReload();
        const addedS = S.roster.shifts.filter(s => !before.has(String(s.id)));
        roPush(opCreate(addedS, d.added + ' diensten uit de standaardweek', addedS.map(s => s.id)));
        toast(d.added + ' diensten ingevuld.' + (d.skipped ? ' ' + d.skipped + ' overgeslagen (stond er al, verlof of niet meer in dienst).' : '')); render(); return;
      }
      default: return;
    }
  } catch (err) { toast(err.message, true); el.disabled = false; }
});
document.getElementById('app').addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.ue && S.roUnitsEdit) { const [k, i, f] = el.dataset.ue.split('|'); (k === 'd' ? S.roUnitsEdit.departments : S.roUnitsEdit.functions)[Number(i)][f] = el.value; return; }
  if (el.dataset.oh && S.roHoursEdit && el.type !== 'checkbox') { const [wd, k] = el.dataset.oh.split('|'); S.roHoursEdit[wd] = Object.assign({ open: true }, S.roHoursEdit[wd], { [k]: el.value }); return; }
  if (el.dataset.need && S.roNeedsEdit) { const [wd, k] = el.dataset.need.split('|'); S.roNeedsEdit[wd] = S.roNeedsEdit[wd] || {}; S.roNeedsEdit[wd][k] = el.value.replace(/\D/g, ''); const tr = el.closest('tr'), b = tr && tr.querySelector('.nd-tot b'); if (b) { const t = [1, 2, 3, 4, 5, 6, 7].reduce((a, d) => a + (Number((S.roNeedsEdit[d] || {})[k]) || 0), 0); b.textContent = t || '–'; } return; }
  if (el.dataset.prop !== undefined && S.roProposal) { S.roProposal[Number(el.dataset.prop)].off = !el.checked; const b = document.querySelector('[data-act="rx-propose-apply"]'); if (b) b.textContent = S.roProposal.filter(s => !s.off).length + ' diensten inplannen'; return; }
  if (el.dataset.in === 'roq') { S.roFilter = Object.assign({}, S.roFilter, { q: el.value }); clearTimeout(S.roqT); S.roqT = setTimeout(() => { renderKeepFocus(); }, 250); return; }
});
document.getElementById('app').addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.oh && S.roHoursEdit && el.type === 'checkbox') { const wd = el.dataset.oh.split('|')[0]; S.roHoursEdit[wd] = Object.assign({ from: wd >= 6 ? '10:00' : '08:00', to: '21:00', min: 1 }, S.roHoursEdit[wd], { open: el.checked }); render(); return; }
  if (el.dataset.in === 'roleft') { S.roFilter = Object.assign({}, S.roFilter, { left: el.checked }); render(); }
  if (el.dataset.prop !== undefined && S.roProposal) S.roProposal[Number(el.dataset.prop)].off = !el.checked;
});

// ---------- slepen ----------
let roDrag = null;
document.getElementById('app').addEventListener('dragstart', e => {
  const s = e.target.closest && e.target.closest('[data-shift-drag],[data-tpl-drag]'); if (!s) return;
  roDrag = s.dataset.shiftDrag ? { type: 'shift', id: s.dataset.shiftDrag } : { type: 'tpl', id: s.dataset.tplDrag };
  e.dataTransfer.effectAllowed = 'copyMove';
  try { e.dataTransfer.setData('text/plain', roDrag.type + ':' + roDrag.id); } catch (err) { /* */ }
  s.classList.add('dragging'); document.body.classList.add('ro-dragging');
});
document.getElementById('app').addEventListener('dragend', e => {
  const s = e.target.closest && e.target.closest('[data-shift-drag],[data-tpl-drag]'); if (s) s.classList.remove('dragging');
  document.querySelectorAll('td.drop-over').forEach(c => c.classList.remove('drop-over')); document.body.classList.remove('ro-dragging'); roDrag = null;
});
document.getElementById('app').addEventListener('dragover', e => {
  if (!roDrag) return; const c = e.target.closest('td[data-cell]'); if (!c) return;
  e.preventDefault(); e.dataTransfer.dropEffect = roDrag.type === 'tpl' || e.ctrlKey || e.altKey || e.metaKey ? 'copy' : 'move';
  document.querySelectorAll('td.drop-over').forEach(x => { if (x !== c) x.classList.remove('drop-over'); }); c.classList.add('drop-over');
});
document.getElementById('app').addEventListener('drop', async e => {
  if (!roDrag) return; const c = e.target.closest('td[data-cell]'); if (!c) return;
  e.preventDefault(); c.classList.remove('drop-over');
  const D = roDrag; roDrag = null; document.body.classList.remove('ro-dragging');
  const [pid, d] = c.dataset.cell.split('|'); const R = S.roster;
  try {
    if (D.type === 'tpl') {
      const t = R.templates.find(x => same(x.id, D.id));
      const sp = tplSpec(t, pid, d); const s = await roCreate(sp);
      roDone(opCreate([sp], 'Dienst ingepland', [s.id]), s.memberName.split(' ')[0] + ' ingepland ' + dayShort(d));
    } else {
      const s = R.shifts.find(x => same(x.id, D.id)); if (!s) return;
      const copy = e.ctrlKey || e.altKey || e.metaKey;
      if (!copy && same(s.memberId, pid) && s.date === d) return;
      if (copy) {
        const sp = specOf(s, { memberId: pid, date: d }); const n = await roCreate(sp);
        roDone(opCreate([sp], 'Dienst gekopieerd', [n.id]), 'Gekopieerd naar ' + n.memberName.split(' ')[0] + ' ' + dayShort(d));
      } else {
        const old = { memberId: s.memberId, date: s.date, start: s.start, end: s.end, note: s.note || '' };
        const nw = Object.assign({}, old, { memberId: pid, date: d });
        const n = await rpc('cd_shift_save', { p_id: s.id, p: nw });
        roDone(opMove(s.id, old, nw), 'Verplaatst naar ' + n.memberName.split(' ')[0] + ' ' + dayShort(d));
      }
    }
    await roReload();
  } catch (err) { toast(err.message, true); }
});
