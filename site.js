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
  const rangeTxt = p => p.maxMembers ? (p.minMembers > 1 ? p.minMembers + ' tot ' + p.maxMembers : 'tot ' + p.maxMembers) + ' medewerkers' : p.minMembers + ' tot 500 medewerkers';
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

  const MAX = 500;
  // schuif: kleine aantallen fijn, grote aantallen in grotere stappen
  const STOPS = (() => { const a = []; for (let i = 1; i <= 20; i++) a.push(i); for (let i = 25; i <= 100; i += 5) a.push(i); for (let i = 110; i <= 200; i += 10) a.push(i); for (let i = 225; i <= 500; i += 25) a.push(i); a.push(501); return a; })();
  const idxFor = n => { let best = 0; STOPS.forEach((v, i) => { if (Math.abs(v - n) < Math.abs(STOPS[best] - n)) best = i; }); return best; };
  const curN = () => Math.max(1, Math.round(Number($('calc-num').value) || 1));
  function paintSlider() {
    const r = $('calc-n'); const pct = r.value / r.max * 100; const n = curN();
    r.style.setProperty('--p', pct + '%');
    r.setAttribute('aria-valuetext', n > MAX ? 'meer dan 500 medewerkers' : n + ' medewerker' + (n === 1 ? '' : 's'));
  }
  function bestPlan(n) { return n > MAX ? null : PLANS.find(p => fitsN(p, n)) || null; }
  function renderPlans() {
    const n = curN();
    const best = bestPlan(n);
    $('calc-out').innerHTML = n > MAX
      ? '<span class="calc-big">Meer dan 500 medewerkers?</span><span>Dan maken we een prijs op maat. <a href="#aanvragen" data-plan="maatwerk">Vraag maatwerk aan</a></span>'
      : best ? '<span class="calc-label">Met ' + n + ' medewerker' + (n === 1 ? '' : 's') + ' past <strong>' + esc(best.name) + '</strong></span><span class="calc-big">' + eur(monthFor(best, n), false) + ' <small>per maand, excl. btw</small></span>' +
        '<span class="calc-label">Dat is ' + eur(Math.round(monthFor(best, n) / n), true) + ' per medewerker</span>'
      : '<span class="calc-label">Kies hieronder een pakket.</span>';
    $('plans').innerHTML = PLANS.map(p => {
      const fits = best && best.id === p.id;
      const extras = Object.keys(EXTRA).filter(k => !(p.features || []).includes(k) && (p.addonCents || {})[k]);
      return '<article class="plan' + (fits ? ' fits' : best || n > MAX ? ' dim' : '') + '">' + (fits ? '<span class="tag">Past bij jou</span>' : p.popular && !best ? '<span class="tag">Meest gekozen</span>' : '') +
        '<div><h3>' + esc(p.name) + '</h3><p class="range">' + esc(rangeTxt(p)) + '</p></div>' +
        '<div class="price"><strong>' + (p.fixed ? '' : '<small>vanaf </small>') + eur(p.monthCents, false) + '</strong><span>per maand</span>' +
          (Number(p.discountPct) > 0 ? '<em class="disc">' + String(p.discountPct).replace(/\.0+$/, '').replace('.', ',') + '% korting</em>' : '') + '</div>' +
        '<p class="tagline">' + esc(p.tagline) + '</p>' +
        '<ul>' + (p.highlights || []).map(h => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
        (extras.length ? '<div class="extras">Los erbij te nemen:' + extras.map(k => '<span>' + esc(EXTRA[k]) + ' <b>+' + eur(p.addonCents[k], false) + ' p.m.</b></span>').join('') + '</div>' : '') +
        '<a class="btn ' + (fits ? 'primary' : 'outline') + '" href="#aanvragen" data-plan="' + esc(p.id) + '">Kies ' + esc(p.name) + '</a></article>';
    }).join('') +
      '<article class="plan custom' + (n > MAX ? ' fits' : best ? ' dim' : '') + '">' + (n > MAX ? '<span class="tag">Past bij jou</span>' : '') +
        '<div><h3>Maatwerk</h3><p class="range">Meer dan 500 medewerkers, of speciale wensen</p></div>' +
        '<div class="price"><strong>Op aanvraag</strong><span>prijs in overleg</span></div>' +
        '<p class="tagline">Voor grote organisaties of als je iets nodig hebt dat niet in een pakket zit.</p>' +
        '<ul><li>Alles uit Bedrijf</li><li>Prijs en afspraken op maat</li><li>Persoonlijke hulp bij de start</li><li>Betalen per factuur mogelijk</li></ul>' +
        '<a class="btn ' + (n > MAX ? 'primary' : 'outline') + '" href="#aanvragen" data-plan="maatwerk">Vraag maatwerk aan</a></article>';
    const sel = $('a-plan');
    sel.innerHTML = PLANS.map(p => '<option value="' + esc(p.id) + '"' + (p.id === chosen ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(rangeTxt(p)) + ', ' + (p.fixed ? '' : 'vanaf ') + eur(p.monthCents, false) + ' p.m.)</option>').join('') +
      '<option value="maatwerk"' + (chosen === 'maatwerk' ? ' selected' : '') + '>Maatwerk (prijs op aanvraag)</option>' +
      '<option value=""' + (!PLANS.some(p => p.id === chosen) && chosen !== 'maatwerk' ? ' selected' : '') + '>Weet ik nog niet</option>';
  }
  const r = $('calc-n'); r.max = STOPS.length - 1;
  $('calc-ticks').innerHTML = [1, 10, 50, 100, 250, 501].map(v => '<span style="left:' + (idxFor(v) / (STOPS.length - 1) * 100) + '%">' + (v > MAX ? '500+' : v) + '</span>').join('');
  r.addEventListener('input', () => { $('calc-num').value = STOPS[Number(r.value)]; paintSlider(); renderPlans(); });
  $('calc-num').addEventListener('input', () => { r.value = idxFor(Math.min(curN(), MAX + 1)); paintSlider(); renderPlans(); });
  document.querySelectorAll('.calc-step').forEach(b => b.addEventListener('click', () => { $('calc-num').value = Math.max(1, curN() + Number(b.dataset.step)); r.value = idxFor(Math.min(curN(), MAX + 1)); paintSlider(); renderPlans(); }));
  r.value = idxFor(curN()); paintSlider();
  document.addEventListener('click', e => { const a = e.target.closest('[data-plan]'); if (a) { chosen = a.dataset.plan; renderPlans();
    if (chosen === 'maatwerk') { const em = $('a-emp'); if (em && curN() > MAX) em.value = 'Meer dan 500'; }
    setTimeout(() => $('a-company').focus(), 400); } });
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
