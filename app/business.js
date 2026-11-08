/* CrewHarbor · abonnement, vestigingen, salarisexport, startwizard, CSV-import en meldingen per mail.
 * Hoort bij app.js (gebruikt S, rpc, svc, render, esc, can, toast en de andere hulpjes daaruit).
 * Wordt vóór app.js geladen; alles hieronder wordt pas aangeroepen als app.js klaar is. */
'use strict';

const hasFeature = f => !S.org || !S.org.plan || (S.org.plan.features || []).includes(f);
const eur = c => '€ ' + (Math.round(c || 0) / 100).toFixed(2).replace('.', ',');
const LOCS = () => (S.loc && S.loc.locations) || [];
const locName = id => (LOCS().find(l => same(l.id, id)) || {}).name || '';
const memberLoc = id => (S.loc && S.loc.members && S.loc.members[id]) || null;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FEATURE_LABEL = { payroll: 'Salarisexport', phone: '3CX-telefonie', locations: 'Meerdere vestigingen' };
const STATUS_LABEL = { trial: ['Proefperiode', ''], active: ['Actief', 'green'], past_due: ['Betaling mislukt', 'red'], canceled: ['Opgezegd', 'orange'], free: ['Gratis', 'green'], expired: ['Proefperiode voorbij', 'red'] };
const PAY_LABEL = { paid: 'Betaald', open: 'Open', pending: 'Bezig', failed: 'Mislukt', expired: 'Verlopen', canceled: 'Geannuleerd', authorized: 'Bezig' };

async function loadBusiness() {
  try { S.loc = await rpc('cd_locations'); } catch (e) { S.loc = { enabled: false, locations: [], members: {} }; }
  // meldingen die klaarstaan meteen versturen (hooguit eens per 5 minuten per apparaat)
  if (!S.lastFlush || Date.now() - S.lastFlush > 300000) { S.lastFlush = Date.now(); svc('notify-flush').catch(() => {}); }
}
async function loadBizRoute(r) {
  const jobs = [];
  if (['instellingen', 'mensen', 'rooster', 'prikklok', 'urenoverzicht'].includes(r)) jobs.push(loadBusiness());
  if (r === 'instellingen' && S.me.isOwner) jobs.push(rpc('cd_billing').then(d => { S.billing = d; }).catch(() => { S.billing = null; }));
  if ((r === 'instellingen' && can('org.manage')) || r === 'urenoverzicht') jobs.push(rpc('cd_payroll_info').then(d => { S.payroll = d; }).catch(() => { S.payroll = null; }));
  await Promise.all(jobs);
  if (r === 'instellingen' && /betaling=terug/.test(location.hash)) await billingReturn();
}

// ---------- meldingen per mail: na een wijziging even later versturen ----------
let flushTimer = null;
function scheduleFlush(name) {
  if (!/(save|delete|publish|approve|reject|review|absence|sick|copy|plan|restore|clock)/.test(name)) return;
  clearTimeout(flushTimer);
  // de server bundelt meldingen die binnen 2 minuten komen; daarna versturen
  flushTimer = setTimeout(() => { svc('notify-flush').catch(() => {}); }, 130000);
}

