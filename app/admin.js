/* CrewHarbor Beheer — het beheerpaneel voor alle bedrijven (los van de bedrijfsapp).
 * Aanvragen verwerken, bedrijven aanmaken en beheren, beheerders en een logboek.
 * Praat met de database via public.cd_admin_* en met de logindienst (edge function "crewdeck", acties admin-*).
 */
'use strict';

const CFG = window.CREWDECK_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { storageKey: 'crewdeck-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
window.CHMFA.use(sb);
const $app = document.getElementById('app');
const SITE = (CFG.siteUrl || (location.origin + location.pathname.replace(/admin\.html$/, ''))).replace(/\/?$/, '/');

const A = {
  ready: false, data: null, screen: 'login', err: null, busy: false,
  tab: 'aanvragen', reqFilter: 'nieuw', q: '',
  create: null, created: null, rejectFor: null, blockFor: null, editOrg: null, orgSel: null, codeFor: null, delFor: null, addAdmin: false,
  mfa: null, mail: null, mfaResetFor: null
};

// ---------- hulpjes ----------
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function fmt(v, withTime) {
  if (!v) return '–';
  const d = new Date(v); if (isNaN(d)) return '–';
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + (withTime ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '');
}
function ago(v) {
  if (!v) return 'nooit';
  const m = Math.round((Date.now() - new Date(v)) / 60000);
  if (m < 2) return 'net';
  if (m < 60) return m + ' min geleden';
  const h = Math.round(m / 60); if (h < 24) return h + ' uur geleden';
  const d = Math.round(h / 24); if (d < 31) return d + (d === 1 ? ' dag' : ' dagen') + ' geleden';
  return fmt(v);
}
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(b\.?v\.?|v\.?o\.?f\.?|holding|groep)\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || '';
}
const LOGO = h => window.CH_LOGO(h); // zie logo.js
let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3800);
}

// ---------- verbinding ----------
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST301' || /JWT/i.test(error.message)) { await logout('Je bent uitgelogd. Log opnieuw in.'); }
    const err = new Error(String(error.message || 'Er ging iets mis.').replace(/^.*?ERROR:\s*/, '')); err.code = error.code; throw err;
  }
  return data;
}
async function svc(action, body) {
  const { data: { session } } = await sb.auth.getSession();
  let res;
  try {
    res = await fetch(CFG.supabaseUrl + '/functions/v1/crewdeck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + (session ? session.access_token : CFG.supabaseKey) },
      body: JSON.stringify(Object.assign({ action }, body || {}))
    });
  } catch (e) { throw new Error('Geen verbinding met de server.'); }
  let data = {}; try { data = await res.json(); } catch (e) { /* leeg */ }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis.');
  return data;
}
async function load() {
  A.data = await rpc('cd_admin_overview');
}
async function logout(msg) {
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* */ }
  A.data = null; A.mfa = null; A.screen = 'login'; A.err = msg || null; render();
}
// Na inloggen: tweestapsverificatie is verplicht voor Beheer
async function enter() {
  try { await load(); A.mfa = null; return true; }
  catch (e) {
    if (e.code !== 'CH001' && e.code !== 'CH002') throw e;
    A.data = null; A.mfa = { mode: e.code === 'CH001' ? 'verify' : 'setup', msg: e.message };
    render();
    if (A.mfa.mode === 'setup') {
      try { Object.assign(A.mfa, await window.CHMFA.enrollStart()); } catch (x) { A.mfa.err = x.message; }
      render();
    }
    const c = document.getElementById('mfa-code'); if (c) c.focus();
    return false;
  }
}
function viewMfa() {
  const M = A.mfa, setup = M.mode === 'setup';
  return shell('<form class="login-card" data-form="mfa" novalidate><div><h2>Tweestapsverificatie</h2><p class="muted" style="margin:6px 0 0;font-size:14px">' +
      esc(setup ? 'Verplicht voor CrewHarbor Beheer. Scan de QR-code met een authenticator-app (bijvoorbeeld Microsoft Authenticator of Google Authenticator) en vul de code in.' : 'Vul de 6 cijfers uit je authenticator-app in.') + '</p></div>' +
    (M.err ? '<div class="alert error" role="alert"><span>' + esc(M.err) + '</span></div>' : '') +
    (setup ? (M.qr ? '<div class="mfa-qr"><img src="' + esc(M.qr) + '" width="184" height="184" alt="QR-code voor je authenticator-app"></div>' +
        '<details class="small"><summary>Kun je niet scannen? Vul deze sleutel handmatig in</summary><code class="mfa-secret">' + esc(window.CHMFA.groupSecret(M.secret)) + '</code></details>' : '<p class="muted">QR-code maken…</p>') : '') +
    '<div class="field"><label for="mfa-code">Code uit de app</label><input class="input code-input" id="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></div>' +
    '<button class="btn primary" type="submit"' + (M.busy ? ' disabled' : '') + '>' + (M.busy ? 'Controleren…' : setup ? 'Aanzetten' : 'Bevestigen') + '</button>' +
    '<p class="switch"><a href="#" data-act="logout">Uitloggen</a></p></form>');
}

// ---------- schermen: inrichten en inloggen ----------
function shell(inner) {
  return '<div class="login"><section class="login-brand"><div><span class="logo">' + LOGO(36) + '</span></div>' +
    '<div><h1>CrewHarbor Beheer</h1><p>Aanvragen verwerken, bedrijven aanmaken en alles in de gaten houden.</p></div>' +
    '<div class="spark"><span>Een product van <strong>Spark Apps</strong></span></div></section>' +
    '<section class="login-main">' + inner + '</section></div>';
}
const errBox = () => A.err ? '<div class="alert error" role="alert"><span>' + esc(A.err) + '</span></div>' : '';
function viewLogin() {
  return shell('<form class="login-card" data-form="login" novalidate>' +
    '<div><h2>Inloggen</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Alleen voor beheerders van CrewHarbor.</p></div>' + errBox() +
    '<div class="field"><label for="a-name">Naam</label><input class="input" id="a-name" name="name" autocomplete="username" required></div>' +
    '<div class="field"><label for="a-pw">Wachtwoord</label><input class="input" id="a-pw" name="password" type="password" autocomplete="current-password" required></div>' +
    '<button class="btn primary" type="submit">Inloggen</button>' +
    '<p class="switch">Eerste keer? <a href="#" data-act="to-setup">Inrichten met installatiecode</a></p></form>');
}
function viewSetup() {
  return shell('<form class="login-card" data-form="setup" novalidate>' +
    '<div><h2>Beheer inrichten</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Maak het eerste beheerdersaccount aan met de installatiecode. De code werkt één keer.</p></div>' + errBox() +
    '<div class="field"><label for="s-code">Installatiecode</label><input class="input" id="s-code" name="setupCode" autocapitalize="characters" spellcheck="false" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX" required></div>' +
    '<div class="field"><label for="s-name">Jouw naam</label><input class="input" id="s-name" name="name" autocomplete="username" required></div>' +
    '<div class="field"><label for="s-pw">Wachtwoord</label><input class="input" id="s-pw" name="password" type="password" autocomplete="new-password" minlength="10" required aria-describedby="s-pw-h">' +
      '<span class="small muted" id="s-pw-h">Minstens 10 tekens. Hiermee kun je alle bedrijven beheren, dus kies een sterk wachtwoord.</span></div>' +
    '<button class="btn primary" type="submit">Account aanmaken</button>' +
    '<p class="switch"><a href="#" data-act="to-login">Terug naar inloggen</a></p></form>');
}

