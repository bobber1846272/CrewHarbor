/* CrewHarbor · toeslagen (avond, weekend, feestdag) in de salarisexport
   Regels staan bij Instellingen → Uren → Salarisadministratie. De berekening gebruikt de goedgekeurde uren. */
'use strict';

const SC_DAYS = [[1, 'ma'], [2, 'di'], [3, 'wo'], [4, 'do'], [5, 'vr'], [6, 'za'], [7, 'zo']];
const SC_PRESETS = [
  { name: 'Avond', pct: 25, days: [1, 2, 3, 4, 5, 6], hol: false, from: '20:00', to: '00:00', code: '' },
  { name: 'Zondag', pct: 50, days: [7], hol: false, from: '00:00', to: '00:00', code: '' },
  { name: 'Feestdag', pct: 100, days: [], hol: true, from: '00:00', to: '00:00', code: '' }
];
function scRules() { return (S.scEdit || ((S.payroll && S.payroll.settings) || {}).surcharges || []); }
const scLabel = r => (r.name || 'Toeslag') + ' ' + (Number(r.pct) || 0) + '%';
function scWhen(r) {
  const d = (r.days || []).map(Number).sort();
  const dayTxt = d.length === 7 ? 'elke dag' : d.length === 5 && d.join() === '1,2,3,4,5' ? 'ma–vr' : d.length === 6 && d.join() === '1,2,3,4,5,6' ? 'ma–za' : SC_DAYS.filter(x => d.includes(x[0])).map(x => x[1]).join(', ');
  const t = r.from === r.to ? 'hele dag' : r.from + '–' + r.to;
  return [dayTxt, r.hol ? 'feestdagen' : ''].filter(Boolean).join(' + ') + ' · ' + t;
}

// ---------- instellingen ----------
function surchargesBlock() {
  const L = scRules();
  const row = (r, i) => '<div class="sc-row"><div class="sc-top">' +
      '<input class="input sc-name" data-sc="' + i + '|name" value="' + esc(r.name || '') + '" placeholder="Naam, bijv. Avond" maxlength="40" aria-label="Naam toeslag">' +
      '<span class="sc-pct"><input class="input" inputmode="decimal" data-sc="' + i + '|pct" value="' + esc(String(r.pct ?? '')) + '" aria-label="Percentage"><span>%</span></span>' +
      '<input class="input sc-code" data-sc="' + i + '|code" value="' + esc(r.code || '') + '" placeholder="Looncomponent" maxlength="30" aria-label="Looncomponent">' +
      '<button class="icon-btn small" data-act="sc-del" data-v="' + i + '" aria-label="Toeslag verwijderen">' + ICON.trash + '</button></div>' +
    '<div class="sc-when"><div class="sc-days" role="group" aria-label="Dagen">' + SC_DAYS.map(x => '<button type="button" class="' + ((r.days || []).map(Number).includes(x[0]) ? 'on' : '') + '" data-act="sc-day" data-v="' + i + '|' + x[0] + '" aria-pressed="' + (r.days || []).map(Number).includes(x[0]) + '">' + x[1] + '</button>').join('') +
      '<button type="button" class="hol' + (r.hol ? ' on' : '') + '" data-act="sc-hol" data-v="' + i + '" aria-pressed="' + !!r.hol + '">🎉 Feestdag</button></div>' +
      '<span class="sc-time"><input class="input" type="time" data-sc="' + i + '|from" value="' + esc(r.from || '00:00') + '" aria-label="Vanaf"><span>tot</span><input class="input" type="time" data-sc="' + i + '|to" value="' + esc(r.to || '00:00') + '" aria-label="Tot"></span></div></div>';
  return '<div class="stack sc" style="gap:10px"><div><strong>Toeslagen</strong> ' + (S.scEdit ? '<span class="badge orange">Niet opgeslagen</span>' : '') +
    '<p class="small muted" style="margin:4px 0 0">Bijvoorbeeld avond, zondag of feestdag. De export zet die uren apart, per toeslag. Vallen er meer toeslagen tegelijk, dan telt de hoogste. Zelfde begin- en eindtijd = hele dag; 20:00 tot 00:00 = tot middernacht.</p></div>' +
    (L.length ? L.map(row).join('') : '<p class="small muted" style="margin:0">Nog geen toeslagen.</p>') +
    '<div class="row"><button class="btn small ghost" data-act="sc-add">' + ICON.plus + 'Toeslag toevoegen</button>' + (L.length ? '' : '<button class="btn small ghost" data-act="sc-preset">Voorbeeld gebruiken (avond, zondag, feestdag)</button>') + '</div></div>';
}

