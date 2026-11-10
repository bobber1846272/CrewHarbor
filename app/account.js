/* CrewHarbor · inloggen met e-mail, uitnodigingen, wachtwoord vergeten, tweestapsverificatie,
 * je account, beveiliging en privacy (AVG). Hoort bij app.js: gebruikt S, sb, rpc, svc, render en de andere hulpjes daaruit.
 * Wordt vóór app.js geladen; alles hieronder wordt pas aangeroepen als app.js klaar is. */
'use strict';

const AC_PUBLIC = ['login', 'registreren', 'vergeten', 'wachtwoord', 'email'];
const lastEmail = () => { try { return localStorage.getItem('crewharbor-email') || ''; } catch (e) { return ''; } };
const hashParam = k => { const q = location.hash.split('?')[1] || ''; return new URLSearchParams(q).get(k) || ''; };
const pwProblem = (pw, email) => window.CHMFA.passwordProblem(pw, email);
const methodLabel = m => ({ wachtwoord: 'Inloggen', code: 'Inloggen (oude code)', 'wachtwoord-vergeten': 'Wachtwoord vergeten', 'wachtwoord-nieuw': 'Nieuw wachtwoord gekozen',
  uitnodiging: 'Uitnodiging geaccepteerd', 'e-mail-bevestigd': 'E-mailadres bevestigd', registreren: 'Bedrijf geregistreerd', 'prikklok-verlaten': 'Prikklok verlaten',
  '2fa-bevestigd': 'Tweestapscode ingevuld', '2fa-fout': 'Verkeerde tweestapscode', '2fa-aangezet': 'Tweestapsverificatie aangezet', '2fa-uitgezet': 'Tweestapsverificatie uitgezet', '2fa-gereset': 'Tweestapsverificatie gereset' }[m] || m);
function agentShort(a) {
  if (!a) return '';
  const os = /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iPhone/iPad' : /Windows/.test(a) ? 'Windows' : /Mac OS/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : '';
  const br = /CrewHarbor|wv\)/.test(a) ? 'CrewHarbor-app' : /Edg\//.test(a) ? 'Edge' : /Firefox\//.test(a) ? 'Firefox' : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' op ');
}
function saveJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
// Android-app 5.1+: de app kan zelf tweestapscodes maken (sleutel in de kluis van de telefoon)
const appTotp = () => !!(APP && typeof APP.totpSave === 'function');
function appTotpIds() { try { return JSON.parse(APP.totpList() || '[]').map(x => x.id); } catch (e) { return []; } }
function appTotpCode(id) { try { const c = JSON.parse(APP.totpCode(id) || 'null'); return c && c.code; } catch (e) { return null; } }
/** Bij inloggen in de app: staat er voor dit account een sleutel op deze telefoon? Dan meteen bevestigen. */
async function mfaAuto() {
  const M = S.mfa;
  if (!M || M.mode !== 'verify' || M.autoTried || !appTotp()) return;
  M.autoTried = true;
  const done = err => { M.autoDone = true; M.busy = false; if (err) M.err = err; render(); const c = document.getElementById('mfa-code'); if (c) c.focus(); };
  let id = null;
  try { const mine = appTotpIds(); id = ((await window.CHMFA.factors()).verified.find(f => mine.includes(f.id)) || {}).id; } catch (e) { done(); return; }
  const code = id && appTotpCode(id);
  if (!code) { done(); return; } // deze telefoon heeft geen sleutel voor dit account (of de app is op slot)
  try { await window.CHMFA.verify(id, code); }
  catch (x) { done('Bevestigen met deze telefoon lukte niet. Vul de code uit je authenticator-app in.'); return; }
  M.autoDone = true;
  await mfaSuccess(M);
}
/** Wacht de app nog op het automatisch bevestigen? Dan geen invulveld laten zien. */
const mfaWaiting = M => M.mode === 'verify' && !M.autoDone && !M.err && appTotp() && appTotpIds().length > 0;
async function mfaSuccess(M) {
  try { await rpc('cd_mfa_log', { p_event: M.mode === 'setup' ? '2fa-aangezet' : '2fa-bevestigd' }); } catch (y) { /* */ }
  if (M.voluntary) { S.mfa = null; await loadSession(); await loadSecurity(); render(); toast('Tweestapsverificatie staat aan.'); return; }
  await enterApp(M.mode === 'setup' ? 'Tweestapsverificatie staat aan.' : M.after);
}
// "Ingelogd blijven": aan (standaard) = sessie blijft bewaard; uit = uitgelogd zodra de browser of app dicht gaat
const rememberMe = () => { try { return localStorage.getItem('crewharbor-remember') !== '0'; } catch (e) { return true; } };
function setRemember(on) {
  try { localStorage.setItem('crewharbor-remember', on ? '1' : '0'); sessionStorage.setItem('crewharbor-live', '1'); } catch (e) { /* */ }
}
/** Bij opstarten: niet onthouden en dit is een nieuwe browser-/app-sessie? Dan eerst uitloggen. */
function forgetIfNeeded() {
  try { return !rememberMe() && !sessionStorage.getItem('crewharbor-live'); } catch (e) { return false; }
}
const errBox = () => S.authError ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(S.authError) + '</span></div>' : '';