// ---------- paneel ----------
function viewPanel() {
  const d = A.data;
  const open = d.requests.filter(r => r.status === 'nieuw').length;
  const tabs = [['aanvragen', 'Aanvragen', open], ['bedrijven', 'Bedrijven', d.orgs.length], ['beheerders', 'Beheerders', 0], ['betalen', 'Pakketten', 0], ['mail', 'Mail', 0], ['logboek', 'Logboek', 0]];
  const body = { aanvragen: viewRequests, bedrijven: viewOrgs, beheerders: viewAdmins, betalen: viewBilling, mail: viewMail, logboek: viewLog }[A.tab]();
  return '<div class="adm">' +
    '<header class="adm-top"><div class="adm-brand"><span class="logo">' + LOGO(28) + '</span><span class="adm-sub">Beheer</span></div>' +
      '<div class="adm-me"><span>' + esc(d.me.name) + '</span><button class="btn small ghost" data-act="logout">Uitloggen</button></div></header>' +
    '<main class="adm-main">' +
      '<div class="stats">' +
        stat('Nieuwe aanvragen', open) + stat('Bedrijven', d.orgs.length) +
        stat('Medewerkers', d.orgs.reduce((n, o) => n + (o.members || 0), 0)) + stat('Geblokkeerd', d.orgs.filter(o => o.blocked).length) + '</div>' +
      '<div class="adm-bar"><div class="seg" role="tablist">' + tabs.map(t => '<button role="tab" aria-selected="' + (A.tab === t[0]) + '" class="' + (A.tab === t[0] ? 'on' : '') + '" data-act="tab" data-id="' + t[0] + '">' +
        t[1] + (t[2] ? '<span class="cnt">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>' +
        '<button class="btn primary" data-act="new-org">+ Bedrijf aanmaken</button></div>' +
      (A.created ? viewCreated() : '') + (A.create ? viewCreateForm() : '') + body +
    '</main></div>';
}
const eur = c => '€ ' + (Math.round(c || 0) / 100).toFixed(2).replace('.', ',');
const planName = id => ((A.data.plans || []).find(p => p.id === id) || {}).name || id || '–';
const BSTAT = { trial: ['Proefperiode', ''], active: ['Betaalt', 'green'], past_due: ['Betaling mislukt', 'red'], canceled: ['Opgezegd', 'orange'], free: ['Gratis', 'green'], expired: ['Proef voorbij', 'red'] };
const FEAT = [['payroll', 'Salarisexport'], ['phone', '3CX-telefonie'], ['locations', 'Meerdere vestigingen']];
function planOptions(sel) { return (A.data.plans || []).map(p => '<option value="' + esc(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.name) + ' · ' + (p.public === false && !p.priceCents && !p.minCents ? 'gratis, alleen in Beheer' : eur(p.priceCents) + '/mw') + '</option>').join(''); }
function viewBilling() {
  const M = A.mollie;
  let h = '<section class="card"><div class="item-top"><h2 style="margin:0">Betalen met Mollie</h2>' + (M ? (M.hasKey ? '<span class="badge green">' + (M.mode === 'live' ? 'Live' : 'Testmodus') + '</span>' : '<span class="badge orange">Nog niet gekoppeld</span>') : '') + '</div>' +
    '<p class="small muted">Plak hier de API-sleutel uit je Mollie-dashboard (Ontwikkelaars → API-sleutels). Begin met de test-sleutel (test_…); zet later de live-sleutel (live_…) erin. De sleutel wordt versleuteld opgeslagen.</p>' +
    '<form class="box" data-form="mollie" novalidate><div class="field"><label for="ml-key">API-sleutel</label><input class="input" id="ml-key" name="key" type="password" autocomplete="off" placeholder="' + (M && M.hasKey ? 'Opgeslagen · leeg laten om te houden' : 'test_…') + '"></div>' +
    (M && M.webhookUrl ? '<p class="small muted" style="margin:0">Webhook (stelt CrewHarbor zelf in): <code style="overflow-wrap:anywhere">' + esc(M.webhookUrl) + '</code></p>' : '') +
    '<div class="row"><button class="btn primary" type="submit">Opslaan en testen</button>' + (M && M.hasKey ? '<button class="btn ghost" type="button" data-act="mollie-remove">Ontkoppelen</button>' : '') + '</div></form></section>';
  h += '<section class="stack" style="gap:12px;max-width:none"><div class="section-title"><h2>Pakketten</h2><button class="btn small" data-act="plan-new">Pakket toevoegen</button></div>' +
    '<p class="small muted" style="margin:0">Prijzen zijn per actieve medewerker per maand, exclusief btw. Wijzigingen staan meteen op de website; lopende abonnementen krijgen het nieuwe bedrag bij hun volgende wijziging.</p>' +
    (A.data.plans || []).concat(A.planNew ? [{ id: '', name: '', priceCents: 0, minCents: 0, features: [], highlights: [], sort: 9, public: true, isNew: true }] : []).map(p =>
      '<form class="card stack" data-form="plan" data-id="' + esc(p.id) + '" style="gap:12px;max-width:none" novalidate><div class="item-top"><h3 style="margin:0">' + (p.isNew ? 'Nieuw pakket' : esc(p.name)) + '</h3>' +
        (p.popular ? '<span class="badge green">Meest gekozen</span>' : '') + (p.isNew ? '' : p.public === false ? '<span class="badge orange">Verborgen</span>' : '<span class="badge green">Live</span>') + '</div>' +
      '<div class="fields4">' +
        '<div class="field"><label>Code</label><input class="input" name="id" value="' + esc(p.id) + '"' + (p.isNew ? '' : ' readonly') + ' autocapitalize="none"></div>' +
        '<div class="field"><label>Naam</label><input class="input" name="name" value="' + esc(p.name) + '"></div>' +
        '<div class="field"><label>Prijs per medewerker (€)</label><input class="input" name="price" inputmode="decimal" value="' + (p.priceCents / 100).toFixed(2).replace('.', ',') + '"></div>' +
        '<div class="field"><label>Minimaal per maand (€)</label><input class="input" name="min" inputmode="decimal" value="' + (p.minCents / 100).toFixed(2).replace('.', ',') + '"></div>' +
        '<div class="field"><label>Max. medewerkers</label><input class="input" name="maxMembers" inputmode="numeric" value="' + esc(p.maxMembers || '') + '" placeholder="Onbeperkt"></div>' +
        '<div class="field"><label>Max. vestigingen</label><input class="input" name="maxLocations" inputmode="numeric" value="' + esc(p.maxLocations || '') + '" placeholder="Onbeperkt"></div>' +
        '<div class="field"><label>Volgorde</label><input class="input" name="sort" inputmode="numeric" value="' + esc(p.sort) + '"></div>' +
      '</div><div class="field"><label>Korte omschrijving</label><input class="input" name="tagline" value="' + esc(p.tagline || '') + '"></div>' +
      '<div class="field"><label>Wat zit erin (één per regel, voor de website)</label><textarea class="input" name="highlights" rows="4">' + esc((p.highlights || []).join('\n')) + '</textarea></div>' +
      '<div class="row">' + FEAT.map(f => '<label class="check"><input type="checkbox" name="f-' + f[0] + '"' + ((p.features || []).includes(f[0]) ? ' checked' : '') + '> ' + f[1] + '</label>').join('') + '</div>' +
      '<div class="row"><label class="check"><input type="checkbox" name="public"' + (p.public !== false ? ' checked' : '') + '> Live (op de website en te kiezen door klanten). Uit = verborgen, alleen in Beheer</label><label class="check"><input type="checkbox" name="popular"' + (p.popular ? ' checked' : '') + '> Meest gekozen</label></div>' +
      '<div class="row"><button class="btn primary" type="submit">Opslaan</button>' + (p.isNew ? '<button class="btn ghost" type="button" data-act="plan-cancel">Annuleren</button>' : '') + '</div></form>').join('') + '</section>';
  return h;
}
function orgBilling(o) {
  const b = o.billing || {}; const st = BSTAT[b.status] || [b.status, ''];
  return '<form class="box" data-form="org-billing" data-id="' + o.id + '" novalidate><div class="item-top"><strong>Abonnement</strong><span class="badge ' + st[1] + '">' + esc(st[0]) + '</span></div>' +
    '<p class="small muted" style="margin:0">' + esc(planName(o.planId)) + ' · ' + (b.members || 0) + ' actief · ' + eur(b.amountCents) + ' per maand excl. btw' +
      (b.trialEndsAt && b.status === 'trial' ? ' · proef tot ' + fmt(b.trialEndsAt) : '') + (b.hasSubscription ? ' · incasso loopt' : '') + (o.locations ? ' · ' + o.locations + ' vestiging' + (o.locations === 1 ? '' : 'en') : '') + '</p>' +
    '<div class="fields4"><div class="field"><label for="ob-p-' + o.id + '">Pakket</label><select class="input" id="ob-p-' + o.id + '" name="planId">' + planOptions(o.planId) + '</select></div>' +
      '<div class="field"><label for="ob-s-' + o.id + '">Status</label><select class="input" id="ob-s-' + o.id + '" name="status">' + ['trial', 'active', 'past_due', 'canceled', 'free'].map(x => '<option value="' + x + '"' + ((b.status === 'expired' ? 'trial' : b.status) === x ? ' selected' : '') + '>' + BSTAT[x][0] + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="ob-t-' + o.id + '">Proefperiode (dagen vanaf nu)</label><input class="input" id="ob-t-' + o.id + '" name="trialDays" inputmode="numeric" placeholder="Niet wijzigen"></div></div>' +
    '<div class="row"><button class="btn small dark" type="submit">Abonnement opslaan</button></div></form>';
}
function viewMail() {
  const m = A.mail;
  if (!m) return '<div class="empty">Laden…</div>';
  return '<section class="card"><div class="item-top"><h2 style="margin:0">Mail versturen</h2>' + (m.configured ? '<span class="badge green">Ingesteld</span>' : '<span class="badge orange">Nog niet ingesteld</span>') + '</div>' +
    '<p class="small muted">Uitnodigingen en wachtwoordlinks gaan vanaf dit adres. Gebruik een mailbox op je eigen domein, bijvoorbeeld <strong>noreply@crewharbor.nl</strong>. Het wachtwoord wordt versleuteld opgeslagen en is hierna niet meer te zien.</p>' +
    (m.keyOk === false ? '<div class="alert error" role="alert"><span>De versleutelsleutel (CREWHARBOR_KEY) ontbreekt nog op de server. Zonder die sleutel kan het wachtwoord niet veilig worden opgeslagen.</span></div>' : '') +
    '<form class="box" data-form="mail" novalidate><div class="fields2">' +
      '<div class="field"><label for="ml-host">Mailserver (SMTP)</label><input class="input" id="ml-host" name="host" value="' + esc(m.host) + '" placeholder="smtp.transip.email" autocapitalize="none" spellcheck="false"></div>' +
      '<div class="field"><label for="ml-port">Poort</label><input class="input" id="ml-port" name="port" inputmode="numeric" value="' + esc(m.port || 465) + '"><span class="small muted">465 (SSL/TLS). 25 en 587 werken niet op de server.</span></div>' +
      '<div class="field"><label for="ml-user">Gebruikersnaam</label><input class="input" id="ml-user" name="user" value="' + esc(m.user) + '" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="noreply@crewharbor.nl"></div>' +
      '<div class="field"><label for="ml-pass">Wachtwoord van de mailbox</label><input class="input" id="ml-pass" name="pass" type="password" autocomplete="new-password" placeholder="' + (m.hasPass ? 'Opgeslagen · leeg laten om te houden' : '') + '"></div>' +
      '<div class="field"><label for="ml-from">Afzenderadres</label><input class="input" id="ml-from" name="from" type="email" value="' + esc(m.from) + '" placeholder="noreply@crewharbor.nl" autocapitalize="none" spellcheck="false"></div>' +
      '<div class="field"><label for="ml-name">Naam afzender</label><input class="input" id="ml-name" name="fromName" value="' + esc(m.fromName || 'CrewHarbor') + '"></div>' +
      '<div class="field full"><label for="ml-site">Adres van de website</label><input class="input" id="ml-site" name="siteUrl" value="' + esc(m.siteUrl || SITE) + '" autocapitalize="none" spellcheck="false"><span class="small muted">De links in de mails gaan hierheen.</span></div>' +
    '</div><div class="row"><button class="btn primary" type="submit">Opslaan</button></div></form>' +
    '<form class="box" data-form="mail-test" novalidate style="margin-top:14px"><div class="field"><label for="ml-to">Testmail sturen naar</label><input class="input" id="ml-to" name="to" type="email" autocapitalize="none" spellcheck="false"></div>' +
      '<div class="row"><button class="btn" type="submit"' + (m.configured ? '' : ' disabled') + '>Testmail sturen</button></div></form></section>';
}
const stat = (label, n) => '<div class="stat"><span>' + label + '</span><strong>' + n + '</strong></div>';

function viewRequests() {
  const all = A.data.requests;
  const list = all.filter(r => A.reqFilter === 'alle' ? true : A.reqFilter === 'nieuw' ? r.status === 'nieuw' : r.status !== 'nieuw');
  let h = '<div class="tabs-inline">' + [['nieuw', 'Nieuw'], ['verwerkt', 'Verwerkt'], ['alle', 'Alle']].map(f =>
    '<button class="btn small' + (A.reqFilter === f[0] ? ' on' : '') + '" data-act="req-filter" data-id="' + f[0] + '">' + f[1] + '</button>').join('') + '</div>';
  if (!list.length) return h + '<div class="empty">' + (A.reqFilter === 'nieuw' ? 'Geen nieuwe aanvragen. Bedrijven vragen CrewHarbor aan via <a href="' + esc(SITE) + '#/registreren" target="_blank" rel="noopener">het aanvraagformulier</a>.' : 'Nog niets hier.') + '</div>';
  return h + '<div class="adm-list">' + list.map(r => {
    const badge = r.status === 'nieuw' ? '<span class="badge orange">Nieuw</span>' : r.status === 'goedgekeurd' ? '<span class="badge green">Aangemaakt' + (r.orgSlug ? ' · ' + esc(r.orgSlug) : '') + '</span>' : '<span class="badge red">Afgewezen</span>';
    let x = '<article class="card adm-req"><div class="item-top"><div><div class="item-title">' + esc(r.company) + '</div>' +
      '<div class="item-meta">Aangevraagd ' + fmt(r.createdAt, true) + (r.handledBy ? ' · verwerkt door ' + esc(r.handledBy) + ' op ' + fmt(r.handledAt) : '') + '</div></div>' + badge + '</div>' +
      '<dl class="dl"><div><dt>Contactpersoon</dt><dd>' + esc(r.contactName) + '</dd></div><div><dt>E-mail</dt><dd><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a></dd></div>' +
      '<div><dt>Telefoon</dt><dd>' + (r.phone ? '<a href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>' : '–') + '</dd></div><div><dt>Medewerkers</dt><dd>' + esc(r.employees || '–') + '</dd></div>' +
      (r.planId ? '<div><dt>Pakket</dt><dd>' + esc(planName(r.planId)) + '</dd></div>' : '') +
      (r.message ? '<div class="full"><dt>Toelichting</dt><dd>' + esc(r.message) + '</dd></div>' : '') +
      (r.rejectReason ? '<div class="full"><dt>Reden afwijzing</dt><dd>' + esc(r.rejectReason) + '</dd></div>' : '') + '</dl>';
    if (r.status === 'nieuw') {
      if (A.rejectFor === r.id) {
        x += '<form class="box" data-form="reject" data-id="' + r.id + '"><div class="field"><label for="rj-' + r.id + '">Reden (alleen voor jezelf)</label>' +
          '<input class="input" id="rj-' + r.id + '" name="reason" placeholder="Bijv. geen bedrijf, dubbele aanvraag"></div>' +
          '<div class="row"><button class="btn danger" type="submit">Afwijzen</button><button class="btn ghost" type="button" data-act="reject-cancel">Annuleren</button></div></form>';
      } else {
        x += '<div class="row"><button class="btn primary" data-act="req-create" data-id="' + r.id + '">Bedrijf aanmaken</button>' +
          '<button class="btn" data-act="reject" data-id="' + r.id + '">Afwijzen</button></div>';
      }
    } else {
      x += '<div class="row"><button class="btn small ghost" data-act="req-delete" data-id="' + r.id + '">Verwijderen uit lijst</button></div>';
    }
    return x + '</article>';
  }).join('') + '</div>';
}

function viewCreateForm() {
  const c = A.create;
  return '<form class="card adm-create" data-form="create" novalidate><div class="item-top"><h2 style="margin:0">' + (c.requestId ? 'Bedrijf aanmaken uit aanvraag' : 'Bedrijf aanmaken') + '</h2>' +
      '<button class="btn small ghost" type="button" data-act="create-cancel">Annuleren</button></div>' +
    (c.err ? '<div class="alert error" role="alert"><span>' + esc(c.err) + '</span></div>' : '') +
    '<div class="fields2">' +
      '<div class="field"><label for="c-org">Bedrijfsnaam</label><input class="input" id="c-org" name="orgName" value="' + esc(c.orgName) + '" required></div>' +
      '<div class="field"><label for="c-slug">Bedrijfscode</label><input class="input" id="c-slug" name="slug" value="' + esc(c.slug) + '" autocapitalize="none" spellcheck="false" required aria-describedby="c-slug-h">' +
        '<span class="small muted" id="c-slug-h">Korte naam voor het bedrijf. 3 tot 30 tekens: kleine letters, cijfers en -</span></div>' +
      '<div class="field"><label for="c-owner">Naam van de eigenaar</label><input class="input" id="c-owner" name="ownerName" value="' + esc(c.ownerName) + '" required aria-describedby="c-owner-h">' +
        '<span class="small muted" id="c-owner-h">Krijgt alle rechten.</span></div>' +
      '<div class="field"><label for="c-oemail">E-mailadres van de eigenaar</label><input class="input" id="c-oemail" name="ownerEmail" type="email" value="' + esc(c.ownerEmail || '') + '" autocapitalize="none" spellcheck="false" required aria-describedby="c-oemail-h">' +
        '<span class="small muted" id="c-oemail-h">Hier komt de uitnodiging naartoe. Hiermee logt de eigenaar in.</span></div>' +
      '<div class="field"><label for="c-cname">Contactpersoon</label><input class="input" id="c-cname" name="contactName" value="' + esc(c.contactName) + '"></div>' +
      '<div class="field"><label for="c-mail">E-mail contactpersoon</label><input class="input" id="c-mail" name="contactEmail" type="email" value="' + esc(c.contactEmail) + '"></div>' +
      '<div class="field"><label for="c-tel">Telefoon</label><input class="input" id="c-tel" name="contactPhone" type="tel" value="' + esc(c.contactPhone) + '"></div>' +
      '<div class="field"><label for="c-plan">Pakket</label><select class="input" id="c-plan" name="planId">' + planOptions(c.planId || 'team') + '</select></div>' +
      '<div class="field"><label for="c-trial">Gratis proberen (dagen)</label><input class="input" id="c-trial" name="trialDays" inputmode="numeric" value="' + esc(c.trialDays || 30) + '"></div>' +
    '</div><p class="small muted" style="margin:0">De eigenaar krijgt een mail met een link om een wachtwoord te kiezen. De link werkt 7 dagen.</p>' +
    '<div class="row"><button class="btn primary" type="submit"' + (A.busy ? ' disabled' : '') + '>' + (A.busy ? 'Bezig…' : 'Aanmaken') + '</button></div></form>';
}
function inviteMessage(r) {
  const greet = r.ownerName ? 'Hoi ' + r.ownerName.split(/\s+/)[0] + ',' : 'Hoi,';
  return greet + '\n\n' + (r.isNewCode ? 'Hierbij een link om een nieuw wachtwoord te kiezen voor CrewHarbor:' : 'Je CrewHarbor-account voor ' + r.orgName + ' staat klaar! Kies via deze link je wachtwoord:') + '\n\n' + r.link +
    '\n\nDe link werkt ' + (r.isNewCode && !r.invite ? '1 uur' : '7 dagen') + ' en is maar één keer te gebruiken. Daarna log je in op ' + SITE + ' met ' + r.ownerEmail + ' en je wachtwoord.' +
    (r.isNewCode ? '' : '\n\nJe team voeg je toe bij Mensen; zij krijgen dan zelf een uitnodiging.') + '\n\nGroet,\n' + (A.data ? A.data.me.name : '');
}
function loginMessage(r, isNewCode) {
  const greet = r.contactName ? 'Hoi ' + r.contactName.split(/\s+/)[0] + ',' : 'Hoi,';
  return greet + '\n\n' + (isNewCode ? 'Hierbij een nieuwe code om in te loggen bij CrewHarbor.' : 'Je CrewHarbor-account staat klaar! Hiermee log je in:') + '\n\n' +
    'Website: ' + SITE + '\nBedrijfscode: ' + r.slug + '\nNaam: ' + r.ownerName + '\nCode: ' + r.code + '\n\n' +
    'Na het inloggen kun je je code wijzigen bij Instellingen en je team toevoegen bij Mensen.' +
    (isNewCode ? '' : ' Je collega’s loggen in met dezelfde bedrijfscode en hun eigen naam en code.') +
    '\n\nDe Android-app vind je in de Sparkapps store.\n\nGroet,\n' + (A.data ? A.data.me.name : '');
}
function viewCreated() {
  const r = A.created;
  if (!r.code) {
    const title = r.isNewCode ? (r.invite ? 'Nieuwe uitnodiging voor ' : 'Wachtwoordlink voor ') : 'Klaar: ';
    return '<section class="card adm-done"><div class="item-top"><h2 style="margin:0">' + title + esc(r.orgName) + '</h2><button class="btn small ghost" data-act="created-close">Sluiten</button></div>' +
      (r.mailed
        ? '<div class="alert ok"><span>Mail gestuurd naar <strong>' + esc(r.ownerEmail) + '</strong>. ' + (r.isNewCode ? 'De eigenaar kiest via de link een nieuw wachtwoord.' : 'De eigenaar kiest via de link een wachtwoord en kan dan meteen beginnen.') + '</span></div>'
        : '<div class="alert warn"><span>De mail is niet verstuurd' + (r.mailError ? ': ' + esc(r.mailError) : '.') + ' Stuur de link hieronder zelf door. Hij is maar één keer te gebruiken.</span></div>' +
          '<div class="field"><label for="msg">Bericht om te versturen</label><textarea class="input" id="msg" rows="10" readonly>' + esc(inviteMessage(r)) + '</textarea></div>' +
          '<div class="row"><button class="btn primary" data-act="copy-msg">Bericht kopiëren</button>' +
            '<a class="btn" href="mailto:' + esc(r.ownerEmail) + '?subject=' + encodeURIComponent('Je CrewHarbor-account') + '&body=' + encodeURIComponent(inviteMessage(r)) + '">Openen in e-mail</a></div>') +
      '<dl class="kv"><dt>Bedrijfscode</dt><dd>' + esc(r.slug) + '</dd><dt>Eigenaar</dt><dd>' + esc(r.ownerName) + ' · ' + esc(r.ownerEmail) + '</dd></dl></section>';
  }
  return '<section class="card adm-done"><div class="item-top"><h2 style="margin:0">' + (r.isNewCode ? 'Nieuwe code voor ' : 'Klaar: ') + esc(r.orgName) + '</h2>' +
      '<button class="btn small ghost" data-act="created-close">Sluiten</button></div>' +
    '<div class="alert warn"><span>Deze code zie je maar één keer. Stuur hem nu door; daarna is hij niet meer op te vragen (wel een nieuwe te maken).</span></div>' +
    '<dl class="kv"><dt>Bedrijfscode</dt><dd>' + esc(r.slug) + '</dd><dt>Naam eigenaar</dt><dd>' + esc(r.ownerName) + '</dd><dt>Code</dt><dd class="code-big">' + esc(r.code) + '</dd></dl>' +
    '<div class="field"><label for="msg">Bericht om te versturen</label><textarea class="input" id="msg" rows="12" readonly>' + esc(loginMessage(r, r.isNewCode)) + '</textarea></div>' +
    '<div class="row"><button class="btn primary" data-act="copy-msg">Bericht kopiëren</button>' +
      (r.contactEmail ? '<a class="btn" href="mailto:' + esc(r.contactEmail) + '?subject=' + encodeURIComponent('Je CrewHarbor-account') + '&body=' + encodeURIComponent(loginMessage(r, r.isNewCode)) + '">Openen in e-mail</a>' : '') + '</div></section>';
}

function viewOrgs() {
  const q = A.q.trim().toLowerCase();
  const list = A.data.orgs.filter(o => !q || [o.name, o.slug, o.owner, o.contactName, o.contactEmail].some(v => String(v || '').toLowerCase().includes(q)));
  let h = '<div class="field" style="max-width:360px"><label class="sr-only" for="o-q">Zoeken</label><input class="input" id="o-q" data-inp="q" type="search" placeholder="Zoek op naam, code of contact" value="' + esc(A.q) + '"></div>';
  if (!A.data.orgs.length) return h + '<div class="empty">Nog geen bedrijven. Maak er een aan of verwerk een aanvraag.</div>';
  if (!list.length) return h + '<div class="empty">Niets gevonden.</div>';
  return h + '<div class="adm-list">' + list.map(o => {
    const sel = A.orgSel === o.id;
    let x = '<article class="card adm-org' + (o.blocked ? ' blocked' : '') + '"><div class="item-top"><div><div class="item-title">' + esc(o.name) + ' <span class="muted" style="font-weight:400">· ' + esc(o.slug) + '</span></div>' +
      '<div class="item-meta">Eigenaar ' + esc(o.owner || '–') + ' · ' + o.members + ' actief · ' + (o.kiosks ? o.kiosks + ' prikklok' + (o.kiosks > 1 ? 'ken' : '') + ' · ' : '') + 'laatst actief ' + ago(o.lastActive) + '</div></div>' +
      '<div class="row">' + (o.blocked ? '<span class="badge red">Geblokkeerd</span>' : '<span class="badge ' + ((BSTAT[(o.billing || {}).status] || [])[1] || '') + '">' + esc(planName(o.planId)) + ' · ' + esc((BSTAT[(o.billing || {}).status] || ['–'])[0]) + '</span>') +
        '<button class="btn small" data-act="org-open" data-id="' + o.id + '" aria-expanded="' + sel + '">' + (sel ? 'Inklappen' : 'Beheren') + '</button></div></div>';
    if (sel) {
      if (A.editOrg === o.id) {
        x += '<form class="box" data-form="org-edit" data-id="' + o.id + '"><div class="fields2">' +
          '<div class="field"><label for="e-name">Bedrijfsnaam</label><input class="input" id="e-name" name="name" value="' + esc(o.name) + '"></div>' +
          '<div class="field"><label for="e-cn">Contactpersoon</label><input class="input" id="e-cn" name="contactName" value="' + esc(o.contactName || '') + '"></div>' +
          '<div class="field"><label for="e-ce">E-mail</label><input class="input" id="e-ce" name="contactEmail" type="email" value="' + esc(o.contactEmail || '') + '"></div>' +
          '<div class="field"><label for="e-cp">Telefoon</label><input class="input" id="e-cp" name="contactPhone" type="tel" value="' + esc(o.contactPhone || '') + '"></div></div>' +
          '<div class="field"><label for="e-notes">Notities (alleen zichtbaar in Beheer)</label><textarea class="input" id="e-notes" name="notes" rows="3">' + esc(o.notes || '') + '</textarea></div>' +
          '<div class="row"><button class="btn primary" type="submit">Opslaan</button><button class="btn ghost" type="button" data-act="org-edit-cancel">Annuleren</button></div></form>';
      } else {
        x += '<dl class="dl"><div><dt>Contactpersoon</dt><dd>' + esc(o.contactName || '–') + '</dd></div>' +
          '<div><dt>E-mail</dt><dd>' + (o.contactEmail ? '<a href="mailto:' + esc(o.contactEmail) + '">' + esc(o.contactEmail) + '</a>' : '–') + '</dd></div>' +
          '<div><dt>Telefoon</dt><dd>' + esc(o.contactPhone || '–') + '</dd></div><div><dt>Aangemaakt</dt><dd>' + fmt(o.createdAt) + (o.createdVia ? ' · ' + esc(o.createdVia) : '') + '</dd></div>' +
          (o.notes ? '<div class="full"><dt>Notities</dt><dd>' + esc(o.notes) + '</dd></div>' : '') +
          (o.blocked && o.blockedReason ? '<div class="full"><dt>Reden blokkade</dt><dd>' + esc(o.blockedReason) + '</dd></div>' : '') + '</dl>' + orgBilling(o);
        if (A.blockFor === o.id) {
          x += '<form class="box" data-form="block" data-id="' + o.id + '"><p style="margin:0">Niemand van <strong>' + esc(o.name) + '</strong> kan nog inloggen of klokken tot je het bedrijf weer vrijgeeft. Er wordt niets verwijderd.</p>' +
            '<div class="field"><label for="b-r">Reden</label><input class="input" id="b-r" name="reason" placeholder="Bijv. niet betaald, op verzoek"></div>' +
            '<div class="row"><button class="btn danger" type="submit">Blokkeren</button><button class="btn ghost" type="button" data-act="block-cancel">Annuleren</button></div></form>';
        } else if (A.delFor === o.id) {
          x += '<form class="box bad" data-form="org-delete" data-id="' + o.id + '" novalidate><p style="margin:0"><strong>Definitief verwijderen.</strong> Alles van <strong>' + esc(o.name) + '</strong> gaat weg: ' + o.members + ' medewerker' + (o.members === 1 ? '' : 's') + ' en hun accounts, taken, terugbelverzoeken, uren, rooster, kennisbank en documenten. Dit kun je niet ongedaan maken.</p>' +
            (o.blocked ? '' : '<p class="small muted" style="margin:0">Twijfel je? Blokkeer het bedrijf dan liever; dat kun je altijd terugdraaien.</p>') +
            '<div class="field"><label for="d-c">Typ <strong>' + esc(o.slug) + '</strong> om te bevestigen</label><input class="input" id="d-c" name="confirm" autocomplete="off" autocapitalize="none" spellcheck="false"></div>' +
            '<div class="row"><button class="btn danger" type="submit"' + (A.busy ? ' disabled' : '') + '>' + (A.busy ? 'Bezig met verwijderen…' : 'Definitief verwijderen') + '</button><button class="btn ghost" type="button" data-act="del-cancel">Annuleren</button></div></form>';
        } else if (A.codeFor === o.id) {
          x += '<div class="box"><p style="margin:0">De eigenaar (<strong>' + esc(o.owner || '–') + '</strong>) krijgt een mail met een link om een (nieuw) wachtwoord te kiezen. Heeft de eigenaar nog geen e-mailadres, dan maak je een nieuwe code zoals vroeger.</p>' +
            '<div class="row"><button class="btn dark" data-act="owner-code-go" data-id="' + o.id + '"' + (A.busy ? ' disabled' : '') + '>Link sturen</button><button class="btn ghost" data-act="owner-code-cancel">Annuleren</button></div></div>';
        } else if (A.mfaResetFor === o.id) {
          x += '<div class="box"><p style="margin:0">Telefoon kwijt? Hiermee zet je de tweestapsverificatie van de eigenaar (<strong>' + esc(o.owner || '–') + '</strong>) uit. Doe dit alleen als je zeker weet dat de eigenaar het zelf vraagt, bijvoorbeeld na een telefoontje.</p>' +
            '<div class="row"><button class="btn danger" data-act="mfa-reset-go" data-id="' + o.id + '">Tweestapsverificatie resetten</button><button class="btn ghost" data-act="mfa-reset-cancel">Annuleren</button></div></div>';
        } else {
          x += '<div class="row"><button class="btn" data-act="org-edit" data-id="' + o.id + '">Gegevens wijzigen</button>' +
            '<button class="btn" data-act="owner-code" data-id="' + o.id + '">Inloglink eigenaar</button>' +
            '<button class="btn" data-act="mfa-reset" data-id="' + o.id + '">2FA eigenaar resetten</button>' +
            (o.blocked ? '<button class="btn green" data-act="unblock" data-id="' + o.id + '">Vrijgeven</button>' : '<button class="btn danger" data-act="block" data-id="' + o.id + '">Blokkeren</button>') +
            '<button class="btn ghost adm-del" data-act="del" data-id="' + o.id + '">Verwijderen</button></div>';
        }
      }
    }
    return x + '</article>';
  }).join('') + '</div>';
}

function viewAdmins() {
  let h = '<section class="card"><div class="item-top"><h2 style="margin:0">Beheerders</h2>' + (A.addAdmin ? '' : '<button class="btn small" data-act="add-admin">+ Beheerder toevoegen</button>') + '</div>' +
    '<p class="small muted">Beheerders kunnen alle bedrijven zien, aanmaken en blokkeren. Ze zien nooit de gegevens binnen een bedrijf.</p>' +
    '<div class="adm-list">' + A.data.admins.map(a => '<div class="result"><strong>' + esc(a.name) + (a.name === A.data.me.name ? ' <span class="badge">jij</span>' : '') + '</strong><span class="small muted">sinds ' + fmt(a.createdAt) + '</span></div>').join('') + '</div>';
  if (A.addAdmin) {
    h += '<form class="box" data-form="admin-add" novalidate style="margin-top:14px">' +
      '<div class="fields2"><div class="field"><label for="n-name">Naam</label><input class="input" id="n-name" name="name" autocomplete="off" required></div>' +
      '<div class="field"><label for="n-pw">Wachtwoord (minstens 10 tekens)</label><input class="input" id="n-pw" name="password" type="password" autocomplete="new-password" minlength="10" required></div></div>' +
      '<div class="row"><button class="btn primary" type="submit">Toevoegen</button><button class="btn ghost" type="button" data-act="add-admin-cancel">Annuleren</button></div></form>';
  }
  return h + '</section>';
}
function viewLog() {
  if (!A.data.log.length) return '<div class="empty">Nog niets gebeurd.</div>';
  return '<section class="card"><h2>Laatste 50 acties</h2><div class="adm-list">' + A.data.log.map(l =>
    '<div class="adm-log"><span class="small muted">' + fmt(l.at, true) + '</span><strong>' + esc(l.admin || 'systeem') + '</strong><span>' + esc(l.text) + '</span></div>').join('') + '</div></section>';
}

// ---------- tekenen ----------
function render() {
  if (!A.ready) { $app.innerHTML = ''; return; }
  document.title = 'CrewHarbor Beheer';
  if (A.mfa) { $app.innerHTML = viewMfa(); return; }
  if (!A.data) { $app.innerHTML = A.screen === 'setup' ? viewSetup() : viewLogin(); return; }
  const y = window.scrollY;
  $app.innerHTML = viewPanel();
  window.scrollTo(0, y);
}
async function refresh() { try { await load(); } catch (e) { toast(e.message, true); } render(); }

// ---------- klikken ----------
$app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (b.tagName === 'A' && b.getAttribute('href') === '#') e.preventDefault();
  const req = () => A.data.requests.find(r => String(r.id) === String(id));
  try {
    switch (act) {
      case 'to-setup': A.screen = 'setup'; A.err = null; render(); break;
      case 'to-login': A.screen = 'login'; A.err = null; render(); break;
      case 'logout': await logout(); break;
      case 'tab':
        A.tab = id; A.orgSel = null; A.editOrg = null; A.blockFor = null; A.codeFor = null; A.delFor = null; A.mfaResetFor = null; render();
        if (id === 'mail') { A.mail = await svc('admin-mail-get'); render(); }
        if (id === 'betalen') { A.mollie = await svc('admin-mollie-get'); render(); }
        break;
      case 'plan-new': A.planNew = true; render(); break;
      case 'plan-cancel': A.planNew = false; render(); break;
      case 'mollie-remove': if (!confirm('Mollie ontkoppelen? Bedrijven kunnen dan geen betaling meer instellen; lopende incasso’s blijven bij Mollie doorlopen.')) break;
        await svc('admin-mollie-save', { key: '' }); A.mollie = await svc('admin-mollie-get'); render(); toast('Mollie ontkoppeld.'); break;
      case 'mfa-reset': A.mfaResetFor = id; A.codeFor = null; render(); break;
      case 'mfa-reset-cancel': A.mfaResetFor = null; render(); break;
      case 'mfa-reset-go': {
        const r = await svc('admin-owner-mfa-reset', { orgId: id });
        A.mfaResetFor = null; render(); toast(r.removed ? 'Tweestapsverificatie van ' + r.name + ' is gereset.' : r.name + ' had geen tweestapsverificatie aan.'); break;
      }
      case 'req-filter': A.reqFilter = id; render(); break;
      case 'new-org':
        A.create = { requestId: null, orgName: '', slug: '', ownerName: '', ownerEmail: '', contactName: '', contactEmail: '', contactPhone: '' }; A.created = null; render();
        window.scrollTo(0, 0); document.getElementById('c-org').focus(); break;
      case 'req-create': {
        const r = req();
        A.create = { requestId: r.id, orgName: r.company, slug: slugify(r.company), ownerName: r.contactName, ownerEmail: r.email, planId: r.planId || 'team', contactName: r.contactName, contactEmail: r.email, contactPhone: r.phone || '' };
        A.created = null; render(); window.scrollTo(0, 0); document.getElementById('c-slug').focus(); break;
      }
      case 'create-cancel': A.create = null; render(); break;
      case 'created-close': A.created = null; render(); break;
      case 'copy-msg': {
        const t = document.getElementById('msg');
        try { await navigator.clipboard.writeText(t.value); } catch (err) { t.select(); document.execCommand('copy'); }
        toast('Bericht gekopieerd.'); break;
      }
      case 'reject': A.rejectFor = Number(id); render(); document.getElementById('rj-' + id).focus(); break;
      case 'reject-cancel': A.rejectFor = null; render(); break;
      case 'req-delete': await rpc('cd_admin_request_delete', { p_id: Number(id) }); await refresh(); toast('Aanvraag verwijderd.'); break;
      case 'org-open': A.orgSel = A.orgSel === id ? null : id; A.editOrg = null; A.blockFor = null; A.codeFor = null; A.delFor = null; A.mfaResetFor = null; render(); break;
      case 'org-edit': A.editOrg = id; render(); break;
      case 'org-edit-cancel': A.editOrg = null; render(); break;
      case 'block': A.blockFor = id; render(); document.getElementById('b-r').focus(); break;
      case 'block-cancel': A.blockFor = null; render(); break;
      case 'unblock': await rpc('cd_admin_org_block', { p_id: id, p_blocked: false }); await refresh(); toast('Bedrijf vrijgegeven. Iedereen kan weer inloggen.'); break;
      case 'del': A.delFor = id; render(); document.getElementById('d-c').focus(); break;
      case 'del-cancel': A.delFor = null; render(); break;
      case 'owner-code': A.codeFor = id; render(); break;
      case 'owner-code-cancel': A.codeFor = null; render(); break;
      case 'owner-code-go': {
        A.busy = true; render();
        try {
          const o = A.data.orgs.find(x => x.id === id);
          const r = await svc('admin-owner-code', { orgId: id });
          A.created = Object.assign({ isNewCode: true, contactName: o && o.contactName, contactEmail: o && o.contactEmail }, r);
          A.codeFor = null; A.create = null;
        } finally { A.busy = false; }
        await refresh(); window.scrollTo(0, 0); break;
      }
      case 'add-admin': A.addAdmin = true; render(); document.getElementById('n-name').focus(); break;
      case 'add-admin-cancel': A.addAdmin = false; render(); break;
    }
  } catch (err) { toast(err.message, true); render(); }
});
$app.addEventListener('input', e => {
  if (e.target.dataset.inp === 'q') {
    A.q = e.target.value; const pos = e.target.selectionStart; render();
    const el = document.getElementById('o-q'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (err) { /* */ }
  }
  if (e.target.id === 'c-org' && A.create && !A.create.slugTouched) {
    const s = document.getElementById('c-slug'); if (s) s.value = slugify(e.target.value);
  }
  if (e.target.id === 'c-slug' && A.create) A.create.slugTouched = true;
});

// ---------- formulieren ----------
$app.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const v = k => (f.elements[k] ? f.elements[k].value.trim() : '');
  const kind = f.dataset.form, id = f.dataset.id;
  const btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (kind === 'login' || kind === 'setup') {
      const d = kind === 'login'
        ? await svc('admin-login', { name: v('name'), password: f.elements.password.value })
        : await svc('admin-setup', { setupCode: v('setupCode'), name: v('name'), password: f.elements.password.value });
      if (!d.session) throw new Error('Inloggen mislukt. Probeer het opnieuw.');
      await sb.auth.setSession(d.session);
      A.err = null;
      if (await enter()) { render(); if (kind === 'setup') toast('Welkom! Je beheerdersaccount staat klaar.'); }
      return;
    }
    if (kind === 'mfa') {
      const M = A.mfa; M.busy = true; M.err = null; render();
      try { await window.CHMFA.verify(M.mode === 'setup' ? M.factorId : null, f.elements.code.value); }
      catch (x) { M.busy = false; M.err = x.message; try { await rpc('cd_mfa_log', { p_event: '2fa-fout' }); } catch (y) { /* */ } render(); const c = document.getElementById('mfa-code'); if (c) c.focus(); return; }
      try { await rpc('cd_mfa_log', { p_event: M.mode === 'setup' ? '2fa-aangezet' : '2fa-bevestigd' }); } catch (y) { /* */ }
      const wasSetup = M.mode === 'setup';
      if (await enter()) { render(); if (wasSetup) toast('Tweestapsverificatie staat aan.'); }
      return;
    }
    if (kind === 'mail') {
      await svc('admin-mail-save', { host: v('host'), port: Number(v('port')) || 465, user: v('user'), pass: f.elements.pass.value, from: v('from'), fromName: v('fromName'), siteUrl: v('siteUrl') });
      A.mail = await svc('admin-mail-get'); render(); toast('Mailinstellingen opgeslagen. Stuur een testmail om te kijken of het werkt.'); return;
    }
    if (kind === 'mail-test') {
      await svc('admin-mail-test', { to: v('to') }); toast('Testmail verstuurd naar ' + v('to') + '. Kijk ook in je spammap.'); if (btn) btn.disabled = false; return;
    }
    if (kind === 'create') {
      const p = { requestId: A.create.requestId, orgName: v('orgName'), slug: v('slug').toLowerCase(), ownerName: v('ownerName'), ownerEmail: v('ownerEmail').toLowerCase(), contactName: v('contactName'), contactEmail: v('contactEmail'), contactPhone: v('contactPhone'), planId: v('planId'), trialDays: Number(v('trialDays')) || 30 };
      Object.assign(A.create, p, { err: null }); A.busy = true; render();
      try {
        const r = await svc('admin-create-org', p);
        A.created = Object.assign({ isNewCode: false, contactName: p.contactName, contactEmail: p.contactEmail }, r);
        A.create = null; A.tab = 'bedrijven'; A.orgSel = r.orgId;
      } catch (err) { A.create.err = err.message; }
      A.busy = false; await refresh(); window.scrollTo(0, 0); return;
    }
    if (kind === 'reject') {
      await rpc('cd_admin_request_reject', { p_id: Number(id), p_reason: v('reason') });
      A.rejectFor = null; await refresh(); toast('Aanvraag afgewezen.'); return;
    }
    if (kind === 'block') {
      await rpc('cd_admin_org_block', { p_id: id, p_blocked: true, p_reason: v('reason') });
      A.blockFor = null; await refresh(); toast('Bedrijf geblokkeerd.'); return;
    }
    if (kind === 'mollie') {
      const key = f.elements.key.value.trim();
      if (!key) { toast('Plak eerst een API-sleutel.', true); if (btn) btn.disabled = false; return; }
      const r = await svc('admin-mollie-save', { key }); A.mollie = await svc('admin-mollie-get'); render();
      toast('Mollie gekoppeld (' + (r.mode === 'live' ? 'live' : 'testmodus') + ').'); return;
    }
    if (kind === 'plan') {
      const money = k => Math.round(Number(v(k).replace(/\./g, '').replace(',', '.')) * 100);
      const p = { id: v('id'), name: v('name'), tagline: v('tagline'), priceCents: money('price'), minCents: money('min') || 0,
        maxMembers: Number(v('maxMembers')) || 0, maxLocations: Number(v('maxLocations')) || 0, sort: Number(v('sort')) || 0,
        highlights: f.elements.highlights.value.split('\n').map(x => x.trim()).filter(Boolean),
        features: FEAT.map(x => x[0]).filter(k => f.elements['f-' + k].checked), public: f.elements.public.checked, popular: f.elements.popular.checked };
      if (!isFinite(p.priceCents) || p.priceCents < 0) throw new Error('Vul een geldige prijs in.');
      await rpc('cd_admin_plan_save', { p }); A.planNew = false; await refresh(); toast('Pakket opgeslagen.'); return;
    }
    if (kind === 'org-billing') {
      const r = await svc('admin-org-billing', { orgId: id, planId: v('planId'), status: v('status'), trialDays: v('trialDays') });
      await refresh(); toast('Abonnement opgeslagen: ' + planName(r.planId) + ', ' + ((BSTAT[r.status] || [r.status])[0]).toLowerCase() + '.'); return;
    }
    if (kind === 'org-edit') {
      await rpc('cd_admin_org_update', { p_id: id, p: { name: v('name'), contactName: v('contactName'), contactEmail: v('contactEmail'), contactPhone: v('contactPhone'), notes: v('notes') } });
      A.editOrg = null; await refresh(); toast('Opgeslagen.'); return;
    }
    if (kind === 'org-delete') {
      const o = A.data.orgs.find(x => x.id === id);
      if (v('confirm').toLowerCase() !== o.slug) throw new Error('Typ ' + o.slug + ' om te bevestigen.');
      A.busy = true; render();
      try {
        const r = await svc('admin-org-delete', { orgId: id, confirm: v('confirm') });
        A.delFor = null; A.orgSel = null; if (A.created && A.created.slug === o.slug) A.created = null;
        toast(r.failed ? r.name + ' is verwijderd, maar ' + r.failed + ' account(s) konden niet worden opgeruimd.' : r.name + ' is verwijderd.', !!r.failed);
      } finally { A.busy = false; }
      await refresh(); return;
    }
    if (kind === 'admin-add') {
      await svc('admin-add', { name: v('name'), password: f.elements.password.value });
      A.addAdmin = false; await refresh(); toast('Beheerder toegevoegd.'); return;
    }
  } catch (err) {
    if (kind === 'mfa') { A.mfa.busy = false; A.mfa.err = err.message; render(); }
    else if (kind === 'login' || kind === 'setup') {
      A.err = err.message;
      const keep = {}; [...f.elements].forEach(el => { if (el.id && el.type !== 'password') keep[el.id] = el.value; });
      render(); Object.keys(keep).forEach(k => { const el = document.getElementById(k); if (el) el.value = keep[k]; });
      const pw = document.querySelector('input[type=password]'); if (pw) pw.focus();
    } else { toast(err.message, true); if (btn) btn.disabled = false; }
  }
});

// ---------- start ----------
(async function start() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    A.ready = true;
    if (session) { try { await enter(); } catch (e) { A.data = null; } }
  } catch (e) { /* */ }
  A.ready = true; render();
  setInterval(() => { if (A.data && !document.hidden && !A.create && !A.editOrg && !A.blockFor && !A.rejectFor && !A.addAdmin && !A.delFor && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) refresh(); }, 60000);
})();
