/* CrewHarbor · regels en extra's rond het rooster:
   Arbeidstijdenwet-waarschuwingen, feestdagen en de agenda-link (iCal) */
'use strict';

// ---------- feestdagen (zelfde regels als in de database: crewdeck.holidays) ----------
function easterOf(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
}
function holidaysOf(y, st) {
  st = st || ((S.org && S.org.settings) || {}).holidays || {};
  const e = easterOf(y); let kd = y + '-04-27'; if (pd(kd).getDay() === 0) kd = y + '-04-26';
  const bv = st.bevrijdingsdag || 'lustrum';
  return [[y + '-01-01', 'Nieuwjaarsdag'], st.goedevrijdag ? [addDays(e, -2), 'Goede Vrijdag'] : null, [e, 'Eerste Paasdag'], [addDays(e, 1), 'Tweede Paasdag'], [kd, 'Koningsdag'],
    bv === 'altijd' || (bv === 'lustrum' && y % 5 === 0) ? [y + '-05-05', 'Bevrijdingsdag'] : null,
    [addDays(e, 39), 'Hemelvaartsdag'], [addDays(e, 49), 'Eerste Pinksterdag'], [addDays(e, 50), 'Tweede Pinksterdag'], [y + '-12-25', 'Eerste Kerstdag'], [y + '-12-26', 'Tweede Kerstdag']]
    .filter(Boolean).map(x => ({ date: x[0], name: x[1] }));
}
// feestdag op deze datum? (uit het rooster, anders zelf uitrekenen)
function holidayOn(R, d) {
  const L = (R && R.holidays) || holidaysOf(Number(d.slice(0, 4)));
  const h = L.find(x => x.date === d); return h ? h.name : '';
}
function holidayTag(R, d) { const n = holidayOn(R, d); return n ? '<span class="hol-tag" title="Feestdag">🎉 ' + esc(n) + '</span>' : ''; }

// ---------- Arbeidstijdenwet ----------
// Basisregels voor 18+ en voor jongeren van 16 en 17 (is_minor). Een waarschuwing, geen verbod: cao's kunnen afwijken.
const ATW = { adult: { day: 12 * 60, week: 60 * 60, rest: 11 * 60 }, minor: { day: 9 * 60, week: 45 * 60, rest: 12 * 60 } };
const absMin = (base, d, t) => Math.round((pd(d) - pd(base)) / 864e5) * 1440 + toMin(t);
function atwIssues(R, pid, d, start, end, exceptId) {
  const p = R.people.find(x => same(x.id, pid)); if (!p) return [];
  const minor = !!p.isMinor; const L = minor ? ATW.minor : ATW.adult;
  const out = [];
  const a = absMin(R.weekStart || d, d, start); let b = absMin(R.weekStart || d, d, end); if (b <= a) b += 1440;
  const dur = b - a;
  if (dur > L.day) out.push((minor ? 'Jongere: ' : '') + 'dienst van ' + fmtHM(dur) + ' uur, maximaal ' + L.day / 60 + ' uur (Arbeidstijdenwet)');
  const mine = (R.allShifts || R.shifts).filter(s => same(s.memberId, pid) && !same(s.id, exceptId)).map(s => {
    const x = absMin(R.weekStart || d, s.date, s.start); let y = absMin(R.weekStart || d, s.date, s.end); if (y <= x) y += 1440; return [x, y];
  });
  // rust tussen twee diensten (niet als ze op dezelfde dag direct aansluiten of overlappen: dat is een andere waarschuwing)
  const before = mine.filter(([, y]) => y <= a).sort((p1, p2) => p2[1] - p1[1])[0];
  const after = mine.filter(([x]) => x >= b).sort((p1, p2) => p1[0] - p2[0])[0];
  const restTxt = (gap, w) => 'te weinig rust: ' + fmtHM(gap) + ' uur ' + w + ' (minimaal ' + L.rest / 60 + ' uur)';
  if (before && a - before[1] > 0 && a - before[1] < L.rest && a - before[1] >= 60) out.push((minor ? 'Jongere: ' : '') + restTxt(a - before[1], 'na de vorige dienst'));
  if (after && after[0] - b > 0 && after[0] - b < L.rest && after[0] - b >= 60) out.push((minor ? 'Jongere: ' : '') + restTxt(after[0] - b, 'voor de volgende dienst'));
  const week = mine.reduce((t, [x, y]) => t + (y - x), 0) + dur;
  if (week > L.week) out.push((minor ? 'Jongere: ' : '') + fmtHM(week) + ' uur deze week, maximaal ' + L.week / 60 + ' uur (Arbeidstijdenwet)');
  if (minor) {
    const s0 = toMin(start), e0 = s0 + dur;
    if (s0 < 6 * 60 || e0 > 23 * 60) out.push('Jongere: niet werken tussen 23:00 en 06:00');
  }
  return out;
}