// ---------- na inloggen: sessie laden, of eerst de tweestapscode ----------
async function enterApp(okMsg) {
  try { await loadSession(); }
  catch (e) {
    if (e.code === 'CH001' || e.code === 'CH002') {
      S.me = null;
      S.mfa = { mode: e.code === 'CH001' ? 'verify' : 'setup', msg: e.message, required: true, after: okMsg || null };
      render();
      if (S.mfa.mode === 'setup') await mfaPrepare();
      else { const c = document.getElementById('mfa-code'); if (c) c.focus(); mfaAuto(); }
      return false;
    }
    throw e;
  }
  S.mfa = null; S.authError = null; S.seen = null; S.legacyLogin = false; S.forgot = null; S.tok = null;
  location.hash = '#/overzicht'; await onRoute();
  if (okMsg) toast(okMsg);
  return true;
}
async function mfaPrepare() {
  try { Object.assign(S.mfa, await window.CHMFA.enrollStart(), { err: null }); }
  catch (e) { S.mfa.err = e.message; }
  render();
  const c = document.getElementById('mfa-code'); if (c) c.focus();
}

// ---------- schermen zonder ingelogd te zijn ----------
function viewLoginEmail() {
  return '<div class="login">' + brandPanel('De vaste haven voor je team.', 'Log in met je e-mailadres en wachtwoord.') +
    '<section class="login-main"><form class="login-card" data-form="ac-login" novalidate>' +
      '<div><h2>Inloggen</h2><p class="muted login-sub" style="margin:6px 0 0;font-size:14px">Nog geen wachtwoord? Gebruik de link uit je uitnodiging.</p></div>' + errBox() +
      '<div class="field"><label for="l-email">E-mailadres</label><input class="input" id="l-email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(lastEmail()) + '" required></div>' +
      '<div class="field"><label for="l-pass">Wachtwoord</label><input class="input" id="l-pass" name="password" type="password" autocomplete="current-password" required></div>' +
      '<label class="check login-remember"><input type="checkbox" name="remember"' + (rememberMe() ? ' checked' : '') + '> Ingelogd blijven</label>' +
      '<button class="btn primary" type="submit" id="l-submit">Inloggen</button>' +
      '<p class="switch" style="margin:0"><button type="button" class="linkbtn" data-act="ac-forgot">Wachtwoord vergeten?</button></p>' +
      '<p class="switch login-new">Nieuw bij CrewHarbor? <a href="' + (/\/app\/?$/.test(location.pathname.replace(/index\.html$/, '')) && !(S.regInfo && S.regInfo.open) ? '../#aanvragen' : '#/registreren') + '">' + (S.regInfo && S.regInfo.request === false ? 'Registreer je bedrijf' : 'Vraag CrewHarbor aan') + '</a></p>' +
    '</form><p class="login-foot">Een product van <strong>Spark Apps</strong></p></section></div>';
}
function viewForgot() {
  const F = S.forgot || {};
  const form = F.sent
    ? '<div class="login-card"><h2>Kijk in je mail</h2><div class="alert info"><span>Als <strong>' + esc(F.sent) + '</strong> bij CrewHarbor bekend is, staat er nu een mail klaar met een link om een nieuw wachtwoord te kiezen. De link werkt 1 uur. Niets ontvangen? Kijk ook in je spammap.</span></div>' +
      '<p class="switch"><button type="button" class="linkbtn" data-act="ac-back">Terug naar inloggen</button></p></div>'
    : '<form class="login-card" data-form="ac-forgot" novalidate><div><h2>Wachtwoord vergeten</h2><p class="muted" style="margin:6px 0 0;font-size:14px">Vul je e-mailadres in. Je krijgt een link om een nieuw wachtwoord te kiezen.</p></div>' + errBox() +
      '<div class="field"><label for="f-email">E-mailadres</label><input class="input" id="f-email" name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="' + esc(F.email || lastEmail()) + '" required></div>' +
      '<button class="btn primary" type="submit">Link versturen</button>' +
      '<p class="switch"><button type="button" class="linkbtn" data-act="ac-back">Terug naar inloggen</button></p></form>';
  return '<div class="login">' + brandPanel('Even een nieuw wachtwoord.', 'Binnen een minuut kun je weer verder.') + '<section class="login-main">' + form + '</section></div>';
}
function viewToken() {
  const T = S.tok || {};
  let card;
  if (T.loading) card = '<div class="login-card"><h2>Even geduld…</h2></div>';
  else if (T.done) {
    card = '<div class="login-card"><h2>E-mailadres bevestigd</h2><div class="alert ok">' + ICON.check + '<span>Je logt voortaan in met <strong>' + esc(T.done) + '</strong>.</span></div>' +
      '<p class="switch"><a href="#/' + (S.me ? 'instellingen' : 'login') + '">' + (S.me ? 'Terug naar instellingen' : 'Naar inloggen') + '</a></p></div>';
  } else if (T.err || !T.info) {
    card = '<div class="login-card"><h2>Deze link werkt niet meer</h2><div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(T.err || 'Deze link is niet compleet.') + '</span></div>' +
      '<p class="small muted" style="margin:0">Een uitnodiging werkt 7 dagen, een wachtwoordlink 1 uur. Vraag je beheerder om een nieuwe uitnodiging, of vraag zelf een nieuwe link aan.</p>' +
      '<p class="switch"><button type="button" class="linkbtn" data-act="ac-forgot">Nieuwe link aanvragen</button> · <a href="#/login">Inloggen</a></p></div>';
  } else {
    const I = T.info, first = esc(String(I.name || '').split(/\s+/)[0]);
    const title = I.kind === 'invite' ? 'Welkom aan boord' + (first ? ', ' + first : '') : I.kind === 'reset' ? 'Nieuw wachtwoord kiezen' : 'E-mailadres bevestigen';
    const sub = I.kind === 'invite' ? 'Kies een wachtwoord voor je account' + (I.orgName ? ' bij <strong>' + esc(I.orgName) + '</strong>' : '') + '.'
      : I.kind === 'reset' ? 'Kies een nieuw wachtwoord. Daarna ben je direct ingelogd.'
      : 'Je koppelt <strong>' + esc(I.email) + '</strong> aan je account.' + (I.needsPassword ? ' Kies er meteen een wachtwoord bij; daarmee log je voortaan in.' : '');
    card = '<form class="login-card" data-form="ac-token" novalidate><div><h2>' + title + '</h2><p class="muted" style="margin:6px 0 0;font-size:14px">' + sub + '</p></div>' + errBox() +
      '<dl class="kv"><dt>E-mailadres</dt><dd>' + esc(I.email || '') + '</dd></dl>' +
      (I.needsPassword
        ? '<input type="email" name="username" autocomplete="username" value="' + esc(I.email || '') + '" hidden>' +
          '<div class="field"><label for="t-pass">Wachtwoord</label><input class="input" id="t-pass" name="password" type="password" autocomplete="new-password" required aria-describedby="t-pass-h">' +
          '<span class="small muted" id="t-pass-h">Minstens 10 tekens. Een zin van een paar woorden is sterk en makkelijk te onthouden.</span></div>' +
          '<div class="field"><label for="t-pass2">Herhaal wachtwoord</label><input class="input" id="t-pass2" name="password2" type="password" autocomplete="new-password" required></div>'
        : '') +
      '<button class="btn primary" type="submit"' + (T.busy ? ' disabled' : '') + '>' + (T.busy ? 'Bezig…' : I.kind === 'email' && !I.needsPassword ? 'Bevestigen' : 'Opslaan en inloggen') + '</button></form>';
  }
  return '<div class="login">' + brandPanel('Welkom bij CrewHarbor.', 'Taken, terugbelverzoeken, uren en rooster op één plek.') + '<section class="login-main">' + card + '</section></div>';
}
async function loadToken() {
  const t = hashParam('t');
  if (S.tok && S.tok.token === t && (S.tok.info || S.tok.err)) return;
  S.tok = { token: t, loading: true }; render();
  try { S.tok = { token: t, info: await svc('token-info', { token: t }) }; }
  catch (e) { S.tok = { token: t, err: e.message }; }
  // de link niet in de geschiedenis laten staan
  try { history.replaceState(null, '', location.pathname + location.search + '#/' + location.hash.replace(/^#\/?/, '').split('?')[0]); } catch (e) { /* */ }
}

// ---------- tweestapsverificatie (scherm vóór de app) ----------
function viewMfa() {
  const M = S.mfa;
  const setup = M.mode === 'setup';
  if (mfaWaiting(M)) {
    return '<div class="login">' + brandPanel('Extra beveiliging.', 'Zo kan niemand inloggen met alleen je wachtwoord.') + '<section class="login-main"><div class="login-card mfa-wait" aria-live="polite">' +
      '<span class="mfa-spin" aria-hidden="true"></span><h2>Inloggen bevestigen</h2>' +
      '<p class="muted" style="margin:0">Deze telefoon bevestigt je inlog. Je hoeft niets in te vullen.</p>' +
      '<p class="switch"><button type="button" class="linkbtn" data-act="ac-mfa-logout">Annuleren</button></p></div>' +
      '<p class="login-foot">Een product van <strong>Spark Apps</strong></p></section></div>';
  }
  let body = '<div><h2>' + (setup ? 'Tweestapsverificatie instellen' : 'Tweestapsverificatie') + '</h2>' +
    '<p class="muted" style="margin:6px 0 0;font-size:14px">' + esc(setup ? (M.required ? M.msg : 'Een extra slot op je account: naast je wachtwoord vul je een code uit een app op je telefoon in.') : 'Vul de 6 cijfers uit je authenticator-app of de CrewHarbor-app in.') + '</p></div>' +
    (M.err ? '<div class="alert error" role="alert">' + ICON.alert + '<span>' + esc(M.err) + '</span></div>' : '');
  if (setup && appTotp()) {
    body += '<div class="mfa-device"><p style="margin:0">De CrewHarbor-app maakt de codes zelf. Je hoeft niets te installeren of over te typen.</p>' +
      '<button type="button" class="btn primary" data-act="ac-mfa-device"' + (M.factorId && !M.busy ? '' : ' disabled') + '>' + (M.busy ? 'Bezig…' : 'Gebruik deze telefoon') + '</button></div>' +
      '<details class="small mfa-other"><summary>Liever een andere authenticator-app?</summary>';
  }
  if (setup) {
    body += '<ol class="mfa-steps"><li>Installeer een authenticator-app, bijvoorbeeld <strong>Microsoft Authenticator</strong>, <strong>Google Authenticator</strong> of de app van je wachtwoordmanager.</li>' +
      '<li>Scan de QR-code met die app.</li><li>Vul de code van 6 cijfers in die de app laat zien.</li></ol>' +
      (M.qr ? '<div class="mfa-qr"><img src="' + esc(M.qr) + '" width="184" height="184" alt="QR-code om CrewHarbor aan je authenticator-app toe te voegen"></div>' +
        '<details class="small"><summary>Kun je niet scannen? Vul deze sleutel handmatig in</summary><code class="mfa-secret">' + esc(window.CHMFA.groupSecret(M.secret)) + '</code></details>'
        : (M.err ? '<button type="button" class="btn" data-act="ac-mfa-retry">Opnieuw proberen</button>' : '<p class="muted">QR-code maken…</p>'));
  }
  const devSetup = setup && appTotp();
  body += '<div class="field"><label for="mfa-code">Code uit de app</label><input class="input code-input" id="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="\\d{6}" required></div>' +
    '<button class="btn ' + (devSetup ? '' : 'primary') + '" type="submit"' + (M.busy ? ' disabled' : '') + '>' + (M.busy ? 'Controleren…' : setup ? 'Aanzetten' : 'Bevestigen') + '</button>' + (devSetup ? '</details>' : '') +
    '<p class="switch">' + (M.voluntary ? '<button type="button" class="linkbtn" data-act="ac-mfa-cancel">Annuleren</button>' : '<button type="button" class="linkbtn" data-act="ac-mfa-logout">Uitloggen</button>') + '</p>';
  if (!setup) body += '<p class="small muted" style="margin:0;text-align:center">Telefoon kwijt? Vraag de eigenaar van je bedrijf (of CrewHarbor) om je tweestapsverificatie te resetten.</p>';
  return '<div class="login">' + brandPanel('Extra beveiliging.', 'Zo kan niemand inloggen met alleen je wachtwoord.') +
    '<section class="login-main"><form class="login-card" data-form="ac-mfa" novalidate>' + body + '</form></section></div>';
}

// ---------- instellingen: mijn account, beveiliging, privacy ----------
async function loadSecurity() {
  const jobs = [rpc('cd_login_history', { p_scope: 'me', p_limit: 8 }).then(d => { S.myLogins = d; }).catch(() => { S.myLogins = []; })];
  if (can('org.manage') || can('audit.view')) jobs.push(rpc('cd_login_history', { p_scope: 'org', p_limit: 40 }).then(d => { S.orgLogins = d; }).catch(() => { S.orgLogins = null; }));
  await Promise.all(jobs);
}
function loginRows(list, withName) {
  if (!list || !list.length) return '<p class="small muted" style="margin:0">Nog niets te zien.</p>';
  return '<ul class="login-list">' + list.map(e => '<li><span class="ll-top"><strong>' + (withName ? esc(e.name || '–') + ' · ' : '') + esc(methodLabel(e.method)) + '</strong>' +
      (e.ok ? '' : '<span class="badge red">Mislukt</span>') + '</span>' +
    '<span class="small muted">' + esc(fmtDate(e.at)) + (agentShort(e.agent) ? ' · ' + esc(agentShort(e.agent)) : '') + (e.ip ? ' · ' + esc(e.ip) : '') + '</span></li>').join('') + '</ul>';
}
function accountCard() {
  const me = S.me, legacy = !!me.legacy;
  const mfaRequired = !!(settings().requireMfa && me.isManager);
  const hasPhoto = !!(S.photos && S.photos[me.id]);
  let h = '<section class="card stack" style="gap:14px"><h2>Profiel</h2>' +
    '<div class="photo-row">' + avatar(me.id, me.name, 'xl') + '<div class="stack" style="gap:6px"><div class="row"><label class="btn" for="ac-photo">' + ICON.upload + (hasPhoto ? 'Andere foto' : 'Profielfoto kiezen') + '</label>' +
    (hasPhoto ? '<button class="btn ghost" data-act="ac-photo-del">Foto weghalen</button>' : '') + '</div><input type="file" id="ac-photo" accept="image/*" hidden><span class="small muted">Je collega\'s zien deze foto bij je naam.</span></div></div>' +
    '<dl class="kv"><dt>Naam</dt><dd>' + esc(me.name) + '</dd><dt>Rol</dt><dd>' + esc(S.roleName) + '</dd>' +
    '<dt>E-mailadres</dt><dd>' + (legacy ? '<span class="muted">Nog niet gekoppeld</span>' : esc(me.email || '')) + '</dd></dl>';
  if (legacy) {
    h += '<div class="alert warn">' + ICON.warn + '<span><strong>Koppel je e-mailadres.</strong> Inloggen met een bedrijfscode en code verdwijnt. Met je e-mailadres en een wachtwoord log je veiliger in, en kun je zelf een nieuw wachtwoord aanvragen.</span></div>';
  }
  h += S.acEmail
    ? '<div class="field"><label for="ac-email">' + (legacy ? 'Je e-mailadres' : 'Nieuw e-mailadres') + '</label><input class="input" id="ac-email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false"></div>' +
      '<p class="small muted" style="margin:0">Je krijgt een mail op dat adres. Pas als je op de link klikt, wordt het gewijzigd.</p>' +
      '<div class="row"><button class="btn dark" data-act="ac-email-save">Bevestigingsmail sturen</button><button class="btn ghost" data-act="ac-email-cancel">Annuleren</button></div>'
    : '<div><button class="btn' + (legacy ? ' dark' : '') + '" data-act="ac-email-open">' + (legacy ? 'E-mailadres koppelen' : 'E-mailadres wijzigen') + '</button></div>';
  h += '</section><section class="card stack" style="gap:14px"><h2>Inloggen en beveiliging</h2>';
  if (legacy) {
    h += '<div class="field"><label for="s-code">Nieuwe code</label><input class="input code-input" id="s-code" type="password" inputmode="numeric" autocomplete="new-password" placeholder="6 tot 12 cijfers"></div>' +
      '<div class="field"><label for="s-code2">Herhaal nieuwe code</label><input class="input code-input" id="s-code2" type="password" inputmode="numeric" autocomplete="new-password"></div>' +
      '<div><button class="btn" data-act="s-owncode">Code wijzigen</button></div>';
  } else {
    h += '<h3 class="card-sub">Wachtwoord</h3><input type="email" autocomplete="username" value="' + esc(me.email || '') + '" hidden>' +
      '<div class="field"><label for="ac-pw1">Nieuw wachtwoord</label><input class="input" id="ac-pw1" type="password" autocomplete="new-password" aria-describedby="ac-pw-h"><span class="small muted" id="ac-pw-h">Minstens 10 tekens.</span></div>' +
      '<div class="field"><label for="ac-pw2">Herhaal nieuw wachtwoord</label><input class="input" id="ac-pw2" type="password" autocomplete="new-password"></div>' +
      '<div><button class="btn dark" data-act="ac-pw-save">Wachtwoord wijzigen</button></div>';
  }
  h += '<h3 class="card-sub">Tweestapsverificatie</h3>' +
    (me.mfa
      ? '<p class="small" style="margin:0"><span class="badge green">Aan</span> Bij het inloggen vul je ook een code uit je authenticator-app in.</p>' +
        (mfaRequired ? '<p class="small muted" style="margin:0">Je bedrijf vraagt dit voor iedereen met beheerrechten, dus je kunt het niet uitzetten.</p>' : '<div><button class="btn" data-act="ac-mfa-off">Uitzetten</button></div>')
      : '<p class="small" style="margin:0"><span class="badge">Uit</span> Zet het aan voor een extra slot op je account. Je hebt alleen een authenticator-app op je telefoon nodig.</p>' +
        (legacy ? '<p class="small muted" style="margin:0">Koppel eerst je e-mailadres.</p>' : '<div><button class="btn dark" data-act="ac-mfa-on">Aanzetten</button></div>'));
  {
    h += '</section><section class="card stack" style="gap:14px"><h2>Pincode voor de prikklok</h2><p class="small muted" style="margin:0">Normaal klok je in met de wisselende code uit de app. Je eigen pincode werkt alleen als de eigenaar dat tijdelijk heeft toegestaan. ' + (me.hasPin ? 'Je hebt een pincode ingesteld.' : 'Je hebt nog geen pincode.') + '</p>' +
      '<div class="field"><label for="ac-pin">' + (me.hasPin ? 'Nieuwe pincode' : 'Pincode') + '</label><input class="input code-input" id="ac-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="8 cijfers"></div>' +
      '<div class="row"><button class="btn" data-act="ac-pin-save">Pincode opslaan</button>' + (me.hasPin ? '<button class="btn ghost" data-act="ac-pin-clear">Pincode weghalen</button>' : '') + '</div>';
  }
  h += '</section><section class="card stack" style="gap:14px"><h2>Mijn gegevens</h2><h3 class="card-sub">Laatste keren ingelogd</h3>' + loginRows(S.myLogins, false) +
    '<h3 class="card-sub">Downloaden</h3><p class="small muted" style="margin:0">Download alles wat CrewHarbor over jou bewaart: je account, uren, verlof, rooster, taken en logregels.</p>' +
    '<div><button class="btn" data-act="ac-export-me">' + ICON.download + 'Mijn gegevens downloaden</button></div></section>';
  return h;
}
const RET = [['callsMonths', 'Telefoongesprekken (3CX)'], ['callbacksMonths', 'Afgeronde terugbelverzoeken'], ['logMonths', 'Logboek en inloggeschiedenis'], ['formerMonths', 'Gegevens van oud-medewerkers']];
const RET_OPTS = [[3, '3 maanden'], [6, '6 maanden'], [12, '1 jaar'], [24, '2 jaar'], [36, '3 jaar'], [60, '5 jaar'], [84, '7 jaar'], [0, 'Niet automatisch weghalen']];
function securityCards() {
  let h = '';
  if (can('org.manage')) {
    const ret = (S.org && S.org.retention) || {};
    h += '<section class="card stack" style="gap:14px"><h2>Beveiliging</h2>' +
      '<label class="check"><input type="checkbox" id="sec-mfa"' + (settings().requireMfa ? ' checked' : '') + '> Tweestapsverificatie verplicht voor iedereen met beheerrechten</label>' +
      '<p class="small muted" style="margin:0">Geldt voor wie mensen, rollen, uren of de bedrijfsinstellingen beheert. Zij stellen het in bij hun volgende keer inloggen.</p>' +
      '<div><button class="btn dark" data-act="sec-save">Opslaan</button></div>' +
      (S.orgLogins ? '<h3 class="card-sub">Inloggeschiedenis van het bedrijf</h3>' + loginRows(S.orgLogins, true) : '') + '</section>';
    h += '<section class="card stack" style="gap:14px"><h2>Privacy (AVG)</h2>' +
      '<p class="small muted" style="margin:0">Hoe lang CrewHarbor gegevens bewaart. Oudere gegevens worden elke dag automatisch weggehaald.</p>' +
      RET.map(r => '<div class="field"><label for="ret-' + r[0] + '">' + r[1] + '</label><select class="input" id="ret-' + r[0] + '">' +
        RET_OPTS.map(o => '<option value="' + o[0] + '"' + (Number(ret[r[0]]) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>').join('') +
      '<p class="small muted" style="margin:0">Uren en verlof vallen onder de fiscale bewaarplicht (7 jaar) en worden niet automatisch weggehaald.</p>' +
      '<div class="row"><button class="btn dark" data-act="ret-save">Opslaan</button>' + (S.me.isOwner ? '<button class="btn" data-act="ac-export-org">' + ICON.download + 'Alle bedrijfsgegevens downloaden</button>' : '') + '</div>' +
      '<p class="small" style="margin:0"><a href="privacy.html" target="_blank" rel="noopener">Privacyverklaring</a> · <a href="verwerkersovereenkomst.html" target="_blank" rel="noopener">Verwerkersovereenkomst</a></p></section>';
  } else if (S.orgLogins) {
    h += '<section class="card stack" style="gap:14px"><h2>Inloggeschiedenis</h2>' + loginRows(S.orgLogins, true) + '</section>';
  }
  return h;
}

// ---------- mensen: e-mail, uitnodiging, status ----------
function memberStatus(u) {
  if (u.legacy) return '<span class="badge orange">Oude inlogmethode</span>';
  if (u.invitePending) return '<span class="badge">Uitnodiging verstuurd</span>';
  return '';
}
function memberAccess(u) {
  // blok in het paneel van een medewerker die je mag beheren
  let h = '<h3 class="card-sub">Inloggen</h3>';
  h += '<div class="field"><label for="m-email">E-mailadres</label><input class="input" id="m-email" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" value="' + esc(u.legacy ? '' : (u.email || '')) + '"' + (u.legacy ? ' placeholder="Nog niet gekoppeld"' : '') + '></div>';
  h += '<p class="small muted" style="margin:0">' + (u.legacy ? 'Logt nog in met de bedrijfscode en een code. Vul een e-mailadres in; diegene krijgt dan een uitnodiging om een wachtwoord te kiezen.'
    : u.invitePending ? 'Uitnodiging verstuurd' + (u.invitedAt ? ' op ' + esc(fmtDate(u.invitedAt)) : '') + '. Nog geen wachtwoord gekozen.'
    : 'Logt in met dit e-mailadres en een eigen wachtwoord.' + (u.mfa ? ' Tweestapsverificatie staat aan.' : '')) + '</p>';
  h += '<div class="row"><button class="btn" data-act="ac-m-email" data-id="' + u.id + '">E-mailadres opslaan</button>' +
    (u.legacy ? '<button class="btn" data-act="m-reset" data-id="' + u.id + '">Nieuwe code maken</button>'
      : '<button class="btn" data-act="ac-m-invite" data-id="' + u.id + '">' + (u.invitePending ? 'Uitnodiging opnieuw sturen' : 'Wachtwoordlink sturen') + '</button>') +
    (u.mfa ? '<button class="btn ghost" data-act="ac-m-mfa" data-id="' + u.id + '">Tweestapsverificatie resetten</button>' : '') + '</div>';
  return h;
}
function linkAlert() {
  const L = S.shownLink;
  if (!L) return '';
  return '<div class="alert warn" role="status" style="flex-direction:column;gap:8px"><span><strong>' + esc(L.title) + '</strong>' + esc(L.why || '') +
    ' Stuur deze link zelf door aan ' + esc(L.name) + ' (bijvoorbeeld via WhatsApp). Hij werkt ' + (L.reset ? '1 uur' : '7 dagen') + ' en is maar één keer te gebruiken.</span>' +
    '<code class="mfa-secret" style="user-select:all">' + esc(L.link) + '</code>' +
    '<span class="row"><button class="btn small" data-act="ac-copy" data-v="' + esc(L.link) + '">Link kopiëren</button><button class="btn small ghost" data-act="ac-link-hide">Sluiten</button></span></div>';
}
function deliveryResult(d, name, email, reset) {
  if (d.mailed) { S.shownLink = null; toast((reset ? 'Wachtwoordlink' : 'Uitnodiging') + ' gestuurd naar ' + email + '.'); return; }
  if (d.link) S.shownLink = { name, link: d.link, reset, title: 'De mail is niet verstuurd. ', why: d.mailError ? d.mailError + ' ' : '' };
}

// ---------- klikken ----------
document.getElementById('app').addEventListener('click', async e => {
  const el = e.target.closest('[data-act^="ac-"],[data-act="sec-save"],[data-act="ret-save"]');
  if (!el || el.disabled) return;
  e.stopPropagation();
  const act = el.dataset.act, id = el.dataset.id;
  try {
    switch (act) {
      case 'ac-forgot': S.forgot = { email: (document.getElementById('l-email') || {}).value || '' }; S.authError = null; S.tok = null; location.hash = '#/vergeten'; render(); return;
      case 'ac-back': S.forgot = null; S.legacyLogin = false; S.authError = null; location.hash = '#/login'; render(); return;
      case 'ac-mfa-retry': await mfaPrepare(); return;
      case 'ac-mfa-device': {
        const M = S.mfa; if (!M || !M.factorId || !M.secret) return;
        if (!APP.totpSave(M.factorId, M.secret, lastEmail() || (S.me && S.me.email) || '')) { M.err = 'Opslaan op deze telefoon lukte niet. Gebruik een authenticator-app.'; render(); return; }
        const code = appTotpCode(M.factorId);
        const inp = document.getElementById('mfa-code'), form = document.querySelector('form[data-form="ac-mfa"]');
        if (!code || !inp || !form) { M.err = 'Code maken lukte niet. Gebruik een authenticator-app.'; render(); return; }
        inp.value = code; form.requestSubmit(); return;
      }
      case 'ac-mfa-cancel': S.mfa = null; render(); return;
      case 'ac-mfa-logout': try { await sb.auth.signOut({ scope: 'local' }); } catch (x) { /* */ } S.mfa = null; S.me = null; location.hash = '#/login'; render(); return;
      case 'ac-mfa-on': S.mfa = { mode: 'setup', voluntary: true }; render(); await mfaPrepare(); return;
      case 'ac-mfa-off': {
        if (!confirm('Tweestapsverificatie uitzetten? Dan log je weer in met alleen je wachtwoord.')) return;
        el.disabled = true;
        await window.CHMFA.disableAll();
        try { await rpc('cd_mfa_log', { p_event: '2fa-uitgezet' }); } catch (x) { /* */ }
        await loadSession(); await loadSecurity(); render(); toast('Tweestapsverificatie staat uit.'); return;
      }
      case 'ac-email-open': S.acEmail = true; render(); document.getElementById('ac-email').focus(); return;
      case 'ac-email-cancel': S.acEmail = false; render(); return;
      case 'ac-email-save': {
        const email = document.getElementById('ac-email').value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { toast('Vul een geldig e-mailadres in.', true); return; }
        el.disabled = true;
        await svc('member-email', { memberId: S.me.id, email });
        S.acEmail = false; render(); toast('We hebben een mail gestuurd naar ' + email + '. Klik op de link om het te bevestigen.'); return;
      }
      case 'ac-pw-save': {
        const p1 = document.getElementById('ac-pw1').value, p2 = document.getElementById('ac-pw2').value;
        const pr = pwProblem(p1, S.me.email); if (pr) { toast(pr, true); return; }
        if (p1 !== p2) { toast('De twee wachtwoorden zijn niet hetzelfde.', true); return; }
        el.disabled = true;
        const { error } = await sb.auth.updateUser({ password: p1 });
        if (error) throw new Error(/same|different/i.test(error.message) ? 'Kies een ander wachtwoord dan je huidige.' : /reauth/i.test(error.message) ? 'Log opnieuw in en probeer het dan nog eens.' : error.message);
        document.getElementById('ac-pw1').value = ''; document.getElementById('ac-pw2').value = '';
        el.disabled = false; toast('Je nieuwe wachtwoord is opgeslagen.'); return;
      }
      case 'ac-pin-save': case 'ac-pin-clear': {
        const pin = act === 'ac-pin-clear' ? '' : document.getElementById('ac-pin').value.trim();
        if (act === 'ac-pin-save' && !/^\d{8}$/.test(pin)) { toast('Een pincode bestaat uit precies 8 cijfers.', true); return; }
        el.disabled = true;
        await rpc('cd_clock_pin_set', { p_pin: pin });
        await loadSession(); render(); toast(pin ? 'Je pincode is opgeslagen.' : 'Je pincode is weggehaald.'); return;
      }
      case 'ac-photo-del': if (!confirm('Je profielfoto weghalen?')) return; el.disabled = true; await rpc('cd_avatar_set', { p_data: '' }); await loadSession(); await loadPhotos(true); render(); toast('Foto weggehaald.'); return;
      case 'ac-export-me': el.disabled = true; saveJson('crewharbor-mijn-gegevens.json', await rpc('cd_export_me')); el.disabled = false; return;
      case 'ac-export-org': el.disabled = true; saveJson('crewharbor-' + S.org.slug + '-' + new Date().toISOString().slice(0, 10) + '.json', await rpc('cd_export_org')); el.disabled = false; return;
      case 'sec-save': case 'ret-save': {
        const p = act === 'sec-save' ? { requireMfa: document.getElementById('sec-mfa').checked }
          : { retention: Object.fromEntries(RET.map(r => [r[0], Number(document.getElementById('ret-' + r[0]).value)])) };
        el.disabled = true;
        const o = await rpc('cd_org_security_save', { p });
        S.org.settings = o.settings; S.org.retention = o.retention;
        toast('Opgeslagen.');
        if (act === 'sec-save') { try { await loadSession(); } catch (x) { if (x.code === 'CH002') { await enterApp(); return; } throw x; } }
        render(); return;
      }
      case 'ac-m-email': {
        const email = document.getElementById('m-email').value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { toast('Vul een geldig e-mailadres in.', true); return; }
        el.disabled = true;
        const u = S.members.find(x => same(x.id, id));
        const d = await svc('member-email', { memberId: id, email });
        if (d.invited) deliveryResult(d, u ? u.name : '', email, false); else toast('E-mailadres opgeslagen.');
        await loadPeople(); render(); return;
      }
      case 'ac-m-invite': {
        el.disabled = true;
        const d = await svc('member-invite', { memberId: id });
        deliveryResult(d, d.name, d.email, !d.pending);
        await loadPeople(); render(); return;
      }
      case 'ac-m-mfa': {
        const u = S.members.find(x => same(x.id, id));
        if (!confirm('Tweestapsverificatie van ' + (u ? u.name : 'deze medewerker') + ' resetten? Doe dit alleen als diegene zijn telefoon kwijt is en het zelf vraagt. Daarna logt diegene in met alleen het wachtwoord en kan het opnieuw instellen.')) return;
        el.disabled = true;
        const d = await svc('member-mfa-reset', { memberId: id });
        await loadPeople(); render(); toast(d.removed ? 'Tweestapsverificatie van ' + d.name + ' is gereset.' : d.name + ' had geen tweestapsverificatie aan.'); return;
      }
      case 'ac-copy': try { await navigator.clipboard.writeText(el.dataset.v); toast('Link gekopieerd.'); } catch (x) { toast('Kopiëren lukt niet; selecteer de link en kopieer hem zelf.', true); } return;
      case 'ac-link-hide': S.shownLink = null; render(); return;
      default: return;
    }
  } catch (err) { toast(err.message, true); if (el.isConnected) el.disabled = false; }
}, true);

// ---------- formulieren ----------
document.getElementById('app').addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form^="ac-"]');
  if (!f) return;
  e.preventDefault(); e.stopPropagation();
  const btn = f.querySelector('button[type=submit]');
  const keep = () => { const vals = {}; [...f.elements].forEach(x => { if (x.id && x.type !== 'password') vals[x.id] = x.value; }); return vals; };
  const restore = vals => Object.keys(vals).forEach(k => { const x = document.getElementById(k); if (x) x.value = vals[k]; });
  if (btn) btn.disabled = true;
  try {
    if (f.dataset.form === 'ac-login') {
      const email = f.elements.email.value.trim().toLowerCase(), password = f.elements.password.value;
      if (!email || !password) throw new Error('Vul je e-mailadres en wachtwoord in.');
      const d = await svc('login', { email, password });
      await sb.auth.setSession(d.session);
      try { localStorage.setItem('crewharbor-email', email); } catch (x) { /* */ }
      setRemember(!f.elements.remember || f.elements.remember.checked);
      await enterApp();
    } else if (f.dataset.form === 'ac-forgot') {
      const email = f.elements.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Vul een geldig e-mailadres in.');
      await svc('password-forgot', { email });
      S.forgot = { sent: email }; S.authError = null; render();
    } else if (f.dataset.form === 'ac-token') {
      const T = S.tok, I = T.info;
      let password;
      if (I.needsPassword) {
        password = f.elements.password.value;
        const pr = pwProblem(password, I.email); if (pr) throw new Error(pr);
        if (password !== f.elements.password2.value) throw new Error('De twee wachtwoorden zijn niet hetzelfde.');
      }
      T.busy = true; render();
      let d;
      try { d = await svc('token-complete', { token: T.token, password }); } finally { T.busy = false; }
      S.authError = null;
      if (I.email) { try { localStorage.setItem('crewharbor-email', I.email); } catch (x) { /* */ } }
      if (d.admin) { location.href = 'admin.html'; return; }
      if (d.session) { await sb.auth.setSession(d.session); S.tok = null; await enterApp(I.kind === 'invite' ? 'Welkom bij CrewHarbor!' : I.kind === 'reset' ? 'Je nieuwe wachtwoord is opgeslagen.' : 'Je e-mailadres is bevestigd.'); return; }
      S.tok = { token: T.token, done: d.email || I.email };
      if (S.me) { try { await loadSession(); } catch (x) { /* */ } }
      render();
    } else if (f.dataset.form === 'ac-mfa') {
      const M = S.mfa, code = f.elements.code.value;
      M.busy = true; M.err = null; render();
      try { await window.CHMFA.verify(M.mode === 'setup' ? M.factorId : null, code); }
      catch (x) {
        if (M.mode === 'setup' && appTotp() && appTotpIds().includes(M.factorId)) APP.totpRemove(M.factorId);
        M.busy = false; M.err = x.message;
        try { await rpc('cd_mfa_log', { p_event: '2fa-fout' }); } catch (y) { /* */ }
        render(); const c = document.getElementById('mfa-code'); if (c) c.focus(); return;
      }
      await mfaSuccess(M);
    }
  } catch (err) {
    S.authError = err.message;
    const vals = keep(); render(); restore(vals);
    const c = document.querySelector('input[type=password]') || document.querySelector('.login-card input'); if (c) c.focus();
  } finally { if (btn && btn.isConnected) btn.disabled = false; }
}, true);

// ---------- profielfoto: verkleinen in de browser, dan opslaan ----------
async function setPhoto(file) {
  if (!/^image\//.test(file.type)) { toast('Kies een afbeelding (jpg of png).', true); return; }
  if (file.size > 15 * 1024 * 1024) { toast('Deze foto is te groot. Kies er een van maximaal 15 MB.', true); return; }
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Deze foto kan niet worden geopend.')); i.src = url; });
    const size = 160, c = document.createElement('canvas'); c.width = size; c.height = size;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    URL.revokeObjectURL(url);
    let q = 0.82, data = c.toDataURL('image/jpeg', q);
    while (data.length > 38000 && q > 0.4) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
    await rpc('cd_avatar_set', { p_data: data });
    await loadSession(); await loadPhotos(true); render(); toast('Je profielfoto is opgeslagen.');
  } catch (err) { toast(err.message, true); }
}
