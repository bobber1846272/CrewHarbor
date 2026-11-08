/* CrewHarbor · vergelijkingstabel van de pakketten */
(function () {
  'use strict';
  const CFG = window.CREWDECK_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = c => '€ ' + (c / 100).toLocaleString('nl-NL', { minimumFractionDigits: c % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  if (window.CH_LOGO) { $('logo').innerHTML = window.CH_LOGO(30); $('logo2').innerHTML = window.CH_LOGO(28); }

  let MAX = 150;
  let PLANS = [];
  const EXTRA = [['payroll', 'Salarisexport (Excel, Nmbrs, Loket.nl, AFAS)'], ['phone', 'Koppeling met 3CX-telefonie'], ['locations', 'Meerdere vestigingen']];
  const BASE = ['Rooster, verlof en beschikbaarheid', 'Uren, in- en uitklokken en prikklok', 'Terugbelverzoeken en taken', 'Kennisbank en documenten', 'Meldingen per mail'];
  const SERVICE = [['30 dagen gratis proberen', 'all'], ['Per maand opzegbaar', 'all'], ['Betalen via iDEAL of per factuur', 'all'], ['Prijs en afspraken op maat', 'custom'], ['Persoonlijke hulp bij de start', 'custom']];
  const rangeTxt = p => p.maxMembers ? (p.minMembers > 1 ? p.minMembers + '–' + p.maxMembers : 'tot ' + p.maxMembers) : p.minMembers + '–' + MAX;
  const YES = '<span class="yes" aria-label="zit erin">✓</span>', NO = '<span class="no" aria-label="niet beschikbaar">–</span>';

  function render() {
    const cols = PLANS.concat([{ id: 'maatwerk', name: 'Maatwerk', custom: true }]);
    const td = (p, html) => '<td' + (p.popular ? ' class="pop"' : '') + '>' + html + '</td>';
    const row = (label, f) => '<tr><td>' + esc(label) + '</td>' + cols.map(p => td(p, f(p))).join('') + '</tr>';
    const grp = t => '<tr class="grp"><td colspan="' + (cols.length + 1) + '">' + esc(t) + '</td></tr>';
    const head = '<thead><tr><th><span class="sr-only">Onderdeel</span></th>' + cols.map(p => '<th' + (p.popular ? ' class="pop"' : '') + '><h3>' + esc(p.name) + '</h3>' +
      (p.custom ? '<div class="pr">Op aanvraag</div><div class="rg">meer dan ' + MAX + ' medewerkers</div>'
        : '<div class="pr">' + (p.fixed ? '' : '<small>vanaf </small>') + eur(p.monthCents) + '<small> p.m.</small></div><div class="rg">' + esc(rangeTxt(p)) + ' medewerkers</div>') + '</th>').join('') + '</tr></thead>';
    const body = grp('Prijs') +
      row('Aantal medewerkers', p => p.custom ? 'meer dan ' + MAX : esc(rangeTxt(p))) +
      row('Prijs per maand', p => p.custom ? 'in overleg' : (p.fixed ? '' : 'vanaf ') + eur(p.monthCents)) +
      row('Korting', p => !p.custom && Number(p.discountPct) > 0 ? String(p.discountPct).replace(/\.0+$/, '').replace('.', ',') + '%' : NO) +
      grp('In elk pakket') + BASE.map(b => row(b, () => YES)).join('') +
      grp('Uitbreidingen') + EXTRA.map(([k, l]) => row(l, p => p.custom || (p.features || []).includes(k) ? YES
        : (p.addonCents || {})[k] ? '<span class="add">+' + eur(p.addonCents[k]) + ' p.m.</span>' : NO)).join('') +
      grp('Service') + SERVICE.map(([l, w]) => row(l, p => w === 'all' || p.custom ? YES : NO)).join('') +
      '<tr><td></td>' + cols.map(p => td(p, '<a class="btn ' + (p.popular ? 'primary' : 'outline') + '" href="./?pakket=' + esc(p.id) + '#aanvragen">Kies ' + esc(p.name) + '</a>')).join('') + '</tr>';
    $('cmp').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  const post = (url, body) => fetch(CFG.supabaseUrl + url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey }, body: JSON.stringify(body || {}) }).then(r => r.ok ? r.json() : null).catch(() => null);
  Promise.all([post('/functions/v1/crewdeck', { action: 'plans' }), post('/rest/v1/rpc/cd_public_pricing')]).then(([d, pr]) => {
    if (pr && Number(pr.customFrom) > 0) MAX = Number(pr.customFrom);
    if (d && d.plans && d.plans.length) { PLANS = d.plans; render(); }
    else $('cmp').innerHTML = '<tbody><tr><td>De pakketten konden even niet geladen worden. Probeer het later opnieuw.</td></tr></tbody>';
  });
})();
