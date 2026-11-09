/* CrewHarbor · tweestapsverificatie (authenticator-app, TOTP) en wachtwoordregels.
 * Gedeeld door de app (index.html) en CrewHarbor Beheer (admin.html). Geef de Supabase-client mee met CHMFA.use(sb). */
(function () {
  'use strict';
  let client = null;
  const auth = () => { if (!client) throw new Error('Geen verbinding.'); return client.auth; };
  const err = (e, fallback) => new Error((e && e.message) ? translate(e.message) : fallback);
  function translate(m) {
    if (/invalid totp|invalid code|expired/i.test(m)) return 'Deze code klopt niet of is verlopen. Kijk in je app naar de nieuwste code.';
    if (/aal2/i.test(m)) return 'Bevestig eerst met de code uit je authenticator-app.';
    if (/rate|too many/i.test(m)) return 'Te veel pogingen. Wacht een minuut en probeer het opnieuw.';
    if (/mfa.*disabled|not enabled/i.test(m)) return 'Tweestapsverificatie staat op de server nog uit. Neem contact op met CrewHarbor.';
    return m;
  }
  async function factors() {
    const { data, error } = await auth().mfa.listFactors();
    if (error) throw err(error, 'Tweestapsverificatie ophalen mislukt.');
    return { verified: (data && data.totp) || [], all: (data && data.all) || [] };
  }
  // Begin met instellen: oude, half ingestelde pogingen eerst opruimen
  async function enrollStart(name) {
    const f = await factors();
    for (const x of f.all.filter(x => x.factor_type === 'totp' && x.status !== 'verified')) {
      try { await auth().mfa.unenroll({ factorId: x.id }); } catch (e) { /* */ }
    }
    const { data, error } = await auth().mfa.enroll({ factorType: 'totp', friendlyName: (name || 'CrewHarbor') + ' ' + new Date().toISOString().slice(0, 16).replace('T', ' ') });
    if (error) throw err(error, 'Tweestapsverificatie instellen mislukt.');
    // Supabase geeft de QR-code als "data:image/svg+xml;utf-8,<svg…>" zonder codering; een # in de svg breekt dat af
    let qr = String(data.totp.qr_code || '');
    const m = /^data:image\/svg\+xml;(?:charset=)?utf-?8,/i.exec(qr);
    if (m || /^\s*<svg/i.test(qr)) {
      let raw = m ? qr.slice(m[0].length) : qr;
      if (/^%3C/i.test(raw)) { try { raw = decodeURIComponent(raw); } catch (e) { /* */ } }
      qr = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(raw);
    }
    return { factorId: data.id, qr, secret: data.totp.secret };
  }
  async function verify(factorId, code) {
    code = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw new Error('Vul de 6 cijfers uit je authenticator-app in.');
    // Zonder factorId: probeer elke gekoppelde app (authenticator-app én CrewHarbor-app)
    const ids = factorId ? [factorId] : (await factors()).verified.filter(f => f.status === 'verified' || !f.status).map(f => f.id);
    if (!ids.length) throw new Error('Er is nog geen authenticator-app gekoppeld.');
    let last = null;
    for (const id of ids) {
      const { error } = await auth().mfa.challengeAndVerify({ factorId: id, code });
      if (!error) return;
      last = error;
      if (/rate|too many/i.test(error.message || '')) break;
    }
    throw err(last, 'Deze code klopt niet.');
  }
  async function unenroll(factorId) {
    const { error } = await auth().mfa.unenroll({ factorId });
    if (error) throw err(error, 'Verwijderen mislukt.');
    try { await auth().refreshSession(); } catch (e) { /* */ }
  }
  async function disableAll() {
    const f = await factors();
    for (const x of f.all.filter(x => x.factor_type === 'totp')) {
      const { error } = await auth().mfa.unenroll({ factorId: x.id });
      if (error) throw err(error, 'Uitzetten mislukt.');
    }
    try { await auth().refreshSession(); } catch (e) { /* */ }
  }
  // Zelfde regels als de server (secure.ts)
  const WEAK = ['wachtwoord', 'password', 'welkom123', 'qwertyuiop', '1234567890', 'crewharbor'];
  function passwordProblem(pw, email) {
    pw = String(pw || '');
    if (pw.length < 10) return 'Kies een wachtwoord van minstens 10 tekens.';
    if (pw.length > 128) return 'Dit wachtwoord is te lang.';
    if (/^\d+$/.test(pw)) return 'Gebruik niet alleen cijfers. Een zin van een paar woorden werkt goed.';
    if (/^(.)\1+$/.test(pw)) return 'Kies een wachtwoord dat niet uit één teken bestaat.';
    const low = pw.toLowerCase();
    if (WEAK.some(w => low.startsWith(w))) return 'Dit wachtwoord is te makkelijk te raden.';
    const local = String(email || '').split('@')[0].toLowerCase();
    if (local.length >= 4 && low.includes(local)) return 'Gebruik je e-mailadres niet in je wachtwoord.';
    return null;
  }
  // Leesbare weergave van de geheime sleutel, voor wie de QR-code niet kan scannen
  const groupSecret = s => String(s || '').replace(/(.{4})/g, '$1 ').trim();
  window.CHMFA = { use: c => { client = c; }, factors, enrollStart, verify, unenroll, disableAll, passwordProblem, groupSecret };
})();