// ======================================================================
// Abonnement
// ======================================================================
function billingBanner() {
  if (!S.me || !S.me.isOwner || !S.org || !S.org.billing) return '';
  const b = S.org.billing;
  const days = b.trialEndsAt ? Math.ceil((new Date(b.trialEndsAt) - Date.now()) / 864e5) : null;
  if (b.status === 'expired') return '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>Je proefperiode is voorbij.</strong> Stel een betaling in om CrewHarbor te blijven gebruiken. <a href="#/instellingen">Naar Abonnement</a></span></div>';
  if (b.status === 'past_due') return '<div class="alert error" role="alert">' + ICON.alert + '<span><strong>De laatste betaling is mislukt.</strong> Controleer je rekening of stel opnieuw een betaling in. <a href="#/instellingen">Naar Abonnement</a></span></div>';
  if (b.status === 'trial' && days != null && days <= 7) return '<div class="alert info"><span>Je proefperiode loopt nog ' + days + ' dag' + (days === 1 ? '' : 'en') + '. <a href="#/instellingen">Stel je abonnement in</a> om daarna gewoon door te gaan.</span></div>';
  return '';
}
const EXTRA_LABEL = { payroll: 'Salarisexport', phone: '3CX-telefonie', locations: 'Meerdere vestigingen' };
function planRange(p) { return p.maxMembers ? ((p.minMembers || 1) > 1 ? p.minMembers + ' tot ' + p.maxMembers : 'tot ' + p.maxMembers) + ' medewerkers' : (p.minMembers || 1) + ' of meer medewerkers'; }
function planPrice(p) { return (p.fixed ? '' : 'vanaf ') + eur(p.monthCents != null ? p.monthCents : p.priceCents) + ' per maand · ' + planRange(p); }
function addonsBlock(B) {
  const pl = B.plan; if (!pl) return '';
  const extra = Object.keys(EXTRA_LABEL).filter(k => !(pl.features || []).includes(k));
  if (!extra.length) return '';
  const on = S.addonSel || B.addons || [];
  const changed = S.addonSel && (S.addonSel.slice().sort().join() !== (B.addons || []).slice().sort().join());
  return '<fieldset class="plan-pick"><legend class="legend">Losse extra\u2019s</legend>' + extra.map(k =>
    '<label class="check"><input type="checkbox" data-biz="addon" value="' + k + '"' + (on.includes(k) ? ' checked' : '') + '> <span><strong>' + EXTRA_LABEL[k] + '</strong> ' +
    '<span class="small muted">+' + eur((pl.addonCents || {})[k] || 0) + ' per maand</span></span></label>').join('') + '</fieldset>' +
    (changed ? '<div><button class="btn dark" data-act="bz-addons">Extra\u2019s opslaan</button></div>' : '');
}
const INV_LABEL = { open: ['Open', 'orange'], vervallen: ['Te laat', 'red'], betaald: ['Betaald', 'green'], geannuleerd: ['Geannuleerd', ''] };
function payMethodBlock(B) {
  const want = S.payMethod || B.methodRequested || B.method || 'mollie';
  const D = Object.assign({}, B.invoiceDetails || {}, S.invEdit || {});
  if (!D.name && !S.invEdit) D.name = S.org.name;
  if (!D.email && !S.invEdit) D.email = S.me.email || '';
  const f = (k, label, ph, half) => '<div class="field"><label for="iv-' + k + '">' + label + '</label><input class="input" id="iv-' + k + '" data-iv="' + k + '" maxlength="120" value="' + esc(D[k] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></div>';
  let h = '<h3 class="card-sub">Betaalwijze</h3>' +
    (B.methodRequested ? '<div class="alert info"><span>Je hebt gevraagd om ' + (B.methodRequested === 'factuur' ? 'per factuur' : 'met automatische incasso') + ' te betalen. CrewHarbor zet dit zo snel mogelijk voor je om.</span></div>' : '') +
    '<div class="seg" role="radiogroup">' + [['mollie', 'Automatische incasso'], ['factuur', 'Per factuur']].map(o => '<button role="radio" aria-checked="' + (want === o[0]) + '" class="' + (want === o[0] ? 'on' : '') + '" data-act="bz-method" data-v="' + o[0] + '">' + o[1] + (B.method === o[0] ? ' ✓' : '') + '</button>').join('') + '</div>';
  if (want === 'factuur') {
    h += '<p class="small muted" style="margin:0">Je krijgt elke maand een factuur met 14 dagen betaaltermijn. Vul de gegevens in die op de factuur moeten komen.</p>' +
      '<div class="fields2">' + f('name', 'Bedrijfsnaam') + f('attn', 'Ter attentie van', 'Optioneel') + '</div>' +
      '<div class="fields2">' + f('address', 'Adres', 'Straat en huisnummer') + f('postcode', 'Postcode') + '</div>' +
      '<div class="fields2">' + f('city', 'Plaats') + f('email', 'E-mailadres voor facturen') + '</div>' +
      '<div class="fields2">' + f('vat', 'Btw-nummer', 'Optioneel') + f('reference', 'Referentie of inkoopnummer', 'Optioneel') + '</div>' +
      '<div><button class="btn dark" data-act="bz-method-save" data-v="factuur">' + (B.method === 'factuur' ? 'Factuurgegevens opslaan' : 'Per factuur betalen aanvragen') + '</button></div>';
  } else if (B.method === 'factuur') {
    h += '<div><button class="btn" data-act="bz-method-save" data-v="mollie">Terug naar automatische incasso</button></div>';
  }
  return h;
}
function billingCard() {
  const B = S.billing;
  if (!B) return '';
  const st = STATUS_LABEL[B.status] || [B.status, ''];
  const incl = Math.round(B.amountCents * (100 + (B.vatPct || 21)) / 100);
  const sel = S.planSel || (B.plan && B.plan.id);
  let h = '<section class="card stack" style="gap:14px" id="abonnement"><div class="item-top"><h2 style="margin:0">Abonnement</h2><span class="badge ' + st[1] + '">' + esc(st[0]) + '</span></div>';
  h += '<dl class="kv"><dt>Pakket</dt><dd>' + esc(B.plan ? B.plan.name : '–') + '</dd><dt>Actieve medewerkers</dt><dd>' + B.members + '</dd>' +
    '<dt>Per maand</dt><dd>' + eur(B.amountCents) + ' <span class="small muted">excl. btw (' + eur(incl) + ' incl.)</span></dd>' +
    (B.status === 'trial' && B.trialEndsAt ? '<dt>Proefperiode tot</dt><dd>' + esc(dayLong(B.trialEndsAt.slice(0, 10))) + '</dd>' : '') + '</dl>';
  if (B.status === 'free') {
    h += '<p class="small muted" style="margin:0">Je gebruikt CrewHarbor zonder kosten, zoals afgesproken met CrewHarbor.</p>';
  }
  h += '<fieldset class="plan-pick"><legend class="legend">Kies je pakket</legend>' + (B.plans || []).map(p => {
    const fits = (!p.maxMembers || B.members <= p.maxMembers) && (!p.maxLocations || (B.locations || 0) <= p.maxLocations || (B.addons || []).includes('locations'));
    return '<label class="plan-opt' + (same(sel, p.id) ? ' on' : '') + (fits ? '' : ' disabled') + '"><input type="radio" name="plan" value="' + esc(p.id) + '" data-biz="plan"' + (same(sel, p.id) ? ' checked' : '') + (fits ? '' : ' disabled') + '>' +
      '<span><strong>' + esc(p.name) + (B.plan && same(B.plan.id, p.id) ? ' <span class="badge">Huidig</span>' : '') + '</strong><small>' + esc(planPrice(p)) + '</small>' +
      '<small class="muted">' + esc((p.highlights || []).slice(0, 3).join(' · ')) + '</small>' + (fits ? '' : '<small style="color:var(--red)">Past niet bij je huidige aantal medewerkers of vestigingen.</small>') + '</span></label>';
  }).join('') + '</fieldset>' + addonsBlock(B);
  const changed = B.plan && sel && !same(sel, B.plan.id);
  const running = B.hasSubscription && B.status === 'active';
  if (B.method === 'factuur') {
    h += (changed ? '<div><button class="btn dark" data-act="bz-plan">Pakket wijzigen</button></div>' : '') +
      '<p class="small muted" style="margin:0">Je betaalt per factuur. Elke maand op de 1e krijg je een factuur per mail, die je ook hieronder kunt downloaden.</p>';
  } else if (running) {
    h += '<div class="row">' + (changed ? '<button class="btn dark" data-act="bz-plan">Overstappen naar ' + esc(((B.plans || []).find(p => same(p.id, sel)) || {}).name || '') + '</button>' : '') +
      '<button class="btn ghost" data-act="bz-cancel">Abonnement opzeggen</button></div>' +
      '<p class="small muted" style="margin:0">Het bedrag wordt elke maand automatisch afgeschreven. Komen er medewerkers bij of gaan ze weg, dan past het bedrag zich aan bij de volgende betaling.</p>';
  } else if (B.status !== 'free') {
    h += '<div class="row"><button class="btn primary" data-act="bz-start">Betaling instellen</button>' + (changed ? '<button class="btn" data-act="bz-plan">Alleen pakket wijzigen</button>' : '') + '</div>' +
      '<p class="small muted" style="margin:0">Je betaalt de eerste maand via iDEAL of creditcard. Daarna schrijven we elke maand automatisch af. Opzeggen kan per maand.</p>';
  } else if (changed) {
    h += '<div><button class="btn" data-act="bz-plan">Pakket wijzigen</button></div>';
  }
  if (B.status !== 'free') h += payMethodBlock(B);
  if (B.invoices && B.invoices.length) {
    h += '<h3 class="card-sub" id="facturen">Facturen</h3><ul class="login-list">' + B.invoices.slice(0, 24).map(i => '<li' + (same(S.invFocus, i.id) ? ' class="focus"' : '') + '><span class="ll-top"><strong>' + esc(i.number) + ' · ' + eur(i.totalCents) + '</strong>' +
      '<span class="badge ' + (INV_LABEL[i.status] || ['', ''])[1] + '">' + esc((INV_LABEL[i.status] || [i.status])[0]) + '</span></span>' +
      '<span class="small muted">' + esc(dayLong(i.periodFrom).replace(/^\w+ /, '')) + ' · te betalen voor ' + esc(dayLong(i.dueOn).replace(/^\w+ /, '')) + '</span>' +
      '<span><button class="btn small" data-act="bz-inv-pdf" data-id="' + i.id + '">' + ICON.download + 'PDF</button></span></li>').join('') + '</ul>';
  }
  if (B.payments && B.payments.length) {
    h += '<h3 class="card-sub">Betalingen</h3><ul class="login-list">' + B.payments.slice(0, 8).map(p => '<li><span class="ll-top"><strong>' + eur(p.amountCents) + '</strong>' +
      '<span class="badge ' + (p.status === 'paid' ? 'green' : ['failed', 'expired', 'canceled'].includes(p.status) ? 'red' : '') + '">' + esc(PAY_LABEL[p.status] || p.status) + '</span></span>' +
      '<span class="small muted">' + esc(fmtDate(p.paidAt || p.createdAt)) + (p.description ? ' · ' + esc(p.description) : '') + '</span></li>').join('') + '</ul>';
  }
  return h + '</section>';
}
async function billingReturn() {
  try { history.replaceState(null, '', location.pathname + location.search + '#/instellingen'); } catch (e) { /* */ }
  try {
    const d = await svc('billing-refresh');
    S.billing = await rpc('cd_billing'); await loadSession();
    const st = d.last && d.last.status;
    if (st === 'paid') toast('Gelukt! Je abonnement is actief.');
    else if (st === 'open' || st === 'pending' || !st) toast('We wachten nog op de bevestiging van de betaling. Dat duurt meestal een minuut.');
    else toast('De betaling is niet gelukt (' + (PAY_LABEL[st] || st).toLowerCase() + '). Probeer het opnieuw.', true);
  } catch (e) { toast(e.message, true); }
}

// ======================================================================
// Vestigingen
// ======================================================================
function locationsCard() {
  if (!can('org.manage')) return '';
  const L = LOCS(), E = S.locEdit;
  const max = S.org.plan && S.org.plan.maxLocations;
  let h = '<section class="card stack" style="gap:14px"><h2>Vestigingen</h2>' +
    '<p class="small muted" style="margin:0">Geef medewerkers, diensten en prikklokken een vestiging. In het rooster, het urenoverzicht en de prikklok kun je dan per vestiging kijken.</p>';
  if (L.length) {
    h += '<ul class="login-list">' + L.map(l => '<li><span class="ll-top"><strong>' + esc(l.name) + '</strong><span class="small muted">' + l.members + ' medewerker' + (l.members === 1 ? '' : 's') + '</span>' +
      '<span style="margin-left:auto;display:flex;gap:6px"><button class="btn small ghost" data-act="loc-edit" data-id="' + l.id + '">' + ICON.edit + 'Wijzigen</button>' +
      '<button class="btn small ghost" data-act="loc-del" data-id="' + l.id + '" aria-label="' + esc(l.name) + ' verwijderen">' + ICON.trash + '</button></span></span>' +
      (l.address ? '<span class="small muted">' + esc(l.address) + '</span>' : '') + '</li>').join('') + '</ul>';
  }
  const full = max && L.length >= max;
  if (E) {
    h += '<div class="box stack" style="gap:10px"><div class="field"><label for="loc-name">Naam</label><input class="input" id="loc-name" maxlength="60" value="' + esc(E.name || '') + '" placeholder="Bijv. Utrecht Centrum"></div>' +
      '<div class="field"><label for="loc-addr">Adres <span class="muted" style="font-weight:400">(optioneel)</span></label><input class="input" id="loc-addr" maxlength="160" value="' + esc(E.address || '') + '"></div>' +
      '<div class="row"><button class="btn dark" data-act="loc-save">Opslaan</button><button class="btn ghost" data-act="loc-cancel">Annuleren</button></div></div>';
  } else if (!full) {
    h += '<div><button class="btn" data-act="loc-new">' + ICON.plus + 'Vestiging toevoegen</button></div>';
  }
  if (full) h += '<p class="small muted" style="margin:0">Met het pakket ' + esc(S.org.plan.name) + ' heb je ' + max + ' vestiging. ' + (S.me.isOwner ? 'Kies het pakket Bedrijf bij Abonnement voor meer vestigingen.' : 'Vraag de eigenaar om het pakket Bedrijf.') + '</p>';
  return h + '</section>';
}
function locSelect(id, value, label, allLabel) {
  const L = LOCS(); if (!L.length) return '';
  return '<div class="field"><label for="' + id + '">' + (label || 'Vestiging') + '</label><select class="input" id="' + id + '">' +
    '<option value="">' + esc(allLabel || 'Geen vaste vestiging') + '</option>' + L.map(l => '<option value="' + l.id + '"' + (same(value, l.id) ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select></div>';
}
function locFilterSelect() {
  const L = LOCS(); if (L.length < 2) return '';
  return '<label class="sr-only" for="loc-filter">Vestiging</label><select class="input loc-filter" id="loc-filter" style="max-width:220px"><option value="">Alle vestigingen</option>' +
    L.map(l => '<option value="' + l.id + '"' + (same(S.locFilter, l.id) ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>';
}
// rooster: alleen deze vestiging (diensten daar, en mensen die er horen of er een dienst hebben)
function rosterFiltered(R) {
  if (!R || !S.locFilter || !LOCS().some(l => same(l.id, S.locFilter))) return R;
  const shifts = R.shifts.filter(s => same(s.locationId, S.locFilter));
  const ids = new Set(shifts.map(s => String(s.memberId)));
  const people = R.people.filter(p => ids.has(String(p.id)) || same(memberLoc(p.id), S.locFilter) || (!memberLoc(p.id) && R.canPlan));
  return Object.assign({}, R, { shifts, people });
}
function shiftLocField(E) {
  if (!LOCS().length) return '';
  return '<div class="field"><label for="sh-loc">Vestiging</label><select class="input" id="sh-loc" data-sh="locationId"><option value="">Geen</option>' +
    LOCS().map(l => '<option value="' + l.id + '"' + (same(E.locationId, l.id) ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select></div>';
}
function kioskLocField() { return locSelect('kiosk-loc', S.locFilter, 'Vestiging van dit apparaat', 'Alle vestigingen'); }

// ======================================================================
// Medewerkers: vestiging en personeelsnummer
// ======================================================================
function memberBizFields(u) {
  u = u || {};
  return '<div class="fields2">' + locSelect('m-loc', u.locationId) +
    '<div class="field"><label for="m-pno">Personeelsnummer <span class="muted" style="font-weight:400">(voor de salarisadministratie)</span></label><input class="input" id="m-pno" maxlength="20" value="' + esc(u.personnelNo || '') + '" autocomplete="off"></div></div>';
}
async function saveMemberBiz(id, isNew) {
  const loc = document.getElementById('m-loc'), pno = document.getElementById('m-pno');
  if (!loc && !pno) return;
  const u = (S.members || []).find(x => same(x.id, id)) || {};
  const p = {};
  if (loc && (isNew ? loc.value : (loc.value || null) !== (u.locationId || null))) p.locationId = loc.value;
  if (pno && (isNew ? pno.value.trim() : pno.value.trim() !== (u.personnelNo || ''))) p.personnelNo = pno.value.trim();
  if (Object.keys(p).length) { await rpc('cd_member_extra', { p_id: id, p }); await loadBusiness(); }
}

// ======================================================================
// Meldingen per mail (eigen voorkeuren)
// ======================================================================
function mailPrefsCard() {
  const P = (S.me && S.me.mailPrefs) || {};
  const opts = [['rooster', 'Rooster', 'Nieuw rooster, en diensten die erbij komen, veranderen of vervallen'], ['verlof', 'Verlof en ziekte', 'Aanvragen, goedkeuringen en ziekmeldingen']];
  if (S.me.isOwner) opts.push(['abonnement', 'Abonnement', 'Als een betaling niet lukt']);
  return '<section class="card stack" style="gap:12px"><h2>Meldingen per mail</h2>' +
    (S.me.legacy ? '<p class="small muted" style="margin:0">Koppel eerst je e-mailadres bij Mijn account.</p>' : '<p class="small muted" style="margin:0">Naar ' + esc(S.me.email || '') + '. Meldingen die snel na elkaar komen, krijg je in één mail. Over terugbelverzoeken en taken krijg je geen mail.</p>') +
    opts.map(o => '<label class="check"><input type="checkbox" data-biz="mailpref" data-k="' + o[0] + '"' + (P[o[0]] === false ? '' : ' checked') + (S.me.legacy ? ' disabled' : '') + '> <span><strong>' + o[1] + '</strong><br><span class="small muted">' + o[2] + '</span></span></label>').join('') +
    '<p class="small muted" style="margin:0">Belangrijke berichten over je account (zoals een reset van je tweestapsverificatie) krijg je altijd.</p></section>';
}

// ======================================================================
// Salarisadministratie
// ======================================================================
const PAY_FORMATS = [
  ['csv', 'Algemeen (CSV)', 'Voor elke loonadministrateur of boekhouder; opent in Excel.'],
  ['xlsx', 'Excel (.xlsx)', 'Met een tweede blad met alle goedgekeurde diensten.'],
  ['loket', 'Loket.nl', 'Import variabele gegevens: aansluitnummer, personeelsnummer, ploeg en een kolom per looncomponent.'],
  ['nmbrs', 'Nmbrs', 'Looncomponenten per medewerker. Neem de regels over in het Nmbrs-importbestand (tabblad Wage Components Var).'],
  ['afas', 'AFAS', 'Variabele loonmutaties per medewerker en looncomponent.']
];
function payrollSettingsCard() {
  if (!can('org.manage')) return '';
  if (!hasFeature('payroll')) return '<section class="card stack" style="gap:10px"><h2>Salarisadministratie</h2><p class="small muted" style="margin:0">Uren exporteren naar Excel, Nmbrs, Loket.nl of AFAS zit in de pakketten Team en Bedrijf.' + (S.me.isOwner ? ' Je wisselt van pakket bij Abonnement.' : '') + '</p></section>';
  const P = (S.payroll && S.payroll.settings) || {};
  const f = (id, k, label, hint, ph) => '<div class="field"><label for="' + id + '">' + label + '</label><input class="input" id="' + id + '" data-pk="' + k + '" maxlength="30" value="' + esc(P[k] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>' + (hint ? '<span class="small muted">' + hint + '</span>' : '') + '</div>';
  return '<section class="card stack" style="gap:14px"><h2>Salarisadministratie</h2>' +
    '<p class="small muted" style="margin:0">De codes krijg je van je salarisadministratie. Geef medewerkers een personeelsnummer bij Mensen.</p>' +
    '<div class="field"><label for="py-format">Standaard exportformaat</label><select class="input" id="py-format" data-pk="format">' + PAY_FORMATS.map(x => '<option value="' + x[0] + '"' + ((P.format || 'csv') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select></div>' +
    '<div class="fields2">' + f('py-emp', 'employerNo', 'Aansluitnummer (Loket.nl)', '', 'Bijv. 395') + f('py-team', 'team', 'Ploeg (Loket.nl)', '', '1') + '</div>' +
    '<div class="fields2">' + f('py-cw', 'codeWorked', 'Looncomponent gewerkte uren', '', 'Bijv. 2') + f('py-cl', 'codeLeave', 'Looncomponent verlofuren', 'Leeg laten om niet mee te sturen.') + '</div>' +
    '<div class="fields2">' + f('py-cs', 'codeSick', 'Looncomponent ziekte-uren', 'Leeg laten om niet mee te sturen.') + f('py-cb', 'codeBought', 'Looncomponent gekocht verlof (inhouding)', 'Leeg laten om niet mee te sturen.') + '</div>' +
    '<div class="fields2">' + f('py-cu', 'codeUnpaid', 'Looncomponent onbetaald verlof', 'Leeg laten om niet mee te sturen.') + '</div>' +
    '<div><button class="btn dark" data-act="py-save">Opslaan</button></div></section>';
}
// urenoverzicht: per vestiging
function reportFiltered(R) {
  if (!R || !S.locFilter || !S.payroll) return R;
  const M = S.payroll.members || {};
  const inLoc = id => same((M[id] || {}).locationId, S.locFilter);
  const people = R.people.filter(p => inLoc(p.id));
  const ids = new Set(people.map(p => String(p.id)));
  return Object.assign({}, R, { people, entries: (R.entries || []).filter(e => ids.has(String(e.memberId))), absences: (R.absences || []).filter(a => ids.has(String(a.memberId))) });
}
function payrollButton(R) {
  if (!hasFeature('payroll')) return '';
  return '<button class="btn primary" data-act="py-open"' + (R && R.people.length ? '' : ' disabled') + '>' + ICON.download + 'Salarisexport</button>';
}
function payrollPanel(R) {
  if (!S.payOpen || !R) return '';
  const P = (S.payroll && S.payroll.settings) || {};
  const fmt = S.payFmt || P.format || 'csv';
  const waiting = R.people.reduce((a, p) => a + (p.submittedMin || 0) + (p.conceptMin || 0), 0);
  const noNo = R.people.filter(p => !((S.payroll.members || {})[p.id] || {}).personnelNo);
  const needCodes = ['loket', 'nmbrs', 'afas'].includes(fmt);
  let h = '<section class="card stack" style="gap:14px;max-width:none"><div class="item-top"><h2 style="margin:0">Salarisexport</h2><button class="btn small ghost" data-act="py-close">Sluiten</button></div>' +
    '<p class="small muted" style="margin:0">' + esc(dayShort(R.from)) + ' t/m ' + esc(dayShort(R.to)) + (S.locFilter ? ' · ' + esc(locName(S.locFilter)) : '') + ' · ' + R.people.length + ' medewerkers. Alleen goedgekeurde uren gaan mee.</p>' +
    '<fieldset class="plan-pick"><legend class="legend">Formaat</legend>' + PAY_FORMATS.map(x => '<label class="plan-opt' + (fmt === x[0] ? ' on' : '') + '"><input type="radio" name="pyfmt" value="' + x[0] + '" data-biz="pyfmt"' + (fmt === x[0] ? ' checked' : '') + '><span><strong>' + x[1] + '</strong><small class="muted">' + x[2] + '</small></span></label>').join('') + '</fieldset>';
  if (waiting) h += '<div class="alert warn">' + ICON.warn + '<span>Er staat nog ' + fmtHM(waiting) + ' uur die niet is goedgekeurd. Die gaat niet mee. <a href="#/goedkeuren">Naar Goedkeuren</a></span></div>';
  if (needCodes && !P.codeWorked) h += '<div class="alert warn">' + ICON.warn + '<span>Vul eerst de looncomponent voor gewerkte uren in bij <a href="#/instellingen">Instellingen → Salarisadministratie</a>.</span></div>';
  if (fmt === 'loket' && !P.employerNo) h += '<div class="alert warn">' + ICON.warn + '<span>Vul eerst het aansluitnummer voor Loket.nl in bij <a href="#/instellingen">Instellingen → Salarisadministratie</a>.</span></div>';
  if (needCodes && noNo.length) h += '<div class="alert warn">' + ICON.warn + '<span>Nog geen personeelsnummer: ' + noNo.slice(0, 6).map(p => esc(p.name)).join(', ') + (noNo.length > 6 ? ' en ' + (noNo.length - 6) + ' anderen' : '') + '. Vul het in bij Mensen; zonder nummer gaan ze niet mee.</span></div>';
  if (['nmbrs', 'afas'].includes(fmt)) h += '<p class="small muted" style="margin:0">Controleer bij de eerste keer samen met je salarisadministratie of de kolommen goed overkomen.</p>';
  return h + '<div><button class="btn primary" data-act="py-go">' + ICON.download + 'Downloaden</button></div></section>';
}
function payrollRows(R) {
  const M = (S.payroll && S.payroll.members) || {};
  return R.people.map(p => {
    const perDay = Number(p.contractHours) > 0 ? Number(p.contractHours) / 5 : 0;
    return { id: p.id, no: (M[p.id] || {}).personnelNo || '', name: p.name, loc: locName((M[p.id] || {}).locationId), contract: Number(p.contractHours) || 0,
      worked: (p.approvedMin || 0) / 60, leaveDays: p.leaveDays || 0, leaveH: (p.leaveDays || 0) * perDay, sickDays: p.sickDays || 0, sickH: (p.sickDays || 0) * perDay, boughtH: Number(p.boughtH) || 0, unpaidH: Number(p.unpaidH) || 0 };
  }).filter(r => r.worked || r.leaveDays || r.sickDays || r.boughtH || r.unpaidH);
}
const nl2 = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
function csvLine(cells, sep) {
  sep = sep || ';';
  return cells.map(v => { const s = String(v == null ? '' : v); return s.includes(sep) || /["\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(sep);
}
function saveFile(name, content, mime, bom) {
  if (APP && APP.saveText && typeof content === 'string') {
    const where = APP.saveText(name, (bom ? '﻿' : '') + content, mime);
    toast(where ? 'Opgeslagen in ' + where : 'Opslaan is niet gelukt.', !where); return;
  }
  const blob = content instanceof Blob ? content : new Blob([(bom ? '﻿' : '') + content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  toast('Download gestart: ' + name);
}
function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Laden mislukt. Controleer je verbinding.')); document.head.appendChild(s); });
}
async function payrollExport(R) {
  const P = (S.payroll && S.payroll.settings) || {};
  const fmt = S.payFmt || P.format || 'csv';
  const rows = payrollRows(R);
  if (!rows.length) throw new Error('Er zijn in deze periode geen goedgekeurde uren, verlof of ziekte.');
  const base = 'salaris-' + R.from + '-tm-' + R.to + (S.locFilter ? '-' + locName(S.locFilter).toLowerCase().replace(/[^a-z0-9]+/g, '-') : '');
  const head = ['Personeelsnummer', 'Naam', 'Vestiging', 'Contract (uur/week)', 'Gewerkt (uren)', 'Verlof (dagen)', 'Verlof (uren)', 'Ziek (dagen)', 'Ziek (uren)', 'Verlof gekocht (uren, inhouden)', 'Onbetaald verlof (uren)', 'Van', 'Tot en met'];
  if (fmt === 'csv') {
    const lines = [csvLine(head)].concat(rows.map(r => csvLine([r.no, r.name, r.loc, nl2(r.contract), nl2(r.worked), r.leaveDays, nl2(r.leaveH), r.sickDays, nl2(r.sickH), nl2(r.boughtH), nl2(r.unpaidH), R.from, R.to])));
    return saveFile(base + '.csv', lines.join('\r\n'), 'text/csv', true);
  }
  if (fmt === 'xlsx') {
    if (!window.XLSX) await loadScript('vendor/xlsx.mini.min.js');
    const n = v => Math.round(v * 100) / 100;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(rows.map(r => [r.no, r.name, r.loc, n(r.contract), n(r.worked), r.leaveDays, n(r.leaveH), r.sickDays, n(r.sickH), n(r.boughtH), n(r.unpaidH), R.from, R.to]))), 'Salaris');
    const ids = new Set(rows.map(r => String(r.id)));
    const ent = (R.entries || []).filter(e => e.status === 'goedgekeurd' && ids.has(String(e.memberId)));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Naam', 'Datum', 'Begin', 'Eind', 'Pauze (min)', 'Uren', 'Notitie']].concat(ent.map(e => [e.memberName, e.date, e.start, e.end, e.breakMin, n((e.minutes || 0) / 60), e.note || '']))), 'Diensten');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: APP && APP.saveBase64 ? 'base64' : 'array' });
    if (APP && APP.saveBase64) { const where = APP.saveBase64(base + '.xlsx', out, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast(where ? 'Opgeslagen in ' + where : 'Opslaan is niet gelukt.', !where); return; }
    return saveFile(base + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  if (!P.codeWorked) throw new Error('Vul eerst de looncomponent voor gewerkte uren in bij Instellingen → Salarisadministratie.');
  const withNo = rows.filter(r => r.no);
  if (!withNo.length) throw new Error('Niemand heeft nog een personeelsnummer. Vul die eerst in bij Mensen.');
  const comps = [[P.codeWorked, 'worked', 'Gewerkte uren'], [P.codeLeave, 'leaveH', 'Verlofuren'], [P.codeSick, 'sickH', 'Ziekte-uren'], [P.codeBought, 'boughtH', 'Gekocht verlof'], [P.codeUnpaid, 'unpaidH', 'Onbetaald verlof']].filter(c => c[0]);
  if (fmt === 'loket') {
    if (!P.employerNo) throw new Error('Vul eerst het aansluitnummer voor Loket.nl in bij Instellingen → Salarisadministratie.');
    const lines = [['aanslnr', 'persnr', 'ploeg'].concat(comps.map(c => c[0])).join(';')]
      .concat(withNo.map(r => [P.employerNo, r.no, P.team || '1'].concat(comps.map(c => r[c[1]] ? nl2(r[c[1]]) : '')).join(';')));
    return saveFile('loket-' + base + '.csv', lines.join('\r\n') + '\r\n', 'text/csv', false);
  }
  const long = [];
  withNo.forEach(r => comps.forEach(c => { if (r[c[1]]) long.push([r, c]); }));
  if (fmt === 'nmbrs') {
    const lines = [csvLine(['Werknemernummer', 'Naam', 'Looncomponent', 'Omschrijving', 'Waarde', 'Periode van', 'Periode tot'])]
      .concat(long.map(([r, c]) => csvLine([r.no, r.name, c[0], c[2], nl2(r[c[1]]), R.from, R.to])));
    return saveFile('nmbrs-' + base + '.csv', lines.join('\r\n'), 'text/csv', true);
  }
  if (fmt === 'afas') {
    const lines = [csvLine(['Medewerker', 'Naam', 'Looncomponent', 'Waarde', 'Datum', 'Omschrijving'])]
      .concat(long.map(([r, c]) => csvLine([r.no, r.name, c[0], nl2(r[c[1]]), R.to, c[2] + ' ' + R.from + ' t/m ' + R.to])));
    return saveFile('afas-' + base + '.csv', lines.join('\r\n'), 'text/csv', true);
  }
}

// ======================================================================
// CSV-import van medewerkers
// ======================================================================
function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ((first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
const IMP_COLS = { name: /^(naam|name|volledige naam|medewerker)$/, email: /^(e-?mail(adres)?|mail)$/, role: /^(rol|role|functie)$/,
  hours: /^(contract(uren)?|uren( per week)?|uur per week|contracturen per week)$/, no: /^(personeelsnummer|personeelsnr|persnr|nummer|werknemernummer)$/, loc: /^(vestiging|locatie|location)$/ };
function importRows(raw) {
  if (!raw.length) return { error: 'Het bestand is leeg.' };
  const head = raw[0].map(h => String(h).trim().toLowerCase());
  const col = {}; Object.keys(IMP_COLS).forEach(k => { col[k] = head.findIndex(h => IMP_COLS[k].test(h)); });
  if (col.name < 0 || col.email < 0) return { error: 'Het bestand heeft geen kolommen "Naam" en "E-mailadres". Gebruik het voorbeeldbestand.' };
  const roles = ((S.roles && S.roles.roles) || []).filter(r => !r.isOwner && r.canAssign);
  const defRole = roles.find(r => /^medewerker$/i.test(r.name)) || roles[roles.length - 1];
  const known = new Set((S.members || []).map(m => String(m.email || '').toLowerCase()).filter(Boolean));
  const knownNames = new Set((S.members || []).map(m => m.name.toLowerCase()));
  const seen = new Set(), seenNames = new Set();
  const rows = raw.slice(1, 501).map((r, i) => {
    const g = k => col[k] >= 0 ? String(r[col[k]] || '').trim() : '';
    const x = { line: i + 2, name: g('name'), email: g('email').toLowerCase(), roleName: g('role'), hours: g('hours').replace(',', '.'), no: g('no'), locName: g('loc'), problems: [] };
    const role = x.roleName ? roles.find(rr => rr.name.toLowerCase() === x.roleName.toLowerCase()) : defRole;
    x.roleId = role ? role.id : null; x.roleLabel = role ? role.name : '';
    if (x.name.length < 2) x.problems.push('naam ontbreekt');
    else if (knownNames.has(x.name.toLowerCase()) || seenNames.has(x.name.toLowerCase())) x.problems.push('naam bestaat al');
    if (!EMAIL_RE.test(x.email)) x.problems.push('ongeldig e-mailadres');
    else if (known.has(x.email) || seen.has(x.email)) x.problems.push('e-mailadres bestaat al');
    if (x.roleName && !role) x.problems.push('rol "' + x.roleName + '" onbekend');
    if (x.hours && !(Number(x.hours) >= 0 && Number(x.hours) <= 80)) x.problems.push('contracturen 0 tot 80');
    if (x.locName) { const l = LOCS().find(l2 => l2.name.toLowerCase() === x.locName.toLowerCase()); if (l) x.locId = l.id; else x.problems.push('vestiging "' + x.locName + '" onbekend'); }
    seen.add(x.email); seenNames.add(x.name.toLowerCase());
    return x;
  });
  return { rows };
}
function importPanel() {
  const I = S.imp; if (!I) return '';
  let h = '<section class="card stack" style="gap:14px;max-width:none"><div class="item-top"><h2 style="margin:0">Medewerkers importeren</h2>' + (I.busy ? '' : '<button class="btn small ghost" data-act="imp-close">Sluiten</button>') + '</div>';
  if (I.done) {
    const ok = I.done.filter(d => d.ok), links = I.done.filter(d => d.ok && d.link), bad = I.done.filter(d => !d.ok);
    h += '<div class="alert ' + (bad.length ? 'warn' : 'ok') + '">' + (bad.length ? ICON.warn : ICON.check) + '<span>' + ok.length + ' medewerker' + (ok.length === 1 ? '' : 's') + ' toegevoegd' + (bad.length ? ', ' + bad.length + ' niet gelukt' : '') + '.</span></div>';
    if (links.length) h += '<p class="small" style="margin:0">De uitnodigingsmail is niet verstuurd (' + esc(links[0].why || 'mail niet ingesteld') + '). Stuur deze links zelf door; ze werken 7 dagen:</p>' +
      '<textarea class="input" rows="' + Math.min(10, links.length + 1) + '" readonly style="font-family:ui-monospace,monospace;font-size:12px">' + esc(links.map(d => d.name + ': ' + d.link).join('\n')) + '</textarea>';
    if (bad.length) h += '<ul class="login-list">' + bad.map(d => '<li><strong>' + esc(d.name) + '</strong><span class="small" style="color:var(--red)">' + esc(d.error) + '</span></li>').join('') + '</ul>';
    return h + '</section>';
  }
  if (I.busy) return h + '<p style="margin:0">Bezig met ' + I.busy.at + ' van ' + I.busy.total + '…</p><div class="progress"><span style="width:' + Math.round(I.busy.at / I.busy.total * 100) + '%"></span></div></section>';
  h += '<p class="small muted" style="margin:0">Een CSV-bestand (bijv. uit Excel: Opslaan als → CSV) met de kolommen <strong>Naam</strong> en <strong>E-mailadres</strong>, en eventueel Rol, Contracturen, Personeelsnummer en Vestiging. Iedereen krijgt een uitnodiging per mail.</p>' +
    '<div class="row"><label class="btn" for="imp-file">' + ICON.upload + 'Bestand kiezen</label><input type="file" id="imp-file" accept=".csv,.txt,text/csv" class="sr-only">' +
    '<button class="btn ghost" data-act="imp-template">' + ICON.download + 'Voorbeeldbestand</button></div>';
  if (I.error) h += '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(I.error) + '</span></div>';
  if (I.rows) {
    const good = I.rows.filter(r => !r.problems.length);
    h += '<div class="table-wrap"><table class="small-table"><thead><tr><th>Regel</th><th>Naam</th><th>E-mailadres</th><th>Rol</th><th>Uren</th><th>Nr.</th>' + (LOCS().length ? '<th>Vestiging</th>' : '') + '<th></th></tr></thead><tbody>' +
      I.rows.map(r => '<tr><td>' + r.line + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.email) + '</td><td>' + esc(r.roleLabel) + '</td><td>' + esc(r.hours) + '</td><td>' + esc(r.no) + '</td>' +
        (LOCS().length ? '<td>' + esc(r.locName) + '</td>' : '') + '<td>' + (r.problems.length ? '<span class="badge red">' + esc(r.problems.join(', ')) + '</span>' : '<span class="badge green">Goed</span>') + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="row"><button class="btn primary" data-act="imp-go"' + (good.length ? '' : ' disabled') + '>' + good.length + ' medewerker' + (good.length === 1 ? '' : 's') + ' toevoegen en uitnodigen</button>' +
      (good.length < I.rows.length ? '<span class="small muted">Regels met een probleem worden overgeslagen.</span>' : '') + '</div>';
  }
  return h + '</section>';
}
async function runImport(rows) {
  const done = [];
  S.imp.busy = { at: 0, total: rows.length }; render();
  for (const r of rows) {
    S.imp.busy.at++; render();
    try {
      const d = await svc('member-create', { name: r.name, email: r.email, roleId: r.roleId });
      const id = d.member.id;
      const extra = {};
      if (r.no) extra.personnelNo = r.no;
      if (r.locId) extra.locationId = r.locId;
      if (Object.keys(extra).length) await rpc('cd_member_extra', { p_id: id, p: extra });
      if (r.hours !== '') await rpc('cd_member_contract', { p_id: id, p_type: Number(r.hours) > 0 ? 'vast' : 'flex', p_hours: Number(r.hours) || 0 });
      done.push({ ok: true, name: r.name, link: d.mailed ? null : d.link, why: d.mailError });
    } catch (e) { done.push({ ok: false, name: r.name, error: e.message }); }
  }
  S.imp = { done };
}

// ======================================================================
// Startwizard voor een nieuw bedrijf
// ======================================================================
function needWizard() { return !!(S.me && S.me.isOwner && S.org && S.org.settings && S.org.settings.setupDone !== true && !APP); }
const WIZ_STEPS = ['Welkom', 'Vestigingen', 'Team', 'Klaar'];
function viewWizard() {
  const W = S.wiz || (S.wiz = { step: 0, rows: [{ name: '', email: '' }, { name: '', email: '' }, { name: '', email: '' }] });
  const step = W.step;
  let body = '';
  if (step === 0) {
    const b = S.org.billing || {};
    body = '<h1>Welkom bij CrewHarbor, ' + esc(S.me.name.split(' ')[0]) + '</h1>' +
      '<p class="lead">In drie korte stappen zet je ' + esc(S.org.name) + ' klaar. Alles kun je later nog aanpassen.</p>' +
      '<div class="field"><label for="wz-name">Bedrijfsnaam</label><input class="input" id="wz-name" maxlength="80" value="' + esc(S.org.name) + '"></div>' +
      (S.org.plan ? '<div class="box"><strong>Pakket ' + esc(S.org.plan.name) + '</strong>' + (b.status === 'trial' && b.trialEndsAt ? '<span class="small muted"> · gratis proberen tot ' + esc(dayLong(b.trialEndsAt.slice(0, 10)).toLowerCase()) + '</span>' : '') +
        '<p class="small muted" style="margin:4px 0 0">Je kiest of wisselt je pakket later bij Instellingen → Abonnement.</p></div>' : '');
  } else if (step === 1) {
    const multi = hasFeature('locations');
    body = '<h1>Vestigingen</h1><p class="lead">' + (multi ? 'Werk je op meerdere plekken? Voeg ze hier toe. Dan heeft elke vestiging een eigen rooster en prikklok.' : 'Heb je één vestiging? Dan kun je deze stap overslaan.') + '</p>' +
      (LOCS().length ? '<ul class="login-list">' + LOCS().map(l => '<li><span class="ll-top"><strong>' + esc(l.name) + '</strong></span></li>').join('') + '</ul>' : '') +
      (multi || !LOCS().length ? '<div class="row" style="align-items:flex-end"><div class="field" style="flex:1 1 220px"><label for="wz-loc">Naam van de vestiging</label><input class="input" id="wz-loc" maxlength="60" placeholder="Bijv. Utrecht Centrum"></div>' +
        '<button class="btn" data-act="wz-loc">' + ICON.plus + 'Toevoegen</button></div>' : '') +
      (!multi ? '<p class="small muted" style="margin:0">Meerdere vestigingen zitten in het pakket Bedrijf.</p>' : '');
  } else if (step === 2) {
    const roles = ((S.roles && S.roles.roles) || []).filter(r => !r.isOwner && r.canAssign);
    const def = (roles.find(r => /^medewerker$/i.test(r.name)) || roles[roles.length - 1] || {}).id;
    body = '<h1>Je team</h1><p class="lead">Vul in wie er met CrewHarbor gaat werken. Iedereen krijgt een uitnodiging per mail en kiest zelf een wachtwoord.</p>' +
      '<div class="wiz-rows">' + W.rows.map((r, i) => '<div class="wiz-row"><div class="field"><label for="wz-n' + i + '">Naam</label><input class="input" id="wz-n' + i + '" data-wz="' + i + '" data-k="name" value="' + esc(r.name) + '" autocomplete="off"></div>' +
        '<div class="field"><label for="wz-e' + i + '">E-mailadres</label><input class="input" id="wz-e' + i + '" type="email" data-wz="' + i + '" data-k="email" value="' + esc(r.email) + '" autocapitalize="none" spellcheck="false" autocomplete="off"></div>' +
        '<div class="field"><label for="wz-r' + i + '">Rol</label><select class="input" id="wz-r' + i + '" data-wz="' + i + '" data-k="roleId">' + roles.map(ro => '<option value="' + ro.id + '"' + (same(r.roleId || def, ro.id) ? ' selected' : '') + '>' + esc(ro.name) + '</option>').join('') + '</select></div></div>').join('') + '</div>' +
      '<div class="row"><button class="btn ghost" data-act="wz-addrow">' + ICON.plus + 'Nog iemand</button><button class="btn ghost" data-act="wz-csv">' + ICON.upload + 'Liever een bestand importeren</button></div>' +
      (S.imp ? importPanel() : '') +
      (W.result ? '<div class="alert ' + (W.result.bad ? 'warn' : 'ok') + '">' + (W.result.bad ? ICON.warn : ICON.check) + '<span>' + esc(W.result.text) + '</span></div>' : '');
  } else {
    body = '<h1>Klaar om te beginnen</h1><p class="lead">' + esc(S.org.name) + ' staat klaar. Een paar dingen die je hierna kunt doen:</p>' +
      '<ul class="feature-list wiz-tips">' + [['rooster', 'Maak het rooster van deze week en zet het vast; iedereen krijgt dan een melding.'], ['prikklok', 'Zet een tablet bij de ingang als prikklok.'],
        ['instellingen', 'Stel bij Instellingen je abonnement en de salarisadministratie in.'], ['mensen', 'Bekijk bij Mensen wie de uitnodiging al heeft geaccepteerd.']]
        .map(t => '<li>' + ICON.tick + '<span>' + t[1] + '</span></li>').join('') + '</ul>';
  }
  const dots = '<ol class="wiz-steps">' + WIZ_STEPS.map((s, i) => '<li class="' + (i === step ? 'on' : i < step ? 'done' : '') + '"' + (i === step ? ' aria-current="step"' : '') + '><span>' + (i + 1) + '</span>' + s + '</li>').join('') + '</ol>';
  const foot = '<div class="wiz-foot">' + (step > 0 && step < 3 ? '<button class="btn ghost" data-act="wz-back">Terug</button>' : '<span></span>') +
    (step < 3 ? '<span style="display:flex;gap:8px;align-items:center">' + (step > 0 ? '<button class="linkbtn" data-act="wz-skip">Overslaan</button>' : '') + '<button class="btn primary" data-act="wz-next">' + (step === 2 ? 'Uitnodigen en verder' : 'Volgende') + '</button></span>'
      : '<button class="btn primary" data-act="wz-done">Naar CrewHarbor</button>') + '</div>';
  return '<div class="wiz"><header class="wiz-top">' + LOGO(28) + '<button class="linkbtn" data-act="wz-later">Later inrichten</button></header>' +
    '<main class="wiz-main" id="main">' + dots + '<section class="card wiz-card">' + body + foot + '</section></main></div>';
}
async function wizardNext() {
  const W = S.wiz;
  if (W.step === 0) {
    const name = document.getElementById('wz-name').value.trim();
    if (name.length < 2) throw new Error('Vul een bedrijfsnaam in.');
    if (name !== S.org.name) { await rpc('cd_org_update', { p: { name } }); await loadSession(); }
    if (!S.roles) S.roles = await rpc('cd_roles');
    if (!S.members) S.members = await rpc('cd_members');
  } else if (W.step === 2) {
    const todo = W.rows.filter(r => r.name.trim() || r.email.trim());
    for (const r of todo) {
      if (r.name.trim().length < 2) throw new Error('Vul bij ' + (r.email || 'iedere regel') + ' een naam in.');
      if (!EMAIL_RE.test(r.email.trim())) throw new Error('Het e-mailadres van ' + r.name + ' klopt niet.');
    }
    const roles = ((S.roles && S.roles.roles) || []).filter(r => !r.isOwner && r.canAssign);
    const def = (roles.find(r => /^medewerker$/i.test(r.name)) || roles[roles.length - 1] || {}).id;
    let ok = 0, links = []; const bad = [];
    for (const r of todo) {
      try {
        const d = await svc('member-create', { name: r.name.trim(), email: r.email.trim().toLowerCase(), roleId: r.roleId || def });
        ok++; if (!d.mailed && d.link) links.push(r.name.trim() + ': ' + d.link);
      } catch (e) { bad.push(r.name + ' (' + e.message + ')'); }
    }
    W.rows = W.rows.filter((r, i) => bad.some(b => b.startsWith(r.name + ' (')) ? true : false);
    if (!W.rows.length) W.rows = [{ name: '', email: '' }];
    if (bad.length) { W.result = { bad: true, text: (ok ? ok + ' uitgenodigd. ' : '') + 'Niet gelukt: ' + bad.join(', ') + '.' }; render(); return; }
    if (links.length) W.links = links;
  }
  W.step = Math.min(3, W.step + 1); W.result = null; render(); window.scrollTo(0, 0);
}

// ======================================================================
// Klikken en invoer
// ======================================================================
document.getElementById('app').addEventListener('click', async e => {
  const el = e.target.closest('[data-act^="bz-"],[data-act^="loc-"],[data-act^="py-"],[data-act^="imp-"],[data-act^="wz-"]');
  if (!el || el.disabled) return;
  e.stopPropagation();
  const act = el.dataset.act, id = el.dataset.id;
  try {
    switch (act) {
      // abonnement
      case 'bz-start': {
        el.disabled = true;
        const d = await svc('billing-start', { planId: S.planSel || (S.billing.plan && S.billing.plan.id) });
        if (!d.checkoutUrl) throw new Error('Mollie gaf geen betaalpagina terug.');
        location.href = d.checkoutUrl; return;
      }
      case 'bz-plan': {
        el.disabled = true;
        const d = await svc('billing-plan', { planId: S.planSel });
        S.planSel = null; await loadSession(); S.billing = await rpc('cd_billing'); await loadBusiness(); render();
        toast(d.warning ? 'Pakket gewijzigd. Let op: ' + d.warning : 'Pakket gewijzigd.', !!d.warning); return;
      }
      case 'bz-addons': {
        el.disabled = true;
        await rpc('cd_addons_save', { p_addons: S.addonSel || [] });
        // loopt er een incasso, dan meteen het maandbedrag bij Mollie aanpassen
        if (S.billing.hasSubscription && S.billing.status === 'active' && S.billing.plan) { try { await svc('billing-plan', { planId: S.billing.plan.id }); } catch (e) { /* volgt bij de volgende betaling */ } }
        S.addonSel = null; await loadSession(); S.billing = await rpc('cd_billing'); await loadBusiness(); render();
        toast('Extra\u2019s opgeslagen. Nieuw bedrag: ' + eur(S.billing.amountCents) + ' per maand excl. btw.'); return;
      }
      case 'bz-method': S.payMethod = el.dataset.v; render(); return;
      case 'bz-method-save': {
        const D = Object.assign({}, S.billing.invoiceDetails || {});
        document.querySelectorAll('[data-iv]').forEach(x => { D[x.dataset.iv] = x.value.trim(); });
        el.disabled = true;
        S.billing = await rpc('cd_billing_method_request', { p_method: el.dataset.v, p_details: D });
        S.payMethod = null; S.invEdit = null; render();
        toast(S.billing.methodRequested ? 'Aangevraagd. Je hoort van ons zodra het is omgezet.' : 'Opgeslagen.'); return;
      }
      case 'bz-inv-pdf': {
        el.disabled = true;
        if (!window.CH_INVOICE) await loadScript('invoice.js?v=1');
        await window.CH_INVOICE.download(await rpc('cd_invoice_get', { p_id: Number(id) }));
        el.disabled = false; return;
      }
      case 'bz-cancel': {
        if (!confirm('Je abonnement opzeggen? Er wordt daarna niets meer afgeschreven. Neem contact op met CrewHarbor als je je gegevens wilt laten verwijderen.')) return;
        el.disabled = true;
        await svc('billing-cancel'); await loadSession(); S.billing = await rpc('cd_billing'); render(); toast('Je abonnement is opgezegd.'); return;
      }
      // vestigingen
      case 'loc-new': S.locEdit = { id: null }; render(); document.getElementById('loc-name').focus(); return;
      case 'loc-edit': S.locEdit = Object.assign({}, LOCS().find(l => same(l.id, id))); render(); document.getElementById('loc-name').focus(); return;
      case 'loc-cancel': S.locEdit = null; render(); return;
      case 'loc-save': {
        el.disabled = true;
        await rpc('cd_location_save', { p_id: S.locEdit.id || null, p: { name: document.getElementById('loc-name').value, address: document.getElementById('loc-addr').value } });
        S.locEdit = null; await loadBusiness(); render(); toast('Vestiging opgeslagen.'); return;
      }
      case 'loc-del': {
        const l = LOCS().find(x => same(x.id, id));
        if (!confirm('Vestiging "' + l.name + '" verwijderen? Medewerkers en prikklokken houden dan geen vestiging; oude diensten blijven bewaard.')) return;
        await rpc('cd_location_delete', { p_id: id }); if (same(S.locFilter, id)) S.locFilter = ''; await loadBusiness(); render(); toast('Vestiging verwijderd.'); return;
      }
      // salaris
      case 'py-save': {
        const p = {}; document.querySelectorAll('[data-pk]').forEach(x => { p[x.dataset.pk] = x.value; });
        el.disabled = true;
        const s = await rpc('cd_payroll_settings_save', { p });
        if (S.payroll) S.payroll.settings = s; el.disabled = false; toast('Opgeslagen.'); return;
      }
      case 'py-open': S.payOpen = true; S.payFmt = null; render(); return;
      case 'py-close': S.payOpen = false; render(); return;
      case 'py-go': el.disabled = true; await payrollExport(reportFiltered(S.report)); el.disabled = false; return;
      // import
      case 'imp-open': S.imp = {}; S.mNew = false; render(); return;
      case 'imp-close': S.imp = null; await loadPeople(); render(); return;
      case 'imp-template': {
        const head = ['Naam', 'E-mailadres', 'Rol', 'Contracturen', 'Personeelsnummer'].concat(LOCS().length ? ['Vestiging'] : []);
        const ex = ['Lisa de Jong', 'lisa@bedrijf.nl', 'Medewerker', '24', '1001'].concat(LOCS().length ? [LOCS()[0].name] : []);
        saveFile('medewerkers-voorbeeld.csv', [csvLine(head), csvLine(ex)].join('\r\n'), 'text/csv', true); return;
      }
      case 'imp-go': {
        const good = S.imp.rows.filter(r => !r.problems.length);
        if (!confirm(good.length + ' medewerker' + (good.length === 1 ? '' : 's') + ' toevoegen? Iedereen krijgt een uitnodiging per mail.')) return;
        await runImport(good); await loadPeople(); await loadBusiness(); render(); return;
      }
      // wizard
      case 'wz-next': el.disabled = true; await wizardNext(); return;
      case 'wz-back': S.wiz.step = Math.max(0, S.wiz.step - 1); render(); return;
      case 'wz-skip': S.wiz.step = Math.min(3, S.wiz.step + 1); S.imp = null; render(); return;
      case 'wz-addrow': S.wiz.rows.push({ name: '', email: '' }); render(); { const f = document.getElementById('wz-n' + (S.wiz.rows.length - 1)); if (f) f.focus(); } return;
      case 'wz-csv': if (!S.roles) S.roles = await rpc('cd_roles'); if (!S.members) S.members = await rpc('cd_members'); S.imp = {}; render(); return;
      case 'wz-loc': {
        const v = document.getElementById('wz-loc').value.trim();
        if (v.length < 2) { toast('Vul een naam in.', true); return; }
        await rpc('cd_location_save', { p_id: null, p: { name: v } }); await loadBusiness(); render(); toast('Vestiging toegevoegd.'); return;
      }
      case 'wz-later': case 'wz-done': {
        await rpc('cd_setup_done'); S.wiz = null; S.imp = null; await loadSession(); location.hash = '#/overzicht'; await onRoute();
        if (act === 'wz-done') toast('Veel succes met CrewHarbor!'); return;
      }
      default: return;
    }
  } catch (err) { toast(err.message, true); if (el.isConnected) el.disabled = false; }
}, true);

document.getElementById('app').addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'loc-filter') { S.locFilter = el.value; S.shiftEdit = null; render(); return; }
  if (el.id === 'imp-file' && el.files && el.files[0]) {
    const f = el.files[0];
    if (f.size > 1024 * 1024) { S.imp = { error: 'Dit bestand is te groot (maximaal 1 MB).' }; render(); return; }
    try {
      if (!S.roles) S.roles = await rpc('cd_roles');
      if (!S.members) S.members = await rpc('cd_members');
      const r = importRows(parseCsv(await f.text()));
      S.imp = r.error ? { error: r.error } : { rows: r.rows };
      if (r.rows && r.rows.length > 500) S.imp.error = 'Maximaal 500 regels per keer.';
    } catch (err) { S.imp = { error: 'Dit bestand kan ik niet lezen. Sla het op als CSV (UTF-8).' }; }
    render(); return;
  }
  if (el.dataset.biz === 'plan') { S.planSel = el.value; render(); return; }
  if (el.dataset.biz === 'addon') {
    const cur = new Set(S.addonSel || (S.billing && S.billing.addons) || []);
    if (el.checked) cur.add(el.value); else cur.delete(el.value);
    S.addonSel = [...cur]; render(); return;
  }
  if (el.dataset.biz === 'pyfmt') { S.payFmt = el.value; render(); return; }
  if (el.dataset.biz === 'mailpref') {
    try {
      const v = await rpc('cd_mail_prefs_save', { p: { [el.dataset.k]: el.checked } });
      S.me.mailPrefs = v; toast(el.checked ? 'Je krijgt hier weer mail over.' : 'Je krijgt hier geen mail meer over.');
    } catch (err) { toast(err.message, true); el.checked = !el.checked; }
    return;
  }
  if (el.dataset.wz != null && S.wiz) { S.wiz.rows[Number(el.dataset.wz)][el.dataset.k] = el.value; }
}, true);
document.getElementById('app').addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.wz != null && S.wiz) S.wiz.rows[Number(el.dataset.wz)][el.dataset.k] = el.value;
}, true);
document.getElementById('app').addEventListener('input', e => {
  const el = e.target; if (!el.dataset || !el.dataset.iv) return;
  S.invEdit = S.invEdit || {}; S.invEdit[el.dataset.iv] = el.value;
});
