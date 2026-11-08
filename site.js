/* CrewHarbor · website: pakketten laden, prijs uitrekenen, aanvraag versturen */
(function () {
  'use strict';
  const CFG = window.CREWDECK_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (c, dec) => '€ ' + (c / 100).toLocaleString('nl-NL', { minimumFractionDigits: dec === false && c % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });

  if (window.CH_LOGO) { $('logo').innerHTML = window.CH_LOGO(30); $('logo2').innerHTML = window.CH_LOGO(28); }

  // reserve-pakketten als de server even niet bereikbaar is (worden vervangen door de echte prijzen)
  let PLANS = [
    { id: 'start', name: 'Start', tagline: 'Voor kleine teams die overzicht willen.', monthCents: 3000, minMembers: 1, maxMembers: 10, fixed: true, discountPct: 0, features: [], addonCents: { payroll: 1000, phone: 1000, locations: 1500 }, highlights: ['Terugbelverzoeken en taken', 'Uren, in- en uitklokken en prikklok', 'Rooster, verlof en beschikbaarheid', 'Kennisbank en documenten', 'Meldingen per mail'] },
    { id: 'team', name: 'Team', tagline: 'Alles voor een groeiend team, met export naar je salarisadministratie.', monthCents: 23750, minMembers: 11, maxMembers: 50, fixed: true, discountPct: 5, features: ['payroll', 'phone'], addonCents: { locations: 7125 }, highlights: ['Alles uit Start', 'Salarisexport (Excel, Nmbrs, Loket.nl, AFAS)', 'Koppeling met 3CX-telefonie'], popular: true },
    { id: 'bedrijf', name: 'Bedrijf', tagline: 'Voor bedrijven met meerdere vestigingen.', monthCents: 29835, minMembers: 51, maxMembers: null, fixed: false, discountPct: 10, features: ['payroll', 'phone', 'locations'], addonCents: {}, highlights: ['Alles uit Team', 'Meerdere vestigingen met eigen rooster en prikklok', 'Hulp bij het overstappen'] }
  ];
  const EXTRA = { payroll: 'Salarisexport', phone: '3CX-telefonie', locations: 'Meerdere vestigingen' };
  const rangeTxt = p => p.maxMembers ? (p.minMembers > 1 ? p.minMembers + ' tot ' + p.maxMembers : 'tot ' + p.maxMembers) + ' medewerkers' : p.minMembers + ' of meer medewerkers';
  const fitsN = (p, n) => n >= (p.minMembers || 1) && (!p.maxMembers || n <= p.maxMembers);
  // pakket zonder bovengrens: prijs per medewerker boven de ondergrens
  const monthFor = (p, n) => p.fixed || !p.maxMembers && n <= (p.minMembers || 1) ? p.monthCents : Math.round(p.monthCents / (p.minMembers || 1) * n);
  let chosen = new URLSearchParams(location.search).get('pakket') || 'team';

  function api(action, body) {
    return fetch(CFG.supabaseUrl + '/functions/v1/crewdeck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey },
      body: JSON.stringify(Object.assign({ action }, body || {}))
    }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Er ging iets mis. Probeer het opnieuw.'); return j; });
  }

  function renderPlans() {
    const n = Number($('calc-n').value) || 1;
    $('calc-out').value = n >= 100 ? '100+' : n;
    $('plans').innerHTML = PLANS.map(p => {
      const fits = fitsN(p, n);
      const extras = Object.keys(EXTRA).filter(k => !(p.features || []).includes(k) && (p.addonCents || {})[k]);
      return '<article class="plan' + (p.popular ? ' pop' : '') + (fits ? ' fits' : '') + '">' + (fits ? '<span class="tag">Past bij ' + n + ' medewerker' + (n === 1 ? '' : 's') + '</span>' : p.popular ? '<span class="tag">Meest gekozen</span>' : '') +
        '<div><h3>' + esc(p.name) + '</h3><p class="tagline">' + esc(p.tagline) + '</p></div>' +
        '<div class="price"><strong>' + (p.fixed ? '' : '<small>vanaf </small>') + eur(p.monthCents, false) + '</strong><span>per maand, excl. btw</span></div>' +
        '<div class="est">Voor ' + esc(rangeTxt(p)) + (fits && !p.fixed && n > (p.minMembers || 1) ? '<br>Met ' + n + ' medewerkers: <strong>' + eur(monthFor(p, n), false) + '</strong> per maand' : '') +
          (Number(p.discountPct) > 0 ? '<br><strong>' + String(p.discountPct).replace(/\.0+$/, '').replace('.', ',') + '% korting</strong> verwerkt in de prijs' : '') + '</div>' +
        '<ul>' + (p.highlights || []).map(h => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
        (extras.length ? '<p class="tagline" style="margin:0">Los erbij: ' + extras.map(k => esc(EXTRA[k]) + ' +' + eur(p.addonCents[k], false)).join(', ') + ' per maand</p>' : '') +
        '<a class="btn ' + (fits || p.popular ? 'primary' : 'outline') + '" href="#aanvragen" data-plan="' + esc(p.id) + '">Kies ' + esc(p.name) + '</a></article>';
    }).join('');
    const sel = $('a-plan');
    sel.innerHTML = PLANS.map(p => '<option value="' + esc(p.id) + '"' + (p.id === chosen ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(rangeTxt(p)) + ', ' + (p.fixed ? '' : 'vanaf ') + eur(p.monthCents, false) + ' p.m.)</option>').join('') +
      '<option value=""' + (!PLANS.some(p => p.id === chosen) ? ' selected' : '') + '>Weet ik nog niet</option>';
  }
  $('calc-n').addEventListener('input', renderPlans);
  $('plans').addEventListener('click', e => { const a = e.target.closest('[data-plan]'); if (a) { chosen = a.dataset.plan; renderPlans(); setTimeout(() => $('a-company').focus(), 400); } });
  $('a-plan').addEventListener('change', e => { chosen = e.target.value; });
  renderPlans();
  if (CFG.supabaseUrl) api('plans').then(d => { if (d.plans && d.plans.length) { PLANS = d.plans; renderPlans(); } }).catch(() => { /* reserve blijft staan */ });

  // aanvraag
  const form = $('ask'), msg = $('ask-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = k => form.elements[k].value.trim();
    const miss = [];
    if (v('company').length < 2) miss.push('bedrijfsnaam');
    if (v('contactName').length < 2) miss.push('je naam');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) miss.push('een geldig e-mailadres');
    if (miss.length) { msg.innerHTML = '<div class="alert error" role="alert">Vul nog in: ' + esc(miss.join(', ')) + '.</div>'; return; }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Versturen…';
    try {
      await api('request', { company: v('company'), contactName: v('contactName'), email: v('email').toLowerCase(), phone: v('phone'), employees: v('employees'),
        plan: v('plan'), message: v('message'), website: form.elements.website.value });
      form.innerHTML = '<div class="done" role="status"><h3>Bedankt, ' + esc(v('contactName').split(' ')[0]) + '!</h3><p>We hebben je aanvraag ontvangen. Zodra ' + esc(v('company')) +
        ' klaarstaat, krijg je op <strong>' + esc(v('email')) + '</strong> een mail om je wachtwoord te kiezen.</p><p class="fine">Niets ontvangen binnen twee werkdagen? Kijk ook in je spammap.</p></div>';
    } catch (err) {
      msg.innerHTML = '<div class="alert error" role="alert">' + esc(err.message) + '</div>';
      btn.disabled = false; btn.textContent = 'Aanvragen';
    }
  });
})();