// ---------- berekenen ----------
function scMatch(r, day, tod) {
  const hol = typeof holidayOn === 'function' && holidayOn(null, day);
  if (!((r.hol && hol) || (r.days || []).map(Number).includes(isoDow(day)))) return false;
  const f = toMin(r.from || '00:00'), t = toMin(r.to || '00:00');
  if (f === t) return true;
  return f < t ? tod >= f && tod < t : tod >= f || tod < t;
}
// per medewerker: uren per toeslag (index in de regels), alleen goedgekeurde uren
function surchargeHours(R) {
  const L = ((S.payroll && S.payroll.settings) || {}).surcharges || [];
  const out = {}; if (!L.length || !R) return out;
  (R.entries || []).filter(e => e.status === 'goedgekeurd' && e.start && e.end).forEach(e => {
    const a = toMin(e.start); let b = toMin(e.end); if (b <= a) b += 1440;
    const gross = b - a; if (!gross) return;
    const factor = Math.max(0, Math.min(1, (Number(e.minutes) || gross) / gross)); // pauze naar verhouding eraf
    const acc = out[e.memberId] || (out[e.memberId] = {});
    for (let m = a; m < b; m++) {
      const day = addDays(e.date, Math.floor(m / 1440)), tod = m % 1440;
      let best = -1;
      L.forEach((r, i) => { if (scMatch(r, day, tod) && (best < 0 || Number(r.pct) > Number(L[best].pct))) best = i; });
      if (best >= 0) acc[best] = (acc[best] || 0) + factor;
    }
  });
  Object.values(out).forEach(acc => Object.keys(acc).forEach(k => { acc[k] = acc[k] / 60; }));
  return out;
}

// ---------- klikken en typen ----------
function scWork() { if (!S.scEdit) S.scEdit = JSON.parse(JSON.stringify(((S.payroll && S.payroll.settings) || {}).surcharges || [])); return S.scEdit; }
document.getElementById('app').addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || !el.dataset.act.startsWith('sc-')) return;
  const act = el.dataset.act, v = el.dataset.v || '';
  const L = scWork();
  if (act === 'sc-add') { if (L.length >= 10) { toast('Maximaal 10 toeslagen.', true); return; } L.push({ name: '', pct: 25, days: [1, 2, 3, 4, 5], hol: false, from: '20:00', to: '00:00', code: '' }); }
  if (act === 'sc-preset') SC_PRESETS.forEach(p => L.push(JSON.parse(JSON.stringify(p))));
  if (act === 'sc-del') L.splice(Number(v), 1);
  if (act === 'sc-day') { const [i, d] = v.split('|').map(Number); const r = L[i]; const ds = (r.days || []).map(Number); r.days = ds.includes(d) ? ds.filter(x => x !== d) : ds.concat([d]).sort(); }
  if (act === 'sc-hol') { const r = L[Number(v)]; r.hol = !r.hol; }
  render();
});
document.getElementById('app').addEventListener('input', e => {
  const el = e.target; if (!el.dataset.sc) return;
  const [i, k] = el.dataset.sc.split('|'); const L = scWork(); if (!L[i]) return;
  L[i][k] = k === 'pct' ? el.value.replace(',', '.') : el.value;
  const card = el.closest('.sc'); const b = card && card.querySelector('.badge.orange');
  if (card && !b) { const s = card.querySelector('strong'); if (s) s.insertAdjacentHTML('afterend', ' <span class="badge orange">Niet opgeslagen</span>'); }
});