// ---------- instellingen: welke feestdagen tellen mee ----------
function holidaysCard() {
  if (!can('org.manage')) return '';
  const st = ((S.org && S.org.settings) || {}).holidays || {};
  const y = new Date().getFullYear();
  const L = holidaysOf(y, st).filter(h => pd(h.date).getDay() !== 0);
  return '<section class="card stack" style="gap:14px"><div><h2 style="margin:0">Feestdagen</h2><p class="small muted" style="margin:4px 0 0">Feestdagen tellen niet als werkdag: ze kosten geen verlofuren en tellen niet mee bij de verwachte uren. In het rooster zie je ze bovenaan de dag.</p></div>' +
    '<label class="check"><input type="checkbox" data-hol="goedevrijdag"' + (st.goedevrijdag ? ' checked' : '') + '> Goede Vrijdag is bij ons een vrije dag</label>' +
    '<div class="field"><label for="hol-bv">Bevrijdingsdag (5 mei)</label><select class="input" id="hol-bv" data-hol="bevrijdingsdag" style="max-width:340px">' +
      [['lustrum', 'Alleen elke 5 jaar (2025, 2030, …)'], ['altijd', 'Elk jaar vrij'], ['nooit', 'Nooit vrij']].map(o => '<option value="' + o[0] + '"' + ((st.bevrijdingsdag || 'lustrum') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
    '<div class="hol-list"><span class="small muted">' + y + ':</span>' + L.map(h => '<span class="hol-chip"><b>' + esc(h.name) + '</b> ' + esc(dayShort(h.date)) + '</span>').join('') + '</div></section>';
}

// ---------- agenda-link ----------
function icsUrl(tok) { return (window.CREWDECK_CONFIG && window.CREWDECK_CONFIG.supabaseUrl ? window.CREWDECK_CONFIG.supabaseUrl : '').replace(/\/$/, '') + '/functions/v1/ics?t=' + tok; }
function icsCard(mobile) {
  const tok = S.icsTok;
  const cls = mobile ? 'm-card ics-card' : 'card ics-card';
  if (!tok) return '<section class="' + cls + '"><div class="ics-top"><span class="ics-ic" aria-hidden="true">📅</span><div><h2>Diensten in je agenda</h2><p class="small muted">Zet je diensten automatisch in Google Agenda, Apple Agenda of Outlook. Wijzigt het rooster, dan past je agenda zich vanzelf aan.</p></div></div>' +
    '<div><button class="btn" data-act="ics-make">Agenda-link maken</button></div></section>';
  const url = icsUrl(tok), web = url.replace(/^https?:/, 'webcal:');
  return '<section class="' + cls + '"><div class="ics-top"><span class="ics-ic" aria-hidden="true">📅</span><div><h2>Diensten in je agenda</h2><p class="small muted">Kies je agenda. Daarna komen je diensten er vanzelf in (de agenda ververst zelf, soms duurt het een paar uur).</p></div></div>' +
    '<div class="ics-btns"><a class="btn small" href="https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(web) + '" target="_blank" rel="noopener">Google Agenda</a>' +
      '<a class="btn small" href="' + esc(web) + '">Apple Agenda / Outlook</a>' +
      '<button class="btn small ghost" data-act="ics-copy">Link kopiëren</button></div>' +
    '<p class="small muted" style="margin:0">Deel deze link niet: wie hem heeft, ziet je diensten. <button class="link-btn small" data-act="ics-reset">Nieuwe link maken</button> (de oude werkt dan niet meer).</p></section>';
}
async function loadIcs() { if (S.icsTok !== undefined) return; try { const r = await rpc('cd_ics_link', { p_reset: null }); S.icsTok = r.token || null; } catch (e) { S.icsTok = null; } }

document.getElementById('app').addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const act = el.dataset.act; if (!act.startsWith('ics-')) return;
  try {
    if (act === 'ics-make' || act === 'ics-reset') {
      if (act === 'ics-reset' && !confirm('Een nieuwe link maken? De oude link werkt dan niet meer; je moet hem opnieuw toevoegen in je agenda.')) return;
      el.disabled = true; const r = await rpc('cd_ics_link', { p_reset: act === 'ics-reset' }); S.icsTok = r.token;
      toast(act === 'ics-reset' ? 'Nieuwe link gemaakt. Voeg hem opnieuw toe in je agenda.' : 'Agenda-link gemaakt. Kies hieronder je agenda.'); render(); return;
    }
    if (act === 'ics-copy') {
      const url = icsUrl(S.icsTok);
      try { await navigator.clipboard.writeText(url); toast('Link gekopieerd. Plak hem in je agenda bij "Agenda toevoegen via URL".'); }
      catch (err) { prompt('Kopieer deze link:', url); }
    }
  } catch (err) { toast(err.message, true); el.disabled = false; }
});
document.getElementById('app').addEventListener('change', async e => {
  const el = e.target; if (!el.dataset.hol) return;
  const st = Object.assign({}, ((S.org && S.org.settings) || {}).holidays || {});
  st[el.dataset.hol] = el.type === 'checkbox' ? el.checked : el.value;
  try {
    const v = await rpc('cd_holidays_save', { p: st });
    S.org.settings = Object.assign({}, S.org.settings, { holidays: v }); toast('Feestdagen opgeslagen.'); render();
  } catch (err) { toast(err.message, true); }
});
